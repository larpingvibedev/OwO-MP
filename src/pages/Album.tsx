import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAlbumDetails } from '../services/musicSearch';
import { usePlayerStore } from '../store/usePlayerStore';
import { Play, ChevronLeft, Loader2 } from 'lucide-react';
import type { AlbumDetail, Track } from '../types';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Album() {
  const { albumId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { currentTrack, setQueue, setIsPlaying } = usePlayerStore();

  const albumName = searchParams.get('name') || '';
  const artistName = searchParams.get('artist') || '';

  useEffect(() => {
    if (albumId && albumName && artistName) {
      setLoading(true);
      fetchAlbumDetails(albumId, albumName, artistName).then(data => {
        setAlbum(data);
        setLoading(false);
      });
    }
  }, [albumId, albumName, artistName]);

  const handlePlayTrack = (track: Track) => {
    if (album) {
      const idx = album.tracks.findIndex(t => t.id === track.id);
      setQueue(album.tracks, Math.max(0, idx));
      setIsPlaying(true);
    }
  };

  const handlePlayAlbum = () => {
    if (album && album.tracks.length > 0) {
      setQueue(album.tracks, 0);
      setIsPlaying(true);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--accent-primary)' }}>
        <Loader2 size={32} className="animate-spin" />
      </div>
    );
  }

  if (!album) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-secondary)' }}>
        Could not load album details.
      </div>
    );
  }

  return (
    <div className="album-detail-page" style={{ padding: '0 32px 32px' }}>
      <button 
        className="secondary-btn" 
        onClick={() => navigate(-1)}
        style={{ marginBottom: '20px', gap: '8px' }}
      >
        <ChevronLeft size={18} />
        <span>Back</span>
      </button>

      <div className="album-hero-container" style={{ display: 'flex', gap: '32px', marginBottom: '32px', alignItems: 'flex-end' }}>
        <div 
          className="album-hero-cover" 
          style={{ 
            backgroundImage: `url(${album.cover})`,
            width: '240px',
            height: '240px',
            backgroundSize: 'cover',
            borderRadius: '8px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
          }}
        />
        <div className="album-hero-details">
          <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            Official Release
          </span>
          <h1 style={{ fontSize: '3.5rem', fontWeight: 800, margin: '8px 0', lineHeight: 1.1 }}>{album.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            <span 
              style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
              onClick={() => navigate(`/artist/${encodeURIComponent(album.artist)}${album.artistId ? `?artistId=${encodeURIComponent(album.artistId)}` : (album.channelId ? `?channelId=${encodeURIComponent(album.channelId)}` : '')}`)}
            >
              {album.artist}
            </span>
            {album.releaseDate && <span>• {album.releaseDate}</span>}
            <span>• {album.tracks.length} Tracks</span>
          </div>

          {album.tracks.length > 0 && (
            <button 
              className="hero-play-btn"
              onClick={handlePlayAlbum}
              style={{ marginTop: '24px', backgroundColor: 'var(--accent-primary)', padding: '12px 32px', borderRadius: '32px', display: 'flex', alignItems: 'center', gap: '8px', color: '#000', fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              <Play size={18} fill="#000" />
              <span>Play Album</span>
            </button>
          )}
        </div>
      </div>

      <div className="top-tracks-list">
        {album.tracks.map((track, idx) => (
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
            <div className="track-row-info">
              <div className="track-row-title">{track.title}</div>
              <div className="track-row-artist">{track.artist}</div>
            </div>
            <div className="track-row-album">{track.album || album.name}</div>
            <span className="track-row-duration">{formatTime(track.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
