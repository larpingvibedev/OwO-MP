import React, { useState, useRef, useEffect } from 'react';
import { 
  ListPlus, 
  ListMusic, 
  FolderPlus, 
  Download, 
  Trash2, 
  X, 
  ChevronDown 
} from 'lucide-react';
import { useSelectionStore } from '../../store/useSelectionStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { isLocalTrack } from '../../types';

export const BulkTrackActionBar: React.FC = () => {
  const { selectedItemIds, getSelectedTracks, clearSelection, contextId } = useSelectionStore();
  const { 
    playTracksNext, 
    addTracksToQueue, 
    addTracksToPlaylist, 
    removeTracksFromPlaylist, 
    downloadTrackBatch, 
    playlists,
    showToast 
  } = usePlayerStore();

  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close playlist menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowPlaylistMenu(false);
      }
    };
    if (showPlaylistMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPlaylistMenu]);

  const count = selectedItemIds.size;
  if (count === 0) return null;

  const selectedTracks = getSelectedTracks();
  const isPlaylistContext = contextId?.startsWith('playlist-') || false;
  const currentPlaylistId = isPlaylistContext ? contextId?.replace('playlist-', '') : null;

  // Calculate download eligibility (only online tracks not already marked downloaded)
  const eligibleDownloadTracks = selectedTracks.filter(t => !isLocalTrack(t) && !t.isDownloaded);

  const handlePlayNext = () => {
    if (selectedTracks.length === 0) return;
    playTracksNext(selectedTracks);
    clearSelection();
  };

  const handleAddToQueue = () => {
    if (selectedTracks.length === 0) return;
    addTracksToQueue(selectedTracks);
    clearSelection();
  };

  const handleAddToPlaylist = (playlistId: string) => {
    if (selectedTracks.length === 0) return;
    addTracksToPlaylist(playlistId, selectedTracks);
    setShowPlaylistMenu(false);
    clearSelection();
  };

  const handleDownload = async () => {
    if (eligibleDownloadTracks.length === 0) {
      showToast('All selected tracks are already downloaded or local');
      return;
    }
    clearSelection();
    await downloadTrackBatch(eligibleDownloadTracks, 'Bulk Selection');
  };

  const handleRemoveFromPlaylist = () => {
    if (!currentPlaylistId || selectedTracks.length === 0) return;
    const itemIds = Array.from(selectedItemIds);
    removeTracksFromPlaylist(currentPlaylistId, itemIds);
    clearSelection();
  };

  return (
    <aside 
      className="bulk-action-bar" 
      aria-label="Bulk selection actions"
      role="toolbar"
    >
      {/* Selected Count Indicator */}
      <div className="bulk-count-badge">
        <span className="bulk-count-num">{count}</span>
        <span className="bulk-count-label">{count === 1 ? 'track selected' : 'tracks selected'}</span>
      </div>

      <div className="bulk-action-divider" />

      {/* Action Buttons */}
      <div className="bulk-action-buttons">
        <button 
          onClick={handlePlayNext} 
          className="bulk-action-btn"
          title="Play selected tracks next"
        >
          <ListPlus size={16} />
          <span>Play Next</span>
        </button>

        <button 
          onClick={handleAddToQueue} 
          className="bulk-action-btn"
          title="Add selected tracks to queue"
        >
          <ListMusic size={16} />
          <span>Add to Queue</span>
        </button>

        {/* Add to Playlist with Dropdown */}
        <div className="bulk-playlist-wrapper" ref={menuRef}>
          <button 
            onClick={() => setShowPlaylistMenu(!showPlaylistMenu)} 
            className={`bulk-action-btn ${showPlaylistMenu ? 'active' : ''}`}
            title="Add to a playlist"
          >
            <FolderPlus size={16} />
            <span>Add to Playlist</span>
            <ChevronDown size={14} className={`bulk-chevron ${showPlaylistMenu ? 'open' : ''}`} />
          </button>

          {showPlaylistMenu && (
            <div className="bulk-playlist-dropdown">
              <div className="bulk-dropdown-header">Select Playlist</div>
              <div className="bulk-dropdown-list">
                {playlists.length === 0 ? (
                  <div className="bulk-dropdown-empty">No playlists created</div>
                ) : (
                  playlists.map(pl => (
                    <button 
                      key={pl.id}
                      onClick={() => handleAddToPlaylist(pl.id)}
                      className="bulk-dropdown-item"
                    >
                      <span className="bulk-dropdown-pl-name">{pl.name}</span>
                      <span className="bulk-dropdown-pl-count">{pl.tracks.length} tracks</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Download Button */}
        <button 
          onClick={handleDownload} 
          className={`bulk-action-btn ${eligibleDownloadTracks.length === 0 ? 'disabled' : ''}`}
          title={
            eligibleDownloadTracks.length === 0 
              ? 'Selected tracks already downloaded' 
              : `Download ${eligibleDownloadTracks.length} eligible ${eligibleDownloadTracks.length === 1 ? 'track' : 'tracks'}`
          }
        >
          <Download size={16} />
          <span>
            Download
            {eligibleDownloadTracks.length > 0 && eligibleDownloadTracks.length < count && (
              <span className="bulk-sub-badge"> ({eligibleDownloadTracks.length})</span>
            )}
          </span>
        </button>

        {/* Remove from current playlist */}
        {isPlaylistContext && currentPlaylistId && (
          <button 
            onClick={handleRemoveFromPlaylist} 
            className="bulk-action-btn danger"
            title="Remove selected tracks from this playlist"
          >
            <Trash2 size={16} />
            <span>Remove</span>
          </button>
        )}
      </div>

      <div className="bulk-action-divider" />

      {/* Dismiss Button */}
      <button 
        onClick={clearSelection} 
        className="bulk-close-btn"
        title="Clear selection (Esc)"
        aria-label="Clear selection"
      >
        <X size={16} />
      </button>
    </aside>
  );
};
