import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Track, Playlist } from '../types';
import { PlaylistMutationQueue } from './playlistMutationQueue';
import { PlaylistSyncMutationTracker } from './playlistSyncMutationTracker';
import { CoalescedPullRunner, type PullRunContext } from './coalescedPullRunner';
import { reconcileFavoriteTracks, selectLocalFavoritesForUser } from './favoriteSyncPolicy';
import {
  canCompleteOwnedHandoff,
  isCurrentSyncOwner,
  localUpsertPrecedesRemoteDelete,
  type SyncOwner
} from './syncOwnership';
import {
  PlaylistOwnershipProvenance,
  type PersistedOwnershipSnapshot
} from './playlistOwnershipProvenance';
import { buildHandoffPlaybackState } from './handoffPlaybackState';
import {
  assertSupabaseMutationSucceeded,
  preserveLocalPlaylistMetadata,
  reconcileKnownSyncedPlaylistIds,
  selectLocalPlaylistsForUser
} from './supabasePlaylistPolicy';
import {
  getAccountScopedPlaylistRowId,
  normalizePlaylistRowsForUser
} from './playlistStorageKey';

export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'web';
  isCurrentDevice: boolean;
  lastActive: number;
}

export interface HandoffPayload {
  track: Track;
  currentTime: number;
  isPlaying: boolean;
  queue: Track[];
  shuffledQueue?: Track[];
  queueOccurrenceIds?: string[];
  shuffledQueueOccurrenceIds?: string[];
  queueIndex?: number;
  isShuffle?: boolean;
  targetDeviceId: string;
  sourceDeviceName: string;
}

class SupabaseSyncService {
  private deviceId: string;
  private deviceName: string;
  private deviceType: 'desktop' | 'mobile' | 'web';
  private channel: RealtimeChannel | null = null;
  private channelUserId: string | null = null;
  private channelGeneration = 0;
  private startSyncRequestGeneration = 0;
  private syncDownRunner = new CoalescedPullRunner();
  private lastAppliedPlaylistUserId: string | null = localStorage.getItem('owo_last_playlist_sync_user_id');
  private lastAppliedFavoritesUserId: string | null = localStorage.getItem('owo_last_favorites_sync_user_id');
  private playlistStateUserId: string | null = null;
  private activeDevices: Map<string, ConnectedDevice> = new Map();
  private onDevicesUpdatedListeners: Set<(devices: ConnectedDevice[]) => void> = new Set();
  private playlistMutations = new PlaylistMutationQueue();
  private playlistMutationTracker = new PlaylistSyncMutationTracker();
  private playlistOwnership = new PlaylistOwnershipProvenance(this.loadPlaylistOwners());
  private favoriteMutations = new PlaylistMutationQueue();
  private favoriteMutationTracker = new PlaylistSyncMutationTracker();
  private favoriteOwnership = new PlaylistOwnershipProvenance(this.loadFavoriteOwners());
  private remoteDeletedPlaylistIds = new Set<string>();
  private observedAuthUserId: string | null = useAuthStore.getState().user?.id || null;
  private authSessionGeneration = 0;

