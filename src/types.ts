export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string | number;
  albumArtist?: string;
  album?: string;
  albumId?: string;
  duration: number; // in seconds
  cover: string;
  streamUrl: string;
  resolvedStreamUrl?: string;
  source?: 'youtube' | 'piped' | 'itunes' | 'soundcloud' | 'jamendo' | 'demo';
  category?: 'song' | 'video' | 'artist' | 'playlist';
  channelId?: string;
}

export interface Playlist {
  id: string;
  name: string;
  cover?: string;
  tracks: Track[];
  createdAt?: number;
}

export interface PublicPlaylist {
  id: string;
  name: string;
  author: string;
  cover: string;
  trackCount: number;
  source: 'youtube' | 'curated' | 'community';
  playlistId?: string;
  channelId?: string;
  description?: string;
  tracks?: Track[];
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId?: string | number;
  cover: string;
  releaseDate?: string;
  channelId?: string;
}

export interface AlbumDetail {
  id: string;
  name: string;
  artist: string;
  artistId?: string | number;
  cover: string;
  releaseDate?: string;
  tracks: Track[];
  channelId?: string;
}

export interface ArtistProfile {
  name: string;
  artistId?: string | number;
  cover: string;
  banner?: string;
  topTracks: Track[];
  albums: Album[];
  singlesAndEPs: Album[];
  appearsOn?: Album[];
  similarArtists?: SimilarArtist[];
  channelId?: string;
}

export interface SimilarArtist {
  name: string;
  artistId?: string | number;
  channelId?: string;
  cover: string;
}

export interface SuggestionEntity {
  type: 'artist' | 'song' | 'album' | 'playlist';
  title: string;
  subtitle: string;
  thumbnail?: string;
  browseId?: string;
  videoId?: string;
  artist?: string;
}

export interface SearchSuggestionsResult {
  textSuggestions: string[];
  entitySuggestions: SuggestionEntity[];
}

export type ViewType = 'dashboard' | 'discover' | 'albums' | 'playlists' | 'downloads' | 'settings';
export type SearchCategory = 'all' | 'songs' | 'videos' | 'playlists';
