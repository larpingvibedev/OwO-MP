import type { Track } from '../types';
import { isSameTrack } from '../utils/trackUtils';
import { Play } from 'lucide-react';
import { TrackOptionsMenu } from './common/TrackOptionsMenu';
import { useContextMenuStore } from '../store/useContextMenuStore';

interface SpeedDialGridProps {
  tracks: Track[];
  currentTrack: Track | null;
  onTrackClick: (track: Track, index: number) => void;
  onArtistClick?: (track: Track) => void;
}

export function SpeedDialGrid({
  tracks,
  currentTrack,
  onTrackClick,
  onArtistClick
}: SpeedDialGridProps) {
  const { openTrackContextMenu } = useContextMenuStore();
  if (!tracks || tracks.length === 0) return null;

  return (
    <div style={{ marginBottom: '36px' }}>
      <h3 className="section-header" style={{ marginBottom: '14px', fontSize: '1.45rem', fontWeight: 800 }}>
        Speed Dial
      </h3>
      
      <div 
        className="speed-dial-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
          gap: '10px',
        }}
      >
        {tracks.slice(0, 8).map((track, index) => {
          const isActive = isSameTrack(currentTrack, track);
          
          return (
            <div
              key={`speed-dial-${track.id}`}
              onClick={() => onTrackClick(track, index)}
              onContextMenu={(e) => openTrackContextMenu(e, track)}
              className={`speed-dial-card ${isActive ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                height: '56px',
                borderRadius: '8px',
                backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${isActive ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.08)'}`,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
                overflow: 'hidden',
                position: 'relative',
                paddingRight: '12px'
              }}
            >
              {/* Cover Art */}
              <div 
                style={{
                  width: '56px',
                  height: '56px',
                  backgroundImage: `url(${track.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  flexShrink: 0,
                  boxShadow: '2px 0 8px rgba(0,0,0,0.3)'
                }}
              />

              {/* Title & Artist */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div 
                  style={{ 
                    fontWeight: 700, 
                    fontSize: '0.86rem', 
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.2'
                  }}
                >
                  {track.title}
                </div>
                <div 
                  onClick={(e) => {
                    if (onArtistClick) {
                      e.stopPropagation();
                      onArtistClick(track);
                    }
                  }}
                  style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '3px'
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

              {/* Hover Actions: 3-Dots Menu & Quick Play Button */}
              <div 
                className="speed-dial-actions"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  flexShrink: 0
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="speed-dial-menu-btn" style={{ opacity: 0, transition: 'opacity 0.15s ease' }}>
                  <TrackOptionsMenu track={track} variant="row" />
                </div>

                <button
                  type="button"
                  onClick={() => onTrackClick(track, index)}
                  className="speed-dial-play-btn"
                  title="Play"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--accent-primary)',
                    color: '#000',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }}
                >
                  <Play size={15} fill="#000" style={{ marginLeft: '2px' }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .speed-dial-card:hover {
          background-color: rgba(255, 255, 255, 0.09) !important;
          border-color: rgba(255, 255, 255, 0.18) !important;
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
        }
        .speed-dial-card .speed-dial-play-btn {
          opacity: 0;
          transform: scale(0.8);
        }
        .speed-dial-card:hover .speed-dial-play-btn {
          opacity: 1;
          transform: scale(1);
        }
        .speed-dial-card:hover .speed-dial-menu-btn {
          opacity: 1 !important;
        }
        .speed-dial-card.active .speed-dial-play-btn {
          opacity: 1;
          transform: scale(1);
        }
      `}</style>
    </div>
  );
}

