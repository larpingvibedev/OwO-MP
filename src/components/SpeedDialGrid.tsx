import type { Track } from '../types';
import { Play } from 'lucide-react';

interface SpeedDialGridProps {
  tracks: Track[];
  currentTrack: Track | null;
  onTrackClick: (track: Track, index: number) => void;
  onArtistClick?: (artistName: string) => void;
}

export function SpeedDialGrid({
  tracks,
  currentTrack,
  onTrackClick,
  onArtistClick
}: SpeedDialGridProps) {
  if (!tracks || tracks.length === 0) return null;

  return (
    <div style={{ marginBottom: '40px' }}>
      <h3 className="section-header" style={{ marginBottom: '16px', fontSize: '1.5rem', fontWeight: 800 }}>
        Speed Dial
      </h3>
      
      <div 
        className="speed-dial-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '12px',
        }}
      >
        {tracks.slice(0, 9).map((track, index) => {
          const isActive = currentTrack?.id === track.id;
          
          return (
            <div
              key={`speed-dial-${track.id}`}
              onClick={() => onTrackClick(track, index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: isActive ? 'rgba(52, 152, 219, 0.15)' : 'var(--bg-card)',
                border: `1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                cursor: 'pointer',
                transition: 'background-color 0.2s, transform 0.1s',
                overflow: 'hidden'
              }}
              className="speed-dial-item"
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isActive ? 'rgba(52, 152, 219, 0.2)' : 'var(--bg-card-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isActive ? 'rgba(52, 152, 219, 0.15)' : 'var(--bg-card)';
                e.currentTarget.style.transform = 'none';
              }}
            >
              {/* Cover Art with Hover Play Icon */}
              <div 
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '4px',
                  backgroundImage: `url(${track.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  flexShrink: 0,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                }}
              >
                <div 
                  className="play-overlay"
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    borderRadius: '4px',
                    display: 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Play size={16} fill="white" color="white" />
                </div>
              </div>

              {/* Title & Artist */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div 
                  style={{ 
                    fontWeight: 600, 
                    fontSize: '0.85rem', 
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {track.title}
                </div>
                <div 
                  onClick={(e) => {
                    if (onArtistClick) {
                      e.stopPropagation();
                      onArtistClick(track.artist);
                    }
                  }}
                  style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '2px'
                  }}
                  onMouseEnter={(e) => {
                    if (onArtistClick) e.currentTarget.style.textDecoration = 'underline';
                  }}
                  onMouseLeave={(e) => {
                    if (onArtistClick) e.currentTarget.style.textDecoration = 'none';
                  }}
                >
                  {track.artist}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        .speed-dial-item:hover .play-overlay {
          display: flex !important;
        }
      `}</style>
    </div>
  );
}
