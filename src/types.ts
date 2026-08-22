export type TrackSource = 'youtube' | 'local' | 'piped' | 'itunes' | 'soundcloud' | 'jamendo' | 'demo';

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
  source?: TrackSource;
  category?: 'song' | 'video' | 'artist' | 'playlist';
  channelId?: string;
  videoId?: string;
  recommendReason?: string;
  playCountText?: string;
  
  // Canonical State
  isDownloaded?: boolean;
  
  // Backwards-compatibility fields for persisted data
  isLocal?: boolean;
  isAppDownload?: boolean;
  downloadRecordId?: string;
  
  // Local PC Media Properties
  filePath?: string;
  fileName?: string;
  folderPath?: string;
  folder?: string;
  sizeBytes?: number;
  ext?: string;
  bitrate?: number;
  sampleRate?: number;
  // Unique Instance ID for list rendering & duplicate-safe DnD/selection
  _uid?: string;
}

/** Returns a stable list-instance ID for a track */
export function getTrackInstanceId(track: Track, fallbackIndex?: number): string {
  if (track._uid) return track._uid;
  if (fallbackIndex !== undefined) return `${track.id || track.streamUrl || 'item'}_idx_${fallbackIndex}`;
  return track.id || track.streamUrl || 'track_item';
}

/** Ensures a track has a unique instance ID for playlist/queue persistence */
export function ensureTrackInstanceId(track: Track): Track {
  if (track._uid) return track;
  return {
    ...track,
    _uid: `${track.id || 'track'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  };
}

/** Determines if a track represents physical local PC media */
export function isLocalTrack(track?: Track | null): boolean {
  if (!track) return false;
  return track.source === 'local' || Boolean(track.isLocal) || Boolean(track.id?.startsWith('local-')) || Boolean(track.filePath);
}

/** Determines if an online catalog track is cached offline */
export function isDownloadedTrack(track?: Track | null): boolean {
  if (!track) return false;
  return Boolean(track.isDownloaded || track.isAppDownload);
}

/** Determines if a track has official online artist identity */
export function canGoToArtist(track?: Track | null): boolean {
  if (!track) return false;
  if (isLocalTrack(track)) return false;
  return Boolean(track.artistId || track.channelId || (track.artist && !track.artist.toLowerCase().includes('unknown')));
}

/** Determines if a track can be deleted from physical PC storage */
export function canDeleteFromDisk(track?: Track | null): boolean {
  if (!track) return false;
  return isLocalTrack(track) && Boolean(track.filePath);
}

/** Determines if a track's offline cached download can be removed */
export function canRemoveDownload(track?: Track | null): boolean {
  if (!track) return false;
  return isDownloadedTrack(track) && !isLocalTrack(track);
}

/** Normalizes a track to guarantee canonical source and download status */
export function normalizeTrack(track: Track): Track {
  if (!track) return track;
  const isLocal = isLocalTrack(track);
  const isDownloaded = isDownloadedTrack(track);
  return {
    ...track,
    source: isLocal ? 'local' : (track.source || 'youtube'),
    isLocal,
    isDownloaded
  };
}


export interface LocalPlaylistMetadata {
  coverId?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  coverId?: string;
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
  coverId?: string;
  description?: string;
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

export type ViewType = 'dashboard' | 'discover' | 'library' | 'albums' | 'playlists' | 'local' | 'downloads' | 'settings';
export type LibraryFilterType = 'all' | 'playlists' | 'songs' | 'albums' | 'artists' | 'local' | 'downloads';
export type SearchCategory = 'all' | 'songs' | 'videos' | 'playlists';

export interface DownloadedTrackMeta {
  track: Track;
  downloadedAt: number;
  sizeBytes?: number;
  mimeType?: string;
}

export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'error';