  private loadPlaylistOwners(): PersistedOwnershipSnapshot {
    try {
      const parsed = JSON.parse(localStorage.getItem('owo_local_playlist_owners') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistPlaylistOwners(): void {
    try {
      localStorage.setItem('owo_local_playlist_owners', JSON.stringify(this.playlistOwnership.snapshot()));
    } catch (error: any) {
      console.warn('[Supabase playlist ownership persistence Error]:', error?.message);
    }
  }

  private loadFavoriteOwners(): PersistedOwnershipSnapshot {
    try {
      const parsed = JSON.parse(localStorage.getItem('owo_local_favorite_owners') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistFavoriteOwners(): void {
    try {
      localStorage.setItem('owo_local_favorite_owners', JSON.stringify(this.favoriteOwnership.snapshot()));
    } catch (error: any) {
      console.warn('[Supabase favorite ownership persistence Error]:', error?.message);
    }
  }

  private playlistMutationKey(userId: string, playlistId: string): string {
    return `${userId}\u0000${playlistId}`;
  }

  private playlistKeyBelongsToUser(key: string, userId: string): boolean {
    return key.startsWith(`${userId}\u0000`);
  }

  private playlistIdFromMutationKey(key: string, userId: string): string | null {
    const prefix = `${userId}\u0000`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : null;
  }

  private preparePlaylistUserScope(userId: string): void {
    if (this.playlistStateUserId && this.playlistStateUserId !== userId) {
      const previousUserId = this.playlistStateUserId;
      this.playlistMutationTracker.clearWhere(key => this.playlistKeyBelongsToUser(key, previousUserId));
      for (const key of Array.from(this.remoteDeletedPlaylistIds)) {
        if (this.playlistKeyBelongsToUser(key, previousUserId)) this.remoteDeletedPlaylistIds.delete(key);
      }
    }
    this.playlistStateUserId = userId;
  }

  private captureSyncOwner(userId: string): { channel: RealtimeChannel | null; owner: SyncOwner } {
    return {
      channel: this.channelUserId === userId ? this.channel : null,
      owner: { userId, generation: this.channelGeneration }
    };
  }

  private ownsSyncChannel(channel: RealtimeChannel | null, owner: SyncOwner): boolean {
    return Boolean(channel) && this.channel === channel && this.channelUserId === owner.userId &&
      isCurrentSyncOwner(owner, useAuthStore.getState().user?.id || null, this.channelGeneration);
  }

  private scopeLocalLibraryForAuth(userId: string | null): void {
    const scopedUserId = userId || '__signed_out__';
    const previousPlaylistKnown = this.lastAppliedPlaylistUserId
      ? this.getKnownSyncedPlaylistIds(this.lastAppliedPlaylistUserId)
      : new Set<string>();
    const previousFavoriteKnown = this.lastAppliedFavoritesUserId
      ? this.getKnownSyncedFavoriteIds(this.lastAppliedFavoritesUserId)
      : new Set<string>();
    const currentPlaylistKnown = userId ? this.getKnownSyncedPlaylistIds(userId) : new Set<string>();
    const currentFavoriteKnown = userId ? this.getKnownSyncedFavoriteIds(userId) : new Set<string>();
    const state = usePlayerStore.getState();
    const playlists = selectLocalPlaylistsForUser({
      localPlaylists: state.playlists,
      lastSyncedUserId: this.lastAppliedPlaylistUserId,
      currentUserId: scopedUserId,
      previousUserKnownIds: previousPlaylistKnown,
      currentUserKnownIds: currentPlaylistKnown,
      ownerByPlaylistId: this.playlistOwnership.snapshot()
    });
    const favorites = selectLocalFavoritesForUser(
      state.favorites,
      this.lastAppliedFavoritesUserId,
      scopedUserId,
      this.favoriteOwnership.snapshot(),
      previousFavoriteKnown,
      currentFavoriteKnown
    );
    usePlayerStore.setState({ playlists, favorites });
  }

  private getKnownSyncedPlaylistIds(userId: string): Set<string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(`owo_synced_playlist_ids:${userId}`) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private setKnownSyncedPlaylistIds(userId: string, ids: Set<string>): void {
    localStorage.setItem(`owo_synced_playlist_ids:${userId}`, JSON.stringify(Array.from(ids)));
  }

  private favoriteMutationKey(userId: string, trackId: string): string {
    return `${userId}\u0000${trackId}`;
  }

  private getKnownSyncedFavoriteIds(userId: string): Set<string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(`owo_synced_favorite_ids:${userId}`) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private setKnownSyncedFavoriteIds(userId: string, ids: Set<string>): void {
    localStorage.setItem(`owo_synced_favorite_ids:${userId}`, JSON.stringify(Array.from(ids)));
  }

  constructor() {
    // 1. Initialize persistent Device ID
    let storedId = localStorage.getItem('owo_sync_device_id');
    if (!storedId) {
      storedId = 'dev_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('owo_sync_device_id', storedId);
    }
    this.deviceId = storedId;

    // 2. Detect platform & device name
    if (window.electronAPI?.isElectron) {
      this.deviceType = 'desktop';
      this.deviceName = 'Windows PC';
    } else if (navigator.userAgent.includes('Android')) {
      this.deviceType = 'mobile';
      this.deviceName = 'Android Device';
    } else if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      this.deviceType = 'mobile';
      this.deviceName = 'iPhone / iPad';
    } else {
      this.deviceType = 'web';
      this.deviceName = 'Web Browser';
    }

    // Zustand subscriptions run in the same state transition. Scope the
    // account-owned library before a React effect or a delayed/failed cloud
    // pull can leave the previous account's rows visible.
    useAuthStore.subscribe(state => {
      const nextUserId = state.user?.id || null;
      if (nextUserId === this.observedAuthUserId) return;
      this.observedAuthUserId = nextUserId;
      this.authSessionGeneration++;
      this.scopeLocalLibraryForAuth(nextUserId);
    });
  }

  public getDeviceInfo(): ConnectedDevice {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: this.deviceType,
      isCurrentDevice: true,
      lastActive: Date.now()
    };
  }

  public subscribeToDevices(listener: (devices: ConnectedDevice[]) => void) {
    this.onDevicesUpdatedListeners.add(listener);
    listener(this.getConnectedDevices());
    return () => {
      this.onDevicesUpdatedListeners.delete(listener);
    };
  }

  public getConnectedDevices(): ConnectedDevice[] {
    const list = Array.from(this.activeDevices.values());
    const current = this.getDeviceInfo();
    return [current, ...list.filter(d => d.deviceId !== this.deviceId)];
  }

  public async startSync() {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const startRequestGeneration = ++this.startSyncRequestGeneration;
    this.scopeLocalLibraryForAuth(user.id);

    const supabase = getSupabase();

    // Clean up existing channel if any
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.channelUserId = null;
      this.channelGeneration++;
    }
    this.activeDevices.clear();
    this.notifyDeviceListeners();

    // 1. Initial Data Sync (Pull cloud playlists & favorites)
    await this.syncDown();
    if (useAuthStore.getState().user?.id !== user.id ||
        this.startSyncRequestGeneration !== startRequestGeneration) return;

    // 2. Create Realtime Sync & Presence Room for this specific user
    const roomName = `user_sync_${user.id}`;
    const channel = supabase.channel(roomName, {
      config: {
        presence: {
          key: this.deviceId
        }
      }
    });
    const channelGeneration = ++this.channelGeneration;
    const channelOwner: SyncOwner = { userId: user.id, generation: channelGeneration };
    const isOwnedRealtimeCallback = () => this.channel === channel &&
      this.channelUserId === user.id &&
      isCurrentSyncOwner(channelOwner, useAuthStore.getState().user?.id || null, this.channelGeneration);
    this.channel = channel;
    this.channelUserId = user.id;

    // Every callback is bound to this exact channel/user generation. Already
    // queued callbacks from a removed channel cannot mutate the next account.
    channel.on('presence', { event: 'sync' }, () => {
      if (!isOwnedRealtimeCallback()) return;
      const state = channel.presenceState() || {};
      this.activeDevices.clear();

      Object.entries(state).forEach(([devId, presences]: [string, any]) => {
        if (devId !== this.deviceId && presences && presences[0]) {
          const p = presences[0];
          this.activeDevices.set(devId, {
            deviceId: devId,
            deviceName: p.deviceName || 'Linked Device',
            deviceType: p.deviceType || 'desktop',
            isCurrentDevice: false,
            lastActive: p.lastActive || Date.now()
          });
        }
      });

      this.notifyDeviceListeners();
    });

    // Handle Playback Handoff (Spotify Connect Style)
    channel.on('broadcast', { event: 'playback_handoff' }, ({ payload }: { payload: HandoffPayload }) => {
      if (!isOwnedRealtimeCallback()) return;
      if (payload.targetDeviceId === this.deviceId) {
        console.log('[Supabase Handoff] Received playback transfer from', payload.sourceDeviceName);
        this.applyHandoff(payload);
      }
    });

    // Handle Remote Control Stop (when playback is transferred away)
    channel.on('broadcast', { event: 'playback_transferred_away' }, ({ payload }: { payload: { sourceDeviceId: string } }) => {
      if (!isOwnedRealtimeCallback()) return;
      if (payload.sourceDeviceId === this.deviceId) {
        usePlayerStore.getState().setIsPlaying(false);
      }
    });

    // Handle Realtime Playlist & Favorite Updates from other devices
    channel.on('broadcast', { event: 'library_updated' }, ({ payload }: { payload?: { type?: string; id?: string } }) => {
      if (!isOwnedRealtimeCallback()) return;
      console.log('[Supabase Sync] Library updated remotely, syncing down...');
      if (payload?.type === 'playlist_deleted' && payload.id) {
        const mutationKey = this.playlistMutationKey(user.id, payload.id);
        const localMutation = this.playlistMutationTracker.get(mutationKey);
        if (localUpsertPrecedesRemoteDelete(localMutation?.kind)) {
          void this.syncDown();
          return;
        }
        // A cloud delete cannot be represented by the existing overlay-only
        // syncDown merge. Remove it immediately and version the tombstone so an
        // already-running stale sync response cannot resurrect it.
        if (!this.playlistMutations.hasPending(mutationKey)) {
          this.playlistMutationTracker.mark(mutationKey, 'remote-delete');
          this.remoteDeletedPlaylistIds.add(mutationKey);
        }
        usePlayerStore.setState(state => ({
          playlists: state.playlists.filter(playlist => playlist.id !== payload.id)
        }));
        this.playlistOwnership.removeIfOwned(user.id, payload.id);
        this.persistPlaylistOwners();
        if (isOwnedRealtimeCallback()) {
          const knownIds = this.getKnownSyncedPlaylistIds(user.id);
          knownIds.delete(payload.id);
          this.setKnownSyncedPlaylistIds(user.id, knownIds);
        }
      }
      void this.syncDown();
    });

    await channel.subscribe(async (status) => {
      if (!isOwnedRealtimeCallback()) return;
      if (status === 'SUBSCRIBED') {
        // Track presence
        await channel.track({
          deviceName: this.deviceName,
          deviceType: this.deviceType,
          lastActive: Date.now()
        });
      }
    });
  }

  public stopSync() {
    this.startSyncRequestGeneration++;
    this.scopeLocalLibraryForAuth(null);
    if (this.channel) {
      const supabase = getSupabase();
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.channelUserId = null;
    this.channelGeneration++;
    this.activeDevices.clear();
    this.remoteDeletedPlaylistIds.clear();
    this.notifyDeviceListeners();
  }

  private notifyDeviceListeners() {
    const list = this.getConnectedDevices();
    this.onDevicesUpdatedListeners.forEach(fn => fn(list));
  }

  /**
   * Transfers active music playback to another device immediately
   */
  public async transferPlaybackToDevice(targetDeviceId: string) {
    const player = usePlayerStore.getState();
    const user = useAuthStore.getState().user;
    if (!player.currentTrack || !user || !this.activeDevices.has(targetDeviceId)) return;
    const broadcastOwnership = this.captureSyncOwner(user.id);
    if (!this.ownsSyncChannel(broadcastOwnership.channel, broadcastOwnership.owner) ||
        !canCompleteOwnedHandoff(
          broadcastOwnership.owner,
          user.id,
          this.channelGeneration,
          targetDeviceId,
          this.activeDevices.keys()
        )) return;

    const payload: HandoffPayload = {
      track: player.currentTrack,
      currentTime: player.currentTime,
      isPlaying: player.isPlaying,
      queue: player.queue,
      shuffledQueue: player.shuffledQueue,
      queueOccurrenceIds: player.queueOccurrenceIds,
      shuffledQueueOccurrenceIds: player.shuffledQueueOccurrenceIds,
      queueIndex: player.queueIndex,
      isShuffle: player.isShuffle,
      targetDeviceId,
      sourceDeviceName: this.deviceName
    };

    // Broadcast handoff
    await broadcastOwnership.channel!.send({
      type: 'broadcast',
      event: 'playback_handoff',
      payload
    });

    if (!this.ownsSyncChannel(broadcastOwnership.channel, broadcastOwnership.owner) ||
        !canCompleteOwnedHandoff(
          broadcastOwnership.owner,
          useAuthStore.getState().user?.id || null,
          this.channelGeneration,
          targetDeviceId,
          this.activeDevices.keys()
        )) return;

    // Pause local playback
    player.setIsPlaying(false);
    player.showToast(`Transferred playback to other device`);
  }

  private applyHandoff(payload: HandoffPayload) {
    const playback = buildHandoffPlaybackState(payload);
    usePlayerStore.setState(state => ({
      ...playback,
      recommendedUpNext: [],
      queueSessionId: `handoff_${Date.now()}`,
      playNonce: state.playNonce + 1
    }));
    usePlayerStore.getState().showToast(`Music handed off from ${payload.sourceDeviceName}`);
  }

  /**
   * Pulls playlists and favorites from Supabase and merges them into the local store
   */
  public async syncDown() {
    return this.syncDownRunner.request(
      () => ({
        userId: useAuthStore.getState().user?.id || null,
        authGeneration: this.authSessionGeneration
      }),
      context => this.performSyncDown(context)
    );
  }

  private async performSyncDown(context: PullRunContext): Promise<void> {
    this.preparePlaylistUserScope(context.userId);
    const playlistVersionsAtStart = this.playlistMutationTracker.snapshot();
    const pendingPlaylistIdsAtStart = this.playlistMutations.snapshotPendingPlaylistIds();
    const favoriteVersionsAtStart = this.favoriteMutationTracker.snapshot();
    const pendingFavoriteIdsAtStart = this.favoriteMutations.snapshotPendingPlaylistIds();
    try {
      const supabase = getSupabase();

      // 1. Fetch Cloud Playlists
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', context.userId);

      if (!context.isCurrent()) return;
      if (playlistsError) throw new Error(`Playlist sync failed: ${playlistsError.message}`);
      if (Array.isArray(playlistsData)) {
        const normalizedPlaylistRows = normalizePlaylistRowsForUser(playlistsData, context.userId);
        if (!context.isCurrent()) return;
        const previousUserKnownIds = this.lastAppliedPlaylistUserId
          ? this.getKnownSyncedPlaylistIds(this.lastAppliedPlaylistUserId)
          : new Set<string>();
        const localPlaylists = selectLocalPlaylistsForUser({
          localPlaylists: usePlayerStore.getState().playlists,
          lastSyncedUserId: this.lastAppliedPlaylistUserId,
          currentUserId: context.userId,
          previousUserKnownIds,
          currentUserKnownIds: this.getKnownSyncedPlaylistIds(context.userId),
          ownerByPlaylistId: this.playlistOwnership.snapshot()
        });
        const knownIds = this.getKnownSyncedPlaylistIds(context.userId);
        const cloudIds = new Set(normalizedPlaylistRows.map((playlist: any) => String(playlist.id)));
        const reconciliation = reconcileKnownSyncedPlaylistIds({
          localIds: localPlaylists.map(playlist => playlist.id),
          cloudIds,
          knownIds,
          isProtected: knownId => this.playlistMutationTracker.shouldPreserveLocal(
            this.playlistMutationKey(context.userId, knownId),
            playlistVersionsAtStart,
            pendingPlaylistIdsAtStart,
            this.playlistMutations.hasPending(this.playlistMutationKey(context.userId, knownId))
          )
        });
        reconciliation.removeLocalIds.forEach(id => {
          this.playlistMutationTracker.clearKind(this.playlistMutationKey(context.userId, id), 'remote-delete');
          this.playlistOwnership.removeIfOwned(context.userId, id);
        });

        // Cloud absence is authoritative only for IDs proven to have synced
        // previously. Unknown local-only playlists remain untouched.
        const merged: Playlist[] = localPlaylists.filter(playlist =>
          !reconciliation.removeLocalIds.has(playlist.id)
        );

        normalizedPlaylistRows.forEach((cloudPl: any) => {
          if (this.playlistMutationTracker.shouldPreserveLocal(
            this.playlistMutationKey(context.userId, cloudPl.id),
            playlistVersionsAtStart,
            pendingPlaylistIdsAtStart,
            this.playlistMutations.hasPending(this.playlistMutationKey(context.userId, cloudPl.id))
          )) {
            return;
          }
          const existingIdx = merged.findIndex(p => p.id === cloudPl.id);
          const rawCloudPl: Playlist = {
            id: cloudPl.id,
            name: cloudPl.title,
            description: cloudPl.description || '',
            cover: cloudPl.cover_art || '',
            tracks: cloudPl.tracks || [],
            createdAt: new Date(cloudPl.created_at).getTime()
          };

          const preservedPl = existingIdx >= 0
            ? preserveLocalPlaylistMetadata(rawCloudPl, merged[existingIdx])
            : rawCloudPl;

          if (existingIdx >= 0) {
            merged[existingIdx] = preservedPl;
          } else {
            merged.push(preservedPl);
          }
          this.playlistOwnership.assign(context.userId, cloudPl.id);
        });

        if (!context.isCurrent()) return;
        usePlayerStore.setState({ playlists: merged });
        this.setKnownSyncedPlaylistIds(context.userId, reconciliation.nextKnownIds);
        this.lastAppliedPlaylistUserId = context.userId;
        localStorage.setItem('owo_last_playlist_sync_user_id', context.userId);
        this.persistPlaylistOwners();

        // Keep the remote-delete marker only while a stale cloud response can
        // still contain the row. A later authoritative fetch that confirms its
        // absence releases the marker so a future recreation of the same ID is
        // allowed to sync normally.
        this.remoteDeletedPlaylistIds.forEach(key => {
          if (!context.isCurrent()) return;
          const id = this.playlistIdFromMutationKey(key, context.userId);
          if (!id) return;
          if (!cloudIds.has(id)) {
            this.playlistMutationTracker.clearKind(key, 'remote-delete');
            this.remoteDeletedPlaylistIds.delete(key);
          }
        });
      }

      // 2. Fetch Cloud Favorites
      const { data: favoritesData, error: favoritesError } = await supabase
        .from('user_favorites')
        .select('*')
        .eq('user_id', context.userId);

      if (!context.isCurrent()) return;
      if (favoritesError) throw new Error(`Favorite sync failed: ${favoritesError.message}`);
      if (Array.isArray(favoritesData)) {
        const cloudFavorites: Track[] = favoritesData
          .map((favorite: any) => {
            const trackData = favorite?.track_data;
            const trackId = String(favorite?.track_id || trackData?.id || '');
            return trackData && trackId ? { ...trackData, id: trackId } as Track : null;
          })
          .filter((track): track is Track => Boolean(track));
        const previousUserKnownFavoriteIds = this.lastAppliedFavoritesUserId
          ? this.getKnownSyncedFavoriteIds(this.lastAppliedFavoritesUserId)
          : new Set<string>();
        const localFavorites = selectLocalFavoritesForUser(
          usePlayerStore.getState().favorites,
          this.lastAppliedFavoritesUserId,
          context.userId,
          this.favoriteOwnership.snapshot(),
          previousUserKnownFavoriteIds,
          this.getKnownSyncedFavoriteIds(context.userId)
        );
        const knownIds = this.getKnownSyncedFavoriteIds(context.userId);
        const isFavoriteProtected = (trackId: string) => {
          const mutationKey = this.favoriteMutationKey(context.userId, trackId);
          return this.favoriteMutationTracker.shouldPreserveLocal(
            mutationKey,
            favoriteVersionsAtStart,
            pendingFavoriteIdsAtStart,
            this.favoriteMutations.hasPending(mutationKey)
          );
        };
        const reconciliation = reconcileFavoriteTracks({
          localFavorites,
          cloudFavorites,
          knownIds,
          isProtected: isFavoriteProtected
        });

        if (!context.isCurrent()) return;
        reconciliation.removedIds.forEach(id => this.favoriteOwnership.removeIfOwned(context.userId, id));
        cloudFavorites.forEach(track => {
          if (!isFavoriteProtected(track.id)) this.favoriteOwnership.assign(context.userId, track.id);
        });
        usePlayerStore.setState({ favorites: reconciliation.favorites });
        this.setKnownSyncedFavoriteIds(context.userId, reconciliation.nextKnownIds);
        this.lastAppliedFavoritesUserId = context.userId;
        localStorage.setItem('owo_last_favorites_sync_user_id', context.userId);
        this.persistFavoriteOwners();
      }
    } catch (err: any) {
      console.warn('[Supabase SyncDown Error]:', err?.message);
    }
  }

  /**
   * Uploads a playlist modification to Supabase
   */
  public async syncPlaylistUp(playlist: Playlist) {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const mutationKey = this.playlistMutationKey(user.id, playlist.id);
    const mutation = this.playlistMutationTracker.mark(mutationKey, 'upsert');
    const broadcastOwnership = this.captureSyncOwner(user.id);
    const knownAtInvocation = this.getKnownSyncedPlaylistIds(user.id);
    this.playlistOwnership.beginUpsert(
      user.id,
      playlist.id,
      mutation.version,
      knownAtInvocation.has(playlist.id)
    );
    // Persist before the network await so account switches/restarts can never
    // mistake an A-owned pending create for an unowned local-only playlist.
    this.persistPlaylistOwners();

    // Capture a full immutable-enough snapshot at call time. All mutations for
    // this playlist share one ordered tail, while unrelated playlists can sync
    // concurrently.
    const snapshot: Playlist = {
      ...playlist,
      tracks: playlist.tracks.map(track => ({ ...track }))
    };
    return this.playlistMutations.enqueue(mutationKey, async () => {
      try {
        const supabase = getSupabase();
        const result = await supabase.from('user_playlists').upsert({
          id: getAccountScopedPlaylistRowId(user.id, snapshot.id),
          user_id: user.id,
          title: snapshot.name,
          description: snapshot.description || '',
          cover_art: snapshot.cover || '',
          tracks: snapshot.tracks,
          updated_at: new Date().toISOString()
        });
        assertSupabaseMutationSucceeded(result, 'Playlist upsert');

        // Current deployments use a global primary key on `id`. Once the
        // account-scoped row is durable, remove only this user's legacy raw-ID
        // row. A failed migration delete is surfaced and never reverses the
        // already-safe scoped write.
        const legacyDeleteResult = await supabase
          .from('user_playlists')
          .delete()
          .eq('id', snapshot.id)
          .eq('user_id', user.id);
        assertSupabaseMutationSucceeded(legacyDeleteResult, 'Legacy playlist row migration delete');

        const knownIds = this.getKnownSyncedPlaylistIds(user.id);
        knownIds.add(snapshot.id);
        this.setKnownSyncedPlaylistIds(user.id, knownIds);
        this.remoteDeletedPlaylistIds.delete(mutationKey);
        this.playlistMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        this.playlistOwnership.finishUpsert(user.id, snapshot.id, mutation.version, true);
        this.persistPlaylistOwners();

        if (this.ownsSyncChannel(broadcastOwnership.channel, broadcastOwnership.owner)) {
          void broadcastOwnership.channel!.send({
            type: 'broadcast',
            event: 'library_updated',
            payload: { type: 'playlist', id: snapshot.id }
          }).catch(err => console.warn('[Supabase playlist broadcast Error]:', err?.message));
        }
      } catch (err: any) {
        console.warn('[Supabase syncPlaylistUp Error]:', err?.message);
        this.playlistMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        this.playlistOwnership.finishUpsert(user.id, snapshot.id, mutation.version, false);
        this.persistPlaylistOwners();
        return { success: false, error: err?.message || 'Playlist upsert failed' };
      }
      return { success: true };
    });
  }

  /**
   * Deletes a playlist from Supabase
   */
  public async syncPlaylistDelete(playlistId: string) {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const mutationKey = this.playlistMutationKey(user.id, playlistId);
    const mutation = this.playlistMutationTracker.mark(mutationKey, 'delete');
    const broadcastOwnership = this.captureSyncOwner(user.id);

    return this.playlistMutations.enqueue(mutationKey, async () => {
      try {
        const supabase = getSupabase();
        const scopedResult = await supabase
          .from('user_playlists')
          .delete()
          .eq('id', getAccountScopedPlaylistRowId(user.id, playlistId))
          .eq('user_id', user.id);
        assertSupabaseMutationSucceeded(scopedResult, 'Scoped playlist delete');
        const legacyResult = await supabase
          .from('user_playlists')
          .delete()
          .eq('id', playlistId)
          .eq('user_id', user.id);
        assertSupabaseMutationSucceeded(legacyResult, 'Legacy playlist delete');

        const knownIds = this.getKnownSyncedPlaylistIds(user.id);
        knownIds.delete(playlistId);
        this.setKnownSyncedPlaylistIds(user.id, knownIds);
        this.playlistMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        if (!this.playlistOwnership.hasPendingUpsert(user.id, playlistId)) {
          this.playlistOwnership.removeIfOwned(user.id, playlistId);
          this.persistPlaylistOwners();
        }

        if (this.ownsSyncChannel(broadcastOwnership.channel, broadcastOwnership.owner)) {
          void broadcastOwnership.channel!.send({
            type: 'broadcast',
            event: 'library_updated',
            payload: { type: 'playlist_deleted', id: playlistId }
          }).catch(err => console.warn('[Supabase playlist delete broadcast Error]:', err?.message));
        }
      } catch (err: any) {
        console.warn('[Supabase syncPlaylistDelete Error]:', err?.message);
        this.playlistMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        return { success: false, error: err?.message || 'Playlist delete failed' };
      }
      return { success: true };
    });
  }

  /**
   * Uploads favorite track status to Supabase
   */
  public async syncFavoriteUp(track: Track, isFavorite: boolean) {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const snapshot = { ...track };
    const mutationKey = this.favoriteMutationKey(user.id, snapshot.id);
    const mutation = this.favoriteMutationTracker.mark(mutationKey, isFavorite ? 'upsert' : 'delete');
    const broadcastOwnership = this.captureSyncOwner(user.id);
    if (isFavorite) {
      this.favoriteOwnership.beginUpsert(
        user.id,
        snapshot.id,
        mutation.version,
        this.getKnownSyncedFavoriteIds(user.id).has(snapshot.id)
      );
      this.persistFavoriteOwners();
    }

    return this.favoriteMutations.enqueue(mutationKey, async () => {
      try {
        const supabase = getSupabase();
        const recordId = `${user.id}_${snapshot.id}`;
        const result = isFavorite
          ? await supabase.from('user_favorites').upsert({
              id: recordId,
              user_id: user.id,
              track_id: snapshot.id,
              track_data: snapshot
            })
          : await supabase.from('user_favorites').delete().eq('id', recordId);
        assertSupabaseMutationSucceeded(result, isFavorite ? 'Favorite upsert' : 'Favorite delete');

        const knownIds = this.getKnownSyncedFavoriteIds(user.id);
        if (isFavorite) knownIds.add(snapshot.id);
        else knownIds.delete(snapshot.id);
        this.setKnownSyncedFavoriteIds(user.id, knownIds);
        this.favoriteMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        if (isFavorite) {
          this.favoriteOwnership.finishUpsert(user.id, snapshot.id, mutation.version, true);
        } else if (!this.favoriteOwnership.hasPendingUpsert(user.id, snapshot.id)) {
          this.favoriteOwnership.removeIfOwned(user.id, snapshot.id);
        }
        this.persistFavoriteOwners();

        if (this.ownsSyncChannel(broadcastOwnership.channel, broadcastOwnership.owner)) {
          void broadcastOwnership.channel!.send({
            type: 'broadcast',
            event: 'library_updated',
            payload: { type: 'favorite', trackId: snapshot.id }
          }).catch(err => console.warn('[Supabase favorite broadcast Error]:', err?.message));
        }
      } catch (err: any) {
        console.warn('[Supabase syncFavoriteUp Error]:', err?.message);
        // Preserve the version barrier for pulls that started before this
        // failed mutation, but release its add/delete intent so a later pull
        // can restore cloud truth. This also avoids reviving an older failed
        // mutation during rapid same-ID toggles.
        this.favoriteMutationTracker.settleIfCurrent(mutationKey, mutation.version);
        if (isFavorite) {
          this.favoriteOwnership.finishUpsert(user.id, snapshot.id, mutation.version, false);
          this.persistFavoriteOwners();
        }
        return { success: false, error: err?.message || 'Favorite sync failed' };
      }
      return { success: true };
    });
  }
}

export const supabaseSync = new SupabaseSyncService();
