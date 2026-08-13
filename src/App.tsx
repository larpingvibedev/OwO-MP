import React, { useState, useEffect } from 'react';
import { 
  Home, 
  Search, 
  Library, 
  ListMusic, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  MonitorSpeaker,
  Disc3,
  Heart,
  Wifi,
  Loader2
} from 'lucide-react';
import { usePlayerStore } from './store/usePlayerStore';
import { AudioPlayer } from './components/AudioPlayer';
import { SyncModal } from './components/SyncModal';
import { searchFreeMusic } from './services/musicSearch';
import { syncManager } from './services/syncService';
import type { Track } from './types';
import './App.css';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function App() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    activeView,
    searchQuery,
    searchResults,
    isSearching,
    queue,
    favorites,
    togglePlayPause,
    nextTrack,
    prevTrack,
    setVolume,
    setCurrentTime,
    setActiveView,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
    setCurrentTrack,
    setIsPlaying,
    toggleFavorite
  } = usePlayerStore();

  const [showSyncModal, setShowSyncModal] = useState(false);

  // Debounced search for free music sources
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchFreeMusic(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchResults, setIsSearching]);

  // Broadcast state changes for real-time sync
  useEffect(() => {
    if (currentTrack) {
      syncManager.broadcast({
        type: 'SYNC_STATE',
        track: currentTrack,
        isPlaying,
        currentTime
      });
    }
  }, [currentTrack, isPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    const newTime = percentage * duration;
    setCurrentTime(newTime);
    
    syncManager.broadcast({
      type: 'SEEK',
      currentTime: newTime
    });

    const audioElement = document.querySelector('audio');
    if (audioElement) {
      audioElement.currentTime = newTime;
    }
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newVolume = Math.max(0, Math.min(1, clickX / rect.width));
    setVolume(newVolume);
  };

  const handlePlayTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
    syncManager.broadcast({
      type: 'PLAY_TRACK',
      track,
      isPlaying: true,
      currentTime: 0
    });
  };

  const handleTogglePlay = () => {
    togglePlayPause();
    syncManager.broadcast({
      type: 'TOGGLE_PLAY',
      isPlaying: !isPlaying
    });
  };


  return (
    <div className="app-container">
      {/* Invisible HTML5 Audio Handler */}
      <AudioPlayer />

      {/* Device Sync Modal */}
      {showSyncModal && <SyncModal onClose={() => setShowSyncModal(false)} />}

      {/* Main Wrapper for Sidebar + Content */}
      <div className="main-wrapper">
        
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <Disc3 className="icon" size={28} />
            Nuclear Plus
          </div>
          
          <nav className="sidebar-nav">
            <div 
              className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              <Home size={20} className="icon" />
              <span>Dashboard</span>
            </div>
            <div 
              className={`nav-item ${activeView === 'discover' ? 'active' : ''}`}
              onClick={() => setActiveView('discover')}
            >
              <Search size={20} className="icon" />
              <span>Discover</span>
            </div>
            
            <div className="nav-section-title">Your Library</div>
            <div 
              className={`nav-item ${activeView === 'albums' ? 'active' : ''}`}
              onClick={() => setActiveView('albums')}
            >
              <Library size={20} className="icon" />
              <span>Albums</span>
            </div>
            <div 
              className={`nav-item ${activeView === 'playlists' ? 'active' : ''}`}
              onClick={() => setActiveView('playlists')}
            >
              <ListMusic size={20} className="icon" />
              <span>Playlists</span>
            </div>
            <div 
              className={`nav-item ${activeView === 'downloads' ? 'active' : ''}`}
              onClick={() => setActiveView('downloads')}
            >
              <Heart size={20} className="icon" />
              <span>Favorites ({favorites.length})</span>
            </div>
            
            <div className="nav-section-title">System & Sync</div>
            <div 
              className="nav-item"
              onClick={() => setShowSyncModal(true)}
              style={{ color: 'var(--accent-primary)', fontWeight: 600 }}
            >
              <Wifi size={20} className="icon" />
              <span>Device Sync</span>
            </div>
            <div 
              className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveView('settings')}
            >
              <Settings size={20} className="icon" />
              <span>Settings</span>
            </div>
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="content-area">
          {/* Top Bar */}
          <header className="top-bar">
            <div className="nav-controls">
              <button className="icon-btn" onClick={() => prevTrack()}>
                <ChevronLeft size={20} />
              </button>
              <button className="icon-btn" onClick={() => nextTrack()}>
                <ChevronRight size={20} />
              </button>
            </div>
            
            <div className="search-container">
              {isSearching ? (
                <Loader2 size={18} className="search-icon animate-spin" style={{ color: 'var(--accent-primary)' }} />
              ) : (
                <Search size={18} className="search-icon" />
              )}
              <input 
                type="text" 
                className="search-input" 
                placeholder="Search free sources (YouTube, SoundCloud, Bandcamp)..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button 
              className="icon-btn" 
              onClick={() => setShowSyncModal(true)}
              title="Connect PC to Phone"
              style={{ marginLeft: 'auto', background: 'var(--bg-elevated)', width: 'auto', padding: '0 16px', borderRadius: '20px', gap: '8px', fontSize: '0.85rem' }}
            >
              <Wifi size={16} color="var(--accent-primary)" />
              <span>Sync PC & Phone</span>
            </button>
          </header>

          {/* Dynamic Views */}
          <div className="main-view">
            {searchQuery.trim() ? (
              <>
                <h2 className="section-header">Free Stream Scraped Results</h2>
                <div className="cards-grid">
                  {searchResults.map((track) => (
                    <div 
                      key={track.id} 
                      className={`album-card ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                      onClick={() => handlePlayTrack(track)}
                    >
                      <div 
                        className="album-art" 
                        style={{ 
                          backgroundImage: `url(${track.cover})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }}
                      ></div>
                      <div className="album-title">{track.title}</div>
                      <div className="album-artist">{track.artist}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="section-header">Trending Scrapes</h2>
                <div className="cards-grid">
                  {queue.map((track) => (
                    <div 
                      key={track.id} 
                      className={`album-card ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                      onClick={() => handlePlayTrack(track)}
                    >
                      <div 
                        className="album-art" 
                        style={{ 
                          backgroundImage: `url(${track.cover})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }}
                      ></div>
                      <div className="album-title">{track.title}</div>
                      <div className="album-artist">{track.artist}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Bottom Player Bar */}
      <footer className="player-bar">
        {/* Now Playing Info */}
        <div className="now-playing">
          <div 
            className="current-art"
            style={{
              backgroundImage: currentTrack ? `url(${currentTrack.cover})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          ></div>
          <div className="current-info">
            <div className="current-title">{currentTrack?.title || 'No Track Selected'}</div>
            <div className="current-artist">{currentTrack?.artist || 'Nuclear Player'}</div>
          </div>
          {currentTrack && (
            <button 
              className="secondary-btn" 
              onClick={() => toggleFavorite(currentTrack)}
              style={{ marginLeft: '12px', color: favorites.some(f => f.id === currentTrack.id) ? 'var(--accent-secondary)' : 'var(--text-muted)' }}
            >
              <Heart size={18} fill={favorites.some(f => f.id === currentTrack.id) ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        {/* Player Controls */}
        <div className="player-controls">
          <div className="control-buttons">
            <button className="secondary-btn"><Shuffle size={18} /></button>
            <button className="secondary-btn" onClick={() => prevTrack()}><SkipBack size={22} /></button>
            <button className="play-btn" onClick={handleTogglePlay}>
              {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="secondary-btn" onClick={() => nextTrack()}><SkipForward size={22} /></button>
            <button className="secondary-btn"><Repeat size={18} /></button>
          </div>
          
          <div className="progress-container">
            <span className="time">{formatTime(currentTime)}</span>
            <div className="progress-bar-wrapper" onClick={handleSeek}>
              <div 
                className="progress-bar-fill" 
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              ></div>
            </div>
            <span className="time">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Extra Controls */}
        <div className="extra-controls">
          <button className="secondary-btn" onClick={() => setShowSyncModal(true)} title="Spotify Connect Style Sync"><Wifi size={20} color="var(--accent-primary)" /></button>
          <button className="secondary-btn"><MonitorSpeaker size={20} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Volume2 size={20} className="secondary-btn" />
            <div className="volume-bar-wrapper" onClick={handleVolumeClick}>
              <div className="volume-bar-fill" style={{ width: `${volume * 100}%` }}></div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
