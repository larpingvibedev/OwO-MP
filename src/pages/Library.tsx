import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Plus, 
  Heart, 
  Disc3, 
  User, 
  ArrowUpDown, 
  Play, 
  Trash2,
  Music2, 
  Sparkles, 
  Check, 
  Shuffle, 
  Download, 
  HardDrive,
  Folder,
  FolderPlus,
  Search,
  RefreshCw,
  ExternalLink,
  X
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Playlist, LibraryFilterType, SavedAlbum, FollowedArtist } from '../types';
import { getAllOfflineRecords, type OfflineRecord } from '../services/downloadService';
import { TrackOptionsMenu } from '../components/common/TrackOptionsMenu';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { useContextMenuStore } from '../store/useContextMenuStore';
import { ImportPlaylistModal } from '../components/common/ImportPlaylistModal';

interface UnifiedLibraryItem {
  id: string;
  type: 'liked_music' | 'playlist' | 'album' | 'artist' | 'downloads';
  title: string;
  subtitle: string;
  cover: string;
  isRound?: boolean;
  savedAt: number;
  lastPlayedAt: number;
  data: any;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function Library() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') as LibraryFilterType) || 'all';

  const { 
    playlists, 
    favorites, 
    savedAlbums,
    followedArtists,
    downloadedTrackIds,
    syncOfflineTracks,
    downloadTrackBatch,
    removeDownloadedTrack,
    clearAllDownloads,
    setQueue, 
    setIsPlaying, 
    toggleFavorite,
    createPlaylist, 
    showToast 
  } = usePlayerStore();

  const { openTrackContextMenu, openPlaylistContextMenu, openAlbumContextMenu } = useContextMenuStore();

  const [activeFilter, setActiveFilter] = useState<LibraryFilterType>(tabParam);
  const [sortBy, setSortBy] = useState<'recent' | 'added' | 'alpha'>('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [offlineRecords, setOfflineRecords] = useState<OfflineRecord[]>([]);

  // Local PC Audio Files State
  const [localFiles, setLocalFiles] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFolders, setScannedFolders] = useState<string[]>([]);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [localSubTab, setLocalSubTab] = useState<'all' | 'downloads' | 'local'>('all');

  const scanLocalMusic = React.useCallback(async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.scanLocalMusicFiles) return;

