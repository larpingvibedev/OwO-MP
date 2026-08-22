import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track, Playlist, ViewType, ArtistProfile, SavedAlbum, FollowedArtist } from '../types';
import { fetchUpNextMix } from '../services/musicSearch';
import { 
  downloadTrackOffline, 
  removeOfflineTrack, 
  getAllOfflineRecords, 
  clearAllOfflineStorage,
  getCustomDirectoryName,
  exportTrackToDisk,
  type OfflineRecord
} from '../services/downloadService';
import {
  reconcileConfiguredOfflineRecords
} from '../services/offlineDiskReconciliation';
import { supabaseSync } from '../services/supabaseSyncService';
import {
  enrichTrackDurations,
  extractExactYouTubeVideoId,
  hasMissingExactTrackDuration
} from '../services/trackDurationService';
import {
  dedupeDownloadTracks,
  getDownloadTrackIdentity,
  removeQueueOccurrence,
  updateCurrentQueueOccurrenceDuration,
  waitForDownloadOwnerCompletion
} from './playerStoreHelpers';
import { OptimisticMutationLedger } from '../services/optimisticMutationLedger';
import {
  captureContextMenuAuthOwner,
  isContextMenuAuthOwnerCurrent,
  type ContextMenuAuthOwner
} from '../services/contextMenuAuthOwnership';

const playlistOptimisticLedger = new OptimisticMutationLedger();
const favoriteOptimisticLedger = new OptimisticMutationLedger();
let queueOccurrenceSequence = 1;
const createQueueOccurrenceId = () => `qo_${Date.now().toString(36)}_${queueOccurrenceSequence++}`;

let lastSyncToastTime = 0;
let lastSyncToastMsg = '';

function syncPlaylistUpTracked(playlist: Playlist) {
  playlistOptimisticLedger.mark(playlist.id, captureContextMenuAuthOwner());
  return supabaseSync.syncPlaylistUp(playlist);
}

interface RemovedArrayEntity<T> {
  entity: T;
  index: number;
}

function captureRemovedEntities<T>(
  items: T[],
  shouldRemove: (item: T) => boolean
): RemovedArrayEntity<T>[] {
  const removed: RemovedArrayEntity<T>[] = [];
  items.forEach((entity, index) => {
    if (shouldRemove(entity)) removed.push({ entity, index });
  });
  return removed;
}

function restoreRemovedEntities<T>(
  current: T[],
  removed: RemovedArrayEntity<T>[],
  getIdentity: (item: T) => string
): T[] {
  if (removed.length === 0) return current;
  const restored = [...current];
  const identitiesPresentBeforeRollback = new Set(current.map(getIdentity));
  for (const item of [...removed].sort((a, b) => a.index - b.index)) {
    const identity = getIdentity(item.entity);
    // A current same-ID entity is newer/current state and must never be
    // overwritten by a stale rollback.
    if (identitiesPresentBeforeRollback.has(identity)) continue;
    restored.splice(Math.min(item.index, restored.length), 0, item.entity);
  }
  return restored;
}

function canRollbackOptimisticMutation(
  ledger: OptimisticMutationLedger,
  key: string,
  version: number,
  owner: ContextMenuAuthOwner
): boolean {
  return ledger.isCurrent(key, version, owner) && isContextMenuAuthOwnerCurrent(owner);
}

export type PlaybackContextType = 'radio' | 'finite' | 'user_playlist';

export interface PlaylistDurationBackfillResult {
  attempted: number;
  resolved: number;
  remaining: number;
  exhausted: boolean;
}

interface PlayerState {
  // Current track & playback
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playNonce: number;
  
  // Queue management
  queue: Track[];
  queueOccurrenceIds: string[];
  queueIndex: number;
  
  // Navigation & Search
  activeView: ViewType;
  searchQuery: string;
  searchResults: Track[];
  artistProfile: ArtistProfile | null;
  isSearching: boolean;
  
  // Navigation Layout
  isSidebarCollapsed: boolean;
  libraryFilter: 'all' | 'playlists' | 'songs' | 'albums' | 'artists' | 'downloads';
  
  // Library Collections (Spotify & YouTube Music Criteria)
  playlists: Playlist[];
  favorites: Track[];
  savedAlbums: SavedAlbum[];
  followedArtists: FollowedArtist[];
  
  // YouTube Music Style Up Next & Drawer State
  autoplay: boolean;
  playingFrom: string;
  playbackContext: PlaybackContextType | null;
  recommendedUpNext: Track[];
  queueSessionId: string;
  activePlayerTab: 'up_next' | 'lyrics' | 'related';
  isPlayerDrawerOpen: boolean;
  useRotatingCD: boolean;
  
  // Advanced Playback State & History
  isShuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  shuffledQueue: Track[];
  shuffledQueueOccurrenceIds: string[];
  isQueueVisible: boolean;
  isNowPlayingVisible: boolean;
  playHistory: Record<string, { track: Track; playCount: number; lastPlayedAt: number }>;

  // Recent Searches
  recentSearchQueries: string[];
  recentSearchedTracks: Track[];

  // Algorithmic Preferences & Blocklists (Not Interested / Don't Recommend)
  dislikedTracks: Track[];
  blockedArtists: string[];

  // Offline Downloads & Storage
  downloadedTrackIds: Record<string, { downloadedAt: number; sizeBytes?: number; title?: string; artist?: string }>;
  downloadingTrackIds: Record<string, number>;
  offlineRecords: OfflineRecord[];
  isOfflineOnly: boolean;

  // Toast Notifications
  toastMessage: string | null;
  showToast: (message: string) => void;
  hideToast: () => void;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLibraryFilter: (filter: 'all' | 'playlists' | 'songs' | 'albums' | 'artists' | 'downloads') => void;
  setCurrentTrack: (track: Track, forceRefresh?: boolean, contextType?: PlaybackContextType) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  togglePlayPause: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  
  setQueue: (tracks: Track[], initialIndex?: number, playingFrom?: string, forceRefresh?: boolean, contextType?: PlaybackContextType) => void;
  setPlaybackContext: (playbackContext: PlaybackContextType | null) => void;
  addToQueue: (track: Track) => void;
  addTracksToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (startIndex: number, endIndex: number) => void;
  playQueueIndex: (index: number) => void;
  playUpNextTrack: (track: Track, remainingUpNext: Track[], skippedFromUpNext?: Track[]) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  
  toggleAutoplay: () => void;
  setPlayingFrom: (source: string) => void;
  setRecommendedUpNext: (tracks: Track[]) => void;
  setActivePlayerTab: (tab: 'up_next' | 'lyrics' | 'related') => void;
  openPlayerDrawer: (tab?: 'up_next' | 'lyrics' | 'related') => void;
  closePlayerDrawer: () => void;
  togglePlayerDrawer: (tab?: 'up_next' | 'lyrics' | 'related') => void;
  toggleRotatingCD: () => void;

  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleQueue: () => void;
  toggleNowPlaying: () => void;
  recordPlay: (track: Track) => void;

  setActiveView: (view: ViewType) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Track[]) => void;
  setArtistProfile: (profile: ArtistProfile | null) => void;
  setIsSearching: (isSearching: boolean) => void;

  addRecentSearchQuery: (query: string) => void;
  removeRecentSearchQuery: (query: string) => void;
  clearRecentSearchQueries: () => void;
  addRecentSearchedTrack: (track: Track) => void;
  removeRecentSearchedTrack: (trackId: string) => void;
  clearRecentSearchedTracks: () => void;
  clearListeningHistoryAndPreferences: () => void;

  markTrackNotInterested: (track: Track) => void;
  unmarkTrackNotInterested: (trackId: string) => void;
  blockArtist: (artistName: string) => void;
  unblockArtist: (artistName: string) => void;
  clearDislikedAndBlocked: () => void;
  
  toggleFavorite: (track: Track) => void;
  toggleSaveAlbum: (album: { id: string; name: string; artist: string; cover: string; releaseDate?: string; trackCount?: number; artistId?: string | number }) => void;
  toggleSavePlaylist: (playlist: { id: string; name: string; cover?: string; tracks?: Track[]; author?: string }) => void;
  toggleFollowArtist: (artist: { name: string; cover: string; subscriberCount?: string; channelId?: string; artistId?: string | number }) => void;
  playNext: (track: Track) => void;
  createPlaylist: (name: string) => string;
  deletePlaylist: (playlistId: string) => void;
  updatePlaylist: (playlistId: string, updates: { name?: string; description?: string; cover?: string }) => void;
  enrichPlaylistDurations: (playlistId: string, trackIds?: string[]) => Promise<PlaylistDurationBackfillResult>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  addTracksToPlaylist: (playlistId: string, tracks: Track[]) => void;
  reorderPlaylistTracks: (playlistId: string, startIndex: number, endIndex: number) => void;
  createPlaylistWithTrack: (name: string, track: Track) => void;
  createImportedPlaylist: (playlist: { name: string; cover?: string; author?: string; tracks: Track[] }) => string;
  saveQueueAsPlaylist: (customName?: string) => void;
  generateRadio: (seedTrack: Track) => Promise<void>;
  generateMultiRadio: (seedTracks: Track[]) => Promise<void>;

  // Offline Downloads Actions
  downloadTrack: (track: Track) => Promise<boolean>;
  removeDownloadedTrack: (trackId: string) => Promise<void>;
  downloadTrackBatch: (tracks: Track[], albumOrPlaylistName?: string) => Promise<{ successCount: number; failCount: number }>;
  exportTrackAudioToDisk: (track: Track) => Promise<boolean>;
  syncOfflineTracks: () => Promise<void>;
  toggleOfflineOnly: () => void;
  clearAllDownloads: () => Promise<void>;
}

let isFetchingContinuation = false;
const activeTrackDownloadPromises = new Map<string, Promise<boolean>>();
const BATCH_OWNER_WAIT_TIMEOUT_MS = 3 * 60 * 1000;

