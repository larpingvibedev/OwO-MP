import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Folder, 
  HardDrive, 
  Play, 
  Shuffle, 
  FolderPlus, 
  RefreshCw, 
  ExternalLink, 
  Search, 
  X, 
  ChevronLeft, 
  Trash2, 
  Sparkles, 
  Music,
  ArrowUpDown,
  FolderOpen
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { getAllOfflineRecords, type OfflineRecord } from '../services/downloadService';
import { TrackOptionsMenu } from '../components/common/TrackOptionsMenu';
import { useContextMenuStore } from '../store/useContextMenuStore';
import type { Track } from '../types';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
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

function cleanTrackKey(artist: string = '', title: string = ''): string {
  const a = (artist || '').toLowerCase().replace(/[\\/:*?"<>|_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const t = (title || '').toLowerCase().replace(/[\\/:*?"<>|_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${a}:::${t}`;
}

export function LocalFiles() {
  const navigate = useNavigate();
  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    downloadedTrackIds,
    syncOfflineTracks,
    removeDownloadedTrack,
    showToast 
  } = usePlayerStore();

  const { openTrackContextMenu } = useContextMenuStore();

  const [localFiles, setLocalFiles] = useState<any[]>([]);
  const [offlineRecords, setOfflineRecords] = useState<OfflineRecord[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFolders, setScannedFolders] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'local' | 'downloads'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'date_desc' | 'title' | 'artist' | 'album' | 'duration' | 'size'>('default');
  const [showFoldersPanel, setShowFoldersPanel] = useState(false);

  // Scan local folders from disk
  const scanLocalMusic = useCallback(async () => {
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

  // Initial load and disk sync listener
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

  // Load offline IndexedDB records
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

  // Handle adding custom folder
  const handleAddLocalFolder = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.addLocalMusicFolder) return;
    try {
      const res = await electronAPI.addLocalMusicFolder();
      if (res && res.success) {
        setScannedFolders(res.folders || []);
        await scanLocalMusic();
        showToast('Music folder added to library');
      }
    } catch (err: any) {
      console.warn('Failed adding folder:', err);
    }
  };

  // Handle removing folder
  const handleRemoveLocalFolder = async (folderPath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.removeLocalMusicFolder) return;
    try {
      const res = await electronAPI.removeLocalMusicFolder(folderPath);
      if (res && res.success) {
        setScannedFolders(res.folders || []);
        await scanLocalMusic();
        showToast('Folder removed from scanning');
      }
    } catch (err: any) {
      console.warn('Failed removing folder:', err);
    }
  };

  // Open default music directory or file in Windows Explorer
  const handleOpenFolder = (targetPath?: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openPathInExplorer) {
      electronAPI.openPathInExplorer(targetPath || '');
    }
  };

  const handleShowFileInExplorer = (filePath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.showItemInFolder) {
      electronAPI.showItemInFolder(filePath);
    } else if (electronAPI?.openPathInExplorer) {
      electronAPI.openPathInExplorer(filePath);
    }
  };

  // Build unified and deduplicated tracks
  const { allCombinedTracks, pcTracksList, downloadsList } = useMemo(() => {
    const diskTrackSignatures = new Set<string>();
    localFiles.forEach(f => {
      diskTrackSignatures.add(cleanTrackKey(f.artist, f.title));
      if (f.fileName) {
        diskTrackSignatures.add(f.fileName.toLowerCase().replace(/\.[^/.]+$/, '').trim());
      }
    });

    // Sort PC tracks oldest first so new tracks are appended to the bottom
    const sortedLocalFiles = [...localFiles].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));

    const pcTracks: Track[] = sortedLocalFiles.map(f => ({
      id: f.id || `local-${encodeURIComponent(f.filePath)}`,
      title: f.title || f.fileName || 'Unknown Title',
      artist: f.artist || 'Local Artist',
      album: f.album || 'Local Audio',
      duration: Math.round(f.duration || 0),
      cover: f.cover || '',
      streamUrl: `http://127.0.0.1:41721/api/local-file?path=${encodeURIComponent(f.filePath)}`,
      source: 'demo' as const,
      isLocal: true,
      filePath: f.filePath,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      ext: f.ext,
      bitrate: f.bitrate,
      sampleRate: f.sampleRate
    }));

    // Sort offline records oldest first so newly downloaded tracks append to the bottom
    const sortedOfflineRecords = [...offlineRecords].sort((a, b) => (a.downloadedAt || 0) - (b.downloadedAt || 0));

    const dlTracks: Track[] = sortedOfflineRecords.map(r => {
      const trk = r.track || {
        id: r.id,
        title: 'Downloaded Song',
        artist: 'Offline Audio',
        duration: 0,
        cover: '',
        streamUrl: ''
      };
      return {
        ...trk,
        isLocal: true,
        isDownloaded: true,
        sizeBytes: r.size || (r.audioBlob ? r.audioBlob.size : 0),
        ext: r.mimeType?.includes('m4a') || r.mimeType?.includes('mp4') ? 'M4A' : 'MP3'
      };
    });

    // Deduplicate: If an offline download matches a scanned local disk file, prioritize disk file
    const filteredDlTracks = dlTracks.filter(dl => {
      const sig = cleanTrackKey(dl.artist, dl.title);
      return !diskTrackSignatures.has(sig);
    });

    const combined = [...pcTracks, ...filteredDlTracks];

    return {
      allCombinedTracks: combined,
      pcTracksList: pcTracks,
      downloadsList: filteredDlTracks
    };
  }, [localFiles, offlineRecords]);

  // Apply tab filter & search
  const displayedTracks = useMemo(() => {
    let list: Track[] = [];
    if (activeTab === 'all') {
      list = [...allCombinedTracks];
    } else if (activeTab === 'local') {
      list = [...pcTracksList];
    } else {
      list = [...downloadsList];
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        ((t as any).fileName && (t as any).fileName.toLowerCase().includes(q)) ||
        ((t as any).filePath && (t as any).filePath.toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortBy === 'date_desc') {
      list = [...list].reverse();
    } else if (sortBy === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortBy === 'artist') {
      list.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (sortBy === 'album') {
      list.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
    } else if (sortBy === 'duration') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (sortBy === 'size') {
      list.sort((a, b) => ((b as any).sizeBytes || 0) - ((a as any).sizeBytes || 0));
    }

    return list;
  }, [allCombinedTracks, pcTracksList, downloadsList, activeTab, searchQuery, sortBy]);

  // Aggregate metrics
  const totalSizeBytes = useMemo(() => {
    return allCombinedTracks.reduce((acc, t) => acc + ((t as any).sizeBytes || 0), 0);
  }, [allCombinedTracks]);

  const handlePlayAll = () => {
    if (displayedTracks.length === 0) return;
    setQueue(displayedTracks, 0, 'Local Files', true, 'user_playlist');
    setIsPlaying(true);
  };

  const handleShuffle = () => {
    if (displayedTracks.length === 0) return;
    const shuffled = [...displayedTracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0, 'Local Files (Shuffle)', true, 'user_playlist');
    setIsPlaying(true);
  };

  return (
    <div style={{ padding: '24px 32px 100px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid var(--border-color)',
            borderRadius: '20px',
            padding: '8px 16px',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
        >
          <ChevronLeft size={16} />
          <span>Back</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowFoldersPanel(!showFoldersPanel)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: showFoldersPanel ? 'rgba(37, 99, 235, 0.25)' : 'rgba(255, 255, 255, 0.06)',
              border: '1px solid ' + (showFoldersPanel ? 'rgba(37, 99, 235, 0.5)' : 'var(--border-color)'),
              borderRadius: '20px',
              padding: '8px 14px',
              color: showFoldersPanel ? '#60a5fa' : 'var(--text-secondary)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            <FolderOpen size={15} />
            <span>Monitored Folders ({scannedFolders.length})</span>
          </button>
        </div>
      </div>

      {/* Hero Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.22) 0%, rgba(15, 23, 42, 0.85) 100%)',
        border: '1px solid rgba(37, 99, 235, 0.35)',
        borderRadius: '20px',
        padding: '32px 36px',
        display: 'flex',
        alignItems: 'center',
        gap: '32px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        marginBottom: '24px',
        flexWrap: 'wrap'
      }}>
        {/* Cover Art Box */}
        <div style={{
          width: '140px',
          height: '140px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 10px 30px rgba(37, 99, 235, 0.5)',
          flexShrink: 0
        }}>
          <Folder size={64} color="#ffffff" />
        </div>

        {/* Info Column */}
        <div style={{ flex: 1, minWidth: '260px' }}>
          <div style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--accent-primary)',
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <HardDrive size={13} />
            <span>System Playlist • Local Audio</span>
          </div>

          <h1 style={{ fontSize: '2.4rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
            Local Files
          </h1>

          <p style={{ margin: '0 0 14px 0', fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
            Audio stored on this computer & offline downloads with instant native playback and lossless spectrum analysis.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            <span><strong style={{ color: 'var(--text-primary)' }}>{allCombinedTracks.length}</strong> songs</span>
            <span>•</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{formatBytes(totalSizeBytes)}</strong> total</span>
            <span>•</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>FLAC / WAV / MP3 / M4A</strong> supported</span>
            {isScanning && (
              <>
                <span>•</span>
                <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <RefreshCw size={13} className="animate-spin" /> Scanning PC folders...
                </span>
              </>
            )}
          </div>
        </div>

        {/* Hero Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {displayedTracks.length > 0 && (
            <>
              <button
                onClick={handlePlayAll}
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '28px',
                  padding: '12px 26px',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
                  transition: 'transform 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <Play size={18} fill="#000" color="#000" />
                <span>Play All</span>
              </button>

              <button
                onClick={handleShuffle}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '28px',
                  padding: '12px 20px',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
              >
                <Shuffle size={16} />
                <span>Shuffle</span>
              </button>
            </>
          )}

          <button
            onClick={handleAddLocalFolder}
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '28px',
              padding: '12px 18px',
              fontSize: '0.88rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer'
            }}
            title="Add a new music folder from your PC"
          >
            <FolderPlus size={16} color="var(--accent-primary)" />
            <span>Add Folder</span>
          </button>

          <button
            onClick={() => scanLocalMusic()}
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            title="Rescan PC folders"
          >
            <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Monitored Folders Panel (Collapsible) */}
      {showFoldersPanel && (
        <div style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '18px 24px',
          marginBottom: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Monitored Locations for Audio Scanning
            </span>
            <button
              onClick={handleAddLocalFolder}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <FolderPlus size={14} /> Add Folder...
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {scannedFolders.map(f => (
              <div
                key={f}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '16px',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.8rem',
                  color: 'rgba(255,255,255,0.9)'
                }}
              >
                <Folder size={14} color="var(--accent-primary)" />
                <span title={f} style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f}
                </span>
                <button
                  onClick={() => handleOpenFolder(f)}
                  title="Open folder in Explorer"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                  <ExternalLink size={12} />
                </button>
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
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs, Search & Sort Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        marginBottom: '18px',
        flexWrap: 'wrap'
      }}>
        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab('all')}
            style={{
              backgroundColor: activeTab === 'all' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: activeTab === 'all' ? '#000' : 'var(--text-secondary)',
              fontWeight: activeTab === 'all' ? 700 : 500,
              border: 'none',
              borderRadius: '16px',
              padding: '7px 16px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            All Files ({allCombinedTracks.length})
          </button>

          <button
            onClick={() => setActiveTab('local')}
            style={{
              backgroundColor: activeTab === 'local' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: activeTab === 'local' ? '#000' : 'var(--text-secondary)',
              fontWeight: activeTab === 'local' ? 700 : 500,
              border: 'none',
              borderRadius: '16px',
              padding: '7px 16px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            PC Folders ({pcTracksList.length})
          </button>

          <button
            onClick={() => setActiveTab('downloads')}
            style={{
              backgroundColor: activeTab === 'downloads' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: activeTab === 'downloads' ? '#000' : 'var(--text-secondary)',
              fontWeight: activeTab === 'downloads' ? 700 : 500,
              border: 'none',
              borderRadius: '16px',
              padding: '7px 16px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            App Downloads ({downloadsList.length})
          </button>
        </div>

        {/* Right Side: Search & Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search local tracks or artists..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
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
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
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

          {/* Sort Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowUpDown size={14} color="var(--text-secondary)" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              style={{
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                padding: '7px 12px',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="default" style={{ backgroundColor: '#181818' }}>Sort: Date Added (Oldest First)</option>
              <option value="date_desc" style={{ backgroundColor: '#181818' }}>Date Added (Newest First)</option>
              <option value="title" style={{ backgroundColor: '#181818' }}>Title (A-Z)</option>
              <option value="artist" style={{ backgroundColor: '#181818' }}>Artist (A-Z)</option>
              <option value="album" style={{ backgroundColor: '#181818' }}>Album (A-Z)</option>
              <option value="duration" style={{ backgroundColor: '#181818' }}>Duration (Longest)</option>
              <option value="size" style={{ backgroundColor: '#181818' }}>File Size (Largest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tracks Table */}
      {displayedTracks.length > 0 ? (
        <div style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          overflow: 'hidden'
        }}>
          {displayedTracks.map((trk, index) => {
            const isCurrent = currentTrack?.id === trk.id;
            const isCurPlaying = isCurrent && isPlaying;
            const ext = (trk as any).ext || 'MP3';

            return (
              <div
                key={trk.id || (trk as any).filePath || index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '12px 20px',
                  borderBottom: index === displayedTracks.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
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
                  setQueue(displayedTracks, index, 'Local Files', true, 'user_playlist');
                  setIsPlaying(true);
                }}
                onContextMenu={(e) => openTrackContextMenu(e, trk)}
              >
                {/* Index / Playing indicator */}
                <div style={{ width: '28px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                  {isCurPlaying ? (
                    <Sparkles size={16} color="var(--accent-primary)" />
                  ) : (
                    index + 1
                  )}
                </div>

                {/* Cover Thumbnail */}
                <div style={{
                  position: 'relative',
                  width: '44px',
                  height: '44px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  flexShrink: 0,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {trk.cover ? (
                    <img
                      src={trk.cover}
                      alt={trk.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Music size={20} color="rgba(255,255,255,0.4)" />
                  )}
                </div>

                {/* Title & Artist */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span>{trk.title || (trk as any).fileName || 'Untitled Track'}</span>
                    {(trk as any).isDownloaded && (
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(46, 204, 113, 0.15)',
                        color: '#2ecc71'
                      }}>
                        Offline
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '2px'
                  }}>
                    {trk.artist} {trk.album && trk.album !== 'Single' && trk.album !== 'Local Audio' ? `• ${trk.album}` : ''}
                  </div>
                </div>

                {/* Format Pill */}
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

                {/* File Size */}
                <div style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)'
                }}>
                  {formatBytes((trk as any).sizeBytes || 0)}
                </div>

                {/* Duration */}
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
                {(trk as any).filePath && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShowFileInExplorer((trk as any).filePath);
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

                {/* Remove Offline Download Button */}
                {(trk as any).isDownloaded && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDownloadedTrack(trk.id);
                    }}
                    title="Remove from offline storage"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
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
            {searchQuery ? 'No matching local tracks found' : 'No local audio files found'}
          </h3>
          <p className="empty-desc" style={{ maxWidth: '480px', marginBottom: '24px' }}>
            {searchQuery 
              ? `No audio files matching "${searchQuery}" were found in your monitored folders.`
              : 'Add your PC music folders or download tracks for instantaneous offline playback.'}
          </p>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={handleAddLocalFolder}
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
                cursor: 'pointer'
              }}
            >
              <FolderPlus size={16} color="#000" />
              <span>Add Music Folder</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
