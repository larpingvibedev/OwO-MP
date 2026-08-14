import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAlbumDetails, cleanGoogleImageUrl } from '../services/musicSearch';
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
  const initialCover = searchParams.get('cover') || '';

  useEffect(() => {
    if (albumId && albumName && artistName) {
      setLoading(true);
      fetchAlbumDetails(albumId, albumName, artistName, initialCover).then(data => {
        setAlbum(data);
        setLoading(false);
      });
    }
  }, [albumId, albumName, artistName, initialCover]);

  const handlePlayTrack = (track: Track) => {
    if (album) {
      const idx = album.tracks.findIndex(t => t.id === track.id);
      setQueue(album.tracks, Math.max(0, idx));
      setIsPlaying(true);
    }
  };

  const handlePlayRelease = () => {
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
        Could not load release details.
      </div>
    );
  }

  // Derive dynamic release type
  const releaseTypeLower = (album.releaseDate || '').toLowerCase();
  const isSingle = releaseTypeLower.includes('single') || album.tracks.length === 1;
  const isEP = releaseTypeLower.includes('ep') || (album.tracks.length > 1 && album.tracks.length <= 6);
  const isAlbum = releaseTypeLower.includes('album') || album.tracks.length > 6;
  
  const releaseLabel = isSingle ? 'Single' : (isEP ? 'EP' : (isAlbum ? 'Album' : 'Official Release'));
  const playButtonText = isSingle ? 'Play Single' : (isEP ? 'Play EP' : (isAlbum ? 'Play Album' : 'Play Release'));
  const displayCover = cleanGoogleImageUrl(album.cover || initialCover, 500);

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
            width: '240px',
            height: '240px',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-main)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            flexShrink: 0
          }}
        >
          <img 
            src={displayCover} 
            alt={album.name} 
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => {
              if (initialCover && (e.currentTarget as HTMLImageElement).src !== initialCover) {
                (e.currentTarget as HTMLImageElement).src = initialCover;
              } else {
                (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
              }
            }}
          />
        </div>
        <div className="album-hero-details">
          <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            {releaseLabel}
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
            <span>• {album.tracks.length} {album.tracks.length === 1 ? 'Track' : 'Tracks'}</span>
          </div>

          {album.tracks.length > 0 && (
            <button 
              className="hero-play-btn"
              onClick={handlePlayRelease}
              style={{ marginTop: '24px', backgroundColor: 'var(--accent-primary)', padding: '12px 32px', borderRadius: '32px', display: 'flex', alignItems: 'center', gap: '8px', color: '#000', fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              <Play size={18} fill="#000" />
              <span>{playButtonText}</span>
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
              style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '4px', 
                overflow: 'hidden', 
                backgroundColor: 'var(--bg-main)',
                flexShrink: 0 
              }} 
            >
              <img 
                src={cleanGoogleImageUrl(track.cover || displayCover, 500)} 
                alt={track.title} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = displayCover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                }}
              />
            </div>
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
