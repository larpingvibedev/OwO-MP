import { useState, useRef } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2, VolumeX, Heart, ListMusic, Mic2,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import { TrackOptionsMenu } from '../common/TrackOptionsMenu';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function BottomPlayer() {
  const navigate = useNavigate();
  const progressBarRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekTime, setDragSeekTime] = useState<number>(0);
  const [hoverSeekInfo, setHoverSeekInfo] = useState<{ visible: boolean; time: number; xPercent: number }>({
    visible: false,
    time: 0,
    xPercent: 0
  });

  const [isDraggingVolume, setIsDraggingVolume] = useState(false);

  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    favorites,
    isShuffle,
    repeatMode,
    isPlayerDrawerOpen,
    activePlayerTab,
    togglePlayPause,
    nextTrack,
    prevTrack,
    setVolume,
    setCurrentTime,
    toggleFavorite,
    toggleShuffle,
    toggleRepeat,
    togglePlayerDrawer
  } = usePlayerStore();

  // Trigger seek on both Audio Engine (HTML5/YouTube) and Store
  const commitSeek = (targetTime: number) => {
    const safeTime = Math.max(0, Math.min(duration || 180, targetTime));
    setCurrentTime(safeTime);
    window.dispatchEvent(new CustomEvent('music:seek', { detail: { time: safeTime } }));
  };

  // 1. Interactive Seeker Pointer Events (Smooth real-time dragging & visual following)
  const calculateSeekTimeFromEvent = (clientX: number) => {
    if (!progressBarRef.current) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    return ratio * (duration || 0);
  };

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!duration) return;

    const time = calculateSeekTimeFromEvent(e.clientX);
    setIsDraggingSeek(true);
    setDragSeekTime(time);

    // Global drag handlers for 100% smooth tracking across entire window
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const moveTime = calculateSeekTimeFromEvent(moveEvent.clientX);
      setDragSeekTime(moveTime);

      if (progressBarRef.current) {
        const rect = progressBarRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100));
        setHoverSeekInfo({ visible: true, time: moveTime, xPercent: percent });
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const finalTime = calculateSeekTimeFromEvent(upEvent.clientX);
      setIsDraggingSeek(false);
      commitSeek(finalTime);
      setHoverSeekInfo(prev => ({ ...prev, visible: false }));

      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration || isDraggingSeek) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const time = ratio * duration;
    setHoverSeekInfo({ visible: true, time, xPercent: ratio * 100 });
  };

  const handleSeekPointerLeave = () => {
    if (!isDraggingSeek) {
      setHoverSeekInfo(prev => ({ ...prev, visible: false }));
    }
  };

  // 2. Interactive Volume Pointer Events
  const calculateVolumeFromEvent = (clientX: number) => {
    if (!volumeBarRef.current) return 0;
    const rect = volumeBarRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const newVol = calculateVolumeFromEvent(e.clientX);
    setIsDraggingVolume(true);
    setVolume(newVol);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const moveVol = calculateVolumeFromEvent(moveEvent.clientX);
      setVolume(moveVol);
    };

    const handlePointerUp = () => {
      setIsDraggingVolume(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const isFavorite = currentTrack && favorites.some(f => f.id === currentTrack.id);

  // Active seek percentage (follows mouse in real-time during drag)
  const displayTime = isDraggingSeek ? dragSeekTime : currentTime;
  const effectiveDuration = Math.max(displayTime, duration || 0);
  const seekPercentage = effectiveDuration > 0 ? Math.min(100, (displayTime / effectiveDuration) * 100) : 0;

  return (
    <footer className="player-bar">
      {/* Top Interactive Progress Bar with Real-Time Dragging & Hover Tooltip */}
      <div 
        ref={progressBarRef}
        className={`progress-container-top ${isDraggingSeek ? 'is-dragging' : ''}`}
        onPointerDown={handleSeekPointerDown}
        onPointerMove={handleSeekPointerMove}
        onPointerLeave={handleSeekPointerLeave}
        style={{
          cursor: 'pointer',
          padding: '6px 0',
          position: 'absolute',
          top: '-6px',
          left: 0,
          right: 0,
          zIndex: 40,
          touchAction: 'none'
        }}
      >
        <div 
          className="progress-track"
          style={{
            height: isDraggingSeek || hoverSeekInfo.visible ? '6px' : '3px',
            backgroundColor: 'var(--border-color)',
            width: '100%',
            position: 'relative',
            transition: 'height 0.15s ease'
          }}
        >
          {/* Main Progress Fill */}
          <div 
            className="progress-bar-fill" 
            style={{ 
              width: `${Math.max(0, Math.min(100, seekPercentage))}%`,
              height: '100%',
              backgroundColor: 'var(--accent-primary)',
              position: 'relative'
            }}
          >
            {/* Draggable Scrubber Thumb */}
            <div 
              className="seek-thumb"
              style={{
                position: 'absolute',
                right: '-6px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: isDraggingSeek ? '14px' : '10px',
                height: isDraggingSeek ? '14px' : '10px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
                boxShadow: '0 0 8px rgba(0,0,0,0.6)',
                display: (isDraggingSeek || hoverSeekInfo.visible) ? 'block' : 'none',
                pointerEvents: 'none'
              }}
            />
          </div>

          {/* Hover Time Tooltip */}
          {hoverSeekInfo.visible && (
            <div 
              style={{
                position: 'absolute',
                left: `${hoverSeekInfo.xPercent}%`,
                bottom: '14px',
                transform: 'translateX(-50%)',
                backgroundColor: '#0a0c10',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '0.72rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                zIndex: 50
              }}
            >
              {formatTime(hoverSeekInfo.time)}
            </div>
          )}
        </div>
      </div>

      {/* Now Playing Info */}
      <div className="now-playing">
        <div 
          className="current-art"
          onClick={() => togglePlayerDrawer('up_next')}
          style={{
            backgroundImage: currentTrack ? `url(${currentTrack.cover})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            cursor: 'pointer'
          }}
        />
        <div className="current-info">
          <div 
            className="current-title"
            onClick={() => togglePlayerDrawer('up_next')}
            style={{ cursor: 'pointer' }}
          >
            {currentTrack?.title || 'No Track Selected'}
          </div>
          <div 
            className="current-artist"
            onClick={() => {
              if (currentTrack) {
                navigate(`/artist/${encodeURIComponent(currentTrack.artist)}${currentTrack.artistId ? `?artistId=${encodeURIComponent(currentTrack.artistId)}` : (currentTrack.channelId ? `?channelId=${encodeURIComponent(currentTrack.channelId)}` : '')}`);
              }
            }}
          >
            {currentTrack?.artist || 'OwO Music Player'}
          </div>
        </div>
        {currentTrack && !isPlayerDrawerOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
            <button 
              className="secondary-btn" 
              onClick={() => toggleFavorite(currentTrack)}
              style={{ color: isFavorite ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
            >
              <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <TrackOptionsMenu track={currentTrack} variant="row" />
          </div>
        )}
      </div>

      {/* Player Controls */}
      <div className="player-controls">
        <div className="control-buttons">
          <button 
            className="secondary-btn" 
            onClick={toggleShuffle}
            style={{ color: isShuffle ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
          >
            <Shuffle size={18} />
          </button>
          <button className="secondary-btn" onClick={() => prevTrack()}><SkipBack size={22} /></button>
          <button className="play-btn" onClick={togglePlayPause}>
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: '2px' }} />}
          </button>
          <button className="secondary-btn" onClick={() => nextTrack()}><SkipForward size={22} /></button>
          <button 
            className="secondary-btn" 
            onClick={toggleRepeat}
            style={{ 
              color: repeatMode !== 'off' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              position: 'relative'
            }}
          >
            <Repeat size={18} />
            {repeatMode === 'one' && (
              <span style={{ position: 'absolute', fontSize: '0.6rem', fontWeight: 'bold', top: -4, right: -4 }}>1</span>
            )}
          </button>
        </div>
        
        <div className="time-display">
          <span style={{ color: isDraggingSeek ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: isDraggingSeek ? 700 : 400 }}>
            {formatTime(displayTime)}
          </span>
          <span>{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* Extra Controls */}
      <div className="extra-controls">
        <button 
          className="secondary-btn" 
          onClick={() => togglePlayerDrawer('lyrics')}
          style={{ color: isPlayerDrawerOpen && activePlayerTab === 'lyrics' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
          title="Lyrics"
        >
          <Mic2 size={18} />
        </button>
        <button 
          className="secondary-btn" 
          onClick={() => togglePlayerDrawer('up_next')}
          style={{ color: isPlayerDrawerOpen && activePlayerTab === 'up_next' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
          title="Up Next & Queue"
        >
          <ListMusic size={20} />
        </button>
        
        {/* Real-Time Draggable Volume Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
          <button 
            className="secondary-btn"
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            title={volume === 0 ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? <VolumeX size={20} color="var(--text-secondary)" /> : <Volume2 size={20} className="secondary-btn" />}
          </button>
          
          <div 
            ref={volumeBarRef}
            className="volume-bar-wrapper"
            onPointerDown={handleVolumePointerDown}
            style={{
              padding: '6px 0',
              cursor: 'pointer',
              touchAction: 'none',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <div 
              style={{
                width: '90px',
                height: isDraggingVolume ? '6px' : '4px',
                backgroundColor: 'var(--border-color)',
                borderRadius: '2px',
                position: 'relative',
                transition: 'height 0.15s ease'
              }}
            >
              <div 
                className="volume-bar-fill" 
                style={{ 
                  width: `${volume * 100}%`,
                  height: '100%',
                  backgroundColor: isDraggingVolume ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderRadius: '2px',
                  position: 'relative'
                }}
              >
                {/* Volume Scrubber Thumb */}
                <div 
                  style={{
                    position: 'absolute',
                    right: '-4px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#ffffff',
                    display: isDraggingVolume ? 'block' : 'none'
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Dropdown / Collapse Button (YouTube Music / RMPC Chevron) */}
        <button 
          className="secondary-btn dropdown-collapse-btn" 
          onClick={() => togglePlayerDrawer(activePlayerTab || 'up_next')}
          style={{ 
            color: isPlayerDrawerOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
            marginLeft: '8px',
            padding: '4px'
          }}
          title={isPlayerDrawerOpen ? "Drop down player (Collapse)" : "Expand full player view"}
        >
          {isPlayerDrawerOpen ? <ChevronDown size={22} /> : <ChevronUp size={22} />}
        </button>
      </div>
    </footer>
  );
}

