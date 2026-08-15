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
  recommendReason?: string;
  playCountText?: string;
}

export interface Playlist {
  id: string;
  name: string;
  cover?: string;
  author?: string;
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

export interface SavedAlbum {
  id: string;
  name: string;
  artist: string;
  artistId?: string | number;
  cover: string;
  releaseDate?: string;
  trackCount?: number;
  savedAt: number;
  lastPlayedAt?: number;
}

export interface FollowedArtist {
  name: string;
  cover: string;
  subscriberCount?: string;
  channelId?: string;
  artistId?: string | number;
  followedAt: number;
  lastPlayedAt?: number;
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

export type ViewType = 'dashboard' | 'discover' | 'library' | 'albums' | 'playlists' | 'downloads' | 'settings';
export type LibraryFilterType = 'all' | 'playlists' | 'songs' | 'albums' | 'artists' | 'downloads';
export type SearchCategory = 'all' | 'songs' | 'videos' | 'playlists';

export interface DownloadedTrackMeta {
  track: Track;
  downloadedAt: number;
  sizeBytes?: number;
  mimeType?: string;
}

export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'error';

