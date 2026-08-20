import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track, Playlist, ViewType, ArtistProfile, SavedAlbum, FollowedArtist } from '../types';
import { fetchUpNextMix } from '../services/musicSearch';
import { 
  downloadTrackOffline, 
  removeOfflineTrack, 
  getAllOfflineRecords, 
  clearAllOfflineStorage,
  exportTrackToDisk 
} from '../services/downloadService';
import { supabaseSync } from '../services/supabaseSyncService';

export type PlaybackContextType = 'radio' | 'finite' | 'user_playlist';

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
  removeFromQueue: (index: number) => void;
  reorderQueue: (startIndex: number, endIndex: number) => void;
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
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
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
    queueSessionId 
  } = get();

  if (!autoplay) return;
  if (isFetchingContinuation) return;

  const activeQueue = isShuffle ? shuffledQueue : queue;
  if (activeQueue.length === 0) return;

  // Local tracks must NEVER trigger online mix continuation
  if (currentTrack?.isLocal || currentTrack?.id?.startsWith('local-') || activeQueue.some(t => t.isLocal || t.id?.startsWith('local-'))) {
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
        set((state) => ({
          queue: [...state.queue, ...uniqueNewTracks],
          shuffledQueue: [...state.shuffledQueue, ...uniqueNewTracks]
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
    const isLocalTrack = track.isLocal || track.id?.startsWith('local-');
    const context = isLocalTrack ? (track.album || 'Local Files') : `${track.title} Mix`;
    const sessionId = `qs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newContextType = isLocalTrack ? 'user_playlist' : (contextType !== undefined ? contextType : 'radio');
    set((state) => ({ 
      currentTrack: track, 
      currentTime: 0, 
      duration: track.duration || 0,
      isPlaying: true, 
      playingFrom: context,
      playbackContext: newContextType,
      queueSessionId: sessionId,
      queue: [track],
      shuffledQueue: [track],
      queueIndex: 0,
      recommendedUpNext: [],
      isPlayerDrawerOpen: true,
      playNonce: state.playNonce + 1
    }));

    if (!isLocalTrack && newContextType !== 'user_playlist') {
      // Synthesize mix anchored to this seed track
      fetchUpNextMix([track], get().favorites, get().playHistory, new Set([track.id]), get().dislikedTracks, get().blockedArtists, forceRefresh)
        .then(mix => {
          if (mix && mix.length > 0 && get().queueSessionId === sessionId) {
            set({ recommendedUpNext: mix });
          }
        })
        .catch(() => {});
    } else if (!isLocalTrack) {
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
      if (state.currentTrack && state.currentTrack.duration !== rounded) {
        updatedTrack = { ...state.currentTrack, duration: rounded };
        updatedQueue = state.queue.map((t, i) => i === state.queueIndex ? updatedTrack! : t);
        updatedShuffled = state.shuffledQueue.map((t, i) => i === state.queueIndex ? updatedTrack! : t);
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
    let shuffled = [...tracks];
    let newIndex = initialIndex;
    
    if (isShuffle) {
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const selectedTrack = tracks[initialIndex];
      const selectedIdx = shuffled.findIndex(t => t.id === selectedTrack?.id);
      if (selectedIdx !== -1) {
        [shuffled[0], shuffled[selectedIdx]] = [shuffled[selectedIdx], shuffled[0]];
      }
      newIndex = 0;
    }

    const cur = isShuffle ? shuffled[newIndex] : tracks[newIndex];
    const isLocalQueue = tracks.every(t => t.isLocal || t.id?.startsWith('local-')) || (cur?.isLocal || cur?.id?.startsWith('local-'));
    const sourceContext = playingFrom || (isLocalQueue ? 'Local Files' : (cur ? `${cur.title} Mix` : 'Queue'));
    const sessionId = `qs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const resolvedContextType = isLocalQueue ? 'user_playlist' : (contextType !== undefined ? contextType : (
      playingFrom && (playingFrom.endsWith('Mix') || playingFrom.includes('Discover') || playingFrom.includes('Radio') || playingFrom.includes('Supermix'))
        ? 'radio'
        : 'finite'
    ));

    set((state) => ({
      queue: tracks,
      shuffledQueue: shuffled,
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

    if (!isLocalQueue && resolvedContextType !== 'user_playlist') {
      // Synthesize multi-track radio mix for this entire queue session
      const queuedIds = new Set(tracks.map(t => t.id));
      fetchUpNextMix(tracks, get().favorites, get().playHistory, queuedIds, get().dislikedTracks, get().blockedArtists, forceRefresh)
        .then(mix => {
          if (mix && mix.length > 0 && get().queueSessionId === sessionId) {
            set({ recommendedUpNext: mix });
          }
        })
        .catch(() => {});
    } else if (!isLocalQueue) {
      checkAndTriggerContinuation(get, set);
    }
  },

  
  addToQueue: (track) => set((state) => {
    if (!state.currentTrack) {
      return {
        queue: [track],
        shuffledQueue: [track],
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
      shuffledQueue: newShuffled,
      toastMessage: `Added "${track.title}" to Queue`
    };
  }),

  playNext: (track) => set((state) => {
    if (!state.currentTrack || state.queue.length === 0) {
      return {
        queue: [track],
        shuffledQueue: [track],
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
    return { 
      queue: newQueue,
      shuffledQueue: newShuffled,
      toastMessage: `Playing "${track.title}" next`
    };
  }),

  removeFromQueue: (index) => set((state) => {
    const newQueue = state.queue.filter((_, i) => i !== index);
    const newShuffled = state.shuffledQueue.filter((_, i) => i !== index);
    let newIndex = state.queueIndex;
    if (index < state.queueIndex) {
      newIndex = Math.max(0, state.queueIndex - 1);
    }
    return { queue: newQueue, shuffledQueue: newShuffled, queueIndex: newIndex };
  }),

  reorderQueue: (startIndex: number, endIndex: number) => set((state) => {
    const isShuffle = state.isShuffle;
    const targetQueue = isShuffle ? [...state.shuffledQueue] : [...state.queue];

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
      return { shuffledQueue: targetQueue, queueIndex: newQueueIndex };
    }
    return { queue: targetQueue, queueIndex: newQueueIndex };
  }),
  
  nextTrack: async () => {
    const { queue, shuffledQueue, queueIndex, isShuffle, repeatMode, autoplay, recommendedUpNext, currentTrack, favorites, playHistory } = get();
    const activeQueue = isShuffle ? shuffledQueue : queue;
    if (activeQueue.length === 0 && !currentTrack) return;

    const nextIndex = queueIndex + 1;
    if (nextIndex < activeQueue.length) {
      set((state) => ({ queueIndex: nextIndex, currentTrack: activeQueue[nextIndex], currentTime: 0, duration: activeQueue[nextIndex].duration || 0, isPlaying: true, playNonce: state.playNonce + 1 }));
      checkAndTriggerContinuation(get, set);
    } else if (repeatMode === 'all' && activeQueue.length > 0) {
      set((state) => ({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, duration: activeQueue[0].duration || 0, isPlaying: true, playNonce: state.playNonce + 1 }));
    } else if (autoplay && !currentTrack?.isLocal && !currentTrack?.id?.startsWith('local-') && !activeQueue.some(t => t.isLocal || t.id?.startsWith('local-'))) {
      // 1. If pre-fetched auto-mix exists, play immediately
      if (recommendedUpNext && recommendedUpNext.length > 0) {
        const autoTrack = recommendedUpNext[0];
        const remainingMix = recommendedUpNext.slice(1);
        const newQueue = [...queue, autoTrack];
        const newShuffled = [...shuffledQueue, autoTrack];
        set((state) => ({
          queue: newQueue,
          shuffledQueue: newShuffled,
          queueIndex: newQueue.length - 1,
          currentTrack: autoTrack,
          recommendedUpNext: remainingMix,
          currentTime: 0,
          duration: autoTrack.duration || 0,
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
            set((state) => ({
              queue: newQueue,
              shuffledQueue: newShuffled,
              queueIndex: newQueue.length - 1,
              currentTrack: autoTrack,
              recommendedUpNext: remainingMix,
              currentTime: 0,
              duration: autoTrack.duration || 0,
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
      set({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, duration: activeQueue[0].duration || 0, isPlaying: false });
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
      duration: activeQueue[prevIndex].duration || 0,
      isPlaying: true,
      playNonce: state.playNonce + 1
    }));
  },

  toggleShuffle: () => {
    const { isShuffle, queue, currentTrack } = get();
    const newShuffle = !isShuffle;
    
    if (newShuffle) {
      let shuffled = [...queue];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let newIndex = 0;
      if (currentTrack) {
        const currentIdx = shuffled.findIndex(t => t.id === currentTrack.id);
        if (currentIdx !== -1) {
          [shuffled[0], shuffled[currentIdx]] = [shuffled[currentIdx], shuffled[0]];
        }
      }
      set({ isShuffle: true, shuffledQueue: shuffled, queueIndex: newIndex });
    } else {
      const originalIndex = currentTrack ? queue.findIndex(t => t.id === currentTrack.id) : 0;
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
      shuffledQueue: [],
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
  
  toggleFavorite: (track) => set((state) => {
    const isFav = state.favorites.some((t) => t.id === track.id);
    const newFavorites = isFav 
      ? state.favorites.filter((t) => t.id !== track.id)
      : [...state.favorites, { ...track, savedAt: Date.now() }];
    
    // Trigger background cloud sync
    supabaseSync.syncFavoriteUp(track, !isFav);

    return { favorites: newFavorites };
  }),

  toggleSavePlaylist: (playlist) => set((state) => {
    const isSaved = state.playlists.some(
      p => p.id === playlist.id || p.name.toLowerCase() === playlist.name.toLowerCase()
    );
    if (isSaved) {
      supabaseSync.syncPlaylistDelete(playlist.id);
      return {
        playlists: state.playlists.filter(
          p => p.id !== playlist.id && p.name.toLowerCase() !== playlist.name.toLowerCase()
        ),
        savedAlbums: state.savedAlbums.filter(
          a => a.id !== playlist.id && a.name.toLowerCase() !== playlist.name.toLowerCase()
        ),
        toastMessage: `Removed "${playlist.name}" from Playlists`
      };
    } else {
      const newPl: Playlist = {
        id: playlist.id || `pl-${Date.now()}`,
        name: playlist.name,
        cover: playlist.cover,
        author: playlist.author,
        tracks: playlist.tracks || [],
        createdAt: Date.now()
      };
      supabaseSync.syncPlaylistUp(newPl);
      return {
        playlists: [newPl, ...state.playlists],
        toastMessage: `Saved playlist "${playlist.name}" to Library`
      };
    }
  }),

  toggleSaveAlbum: (album) => set((state) => {
    const isPlaylist = album.id.startsWith('PL') || album.id.startsWith('VLPL') || album.id.startsWith('community-') || album.id.startsWith('mix-') || (album.releaseDate && album.releaseDate.toLowerCase().includes('playlist')) || (album.releaseDate && album.releaseDate.toLowerCase().includes('mix'));
    if (isPlaylist) {
      const isSavedPl = state.playlists.some(
        p => p.id === album.id || p.name.toLowerCase() === album.name.toLowerCase()
      );
      if (isSavedPl) {
        return {
          playlists: state.playlists.filter(
            p => p.id !== album.id && p.name.toLowerCase() !== album.name.toLowerCase()
          ),
          toastMessage: `Removed "${album.name}" from Playlists`
        };
      } else {
        const newPl: Playlist = {
          id: album.id,
          name: album.name,
          cover: album.cover,
          author: album.artist,
          tracks: [],
          createdAt: Date.now()
        };
        supabaseSync.syncPlaylistUp(newPl);
        return {
          playlists: [newPl, ...state.playlists],
          toastMessage: `Saved playlist "${album.name}" to Library`
        };
      }
    }

    const cleanId = album.id.replace('album-', '').replace('album-derived-', '');
    const isSaved = state.savedAlbums.some(
      a => a.id === album.id || a.id.replace('album-', '') === cleanId || 
           (a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase())
    );
    if (isSaved) {
      return {
        savedAlbums: state.savedAlbums.filter(
          a => a.id !== album.id && a.id.replace('album-', '') !== cleanId && 
               !(a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase())
        ),
        toastMessage: `Removed "${album.name}" from Library`
      };
    } else {
      const newAlbum: SavedAlbum = {
        ...album,
        savedAt: Date.now(),
        lastPlayedAt: Date.now()
      };
      return {
        savedAlbums: [newAlbum, ...state.savedAlbums],
        toastMessage: `Saved "${album.name}" to Library`
      };
    }
  }),

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
    supabaseSync.syncPlaylistUp(newPl);
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
    supabaseSync.syncPlaylistUp(newPl);
    return newId;
  },

  deletePlaylist: (playlistId: string) => {
    set((state) => {
      const pl = state.playlists.find(p => p.id === playlistId);
      return {
        playlists: state.playlists.filter(p => p.id !== playlistId),
        savedAlbums: state.savedAlbums.filter(a => a.id !== playlistId && a.id !== `album-${playlistId}` && a.id !== `playlist-${playlistId}`),
        toastMessage: pl ? `Deleted "${pl.name}"` : 'Deleted playlist'
      };
    });
    supabaseSync.syncPlaylistDelete(playlistId);
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
    supabaseSync.syncPlaylistUp(updatedPl);
    return {
      playlists: updated,
      toastMessage: `Updated "${updatedPl.name}"`
    };
  }),

  removeTrackFromPlaylist: (playlistId, trackId) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return {};
    const updatedPl: Playlist = {
      ...pl,
      tracks: pl.tracks.filter(t => t.id !== trackId)
    };
    const updated = state.playlists.map(p => p.id === playlistId ? updatedPl : p);
    supabaseSync.syncPlaylistUp(updatedPl);
    return {
      playlists: updated,
      toastMessage: `Removed from "${pl.name}"`
    };
  }),

  addToPlaylist: (playlistId, track) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return {};
    if (pl.tracks.some(t => t.id === track.id)) {
      return { toastMessage: `"${track.title}" is already in ${pl.name}` };
    }
    const updatedPl: Playlist = { ...pl, tracks: [...pl.tracks, track] };
    const updated = state.playlists.map(p => 
      p.id === playlistId ? updatedPl : p
    );
    supabaseSync.syncPlaylistUp(updatedPl);
    return {
      playlists: updated,
      toastMessage: `Added "${track.title}" to ${pl.name}`
    };
  }),

  createPlaylistWithTrack: (name, track) => set((state) => {
    const newPl: Playlist = {
      id: `pl-${Date.now()}`,
      name: name.trim() || 'My Playlist',
      tracks: [track],
      createdAt: Date.now()
    };
    supabaseSync.syncPlaylistUp(newPl);
    return {
      playlists: [...state.playlists, newPl],
      toastMessage: `Created playlist "${newPl.name}"`
    };
  }),

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
    supabaseSync.syncPlaylistUp(newPl);
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
    if (get().downloadedTrackIds[trackId]) {
      get().showToast(`"${track.title}" is already downloaded`);
      return true;
    }
    if (get().downloadingTrackIds[trackId] !== undefined) {
      // Already downloading! Prevent duplicate clicks
      return false;
    }

    set((state) => ({
      downloadingTrackIds: { ...state.downloadingTrackIds, [trackId]: 1 }
    }));

    try {
      const record = await downloadTrackOffline(track, (progress) => {
        set((state) => ({
          downloadingTrackIds: { ...state.downloadingTrackIds, [trackId]: progress }
        }));
      });

      set((state) => {
        const nextDownloading = { ...state.downloadingTrackIds };
        delete nextDownloading[trackId];

        return {
          downloadingTrackIds: nextDownloading,
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
  },

  removeDownloadedTrack: async (trackId: string) => {
    try {
      await removeOfflineTrack(trackId);
      set((state) => {
        const nextDownloaded = { ...state.downloadedTrackIds };
        delete nextDownloaded[trackId];
        return {
          downloadedTrackIds: nextDownloaded,
          toastMessage: 'Removed from offline downloads'
        };
      });
    } catch (err: any) {
      console.error('Remove download error:', err);
    }
  },

  downloadTrackBatch: async (tracks: Track[], albumOrPlaylistName?: string) => {
    if (!tracks || tracks.length === 0) return { successCount: 0, failCount: 0 };

    const name = albumOrPlaylistName ? ` "${albumOrPlaylistName}"` : '';
    get().showToast(`Starting offline download for${name} (${tracks.length} songs)...`);

    let successCount = 0;
    let failCount = 0;

    // Concurrency limit: 2 tracks at a time
    const queue = [...tracks];
    const workerCount = Math.min(2, queue.length);

    const runWorker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const ok = await get().downloadTrack(item);
        if (ok) {
          successCount++;
        } else {
          failCount++;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    get().showToast(`Completed download:${name} (${successCount} saved${failCount > 0 ? `, ${failCount} failed` : ''})`);
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
      let diskFiles: string[] | null = null;
      if ((window as any).electronAPI?.getDiskAudioFiles) {
        diskFiles = await (window as any).electronAPI.getDiskAudioFiles();
      }

      const map: Record<string, { downloadedAt: number; sizeBytes?: number; title?: string; artist?: string }> = {};
      for (const r of records) {
        // If in Electron, verify the physical file is still present in the Music folder
        if (diskFiles !== null) {
          const cleanArtistStr = (r.track?.artist || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
          const cleanTitleStr = (r.track?.title || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
          
          const existsOnDisk = diskFiles.some(f => 
            (f.includes(cleanTitleStr) && f.includes(cleanArtistStr)) ||
            f.startsWith(`${cleanArtistStr} - ${cleanTitleStr}`)
          );

          if (!existsOnDisk) {
            // File was deleted from disk! Clean up from IndexedDB
            await removeOfflineTrack(r.id);
            continue;
          }
        }
        map[r.id] = {
          downloadedAt: r.downloadedAt,
          sizeBytes: r.size,
          title: r.track?.title,
          artist: r.track?.artist
        };
      }
      set({ downloadedTrackIds: map });
    } catch (e) {
      console.warn('Sync offline tracks failed:', e);
    }
  },

  toggleOfflineOnly: () => set((state) => ({ isOfflineOnly: !state.isOfflineOnly })),

  clearAllDownloads: async () => {
    try {
      await clearAllOfflineStorage();
      set({ downloadedTrackIds: {}, toastMessage: 'Cleared all offline downloads' });
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
