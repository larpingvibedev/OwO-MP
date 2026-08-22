import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Folder, 
  Play, 
  Shuffle, 
  FolderPlus, 
  RefreshCw, 
  ExternalLink, 
  Search, 
  X, 
  ChevronLeft, 
  Trash2, 
  Music, 
  ArrowUpDown, 
  FolderOpen, 
  Settings2, 
  FileAudio 
} from 'lucide-react';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useContextMenuStore } from '../../store/useContextMenuStore';
import type { Track } from '../../types';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface LocalFilesViewProps {
  embedded?: boolean;
  onBack?: () => void;
}

export const LocalFilesView: React.FC<LocalFilesViewProps> = ({ embedded = false, onBack }) => {
  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    showToast 
  } = usePlayerStore();

  const { openTrackContextMenu } = useContextMenuStore();

  const [localFiles, setLocalFiles] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFolders, setScannedFolders] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'date_desc' | 'title' | 'artist' | 'album' | 'duration' | 'size'>('default');
  const [showFoldersModal, setShowFoldersModal] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);

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
    scanLocalMusic();

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onDiskFolderChanged) {
      const cleanup = electronAPI.onDiskFolderChanged(() => {
        scanLocalMusic();
      });
      return cleanup;
    }
  }, [scanLocalMusic]);

  // Handle adding custom folder
  const handleAddLocalFolder = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.addLocalMusicFolder) return;
    try {
      const res = await electronAPI.addLocalMusicFolder();
      if (res && res.success) {
        setScannedFolders(res.folders || []);
        await scanLocalMusic();
        showToast('Music folder added to scanner');
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

  // Open directory or file in Windows Explorer
  const handleOpenFolder = (targetPath?: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openFolder) {
      electronAPI.openFolder(targetPath || '');
    }
  };

  const handleShowFileInExplorer = (filePath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.showItemInFolder) {
      electronAPI.showItemInFolder(filePath);
    } else if (electronAPI?.openFolder) {
      electronAPI.openFolder(filePath);
    }
  };

  // Optimistic deletion handler
  const handleDeleteTrack = async (track: Track) => {
    if (!track.filePath) return;
    if (!window.confirm(`Are you sure you want to move "${track.title}" to the Recycle Bin?`)) {
      return;
    }

    // Optimistically remove from state immediately
    setLocalFiles((prev: any[]) => prev.filter((f: any) => f.filePath !== track.filePath));
    showToast(`Moving "${track.title}" to Recycle Bin...`);

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.deleteLocalMusicFile) {
      try {
        const res = await electronAPI.deleteLocalMusicFile(track.filePath);
        if (res?.success) {
          showToast(`Deleted from PC`);
        } else {
          showToast(`Could not delete file: ${res?.error || 'Unknown error'}`);
          scanLocalMusic();
        }
      } catch (err) {
        console.error('Failed to delete file:', err);
        scanLocalMusic();
      }
    }
  };

  // Convert raw scanned files to canonical Track objects
  const pcTracks: Track[] = useMemo(() => {
    const sorted = [...localFiles].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    return sorted.map(f => ({
      id: f.id || `local-${encodeURIComponent(f.filePath)}`,
      title: f.title || f.fileName || 'Unknown Title',
      artist: f.artist || 'Local Artist',
      album: f.album || 'Local Audio',
      duration: Math.round(f.duration || 0),
      cover: f.cover || '',
      streamUrl: `http://127.0.0.1:41721/api/local-file?path=${encodeURIComponent(f.filePath)}`,
      source: 'local' as const,
      isLocal: true,
      filePath: f.filePath,
      fileName: f.fileName,
      folderPath: f.folder,
      folder: f.folder,
      sizeBytes: f.sizeBytes,
      ext: f.ext,
      bitrate: f.bitrate,
      sampleRate: f.sampleRate
    }));
  }, [localFiles]);

  // Filter and sort tracks
  const displayedTracks = useMemo(() => {
    let list = pcTracks;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        (t.fileName && t.fileName.toLowerCase().includes(q)) ||
        (t.ext && t.ext.toLowerCase().includes(q))
      );
    }

    const sorted = [...list];
    switch (sortBy) {
      case 'date_desc':
        return sorted.reverse();
      case 'title':
        return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'artist':
        return sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
      case 'album':
        return sorted.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
      case 'duration':
        return sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      case 'size':
        return sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
      default:
        return sorted;
    }
  }, [pcTracks, searchQuery, sortBy]);

  const totalLocalBytes = useMemo(() => {
    return pcTracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);
  }, [pcTracks]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {/* Header Dashboard Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.22) 0%, rgba(15, 23, 42, 0.85) 100%)',
        border: '1px solid rgba(37, 99, 235, 0.35)',
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
          {!embedded && onBack && (
            <button 
              onClick={onBack}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                marginRight: '6px'
              }}
              title="Go Back"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.45)',
            flexShrink: 0
          }}>
            <Folder size={28} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Local Files
              </h1>
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
              {pcTracks.length} {pcTracks.length === 1 ? 'audio file' : 'audio files'} • {formatBytes(totalLocalBytes)} • {scannedFolders.length} {scannedFolders.length === 1 ? 'folder' : 'folders'} scanned
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {pcTracks.length > 0 && (
            <>
              <button
                onClick={handlePlayAll}
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
                onClick={handleShuffle}
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

          {/* Add Folder Button */}
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

          {/* Manage Folders Modal Toggle */}
          <button
            onClick={() => setShowFoldersModal(true)}
            title="Manage scanned folders"
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
            <FolderOpen size={15} />
            <span>Manage Folders</span>
          </button>

          {/* Rescan Button */}
          <button
            onClick={() => scanLocalMusic()}
            title="Rescan PC folders for newly added or removed songs"
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
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
            <span>Rescan</span>
          </button>
        </div>
      </div>

      {/* Filter, Search & Technical View Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '14px',
        flexWrap: 'wrap'
      }}>
        {/* Search Input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid var(--border-color)',
          borderRadius: '20px',
          padding: '7px 14px',
          flex: '1 1 260px',
          maxWidth: '400px'
        }}>
          <Search size={15} color="var(--text-secondary)" />
          <input
            type="text"
            placeholder="Search local music by title, artist, album..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              outline: 'none',
              width: '100%'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort & Tech Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-color)',
            borderRadius: '20px',
            padding: '6px 12px'
          }}>
            <ArrowUpDown size={14} color="var(--text-secondary)" />
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="default" style={{ background: '#1e1e24' }}>Default Order</option>
              <option value="date_desc" style={{ background: '#1e1e24' }}>Recently Added</option>
              <option value="title" style={{ background: '#1e1e24' }}>Title (A-Z)</option>
              <option value="artist" style={{ background: '#1e1e24' }}>Artist (A-Z)</option>
              <option value="album" style={{ background: '#1e1e24' }}>Album (A-Z)</option>
              <option value="duration" style={{ background: '#1e1e24' }}>Duration</option>
              <option value="size" style={{ background: '#1e1e24' }}>File Size</option>
            </select>
          </div>

          <button
            onClick={() => setShowTechDetails((prev: boolean) => !prev)}
            title="Toggle audio format, bitrate & sample rate columns"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: showTechDetails ? 'rgba(37, 99, 235, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${showTechDetails ? 'rgba(37, 99, 235, 0.5)' : 'var(--border-color)'}`,
              borderRadius: '20px',
              padding: '6px 14px',
              color: showTechDetails ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <FileAudio size={14} />
            <span>Audio Details</span>
          </button>
        </div>
      </div>

      {/* Tracks Table / List */}
      {displayedTracks.length > 0 ? (
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          overflow: 'hidden'
        }}>
          {/* Table Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: showTechDetails ? '48px 1fr 1fr 120px 100px 70px 48px' : '48px 1fr 1fr 80px 48px',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '0.78rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)'
          }}>
            <div style={{ textAlign: 'center' }}>#</div>
            <div>Title</div>
            <div>Album</div>
            {showTechDetails && <div>Format / Rate</div>}
            {showTechDetails && <div>Size</div>}
            <div style={{ textAlign: 'right' }}>Time</div>
            <div />
          </div>

          {/* Track Rows */}
          {displayedTracks.map((trk: Track, index: number) => {
            const isThisPlaying = currentTrack?.id === trk.id && isPlaying;
            const isThisCurrent = currentTrack?.id === trk.id;

            return (
              <div
                key={trk.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: showTechDetails ? '48px 1fr 1fr 120px 100px 70px 48px' : '48px 1fr 1fr 80px 48px',
                  padding: '10px 16px',
                  alignItems: 'center',
                  borderBottom: index === displayedTracks.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  backgroundColor: isThisCurrent ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                  transition: 'background-color 0.12s'
                }}
                onMouseEnter={e => {
                  if (!isThisCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={e => {
                  if (!isThisCurrent) e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={() => {
                  setQueue(displayedTracks, index, 'Local Files', true, 'user_playlist');
                  setIsPlaying(true);
                }}
                onContextMenu={(e) => {
                  openTrackContextMenu(e, trk, {
                    onDeleteFromPC: () => handleDeleteTrack(trk),
                    onShowInExplorer: () => trk.filePath && handleShowFileInExplorer(trk.filePath)
                  });
                }}
              >
                {/* Index / Play Indicator */}
                <div style={{ textAlign: 'center', color: isThisCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)', fontSize: '0.84rem' }}>
                  {isThisPlaying ? (
                    <Play size={14} fill="var(--accent-primary)" color="var(--accent-primary)" style={{ margin: '0 auto' }} />
                  ) : (
                    index + 1
                  )}
                </div>

                {/* Title & Artist */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, paddingRight: '12px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '6px',
                    background: trk.cover ? `url(${trk.cover}) center/cover` : 'rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {!trk.cover && <Music size={16} color="var(--text-secondary)" />}
                  </div>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{
                      color: isThisCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.88rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {trk.title}
                    </div>
                    <div style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.78rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: '2px'
                    }}>
                      {trk.artist}
                    </div>
                  </div>
                </div>

                {/* Album */}
                <div style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.84rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  paddingRight: '12px'
                }}>
                  {trk.album || '—'}
                </div>

                {/* Format / Bitrate (Optional) */}
                {showTechDetails && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                    <span style={{
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      color: 'var(--text-primary)'
                    }}>
                      {trk.ext ? trk.ext.toUpperCase() : 'AUDIO'}
                    </span>
                    {trk.bitrate && (
                      <span style={{ marginLeft: '6px' }}>{Math.round(trk.bitrate / 1000)}k</span>
                    )}
                  </div>
                )}

                {/* File Size (Optional) */}
                {showTechDetails && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {formatBytes(trk.sizeBytes)}
                  </div>
                )}

                {/* Duration */}
                <div style={{ textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                  {formatDuration(trk.duration)}
                </div>

                {/* Action Context Menu */}
                <div style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      openTrackContextMenu(e, trk, {
                        onDeleteFromPC: () => handleDeleteTrack(trk),
                        onShowInExplorer: () => trk.filePath && handleShowFileInExplorer(trk.filePath)
                      });
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '50%'
                    }}
                    title="Track Options"
                  >
                    <Settings2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Folder size={32} color="var(--accent-primary)" />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
              {searchQuery ? 'No matching local audio files found' : 'No local music found in scanned folders'}
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '440px' }}>
              {searchQuery ? 'Try clearing your search query.' : 'Add your PC music folders (Downloads, Music, Desktop) to automatically scan and play your personal MP3, FLAC, and WAV collection.'}
            </p>
          </div>
          {!searchQuery && (
            <button
              onClick={handleAddLocalFolder}
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: '#000',
                border: 'none',
                borderRadius: '24px',
                padding: '10px 22px',
                fontSize: '0.88rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                marginTop: '8px'
              }}
            >
              <FolderPlus size={16} fill="#000" color="#000" />
              <span>Add Music Folder</span>
            </button>
          )}
        </div>
      )}

      {/* Scanned Folders Management Modal */}
      {showFoldersModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }} onClick={() => setShowFoldersModal(false)}>
          <div style={{
            backgroundColor: '#18181c',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '560px',
            boxShadow: '0 24px 48px rgba(0,0,0,0.8)',
            overflow: 'hidden'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 22px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FolderOpen size={20} color="var(--accent-primary)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Manage Scanned PC Folders</h3>
              </div>
              <button
                onClick={() => setShowFoldersModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Folder List */}
            <div style={{ padding: '20px 22px', maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {scannedFolders.map((fld: string) => (
                <div key={fld} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '10px 14px'
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }} title={fld}>
                      {fld}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => handleOpenFolder(fld)}
                      title="Open in Windows Explorer"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>Open</span>
                    </button>
                    <button
                      onClick={() => handleRemoveLocalFolder(fld)}
                      title="Remove folder from scanner"
                      style={{
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid rgba(231, 76, 60, 0.3)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: '#e74c3c',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))}

              {scannedFolders.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  No custom folders configured. Default Windows Music directory will be scanned.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 22px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(0,0,0,0.2)'
            }}>
              <button
                onClick={handleAddLocalFolder}
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '20px',
                  padding: '8px 18px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <FolderPlus size={15} fill="#000" color="#000" />
                <span>Add Another Folder</span>
              </button>

              <button
                onClick={() => setShowFoldersModal(false)}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '20px',
                  padding: '8px 18px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
