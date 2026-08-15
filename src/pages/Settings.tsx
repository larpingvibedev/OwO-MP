import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Wifi, 
  CheckCircle2, 
  ShieldCheck, 
  Database, 
  History,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Check,
  Ban,
  UserX,
  Sliders,
  X,
  HardDrive,
  ExternalLink,
  Folder,
  FolderOpen
} from 'lucide-react';
import { SyncModal } from '../components/SyncModal';
import { usePlayerStore } from '../store/usePlayerStore';
import { 
  promptChooseCustomDirectory, 
  getCustomDirectoryName, 
  clearCustomDirectory,
  getPreferredDownloadFormat,
  setPreferredDownloadFormat
} from '../services/downloadService';

export function Settings() {
  const navigate = useNavigate();
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [searchesCleared, setSearchesCleared] = useState(false);
  const [customDirName, setCustomDirName] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<'mp3' | 'm4a'>('mp3');

  useEffect(() => {
    getCustomDirectoryName().then(setCustomDirName);
    getPreferredDownloadFormat().then(setDownloadFormat);
  }, []);

  const handleChooseFolder = async () => {
    const chosen = await promptChooseCustomDirectory();
    if (chosen) {
      setCustomDirName(chosen);
      showToast(`Custom download folder set to "${chosen}"`);
    }
  };

  const handleResetFolder = async () => {
    await clearCustomDirectory();
    setCustomDirName(null);
    showToast('Reset download folder to default browser Downloads directory');
  };

  const handleFormatChange = async (fmt: 'mp3' | 'm4a') => {
    setDownloadFormat(fmt);
    await setPreferredDownloadFormat(fmt);
    showToast(`Default offline export format set to .${fmt.toUpperCase()}`);
  };

  const { 
    clearListeningHistoryAndPreferences,
    clearRecentSearchQueries,
    clearRecentSearchedTracks,
    dislikedTracks,
    blockedArtists,
    downloadedTrackIds,
    clearAllDownloads,
    unmarkTrackNotInterested,
    unblockArtist,
    clearDislikedAndBlocked,
    showToast,
    playHistory,
    recentSearchQueries
  } = usePlayerStore();

  const historyCount = Object.keys(playHistory || {}).length;
  const searchCount = (recentSearchQueries || []).length;

  const handleClearHistory = () => {
    clearListeningHistoryAndPreferences();
    setHistoryCleared(true);
    showToast('Listening history & recommendations cleared (Clean Slate)');
    setTimeout(() => setHistoryCleared(false), 3000);
  };

  const handleClearSearches = () => {
    clearRecentSearchQueries();
    clearRecentSearchedTracks();
    setSearchesCleared(true);
    showToast('Search history cleared');
    setTimeout(() => setSearchesCleared(false), 3000);
  };

  const handleFactoryReset = () => {
    try {
      localStorage.clear();
      window.location.href = '/';
    } catch (e) {
      window.location.reload();
    }
  };

  return (
    <div style={{ paddingBottom: '48px', maxWidth: '820px' }}>
      {showSyncModal && <SyncModal onClose={() => setShowSyncModal(false)} />}

      {/* Confirmation Modal for Factory Reset */}
      {showConfirmReset && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid rgba(255, 71, 87, 0.4)',
            borderRadius: '12px',
            padding: '28px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ff4757', marginBottom: '12px' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Factory Reset Everything?</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: '1.5', marginBottom: '24px' }}>
              This will permanently delete all your <strong>custom playlists</strong>, <strong>liked songs</strong>, <strong>saved albums</strong>, <strong>history</strong>, and <strong>preferences</strong>. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="secondary-btn"
                onClick={() => setShowConfirmReset(false)}
                style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                style={{
                  backgroundColor: '#ff4757',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
              >
                Erase Everything & Reset
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="section-header">Settings & Preferences</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* ========================================================================= */}
        {/* 1. CLEAN SLATE & LISTENING HISTORY                                        */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.15rem' }}>
              <History size={22} color="var(--accent-primary)" />
              <span>Listening History & Recommendation Privacy</span>
            </div>
            <span style={{ 
              fontSize: '0.75rem', 
              padding: '3px 10px', 
              borderRadius: '12px', 
              backgroundColor: 'rgba(52, 152, 219, 0.12)', 
              color: 'var(--accent-primary)',
              fontWeight: 600
            }}>
              Clean Slate Tools
            </span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.45' }}>
            Wipe your listening habits, speed dial cards, quick picks, and algorithmic taste profiles to start fresh with a clean slate. Your personal created playlists and liked songs will remain untouched.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Primary Clean Slate Button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  Clear Listening History & Reset Recommendations
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Resets Speed Dial, Quick Picks, and all Dashboard recommendation carousels ({historyCount} recorded songs).
                </div>
              </div>

              <button
                onClick={handleClearHistory}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 18px',
                  borderRadius: '20px',
                  backgroundColor: historyCleared ? 'rgba(46, 204, 113, 0.2)' : 'rgba(52, 152, 219, 0.15)',
                  border: `1px solid ${historyCleared ? '#2ecc71' : 'var(--accent-primary)'}`,
                  color: historyCleared ? '#2ecc71' : 'var(--accent-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {historyCleared ? <Check size={16} /> : <RotateCcw size={16} />}
                <span>{historyCleared ? 'Clean Slate Activated!' : 'Clear History & Recommendations'}</span>
              </button>
            </div>

            {/* Clear Search History Button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Clear Search History & Queries
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Removes recent search queries and clicked search items ({searchCount} recent searches).
                </div>
              </div>

              <button
                onClick={handleClearSearches}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '16px',
                  backgroundColor: searchesCleared ? 'rgba(46, 204, 113, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${searchesCleared ? '#2ecc71' : 'var(--border-color)'}`,
                  color: searchesCleared ? '#2ecc71' : 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {searchesCleared ? <Check size={14} /> : <Trash2 size={14} />}
                <span>{searchesCleared ? 'Cleared' : 'Clear Searches'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 1.5. ALGORITHM TUNING: NOT INTERESTED & BLOCKED ARTISTS                   */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.15rem' }}>
              <Sliders size={22} color="var(--accent-primary)" />
              <span>Algorithm Tuning & Blocked Preferences</span>
            </div>
            <span style={{ 
              fontSize: '0.75rem', 
              padding: '3px 10px', 
              borderRadius: '12px', 
              backgroundColor: 'rgba(231, 76, 60, 0.12)', 
              color: '#e74c3c',
              fontWeight: 600
            }}>
              {(dislikedTracks?.length || 0) + (blockedArtists?.length || 0)} Excluded
            </span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.45' }}>
            Manage the songs and artists you've marked as "Not interested" or "Don't recommend artist". These are strictly excluded from all autoplay streams, Up Next queues, radio mixes, and discovery carousels.
          </p>

          {/* Blocked Artists Section */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              <UserX size={16} color="#e74c3c" />
              <span>Blocked Artists ({blockedArtists?.length || 0})</span>
            </div>

            {(!blockedArtists || blockedArtists.length === 0) ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px 12px', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                No artists blocked. When you choose "Don't recommend artist" on a track, they'll show up here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {blockedArtists.map(artist => (
                  <div 
                    key={artist}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      backgroundColor: 'rgba(231, 76, 60, 0.1)',
                      border: '1px solid rgba(231, 76, 60, 0.3)',
                      borderRadius: '20px',
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <span>{artist}</span>
                    <button
                      onClick={() => unblockArtist(artist)}
                      title={`Unblock ${artist}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#e74c3c',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%'
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Not Interested Tracks Section */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              <Ban size={16} color="#e74c3c" />
              <span>Not Interested Tracks ({dislikedTracks?.length || 0})</span>
            </div>

            {(!dislikedTracks || dislikedTracks.length === 0) ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px 12px', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                No songs hidden. When you choose "Not interested" on a track, it will be listed here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {dislikedTracks.map(track => (
                  <div 
                    key={track.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '20px',
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)',
                      maxWidth: '320px'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong>{track.title}</strong> &bull; {track.artist}
                    </span>
                    <button
                      onClick={() => unmarkTrackNotInterested(track.id)}
                      title="Restore song recommendations"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        flexShrink: 0
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reset all Blocklists Button if anything is blocked */}
          {((blockedArtists && blockedArtists.length > 0) || (dislikedTracks && dislikedTracks.length > 0)) && (
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={clearDislikedAndBlocked}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <Trash2 size={14} />
                <span>Reset All Blocklists</span>
              </button>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 2. MULTI-DEVICE SYNC                                                      */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: '1px solid var(--border-color)',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
              <Wifi size={20} color="var(--accent-primary)" />
              <span>Multi-Device Sync</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Connect your PC and Mobile phone to control playback remotely (Spotify Connect Style).
            </p>
          </div>
          <button className="hero-play-btn" onClick={() => setShowSyncModal(true)}>
            Open Sync Modal
          </button>
        </div>

        {/* ========================================================================= */}
        {/* 4. AUDIO ENGINE INTEGRATION                                               */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <ShieldCheck size={20} color="var(--accent-secondary)" />
            <span>Official Audio Stream Resolver</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Always stream 100% official YouTube Music studio topic releases, filtering out music videos and fan visualizers.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
            <CheckCircle2 size={16} />
            <span>Active (Universal Studio Topic Resolver Enabled)</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. OFFLINE STORAGE & DOWNLOADS                                            */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem' }}>
              <HardDrive size={20} color="var(--accent-primary)" />
              <span>Offline Downloads & Local Cache</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(30, 144, 255, 0.12)',
              color: 'var(--accent-primary)',
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '0.78rem',
              fontWeight: 700
            }}>
              <CheckCircle2 size={13} />
              <span>IndexedDB Active</span>
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Direct high-bitrate Opus & AAC audio streams are saved directly into your device's browser IndexedDB database for instant zero-buffering offline listening.
          </p>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '16px'
          }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {Object.keys(downloadedTrackIds || {}).length} {Object.keys(downloadedTrackIds || {}).length === 1 ? 'Track' : 'Tracks'} Downloaded
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Offline tracks play with native HTML5 Audio & 64-band Web Audio Spectrum Analyzer
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => navigate('/library?tab=downloads')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#000',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <ExternalLink size={14} />
                <span>View Offline Library</span>
              </button>

              {Object.keys(downloadedTrackIds || {}).length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to clear all offline downloaded tracks?')) {
                      clearAllDownloads();
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(231, 76, 60, 0.12)',
                    color: '#e74c3c',
                    border: '1px solid rgba(231, 76, 60, 0.3)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Trash2 size={14} />
                  <span>Clear All Cache</span>
                </button>
              )}
            </div>
          </div>

          {/* Custom Download Folder Pathway */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {customDirName ? <FolderOpen size={17} color="var(--accent-primary)" /> : <Folder size={17} color="var(--text-secondary)" />}
                <span>Custom Music Download Folder</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                {customDirName 
                  ? `Active target folder: "${customDirName}" on your PC`
                  : 'Default: Standard OS Downloads folder (e.g. C:\\Users\\...\\Downloads)'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {window.electronAPI?.isElectron && (
                <button
                  onClick={() => window.electronAPI?.openFolder(customDirName || undefined)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(255, 0, 127, 0.12)',
                    color: 'var(--accent-primary)',
                    border: '1px solid var(--accent-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Open music downloads folder in Windows File Explorer"
                >
                  <FolderOpen size={14} />
                  <span>Open in Explorer</span>
                </button>
              )}

              <button
                onClick={handleChooseFolder}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Folder size={14} />
                <span>{customDirName ? 'Change Folder' : 'Choose Music Folder'}</span>
              </button>

              {customDirName && (
                <button
                  onClick={handleResetFolder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  <RotateCcw size={13} />
                  <span>Reset Default</span>
                </button>
              )}
            </div>
          </div>

          {/* Preferred Offline Audio Format (.mp3 vs .m4a) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            flexWrap: 'wrap',
            gap: '12px',
            marginTop: '12px'
          }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Preferred Audio Export Format
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                Select format for exported music files saved onto your device
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleFormatChange('mp3')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  backgroundColor: downloadFormat === 'mp3' ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.05)',
                  color: downloadFormat === 'mp3' ? '#000000' : 'var(--text-primary)',
                  border: `1px solid ${downloadFormat === 'mp3' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <span>.MP3 (Universal Standard)</span>
              </button>

              <button
                onClick={() => handleFormatChange('m4a')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  backgroundColor: downloadFormat === 'm4a' ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.05)',
                  color: downloadFormat === 'm4a' ? '#000000' : 'var(--text-primary)',
                  border: `1px solid ${downloadFormat === 'm4a' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <span>.M4A (Apple / AAC)</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 6. DATABASE STORAGE & FACTORY RESET                                       */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <Database size={20} color="var(--accent-primary)" />
            <span>Local Database Storage & Reset</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Your liked songs, custom playlists, queue state, and volume settings are saved to browser local storage.
          </p>
          <button 
            className="secondary-btn"
            onClick={() => setShowConfirmReset(true)}
            style={{ 
              color: '#ff4757', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              borderColor: 'rgba(255, 71, 87, 0.3)'
            }}
          >
            <Trash2 size={15} />
            <span>Factory Reset All Data</span>
          </button>
        </div>
      </div>
    </div>
  );
}
