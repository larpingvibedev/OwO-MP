import React, { useState, useRef, useEffect } from 'react';
import { 
  MoreVertical, Radio, ListPlus, Plus, Heart, FolderPlus, 
  User, Disc, Info, Share2, Check, ExternalLink, Music2,
  Trash2, X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Track } from '../../types';

interface TrackOptionsMenuProps {
  track: Track;
  variant?: 'row' | 'card' | 'player-bar' | 'icon';
  onRemoveFromQueue?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const TrackOptionsMenu: React.FC<TrackOptionsMenuProps> = ({
  track,
  variant = 'row',
  onRemoveFromQueue,
  className = '',
  style
}) => {
  const navigate = useNavigate();
  const {
    favorites,
    playlists,
    toggleFavorite,
    addToQueue,
    playNext,
    addToPlaylist,
    createPlaylistWithTrack,
    generateRadio,
    showToast
  } = usePlayerStore();

  const [isOpen, setIsOpen] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isFav = favorites.some(f => f.id === track.id);

  // Calculate smart menu coordinates when opened
  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 240;
      const menuHeight = 420;

      let left = rect.right - menuWidth;
      let top = rect.bottom + 6;

      // Prevent clipping right
      if (left + menuWidth > window.innerWidth - 12) {
        left = window.innerWidth - menuWidth - 12;
      }
      // Prevent clipping left
      if (left < 12) {
        left = 12;
      }
      // If near bottom, flip menu upwards
      if (top + menuHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - menuHeight - 6);
      }

