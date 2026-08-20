import { usePlayerStore } from '../../store/usePlayerStore';
import { X } from 'lucide-react';

export function QueuePanel() {
  const { 
    queue, 
    shuffledQueue, 
    isShuffle, 
    queueIndex, 
    currentTrack, 
    isQueueVisible, 
    toggleQueue,
    playQueueIndex
  } = usePlayerStore();

  if (!isQueueVisible) return null;

  const activeQueue = isShuffle ? shuffledQueue : queue;
  
  // Split queue into "Now Playing" and "Up Next"
  const upNextTracks = activeQueue.slice(queueIndex + 1);

  return (
    <div className="queue-panel" style={{
      width: '320px',
      backgroundColor: 'var(--bg-card)',
      borderLeft: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 15
    }}>
      <div className="queue-header" style={{
        padding: '24px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Queue</h2>
        <button className="secondary-btn" onClick={toggleQueue}>
          <X size={20} />
        </button>
      </div>

      <div className="queue-content" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* Now Playing */}
        {currentTrack && (
          <div>
            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Now Playing
            </h3>
            <div className="track-row playing" style={{ gridTemplateColumns: '40px 1fr', padding: '8px' }}>
              <div 
                className="track-row-cover" 
                style={{ backgroundImage: `url(${currentTrack.cover})` }} 
              />
              <div className="track-row-details" style={{ gap: '12px' }}>
                <div className="track-row-info">
                  <div className="track-row-title" style={{ fontSize: '0.9rem' }}>{currentTrack.title}</div>
                  <div className="track-row-artist" style={{ fontSize: '0.8rem' }}>{currentTrack.artist}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Up Next */}
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginTop: '24px', marginBottom: '12px' }}>
          Up Next
        </h3>
        {upNextTracks.length > 0 ? (
          <div className="top-tracks-list">
            {upNextTracks.map((track, idx) => (
              <div 
                key={`${track.id}-${idx}`} 
                className="track-row" 
                style={{ gridTemplateColumns: '40px 1fr', padding: '8px' }}
                onClick={() => {
                  const originalIndex = activeQueue.findIndex(t => t.id === track.id);
                  if (originalIndex !== -1) {
                    playQueueIndex(originalIndex);
                  }
                }}
              >
                <div 
                  className="track-row-cover" 
                  style={{ backgroundImage: `url(${track.cover})` }} 
                />
                <div className="track-row-details" style={{ gap: '12px' }}>
                  <div className="track-row-info">
                    <div className="track-row-title" style={{ fontSize: '0.9rem' }}>{track.title}</div>
                    <div className="track-row-artist" style={{ fontSize: '0.8rem' }}>{track.artist}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', marginTop: '24px' }}>
            Nothing queued up.
          </div>
        )}
      </div>
    </div>
  );
}
