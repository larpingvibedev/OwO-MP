export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // in seconds
  cover: string;
  streamUrl: string;
  source?: 'youtube' | 'soundcloud' | 'demo';
}

export interface Playlist {
  id: string;
  name: string;
  cover?: string;
  tracks: Track[];
}

export type ViewType = 'dashboard' | 'discover' | 'albums' | 'playlists' | 'downloads' | 'settings';
