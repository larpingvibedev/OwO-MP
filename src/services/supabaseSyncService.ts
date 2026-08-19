import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Track, Playlist } from '../types';

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
  queueIndex?: number;
  targetDeviceId: string;
  sourceDeviceName: string;
}

class SupabaseSyncService {
  private deviceId: string;
  private deviceName: string;
  private deviceType: 'desktop' | 'mobile' | 'web';
  private channel: RealtimeChannel | null = null;
  private isSyncingDown = false;
  private activeDevices: Map<string, ConnectedDevice> = new Map();
  private onDevicesUpdatedListeners: Set<(devices: ConnectedDevice[]) => void> = new Set();

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

    const supabase = getSupabase();

    // Clean up existing channel if any
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    // 1. Initial Data Sync (Pull cloud playlists & favorites)
    await this.syncDown();

    // 2. Create Realtime Sync & Presence Room for this specific user
    const roomName = `user_sync_${user.id}`;
    this.channel = supabase.channel(roomName, {
      config: {
        presence: {
          key: this.deviceId
        }
      }
    });

    // Handle Presence (Connected Devices tracking)
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel?.presenceState() || {};
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
    this.channel.on('broadcast', { event: 'playback_handoff' }, ({ payload }: { payload: HandoffPayload }) => {
      if (payload.targetDeviceId === this.deviceId) {
        console.log('[Supabase Handoff] Received playback transfer from', payload.sourceDeviceName);
        this.applyHandoff(payload);
      }
    });

    // Handle Remote Control Stop (when playback is transferred away)
    this.channel.on('broadcast', { event: 'playback_transferred_away' }, ({ payload }: { payload: { sourceDeviceId: string } }) => {
      if (payload.sourceDeviceId === this.deviceId) {
        usePlayerStore.getState().setIsPlaying(false);
      }
    });

    // Handle Realtime Playlist & Favorite Updates from other devices
    this.channel.on('broadcast', { event: 'library_updated' }, () => {
      console.log('[Supabase Sync] Library updated remotely, syncing down...');
      this.syncDown();
    });

