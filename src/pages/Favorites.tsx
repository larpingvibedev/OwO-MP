import { usePlayerStore } from '../store/usePlayerStore';
import { Play, Heart, Trash2 } from 'lucide-react';
import { AddToQueueButton } from '../components/common/AddToQueueButton';
import { TrackOptionsMenu } from '../components/common/TrackOptionsMenu';
import type { Track } from '../types';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Favorites() {
  const { favorites, currentTrack, setQueue, setIsPlaying, toggleFavorite } = usePlayerStore();

  const handlePlayTrack = (track: Track) => {
    const idx = favorites.findIndex(t => t.id === track.id);
    setQueue(favorites, Math.max(0, idx));
    setIsPlaying(true);
  };

  const handlePlayAll = () => {
    if (favorites.length > 0) {
      setQueue(favorites, 0);
      setIsPlaying(true);
    }
  };

  return (
    <div style={{ paddingBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 className="section-header" style={{ marginBottom: '4px' }}>Favorite Tracks</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{favorites.length} Liked Songs</p>
        </div>

        {favorites.length > 0 && (
          <button className="hero-play-btn" onClick={handlePlayAll}>
            <Play size={18} fill="#000" />
            <span>Play Favorites</span>
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '60px', color: 'var(--text-secondary)' }}>
          <Heart size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p>No favorites added yet. Click the heart icon on any song to save it here!</p>
        </div>
      ) : (
        <div className="top-tracks-list">
          {favorites.map((track, idx) => (
            <div 
              key={track.id} 
              className={`track-row ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
              onClick={() => handlePlayTrack(track)}
            >
              <span className="track-row-index">{idx + 1}</span>
              <div 
                className="track-row-cover" 
                style={{ backgroundImage: `url(${track.cover})` }} 
              />
              <div className="track-row-details">
                <div className="track-row-title">{track.title}</div>
                <div className="track-row-artist">{track.artist}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                <AddToQueueButton track={track} variant="row-btn" />
                <TrackOptionsMenu track={track} variant="row" />
                <button 
                  className="secondary-btn" 
                  onClick={() => toggleFavorite(track)}
                  title="Remove from favorites"
                  style={{ padding: '6px' }}
                >
                  <Trash2 size={15} color="var(--text-secondary)" />
                </button>
                <span className="track-row-duration" style={{ minWidth: '38px', textAlign: 'right' }}>{formatTime(track.duration)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