export function isOfflineTrack(track?: Track | null): boolean {
  if (!track) return false;
  return Boolean(
    track.source === 'local' ||
    track.isLocal ||
    track.isDownloaded ||
    track.isAppDownload ||
    track.id?.startsWith('local-') ||
    track.filePath
  );
}

export function shouldAllowOnlineContinuation(params: {
  autoplay?: boolean;
  playingFrom?: string;
  currentTrack?: Track | null;
  activeQueue: Track[];
}): boolean {
  if (!params.autoplay) return false;
  if (!params.activeQueue || params.activeQueue.length === 0) return false;

  const pf = (params.playingFrom || '').toLowerCase();
  if (
    pf.includes('local files') ||
    pf.includes('offline storage') ||
    pf.includes('offline downloads')
  ) {
    return false;
  }

  const isPurelyOffline = params.activeQueue.length > 0 && params.activeQueue.every(isOfflineTrack);
  if (isPurelyOffline) {
    return false;
  }

  if (isOfflineTrack(params.currentTrack) && params.activeQueue.every(isOfflineTrack)) {
    return false;
  }

  return true;
}

async function checkAndTriggerContinuation(
  get: () => PlayerState,
  set: (fn: (state: PlayerState) => Partial<PlayerState> | PlayerState) => void
) {
  const { 
    currentTrack,
    queue, 
    shuffledQueue, 
    queueIndex, 
    isShuffle, 
    playbackContext, 
    autoplay, 
    favorites, 
    playHistory, 
    dislikedTracks, 
    blockedArtists, 
    queueSessionId,
    playingFrom
  } = get();

  if (isFetchingContinuation) return;

  const activeQueue = isShuffle ? shuffledQueue : queue;
  if (!shouldAllowOnlineContinuation({ autoplay, playingFrom, currentTrack, activeQueue })) {
    return;
  }

  // Trigger when remaining tracks including the current one is 3 or less
  const remainingTracks = activeQueue.length - queueIndex;
  if (remainingTracks > 3) return;

  // Seamless queue extension for user playlists and finite queues
  if (playbackContext !== 'user_playlist' && playbackContext !== 'finite') return;

  isFetchingContinuation = true;
  const currentSessionId = queueSessionId;

  try {
    const queuedIds = new Set(queue.map(t => t.id));
    shuffledQueue.forEach(t => queuedIds.add(t.id));
    
    // Use the last up to 4 tracks in queue as context seeds
    const seedContext = activeQueue.slice(-4);
    const targetMix = await fetchUpNextMix(
      seedContext,
      favorites,
      playHistory,
      queuedIds,
      dislikedTracks,
      blockedArtists,
      false, // non-forced to utilize warm cache if available
      50     // Target limit: ~50 tracks
    );

    // Verify queue context/session has not changed while fetching
    if (get().queueSessionId !== currentSessionId) return;

    if (targetMix && targetMix.length > 0) {
      const existingQueueIds = new Set(get().queue.map(t => t.id));
      const existingSignatures = new Set(
        get().queue.map(t => `${(t.title || '').trim().toLowerCase()}:::${(t.artist || '').trim().toLowerCase()}`)
      );
      
      const uniqueNewTracks: Track[] = [];
      for (const track of targetMix) {
        if (!track || !track.id) continue;
        const sig = `${(track.title || '').trim().toLowerCase()}:::${(track.artist || '').trim().toLowerCase()}`;
        if (!existingQueueIds.has(track.id) && !existingSignatures.has(sig)) {
          existingQueueIds.add(track.id);
          existingSignatures.add(sig);
          uniqueNewTracks.push(track);
        }
      }

      if (uniqueNewTracks.length > 0) {
        const newOccurrenceIds = uniqueNewTracks.map(() => createQueueOccurrenceId());
        set((state) => ({
          queue: [...state.queue, ...uniqueNewTracks],
          queueOccurrenceIds: [...state.queueOccurrenceIds, ...newOccurrenceIds],
          shuffledQueue: [...state.shuffledQueue, ...uniqueNewTracks],
          shuffledQueueOccurrenceIds: [...state.shuffledQueueOccurrenceIds, ...newOccurrenceIds]
        }));
      }
    }
  } catch (err) {
    console.warn('[usePlayerStore] Continuation fetch error:', err);
  } finally {
    isFetchingContinuation = false;
  }
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  playNonce: 0,
  
  queue: [],
  queueOccurrenceIds: [],
  queueIndex: 0,
  
  autoplay: true,
  playingFrom: 'Auto Mix',
  recommendedUpNext: [],
  queueSessionId: '',
  activePlayerTab: 'up_next',
  isPlayerDrawerOpen: false,
  useRotatingCD: false,

  activeView: 'dashboard',
  searchQuery: '',
  searchResults: [],
  artistProfile: null,
  isSearching: false,
  
  recentSearchQueries: [],
  recentSearchedTracks: [],

  dislikedTracks: [],
  blockedArtists: [],

  downloadedTrackIds: {},
  downloadingTrackIds: {},
  offlineRecords: [],
  isOfflineOnly: false,

  isSidebarCollapsed: false,
  libraryFilter: 'all',
  
  playlists: [],
  favorites: [],
  savedAlbums: [],
  followedArtists: [],

  isShuffle: false,
  repeatMode: 'off',
  shuffledQueue: [],
  shuffledQueueOccurrenceIds: [],
  isQueueVisible: false,
  isNowPlayingVisible: false,
  playHistory: {},
  
  toastMessage: null,
  showToast: (message: string) => set({ toastMessage: message }),
  hideToast: () => set({ toastMessage: null }),

  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
  setLibraryFilter: (libraryFilter) => set({ libraryFilter }),
  playbackContext: null,
  setPlaybackContext: (playbackContext) => set({ playbackContext }),
  setCurrentTrack: (track, forceRefresh = true, contextType) => {
    const isOffline = isOfflineTrack(track);
    const context = isOffline ? (track.album || 'Local Files') : `${track.title} Mix`;
    const sessionId = `qs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newContextType = isOffline ? 'user_playlist' : (contextType !== undefined ? contextType : 'radio');
    const occurrenceId = createQueueOccurrenceId();
    set((state) => ({ 
      currentTrack: track, 
      currentTime: 0, 
      duration: track.duration || 0,
      isPlaying: true, 
      playingFrom: context,
      playbackContext: newContextType,
      queueSessionId: sessionId,
      queue: [track],
      queueOccurrenceIds: [occurrenceId],
      shuffledQueue: [track],
      shuffledQueueOccurrenceIds: [occurrenceId],
      queueIndex: 0,
      recommendedUpNext: [],
      isPlayerDrawerOpen: true,
      playNonce: state.playNonce + 1
    }));

    const allowContinuation = shouldAllowOnlineContinuation({
      autoplay: get().autoplay,
      playingFrom: context,
      currentTrack: track,
      activeQueue: [track]
    });

    if (allowContinuation && newContextType !== 'user_playlist') {
      // Synthesize mix anchored to this seed track
      fetchUpNextMix([track], get().favorites, get().playHistory, new Set([track.id]), get().dislikedTracks, get().blockedArtists, forceRefresh)
        .then(mix => {
          if (mix && mix.length > 0 && get().queueSessionId === sessionId) {
            set({ recommendedUpNext: mix });
          }
        })
        .catch(() => {});
    } else if (allowContinuation) {
      checkAndTriggerContinuation(get, set);
    }
  },
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set((state) => {
    const rounded = Math.round(duration);
    if (rounded > 0) {
      let updatedTrack = state.currentTrack;
      let updatedQueue = state.queue;
      let updatedShuffled = state.shuffledQueue;
      if (state.currentTrack) {
        const updated = updateCurrentQueueOccurrenceDuration({
          queue: state.queue,
          shuffledQueue: state.shuffledQueue,
          isShuffle: state.isShuffle,
          queueIndex: state.queueIndex,
          currentTrack: state.currentTrack,
          queueOccurrenceIds: state.queueOccurrenceIds,
          shuffledQueueOccurrenceIds: state.shuffledQueueOccurrenceIds
        }, rounded);
        updatedTrack = updated.currentTrack;
        updatedQueue = updated.queue;
        updatedShuffled = updated.shuffledQueue;
      }
      return { 
        duration: rounded, 
        currentTrack: updatedTrack, 
        queue: updatedQueue, 
        shuffledQueue: updatedShuffled 
      };
    }
    return { duration: rounded };
  }),
  setVolume: (volume) => set({ volume }),
  
  toggleAutoplay: () => set((state) => ({ autoplay: !state.autoplay })),
  setPlayingFrom: (playingFrom) => set({ playingFrom }),
  setRecommendedUpNext: (recommendedUpNext) => set({ recommendedUpNext }),
  setActivePlayerTab: (activePlayerTab) => set({ activePlayerTab }),
  openPlayerDrawer: (tab = 'up_next') => set({ isPlayerDrawerOpen: true, activePlayerTab: tab }),
  closePlayerDrawer: () => set({ isPlayerDrawerOpen: false }),
  togglePlayerDrawer: (tab) => set((state) => {
    if (state.isPlayerDrawerOpen && (!tab || tab === state.activePlayerTab)) {
      return { isPlayerDrawerOpen: false };
    }
    return { isPlayerDrawerOpen: true, activePlayerTab: tab || state.activePlayerTab };
  }),
  toggleRotatingCD: () => set((state) => ({ useRotatingCD: !state.useRotatingCD })),

  setQueue: (tracks, initialIndex = 0, playingFrom, forceRefresh = true, contextType) => {
    const isShuffle = get().isShuffle;
    const queueOccurrenceIds = tracks.map(() => createQueueOccurrenceId());
    let shuffledEntries = tracks.map((track, index) => ({ track, occurrenceId: queueOccurrenceIds[index] }));
    let newIndex = initialIndex;
    
    if (isShuffle) {
      // Fisher-Yates shuffle
      for (let i = shuffledEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledEntries[i], shuffledEntries[j]] = [shuffledEntries[j], shuffledEntries[i]];
      }
      const selectedOccurrenceId = queueOccurrenceIds[initialIndex];
      const selectedIdx = shuffledEntries.findIndex(entry => entry.occurrenceId === selectedOccurrenceId);
      if (selectedIdx !== -1) {
        [shuffledEntries[0], shuffledEntries[selectedIdx]] = [shuffledEntries[selectedIdx], shuffledEntries[0]];
      }
      newIndex = 0;
    }

    const shuffled = shuffledEntries.map(entry => entry.track);
    const shuffledQueueOccurrenceIds = shuffledEntries.map(entry => entry.occurrenceId);

    const cur = isShuffle ? shuffled[newIndex] : tracks[newIndex];
    const isOfflineContext = (playingFrom || '').toLowerCase().includes('local files') || (playingFrom || '').toLowerCase().includes('offline');
    const isLocalQueue = isOfflineContext || (tracks.length > 0 && tracks.every(isOfflineTrack));
    const sourceContext = playingFrom || (isLocalQueue ? 'Local Files' : (cur ? `${cur.title} Mix` : 'Queue'));
    const sessionId = `qs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const resolvedContextType = isLocalQueue ? 'user_playlist' : (contextType !== undefined ? contextType : (
      playingFrom && (playingFrom.endsWith('Mix') || playingFrom.includes('Discover') || playingFrom.includes('Radio') || playingFrom.includes('Supermix'))
        ? 'radio'
        : 'finite'
    ));

    set((state) => ({
      queue: tracks,
      queueOccurrenceIds,
      shuffledQueue: shuffled,
      shuffledQueueOccurrenceIds,
      queueIndex: newIndex,
      currentTrack: cur,
      playingFrom: sourceContext,
      playbackContext: resolvedContextType,
      queueSessionId: sessionId,
      currentTime: 0,
      duration: cur?.duration || 0,
      isPlaying: true,
      recommendedUpNext: [],
      isPlayerDrawerOpen: true,
      playNonce: state.playNonce + 1
    }));

    const allowContinuation = shouldAllowOnlineContinuation({
      autoplay: get().autoplay,
      playingFrom: sourceContext,
      currentTrack: cur,
      activeQueue: isShuffle ? shuffled : tracks
    });

    if (allowContinuation && resolvedContextType !== 'user_playlist') {
      // Synthesize multi-track radio mix for this entire queue session
      const queuedIds = new Set(tracks.map(t => t.id));
      fetchUpNextMix(tracks, get().favorites, get().playHistory, queuedIds, get().dislikedTracks, get().blockedArtists, forceRefresh)
        .then(mix => {
          if (mix && mix.length > 0 && get().queueSessionId === sessionId) {
            set({ recommendedUpNext: mix });
          }
        })
        .catch(() => {});
    } else if (allowContinuation) {
      checkAndTriggerContinuation(get, set);
    }
  },

  
  addToQueue: (track) => set((state) => {
    const occurrenceId = createQueueOccurrenceId();
    if (!state.currentTrack) {
      return {
        queue: [track],
        queueOccurrenceIds: [occurrenceId],
        shuffledQueue: [track],
        shuffledQueueOccurrenceIds: [occurrenceId],
        queueIndex: 0,
        currentTrack: track,
        playingFrom: `${track.title} Mix`,
        currentTime: 0,
        duration: track.duration || 0,
        isPlaying: true,
        toastMessage: `Playing "${track.title}"`,
        playNonce: state.playNonce + 1
      };
    }
    const newQueue = [...state.queue, track];
    const newShuffled = [...state.shuffledQueue, track];
    return { 
      queue: newQueue, 
      queueOccurrenceIds: [...state.queueOccurrenceIds, occurrenceId],
      shuffledQueue: newShuffled,
      shuffledQueueOccurrenceIds: [...state.shuffledQueueOccurrenceIds, occurrenceId],
      toastMessage: `Added "${track.title}" to Queue`
    };
  }),

  addTracksToQueue: (tracks) => set((state) => {
    const validTracks = tracks.filter(Boolean);
    if (validTracks.length === 0) return {};
    const occurrenceIds = validTracks.map(() => createQueueOccurrenceId());

    if (!state.currentTrack) {
      const [first, ...rest] = validTracks;
      const nextQueue = [first, ...rest];
      return {
        queue: nextQueue,
        queueOccurrenceIds: occurrenceIds,
        shuffledQueue: nextQueue,
        shuffledQueueOccurrenceIds: occurrenceIds,
        queueIndex: 0,
        currentTrack: first,
        playingFrom: 'Selected tracks',
        playbackContext: 'finite',
        currentTime: 0,
        duration: first.duration || 0,
        isPlaying: true,
        toastMessage: `Added ${validTracks.length} tracks to queue`,
        playNonce: state.playNonce + 1
      };
    }

    return {
      queue: [...state.queue, ...validTracks],
      queueOccurrenceIds: [...state.queueOccurrenceIds, ...occurrenceIds],
      shuffledQueue: [...state.shuffledQueue, ...validTracks],
      shuffledQueueOccurrenceIds: [...state.shuffledQueueOccurrenceIds, ...occurrenceIds],
      toastMessage: `Added ${validTracks.length} tracks to queue`
    };
  }),

  playNext: (track) => set((state) => {
    const occurrenceId = createQueueOccurrenceId();
    if (!state.currentTrack || state.queue.length === 0) {
      return {
        queue: [track],
        queueOccurrenceIds: [occurrenceId],
        shuffledQueue: [track],
        shuffledQueueOccurrenceIds: [occurrenceId],
        queueIndex: 0,
        currentTrack: track,
        playingFrom: `${track.title} Mix`,
        currentTime: 0,
        duration: track.duration || 0,
        isPlaying: true,
        toastMessage: `Playing "${track.title}"`,
        playNonce: state.playNonce + 1
      };
    }
    const insertIdx = state.queueIndex + 1;
    const newQueue = [
      ...state.queue.slice(0, insertIdx),
      track,
      ...state.queue.slice(insertIdx)
    ];
    const newShuffled = [
      ...state.shuffledQueue.slice(0, insertIdx),
      track,
      ...state.shuffledQueue.slice(insertIdx)
    ];
    const newQueueOccurrenceIds = [
      ...state.queueOccurrenceIds.slice(0, insertIdx), occurrenceId, ...state.queueOccurrenceIds.slice(insertIdx)
    ];
    const newShuffledOccurrenceIds = [
      ...state.shuffledQueueOccurrenceIds.slice(0, insertIdx), occurrenceId, ...state.shuffledQueueOccurrenceIds.slice(insertIdx)
    ];
    return { 
      queue: newQueue,
      queueOccurrenceIds: newQueueOccurrenceIds,
      shuffledQueue: newShuffled,
      shuffledQueueOccurrenceIds: newShuffledOccurrenceIds,
      toastMessage: `Playing "${track.title}" next`
    };
  }),

  removeFromQueue: (index) => set((state) => {
    const activeOccurrenceIds = state.isShuffle ? state.shuffledQueueOccurrenceIds : state.queueOccurrenceIds;
    const otherOccurrenceIds = state.isShuffle ? state.queueOccurrenceIds : state.shuffledQueueOccurrenceIds;
    const removedOccurrenceId = activeOccurrenceIds[index];
    const otherOccurrenceIndex = removedOccurrenceId ? otherOccurrenceIds.indexOf(removedOccurrenceId) : -1;
    const result = removeQueueOccurrence({
      queue: state.queue,
      shuffledQueue: state.shuffledQueue,
      isShuffle: state.isShuffle,
      queueIndex: state.queueIndex,
      currentTrack: state.currentTrack,
      currentTime: state.currentTime,
      duration: state.duration,
      isPlaying: state.isPlaying,
      playNonce: state.playNonce
    }, index);
    if (!result.removed) return {};
    return {
      queue: result.queue,
      queueOccurrenceIds: state.isShuffle
        ? (otherOccurrenceIndex >= 0 ? state.queueOccurrenceIds.filter((_, itemIndex) => itemIndex !== otherOccurrenceIndex) : state.queueOccurrenceIds)
        : state.queueOccurrenceIds.filter((_, itemIndex) => itemIndex !== index),
      shuffledQueue: result.shuffledQueue,
      shuffledQueueOccurrenceIds: state.isShuffle
        ? state.shuffledQueueOccurrenceIds.filter((_, itemIndex) => itemIndex !== index)
        : (otherOccurrenceIndex >= 0 ? state.shuffledQueueOccurrenceIds.filter((_, itemIndex) => itemIndex !== otherOccurrenceIndex) : state.shuffledQueueOccurrenceIds),
      queueIndex: result.queueIndex,
      currentTrack: result.currentTrack,
      currentTime: result.currentTime,
      duration: result.duration,
      isPlaying: result.isPlaying,
      playNonce: result.playNonce
    };
  }),

  reorderQueue: (startIndex: number, endIndex: number) => set((state) => {
    const isShuffle = state.isShuffle;
    const targetQueue = isShuffle ? [...state.shuffledQueue] : [...state.queue];
    const targetOccurrenceIds = isShuffle
      ? [...state.shuffledQueueOccurrenceIds]
      : [...state.queueOccurrenceIds];

    if (
      startIndex < 0 ||
      startIndex >= targetQueue.length ||
      endIndex < 0 ||
      endIndex >= targetQueue.length ||
      startIndex === endIndex
    ) {
      return {};
    }

    const [movedTrack] = targetQueue.splice(startIndex, 1);
    targetQueue.splice(endIndex, 0, movedTrack);
    const [movedOccurrenceId] = targetOccurrenceIds.splice(startIndex, 1);
    targetOccurrenceIds.splice(endIndex, 0, movedOccurrenceId);

    let newQueueIndex = state.queueIndex;
    if (startIndex === state.queueIndex) {
      // The currently playing track was moved
      newQueueIndex = endIndex;
    } else if (startIndex < state.queueIndex && endIndex >= state.queueIndex) {
      // Track moved from before currently playing to after
      newQueueIndex = state.queueIndex - 1;
    } else if (startIndex > state.queueIndex && endIndex <= state.queueIndex) {
      // Track moved from after currently playing to before
      newQueueIndex = state.queueIndex + 1;
    }

    if (isShuffle) {
      return { shuffledQueue: targetQueue, shuffledQueueOccurrenceIds: targetOccurrenceIds, queueIndex: newQueueIndex };
    }
    return { queue: targetQueue, queueOccurrenceIds: targetOccurrenceIds, queueIndex: newQueueIndex };
  }),
  
  playQueueIndex: (index: number) => {
    const { queue, shuffledQueue, isShuffle } = get();
    const activeQueue = isShuffle ? shuffledQueue : queue;
    if (index < 0 || index >= activeQueue.length) return;
    const track = activeQueue[index];
    set((state) => ({
      queueIndex: index,
      currentTrack: track,
      currentTime: 0,
      duration: track.duration ?? 0,
      isPlaying: true,
      playNonce: state.playNonce + 1
    }));
    checkAndTriggerContinuation(get, set);
  },

  playUpNextTrack: (track: Track, remainingUpNext: Track[], skippedFromUpNext: Track[] = []) => {
    const { queue, shuffledQueue, queueOccurrenceIds, shuffledQueueOccurrenceIds, isShuffle } = get();
    const appendedOccurrenceIds = [...skippedFromUpNext, track].map(() => createQueueOccurrenceId());
    const newQueue = [...queue, ...skippedFromUpNext, track];
    const newShuffled = isShuffle ? [...shuffledQueue, ...skippedFromUpNext, track] : newQueue;
    set((state) => ({
      queue: newQueue,
      queueOccurrenceIds: [...queueOccurrenceIds, ...appendedOccurrenceIds],
      shuffledQueue: newShuffled,
      shuffledQueueOccurrenceIds: isShuffle
        ? [...shuffledQueueOccurrenceIds, ...appendedOccurrenceIds]
        : [...queueOccurrenceIds, ...appendedOccurrenceIds],
      queueIndex: newQueue.length - 1,
      currentTrack: track,
      recommendedUpNext: remainingUpNext,
      currentTime: 0,
      duration: track.duration ?? 0,
      isPlaying: true,
      playNonce: state.playNonce + 1
    }));
  },

  nextTrack: async () => {
    const { queue, shuffledQueue, queueIndex, isShuffle, repeatMode, autoplay, recommendedUpNext, currentTrack, favorites, playHistory, playingFrom } = get();
    const activeQueue = isShuffle ? shuffledQueue : queue;
    if (activeQueue.length === 0 && !currentTrack) return;

    const canContinue = shouldAllowOnlineContinuation({
      autoplay,
      playingFrom,
      currentTrack,
      activeQueue
    });

    const nextIndex = queueIndex + 1;
    if (nextIndex < activeQueue.length) {
      set((state) => ({ queueIndex: nextIndex, currentTrack: activeQueue[nextIndex], currentTime: 0, duration: activeQueue[nextIndex].duration ?? 0, isPlaying: true, playNonce: state.playNonce + 1 }));
      if (canContinue) {
        checkAndTriggerContinuation(get, set);
      }
    } else if (repeatMode === 'all' && activeQueue.length > 0) {
      set((state) => ({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, duration: activeQueue[0].duration ?? 0, isPlaying: true, playNonce: state.playNonce + 1 }));
    } else if (canContinue) {
      // 1. If pre-fetched auto-mix exists, play immediately
      if (recommendedUpNext && recommendedUpNext.length > 0) {
        const autoTrack = recommendedUpNext[0];
        const remainingMix = recommendedUpNext.slice(1);
        const newQueue = [...queue, autoTrack];
        const newShuffled = [...shuffledQueue, autoTrack];
        const occurrenceId = createQueueOccurrenceId();
        set((state) => ({
          queue: newQueue,
          queueOccurrenceIds: [...state.queueOccurrenceIds, occurrenceId],
          shuffledQueue: newShuffled,
          shuffledQueueOccurrenceIds: [...state.shuffledQueueOccurrenceIds, occurrenceId],
          queueIndex: newQueue.length - 1,
          currentTrack: autoTrack,
          recommendedUpNext: remainingMix,
          currentTime: 0,
          duration: autoTrack.duration ?? 0,
          isPlaying: true,
          playNonce: state.playNonce + 1
        }));

        // Replenish stream in background when low (anchored to recent queue context)
        if (remainingMix.length < 5) {
          const queuedIds = new Set(newQueue.map(t => t.id));
          const recentSeeds = newQueue.slice(-4);
          fetchUpNextMix(recentSeeds, favorites, playHistory, queuedIds, get().dislikedTracks, get().blockedArtists, false)
            .then(fresh => {
              if (fresh && fresh.length > 0) {
                const existingIds = new Set([...newQueue, ...remainingMix].map(t => t.id));
                const filtered = fresh.filter(t => !existingIds.has(t.id));
                set({ recommendedUpNext: [...remainingMix, ...filtered] });
              }
            })
            .catch(() => {});
        }
        return;
      }

      // 2. If recommendedUpNext is empty, fetch on the fly from the entire active queue
      if (currentTrack) {
        try {
          const queuedIds = new Set(activeQueue.map(t => t.id));
          const seedContext = activeQueue.length > 0 ? activeQueue.slice(-4) : currentTrack;
          const freshMix = await fetchUpNextMix(seedContext, favorites, playHistory, queuedIds, get().dislikedTracks, get().blockedArtists, false);
          if (freshMix && freshMix.length > 0) {
            const autoTrack = freshMix[0];
            const remainingMix = freshMix.slice(1);
            const newQueue = [...queue, autoTrack];
            const newShuffled = [...shuffledQueue, autoTrack];
            const occurrenceId = createQueueOccurrenceId();
            set((state) => ({
              queue: newQueue,
              queueOccurrenceIds: [...state.queueOccurrenceIds, occurrenceId],
              shuffledQueue: newShuffled,
              shuffledQueueOccurrenceIds: [...state.shuffledQueueOccurrenceIds, occurrenceId],
              queueIndex: newQueue.length - 1,
              currentTrack: autoTrack,
              recommendedUpNext: remainingMix,
              currentTime: 0,
              duration: autoTrack.duration ?? 0,
              isPlaying: true,
              playNonce: state.playNonce + 1
            }));
            return;
          }
        } catch (err) {
          console.warn('Autoplay on-the-fly fetch error:', err);
        }
      }

      // If no tracks could be resolved, stop
      set({ isPlaying: false });
    } else {
      // End of queue with autoplay off OR finished local files (clean stop, no recommendations)
      set({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, duration: activeQueue[0].duration ?? 0, isPlaying: false });
    }
  },
  
  prevTrack: () => {
    const { queue, shuffledQueue, queueIndex, isShuffle, currentTime } = get();
    const activeQueue = isShuffle ? shuffledQueue : queue;
    if (activeQueue.length === 0) return;

    // If more than 3 seconds in, restart track
    if (currentTime > 3) {
      set({ currentTime: 0, isPlaying: true });
      return;
    }

    const prevIndex = (queueIndex - 1 + activeQueue.length) % activeQueue.length;
    set((state) => ({
      queueIndex: prevIndex,
      currentTrack: activeQueue[prevIndex],
      currentTime: 0,
      duration: activeQueue[prevIndex].duration ?? 0,
      isPlaying: true,
      playNonce: state.playNonce + 1
    }));
  },

  toggleShuffle: () => {
    const { isShuffle, queue, queueOccurrenceIds, currentTrack } = get();
    const newShuffle = !isShuffle;
    
    if (newShuffle) {
      const entries = queue.map((track, index) => ({ track, occurrenceId: queueOccurrenceIds[index] || createQueueOccurrenceId() }));
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [entries[i], entries[j]] = [entries[j], entries[i]];
      }
      let newIndex = 0;
      if (currentTrack) {
        const activeOccurrenceId = get().isShuffle
          ? get().shuffledQueueOccurrenceIds[get().queueIndex]
          : queueOccurrenceIds[get().queueIndex];
        const currentIdx = entries.findIndex(entry => entry.occurrenceId === activeOccurrenceId);
        if (currentIdx !== -1) {
          [entries[0], entries[currentIdx]] = [entries[currentIdx], entries[0]];
        }
      }
      set({
        isShuffle: true,
        shuffledQueue: entries.map(entry => entry.track),
        shuffledQueueOccurrenceIds: entries.map(entry => entry.occurrenceId),
        queueIndex: newIndex
      });
    } else {
      const activeOccurrenceId = get().shuffledQueueOccurrenceIds[get().queueIndex];
      const mappedIndex = activeOccurrenceId ? queueOccurrenceIds.indexOf(activeOccurrenceId) : -1;
      const originalIndex = mappedIndex >= 0
        ? mappedIndex
        : (currentTrack ? queue.findIndex(t => t.id === currentTrack.id) : 0);
      set({ isShuffle: false, queueIndex: Math.max(0, originalIndex) });
    }
  },

  toggleRepeat: () => set((state) => {
    const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
    const nextMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
    return { repeatMode: nextMode };
  }),

  toggleQueue: () => set((state) => ({ isQueueVisible: !state.isQueueVisible })),
  toggleNowPlaying: () => set((state) => ({ isNowPlayingVisible: !state.isNowPlayingVisible })),

  recordPlay: (track) => {
    if (!track || !track.id) return;
    set((state) => {
      const cleanTitle = (track.title || '').trim().toLowerCase();
      const cleanArtist = (track.artist || '').trim().toLowerCase().replace(/\s*-\s*topic$/i, '');
      
      // Find existing entry by canonical track signature
      const existingKey = Object.keys(state.playHistory || {}).find(k => {
        const item = state.playHistory[k];
        if (!item?.track) return false;
        const itemTitle = (item.track.title || '').trim().toLowerCase();
        const itemArtist = (item.track.artist || '').trim().toLowerCase().replace(/\s*-\s*topic$/i, '');
        return itemTitle === cleanTitle && (itemArtist === cleanArtist || itemArtist.includes(cleanArtist) || cleanArtist.includes(itemArtist));
      });

      const key = existingKey || track.id;
      const existing = (state.playHistory || {})[key] || { track, playCount: 0, lastPlayedAt: 0 };
      const bestTrack = (track.album && !existing.track?.album) ? track : (existing.track || track);

      return {
        playHistory: {
          ...(state.playHistory || {}),
          [key]: {
            track: bestTrack,
            playCount: existing.playCount + 1,
            lastPlayedAt: Date.now()
          }
        }
      };
    });
  },

  setActiveView: (view) => set({ activeView: view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setArtistProfile: (artistProfile) => set({ artistProfile }),
  setIsSearching: (isSearching) => set({ isSearching }),

  addRecentSearchQuery: (query: string) => {
    const qClean = query.trim();
    if (!qClean) return;
    set((state) => {
      const filtered = (state.recentSearchQueries || []).filter(
        q => q.toLowerCase() !== qClean.toLowerCase()
      );
      return {
        recentSearchQueries: [qClean, ...filtered].slice(0, 15)
      };
    });
  },

  removeRecentSearchQuery: (query: string) => {
    const qClean = query.trim().toLowerCase();
    set((state) => ({
      recentSearchQueries: (state.recentSearchQueries || []).filter(
        q => q.toLowerCase() !== qClean
      )
    }));
  },

  clearRecentSearchQueries: () => set({ recentSearchQueries: [] }),

  addRecentSearchedTrack: (track: any) => {
    if (!track || !track.id) return;
    set((state) => {
      const filtered = (state.recentSearchedTracks || []).filter(
        t => t.id !== track.id && !(t.title.toLowerCase() === track.title.toLowerCase() && t.artist.toLowerCase() === track.artist.toLowerCase())
      );
      return {
        recentSearchedTracks: [track, ...filtered].slice(0, 20)
      };
    });
  },

  removeRecentSearchedTrack: (trackId: string) => {
    set((state) => ({
      recentSearchedTracks: (state.recentSearchedTracks || []).filter(t => t.id !== trackId)
    }));
  },

  clearRecentSearchedTracks: () => set({ recentSearchedTracks: [] }),

  clearListeningHistoryAndPreferences: () => {
    // 1. Clear recommendation caches from localStorage
    const dashCacheKeys = [
      'owo_dash_rec_tracks',
      'owo_dash_rec_artist',
      'owo_dash_covers_remixes',
      'owo_dash_albums',
      'owo_dash_community',
      'owo_dash_similar',
      'owo_dash_seed_pl_name',
    ];
    dashCacheKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });

    // 2. Reset history and recommendation store state to a clean slate
    set({
      playHistory: {},
      recentSearchQueries: [],
      recentSearchedTracks: [],
      recommendedUpNext: [],
      queueSessionId: '',
      queue: [],
      queueOccurrenceIds: [],
      shuffledQueue: [],
      shuffledQueueOccurrenceIds: [],
      queueIndex: 0,
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      toastMessage: 'Listening history & recommendations cleared (Clean Slate)'
    });
  },

  markTrackNotInterested: (track: Track) => {
    const { dislikedTracks, recommendedUpNext, currentTrack, showToast } = get();
    const cleanTitle = (track.title || '').trim().toLowerCase();
    const cleanArtist = (track.artist || '').trim().toLowerCase();
    
    const exists = (dislikedTracks || []).some(
      t => t.id === track.id || (t.title.toLowerCase() === cleanTitle && t.artist.toLowerCase() === cleanArtist)
    );
    const updated = exists ? dislikedTracks : [...(dislikedTracks || []), track];

    // Instantly purge track from recommended Up Next
    const filteredUpNext = (recommendedUpNext || []).filter(
      t => t.id !== track.id && !(t.title.toLowerCase() === cleanTitle && t.artist.toLowerCase() === cleanArtist)
    );

    set({
      dislikedTracks: updated,
      recommendedUpNext: filteredUpNext
    });

    // If the marked track is currently playing, advance to next track
    if (currentTrack && (currentTrack.id === track.id || (currentTrack.title.toLowerCase() === cleanTitle && currentTrack.artist.toLowerCase() === cleanArtist))) {
      get().nextTrack();
    }

    showToast(`Got it. We won't recommend "${track.title}" again`);
  },

  unmarkTrackNotInterested: (trackId: string) => {
    set(state => ({
      dislikedTracks: (state.dislikedTracks || []).filter(t => t.id !== trackId)
    }));
    get().showToast('Removed from Not Interested list');
  },

  blockArtist: (artistName: string) => {
    const clean = artistName.trim();
    if (!clean) return;
    const { blockedArtists, recommendedUpNext, currentTrack, showToast } = get();
    const lower = clean.toLowerCase();
    const exists = (blockedArtists || []).some(a => a.toLowerCase() === lower);
    const updated = exists ? blockedArtists : [...(blockedArtists || []), clean];

    // Instantly purge all tracks by this artist from recommended Up Next
    const filteredUpNext = (recommendedUpNext || []).filter(
      t => t.artist.toLowerCase() !== lower && !t.artist.toLowerCase().includes(lower)
    );

    set({
      blockedArtists: updated,
      recommendedUpNext: filteredUpNext
    });

    // If current track is by this blocked artist, skip to next track
    if (currentTrack && (currentTrack.artist.toLowerCase() === lower || currentTrack.artist.toLowerCase().includes(lower))) {
      get().nextTrack();
    }

    showToast(`Got it. We won't recommend songs by ${clean} again`);
  },

  unblockArtist: (artistName: string) => {
    const lower = artistName.toLowerCase().trim();
    set(state => ({
      blockedArtists: (state.blockedArtists || []).filter(a => a.toLowerCase() !== lower)
    }));
    get().showToast(`Unblocked ${artistName}`);
  },

  clearDislikedAndBlocked: () => {
    set({
      dislikedTracks: [],
      blockedArtists: []
    });
    get().showToast('Cleared all blocked tracks and artists');
  },
  
  toggleFavorite: (track) => {
    const before = get().favorites;
    const isFav = before.some((item) => item.id === track.id);
    const owner = captureContextMenuAuthOwner();
    const version = favoriteOptimisticLedger.mark(track.id, owner);
    const removed = captureRemovedEntities(before, item => item.id === track.id);
    const optimisticAdded = { ...track };
    set({
      favorites: isFav
        ? before.filter(item => item.id !== track.id)
        : [...before, optimisticAdded]
    });
    void supabaseSync.syncFavoriteUp(track, !isFav).then(result => {
      if (result?.success !== false ||
          !canRollbackOptimisticMutation(favoriteOptimisticLedger, track.id, version, owner)) return;
      set(state => ({
        favorites: isFav
          ? restoreRemovedEntities(state.favorites, removed, item => item.id)
          : state.favorites.filter(item => item !== optimisticAdded),
        toastMessage: `Could not update liked songs: ${result.error || 'Sync failed'}`
      }));
    });
  },

  toggleSavePlaylist: (playlist) => {
    const state = get();
    const savedPlaylist = state.playlists.find(
      p => p.id === playlist.id || p.name.toLowerCase() === playlist.name.toLowerCase()
    );
    if (savedPlaylist) {
      const mutationId = savedPlaylist.id;
      const owner = captureContextMenuAuthOwner();
      const version = playlistOptimisticLedger.mark(mutationId, owner);
      const removedPlaylists = captureRemovedEntities(state.playlists,
        p => p.id === playlist.id || p.name.toLowerCase() === playlist.name.toLowerCase());
      const removedAlbums = captureRemovedEntities(state.savedAlbums,
        a => a.id === playlist.id || a.name.toLowerCase() === playlist.name.toLowerCase());
      set({
        playlists: state.playlists.filter(
          p => p.id !== playlist.id && p.name.toLowerCase() !== playlist.name.toLowerCase()
        ),
        savedAlbums: state.savedAlbums.filter(
          a => a.id !== playlist.id && a.name.toLowerCase() !== playlist.name.toLowerCase()
        ),
        toastMessage: `Removed "${playlist.name}" from Playlists`
      });
      void supabaseSync.syncPlaylistDelete(mutationId).then(result => {
        if (result?.success !== false ||
            !canRollbackOptimisticMutation(playlistOptimisticLedger, mutationId, version, owner)) return;
        set(current => ({
          playlists: restoreRemovedEntities(current.playlists, removedPlaylists, item => item.id),
          savedAlbums: restoreRemovedEntities(current.savedAlbums, removedAlbums, item => item.id),
          toastMessage: `Could not remove "${playlist.name}": ${result.error || 'Sync failed'}`
        }));
      });
    } else {
      const newPl: Playlist = {
        id: playlist.id || `pl-${Date.now()}`,
        name: playlist.name,
        cover: playlist.cover,
        author: playlist.author,
        tracks: playlist.tracks || [],
        createdAt: Date.now()
      };
      syncPlaylistUpTracked(newPl);
      set({
        playlists: [newPl, ...state.playlists],
        toastMessage: `Saved playlist "${playlist.name}" to Library`
      });
    }
  },

  toggleSaveAlbum: (album) => {
    const state = get();
    const isPlaylist = album.id.startsWith('PL') || album.id.startsWith('VLPL') || album.id.startsWith('community-') || album.id.startsWith('mix-') || (album.releaseDate && album.releaseDate.toLowerCase().includes('playlist')) || (album.releaseDate && album.releaseDate.toLowerCase().includes('mix'));
    if (isPlaylist) {
      const savedPlaylist = state.playlists.find(
        p => p.id === album.id || p.name.toLowerCase() === album.name.toLowerCase()
      );
      if (savedPlaylist) {
        const owner = captureContextMenuAuthOwner();
        const version = playlistOptimisticLedger.mark(savedPlaylist.id, owner);
        const removed = captureRemovedEntities(state.playlists,
          p => p.id === album.id || p.name.toLowerCase() === album.name.toLowerCase());
        set({
          playlists: state.playlists.filter(
            p => p.id !== album.id && p.name.toLowerCase() !== album.name.toLowerCase()
          ),
          toastMessage: `Removed "${album.name}" from Playlists`
        });
        void supabaseSync.syncPlaylistDelete(savedPlaylist.id).then(result => {
          if (result?.success !== false ||
              !canRollbackOptimisticMutation(playlistOptimisticLedger, savedPlaylist.id, version, owner)) return;
          set(current => ({
            playlists: restoreRemovedEntities(current.playlists, removed, item => item.id),
            toastMessage: `Could not remove "${album.name}": ${result.error || 'Sync failed'}`
          }));
        });
      } else {
        const newPl: Playlist = {
          id: album.id,
          name: album.name,
          cover: album.cover,
          author: album.artist,
          tracks: [],
          createdAt: Date.now()
        };
        syncPlaylistUpTracked(newPl);
        set({
          playlists: [newPl, ...state.playlists],
          toastMessage: `Saved playlist "${album.name}" to Library`
        });
      }
      return;
    }

    const cleanId = album.id.replace('album-', '').replace('album-derived-', '');
    const isSaved = state.savedAlbums.some(
      a => a.id === album.id || a.id.replace('album-', '') === cleanId || 
           (a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase())
    );
    if (isSaved) {
      set({
        savedAlbums: state.savedAlbums.filter(
          a => a.id !== album.id && a.id.replace('album-', '') !== cleanId && 
               !(a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase())
        ),
        toastMessage: `Removed "${album.name}" from Library`
      });
    } else {
      const newAlbum: SavedAlbum = {
        ...album,
        savedAt: Date.now(),
        lastPlayedAt: Date.now()
      };
      set({
        savedAlbums: [newAlbum, ...state.savedAlbums],
        toastMessage: `Saved "${album.name}" to Library`
      });
    }
  },

  toggleFollowArtist: (artist) => set((state) => {
    const isFollowed = state.followedArtists.some(
      a => a.name.toLowerCase() === artist.name.toLowerCase()
    );
    if (isFollowed) {
      return {
        followedArtists: state.followedArtists.filter(
          a => a.name.toLowerCase() !== artist.name.toLowerCase()
        ),
        toastMessage: `Unfollowed ${artist.name}`
      };
    } else {
      const newArtist: FollowedArtist = {
        ...artist,
        followedAt: Date.now(),
        lastPlayedAt: Date.now()
      };
      return {
        followedArtists: [newArtist, ...state.followedArtists],
        toastMessage: `Followed ${artist.name}`
      };
    }
  }),

  saveQueueAsPlaylist: (customName) => {
    const state = get();
    const tracks = [...state.queue, ...(state.recommendedUpNext || []).slice(0, 15)];
    if (tracks.length === 0) return;
    const name = customName || `${state.currentTrack?.title || state.currentTrack?.artist || 'My'} Mix`;
    const newPl: Playlist = {
      id: `pl-${Date.now()}`,
      name,
      tracks: tracks,
      createdAt: Date.now()
    };
    set({
      playlists: [...state.playlists, newPl],
      toastMessage: `Saved "${name}" to Playlists`
    });
    syncPlaylistUpTracked(newPl);
    if (tracks.some(track => !Number.isFinite(track.duration) || track.duration <= 0)) {
      void get().enrichPlaylistDurations(newPl.id);
    }
  },

  createPlaylist: (name: string) => {
    const trimmed = name.trim() || 'New Playlist';
    const newId = `pl-${Date.now()}`;
    const newPl: Playlist = {
      id: newId,
      name: trimmed,
      tracks: [],
      createdAt: Date.now()
    };
    set((state) => ({
      playlists: [newPl, ...state.playlists],
      toastMessage: `Created playlist "${trimmed}"`
    }));
    syncPlaylistUpTracked(newPl);
    return newId;
  },

  deletePlaylist: (playlistId: string) => {
    const before = get();
    const owner = captureContextMenuAuthOwner();
    const version = playlistOptimisticLedger.mark(playlistId, owner);
    const removedPlaylists = captureRemovedEntities(before.playlists, item => item.id === playlistId);
    const removedAlbums = captureRemovedEntities(before.savedAlbums,
      item => item.id === playlistId || item.id === `album-${playlistId}` || item.id === `playlist-${playlistId}`);
    set((state) => {
      const pl = state.playlists.find(p => p.id === playlistId);
      return {
        playlists: state.playlists.filter(p => p.id !== playlistId),
        savedAlbums: state.savedAlbums.filter(a => a.id !== playlistId && a.id !== `album-${playlistId}` && a.id !== `playlist-${playlistId}`),
        toastMessage: pl ? `Deleted "${pl.name}"` : 'Deleted playlist'
      };
    });
    void supabaseSync.syncPlaylistDelete(playlistId).then(result => {
      if (result?.success !== false ||
          !canRollbackOptimisticMutation(playlistOptimisticLedger, playlistId, version, owner)) return;
      set(state => ({
        playlists: restoreRemovedEntities(state.playlists, removedPlaylists, item => item.id),
        savedAlbums: restoreRemovedEntities(state.savedAlbums, removedAlbums, item => item.id),
        toastMessage: `Could not delete playlist: ${result.error || 'Sync failed'}`
      }));
    });
  },

  updatePlaylist: (playlistId, updates) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return {};
    const updatedPl: Playlist = {
      ...pl,
      name: updates.name !== undefined ? updates.name.trim() || pl.name : pl.name,
      description: updates.description !== undefined ? updates.description : pl.description,
      cover: updates.cover !== undefined ? updates.cover : pl.cover
    };
    const updated = state.playlists.map(p => p.id === playlistId ? updatedPl : p);
    syncPlaylistUpTracked(updatedPl);
    return {
      playlists: updated,
      toastMessage: `Updated "${updatedPl.name}"`
    };
  }),

  enrichPlaylistDurations: async (playlistId, trackIds) => {
    const requestedIds = trackIds ? new Set(trackIds) : null;
    const attempts = new Map<string, number>();
    const pageSize = 100;
    const maxAttemptsPerTrack = 2;
    let attempted = 0;
    let resolved = 0;
    let changedAny = false;
    let pages = 0;

    const isMissingExactRequestedTrack = (track: Track) =>
      (!requestedIds || requestedIds.has(track.id)) &&
      (!Number.isFinite(track.duration) || track.duration <= 0) &&
      Boolean(extractExactYouTubeVideoId(track));

    const initialPlaylist = get().playlists.find(item => item.id === playlistId);
    if (!initialPlaylist) return { attempted: 0, resolved: 0, remaining: 0, exhausted: false };
    const initialCandidateIds = new Set(
      initialPlaylist.tracks.filter(isMissingExactRequestedTrack).map(track => track.id)
    );
    // Each attempt needs its own full pass because the last page may be only
    // partially filled. Multiplying after rounding guarantees that every
    // initial candidate can receive every bounded attempt (for example 205
    // tracks require 3 pages per pass, not 5 pages total for two attempts).
    const maxPages = Math.ceil(initialCandidateIds.size / pageSize) * maxAttemptsPerTrack;
    const isEligibleMissingTrack = (track: Track) =>
      initialCandidateIds.has(track.id) && isMissingExactRequestedTrack(track);

    while (pages < maxPages) {
      const currentPlaylist = get().playlists.find(item => item.id === playlistId);
      if (!currentPlaylist) {
        return { attempted, resolved, remaining: 0, exhausted: false };
      }

      const candidates = currentPlaylist.tracks
        .filter(track => isEligibleMissingTrack(track) && (attempts.get(track.id) || 0) < maxAttemptsPerTrack)
        .slice(0, pageSize);
      if (candidates.length === 0) break;

      pages++;
      candidates.forEach(track => attempts.set(track.id, (attempts.get(track.id) || 0) + 1));
      attempted += candidates.length;
      const enriched = await enrichTrackDurations(candidates, {
        maxTracks: pageSize,
        concurrency: 4,
        retryFailures: candidates.some(track => (attempts.get(track.id) || 0) > 1)
      });
      const resolvedDurations = new Map(
        enriched
          .filter(track => Number.isFinite(track.duration) && track.duration > 0)
          .map(track => [track.id, track.duration] as const)
      );
      if (resolvedDurations.size === 0) continue;

      let resolvedThisPage = 0;
      set((state) => {
        const latestPlaylist = state.playlists.find(item => item.id === playlistId);
        if (!latestPlaylist) return {};

        const updatedTracks = latestPlaylist.tracks.map(track => {
          const duration = resolvedDurations.get(track.id);
          if ((!Number.isFinite(track.duration) || track.duration <= 0) && duration && duration > 0) {
            resolvedThisPage++;
            return { ...track, duration };
          }
          return track;
        });
        if (resolvedThisPage === 0) return {};

        changedAny = true;
        const updatedPlaylist: Playlist = { ...latestPlaylist, tracks: updatedTracks };
        return {
          playlists: state.playlists.map(item => item.id === playlistId ? updatedPlaylist : item)
        };
      });
      resolved += resolvedThisPage;
    }

    const latestPlaylist = get().playlists.find(item => item.id === playlistId);
    if (!latestPlaylist) return { attempted, resolved, remaining: 0, exhausted: false };
    const remaining = latestPlaylist.tracks.filter(isEligibleMissingTrack).length;

    // Persist one freshest snapshot after all pages so concurrent reorder/name/
    // description edits cannot be replaced by an older backfill snapshot.
    if (changedAny) await syncPlaylistUpTracked(latestPlaylist);
    return {
      attempted,
      resolved,
      remaining,
      exhausted: pages >= maxPages && remaining > 0
    };
  },

  removeTrackFromPlaylist: (playlistId, trackId) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return {};
    const updatedPl: Playlist = {
      ...pl,
      tracks: pl.tracks.filter(t => t.id !== trackId)
    };
    const updated = state.playlists.map(p => p.id === playlistId ? updatedPl : p);
    syncPlaylistUpTracked(updatedPl);
    return {
      playlists: updated,
      toastMessage: `Removed from "${pl.name}"`
    };
  }),

  addToPlaylist: (playlistId, track) => {
    let added = false;
    set((state) => {
      const pl = state.playlists.find(p => p.id === playlistId);
      if (!pl) return {};
      if (pl.tracks.some(t => t.id === track.id)) {
        return { toastMessage: `"${track.title}" is already in ${pl.name}` };
      }
      added = true;
      const updatedPl: Playlist = { ...pl, tracks: [...pl.tracks, track] };
      const updated = state.playlists.map(p =>
        p.id === playlistId ? updatedPl : p
      );
      syncPlaylistUpTracked(updatedPl);
      return {
        playlists: updated,
        toastMessage: `Added "${track.title}" to ${pl.name}`
      };
    });
    if (added && (!Number.isFinite(track.duration) || track.duration <= 0)) {
      void get().enrichPlaylistDurations(playlistId, [track.id]);
    }
  },

  addTracksToPlaylist: (playlistId, tracks) => {
    let addedTrackIds: string[] = [];
    set((state) => {
      const pl = state.playlists.find(p => p.id === playlistId);
      if (!pl) return {};

      const existingIds = new Set(pl.tracks.map(t => t.id));
      const additions = tracks.filter(track => {
        if (!track || existingIds.has(track.id)) return false;
        existingIds.add(track.id);
        return true;
      });
      if (additions.length === 0) {
        return { toastMessage: `Selected tracks are already in ${pl.name}` };
      }
      addedTrackIds = additions
        .filter(track => !Number.isFinite(track.duration) || track.duration <= 0)
        .map(track => track.id);

      const updatedPl: Playlist = { ...pl, tracks: [...pl.tracks, ...additions] };
      syncPlaylistUpTracked(updatedPl);
      return {
        playlists: state.playlists.map(p => p.id === playlistId ? updatedPl : p),
        toastMessage: `Added ${additions.length} tracks to ${pl.name}`
      };
    });
    if (addedTrackIds.length > 0) {
      void get().enrichPlaylistDurations(playlistId, addedTrackIds);
    }
  },

  reorderPlaylistTracks: (playlistId, startIndex, endIndex) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl || startIndex === endIndex || startIndex < 0 || endIndex < 0 || startIndex >= pl.tracks.length || endIndex >= pl.tracks.length) {
      return {};
    }

    const reordered = [...pl.tracks];
    const [moved] = reordered.splice(startIndex, 1);
    reordered.splice(endIndex, 0, moved);
    const updatedPl: Playlist = { ...pl, tracks: reordered };
    syncPlaylistUpTracked(updatedPl);

    return {
      playlists: state.playlists.map(p => p.id === playlistId ? updatedPl : p),
      toastMessage: `Updated the order of ${pl.name}`
    };
  }),

  createPlaylistWithTrack: (name, track) => {
    const newPl: Playlist = {
      id: `pl-${Date.now()}`,
      name: name.trim() || 'My Playlist',
      tracks: [track],
      createdAt: Date.now()
    };
    syncPlaylistUpTracked(newPl);
    set((state) => ({
      playlists: [...state.playlists, newPl],
      toastMessage: `Created playlist "${newPl.name}"`
    }));
    if (!Number.isFinite(track.duration) || track.duration <= 0) {
      void get().enrichPlaylistDurations(newPl.id, [track.id]);
    }
  },

  createImportedPlaylist: (playlist) => {
    const newId = `pl-${Date.now()}`;
    const newPl: Playlist = {
      id: newId,
      name: playlist.name.trim() || 'Imported Playlist',
      cover: playlist.cover,
      author: playlist.author,
      tracks: playlist.tracks || [],
      createdAt: Date.now()
    };
    set((state) => ({
      playlists: [newPl, ...state.playlists],
      toastMessage: `Imported playlist "${newPl.name}" (${newPl.tracks.length} songs)`
    }));
    syncPlaylistUpTracked(newPl);
    // Import returns immediately. Any exact-ID tracks left unresolved after the
    // import service's fast first page are drained by the bounded store pager,
    // even if the user never opens the playlist page.
    if (hasMissingExactTrackDuration(newPl.tracks)) {
      void get().enrichPlaylistDurations(newId).catch(error => {
        console.warn('[Imported Playlist Duration Backfill]:', error);
      });
    }
    return newId;
  },

  generateRadio: async (seedTrack) => {
    set({ isPlaying: false });
    try {
      const state = get();
      const mix = await fetchUpNextMix(seedTrack, state.favorites, state.playHistory, new Set(), state.dislikedTracks, state.blockedArtists, true);
      const radioQueue = [seedTrack, ...mix.filter(t => t.id !== seedTrack.id)];
      get().setQueue(radioQueue, 0, `${seedTrack.title} Mix`);
      set({ isPlaying: true });
    } catch {
      get().setQueue([seedTrack], 0, `${seedTrack.title} Mix`);
      set({ isPlaying: true });
    }
  },

  generateMultiRadio: async (seedTracks) => {
    if (seedTracks.length === 0) return;
    set({ isPlaying: false });
    
    try {
      const fetchPromises = seedTracks.slice(0, 3).map(track => 
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(track.artist)}&entity=song&limit=15`)
          .then(r => r.ok ? r.json() : { results: [] })
          .catch(() => ({ results: [] }))
      );
      
      const results = await Promise.all(fetchPromises);
      const tracks: Track[] = [];
      const seenKeys = new Set(seedTracks.map(t => `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9]/g, '')));
      
      results.forEach(data => {
        if (data.results) {
          data.results.forEach((item: any) => {
            const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              tracks.push({
                id: `track-${item.trackId}`,
                title: item.trackName,
                artist: item.artistName,
                albumArtist: item.collectionArtistName || item.artistName,
                album: item.collectionName || 'Single',
                duration: Math.round((item.trackTimeMillis || 210000) / 1000),
                cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
                streamUrl: `${item.artistName} - ${item.trackName}`,
                source: 'youtube',
                category: 'song'
              });
            }
          });
        }
      });
      
      for (let i = tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      }
      
      const radioQueue = [...seedTracks, ...tracks.slice(0, 20 - seedTracks.length)];
      get().setQueue(radioQueue, 0);
      set({ isPlaying: true });
    } catch {
      get().setQueue(seedTracks, 0);
      set({ isPlaying: true });
    }
  },

  downloadTrack: async (track: Track) => {
    const trackId = track.id;
    const downloadIdentity = getDownloadTrackIdentity(track);
    if (get().downloadedTrackIds[trackId]) {
      get().showToast(`"${track.title}" is already downloaded`);
      return true;
    }
    if (activeTrackDownloadPromises.has(downloadIdentity) || get().downloadingTrackIds[trackId] !== undefined) {
      // Already downloading! Prevent duplicate clicks
      return false;
    }

    set((state) => ({
      downloadingTrackIds: { ...state.downloadingTrackIds, [trackId]: 1 }
    }));

    const operation = (async () => {
      try {
        const record = await downloadTrackOffline(track, (progress) => {
          set((state) => ({
            downloadingTrackIds: { ...state.downloadingTrackIds, [trackId]: progress }
          }));
        });

        set((state) => {
          const nextDownloading = { ...state.downloadingTrackIds };
          delete nextDownloading[trackId];

          const existingWithoutThis = (state.offlineRecords || []).filter(r => r.id !== trackId);

          return {
            downloadingTrackIds: nextDownloading,
            offlineRecords: [...existingWithoutThis, record],
            downloadedTrackIds: {
              ...state.downloadedTrackIds,
              [trackId]: {
                downloadedAt: record.downloadedAt,
                sizeBytes: record.size,
                title: track.title,
                artist: track.artist
              }
            },
            toastMessage: `Downloaded "${track.title}" for offline playback`
          };
        });
        return true;
      } catch (err: any) {
        console.error('Download error:', err);
        set((state) => {
          const nextDownloading = { ...state.downloadingTrackIds };
          delete nextDownloading[trackId];
          return {
            downloadingTrackIds: nextDownloading,
            toastMessage: `Download failed: ${err.message || 'Network error'}`
          };
        });
        return false;
      }
    })();

    activeTrackDownloadPromises.set(downloadIdentity, operation);
    try {
      return await operation;
    } finally {
      if (activeTrackDownloadPromises.get(downloadIdentity) === operation) {
        activeTrackDownloadPromises.delete(downloadIdentity);
      }
    }
  },

  removeDownloadedTrack: async (trackId: string) => {
    try {
      await removeOfflineTrack(trackId);
      set((state) => {
        const nextDownloaded = { ...state.downloadedTrackIds };
        delete nextDownloaded[trackId];
        return {
          downloadedTrackIds: nextDownloaded,
          offlineRecords: (state.offlineRecords || []).filter(r => r.id !== trackId),
          toastMessage: 'Removed from offline downloads'
        };
      });
    } catch (err: any) {
      console.error('Remove download error:', err);
    }
  },

  downloadTrackBatch: async (tracks: Track[], albumOrPlaylistName?: string) => {
    if (!tracks || tracks.length === 0) return { successCount: 0, failCount: 0 };

    const uniqueTracks = dedupeDownloadTracks(tracks);
    const duplicateCount = tracks.length - uniqueTracks.length;
    const name = albumOrPlaylistName ? ` "${albumOrPlaylistName}"` : '';
    get().showToast(`Starting offline download for${name} (${uniqueTracks.length} songs${duplicateCount > 0 ? `, ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped` : ''})...`);

    let successCount = 0;
    let failCount = 0;
    let ownerTimeoutCount = 0;

    // Direct/temp state is isolated per track. Two workers can resolve/process
    // independently, while Electron still serializes the shared BrowserWindow
    // extraction stage to prevent cross-track capture.
    const queue = [...uniqueTracks];
    const workerCount = Math.min(2, queue.length);

    const runWorker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const identity = getDownloadTrackIdentity(item);
        const waitForOwner = () => waitForDownloadOwnerCompletion({
          isDownloaded: () => Boolean(get().downloadedTrackIds[item.id]),
          isDownloading: () => get().downloadingTrackIds[item.id] !== undefined,
          getOwnerPromise: () => activeTrackDownloadPromises.get(identity),
          timeoutMs: BATCH_OWNER_WAIT_TIMEOUT_MS
        });
        const settleJoinedOwner = async (ownerResult: 'success' | 'failed' | 'timeout') => {
          if (ownerResult === 'success') {
            successCount++;
            return;
          }
          if (ownerResult === 'timeout') {
            failCount++;
            ownerTimeoutCount++;
            return;
          }

          // The joined owner genuinely failed. Once it has unwound, allow one
          // controlled batch retry, but never compete with a newer owner.
          await Promise.resolve();
          if (activeTrackDownloadPromises.has(identity) || get().downloadingTrackIds[item.id] !== undefined) {
            const replacementResult = await waitForOwner();
            if (replacementResult === 'success') successCount++;
            else {
              failCount++;
              if (replacementResult === 'timeout') ownerTimeoutCount++;
            }
            return;
          }
          const retrySucceeded = await get().downloadTrack(item);
          if (retrySucceeded) successCount++;
          else failCount++;
        };

        const ownerAlreadyActive = activeTrackDownloadPromises.has(identity) || get().downloadingTrackIds[item.id] !== undefined;
        if (ownerAlreadyActive) {
          const ownerResult = await waitForOwner();
          await settleJoinedOwner(ownerResult);
          continue;
        }

        let ok = await get().downloadTrack(item);
        if (!ok && (activeTrackDownloadPromises.has(identity) || get().downloadingTrackIds[item.id] !== undefined)) {
          const ownerResult = await waitForOwner();
          await settleJoinedOwner(ownerResult);
          continue;
        }
        if (!ok) {
          // One retry handles transient resolver/network failures without
          // restarting tracks that already completed successfully. Recheck
          // ownership after the delay so another caller is never restarted.
          await new Promise(resolve => setTimeout(resolve, 500));
          if (activeTrackDownloadPromises.has(identity) || get().downloadingTrackIds[item.id] !== undefined) {
            const ownerResult = await waitForOwner();
            if (ownerResult === 'success') successCount++;
            else {
              failCount++;
              if (ownerResult === 'timeout') ownerTimeoutCount++;
            }
            continue;
          }
          ok = await get().downloadTrack(item);
        }
        if (ok) {
          successCount++;
        } else {
          failCount++;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    get().showToast(`Completed download:${name} (${successCount} saved${failCount > 0 ? `, ${failCount} failed${ownerTimeoutCount > 0 ? ` including ${ownerTimeoutCount} owner timeout${ownerTimeoutCount === 1 ? '' : 's'}` : ''}` : ''}${duplicateCount > 0 ? `, ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped` : ''})`);
    return { successCount, failCount };
  },

  exportTrackAudioToDisk: async (track: Track) => {
    try {
      get().showToast(`Preparing audio export for "${track.title}"...`);
      const res = await exportTrackToDisk(track);
      if (res.success) {
        get().showToast(`Saved "${track.title}" to ${res.path}`);
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Export error:', err);
      get().showToast(`Export failed: ${err.message || 'Error'}`);
      return false;
    }
  },

  syncOfflineTracks: async () => {
    try {
      const records = await getAllOfflineRecords();
      let recordsToKeep = records;
      if ((window as any).electronAPI?.getDiskAudioFiles) {
        try {
          const reconciliation = await reconcileConfiguredOfflineRecords({
            records,
            getConfiguredDirectory: getCustomDirectoryName,
            listFiles: targetDir => (window as any).electronAPI.getDiskAudioFiles(targetDir),
            removeMissing: missingRecord => removeOfflineTrack(missingRecord.id)
          });
          recordsToKeep = reconciliation.present;
        } catch (reconErr) {
          console.warn('Reconcile offline records failed, falling back to cached records:', reconErr);
          recordsToKeep = records;
          const stage = (reconErr as { stage?: string })?.stage;
          const msg = stage
            ? `Could not verify downloads (${stage}). Existing offline records were preserved.`
            : 'Could not verify downloads. Existing offline records were preserved.';

          const now = Date.now();
          if (now - lastSyncToastTime > 15000 || lastSyncToastMsg !== msg) {
            lastSyncToastTime = now;
            lastSyncToastMsg = msg;
            get().showToast(msg);
          }
        }
      }

      const map: Record<string, { downloadedAt: number; sizeBytes?: number; title?: string; artist?: string }> = {};
      for (const r of recordsToKeep) {
        map[r.id] = {
          downloadedAt: r.downloadedAt,
          sizeBytes: r.size,
          title: r.track?.title,
          artist: r.track?.artist
        };
      }

      // Check for actual data changes to avoid object identity churn in Zustand
      const currentMap = get().downloadedTrackIds || {};
      const currentRecords = get().offlineRecords || [];
      const mapKeys = Object.keys(map);
      const currentKeys = Object.keys(currentMap);

      let hasChanged = mapKeys.length !== currentKeys.length || recordsToKeep.length !== currentRecords.length;
      if (!hasChanged) {
        for (const k of mapKeys) {
          if (!currentMap[k] || currentMap[k].downloadedAt !== map[k].downloadedAt || currentMap[k].sizeBytes !== map[k].sizeBytes) {
            hasChanged = true;
            break;
          }
        }
      }

      if (hasChanged) {
        set({ downloadedTrackIds: map, offlineRecords: recordsToKeep });
      }
    } catch (e) {
      console.warn('Sync offline tracks failed:', e);
      const stage = (e as { stage?: string })?.stage;
      const msg = stage
        ? `Could not verify downloads (${stage}). Existing offline records were preserved.`
        : 'Could not verify downloads. Existing offline records were preserved.';

      const now = Date.now();
      if (now - lastSyncToastTime > 15000 || lastSyncToastMsg !== msg) {
        lastSyncToastTime = now;
        lastSyncToastMsg = msg;
        get().showToast(msg);
      }
    }
  },

  toggleOfflineOnly: () => set((state) => ({ isOfflineOnly: !state.isOfflineOnly })),

  clearAllDownloads: async () => {
    try {
      await clearAllOfflineStorage();
      set({ downloadedTrackIds: {}, offlineRecords: [], toastMessage: 'Cleared all offline downloads' });
    } catch (e) {
      console.error('Clear downloads failed:', e);
    }
  }
    }),
    {
      name: 'owo-music-player-storage',
      partialize: (state) => ({
        favorites: state.favorites,
        playlists: state.playlists,
        savedAlbums: state.savedAlbums,
        followedArtists: state.followedArtists,
        volume: state.volume,
        autoplay: state.autoplay,
        isShuffle: state.isShuffle,
        repeatMode: state.repeatMode,
        queue: state.queue,
        queueOccurrenceIds: state.queueOccurrenceIds,
        shuffledQueue: state.shuffledQueue,
        shuffledQueueOccurrenceIds: state.shuffledQueueOccurrenceIds,
        playHistory: state.playHistory,
        recentSearchQueries: state.recentSearchQueries,
        recentSearchedTracks: state.recentSearchedTracks,
        dislikedTracks: state.dislikedTracks,
        blockedArtists: state.blockedArtists,
        downloadedTrackIds: state.downloadedTrackIds,
        isOfflineOnly: state.isOfflineOnly,
        useRotatingCD: state.useRotatingCD
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!Array.isArray(state.queueOccurrenceIds) || state.queueOccurrenceIds.length !== state.queue.length) {
          state.queueOccurrenceIds = state.queue.map(() => createQueueOccurrenceId());
        }
        if (!Array.isArray(state.shuffledQueue) || state.shuffledQueue.length === 0) {
          state.shuffledQueue = [...state.queue];
        }
        if (!Array.isArray(state.shuffledQueueOccurrenceIds) ||
            state.shuffledQueueOccurrenceIds.length !== state.shuffledQueue.length) {
          state.shuffledQueueOccurrenceIds = state.shuffledQueue.length === state.queue.length
            ? [...state.queueOccurrenceIds]
            : state.shuffledQueue.map(() => createQueueOccurrenceId());
        }
        // Clean migration: Ensure savedAlbums strictly contains official albums, never playlists
        const currentSavedAlbums = state.savedAlbums || [];
        state.savedAlbums = currentSavedAlbums.filter(item => {
          const isPlaylist = item.id.startsWith('PL') || item.id.startsWith('VLPL') || item.id.startsWith('community-') || item.id.startsWith('mix-') || (item.releaseDate && item.releaseDate.toLowerCase().includes('playlist')) || (item.releaseDate && item.releaseDate.toLowerCase().includes('mix'));
          return !isPlaylist;
        });
      }
    }
  )
);