    await this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track presence
        await this.channel?.track({
          deviceName: this.deviceName,
          deviceType: this.deviceType,
          lastActive: Date.now()
        });
      }
    });
  }

  public stopSync() {
    if (this.channel) {
      const supabase = getSupabase();
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.activeDevices.clear();
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
    if (!player.currentTrack || !this.channel) return;

    const payload: HandoffPayload = {
      track: player.currentTrack,
      currentTime: player.currentTime,
      isPlaying: player.isPlaying,
      queue: player.queue,
      queueIndex: player.queueIndex,
      targetDeviceId,
      sourceDeviceName: this.deviceName
    };

    // Broadcast handoff
    await this.channel.send({
      type: 'broadcast',
      event: 'playback_handoff',
      payload
    });

    // Pause local playback
    player.setIsPlaying(false);
    player.showToast(`Transferred playback to other device`);
  }

  private applyHandoff(payload: HandoffPayload) {
    const player = usePlayerStore.getState();

    // Set queue if provided
    if (payload.queue && payload.queue.length > 0) {
      player.setQueue(payload.queue, 0, undefined, false);
    }

    // Set track
    player.setCurrentTrack(payload.track, false);
    player.setCurrentTime(payload.currentTime);
    player.setIsPlaying(payload.isPlaying);

    player.showToast(`Music handed off from ${payload.sourceDeviceName}`);
  }

  /**
   * Pulls playlists and favorites from Supabase and merges them into the local store
   */
  public async syncDown() {
    const user = useAuthStore.getState().user;
    if (!user || this.isSyncingDown) return;

    this.isSyncingDown = true;
    try {
      const supabase = getSupabase();

      // 1. Fetch Cloud Playlists
      const { data: playlistsData } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', user.id);

      if (playlistsData && playlistsData.length > 0) {
        const localPlaylists = usePlayerStore.getState().playlists;
        const merged: Playlist[] = [...localPlaylists];

        playlistsData.forEach((cloudPl: any) => {
          const existingIdx = merged.findIndex(p => p.id === cloudPl.id);
          const plObj: Playlist = {
            id: cloudPl.id,
            name: cloudPl.title,
            cover: cloudPl.cover_art || '',
            tracks: cloudPl.tracks || [],
            createdAt: new Date(cloudPl.created_at).getTime()
          };

          if (existingIdx >= 0) {
            merged[existingIdx] = plObj;
          } else {
            merged.push(plObj);
          }
        });

        usePlayerStore.setState({ playlists: merged });
      }

      // 2. Fetch Cloud Favorites
      const { data: favoritesData } = await supabase
        .from('user_favorites')
        .select('*')
        .eq('user_id', user.id);

      if (favoritesData && favoritesData.length > 0) {
        const cloudFavorites: Track[] = favoritesData.map((f: any) => f.track_data);
        const localFavorites = usePlayerStore.getState().favorites;
        
        // Merge favorites uniquely by track ID
        const favMap = new Map<string, Track>();
        localFavorites.forEach(t => favMap.set(t.id, t));
        cloudFavorites.forEach(t => favMap.set(t.id, t));

        usePlayerStore.setState({ favorites: Array.from(favMap.values()) });
      }
    } catch (err: any) {
      console.warn('[Supabase SyncDown Error]:', err?.message);
    } finally {
      this.isSyncingDown = false;
    }
  }

  /**
   * Uploads a playlist modification to Supabase
   */
  public async syncPlaylistUp(playlist: Playlist) {
    const user = useAuthStore.getState().user;
    if (!user || this.isSyncingDown) return;

    try {
      const supabase = getSupabase();
      await supabase.from('user_playlists').upsert({
        id: playlist.id,
        user_id: user.id,
        title: playlist.name,
        description: '',
        cover_art: playlist.cover || '',
        tracks: playlist.tracks,
        updated_at: new Date().toISOString()
      });

      // Broadcast update event to other devices
      this.channel?.send({
        type: 'broadcast',
        event: 'library_updated',
        payload: { type: 'playlist', id: playlist.id }
      });
    } catch (err: any) {
      console.warn('[Supabase syncPlaylistUp Error]:', err?.message);
    }
  }

  /**
   * Deletes a playlist from Supabase
   */
  public async syncPlaylistDelete(playlistId: string) {
    const user = useAuthStore.getState().user;
    if (!user || this.isSyncingDown) return;

    try {
      const supabase = getSupabase();
      await supabase
        .from('user_playlists')
        .delete()
        .eq('id', playlistId)
        .eq('user_id', user.id);

      // Broadcast update event to other devices
      this.channel?.send({
        type: 'broadcast',
        event: 'library_updated',
        payload: { type: 'playlist_deleted', id: playlistId }
      });
    } catch (err: any) {
      console.warn('[Supabase syncPlaylistDelete Error]:', err?.message);
    }
  }

  /**
   * Uploads favorite track status to Supabase
   */
  public async syncFavoriteUp(track: Track, isFavorite: boolean) {
    const user = useAuthStore.getState().user;
    if (!user || this.isSyncingDown) return;

    try {
      const supabase = getSupabase();
      const recordId = `${user.id}_${track.id}`;

      if (isFavorite) {
        await supabase.from('user_favorites').upsert({
          id: recordId,
          user_id: user.id,
          track_id: track.id,
          track_data: track
        });
      } else {
        await supabase.from('user_favorites').delete().eq('id', recordId);
      }

      // Broadcast update event to other devices
      this.channel?.send({
        type: 'broadcast',
        event: 'library_updated',
        payload: { type: 'favorite', trackId: track.id }
      });
    } catch (err: any) {
      console.warn('[Supabase syncFavoriteUp Error]:', err?.message);
    }
  }
}

export const supabaseSync = new SupabaseSyncService();
