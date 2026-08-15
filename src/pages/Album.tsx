import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAlbumDetails, fetchArtistProfileFromYTM, cleanGoogleImageUrl, resolveArtistAvatar } from '../services/musicSearch';
import { usePlayerStore } from '../store/usePlayerStore';
import { isSameTrack } from '../utils/trackUtils';
import { Play, Pause, Shuffle, Heart, Plus, ChevronLeft, Loader2, Disc, Check, Download, HardDrive, ListMusic } from 'lucide-react';
import type { AlbumDetail, Track, Album as ReleaseItem } from '../types';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatTotalTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds <= 0) return '3 min';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) {
    return `${mins} min ${secs > 0 ? `${secs} sec` : ''}`.trim();
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} hr ${remMins > 0 ? `${remMins} min` : ''}`.trim();
}

export function Album() {
  const { albumId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [artistAvatar, setArtistAvatar] = useState<string>('');
  const [moreReleases, setMoreReleases] = useState<ReleaseItem[]>([]);
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null);
  const [addedAllToast, setAddedAllToast] = useState(false);

  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    togglePlayPause,
    favorites,
    toggleFavorite,
    addToQueue,
    playlists,
    toggleSavePlaylist,
    savedAlbums,
    toggleSaveAlbum,
    downloadedTrackIds,
    downloadingTrackIds,
    downloadTrackBatch
  } = usePlayerStore();

  const albumName = searchParams.get('name') || '';
  const artistName = searchParams.get('artist') || '';
  const initialCover = searchParams.get('cover') || '';

  useEffect(() => {
    if (!albumId) {
      setLoading(false);
      return;
    }

    const resolvedAlbumName = albumName || decodeURIComponent(albumId).replace('album-', '').replace('single-', '');
    const resolvedArtistName = artistName || '';

    setLoading(true);
    fetchAlbumDetails(albumId, resolvedAlbumName, resolvedArtistName, initialCover)
      .then(data => {
        setAlbum(data);
      })
      .catch(err => {
        console.warn('Error loading album details:', err);
      })
      .finally(() => {
        setLoading(false);
      });

    if (resolvedArtistName) {
      // Fetch artist avatar for header
      resolveArtistAvatar(resolvedArtistName).then(avatar => {
        if (avatar) setArtistAvatar(avatar);
      });

      // Fetch more releases by the artist for the bottom shelf
      fetchArtistProfileFromYTM(resolvedArtistName).then(profile => {
        if (profile) {
          const combined = [
            ...(profile.singlesAndEPs || []),
            ...(profile.albums || [])
          ].filter(r => r.name.toLowerCase() !== resolvedAlbumName.toLowerCase());
          
          // Deduplicate by name
          const uniqueMap = new Map<string, ReleaseItem>();
          combined.forEach(r => {
            if (!uniqueMap.has(r.name.toLowerCase())) {
              uniqueMap.set(r.name.toLowerCase(), r);
            }
          });
          setMoreReleases(Array.from(uniqueMap.values()).slice(0, 8));
        }
      });
    }
  }, [albumId, albumName, artistName, initialCover]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--accent-primary)', gap: '12px' }}>
        <Loader2 size={32} className="animate-spin" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Loading official release...</span>
      </div>
    );
  }

  if (!album) {
    return (
      <div style={{ padding: '40px 32px', color: 'var(--text-secondary)', textAlign: 'center' }}>
        <p style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Could not load release details.</p>
        <button className="secondary-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={18} />
          <span>Go Back</span>
        </button>
      </div>
    );
  }

  // Derive dynamic release type
  const cleanId = (albumId || '').replace('album-', '').replace('album-derived-', '');
  const isPlaylist = Boolean(
    cleanId.startsWith('PL') || 
    cleanId.startsWith('VLPL') || 
    cleanId.startsWith('RD') || 
    cleanId.startsWith('community-') || 
    cleanId.startsWith('mix-') ||
    album.releaseDate === 'Public Playlist' ||
    album.releaseDate === 'Community Playlist' ||
    album.releaseDate === 'Curated Mix' ||
    album.releaseDate === 'Playlist'
  );

  const releaseTypeLower = (album.releaseDate || '').toLowerCase();
  const isSingle = !isPlaylist && (releaseTypeLower.includes('single') || album.tracks.length === 1);
  const isEP = !isPlaylist && (releaseTypeLower.includes('ep') || (album.tracks.length > 1 && album.tracks.length <= 6));
  const isAlbum = !isPlaylist && (releaseTypeLower.includes('album') || album.tracks.length > 6);
  
  const releaseLabel = isPlaylist ? 'Playlist' : (isSingle ? 'Single' : (isEP ? 'EP' : (isAlbum ? 'Album' : 'Official Release')));
  const playButtonText = isPlaylist ? 'Play Playlist' : (isSingle ? 'Play Single' : (isEP ? 'Play EP' : (isAlbum ? 'Play Album' : 'Play Release')));
  const displayCover = cleanGoogleImageUrl(album.cover || initialCover, 500);

  // Check if currently playing this release
  const isCurrentReleasePlaying = isPlaying && album.tracks.some(t => isSameTrack(t, currentTrack));
  const totalSeconds = album.tracks.reduce((acc, t) => acc + (t.duration || 180), 0);

  const isSavedToLibrary = Boolean(
    isPlaylist
      ? playlists.some(p => p.id === album.id || p.name.toLowerCase() === album.name.toLowerCase())
      : (album && savedAlbums.some(
          a => a.id === album.id || (a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase())
        ))
  );
  const isAllAlbumDownloaded = Boolean(album && album.tracks.length > 0 && album.tracks.every(t => Boolean(downloadedTrackIds[t.id])));
  const isAlbumDownloading = Boolean(album && album.tracks.some(t => downloadingTrackIds[t.id] !== undefined));

  const handlePlayTrack = (track: Track) => {
    if (isSameTrack(currentTrack, track)) {
      togglePlayPause();
    } else {
      const idx = album.tracks.findIndex(t => isSameTrack(t, track));
      setQueue(album.tracks, Math.max(0, idx), `${album.name}`);
      setIsPlaying(true);
    }
  };

  const handlePlayRelease = () => {
    if (isCurrentReleasePlaying) {
      togglePlayPause();
    } else if (album.tracks.length > 0) {
      setQueue(album.tracks, 0, `${album.name}`);
      setIsPlaying(true);
    }
  };

  const handleShuffleRelease = () => {
    if (album.tracks.length > 0) {
      const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
      setQueue(shuffled, 0, `${album.name} (Shuffle)`);
      setIsPlaying(true);
    }
  };

  const handleAddAllToQueue = () => {
    album.tracks.forEach(t => addToQueue(t));
    setAddedAllToast(true);
    setTimeout(() => setAddedAllToast(false), 2500);
  };

  const handleAddSingleToQueue = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    addToQueue(track);
    setAddedTrackId(track.id);
    setTimeout(() => {
      setAddedTrackId(prev => (prev === track.id ? null : prev));
    }, 2000);
  };

  return (
    <div className="album-detail-page" style={{ padding: '0 32px 64px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Back Button */}
      <button 
        className="secondary-btn" 
        onClick={() => navigate(-1)}
        style={{ marginBottom: '24px', gap: '8px', padding: '8px 16px', borderRadius: '20px' }}
      >
        <ChevronLeft size={18} />
        <span>Back</span>
      </button>

      {/* ========================================================================= */}
      {/* HERO SECTION                                                             */}
      {/* ========================================================================= */}
      <div 
        className="album-hero-container" 
        style={{ 
          display: 'flex', 
          gap: '36px', 
          marginBottom: '40px', 
          alignItems: 'flex-end',
          flexWrap: 'wrap'
        }}
      >
        {/* Cover Artwork */}
        <div 
          className="album-hero-cover" 
          style={{ 
            width: '240px', 
            height: '240px', 
            borderRadius: '12px', 
            overflow: 'hidden', 
            backgroundColor: 'var(--bg-main)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
            position: 'relative'
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

        {/* Hero Details */}
        <div className="album-hero-details" style={{ flex: 1, minWidth: '280px' }}>
          {/* Release Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            backgroundColor: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(8px)',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent-primary)',
            marginBottom: '10px'
          }}>
            {isPlaylist ? <ListMusic size={13} /> : <Disc size={13} />}
            <span>{releaseLabel}</span>
          </div>

          {/* Title */}
          <h1 style={{ 
            fontSize: 'clamp(2rem, 4vw, 3.2rem)', 
            fontWeight: 800, 
            margin: '4px 0 12px', 
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)'
          }}>
            {album.name}
          </h1>

          {/* Subtitle & Metadata Row */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px', 
            color: 'var(--text-secondary)',
            fontSize: '0.95rem',
            flexWrap: 'wrap',
            marginBottom: '24px'
          }}>
            {/* Clickable Artist Pill with Avatar */}
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontWeight: 700
              }}
              onClick={() => {
                if (!isPlaylist) {
                  navigate(`/artist/${encodeURIComponent(album.artist)}${album.artistId ? `?artistId=${encodeURIComponent(album.artistId)}` : (album.channelId ? `?channelId=${encodeURIComponent(album.channelId)}` : '')}`);
                }
              }}
            >
              {artistAvatar && (
                <img 
                  src={artistAvatar} 
                  alt={album.artist} 
                  style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} 
                />
              )}
              <span style={{ textDecoration: isPlaylist ? 'none' : 'underline', textUnderlineOffset: '3px' }}>{album.artist}</span>
            </div>

            <span>• {isPlaylist ? 'Playlist' : (album.releaseDate || 'Official Release')}</span>
            <span>• {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'}</span>
            <span>• {formatTotalTime(totalSeconds)}</span>
          </div>

          {/* Action Buttons Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            {/* Main Play / Pause Button */}
            <button 
              className="hero-play-btn"
              onClick={handlePlayRelease}
              style={{ 
                backgroundColor: 'var(--accent-primary)', 
                padding: '12px 28px', 
                borderRadius: '32px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px', 
                color: '#000', 
                fontWeight: 700, 
                fontSize: '0.95rem',
                border: 'none', 
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                transition: 'transform 0.15s, filter 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {isCurrentReleasePlaying ? (
                <>
                  <Pause size={18} fill="#000" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play size={18} fill="#000" />
                  <span>{playButtonText}</span>
                </>
              )}
            </button>

            {/* Shuffle Button (for multi-track releases) */}
            {album.tracks.length > 1 && (
              <button 
                onClick={handleShuffleRelease}
                title="Shuffle release"
                style={{ 
                  backgroundColor: 'rgba(255,255,255,0.06)', 
                  border: '1px solid var(--border-color)',
                  padding: '12px 20px', 
                  borderRadius: '32px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  color: 'var(--text-primary)', 
                  fontWeight: 600, 
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'}
              >
                <Shuffle size={16} color="var(--text-primary)" />
                <span>Shuffle</span>
              </button>
            )}

            {/* Save Album / Playlist to Library */}
            <button 
              onClick={() => {
                if (isPlaylist) {
                  toggleSavePlaylist({
                    id: album.id,
                    name: album.name,
                    cover: album.cover || initialCover,
                    tracks: album.tracks,
                    author: album.artist
                  });
                } else {
                  toggleSaveAlbum({
                    id: album.id,
                    name: album.name,
                    artist: album.artist,
                    cover: album.cover || initialCover,
                    releaseDate: album.releaseDate,
                    trackCount: album.tracks.length,
                    artistId: album.artistId
                  });
                }
              }}
              title={isSavedToLibrary ? (isPlaylist ? "Remove playlist from Library" : "Remove album from Library") : (isPlaylist ? "Save playlist to Library" : "Save album to Library")}
              style={{ 
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: isSavedToLibrary ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: isSavedToLibrary ? 'var(--accent-primary)' : 'var(--text-secondary)',
                transition: 'transform 0.15s, color 0.15s, background-color 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <Heart size={18} fill={isSavedToLibrary ? "currentColor" : "none"} />
            </button>

            {/* Download Entire Album Button */}
            <button 
              onClick={() => downloadTrackBatch(album.tracks, album.name)}
              title={isAllAlbumDownloaded ? "Album downloaded for offline playback" : "Download album offline"}
              style={{ 
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: isAllAlbumDownloaded ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: isAllAlbumDownloaded ? 'var(--accent-primary)' : 'var(--text-secondary)',
                transition: 'transform 0.15s, color 0.15s, background-color 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {isAlbumDownloading ? (
                <Loader2 size={18} className="animate-spin" color="var(--accent-primary)" />
              ) : isAllAlbumDownloaded ? (
                <HardDrive size={18} color="var(--accent-primary)" />
              ) : (
                <Download size={18} />
              )}
            </button>

            {/* Add All to Queue Button */}
            <button 
              onClick={handleAddAllToQueue}
              title="Add release to queue"
              style={{ 
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: addedAllToast ? 'var(--accent-primary)' : 'var(--text-secondary)',
                transition: 'transform 0.15s, color 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {addedAllToast ? <Check size={18} /> : <Plus size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TRACKLIST TABLE                                                          */}
      {/* ========================================================================= */}
      <div style={{ marginBottom: '56px' }}>
        <h3 className="section-header" style={{ fontSize: '1.2rem', marginBottom: '16px' }}>
          Tracklist
        </h3>

        <div className="top-tracks-list">
          {album.tracks.map((track, idx) => {
            const isCurrent = isSameTrack(currentTrack, track);
            const isFav = favorites.some(f => f.id === track.id);
            const isAdded = addedTrackId === track.id;

            return (
              <div 
                key={track.id} 
                className={`track-row ${isCurrent ? 'active-playing' : ''}`}
                onClick={() => handlePlayTrack(track)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s'
                }}
              >
                {/* Index / Playing Indicator */}
                <div style={{ width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isCurrent && isPlaying ? (
                    <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '14px' }}>
                      <span className="equalizer-bar" style={{ width: '3px', height: '100%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate' }} />
                      <span className="equalizer-bar" style={{ width: '3px', height: '60%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate 0.2s' }} />
                      <span className="equalizer-bar" style={{ width: '3px', height: '80%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate 0.4s' }} />
                    </div>
                  ) : (
                    <span className="track-row-index" style={{ fontSize: '0.9rem', color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                      {idx + 1}
                    </span>
                  )}
                </div>

                {/* Artwork Thumbnail */}
                <div 
                  className="track-row-cover" 
                  style={{ 
                    width: '42px', 
                    height: '42px', 
                    borderRadius: '6px', 
                    overflow: 'hidden', 
                    backgroundColor: 'var(--bg-main)',
                    marginLeft: '12px',
                    marginRight: '16px',
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

                {/* Track Info */}
                <div className="track-row-info" style={{ flex: 1, minWidth: 0 }}>
                  <div 
                    className="track-row-title"
                    style={{ 
                      fontWeight: 600, 
                      fontSize: '0.95rem',
                      color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {track.title}
                  </div>
                  <div 
                    className="track-row-artist"
                    style={{ 
                      fontSize: '0.85rem', 
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {track.artist}
                  </div>
                </div>

                {/* Album Name */}
                <div 
                  className="track-row-album"
                  style={{ 
                    flex: 1, 
                    color: 'var(--text-secondary)', 
                    fontSize: '0.85rem',
                    padding: '0 16px',
                    display: 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {track.album || album.name}
                </div>

                {/* Action Buttons (Heart & Plus) */}
                <div 
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '16px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button 
                    onClick={() => toggleFavorite(track)}
                    title={isFav ? "Favorited" : "Favorite"}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      color: isFav ? 'var(--accent-primary)' : 'rgba(255,255,255,0.4)',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <Heart size={16} fill={isFav ? "currentColor" : "none"} />
                  </button>

                  <button 
                    onClick={(e) => handleAddSingleToQueue(e, track)}
                    title="Add to queue"
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      color: isAdded ? 'var(--accent-primary)' : 'rgba(255,255,255,0.4)',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {isAdded ? <Check size={16} /> : <Plus size={16} />}
                  </button>
                </div>

                {/* Duration */}
                <span className="track-row-duration" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'right' }}>
                  {formatTime(track.duration)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MORE RELEASES BY ARTIST SHELF                                             */}
      {/* ========================================================================= */}
      {moreReleases.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h3 className="section-header" style={{ fontSize: '1.25rem', margin: 0 }}>
              More by {album.artist}
            </h3>
            <button 
              className="secondary-btn"
              onClick={() => navigate(`/artist/${encodeURIComponent(album.artist)}${album.artistId ? `?artistId=${encodeURIComponent(album.artistId)}` : (album.channelId ? `?channelId=${encodeURIComponent(album.channelId)}` : '')}`)}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            >
              See All Discography
            </button>
          </div>

          <div className="cards-grid">
            {moreReleases.map((rel) => (
              <div 
                key={`more-rel-${rel.id}-${rel.name}`}
                className="album-card"
                onClick={() => {
                  navigate(`/album/${encodeURIComponent(rel.id)}?name=${encodeURIComponent(rel.name)}&artist=${encodeURIComponent(rel.artist || album.artist)}&cover=${encodeURIComponent(rel.cover)}`);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ cursor: 'pointer' }}
              >
                <div 
                  className="album-art" 
                  style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}
                >
                  <img 
                    src={cleanGoogleImageUrl(rel.cover, 500)} 
                    alt={rel.name} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--accent-primary)'
                  }}>
                    {rel.releaseDate || 'Release'}
                  </div>
                </div>
                <div className="album-title">{rel.name}</div>
                <div className="album-artist">{rel.releaseDate ? `${rel.releaseDate} • ` : ''}Release</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