      setMenuCoords({ top, left });
      setShowPlaylistPicker(false);
    }
    setIsOpen(!isOpen);
  };

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (
        menuRef.current && 
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setShowPlaylistPicker(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setShowPlaylistPicker(false);
        setShowDetailsModal(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleStartMix = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    generateRadio(track);
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    playNext(track);
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    addToQueue(track);
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(track);
    showToast(isFav ? `Removed from Liked Songs` : `Added to Liked Songs`);
  };

  const handleGoToArtist = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
  };

  const handleGoToAlbum = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    if (track.album) {
      navigate(`/album/${encodeURIComponent(track.album)}`);
    } else {
      navigate(`/artist/${encodeURIComponent(track.artist)}`);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    const shareText = track.streamUrl || `https://music.youtube.com/watch?v=${track.id}`;
    navigator.clipboard.writeText(shareText);
    showToast('Link copied to clipboard!');
  };

  const handleOpenDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    setShowDetailsModal(true);
  };

  const handleSaveToPlaylist = (playlistId: string) => {
    addToPlaylist(playlistId, track);
    setShowPlaylistPicker(false);
    setIsOpen(false);
  };

  const handleCreateNewPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlaylistName.trim()) {
      createPlaylistWithTrack(newPlaylistName.trim(), track);
      setNewPlaylistName('');
      setShowPlaylistPicker(false);
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* 3-Dots Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        className={`track-menu-trigger-btn ${isOpen ? 'active' : ''} ${className}`}
        onClick={toggleMenu}
        title="More options"
        style={{
          background: variant === 'card' ? 'rgba(0, 0, 0, 0.65)' : 'none',
          border: variant === 'card' ? '1px solid rgba(255, 255, 255, 0.15)' : 'none',
          borderRadius: '50%',
          width: variant === 'card' ? '30px' : '28px',
          height: variant === 'card' ? '30px' : '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: isOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
          transition: 'all 0.15s ease',
          padding: 0,
          flexShrink: 0,
          ...style
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <MoreVertical size={16} />
      </button>

      {/* Floating Glassmorphic Context Menu Overlay */}
      {isOpen && (
        <div
          ref={menuRef}
          className="track-options-dropdown"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${menuCoords.top}px`,
            left: `${menuCoords.left}px`,
            width: '240px',
            backgroundColor: '#18181c',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '12px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            zIndex: 99999,
            padding: '6px 0',
            backdropFilter: 'blur(24px)',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          {/* Header Preview of Selected Track */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 14px 10px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div 
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '6px',
                backgroundImage: `url(${track.cover})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                flexShrink: 0
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontWeight: 700,
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {track.title}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: '1px'
              }}>
                {track.artist}
              </div>
            </div>
          </div>

          {/* Regular Menu Options */}
          {!showPlaylistPicker ? (
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
              {/* 1. Start Mix */}
              <button className="track-menu-item" onClick={handleStartMix}>
                <Radio size={16} />
                <span>Start mix</span>
              </button>

              {/* 2. Play Next */}
              <button className="track-menu-item" onClick={handlePlayNext}>
                <ListPlus size={16} />
                <span>Play next</span>
              </button>

              {/* 3. Add to Queue */}
              <button className="track-menu-item" onClick={handleAddToQueue}>
                <Plus size={16} />
                <span>Add to queue</span>
              </button>

              {/* 4. Add to / Remove from Liked Songs */}
              <button className="track-menu-item" onClick={handleToggleFavorite}>
                <Heart size={16} fill={isFav ? 'var(--accent-primary)' : 'none'} color={isFav ? 'var(--accent-primary)' : 'currentColor'} />
                <span>{isFav ? 'Remove from liked songs' : 'Add to liked songs'}</span>
              </button>

              {/* 5. Save to Playlist */}
              <button className="track-menu-item" onClick={() => setShowPlaylistPicker(true)}>
                <FolderPlus size={16} />
                <span>Save to playlist</span>
              </button>

              {/* 6. Remove from Queue (if in queue drawer) */}
              {onRemoveFromQueue && (
                <button className="track-menu-item" onClick={() => { setIsOpen(false); onRemoveFromQueue(); }}>
                  <Trash2 size={16} color="#e74c3c" />
                  <span style={{ color: '#e74c3c' }}>Remove from queue</span>
                </button>
              )}

              <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

              {/* 7. Go to Artist */}
              <button className="track-menu-item" onClick={handleGoToArtist}>
                <User size={16} />
                <span>Go to artist</span>
              </button>

              {/* 8. Go to Album */}
              <button className="track-menu-item" onClick={handleGoToAlbum}>
                <Disc size={16} />
                <span>Go to album</span>
              </button>

              {/* 9. View Song Credits & Details */}
              <button className="track-menu-item" onClick={handleOpenDetails}>
                <Info size={16} />
                <span>View song credits</span>
              </button>

              {/* 10. Share */}
              <button className="track-menu-item" onClick={handleShare}>
                <Share2 size={16} />
                <span>Share</span>
              </button>
            </div>
          ) : (
            /* Sub-Menu: Save to Playlist */
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Save to Playlist
                </span>
                <button
                  onClick={() => setShowPlaylistPicker(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Existing Playlists */}
              <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {playlists.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '6px 0', fontStyle: 'italic' }}>
                    No playlists created yet
                  </div>
                ) : (
                  playlists.map(pl => {
                    const hasTrack = pl.tracks.some(t => t.id === track.id);
                    return (
                      <button
                        key={pl.id}
                        onClick={() => handleSaveToPlaylist(pl.id)}
                        className="track-menu-item"
                        style={{ padding: '6px 8px', borderRadius: '6px' }}
                      >
                        <Music2 size={14} />
                        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {pl.name}
                        </span>
                        {hasTrack && <Check size={12} color="var(--accent-primary)" />}
                      </button>
                    );
                  })
                )}
              </div>

              <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

              {/* Create New Playlist Inline Form */}
              <form onSubmit={handleCreateNewPlaylist} style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  placeholder="New playlist name..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '0.75rem',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim()}
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    color: '#000',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: newPlaylistName.trim() ? 'pointer' : 'default',
                    opacity: newPlaylistName.trim() ? 1 : 0.5
                  }}
                >
                  Save
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Song Details Modal */}
      {showDetailsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            padding: '20px'
          }}
          onClick={() => setShowDetailsModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Song Credits & Details</h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <img
                src={track.cover}
                alt={track.title}
                style={{ width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{track.title}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '2px' }}>{track.artist}</div>
                {track.album && <div style={{ color: 'var(--accent-primary)', fontSize: '0.8rem', marginTop: '2px' }}>Album: {track.album}</div>}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Track Title</span>
                <span style={{ fontWeight: 600 }}>{track.title}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Primary Artist</span>
                <span style={{ fontWeight: 600 }}>{track.artist}</span>
              </div>
              {track.albumArtist && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Album Artist</span>
                  <span style={{ fontWeight: 600 }}>{track.albumArtist}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                <span style={{ fontWeight: 600 }}>{track.duration ? `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}` : '--:--'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Audio Quality</span>
                <span style={{ fontWeight: 600, color: '#2ecc71' }}>Lossless Opus 160kbps (HQ)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Engine Source</span>
                <span style={{ fontWeight: 600 }}>{track.source === 'youtube' ? 'YouTube Music Core' : 'Direct Audio Engine'}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {track.streamUrl && (
                <a
                  href={track.streamUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <span>Open on YouTube</span>
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
