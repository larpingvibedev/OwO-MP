import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track, Playlist, ViewType, ArtistProfile } from '../types';
import { fetchUpNextMix } from '../services/musicSearch';

interface PlayerState {
  // Current track & playback
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  
  // Queue management
  queue: Track[];
  queueIndex: number;
  
  // Navigation & Search
  activeView: ViewType;
  searchQuery: string;
  searchResults: Track[];
  artistProfile: ArtistProfile | null;
  isSearching: boolean;
  
  // Theme & Appearance
  theme: 'default' | 'rusty';
  rustyColor: 'green' | 'amber' | 'cyan' | 'rust';
  
  // Library
  playlists: Playlist[];
  favorites: Track[];
  
  // YouTube Music Style Up Next & Drawer State
  autoplay: boolean;
  playingFrom: string;
  recommendedUpNext: Track[];
  activePlayerTab: 'up_next' | 'lyrics' | 'related';
  isPlayerDrawerOpen: boolean;
  
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

  // Toast Notifications
  toastMessage: string | null;
  showToast: (message: string) => void;
  hideToast: () => void;

  // Actions
  setTheme: (theme: 'default' | 'rusty') => void;
  setRustyColor: (color: 'green' | 'amber' | 'cyan' | 'rust') => void;
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  togglePlayPause: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  
  setQueue: (tracks: Track[], initialIndex?: number, playingFrom?: string) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  
  toggleAutoplay: () => void;
  setPlayingFrom: (source: string) => void;
  setRecommendedUpNext: (tracks: Track[]) => void;
  setActivePlayerTab: (tab: 'up_next' | 'lyrics' | 'related') => void;
  openPlayerDrawer: (tab?: 'up_next' | 'lyrics' | 'related') => void;
  closePlayerDrawer: () => void;
  togglePlayerDrawer: (tab?: 'up_next' | 'lyrics' | 'related') => void;

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
  
  toggleFavorite: (track: Track) => void;
  playNext: (track: Track) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  createPlaylistWithTrack: (name: string, track: Track) => void;
  saveQueueAsPlaylist: (customName?: string) => void;
  generateRadio: (seedTrack: Track) => Promise<void>;
  generateMultiRadio: (seedTracks: Track[]) => Promise<void>;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  
  queue: [],
  queueIndex: 0,
  
  autoplay: true,
  playingFrom: 'Auto Mix',
  recommendedUpNext: [],
  activePlayerTab: 'up_next',
  isPlayerDrawerOpen: false,

  activeView: 'dashboard',
  searchQuery: '',
  searchResults: [],
  artistProfile: null,
  isSearching: false,
  
  recentSearchQueries: [],
  recentSearchedTracks: [],

  theme: 'default',
  rustyColor: 'green',
  
  playlists: [],
  favorites: [],

  isShuffle: false,
  repeatMode: 'off',
  shuffledQueue: [],
  isQueueVisible: false,
  isNowPlayingVisible: false,
  playHistory: {},
  
  toastMessage: null,
  showToast: (message: string) => set({ toastMessage: message }),
  hideToast: () => set({ toastMessage: null }),

