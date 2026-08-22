import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Wifi, 
  Disc,
  Sliders,
  HardDrive,
  Folder,
  FolderOpen,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Check,
  Ban,
  UserX,
  X,
  ExternalLink,
  FolderPlus,
  RefreshCw,
  User
} from 'lucide-react';
import { SyncModal } from '../components/SyncModal';
import { usePlayerStore } from '../store/usePlayerStore';
import { 
  promptChooseCustomDirectory, 
  getCustomDirectoryName, 
  clearCustomDirectory,
  getPreferredDownloadFormat,
  setPreferredDownloadFormat,
  clearAllOfflineStorage
} from '../services/downloadService';

export function Settings() {
  const navigate = useNavigate();
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [searchesCleared, setSearchesCleared] = useState(false);
  const [customDirName, setCustomDirName] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<'mp3' | 'm4a'>('mp3');
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [localTrackCount, setLocalTrackCount] = useState<number>(0);
  const [isScanningLocal, setIsScanningLocal] = useState<boolean>(false);
  const [youtubeAuthState, setYoutubeAuthState] = useState<'signed_in' | 'signed_out'>('signed_out');

  const checkYoutubeAuth = async () => {
    if (window.electronAPI?.isElectron && window.electronAPI.getYoutubeAuthState) {
      const state = await window.electronAPI.getYoutubeAuthState();
      setYoutubeAuthState(state);
      return state;
    }
    return 'signed_out';
  };

  const scanLocalFolders = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.scanLocalMusicFiles) return;
    setIsScanningLocal(true);
    try {
      const folders = await electronAPI.getLocalMusicFolders?.() || [];
      setLocalFolders(folders);
      const scanned = await electronAPI.scanLocalMusicFiles();
      setLocalTrackCount(Array.isArray(scanned) ? scanned.length : 0);
    } catch (err) {
      console.warn('Scan local files error:', err);
    } finally {
      setIsScanningLocal(false);
    }
  };

  useEffect(() => {
    getCustomDirectoryName().then(setCustomDirName);
    getPreferredDownloadFormat().then(setDownloadFormat);
    scanLocalFolders();
    checkYoutubeAuth();
  }, []);

  const handleAddLocalFolder = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.addLocalMusicFolder) return;
    try {
      const res = await electronAPI.addLocalMusicFolder();
      if (res && res.success) {
        setLocalFolders(res.folders || []);
        await scanLocalFolders();
        showToast('Music folder added to scan list');
      }
    } catch (err) {
      console.warn('Add folder error:', err);
    }
  };

  const handleRemoveLocalFolder = async (folderPath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.removeLocalMusicFolder) return;
    try {
      const res = await electronAPI.removeLocalMusicFolder(folderPath);
      if (res && res.success) {
        setLocalFolders(res.folders || []);
        await scanLocalFolders();
        showToast('Folder removed from scan list');
      }
    } catch (err) {
      console.warn('Remove folder error:', err);
    }
  };

  const handleChooseFolder = async () => {
    const chosen = await promptChooseCustomDirectory();
    if (chosen) {
      setCustomDirName(chosen);
      showToast(`Download folder set to "${chosen}"`);
    }
  };

  const handleResetFolder = async () => {
    await clearCustomDirectory();
    setCustomDirName(null);
    showToast('Reset download folder to default Downloads');
  };

  const handleFormatChange = async (fmt: 'mp3' | 'm4a') => {
    setDownloadFormat(fmt);
    await setPreferredDownloadFormat(fmt);
    showToast(`Download format set to .${fmt.toUpperCase()}`);
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
    recentSearchQueries,
    autoplay,
    toggleAutoplay,
    useRotatingCD,
    toggleRotatingCD,
    discordRpcEnabled,
    toggleDiscordRpc
  } = usePlayerStore();

  const historyCount = Object.keys(playHistory || {}).length;
  const searchCount = (recentSearchQueries || []).length;
  const downloadCount = Object.keys(downloadedTrackIds || {}).length;
  const blockedCount = (dislikedTracks?.length || 0) + (blockedArtists?.length || 0);

  const handleClearHistory = () => {
    clearListeningHistoryAndPreferences();
    setHistoryCleared(true);
    showToast('Listening history & taste profile cleared');
    setTimeout(() => setHistoryCleared(false), 2500);
  };

  const handleClearSearches = () => {
    clearRecentSearchQueries();
    clearRecentSearchedTracks();
    setSearchesCleared(true);
    showToast('Search history cleared');
    setTimeout(() => setSearchesCleared(false), 2500);
  };

  const handleFactoryReset = async () => {
    try {
      await clearAllOfflineStorage().catch(console.warn);
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    } catch (e) {
      window.location.reload();
    }
  };

  const handleYoutubeSignIn = async () => {
    if (window.electronAPI?.isElectron && window.electronAPI.openYoutubeSignIn) {
      await window.electronAPI.openYoutubeSignIn();
      const state = await checkYoutubeAuth();
      if (state === 'signed_in') {
        showToast('Successfully signed in to YouTube');
      }
    }
  };

  const handleYoutubeSignOut = async () => {
    if (window.electronAPI?.isElectron && window.electronAPI.signOutYoutube) {
      await window.electronAPI.signOutYoutube();
      checkYoutubeAuth();
      showToast('Signed out of YouTube');
    }
  };

  return (
    <div className="settings-container">
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
            borderRadius: '14px',
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
              This will permanently delete all your <strong>playlists</strong>, <strong>favorites</strong>, <strong>saved albums</strong>, <strong>listening history</strong>, and <strong>custom preferences</strong>. This action cannot be undone.
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

      <h2 className="section-header" style={{ marginBottom: '8px' }}>Settings & Preferences</h2>
      <p className="settings-header-desc">Customize playback, offline downloads, device connections, and recommendation privacy.</p>

      {/* ========================================================================= */}
      {/* 1. PLAYBACK & VISUALS                                                     */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <Disc size={18} color="var(--accent-primary)" />
            <span>Playback & Visuals</span>
          </div>
        </div>

        {/* Rotating CD Disc Mode */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              <span>Rotating CD Disc Player</span>
              <span className="settings-badge" style={{ backgroundColor: useRotatingCD ? 'rgba(52, 152, 219, 0.15)' : 'rgba(255,255,255,0.06)', color: useRotatingCD ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                {useRotatingCD ? 'Active' : 'Classic Art'}
              </span>
            </div>
            <div className="settings-row-desc">
              Displays album artwork as a spinning vinyl CD with reflection gloss and grooves in the full-screen player.
            </div>
          </div>
          <div 
            className={`settings-switch ${useRotatingCD ? 'active' : ''}`}
            onClick={toggleRotatingCD}
            title="Toggle rotating CD disc mode"
          >
            <div className="settings-switch-thumb" />
          </div>
        </div>

        {/* Autoplay Similar Tracks */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              <span>Autoplay Endless Mix</span>
              <span className="settings-badge" style={{ backgroundColor: autoplay ? 'rgba(46, 204, 113, 0.15)' : 'rgba(255,255,255,0.06)', color: autoplay ? '#2ecc71' : 'var(--text-secondary)' }}>
                {autoplay ? 'On' : 'Off'}
              </span>
            </div>
            <div className="settings-row-desc">
              Automatically keeps the music going with similar tracks when your queue or playlist finishes.
            </div>
          </div>
          <div 
            className={`settings-switch ${autoplay ? 'active' : ''}`}
            onClick={toggleAutoplay}
            title="Toggle autoplay"
          >
            <div className="settings-switch-thumb" />
          </div>
        </div>

        {/* Discord Rich Presence (RPC) */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              <span>Discord Rich Presence</span>
              <span className="settings-badge" style={{ backgroundColor: discordRpcEnabled ? 'rgba(88, 101, 242, 0.18)' : 'rgba(255,255,255,0.06)', color: discordRpcEnabled ? '#5865F2' : 'var(--text-secondary)' }}>
                {discordRpcEnabled ? 'Broadcasting' : 'Off'}
              </span>
            </div>
            <div className="settings-row-desc">
              Broadcast your currently playing song, artist, album art, and progress bar to your Discord profile status.
            </div>
          </div>
          <div 
            className={`settings-switch ${discordRpcEnabled ? 'active' : ''}`}
            onClick={toggleDiscordRpc}
            title="Toggle Discord Rich Presence"
          >
            <div className="settings-switch-thumb" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. OFFLINE & DOWNLOADS                                                    */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <HardDrive size={18} color="var(--accent-primary)" />
            <span>Downloads & Offline Storage</span>
          </div>
          <span className="settings-badge" style={{ backgroundColor: 'rgba(52, 152, 219, 0.12)', color: 'var(--accent-primary)' }}>
            {downloadCount} {downloadCount === 1 ? 'Track' : 'Tracks'} Stored
          </span>
        </div>

        {/* Offline Library Status & Clear */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Offline Music Cache</div>
            <div className="settings-row-desc">
              Tracks stored in local IndexedDB database for instant zero-buffering offline playback.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="settings-btn-primary" onClick={() => navigate('/library?tab=downloads')}>
              <ExternalLink size={13} />
              <span>View Downloads</span>
            </button>
            {downloadCount > 0 && (
              <button 
                className="settings-btn-danger"
                onClick={async () => {
                  if (window.confirm('Clear all offline downloaded songs?')) {
                    await clearAllDownloads();
                  }
                }}
              >
                <Trash2 size={13} />
                <span>Clear Cache</span>
              </button>
            )}
          </div>
        </div>

        {/* Download Folder Path */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              <span>Download Directory</span>
            </div>
            <div className="settings-row-desc">
              {customDirName ? `Custom folder: "${customDirName}"` : 'Default: System Downloads folder'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {window.electronAPI?.isElectron && (
              <button 
                className="settings-btn-secondary"
                onClick={() => window.electronAPI?.openFolder?.(customDirName || undefined)}
                title="Open download folder in File Explorer"
              >
                <FolderOpen size={13} />
                <span>Open Folder</span>
              </button>
            )}
            <button className="settings-btn-secondary" onClick={handleChooseFolder}>
              <Folder size={13} />
              <span>{customDirName ? 'Change Folder' : 'Choose Folder'}</span>
            </button>
            {customDirName && (
              <button className="settings-btn-secondary" onClick={handleResetFolder} title="Reset to default">
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Export Audio Format */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Export Audio Format</div>
            <div className="settings-row-desc">
              Format used when exporting music files to your device.
            </div>
          </div>
          <div className="settings-segment-group">
            <button 
              className={`settings-segment-btn ${downloadFormat === 'mp3' ? 'active' : ''}`}
              onClick={() => handleFormatChange('mp3')}
            >
              .MP3 (Universal)
            </button>
            <button 
              className={`settings-segment-btn ${downloadFormat === 'm4a' ? 'active' : ''}`}
              onClick={() => handleFormatChange('m4a')}
            >
              .M4A (AAC)
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. LOCAL FILES & PC MUSIC FOLDERS                                         */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <Folder size={18} color="var(--accent-primary)" />
            <span>Local Files & PC Music Scanner</span>
          </div>
          <span className="settings-badge" style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa' }}>
            {localTrackCount} {localTrackCount === 1 ? 'Audio File' : 'Audio Files'} Indexed
          </span>
        </div>

        {/* Scan Status & View */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">PC Music Library Index</div>
            <div className="settings-row-desc">
              Scans your computer's Music and Downloads folders plus custom directories for native lossless playback.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="settings-btn-primary" onClick={() => navigate('/playlist/local-files')}>
              <FolderOpen size={13} />
              <span>Open Local Files</span>
            </button>
            <button 
              className="settings-btn-secondary"
              onClick={scanLocalFolders}
              disabled={isScanningLocal}
              title="Rescan all PC music folders now"
            >
              <RefreshCw size={13} className={isScanningLocal ? 'animate-spin' : ''} />
              <span>{isScanningLocal ? 'Scanning...' : 'Scan Now'}</span>
            </button>
          </div>
        </div>

        {/* Monitored Locations List */}
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <div className="settings-row-label">Monitored Folders ({localFolders.length})</div>
            <button className="settings-btn-secondary" onClick={handleAddLocalFolder}>
              <FolderPlus size={13} color="var(--accent-primary)" />
              <span>Add Folder</span>
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
            {localFolders.map(folder => (
              <div 
                key={folder}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '16px',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.85)'
                }}
              >
                <Folder size={13} color="var(--accent-primary)" />
                <span title={folder} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folder}
                </span>
                {!folder.endsWith('\\Music') && !folder.endsWith('/Music') && !folder.endsWith('\\Downloads') && !folder.endsWith('/Downloads') && (
                  <button
                    onClick={() => handleRemoveLocalFolder(folder)}
                    title="Remove folder from scan"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.4)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e74c3c'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. MULTI-DEVICE CONNECT                                                   */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <Wifi size={18} color="var(--accent-primary)" />
            <span>Connected Devices</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Spotify Connect Remote Sync</div>
            <div className="settings-row-desc">
              Pair your phone, tablet, or secondary computer to control playback in real-time.
            </div>
          </div>
          <button className="settings-btn-primary" onClick={() => setShowSyncModal(true)}>
            <Wifi size={13} />
            <span>Pair Device</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. PRIVACY & ALGORITHM FILTERS                                            */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <Sliders size={18} color="var(--accent-primary)" />
            <span>Privacy & Algorithm Preferences</span>
          </div>
          {blockedCount > 0 && (
            <span className="settings-badge" style={{ backgroundColor: 'rgba(231, 76, 60, 0.15)', color: '#ff5252' }}>
              {blockedCount} Excluded
            </span>
          )}
        </div>

        {/* Listening History Clean Slate */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Listening History & Recommendations</div>
            <div className="settings-row-desc">
              {historyCount > 0 
                ? `${historyCount} tracks recorded. Clears Speed Dial, Quick Picks, and Dashboard taste clusters.` 
                : 'No history recorded. Recommendations are fresh.'}
            </div>
          </div>
          <button 
            className="settings-btn-secondary"
            onClick={handleClearHistory}
            style={{ color: historyCleared ? '#2ecc71' : undefined, borderColor: historyCleared ? '#2ecc71' : undefined }}
          >
            {historyCleared ? <Check size={14} /> : <RotateCcw size={14} />}
            <span>{historyCleared ? 'History Cleared' : 'Clear History'}</span>
          </button>
        </div>

        {/* Search Queries History */}
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Recent Search History</div>
            <div className="settings-row-desc">
              {searchCount > 0 
                ? `${searchCount} recent search queries and suggestions.` 
                : 'No recent searches.'}
            </div>
          </div>
          <button 
            className="settings-btn-secondary"
            onClick={handleClearSearches}
            style={{ color: searchesCleared ? '#2ecc71' : undefined, borderColor: searchesCleared ? '#2ecc71' : undefined }}
          >
            {searchesCleared ? <Check size={14} /> : <Trash2 size={14} />}
            <span>{searchesCleared ? 'Cleared' : 'Clear Searches'}</span>
          </button>
        </div>

        {/* Blocked Artists & Songs Section */}
        {blockedCount > 0 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Excluded Content ({blockedCount})
              </span>
              <button 
                onClick={clearDislikedAndBlocked}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Restore All
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {/* Blocked Artists */}
              {(blockedArtists || []).map(artist => (
                <div 
                  key={artist}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '14px',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    border: '1px solid rgba(231, 76, 60, 0.3)',
                    color: '#ff6b6b',
                    fontSize: '0.78rem',
                    fontWeight: 600
                  }}
                >
                  <UserX size={12} />
                  <span>{artist}</span>
                  <button
                    onClick={() => unblockArtist(artist)}
                    title={`Unblock ${artist}`}
                    style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', display: 'flex', padding: '1px' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              {/* Hidden Songs */}
              {(dislikedTracks || []).map(track => (
                <div 
                  key={track.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    fontSize: '0.78rem',
                    maxWidth: '260px'
                  }}
                >
                  <Ban size={12} color="#ff6b6b" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {track.title}
                  </span>
                  <button
                    onClick={() => unmarkTrackNotInterested(track.id)}
                    title="Restore song recommendations"
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: '1px' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 5. YOUTUBE AUTHENTICATION                                                 */}
      {/* ========================================================================= */}
      <div className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-title">
            <User size={18} color="var(--accent-primary)" />
            <span>YouTube Account</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Sign In to YouTube</div>
            <div className="settings-row-desc">
              Sign in to play age-restricted and member-only content natively. 
              <br />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                Status: {youtubeAuthState === 'signed_in' ? <strong style={{color: '#2ecc71'}}>Signed In</strong> : <strong>Signed Out</strong>}
              </span>
            </div>
          </div>
          {youtubeAuthState === 'signed_in' ? (
            <button className="settings-btn-secondary" onClick={handleYoutubeSignOut}>
              <X size={14} />
              <span>Sign Out</span>
            </button>
          ) : (
            <button className="settings-btn-primary" onClick={handleYoutubeSignIn}>
              <User size={14} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 6. DATA & FACTORY RESET                                                   */}
      {/* ========================================================================= */}
      <div className="settings-group" style={{ borderColor: 'rgba(255, 71, 87, 0.25)' }}>
        <div className="settings-group-header" style={{ backgroundColor: 'rgba(255, 71, 87, 0.04)' }}>
          <div className="settings-group-title" style={{ color: '#ff5252' }}>
            <Trash2 size={18} color="#ff5252" />
            <span>Danger Zone</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label" style={{ color: '#ff5252' }}>Factory Reset All Data</div>
            <div className="settings-row-desc">
              Permanently clears local database, custom playlists, liked songs, and restores factory defaults.
            </div>
          </div>
          <button className="settings-btn-danger" onClick={() => setShowConfirmReset(true)}>
            <AlertTriangle size={13} />
            <span>Reset All Data</span>
          </button>
        </div>
      </div>
    </div>
  );
}
