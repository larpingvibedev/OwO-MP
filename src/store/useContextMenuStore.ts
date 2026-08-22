import { create } from 'zustand';
import type { Track } from '../types';
import {
  captureContextMenuAuthOwner,
  type ContextMenuAuthOwner
} from '../services/contextMenuAuthOwnership';

export type ContextMenuType = 'track' | 'playlist' | 'album';

export interface ContextMenuTrackData {
  track: Track;
  onRemoveFromQueue?: () => void;
  onRemoveFromPlaylist?: () => void;
  onDeleteFromPC?: () => void;
  onShowInExplorer?: () => void;
}

export interface ContextMenuPlaylistData {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  author?: string;
  tracks?: Track[];
}

export interface ContextMenuAlbumData {
  id: string;
  name: string;
  artist: string;
  cover?: string;
  releaseDate?: string;
  tracks?: Track[];
  artistId?: string | number;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: ContextMenuType | null;
  trackData: ContextMenuTrackData | null;
  playlistData: ContextMenuPlaylistData | null;
  albumData: ContextMenuAlbumData | null;
  authOwner: ContextMenuAuthOwner | null;

  openTrackContextMenu: (
    e: React.MouseEvent | MouseEvent,
    track: Track,
    options?: { 
      onRemoveFromQueue?: () => void; 
      onRemoveFromPlaylist?: () => void;
      onDeleteFromPC?: () => void;
      onShowInExplorer?: () => void;
    }
  ) => void;

  openPlaylistContextMenu: (
    e: React.MouseEvent | MouseEvent,
    playlist: ContextMenuPlaylistData
  ) => void;

  openAlbumContextMenu: (
    e: React.MouseEvent | MouseEvent,
    album: ContextMenuAlbumData
  ) => void;

  closeContextMenu: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  x: 0,
  y: 0,
  type: null,
  trackData: null,
  playlistData: null,
  albumData: null,
  authOwner: null,

  openTrackContextMenu: (e, track, options) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    set({
      isOpen: true,
      x: clientX,
      y: clientY,
      type: 'track',
      trackData: { track, ...options },
      playlistData: null,
      albumData: null,
      authOwner: captureContextMenuAuthOwner()
    });
  },

  openPlaylistContextMenu: (e, playlist) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    set({
      isOpen: true,
      x: clientX,
      y: clientY,
      type: 'playlist',
      trackData: null,
      playlistData: playlist,
      albumData: null,
      authOwner: captureContextMenuAuthOwner()
    });
  },

  openAlbumContextMenu: (e, album) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    set({
      isOpen: true,
      x: clientX,
      y: clientY,
      type: 'album',
      trackData: null,
      playlistData: null,
      albumData: album,
      authOwner: captureContextMenuAuthOwner()
    });
  },

  closeContextMenu: () => set({
    isOpen: false,
    type: null,
    trackData: null,
    playlistData: null,
    albumData: null,
    authOwner: null
  })
}));