  setTheme: (theme) => set({ theme }),
  setRustyColor: (rustyColor) => set({ rustyColor }),
  setCurrentTrack: (track) => {
    const context = `${track.title} Mix`;
    set({ 
      currentTrack: track, 
      currentTime: 0, 
      duration: track.duration || 0,
      isPlaying: true, 
      playingFrom: context,
      queue: [track],
      shuffledQueue: [track],
      queueIndex: 0
    });
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

  setQueue: (tracks, initialIndex = 0, playingFrom) => {
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
    const sourceContext = playingFrom || (cur ? `${cur.title} Mix` : 'Queue');

    set({
      queue: tracks,
      shuffledQueue: shuffled,
      queueIndex: newIndex,
      currentTrack: cur,
      playingFrom: sourceContext,
      currentTime: 0,
      duration: cur?.duration || 0,
      isPlaying: true
    });
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
        isPlaying: true,
        toastMessage: `Playing "${track.title}"`
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
        isPlaying: true,
        toastMessage: `Playing "${track.title}"`
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
  
  nextTrack: async () => {
    const { queue, shuffledQueue, queueIndex, isShuffle, repeatMode, autoplay, recommendedUpNext, currentTrack, favorites, playHistory } = get();
    const activeQueue = isShuffle ? shuffledQueue : queue;
    if (activeQueue.length === 0 && !currentTrack) return;

    const nextIndex = queueIndex + 1;
    if (nextIndex < activeQueue.length) {
      set({ queueIndex: nextIndex, currentTrack: activeQueue[nextIndex], currentTime: 0, isPlaying: true });
    } else if (repeatMode === 'all' && activeQueue.length > 0) {
      set({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, isPlaying: true });
    } else if (autoplay) {
      // 1. If pre-fetched auto-mix exists, play immediately
      if (recommendedUpNext && recommendedUpNext.length > 0) {
        const autoTrack = recommendedUpNext[0];
        const remainingMix = recommendedUpNext.slice(1);
        const newQueue = [...queue, autoTrack];
        const newShuffled = [...shuffledQueue, autoTrack];
        set({
          queue: newQueue,
          shuffledQueue: newShuffled,
          queueIndex: newQueue.length - 1,
          currentTrack: autoTrack,
          recommendedUpNext: remainingMix,
          currentTime: 0,
          isPlaying: true
        });

        // Replenish stream in background when low
        if (remainingMix.length < 5) {
          const queuedIds = new Set(newQueue.map(t => t.id));
          fetchUpNextMix(autoTrack, favorites, playHistory, queuedIds)
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

      // 2. If recommendedUpNext is empty, fetch on the fly instantly
      if (currentTrack) {
        try {
          const queuedIds = new Set(activeQueue.map(t => t.id));
          const freshMix = await fetchUpNextMix(currentTrack, favorites, playHistory, queuedIds);
          if (freshMix && freshMix.length > 0) {
            const autoTrack = freshMix[0];
            const remainingMix = freshMix.slice(1);
            const newQueue = [...queue, autoTrack];
            const newShuffled = [...shuffledQueue, autoTrack];
            set({
              queue: newQueue,
              shuffledQueue: newShuffled,
              queueIndex: newQueue.length - 1,
              currentTrack: autoTrack,
              recommendedUpNext: remainingMix,
              currentTime: 0,
              isPlaying: true
            });
            return;
          }
        } catch (err) {
          console.warn('Autoplay on-the-fly fetch error:', err);
        }
      }

      // If no tracks could be resolved, stop
      set({ isPlaying: false });
    } else {
      // End of queue with autoplay off
      set({ queueIndex: 0, currentTrack: activeQueue[0], currentTime: 0, isPlaying: false });
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
    set({
      queueIndex: prevIndex,
      currentTrack: activeQueue[prevIndex],
      currentTime: 0,
      isPlaying: true
    });
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
      const existing = state.playHistory[track.id] || { track, playCount: 0, lastPlayedAt: 0 };
      return {
        playHistory: {
          ...state.playHistory,
          [track.id]: {
            track,
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
  
  toggleFavorite: (track) => set((state) => {
    const isFav = state.favorites.some((t) => t.id === track.id);
    return {
      favorites: isFav 
        ? state.favorites.filter((t) => t.id !== track.id)
        : [...state.favorites, track]
    };
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
  },

  addToPlaylist: (playlistId, track) => set((state) => {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return {};
    if (pl.tracks.some(t => t.id === track.id)) {
      return { toastMessage: `"${track.title}" is already in ${pl.name}` };
    }
    const updated = state.playlists.map(p => 
      p.id === playlistId ? { ...p, tracks: [...p.tracks, track] } : p
    );
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
    return {
      playlists: [...state.playlists, newPl],
      toastMessage: `Created playlist "${newPl.name}"`
    };
  }),

  generateRadio: async (seedTrack) => {
    set({ isPlaying: false });
    try {
      const state = get();
      const mix = await fetchUpNextMix(seedTrack, state.favorites, state.playHistory);
      const radioQueue = [seedTrack, ...mix.filter(t => t.id !== seedTrack.id)];
      get().setQueue(radioQueue, 0, `${seedTrack.artist} Radio`);
      set({ isPlaying: true });
    } catch (e) {
      get().setQueue([seedTrack], 0);
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
    } catch (e) {
      get().setQueue(seedTracks, 0);
      set({ isPlaying: true });
    }
  }
    }),
    {
      name: 'owo-music-player-storage',
      partialize: (state) => ({
        theme: state.theme,
        rustyColor: state.rustyColor,
        favorites: state.favorites,
        playlists: state.playlists,
        volume: state.volume,
        autoplay: state.autoplay,
        isShuffle: state.isShuffle,
        repeatMode: state.repeatMode,
        queue: state.queue,
        playHistory: state.playHistory,
        recentSearchQueries: state.recentSearchQueries,
        recentSearchedTracks: state.recentSearchedTracks
      })
    }
  )
);
