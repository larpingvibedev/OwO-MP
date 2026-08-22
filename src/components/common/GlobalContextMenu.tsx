import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Play, Shuffle, Radio, ListPlus, Plus, Heart, FolderPlus, 
  User, Disc, Info, Share2, Music2,
  Trash2, X, Download, Loader2, HardDrive, Pencil, Check,
  Ban, UserX, ExternalLink
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useContextMenuStore } from '../../store/useContextMenuStore';
import { isLocalTrack, canGoToArtist } from '../../types';

export const GlobalContextMenu: React.FC = () => {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    isOpen,
    x,
    y,
    type,
    trackData,
    playlistData,
    albumData,
    closeContextMenu
  } = useContextMenuStore();

  const {
    favorites,
    playlists,
    savedAlbums,
    downloadedTrackIds,
    downloadingTrackIds,
    downloadTrack,
    downloadTrackBatch,
    removeDownloadedTrack,
    toggleFavorite,
    addToQueue,
    playNext,
    setQueue,
    setIsPlaying,
    addToPlaylist,
    createPlaylistWithTrack,
    updatePlaylist,
    deletePlaylist,
    toggleSaveAlbum,
    generateRadio,
    markTrackNotInterested,
    blockArtist,
    showToast,
    closePlayerDrawer
  } = usePlayerStore();

  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditPlaylistModal, setShowEditPlaylistModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  // Edit Playlist Modal State
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCover, setEditCover] = useState('');

  // Calculate smart coordinates relative to viewport synchronously on every render
  const menuWidth = 250;
  let left = x;
  if (typeof window !== 'undefined') {
    if (left + menuWidth > window.innerWidth - 12) {
      left = window.innerWidth - menuWidth - 12;
    }
    if (left < 12) left = 12;
  }

  const estimatedMenuHeight = 390;
  const windowH = typeof window !== 'undefined' ? window.innerHeight : 800;

  let top: number;
  let maxHeight: number;

  // Check if menu fits completely downwards
  if (y + estimatedMenuHeight <= windowH - 16) {
    top = Math.max(12, y);
    maxHeight = windowH - top - 16;
  } 
  // Check if menu fits completely upwards
  else if (y - estimatedMenuHeight >= 12) {
    top = Math.max(12, y - estimatedMenuHeight);
    maxHeight = estimatedMenuHeight;
  } 
  // If it doesn't fully fit in either single direction, center/clamp intelligently:
  else {
    top = Math.max(12, Math.min(y - (estimatedMenuHeight / 2), windowH - estimatedMenuHeight - 16));
    maxHeight = windowH - top - 16;
  }

  const pos = { top, left, maxHeight: Math.max(180, maxHeight) };

  // Reset submenu state synchronously before paint whenever a new menu opens
  useLayoutEffect(() => {
    if (isOpen) {
      setShowPlaylistPicker(false);
    }
  }, [isOpen, x, y]);

  // Click outside, scroll, resize, key handlers
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        setShowDetailsModal(false);
        setShowEditPlaylistModal(false);
      }
    };

    const handleScroll = (e: Event) => {
      // If the scroll happened inside the context menu itself, DO NOT dismiss the menu!
      if (menuRef.current && (e.target === menuRef.current || menuRef.current.contains(e.target as Node))) {
        return;
      }
      closeContextMenu();
    };

    const handleResize = () => {
      closeContextMenu();
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, closeContextMenu]);

  if (!isOpen && !showDetailsModal && !showEditPlaylistModal) return null;

  // -------------------------------------------------------------
  // TRACK CONTEXT MENU HANDLERS
  // -------------------------------------------------------------
  const track = trackData?.track;
  const isFav = track ? favorites.some(f => f.id === track.id) : false;
  const isDownloaded = track ? Boolean(downloadedTrackIds[track.id]) : false;
  const downloadProgress = track ? downloadingTrackIds[track.id] : undefined;

  const handleStartMix = () => {
    if (!track) return;
    closeContextMenu();
    generateRadio(track);
    showToast(`Started mix for ${track.title}`);
  };

  const handlePlayNext = () => {
    if (!track) return;
    closeContextMenu();
    playNext(track);
  };

  const handleAddToQueue = () => {
    if (!track) return;
    closeContextMenu();
    addToQueue(track);
  };

  const handleToggleFavorite = () => {
    if (!track) return;
    toggleFavorite(track);
    showToast(isFav ? `Removed from Liked Songs` : `Added to Liked Songs`);
  };

  const handleGoToArtist = () => {
    if (!track) return;
    closeContextMenu();
    closePlayerDrawer();
    navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
  };

  const handleGoToAlbum = () => {
    if (!track) return;
    closeContextMenu();
    closePlayerDrawer();
    const rawAlb = track.album?.trim();
    const isGenericAlb = !rawAlb || 
      rawAlb.toLowerCase() === 'web stream' || 
      rawAlb.toLowerCase() === 'single' || 
      rawAlb.toLowerCase() === 'official release' || 
      rawAlb.toLowerCase() === 'official audio' || 
      rawAlb.toLowerCase() === 'top track' || 
      rawAlb.toLowerCase() === 'top songs' || 
      rawAlb.toLowerCase() === 'youtube music' ||
      rawAlb.startsWith('@') ||
      rawAlb.toLowerCase().includes('+');
    const albName = isGenericAlb ? track.title : rawAlb;
    let albId = (track as any).albumId;
    if (albId && (albId.startsWith('PL') || albId.startsWith('VLPL') || albId.startsWith('RD') || albId.startsWith('VLRD') || albId.startsWith('community-') || albId.startsWith('mix-'))) {
      albId = undefined;
    }
    if (!albId) {
      albId = `album-${encodeURIComponent(albName)}`;
    }
    const albArtist = track.artist || track.albumArtist || '';
    const albCover = track.cover || '';
    let navUrl = `/album/${encodeURIComponent(albId)}?name=${encodeURIComponent(albName)}&artist=${encodeURIComponent(albArtist)}&cover=${encodeURIComponent(albCover)}&trackTitle=${encodeURIComponent(track.title || '')}`;
    if (track.id) navUrl += `&videoId=${encodeURIComponent(track.id)}`;
    if (track.artistId) navUrl += `&artistId=${encodeURIComponent(track.artistId)}`;
    if (track.channelId) navUrl += `&channelId=${encodeURIComponent(track.channelId)}`;
    navigate(navUrl);
  };

  const handleShareTrack = () => {
    if (!track) return;
    closeContextMenu();
    const shareText = track.streamUrl || `https://music.youtube.com/watch?v=${track.id}`;
    navigator.clipboard.writeText(shareText);
    showToast('Track link copied to clipboard!');
  };

  // -------------------------------------------------------------
  // PLAYLIST CONTEXT MENU HANDLERS
  // -------------------------------------------------------------
  const playlist = playlistData;
  const isCustomUserPlaylist = Boolean(playlist && (playlists || []).some(p => p.id === playlist.id) && playlist.id !== 'liked');

  const handlePlayPlaylist = (shuffle = false) => {
    if (!playlist) return;
    closeContextMenu();
    const tracks = playlist.tracks || [];
    if (tracks.length > 0) {
      if (shuffle) {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        setQueue(shuffled, 0, `${playlist.name} (Shuffle)`);
      } else {
        setQueue(tracks, 0, playlist.name);
      }
      setIsPlaying(true);
    } else {
      navigate(`/playlist/${encodeURIComponent(playlist.id)}?name=${encodeURIComponent(playlist.name)}&cover=${encodeURIComponent(playlist.cover || '')}`);
    }
  };

  const handlePlayNextPlaylist = () => {
    if (!playlist || !playlist.tracks?.length) return;
    closeContextMenu();
    playlist.tracks.slice().reverse().forEach(t => playNext(t));
    showToast(`Playing "${playlist.name}" next`);
  };

  const handleAddAllPlaylistToQueue = () => {
    if (!playlist || !playlist.tracks?.length) return;
    closeContextMenu();
    playlist.tracks.forEach(t => addToQueue(t));
    showToast(`Added ${playlist.tracks.length} tracks to queue`);
  };

  const handleDownloadPlaylist = () => {
    if (!playlist || !playlist.tracks?.length) return;
    closeContextMenu();
    downloadTrackBatch(playlist.tracks, playlist.name);
  };

  const handleSharePlaylist = () => {
    if (!playlist) return;
    closeContextMenu();
    const url = `${window.location.origin}/#/playlist/${encodeURIComponent(playlist.id)}?name=${encodeURIComponent(playlist.name)}&cover=${encodeURIComponent(playlist.cover || '')}`;
    navigator.clipboard.writeText(url);
    showToast('Playlist link copied to clipboard!');
  };

  // -------------------------------------------------------------
  // ALBUM CONTEXT MENU HANDLERS
  // -------------------------------------------------------------
  const album = albumData;
  const isSavedAlbum = Boolean(album && (savedAlbums || []).some(
    a => a && (a.id === album.id || (a.name && album.name && a.name.toLowerCase() === album.name.toLowerCase() && a.artist && album.artist && a.artist.toLowerCase() === album.artist.toLowerCase()))
  ));

  const handlePlayAlbum = (shuffle = false) => {
    if (!album) return;
    closeContextMenu();
    const tracks = album.tracks || [];
    if (tracks.length > 0) {
      if (shuffle) {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        setQueue(shuffled, 0, `${album.name} (Shuffle)`);
      } else {
        setQueue(tracks, 0, album.name);
      }
      setIsPlaying(true);
    } else {
      navigate(`/album/${encodeURIComponent(album.id)}?name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}&cover=${encodeURIComponent(album.cover || '')}`);
    }
  };

  const handleShareAlbum = () => {
    if (!album) return;
    closeContextMenu();
    const url = `${window.location.origin}/#/album/${encodeURIComponent(album.id)}?name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}&cover=${encodeURIComponent(album.cover || '')}`;
    navigator.clipboard.writeText(url);
    showToast('Album link copied to clipboard!');
  };

  return createPortal(
    <>
      {isOpen && (
        <div
          ref={menuRef}
          className="global-context-menu"
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            width: '250px',
            maxHeight: `${pos.maxHeight}px`,
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            backgroundColor: '#18181c',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '12px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            zIndex: 999999,
            padding: '6px 0',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          {/* ============================================================ */}
          {/* 1. TRACK MENU                                                */}
          {/* ============================================================ */}
          {type === 'track' && track && (
            <>
              {/* Header Preview */}
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
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
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

              {!showPlaylistPicker ? (
                <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                  {!isLocalTrack(track) && (
                    <button className="track-menu-item" onClick={handleStartMix}>
                      <Radio size={16} />
                      <span>Start mix</span>
                    </button>
                  )}

                  <button className="track-menu-item" onClick={handlePlayNext}>
                    <ListPlus size={16} />
                    <span>Play next</span>
                  </button>

                  <button className="track-menu-item" onClick={handleAddToQueue}>
                    <Plus size={16} />
                    <span>Add to queue</span>
                  </button>

                  <button className="track-menu-item" onClick={handleToggleFavorite}>
                    <Heart size={16} fill={isFav ? 'var(--accent-primary)' : 'none'} color={isFav ? 'var(--accent-primary)' : 'currentColor'} />
                    <span>{isFav ? 'Remove from liked songs' : 'Add to liked songs'}</span>
                  </button>

                  <button className="track-menu-item" onClick={() => setShowPlaylistPicker(true)}>
                    <FolderPlus size={16} />
                    <span>Save to playlist</span>
                  </button>

                  {/* Offline Download (Online catalog only) */}
                  {!isLocalTrack(track) && (
                    downloadProgress !== undefined ? (
                      <button className="track-menu-item" style={{ color: 'var(--accent-primary)' }} onClick={(e) => e.stopPropagation()}>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Downloading ({downloadProgress}%)</span>
                      </button>
                    ) : isDownloaded ? (
                      <button className="track-menu-item" onClick={() => { closeContextMenu(); removeDownloadedTrack(track.id); showToast('Download removed from cache'); }}>
                        <HardDrive size={16} color="var(--accent-primary)" />
                        <span style={{ color: 'var(--accent-primary)' }}>Remove download</span>
                      </button>
                    ) : (
                      <button className="track-menu-item" onClick={() => { closeContextMenu(); downloadTrack(track); }}>
                        <Download size={16} />
                        <span>Download for offline</span>
                      </button>
                    )
                  )}

                  {/* Local File Actions */}
                  {isLocalTrack(track) && (track.filePath || trackData?.onShowInExplorer) && (
                    <button className="track-menu-item" onClick={() => {
                      closeContextMenu();
                      if (trackData?.onShowInExplorer) {
                        trackData.onShowInExplorer();
                      } else if (track.filePath) {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.showItemInFolder) electronAPI.showItemInFolder(track.filePath);
                        else if (electronAPI?.openFolder) electronAPI.openFolder(track.filePath);
                      }
                    }}>
                      <ExternalLink size={16} />
                      <span>Show in File Explorer</span>
                    </button>
                  )}

                  {isLocalTrack(track) && (track.filePath || trackData?.onDeleteFromPC) && (
                    <button className="track-menu-item" style={{ color: '#ff4d4d' }} onClick={() => {
                      closeContextMenu();
                      if (trackData?.onDeleteFromPC) {
                        trackData.onDeleteFromPC();
                      } else if (track.filePath) {
                        if (window.confirm(`Move "${track.title}" to the Recycle Bin?`)) {
                          (window as any).electronAPI?.deleteLocalMusicFile?.(track.filePath);
                          showToast('Moved to Recycle Bin');
                        }
                      }
                    }}>
                      <Trash2 size={16} color="#ff4d4d" />
                      <span style={{ color: '#ff4d4d' }}>Delete from PC</span>
                    </button>
                  )}

                  {/* Context-Specific Removals */}
                  {trackData?.onRemoveFromQueue && (
                    <button className="track-menu-item" onClick={() => { closeContextMenu(); trackData.onRemoveFromQueue?.(); }}>
                      <Trash2 size={16} color="#e74c3c" />
                      <span style={{ color: '#e74c3c' }}>Remove from queue</span>
                    </button>
                  )}

                  {trackData?.onRemoveFromPlaylist && (
                    <button className="track-menu-item" onClick={() => { closeContextMenu(); trackData.onRemoveFromPlaylist?.(); }}>
                      <Trash2 size={16} color="#e74c3c" />
                      <span style={{ color: '#e74c3c' }}>Remove from playlist</span>
                    </button>
                  )}

                  {!isLocalTrack(track) && (
                    <>
                      <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                      {canGoToArtist(track) && (
                        <button className="track-menu-item" onClick={handleGoToArtist}>
                          <User size={16} />
                          <span>Go to artist</span>
                        </button>
                      )}

                      <button className="track-menu-item" onClick={handleGoToAlbum}>
                        <Disc size={16} />
                        <span>Go to album</span>
                      </button>

                      <button className="track-menu-item" onClick={() => { closeContextMenu(); setShowDetailsModal(true); }}>
                        <Info size={16} />
                        <span>View song credits</span>
                      </button>

                      <button className="track-menu-item" onClick={handleShareTrack}>
                        <Share2 size={16} />
                        <span>Share</span>
                      </button>

                      <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                      <button 
                        className="track-menu-item" 
                        style={{ color: '#ff4d4d' }}
                        onClick={() => { closeContextMenu(); markTrackNotInterested(track); }}
                      >
                        <Ban size={16} color="#ff4d4d" />
                        <span style={{ color: '#ff4d4d' }}>Not interested</span>
                      </button>

                      <button 
                        className="track-menu-item" 
                        style={{ color: '#ff4d4d' }}
                        onClick={() => { closeContextMenu(); blockArtist(track.artist); }}
                      >
                        <UserX size={16} color="#ff4d4d" />
                        <span style={{ color: '#ff4d4d' }}>Don't recommend artist</span>
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* Save to Playlist Submenu */
                <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 0' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 14px 8px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                  }}>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Save to playlist</span>
                    <button 
                      onClick={() => setShowPlaylistPicker(false)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '4px 0' }}>
                    {(playlists || []).map(p => {
                      const containsTrack = (p.tracks || []).some(t => t.id === track.id);
                      return (
                        <button
                          key={p.id}
                          className="track-menu-item"
                          onClick={() => {
                            addToPlaylist(p.id, track);
                            closeContextMenu();
                          }}
                          style={{ justifyContent: 'space-between' }}
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                          {containsTrack && <Check size={14} color="var(--accent-primary)" />}
                        </button>
                      );
                    })}
                  </div>

                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newPlaylistName.trim()) {
                        createPlaylistWithTrack(newPlaylistName.trim(), track);
                        setNewPlaylistName('');
                        closeContextMenu();
                      }
                    }}
                    style={{ padding: '8px 12px 4px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}
                  >
                    <input 
                      type="text"
                      placeholder="New playlist name..."
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      style={{
                        width: '100%',
                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: 'white',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    />
                  </form>
                </div>
              )}
            </>
          )}

          {/* ============================================================ */}
          {/* 2. PLAYLIST MENU                                             */}
          {/* ============================================================ */}
          {type === 'playlist' && playlist && (
            <>
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
                    backgroundImage: playlist.cover ? `url(${playlist.cover})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {!playlist.cover && <Music2 size={18} color="var(--text-secondary)" />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {playlist.name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '1px'
                  }}>
                    {playlist.tracks?.length || 0} tracks • Playlist
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                <button className="track-menu-item" onClick={() => handlePlayPlaylist(false)}>
                  <Play size={16} />
                  <span>Play playlist</span>
                </button>

                <button className="track-menu-item" onClick={() => handlePlayPlaylist(true)}>
                  <Shuffle size={16} />
                  <span>Shuffle play</span>
                </button>

                {playlist.tracks && playlist.tracks.length > 0 && (
                  <>
                    <button className="track-menu-item" onClick={handlePlayNextPlaylist}>
                      <ListPlus size={16} />
                      <span>Play next</span>
                    </button>

                    <button className="track-menu-item" onClick={handleAddAllPlaylistToQueue}>
                      <Plus size={16} />
                      <span>Add all to queue</span>
                    </button>

                    <button className="track-menu-item" onClick={handleDownloadPlaylist}>
                      <Download size={16} />
                      <span>Download playlist</span>
                    </button>
                  </>
                )}

                <button className="track-menu-item" onClick={handleSharePlaylist}>
                  <Share2 size={16} />
                  <span>Share playlist</span>
                </button>

                {isCustomUserPlaylist && (
                  <>
                    <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
                    
                    <button 
                      className="track-menu-item"
                      onClick={() => {
                        setEditName(playlist.name);
                        setEditDesc(playlist.description || '');
                        setEditCover(playlist.cover || '');
                        closeContextMenu();
                        setShowEditPlaylistModal(true);
                      }}
                    >
                      <Pencil size={16} />
                      <span>Edit playlist</span>
                    </button>

                    <button 
                      className="track-menu-item" 
                      style={{ color: '#e74c3c' }}
                      onClick={() => {
                        closeContextMenu();
                        deletePlaylist(playlist.id);
                        showToast(`Deleted "${playlist.name}"`);
                      }}
                    >
                      <Trash2 size={16} color="#e74c3c" />
                      <span style={{ color: '#e74c3c' }}>Delete playlist</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* ============================================================ */}
          {/* 3. ALBUM MENU                                                */}
          {/* ============================================================ */}
          {type === 'album' && album && (
            <>
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
                    backgroundImage: `url(${album.cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
                    {album.name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '1px'
                  }}>
                    {album.artist} • Album
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                <button className="track-menu-item" onClick={() => handlePlayAlbum(false)}>
                  <Play size={16} />
                  <span>Play album</span>
                </button>

                <button className="track-menu-item" onClick={() => handlePlayAlbum(true)}>
                  <Shuffle size={16} />
                  <span>Shuffle play</span>
                </button>

                {album.tracks && album.tracks.length > 0 && (
                  <>
                    <button className="track-menu-item" onClick={() => {
                      closeContextMenu();
                      album.tracks!.slice().reverse().forEach(t => playNext(t));
                      showToast(`Playing "${album.name}" next`);
                    }}>
                      <ListPlus size={16} />
                      <span>Play next</span>
                    </button>

                    <button className="track-menu-item" onClick={() => {
                      closeContextMenu();
                      album.tracks!.forEach(t => addToQueue(t));
                      showToast(`Added ${album.tracks!.length} tracks to queue`);
                    }}>
                      <Plus size={16} />
                      <span>Add all to queue</span>
                    </button>

                    <button className="track-menu-item" onClick={() => {
                      closeContextMenu();
                      downloadTrackBatch(album.tracks!, album.name);
                    }}>
                      <Download size={16} />
                      <span>Download album</span>
                    </button>
                  </>
                )}

                <button 
                  className="track-menu-item"
                  onClick={() => {
                    closeContextMenu();
                    toggleSaveAlbum({
                      id: album.id,
                      name: album.name,
                      artist: album.artist,
                      cover: album.cover || '',
                      releaseDate: album.releaseDate,
                      trackCount: album.tracks?.length || 0,
                      artistId: album.artistId
                    });
                    showToast(isSavedAlbum ? `Removed "${album.name}" from library` : `Saved "${album.name}" to library`);
                  }}
                >
                  <Heart size={16} fill={isSavedAlbum ? 'var(--accent-primary)' : 'none'} color={isSavedAlbum ? 'var(--accent-primary)' : 'currentColor'} />
                  <span>{isSavedAlbum ? 'Remove from library' : 'Save to library'}</span>
                </button>

                <button 
                  className="track-menu-item" 
                  onClick={() => {
                    closeContextMenu();
                    navigate(`/artist/${encodeURIComponent(album.artist)}${album.artistId ? `?artistId=${encodeURIComponent(album.artistId)}` : ''}`);
                  }}
                >
                  <User size={16} />
                  <span>Go to artist</span>
                </button>

                <button className="track-menu-item" onClick={handleShareAlbum}>
                  <Share2 size={16} />
                  <span>Share album</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* SONG DETAILS MODAL                                           */}
      {/* ============================================================ */}
      {showDetailsModal && track && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setShowDetailsModal(false)}
        >
          <div 
            style={{
              backgroundColor: '#1c1c24',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowDetailsModal(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'center' }}>
              <img 
                src={track.cover} 
                alt="" 
                style={{ width: '64px', height: '64px', borderRadius: '8px', objectFit: 'cover' }} 
              />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: 800 }}>{track.title}</h3>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{track.artist}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Track ID</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{track.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Album</span>
                <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{track.album || 'Single / Web Stream'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                <span style={{ color: 'var(--text-primary)' }}>{Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, '0')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Offline Status</span>
                <span style={{ color: isDownloaded ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 600 }}>
                  {isDownloaded ? 'Downloaded to Disk' : 'Streaming Online'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* EDIT PLAYLIST MODAL                                          */}
      {/* ============================================================ */}
      {showEditPlaylistModal && playlist && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setShowEditPlaylistModal(false)}
        >
          <div 
            style={{
              backgroundColor: '#1c1c24',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', fontWeight: 800 }}>Edit Playlist</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Title</label>
                <input 
                  type="text" 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: 'white',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Description</label>
                <textarea 
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: 'white',
                    fontSize: '0.85rem',
                    resize: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Custom Cover URL</label>
                <input 
                  type="text" 
                  value={editCover}
                  onChange={(e) => setEditCover(e.target.value)}
                  placeholder="https://..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: 'white',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button 
                  className="secondary-btn"
                  onClick={() => setShowEditPlaylistModal(false)}
                >
                  Cancel
                </button>
                <button 
                  className="primary-btn"
                  onClick={() => {
                    if (editName.trim()) {
                      updatePlaylist(playlist.id, {
                        name: editName.trim(),
                        description: editDesc.trim(),
                        cover: editCover.trim() || undefined
                      });
                      setShowEditPlaylistModal(false);
                      showToast('Playlist updated');
                    }
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};
