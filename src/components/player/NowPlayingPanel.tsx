import { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/usePlayerStore';
import { X, Loader2 } from 'lucide-react';

interface LyricsData {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export function NowPlayingPanel() {
  const { currentTrack, isNowPlayingVisible, toggleNowPlaying } = usePlayerStore();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isNowPlayingVisible || !currentTrack) return;

    let isMounted = true;
    setLoading(true);
    setLyrics(null);

    const fetchLyrics = async () => {
      try {
        const url = new URL('https://lrclib.net/api/get');
        url.searchParams.append('track_name', currentTrack.title);
        url.searchParams.append('artist_name', currentTrack.artist);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error('Lyrics not found');
        
        const data = await res.json();
        if (isMounted) {
          setLyrics({
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics
          });
        }
      } catch (err) {
        if (isMounted) {
          setLyrics({ syncedLyrics: null, plainLyrics: null });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLyrics();

    return () => {
      isMounted = false;
    };
  }, [currentTrack, isNowPlayingVisible]);

  if (!isNowPlayingVisible) return null;

  return (
    <div className="queue-panel" style={{
      width: '340px',
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
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Now Playing</h2>
        <button className="secondary-btn" onClick={toggleNowPlaying}>
          <X size={20} />
        </button>
      </div>

      <div className="queue-content" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {currentTrack && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div 
              style={{ 
                width: '100%', 
                aspectRatio: '1', 
                borderRadius: '8px',
                backgroundImage: `url(${currentTrack.cover})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
              }} 
            />
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>{currentTrack.title}</h2>
              <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{currentTrack.artist}</div>
            </div>
          </div>
        )}

        <div className="lyrics-container" style={{
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: '8px',
          padding: '16px',
          flex: 1,
          overflowY: 'auto'
        }}>
          <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '16px' }}>Lyrics</h3>
          
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
              <Loader2 size={24} className="animate-spin" color="var(--accent-primary)" />
            </div>
          ) : lyrics?.syncedLyrics || lyrics?.plainLyrics ? (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '1rem', color: 'var(--text-primary)' }}>
              {/* Note: We just display plain lyrics for now. Parsing synced lyrics and syncing to currentTime can be added later. */}
              {lyrics.plainLyrics || lyrics.syncedLyrics}
            </div>
          ) : (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic' }}>
              No lyrics found for this track.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