    setIsScanning(true);
    try {
      const folders = await electronAPI.getLocalMusicFolders?.() || [];
      setScannedFolders(folders);
      const scanned = await electronAPI.scanLocalMusicFiles();
      setLocalFiles(scanned || []);
    } catch (err) {
      console.warn('Failed scanning local files:', err);
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    syncOfflineTracks();
    scanLocalMusic();

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onDiskFolderChanged) {
      const cleanup = electronAPI.onDiskFolderChanged(() => {
        scanLocalMusic();
        syncOfflineTracks();
      });
      return cleanup;
    }
  }, [scanLocalMusic, syncOfflineTracks]);

  // Sync and load offline records from IndexedDB
  useEffect(() => {
    let isCancelled = false;
    async function loadOffline() {
      try {
        const records = await getAllOfflineRecords();
        if (!isCancelled) {
          setOfflineRecords(records);
        }
      } catch (err) {
        console.warn('Failed to load offline records:', err);
      }
    }
    loadOffline();
    return () => { isCancelled = true; };
  }, [downloadedTrackIds]);

  // Sync tab with URL search parameter
  const handleFilterChange = (filter: LibraryFilterType) => {
    setActiveFilter(filter);
    setSearchParams(filter === 'all' ? {} : { tab: filter });
  };

  // 1. Sort Playlists
  const sortedPlaylists = useMemo(() => {
    const list = [...playlists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [playlists, sortBy]);

  // Filter saved albums to ensure strictly official albums from artists
  const officialAlbums = useMemo(() => {
    return savedAlbums.filter(alb => {
      const isPlaylist = alb.id.startsWith('PL') || alb.id.startsWith('VLPL') || alb.id.startsWith('community-') || alb.id.startsWith('mix-') || (alb.releaseDate && alb.releaseDate.toLowerCase().includes('playlist')) || (alb.releaseDate && alb.releaseDate.toLowerCase().includes('mix'));
      return !isPlaylist;
    });
  }, [savedAlbums]);

  // 2. Sort Saved Albums (Official Releases)
  const sortedAlbums = useMemo(() => {
    const list = [...officialAlbums];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.lastPlayedAt || b.savedAt || 0) - (a.lastPlayedAt || a.savedAt || 0));
  }, [officialAlbums, sortBy]);

  // 3. Sort Followed Artists
  const sortedArtists = useMemo(() => {
    const list = [...followedArtists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.followedAt || 0) - (a.followedAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.lastPlayedAt || b.followedAt || 0) - (a.lastPlayedAt || a.followedAt || 0));
  }, [followedArtists, sortBy]);

  const cleanTrackKey = (artist: string = '', title: string = ''): string => {
    const a = (artist || '').toLowerCase().replace(/[\\/:*?"<>|_-]/g, ' ').replace(/\s+/g, ' ').trim();
    const t = (title || '').toLowerCase().replace(/[\\/:*?"<>|_-]/g, ' ').replace(/\s+/g, ' ').trim();
    return `${a} ::: ${t}`;
  };

  const filteredPCFiles = useMemo(() => {
    return localFiles.filter(f => {
      if (!f) return false;
      const fp = (f.filePath || '').toLowerCase();
      const fld = (f.folder || '').toLowerCase();
      if (fp.includes('owo music') || fld.includes('owo music')) return false;
      return true;
    });
  }, [localFiles]);

  const combinedLocalTracks = useMemo(() => {
    const appDownloads = offlineRecords.map(r => ({
      ...r.track,
      sizeBytes: r.size || r.audioBlob?.size || 0,
      isAppDownload: true,
      downloadRecordId: r.id,
      ext: 'MP3'
    }));

    const pcFiles = filteredPCFiles.map(f => ({
      ...f,
      isPCFile: true
    }));

    if (localSubTab === 'downloads') {
      let list = appDownloads;
      if (localSearchQuery.trim()) {
        const q = localSearchQuery.toLowerCase().trim();
        list = list.filter(t => 
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.album && t.album.toLowerCase().includes(q))
        );
      }
      return list;
    }

    if (localSubTab === 'local') {
      let list = pcFiles;
      if (localSearchQuery.trim()) {
        const q = localSearchQuery.toLowerCase().trim();
        list = list.filter(t => 
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.album && t.album.toLowerCase().includes(q)) ||
          (t.fileName && t.fileName.toLowerCase().includes(q))
        );
      }
      return list;
    }

    // 'all' subtab: merge appDownloads and pcFiles without duplicates
    const seenTrackKeys = new Set<string>();
    const seenFilePaths = new Set<string>();
    const merged: any[] = [];

    // Add all App Downloads first (these have official thumbnails and rich metadata)
    for (const d of appDownloads) {
      const key = cleanTrackKey(d.artist, d.title);
      seenTrackKeys.add(key);
      seenTrackKeys.add(d.id);
      if (d.filePath) seenFilePaths.add(d.filePath.toLowerCase());
      merged.push(d);
    }

    // Then add non-duplicate PC files
    for (const p of pcFiles) {
      const key = cleanTrackKey(p.artist, p.title);
      const fp = (p.filePath || '').toLowerCase();
      if (!seenTrackKeys.has(key) && !seenTrackKeys.has(p.id) && (!fp || !seenFilePaths.has(fp))) {
        seenTrackKeys.add(key);
        seenTrackKeys.add(p.id);
        if (fp) seenFilePaths.add(fp);
        merged.push(p);
      }
    }

    let list = merged;
    if (localSearchQuery.trim()) {
      const q = localSearchQuery.toLowerCase().trim();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        (t.fileName && t.fileName.toLowerCase().includes(q))
      );
    }

    return list;
  }, [offlineRecords, filteredPCFiles, localSubTab, localSearchQuery]);

  const totalUniqueLocalCount = useMemo(() => {
    const seen = new Set<string>();
    let count = 0;
    for (const r of offlineRecords) {
      const key = cleanTrackKey(r.track?.artist, r.track?.title);
      if (!seen.has(key)) {
        seen.add(key);
        count++;
      }
    }
    for (const p of filteredPCFiles) {
      const key = cleanTrackKey(p.artist, p.title);
      if (!seen.has(key)) {
        seen.add(key);
        count++;
      }
    }
    return count;
  }, [offlineRecords, filteredPCFiles]);

  const totalLocalBytes = useMemo(() => {
    const dbBytes = offlineRecords.reduce((acc, r) => acc + (r.size || r.audioBlob?.size || 0), 0);
    const pcBytes = filteredPCFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    return dbBytes + pcBytes;
  }, [offlineRecords, filteredPCFiles]);

  // 4. Unified Grid Items for "All" Tab
  const unifiedItems = useMemo(() => {
    const items: UnifiedLibraryItem[] = [];

    // Local Files & Offline Downloads Hero Card
    const totalLocalCount = totalUniqueLocalCount;
    if (totalLocalCount > 0) {
      items.push({
        id: 'downloads-item',
        type: 'downloads',
        title: 'Local Files & Offline',
        subtitle: `Local PC & Cache • ${totalLocalCount} tracks • ${formatBytes(totalLocalBytes)}`,
        cover: offlineRecords[0]?.track?.cover || filteredPCFiles[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        savedAt: Date.now(),
        lastPlayedAt: Date.now() + 2000,
        data: offlineRecords
      });
    }

    // Liked music card
    if (favorites.length > 0) {
      items.push({
        id: 'liked-music-item',
        type: 'liked_music',
        title: 'Liked Music',
        subtitle: `Auto playlist • ${favorites.length} tracks`,
        cover: favorites[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        savedAt: Date.now(),
        lastPlayedAt: Date.now() + 1000,
        data: favorites
      });
    }

    // Playlists (User created & Saved Community Playlists)
    playlists.forEach(pl => {
      if (!pl) return;
      const trackCount = Array.isArray(pl.tracks) ? pl.tracks.length : 0;
      const subtitle = pl.author 
        ? `Playlist • ${pl.author}`
        : `Playlist • ${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`;
      items.push({
        id: pl.id,
        type: 'playlist',
        title: pl.name || 'Playlist',
        subtitle,
        cover: pl.cover || (pl.tracks && pl.tracks[0]?.cover) || '',
        savedAt: pl.createdAt || 0,
        lastPlayedAt: pl.createdAt || 0,
        data: pl
      });
    });

    // Official Saved Albums
    officialAlbums.forEach(alb => {
      items.push({
        id: alb.id,
        type: 'album',
        title: alb.name,
        subtitle: `Album • ${alb.artist}`,
        cover: alb.cover,
        savedAt: alb.savedAt || 0,
        lastPlayedAt: alb.lastPlayedAt || alb.savedAt || 0,
        data: alb
      });
    });

    // Followed Artists
    followedArtists.forEach(art => {
      items.push({
        id: art.name,
        type: 'artist',
        title: art.name,
        subtitle: 'Artist • Following',
        cover: art.cover,
        isRound: true,
        savedAt: art.followedAt || 0,
        lastPlayedAt: art.lastPlayedAt || art.followedAt || 0,
        data: art
      });
    });

    // Sort all combined items according to active sort rule
    if (sortBy === 'alpha') {
      return items.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sortBy === 'added') {
      return items.sort((a, b) => b.savedAt - a.savedAt);
    }
    // recent
    return items.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }, [favorites, playlists, officialAlbums, followedArtists, offlineRecords, filteredPCFiles, totalUniqueLocalCount, totalLocalBytes, sortBy]);

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
    setQueue(favorites, 0, 'Liked Music');
    setIsPlaying(true);
  };

  const handlePlayPlaylist = (pl: Playlist) => {
    if (pl.tracks.length === 0) {
      showToast(`"${pl.name}" has no songs yet.`);
      return;
    }
    setQueue(pl.tracks, 0, `${pl.name} Playlist`);
    setIsPlaying(true);
  };

  const handlePlayAllLocal = () => {
    if (combinedLocalTracks.length === 0) {
      showToast('No local audio tracks available to play.');
      return;
    }
    setQueue(combinedLocalTracks, 0, 'Local Files & Offline');
    setIsPlaying(true);
  };

  const handleShuffleLocal = () => {
    if (combinedLocalTracks.length === 0) {
      showToast('No local audio tracks available.');
      return;
    }
    const tracks = [...combinedLocalTracks].sort(() => Math.random() - 0.5);
    setQueue(tracks, 0, 'Local Files (Shuffle)');
    setIsPlaying(true);
  };

  const handleAddLocalFolder = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.addLocalMusicFolder) return;
    const res = await electronAPI.addLocalMusicFolder();
    if (res?.success) {
      showToast(`Added folder to scanner`);
      await scanLocalMusic();
    }
  };

  const handleRemoveLocalFolder = async (folderPath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.removeLocalMusicFolder) return;
    await electronAPI.removeLocalMusicFolder(folderPath);
    showToast('Removed folder');
    await scanLocalMusic();
  };

  const handleOpenFolder = (folderPath?: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openFolder) {
      electronAPI.openFolder(folderPath);
    }
  };

  const handleShowFileInExplorer = (filePath?: string) => {
    const electronAPI = (window as any).electronAPI;
    if (filePath && electronAPI?.showItemInFolder) {
      electronAPI.showItemInFolder(filePath);
    }
  };

  const handleDownloadAllFavorites = () => {
    const unDownloaded = favorites.filter(f => !downloadedTrackIds[f.id]);
    if (unDownloaded.length === 0) {
      showToast('All liked songs are already downloaded!');
      return;
    }
    downloadTrackBatch(unDownloaded, 'Liked Songs');
  };

  // Filter chips configuration matching YouTube Music
  const filterChips: { id: LibraryFilterType; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: unifiedItems.length },
    { id: 'playlists', label: 'Playlists', count: playlists.length + (favorites.length > 0 ? 1 : 0) },
    { id: 'songs', label: 'Liked Songs', count: favorites.length },
    { id: 'albums', label: 'Albums', count: officialAlbums.length },
    { id: 'artists', label: 'Artists', count: followedArtists.length },
    { id: 'downloads', label: 'Local Files & Offline', count: totalUniqueLocalCount }
  ];

  return (
    <div className="library-page-container">
      {/* Top Header & Filter Chips */}
      <div className="library-header">
        <div className="library-title-row">
          <div>
            <h1 className="library-heading">Your Library</h1>
            <p className="library-subheading">
              {playlists.length} playlists • {favorites.length} liked tracks • {officialAlbums.length} saved albums • {followedArtists.length} artists
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

        {/* YouTube Music Style Filter Chips */}
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
        </div>
      </div>

      {/* VIEW: All Saved Items (Unified Grid) */}
      {activeFilter === 'all' && (
        <div className="library-grid">
          {unifiedItems.map(item => {
            if (item.type === 'downloads') {
              return (
                <div 
                  key={item.id}
                  className="library-card liked-music-hero-card"
                  style={{
                    background: 'linear-gradient(135deg, rgba(30, 144, 255, 0.22) 0%, rgba(15, 23, 42, 0.9) 100%)',
                    borderColor: 'rgba(30, 144, 255, 0.3)'
                  }}
                  onClick={() => handleFilterChange('downloads')}
                >
                  <div className="liked-music-art" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                    <HardDrive size={36} color="#ffffff" className="heart-icon-glow" />
                    <div 
                      className="card-play-hover-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayAllOffline();
                      }}
                      title="Play All Offline"
                    >
                      <Play size={22} fill="#000" color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title">Offline Downloads</div>
                    <div className="card-subtitle auto-playlist-tag" style={{ color: '#93c5fd' }}>
                      <HardDrive size={12} color="#93c5fd" />
                      <span>{item.subtitle}</span>
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === 'liked_music') {
              return (
                <div 
                  key={item.id}
                  className="library-card liked-music-hero-card"
                  onClick={() => navigate('/playlist/liked')}
                >
                  <div className="liked-music-art">
                    <Heart size={36} fill="#ffffff" color="#ffffff" className="heart-icon-glow" />
                    <div className="card-play-hover-btn" onClick={(e) => { e.stopPropagation(); handlePlayLikedMusic(); }}>
                      <Play size={22} fill="#000" color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title">Liked Music</div>
                    <div className="card-subtitle auto-playlist-tag">
                      <Sparkles size={12} color="var(--accent-primary)" />
                      <span>{item.subtitle}</span>
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === 'playlist') {
              const pl = item.data as Playlist;
              return (
                <div 
                  key={item.id} 
                  className="library-card playlist-card"
                  onClick={() => {
                    navigate(`/playlist/${pl.id}`);
                  }}
                  onContextMenu={(e) => openPlaylistContextMenu(e, pl)}
                >
                  <div className="card-cover-wrapper" style={{ position: 'relative' }}>
                    <PlaylistCover 
                      tracks={pl.tracks} 
                      cover={pl.cover} 
                      name={pl.name} 
                      borderRadius="8px"
                    />
                    <div 
                      className="card-play-hover-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayPlaylist(pl);
                      }}
                      title="Play Playlist"
                    >
                      <Play size={20} fill="#000" color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title" title={item.title}>{item.title}</div>
                    <div className="card-subtitle">{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            if (item.type === 'album') {
              const alb = item.data as SavedAlbum;
              return (
                <div 
                  key={item.id} 
                  className="library-card album-card"
                  onClick={() => navigate(`/album/${alb.id}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover)}`)}
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
                    <div className="card-play-hover-btn" title="View Album">
                      <Disc3 size={20} color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title" title={alb.name}>{alb.name}</div>
                    <div className="card-subtitle" title={alb.artist}>{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            if (item.type === 'artist') {
              const art = item.data as FollowedArtist;
              return (
                <div 
                  key={item.id} 
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
                    <div className="card-subtitle">{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* VIEW: Playlists Tab */}
      {activeFilter === 'playlists' && (
        <div className="library-grid">
          {/* Liked Music Card */}
          {favorites.length > 0 && (
            <div 
              className="library-card liked-music-hero-card"
              onClick={() => navigate('/playlist/liked')}
            >
              <div className="liked-music-art">
                <Heart size={36} fill="#ffffff" color="#ffffff" className="heart-icon-glow" />
                <div className="card-play-hover-btn" onClick={(e) => { e.stopPropagation(); handlePlayLikedMusic(); }}>
                  <Play size={22} fill="#000" color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title">Liked Music</div>
                <div className="card-subtitle auto-playlist-tag">
                  <Sparkles size={12} color="var(--accent-primary)" />
                  <span>Auto playlist • {favorites.length} tracks</span>
                </div>
              </div>
            </div>
          )}

          {/* Sorted User Playlists & Saved Community Playlists */}
          {sortedPlaylists.map(pl => {
            return (
              <div 
                key={pl.id} 
                className="library-card playlist-card"
                onClick={() => {
                  navigate(`/playlist/${pl.id}`);
                }}
                onContextMenu={(e) => openPlaylistContextMenu(e, pl)}
              >
                <div className="card-cover-wrapper" style={{ position: 'relative' }}>
                  <PlaylistCover 
                    tracks={pl.tracks} 
                    cover={pl.cover} 
                    name={pl.name} 
                    borderRadius="8px"
                  />
                  <div 
                    className="card-play-hover-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayPlaylist(pl);
                    }}
                    title="Play Playlist"
                  >
                    <Play size={20} fill="#000" color="#000" />
                  </div>
                </div>
                <div className="card-meta">
                  <div className="card-title" title={pl.name}>{pl.name}</div>
                  <div className="card-subtitle">
                    {pl.author ? `Playlist • ${pl.author}` : `Playlist • ${Array.isArray(pl.tracks) ? pl.tracks.length : 0} ${(Array.isArray(pl.tracks) && pl.tracks.length === 1) ? 'track' : 'tracks'}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW: Liked Songs Tab (Table view) */}
      {activeFilter === 'songs' && (
        <div className="liked-songs-view-container">
          <div className="liked-songs-header-card">
            <div className="liked-songs-badge-cover">
              <Heart size={44} fill="#fff" color="#fff" />
            </div>
            <div className="liked-songs-info">
              <span className="liked-badge-tag">Auto Playlist</span>
              <h2 className="liked-songs-title">Liked Songs</h2>
              <p className="liked-songs-count">{favorites.length} songs in collection</p>
              <div className="liked-songs-actions-row">
                <button className="modal-play-all-btn" onClick={handlePlayLikedMusic}>
                  <Play size={16} fill="#000" color="#000" />
                  <span>Play All</span>
                </button>
                <button 
                  className="hero-shuffle-btn"
                  onClick={() => {
                    if (favorites.length > 0) {
                      const shuffled = [...favorites].sort(() => Math.random() - 0.5);
                      setQueue(shuffled, 0, 'Liked Songs (Shuffle)');
                      setIsPlaying(true);
                    }
                  }}
                >
                  <Shuffle size={16} />
                  <span>Shuffle</span>
                </button>
              </div>
            </div>
          </div>

          {favorites.length === 0 ? (
            <div className="library-empty-view">
              <Heart size={48} className="empty-icon-pulse" />
              <h3 className="empty-title">No Liked Songs yet</h3>
              <p className="empty-desc">Click the heart icon on any track to add it to your Liked Music.</p>
            </div>
          ) : (
            <div className="liked-tracks-table">
              {favorites.map((track, idx) => (
                <div 
                  key={`${track.id}-${idx}`}
                  className="liked-track-row"
                  onClick={() => {
                    setQueue(favorites, idx, 'Liked Music');
                    setIsPlaying(true);
                  }}
                  onContextMenu={(e) => openTrackContextMenu(e, track)}
                >
                  <span className="track-idx-num">{idx + 1}</span>
                  <img src={track.cover} alt={track.title} className="track-row-thumb" />
                  <div className="track-row-details">
                    <span className="track-row-name">{track.title}</span>
                    <span className="track-row-artist">{track.artist}</span>
                  </div>
                  <span className="track-row-album">{track.album || 'Single'}</span>
                  <button 
                    className="track-row-heart-btn active"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(track);
                    }}
                    title="Remove from Liked Songs"
                  >
                    <Heart size={16} fill="var(--accent-primary)" color="var(--accent-primary)" />
                  </button>
                  <span className="track-row-dur">{formatDuration(track.duration)}</span>
                </div>
              ))}
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
              className="library-card album-card"
              onClick={() => navigate(`/album/${alb.id}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover)}`)}
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
                <div className="card-play-hover-btn" title="View Album">
                  <Disc3 size={20} color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title" title={alb.name}>{alb.name}</div>
                <div className="card-subtitle" title={alb.artist}>Album • {alb.artist}</div>
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

      {/* VIEW: Local Files & Offline Downloads Tab */}
      {activeFilter === 'downloads' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Local Files Hero Dashboard Panel */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(37, 99, 235, 0.3)',
            borderRadius: '16px',
            padding: '24px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '20px',
            flexWrap: 'wrap',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{
                width: '58px',
                height: '58px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(37, 99, 235, 0.45)',
                flexShrink: 0
              }}>
                <Folder size={30} color="#fff" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0', color: 'var(--text-primary)' }}>
                    Local Files & Offline Storage
                  </h2>
                  {isScanning && (
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <RefreshCw size={12} className="animate-spin" /> Scanning PC...
                    </span>
                  )}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                  {totalUniqueLocalCount} {totalUniqueLocalCount === 1 ? 'audio file' : 'audio files'} found • {formatBytes(totalLocalBytes)} • Native playback & Spectrum visualizer
                </p>
              </div>
            </div>

            {/* Quick Actions Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {combinedLocalTracks.length > 0 && (
                <>
                  <button
                    onClick={handlePlayAllLocal}
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
                      cursor: 'pointer',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      transition: 'transform 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <Play size={16} fill="#000" color="#000" />
                    <span>Play All</span>
                  </button>

                  <button
                    onClick={handleShuffleLocal}
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
                      cursor: 'pointer',
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                  >
                    <Shuffle size={15} />
                    <span>Shuffle</span>
                  </button>
                </>
              )}

              {/* Add Folder button (Spotify style) */}
              {(window as any).electronAPI?.addLocalMusicFolder && (
                <button
                  onClick={handleAddLocalFolder}
                  title="Add folder from your PC to scan for music"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '24px',
                    padding: '10px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                >
                  <FolderPlus size={15} color="var(--accent-primary)" />
                  <span>Add Folder</span>
                </button>
              )}

              {/* Open in Windows Explorer */}
              <button
                onClick={() => handleOpenFolder()}
                title="Open Music Folder in Windows Explorer"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '24px',
                  padding: '10px 14px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  transition: 'color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <ExternalLink size={15} />
                <span>Open Folder</span>
              </button>

              {/* Rescan Button */}
              <button
                onClick={() => scanLocalMusic()}
                title="Rescan PC folders"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '24px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={15} className={isScanning ? 'animate-spin' : ''} />
              </button>

              {offlineRecords.length > 0 && (
                <button
                  onClick={async () => {
                    if (window.confirm('Are you sure you want to clear all downloaded offline tracks?')) {
                      await clearAllDownloads();
                      setOfflineRecords([]);
                    }
                  }}
                  title="Clear all downloaded tracks from storage"
                  style={{
                    backgroundColor: 'rgba(231, 76, 60, 0.12)',
                    color: '#e74c3c',
                    border: '1px solid rgba(231, 76, 60, 0.3)',
                    borderRadius: '24px',
                    padding: '10px 14px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Trash2 size={15} />
                  <span>Clear Cache</span>
                </button>
              )}
            </div>
          </div>

          {/* Scanned Folder Chips Bar */}
          {scannedFolders.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '2px 4px'
            }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Scanned Locations:</span>
              {scannedFolders.map((f) => (
                <div
                  key={f}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '16px',
                    padding: '4px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.75rem',
                    color: 'rgba(255,255,255,0.8)'
                  }}
                >
                  <Folder size={12} color="var(--accent-primary)" />
                  <span title={f} style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f}
                  </span>
                  {/* Allow deleting custom non-default folders */}
                  {!f.endsWith('\\Music') && !f.endsWith('/Music') && !f.endsWith('\\Downloads') && !f.endsWith('/Downloads') && (
                    <button
                      onClick={() => handleRemoveLocalFolder(f)}
                      title="Stop scanning this folder"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#e74c3c'}
                      onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sub-Filters & Live Search Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap'
          }}>
            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => setLocalSubTab('all')}
                style={{
                  backgroundColor: localSubTab === 'all' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                  color: localSubTab === 'all' ? '#000' : 'var(--text-secondary)',
                  fontWeight: localSubTab === 'all' ? 700 : 500,
                  border: 'none',
                  borderRadius: '16px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                All Local Files ({totalUniqueLocalCount})
              </button>

              <button
                onClick={() => setLocalSubTab('downloads')}
                style={{
                  backgroundColor: localSubTab === 'downloads' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                  color: localSubTab === 'downloads' ? '#000' : 'var(--text-secondary)',
                  fontWeight: localSubTab === 'downloads' ? 700 : 500,
                  border: 'none',
                  borderRadius: '16px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                App Downloads ({offlineRecords.length})
              </button>

              <button
                onClick={() => setLocalSubTab('local')}
                style={{
                  backgroundColor: localSubTab === 'local' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                  color: localSubTab === 'local' ? '#000' : 'var(--text-secondary)',
                  fontWeight: localSubTab === 'local' ? 700 : 500,
                  border: 'none',
                  borderRadius: '16px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                PC Music Folders ({filteredPCFiles.length})
              </button>
            </div>

            {/* Inline Search Bar */}
            <div style={{
              position: 'relative',
              minWidth: '260px',
              flex: '1',
              maxWidth: '400px'
            }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                placeholder="Search local songs, artists, or filenames..."
                value={localSearchQuery}
                onChange={e => setLocalSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '20px',
                  padding: '8px 32px 8px 36px',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  outline: 'none'
                }}
              />
              {localSearchQuery && (
                <button
                  onClick={() => setLocalSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Local Songs Table / List */}
          {combinedLocalTracks.length > 0 ? (
            <div style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              overflow: 'hidden'
            }}>
              {combinedLocalTracks.map((trk, index) => {
                const isCurrent = usePlayerStore.getState().currentTrack?.id === trk.id;
                const isCurPlaying = isCurrent && usePlayerStore.getState().isPlaying;
                const ext = trk.ext || 'MP3';

                return (
                  <div
                    key={trk.id || trk.filePath || index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '12px 20px',
                      borderBottom: index === combinedLocalTracks.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                      backgroundColor: isCurrent ? 'rgba(30, 144, 255, 0.1)' : 'transparent',
                      transition: 'background-color 0.15s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => {
                      if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                    }}
                    onMouseLeave={e => {
                      if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    onClick={() => {
                      setQueue(combinedLocalTracks, index, 'Local Files & Offline');
                      setIsPlaying(true);
                    }}
                    onContextMenu={(e) => openTrackContextMenu(e, trk)}
                  >
                    {/* Index or Play indicator */}
                    <div style={{ width: '28px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                      {isCurPlaying ? (
                        <Sparkles size={16} color="var(--accent-primary)" />
                      ) : (
                        index + 1
                      )}
                    </div>

                    {/* Thumbnail */}
                    <div style={{ position: 'relative', width: '44px', height: '44px', borderRadius: '8px', overflow: 'hidden', flexShrink: 0, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <img
                        src={trk.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80'}
                        alt={trk.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>

                    {/* Title & Artist */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {trk.title || trk.fileName || 'Untitled Track'}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: '2px'
                      }}>
                        {trk.artist} {trk.album && trk.album !== 'Single' ? `• ${trk.album}` : ''}
                      </div>
                    </div>

                    {/* Audio Format Pill */}
                    <div style={{
                      padding: '3px 8px',
                      borderRadius: '8px',
                      backgroundColor: ext === 'FLAC' ? 'rgba(6, 182, 212, 0.15)' : ext === 'WAV' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.06)',
                      color: ext === 'FLAC' ? '#22d3ee' : ext === 'WAV' ? '#34d399' : 'rgba(255,255,255,0.7)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.5px'
                    }}>
                      .{ext}
                    </div>

                    {/* Size Pill */}
                    <div style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-secondary)'
                    }}>
                      {formatBytes(trk.sizeBytes || 0)}
                    </div>

                    {/* Duration if available */}
                    {trk.duration > 0 && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'right' }}>
                        {formatDuration(trk.duration)}
                      </div>
                    )}

                    {/* 3-Dots Options Menu */}
                    <div onClick={e => e.stopPropagation()}>
                      <TrackOptionsMenu track={trk} variant="row" />
                    </div>

                    {/* Show in Windows Explorer Button */}
                    {trk.filePath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShowFileInExplorer(trk.filePath);
                        }}
                        title="Locate file in Windows Explorer"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'color 0.15s, background-color 0.15s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.color = 'var(--accent-primary)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.color = 'var(--text-secondary)';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <Folder size={16} />
                      </button>
                    )}

                    {/* Quick Remove Button (only for downloaded app tracks) */}
                    {trk.isAppDownload && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDownloadedTrack(trk.id);
                        }}
                        title="Remove from offline downloads"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'color 0.15s, background-color 0.15s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.color = '#e74c3c';
                          e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.12)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.color = 'var(--text-secondary)';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Empty State */
            <div className="library-empty-view" style={{ padding: '60px 20px' }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                backgroundColor: 'rgba(37, 99, 235, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <Folder size={36} color="var(--accent-primary)" />
              </div>
              <h3 className="empty-title">
                {localSearchQuery ? 'No matching local tracks found' : 'No local music found'}
              </h3>
              <p className="empty-desc" style={{ maxWidth: '480px', marginBottom: '24px' }}>
                {localSearchQuery 
                  ? `No audio files matching "${localSearchQuery}" were found in your scanned folders.`
                  : 'Scan your computer\'s Music and Downloads folders, select custom folders from your PC, or download songs for instant offline playback.'}
              </p>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                {(window as any).electronAPI?.addLocalMusicFolder && (
                  <button
                    onClick={handleAddLocalFolder}
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      color: 'var(--text-primary)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '28px',
                      padding: '12px 24px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    <FolderPlus size={16} color="var(--accent-primary)" />
                    <span>Add Music Folder</span>
                  </button>
                )}

                {favorites.length > 0 && (
                  <button
                    onClick={handleDownloadAllFavorites}
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '28px',
                      padding: '12px 24px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
                    }}
                  >
                    <Download size={16} color="#000" />
                    <span>Download Liked Songs ({favorites.length})</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State when no items exist for the active filter */}
      {((activeFilter === 'all' && unifiedItems.length === 0) ||
        (activeFilter === 'playlists' && playlists.length === 0 && favorites.length === 0) ||
        (activeFilter === 'albums' && officialAlbums.length === 0) ||
        (activeFilter === 'artists' && followedArtists.length === 0)) && (
        <div className="library-empty-view">
          <Music2 size={54} className="empty-icon-pulse" />
          <h3 className="empty-title">Your Library is empty</h3>
          <p className="empty-desc">
            {activeFilter === 'all' && 'Like songs, create playlists, save albums, and follow artists to build your personalized library.'}
            {activeFilter === 'playlists' && 'Create custom playlists or like songs to organize your collection.'}
            {activeFilter === 'albums' && 'Save official Albums or EPs using the bookmark icon on album pages.'}
            {activeFilter === 'artists' && 'Click "Follow" on any artist page to add them to your roster.'}
          </p>
        </div>
      )}



      {/* New Playlist Creation Dialog */}
      {showCreateModal && (
        <div className="playlist-detail-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="playlist-detail-modal-dialog" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" style={{ marginBottom: '16px' }}>Create New Playlist</h2>
            <form onSubmit={handleCreateSubmit}>
              <input 
                type="text" 
                placeholder="Playlist name..."
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
                autoFocus
                className="new-playlist-input"
              />
              <div className="modal-footer" style={{ marginTop: '20px' }}>
                <button type="button" className="modal-close-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="modal-play-all-btn">
                  <Check size={16} color="#000" />
                  <span>Create</span>
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
