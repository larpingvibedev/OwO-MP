import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchArtistProfile } from '../services/musicSearch';
import { usePlayerStore } from '../store/usePlayerStore';
import { Play, CheckCircle, Loader2, Heart } from 'lucide-react';
import { AddToQueueButton } from '../components/common/AddToQueueButton';
import type { ArtistProfile, Track } from '../types';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Artist() {
  const { artistName } = useParams();
  const [searchParams] = useSearchParams();
  const channelId = searchParams.get('channelId') || undefined;
  const artistId = searchParams.get('artistId') || undefined;
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { currentTrack, setQueue, setIsPlaying, favorites, toggleFavorite } = usePlayerStore();

  useEffect(() => {
    if (artistName) {
      setLoading(true);
      fetchArtistProfile(artistName, channelId, artistId).then(data => {
        setProfile(data);
        setLoading(false);
      });
    }
  }, [artistName, channelId, artistId]);

  const handlePlayTrack = (track: Track) => {
    if (profile && profile.topTracks.length > 0) {
      const idx = profile.topTracks.findIndex(t => t.id === track.id);
      setQueue(profile.topTracks, Math.max(0, idx));
    } else {
      setQueue([track], 0);
    }
    setIsPlaying(true);
  };

  const handlePlayAll = () => {
    if (profile && profile.topTracks.length > 0) {
      setQueue(profile.topTracks, 0);
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

  if (!profile) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-secondary)' }}>
        Could not load profile for {artistName}.
      </div>
    );
  }

  return (
    <div className="artist-page">
      <div className="artist-hero-container">
        <div 
          className="artist-hero-card"
          style={{ 
            backgroundImage: profile.banner ? `url("${profile.banner}")` : `url("${profile.cover}")`,
            backgroundColor: 'var(--bg-card)'
          }}
        >
          <div className="artist-hero-overlay" />
          <div className="artist-hero-content">
            <div 
              className="artist-avatar" 
              style={{ 
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--bg-main)'
              }}
            >
              <img 
                src={profile.cover || (profile.topTracks[0]?.cover)} 
                alt={profile.name} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  if (profile.topTracks[0]?.cover) {
                    (e.currentTarget as HTMLImageElement).src = profile.topTracks[0].cover;
                  }
                }}
              />
            </div>
            <div className="artist-info">
              <span className="verified-badge">
                <CheckCircle size={14} color="var(--accent-primary)" />
                Verified Artist
              </span>
              <h1 className="artist-name-title">{profile.name}</h1>
            </div>

            {profile.topTracks.length > 0 && (
              <button className="hero-play-btn" onClick={handlePlayAll}>
                <Play size={18} fill="#000" />
                <span>Play Top Tracks</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 32px' }}>
        {/* 1. Top Songs */}
        {profile.topTracks.length > 0 && (
          <>
            <h3 className="section-header" style={{ marginTop: '24px', marginBottom: '16px' }}>Top Songs</h3>
            <div className="top-tracks-list">
              {profile.topTracks.map((track, idx) => {
                const isFav = favorites.some(f => f.id === track.id);
                return (
                  <div 
                    key={track.id} 
                    className={`track-row ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                    onClick={() => handlePlayTrack(track)}
                  >
                    <span className="track-row-index">{idx + 1}</span>
                    <div 
                      className="track-row-cover" 
                      style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }} 
                    >
                      <img 
                        src={track.cover} 
                        alt={track.title} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        loading="lazy"
                        onError={(e) => {
                          if (profile.cover) (e.currentTarget as HTMLImageElement).src = profile.cover;
                        }}
                      />
                    </div>
                    <div className="track-row-info">
                      <div className="track-row-title">{track.title}</div>
                      <div className="track-row-artist">{track.artist}</div>
                    </div>
                    <div className="track-row-album">{track.album || 'Single'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                      <button 
                        onClick={() => toggleFavorite(track)}
                        title={isFav ? "Favorited" : "Favorite"}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer', 
                          color: isFav ? 'var(--accent-primary)' : 'rgba(255,255,255,0.3)',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <Heart size={15} fill={isFav ? "currentColor" : "none"} />
                      </button>
                      <AddToQueueButton track={track} variant="row-btn" />
                      <span className="track-row-duration" style={{ minWidth: '38px', textAlign: 'right' }}>{formatTime(track.duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 2. Official Albums */}
        {profile.albums.length > 0 && (
          <>
            <h3 className="section-header" style={{ marginTop: '36px', marginBottom: '16px' }}>Albums</h3>
            <div className="cards-grid" style={{ marginBottom: '36px' }}>
              {profile.albums.map((album) => (
                <div 
                  key={album.id} 
                  className="album-card"
                  onClick={() => navigate(`/album/${album.id}?name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}&cover=${encodeURIComponent(album.cover || '')}`)}
                >
                  <div 
                    className="album-art"
                    style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}
                  >
                    <img 
                      src={album.cover || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'} 
                      alt={album.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                      }}
                    />
                  </div>
                  <div className="album-title">{album.name}</div>
                  <div className="album-artist">{album.releaseDate || 'Album'}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 3. Singles & EPs (Combined Singles, EPs, and Features) */}
        {profile.singlesAndEPs && profile.singlesAndEPs.length > 0 && (
          <>
            <h3 className="section-header" style={{ marginTop: '36px', marginBottom: '16px' }}>Singles & EPs</h3>
            <div className="cards-grid" style={{ marginBottom: '36px' }}>
              {profile.singlesAndEPs.map((single) => (
                <div 
                  key={single.id} 
                  className="album-card"
                  onClick={() => navigate(`/album/${single.id}?name=${encodeURIComponent(single.name)}&artist=${encodeURIComponent(single.artist)}&cover=${encodeURIComponent(single.cover || '')}`)}
                >
                  <div 
                    className="album-art"
                    style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}
                  >
                    <img 
                      src={single.cover || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'} 
                      alt={single.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                      }}
                    />
                  </div>
                  <div className="album-title">{single.name}</div>
                  <div className="album-artist">{single.releaseDate || 'Single'}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 4. Fans Might Also Like */}
        {profile.similarArtists && profile.similarArtists.length > 0 && (
          <>
            <h3 className="section-header" style={{ marginTop: '36px', marginBottom: '16px' }}>Fans Might Also Like</h3>
            <div className="cards-grid" style={{ marginBottom: '48px' }}>
              {profile.similarArtists.map((sim) => (
                <div 
                  key={sim.channelId || sim.name} 
                  className="album-card"
                  onClick={() => navigate(`/artist/${encodeURIComponent(sim.name)}${sim.channelId ? `?channelId=${encodeURIComponent(sim.channelId)}` : (sim.artistId ? `?artistId=${encodeURIComponent(sim.artistId)}` : '')}`)}
                  style={{ textAlign: 'center' }}
                >
                  <div 
                    className="album-art"
                    style={{ 
                      borderRadius: '50%',
                      width: '100%',
                      aspectRatio: '1/1',
                      overflow: 'hidden',
                      backgroundColor: 'var(--bg-main)'
                    }}
                  >
                    <img 
                      src={sim.cover} 
                      alt={sim.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                      }}
                    />
                  </div>
                  <div className="album-title" style={{ marginTop: '10px' }}>{sim.name}</div>
                  <div className="album-artist">Artist</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
