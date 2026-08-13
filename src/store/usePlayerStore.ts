import { create } from 'zustand';
import type { Track, Playlist, ViewType } from '../types';

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
  isSearching: boolean;
  
  // Library
  playlists: Playlist[];
  favorites: Track[];
  
  // Actions
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  togglePlayPause: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  
  setQueue: (tracks: Track[], initialIndex?: number) => void;
  addToQueue: (track: Track) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  
  setActiveView: (view: ViewType) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Track[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  
  toggleFavorite: (track: Track) => void;
}

// Sample initial tracks for demonstration
const SAMPLE_TRACKS: Track[] = [
  {
    id: '1',
    title: 'Instant Crush',
    artist: 'Daft Punk ft. Julian Casablancas',
    album: 'Random Access Memories',
    duration: 337,
    cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=500&q=80',
    streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    source: 'demo'
  },
  {
    id: '2',
    title: 'Feels Like We Only Go Backwards',
    artist: 'Tame Impala',
    album: 'Lonerism',
    duration: 193,
    cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&q=80',
    streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    source: 'demo'
  },
  {
    id: '3',
    title: 'Starboy',
    artist: 'The Weeknd ft. Daft Punk',
    album: 'Starboy',
    duration: 230,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
    streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    source: 'demo'
  }
];

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: SAMPLE_TRACKS[0],
  isPlaying: false,
  currentTime: 0,
  duration: 337,
  volume: 0.8,
  
  queue: SAMPLE_TRACKS,
  queueIndex: 0,
  
  activeView: 'dashboard',
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  
  playlists: [
    {
      id: 'p1',
      name: 'Cyberpunk Synthwave',
      tracks: SAMPLE_TRACKS
    }
  ],
  favorites: [],
  
  setCurrentTrack: (track) => set({ currentTrack: track, currentTime: 0 }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  
  setQueue: (tracks, initialIndex = 0) => set({
    queue: tracks,
    queueIndex: initialIndex,
    currentTrack: tracks[initialIndex] || null,
    currentTime: 0
  }),
  
  addToQueue: (track) => set((state) => ({
    queue: [...state.queue, track]
  })),
  
  nextTrack: () => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) return;
    const nextIndex = (queueIndex + 1) % queue.length;
    set({
      queueIndex: nextIndex,
      currentTrack: queue[nextIndex],
      currentTime: 0
    });
  },
  
  prevTrack: () => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) return;
    const prevIndex = (queueIndex - 1 + queue.length) % queue.length;
    set({
      queueIndex: prevIndex,
      currentTrack: queue[prevIndex],
      currentTime: 0
    });
  },
  
  setActiveView: (view) => set({ activeView: view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setIsSearching: (isSearching) => set({ isSearching }),
  
  toggleFavorite: (track) => set((state) => {
    const isFav = state.favorites.some((t) => t.id === track.id);
    return {
      favorites: isFav 
        ? state.favorites.filter((t) => t.id !== track.id)
        : [...state.favorites, track]
    };
  })
}));
