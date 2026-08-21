import { useState, type FormEvent } from 'react';
import { Check, Download, ListMusic, ListPlus, Plus, X } from 'lucide-react';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Track } from '../../types';

interface BulkTrackActionsProps {
  tracks: Track[];
  onClear: () => void;
  onRemove?: () => void;
  hideQueueAction?: boolean;
}

export function BulkTrackActions({ tracks, onClear, onRemove, hideQueueAction = false }: BulkTrackActionsProps) {
  const {
    playlists,
    addTracksToQueue,
    addTracksToPlaylist,
    createPlaylist,
    downloadTrackBatch
  } = usePlayerStore();
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  if (tracks.length === 0) return null;

  const saveToPlaylist = (playlistId: string) => {
    addTracksToPlaylist(playlistId, tracks);
    setShowPlaylistPicker(false);
    onClear();
  };

  const createAndSave = (e: FormEvent) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    const playlistId = createPlaylist(name);
    addTracksToPlaylist(playlistId, tracks);
    setNewPlaylistName('');
    setShowPlaylistPicker(false);
    onClear();
  };

  return (
    <div className="bulk-track-toolbar" role="toolbar" aria-label="Selected track actions">
      <div className="bulk-track-count">
        <Check size={15} />
        <span>{tracks.length} selected</span>
      </div>

      {!hideQueueAction && (
        <button
          type="button"
          className="bulk-track-action"
          onClick={() => {
            addTracksToQueue(tracks);
            onClear();
          }}
        >
          <ListMusic size={15} />
          <span>Add to queue</span>
        </button>
      )}

      <div className="bulk-playlist-picker-wrap">
        <button
          type="button"
          className={`bulk-track-action ${showPlaylistPicker ? 'active' : ''}`}
          onClick={() => setShowPlaylistPicker(open => !open)}
        >
          <ListPlus size={15} />
          <span>Add to playlist</span>
        </button>

        {showPlaylistPicker && (
          <div className="bulk-playlist-picker">
            <div className="bulk-picker-title">Choose a playlist</div>
            <div className="bulk-picker-list">
              {playlists.map(playlist => (
                <button key={playlist.id} type="button" onClick={() => saveToPlaylist(playlist.id)}>
                  <span>{playlist.name}</span>
                  <small>{playlist.tracks.length} tracks</small>
                </button>
              ))}
              {playlists.length === 0 && <div className="bulk-picker-empty">No playlists yet</div>}
            </div>
            <form onSubmit={createAndSave} className="bulk-picker-create">
              <input
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
                placeholder="New playlist name"
              />
              <button type="submit" title="Create playlist and add selected tracks">
                <Plus size={15} />
              </button>
            </form>
          </div>
        )}
      </div>

      <button
        type="button"
        className="bulk-track-action"
        onClick={() => {
          void downloadTrackBatch(tracks, 'Selected tracks');
          onClear();
        }}
      >
        <Download size={15} />
        <span>Download</span>
      </button>

      {onRemove && (
        <button type="button" className="bulk-track-action danger" onClick={onRemove}>
          <X size={15} />
          <span>Remove</span>
        </button>
      )}

      <button type="button" className="bulk-clear-action" onClick={onClear} title="Clear selection">
        <X size={16} />
      </button>
    </div>
  );
}
