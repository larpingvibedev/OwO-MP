import React, { useState, useEffect, useMemo } from 'react';
import { 
  HardDrive, 
  Play, 
  Shuffle, 
  Trash2, 
  Search, 
  X, 
  Music, 
  ArrowUpDown, 
  Settings2, 
  Download 
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

export const DownloadsView: React.FC = () => {
  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    offlineRecords,
    syncOfflineTracks,
    clearAllDownloads
  } = usePlayerStore();

  const { openTrackContextMenu } = useContextMenuStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'date_desc' | 'title' | 'artist' | 'duration' | 'size'>('default');

  // Sync offline records on mount
  useEffect(() => {
    syncOfflineTracks();
  }, [syncOfflineTracks]);

  // Convert offline records into Track objects preserving online catalog identities
  const downloadedTracks: Track[] = useMemo(() => {
    const sorted = [...(offlineRecords || [])].sort((a, b) => (a.downloadedAt || 0) - (b.downloadedAt || 0));
    return sorted.map(r => ({
      ...r.track,
      source: 'youtube' as const,
      isDownloaded: true,
      isAppDownload: true,
      downloadRecordId: r.id,
      sizeBytes: r.size || r.audioBlob?.size || 0,
      ext: r.mimeType?.includes('m4a') || r.mimeType?.includes('mp4') ? 'M4A' : 'MP3'
    }));
  }, [offlineRecords]);

  // Filter and sort tracks
  const displayedTracks = useMemo(() => {
    let list = downloadedTracks;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
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
      case 'duration':
        return sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      case 'size':
        return sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
      default:
        return sorted;
    }
  }, [downloadedTracks, searchQuery, sortBy]);

  const totalDownloadedBytes = useMemo(() => {
    return downloadedTracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);
  }, [downloadedTracks]);

  const handlePlayAll = () => {
    if (displayedTracks.length === 0) return;
    setQueue(displayedTracks, 0, 'Offline Downloads', true, 'user_playlist');
    setIsPlaying(true);
  };

  const handleShuffle = () => {
    if (displayedTracks.length === 0) return;
    const shuffled = [...displayedTracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0, 'Offline Downloads (Shuffle)', true, 'user_playlist');
    setIsPlaying(true);
  };

  const handleClearAll = async () => {
    if (window.confirm('Are you sure you want to remove all offline downloaded tracks from storage?')) {
      await clearAllDownloads();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {/* Header Dashboard Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(15, 23, 42, 0.85) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
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
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(16, 185, 129, 0.45)',
            flexShrink: 0
          }}>
            <HardDrive size={28} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Offline Downloads
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
              {downloadedTracks.length} {downloadedTracks.length === 1 ? 'downloaded track' : 'downloaded tracks'} • {formatBytes(totalDownloadedBytes)} storage used • Zero-buffering instant playback
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {downloadedTracks.length > 0 && (
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

              <button
                onClick={handleClearAll}
                title="Remove all downloaded tracks from storage"
                style={{
                  backgroundColor: 'rgba(231, 76, 60, 0.12)',
                  color: '#e74c3c',
                  border: '1px solid rgba(231, 76, 60, 0.3)',
                  borderRadius: '24px',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.2)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.12)'}
              >
                <Trash2 size={15} />
                <span>Clear All</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & Sort Bar */}
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
            placeholder="Search downloaded songs..."
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

        {/* Sort Dropdown */}
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
            <option value="date_desc" style={{ background: '#1e1e24' }}>Recently Downloaded</option>
            <option value="title" style={{ background: '#1e1e24' }}>Title (A-Z)</option>
            <option value="artist" style={{ background: '#1e1e24' }}>Artist (A-Z)</option>
            <option value="duration" style={{ background: '#1e1e24' }}>Duration</option>
            <option value="size" style={{ background: '#1e1e24' }}>File Size</option>
          </select>
        </div>
      </div>

      {/* Tracks Table */}
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
            gridTemplateColumns: '48px 1fr 1fr 90px 70px 48px',
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
            <div>Size</div>
            <div style={{ textAlign: 'right' }}>Time</div>
            <div />
          </div>

          {/* Track Rows */}
          {displayedTracks.map((trk, index) => {
            const isThisPlaying = currentTrack?.id === trk.id && isPlaying;
            const isThisCurrent = currentTrack?.id === trk.id;

            return (
              <div
                key={trk.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 1fr 1fr 90px 70px 48px',
                  padding: '10px 16px',
                  alignItems: 'center',
                  borderBottom: index === displayedTracks.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  backgroundColor: isThisCurrent ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                  transition: 'background-color 0.12s'
                }}
                onMouseEnter={e => {
                  if (!isThisCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={e => {
                  if (!isThisCurrent) e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={() => {
                  setQueue(displayedTracks, index, 'Offline Downloads', true, 'user_playlist');
                  setIsPlaying(true);
                }}
                onContextMenu={(e) => {
                  openTrackContextMenu(e, trk);
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

                {/* File Size */}
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  {formatBytes(trk.sizeBytes)}
                </div>

                {/* Duration */}
                <div style={{ textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                  {formatDuration(trk.duration)}
                </div>

                {/* Action Context Menu */}
                <div style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      openTrackContextMenu(e, trk);
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
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Download size={32} color="#10b981" />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
              {searchQuery ? 'No matching downloaded tracks found' : 'No offline downloads yet'}
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '440px' }}>
              {searchQuery ? 'Try clearing your search query.' : 'Click the download button or 3-dots menu on any song or playlist to save it for zero-buffering offline playback.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
