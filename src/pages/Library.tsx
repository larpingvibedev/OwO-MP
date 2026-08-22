import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Plus, 
  Heart, 
  Disc3, 
  User, 
  ArrowUpDown, 
  Play, 
  Shuffle, 
  Download, 
  HardDrive,
  Folder,
  ChevronRight
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Playlist, LibraryFilterType } from '../types';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { useContextMenuStore } from '../store/useContextMenuStore';
import { ImportPlaylistModal } from '../components/common/ImportPlaylistModal';
import { LocalFilesView } from '../components/local/LocalFilesView';
import { DownloadsView } from '../components/library/DownloadsView';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Library() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') as LibraryFilterType) || 'all';

  const { 
    playlists, 
    localPlaylistMetadata,
    favorites, 
    savedAlbums,
    followedArtists,
    offlineRecords,
    syncOfflineTracks,
    setQueue, 
    setIsPlaying, 
    createPlaylist, 
    showToast 
  } = usePlayerStore();

  const { openPlaylistContextMenu, openAlbumContextMenu } = useContextMenuStore();

  const [activeFilter, setActiveFilter] = useState<LibraryFilterType>(tabParam);
  const [sortBy, setSortBy] = useState<'recent' | 'added' | 'alpha'>('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [localFilesCount, setLocalFilesCount] = useState<number>(0);

  // Sync offline tracks on mount
  useEffect(() => {
    syncOfflineTracks();
  }, [syncOfflineTracks]);

  // Scan local PC music files count and keep it reactively in sync
  useEffect(() => {
    let isCancelled = false;
    async function getLocalCount() {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.scanLocalMusicFiles) {
        try {
          const scanned = await electronAPI.scanLocalMusicFiles();
          if (!isCancelled) {
            setLocalFilesCount(scanned?.length || 0);
          }
        } catch {}
      }
    }

    getLocalCount();

    const electronAPI = (window as any).electronAPI;
    let cleanupWatcher: (() => void) | undefined;
    if (electronAPI?.onDiskFolderChanged) {
      cleanupWatcher = electronAPI.onDiskFolderChanged(() => {
        getLocalCount();
      });
    }

    const handleFocus = () => {
      getLocalCount();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      isCancelled = true;
      if (cleanupWatcher) cleanupWatcher();
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Sync tab with URL search parameter
  const handleFilterChange = (filter: LibraryFilterType) => {
    setActiveFilter(filter);
    setSearchParams(filter === 'all' ? {} : { tab: filter });
  };

  const officialAlbums = useMemo(() => {
    return (savedAlbums || []).filter(a => {
      if (!a) return false;
      const n = (a.name || '').toLowerCase();
      return !n.includes('top tracks') && !n.includes('singles & eps') && !n.includes('mix') && !n.includes('album');
    });
  }, [savedAlbums]);

  const sortedPlaylists = useMemo(() => {
    const list = [...playlists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return list;
  }, [playlists, sortBy]);

  const sortedAlbums = useMemo(() => {
    const list = [...officialAlbums];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }
    return list;
  }, [officialAlbums, sortBy]);

  const sortedArtists = useMemo(() => {
    const list = [...followedArtists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.followedAt || 0) - (a.followedAt || 0));
    }
    return list;
  }, [followedArtists, sortBy]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const newId = createPlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setShowCreateModal(false);
    navigate(`/playlist/${newId}`);
  };

  const handlePlayLikedMusic = () => {
    if (favorites.length === 0) {
      showToast('No liked songs yet! Like songs with the heart button to populate.');
      return;
    }
    setQueue(favorites, 0, 'Liked Music', true, 'user_playlist');
    setIsPlaying(true);
  };

  const handlePlayPlaylist = (pl: Playlist) => {
    if (pl.tracks.length === 0) {
      showToast(`"${pl.name}" has no songs yet.`);
      return;
    }
    setQueue(pl.tracks, 0, `${pl.name} Playlist`, true, 'user_playlist');
    setIsPlaying(true);
  };

  // Filter chips configuration
  const filterChips: { id: LibraryFilterType; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'playlists', label: 'Playlists', count: playlists.length + (favorites.length > 0 ? 1 : 0) },
    { id: 'songs', label: 'Liked Songs', count: favorites.length },
    { id: 'albums', label: 'Albums', count: officialAlbums.length },
    { id: 'artists', label: 'Artists', count: followedArtists.length },
    { id: 'local', label: 'Local Files', count: localFilesCount },
    { id: 'downloads', label: 'Downloads', count: offlineRecords.length }
  ];

  return (
    <div className="library-page-container">
      {/* Top Header & Filter Chips */}
      <div className="library-header">
        <div className="library-title-row">
          <div>
            <h1 className="library-heading">Your Library</h1>
            <p className="library-subheading">
              {playlists.length} playlists • {favorites.length} liked tracks • {officialAlbums.length} albums • {localFilesCount} local files • {offlineRecords.length} downloads
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button 
              className="library-import-playlist-btn"
              onClick={() => setShowImportModal(true)}
              title="Import playlist from Spotify or YouTube"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '24px',
                padding: '10px 18px',
                color: '#ffffff',
                fontSize: '0.88rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Download size={16} />
              <span>Import</span>
            </button>

            <button 
              className="new-playlist-primary-btn"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={18} />
              <span>New playlist</span>
            </button>
          </div>
        </div>

        {/* Filter Chips Row */}
        <div className="library-filter-chips-row">
          <div className="filter-chips-scroll">
            {filterChips.map(chip => (
              <button
                key={chip.id}
                className={`filter-chip ${activeFilter === chip.id ? 'active' : ''}`}
                onClick={() => handleFilterChange(chip.id)}
              >
                <span>{chip.label}</span>
                {chip.count !== undefined && chip.count > 0 && (
                  <span className="chip-counter">{chip.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Sorters: Recent activity, Recently added, Alphabetical */}
          {activeFilter !== 'local' && activeFilter !== 'downloads' && (
            <div className="library-sort-wrapper">
              <button 
                className="library-sort-btn"
                onClick={() => {
                  const nextSort = sortBy === 'recent' ? 'added' : (sortBy === 'added' ? 'alpha' : 'recent');
                  setSortBy(nextSort);
                }}
                title="Click to toggle sort order"
              >
                <ArrowUpDown size={15} />
                <span>
                  {sortBy === 'recent' && 'Recent activity'}
                  {sortBy === 'added' && 'Recently added'}
                  {sortBy === 'alpha' && 'Alphabetical'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* VIEW: All Hub (Sectioned & Structured) */}
      {activeFilter === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '36px', paddingBottom: '40px' }}>
          {/* Quick Access Hero Row: Liked Music, Local Files, Offline Downloads */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px'
          }}>
            {/* Liked Music Card */}
            <div 
              className="library-card liked-music-hero-card"
              onClick={() => navigate('/playlist/liked')}
              style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', borderRadius: '16px', cursor: 'pointer' }}
            >
              <div className="liked-music-icon-badge">
                <Heart size={26} fill="#fff" color="#fff" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Liked Music</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Auto Playlist • {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'}
                </div>
              </div>
              <ChevronRight size={20} color="var(--text-secondary)" />
            </div>

            {/* Local Files Card */}
            <div 
              className="library-card"
              onClick={() => handleFilterChange('local')}
              style={{
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.16) 0%, rgba(15, 23, 42, 0.8) 100%)',
                border: '1px solid rgba(37, 99, 235, 0.25)'
              }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Folder size={26} color="#fff" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Local Files</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  PC Hard Drive • {localFilesCount} files
                </div>
              </div>
              <ChevronRight size={20} color="var(--text-secondary)" />
            </div>

            {/* Offline Downloads Card */}
            <div 
              className="library-card"
              onClick={() => handleFilterChange('downloads')}
              style={{
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(15, 23, 42, 0.8) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.25)'
              }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <HardDrive size={26} color="#fff" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Downloads</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Offline Cache • {offlineRecords.length} tracks
                </div>
              </div>
              <ChevronRight size={20} color="var(--text-secondary)" />
            </div>
          </div>

          {/* Section 1: Playlists */}
          {playlists.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Playlists</h2>
                <button
                  onClick={() => handleFilterChange('playlists')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  See all ({playlists.length})
                </button>
              </div>
              <div className="library-grid">
                {playlists.slice(0, 6).map(pl => (
                  <div 
                    key={pl.id} 
                    className="library-card"
                    onClick={() => navigate(`/playlist/${pl.id}`)}
                    onContextMenu={(e) => openPlaylistContextMenu(e, pl)}
                  >
                    <div className="card-cover-wrapper playlist-cover-wrap">
                      <PlaylistCover 
                        playlistId={pl.id}
                        tracks={pl.tracks} 
                        cover={pl.cover} 
                        coverId={localPlaylistMetadata?.[pl.id]?.coverId ?? pl.coverId}
                        name={pl.name} 
                        size="100%" 
                        borderRadius={12} 
                        fallbackIconSize={48} 
                      />
                      <div className="card-play-hover-btn" onClick={(e) => { e.stopPropagation(); handlePlayPlaylist(pl); }} title="Play Playlist">
                        <Play size={20} fill="#000" color="#000" />
                      </div>
                    </div>
                    <div className="card-meta">
                      <div className="card-title" title={pl.name}>{pl.name}</div>
                      <div className="card-subtitle">Playlist • {pl.tracks?.length || 0} tracks</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Saved Albums */}
          {officialAlbums.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Saved Albums</h2>
                <button
                  onClick={() => handleFilterChange('albums')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  See all ({officialAlbums.length})
                </button>
              </div>
              <div className="library-grid">
                {officialAlbums.slice(0, 6).map(alb => (
                  <div 
                    key={alb.id} 
                    className="library-card"
                    onClick={() => navigate(`/album/${encodeURIComponent(alb.id)}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover || '')}`)}
                    onContextMenu={(e) => openAlbumContextMenu(e, alb)}
                  >
                    <div 
                      className="card-cover-wrapper"
                      style={{
                        backgroundImage: `url(${alb.cover})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      <div className="card-play-hover-btn" title="Open Album">
                        <Disc3 size={20} color="#000" />
                      </div>
                    </div>
                    <div className="card-meta">
                      <div className="card-title" title={alb.name}>{alb.name}</div>
                      <div className="card-subtitle">Album • {alb.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Followed Artists */}
          {followedArtists.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Followed Artists</h2>
                <button
                  onClick={() => handleFilterChange('artists')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  See all ({followedArtists.length})
                </button>
              </div>
              <div className="library-grid">
                {followedArtists.slice(0, 6).map(art => (
                  <div 
                    key={art.name} 
                    className="library-card artist-round-card"
                    onClick={() => navigate(`/artist/${encodeURIComponent(art.name)}${art.channelId ? `?channelId=${encodeURIComponent(art.channelId)}` : ''}`)}
                  >
                    <div 
                      className="card-avatar-wrapper"
                      style={{
                        backgroundImage: `url(${art.cover})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      <div className="card-play-hover-btn" title="Go to Artist">
                        <User size={20} color="#000" />
                      </div>
                    </div>
                    <div className="card-meta text-center">
                      <div className="card-title" title={art.name}>{art.name}</div>
                      <div className="card-subtitle">Artist • Following</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: Playlists Tab */}
      {activeFilter === 'playlists' && (
        <div className="library-grid">
          {/* Liked Music Card */}
          <div 
            className="library-card"
            onClick={() => navigate('/playlist/liked')}
          >
            <div className="card-avatar-wrapper playlist-cover-wrap liked-music-playlist-cover">
              <Heart size={56} fill="#fff" color="#fff" className="heart-icon-glow" />
              <div className="card-play-hover-btn" onClick={(e) => { e.stopPropagation(); handlePlayLikedMusic(); }} title="Play Liked Music">
                <Play size={22} fill="#000" color="#000" />
              </div>
            </div>
            <div className="card-meta" style={{ marginTop: '10px' }}>
              <div className="card-title">Liked Music</div>
              <div className="card-subtitle">Auto playlist • {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'}</div>
            </div>
          </div>

          {/* User Playlists */}
          {sortedPlaylists.map(pl => (
            <div 
              key={pl.id} 
              className="library-card"
              onClick={() => navigate(`/playlist/${pl.id}`)}
              onContextMenu={(e) => openPlaylistContextMenu(e, pl)}
            >
              <div className="card-cover-wrapper playlist-cover-wrap">
                <PlaylistCover 
                  playlistId={pl.id}
                  tracks={pl.tracks} 
                  cover={pl.cover} 
                  coverId={localPlaylistMetadata?.[pl.id]?.coverId ?? pl.coverId}
                  name={pl.name} 
                  size="100%" 
                  borderRadius={12} 
                  fallbackIconSize={48} 
                />
                <div className="card-play-hover-btn" onClick={(e) => { e.stopPropagation(); handlePlayPlaylist(pl); }} title="Play Playlist">
                  <Play size={22} fill="#000" color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title" title={pl.name}>{pl.name}</div>
                <div className="card-subtitle">Playlist • {pl.tracks?.length || 0} tracks</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW: Liked Songs Tab */}
      {activeFilter === 'songs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.2) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(236, 72, 153, 0.3)',
            borderRadius: '16px',
            padding: '24px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '20px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(236, 72, 153, 0.45)',
                flexShrink: 0
              }}>
                <Heart size={28} fill="#fff" color="#fff" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Liked Songs</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                  {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'} liked
                </p>
              </div>
            </div>

            {favorites.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={handlePlayLikedMusic}
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '24px',
                    padding: '10px 20px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <Play size={16} fill="#000" color="#000" />
                  <span>Play All</span>
                </button>
                <button
                  onClick={() => {
                    const shuffled = [...favorites].sort(() => Math.random() - 0.5);
                    setQueue(shuffled, 0, 'Liked Songs (Shuffle)', true, 'user_playlist');
                    setIsPlaying(true);
                  }}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '24px',
                    padding: '10px 18px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <Shuffle size={15} />
                  <span>Shuffle</span>
                </button>
              </div>
            )}
          </div>

          {favorites.length > 0 ? (
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: '14px',
              overflow: 'hidden'
            }}>
              {favorites.map((trk, idx) => (
                <div
                  key={trk.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '10px 16px',
                    borderBottom: idx === favorites.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    setQueue(favorites, idx, 'Liked Music', true, 'user_playlist');
                    setIsPlaying(true);
                  }}
                >
                  <div style={{ width: '28px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {idx + 1}
                  </div>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '6px',
                    backgroundImage: `url(${trk.cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    flexShrink: 0
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {trk.title}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {trk.artist}
                    </div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                    {formatDuration(trk.duration)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
              No liked songs yet. Click the heart on any track to add it here.
            </div>
          )}
        </div>
      )}

      {/* VIEW: Saved Albums Tab */}
      {activeFilter === 'albums' && (
        <div className="library-grid">
          {sortedAlbums.map(alb => (
            <div 
              key={alb.id} 
              className="library-card"
              onClick={() => navigate(`/album/${encodeURIComponent(alb.id)}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover || '')}`)}
              onContextMenu={(e) => openAlbumContextMenu(e, alb)}
            >
              <div 
                className="card-cover-wrapper"
                style={{
                  backgroundImage: `url(${alb.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="card-play-hover-btn" title="Open Album">
                  <Disc3 size={20} color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title" title={alb.name}>{alb.name}</div>
                <div className="card-subtitle">Album • {alb.artist}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW: Followed Artists Tab */}
      {activeFilter === 'artists' && (
        <div className="library-grid">
          {sortedArtists.map(art => (
            <div 
              key={art.name} 
              className="library-card artist-round-card"
              onClick={() => navigate(`/artist/${encodeURIComponent(art.name)}${art.channelId ? `?channelId=${encodeURIComponent(art.channelId)}` : ''}`)}
            >
              <div 
                className="card-avatar-wrapper"
                style={{
                  backgroundImage: `url(${art.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="card-play-hover-btn" title="Go to Artist">
                  <User size={20} color="#000" />
                </div>
              </div>
              <div className="card-meta text-center">
                <div className="card-title" title={art.name}>{art.name}</div>
                <div className="card-subtitle">Artist • Following</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW: Local Files Tab (Embedded Reusable View) */}
      {activeFilter === 'local' && (
        <LocalFilesView embedded={true} />
      )}

      {/* VIEW: Offline Downloads Tab (Dedicated View) */}
      {activeFilter === 'downloads' && (
        <DownloadsView />
      )}

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className="create-playlist-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="create-playlist-modal-card" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">New playlist</h2>
            <form onSubmit={handleCreateSubmit}>
              <input
                type="text"
                autoFocus
                className="modal-input"
                placeholder="Title"
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn-save"
                  disabled={!newPlaylistName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Playlist Modal */}
      <ImportPlaylistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </div>
  );
}
