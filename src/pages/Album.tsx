import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAlbumDetails, fetchArtistProfileFromYTM, cleanGoogleImageUrl, resolveArtistAvatar } from '../services/musicSearch';
import { usePlayerStore } from '../store/usePlayerStore';
import { isSameTrack } from '../utils/trackUtils';
import { 
  Play, Pause, Shuffle, Heart, Plus, ChevronLeft, Loader2, Disc, 
  Check, Download, HardDrive, ListMusic, Trash2, Pencil, MoreVertical, 
  Search, Share2, ListPlus, X 
} from 'lucide-react';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { TrackOptionsMenu } from '../components/common/TrackOptionsMenu';
import { useContextMenuStore } from '../store/useContextMenuStore';
import type { AlbumDetail, Track, Album as ReleaseItem } from '../types';

function safeDecode(str?: string): string {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

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

  // Edit Playlist Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCover, setEditCover] = useState('');

  // 3-Dots Menu & In-Playlist Search State
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    togglePlayPause,
    favorites,
    toggleFavorite,
    addToQueue,
    playNext,
    playlists,
    updatePlaylist,
    removeTrackFromPlaylist,
    toggleSavePlaylist,
    deletePlaylist,
    savedAlbums,
    toggleSaveAlbum,
    downloadedTrackIds,
    downloadingTrackIds,
    downloadTrackBatch,
    showToast
  } = usePlayerStore();

  const { openTrackContextMenu, openPlaylistContextMenu, openAlbumContextMenu } = useContextMenuStore();

  const albumName = searchParams.get('name') || '';
  const artistName = searchParams.get('artist') || '';
  const initialCover = searchParams.get('cover') || '';
  const trackTitleParam = searchParams.get('trackTitle') || '';
  const trackArtistId = searchParams.get('artistId') || searchParams.get('channelId') || undefined;

  const safeTracks = useMemo(() => {
    return (album && Array.isArray(album.tracks)) ? album.tracks.filter(Boolean) : [];
  }, [album]);

  const trackCount = safeTracks.length;

  const filteredTracks = useMemo(() => {
    if (!album || !safeTracks.length) return [];
    if (!filterQuery.trim()) return safeTracks;
    const q = filterQuery.toLowerCase().trim();
    return safeTracks.filter(t => 
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.artist && t.artist.toLowerCase().includes(q)) ||
      (t.album && t.album.toLowerCase().includes(q))
    );
  }, [album, safeTracks, filterQuery]);

  // Close options menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOptionsMenu(false);
      }
    }
    if (showOptionsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOptionsMenu]);

  useEffect(() => {
    let isCancelled = false;
    setAlbum(null);
    setLoading(true);
    setArtistAvatar('');
    setMoreReleases([]);
    setShowFilter(false);
    setFilterQuery('');
    setShowOptionsMenu(false);

    if (!albumId) {
      setLoading(false);
      return;
    }

    // 1. Auto-Playlist: Liked Music
    if (albumId === 'liked' || albumId === 'liked-music' || albumId === 'favorites') {
      const seen = new Set<string>();
      const uniqueFavs = (favorites || []).filter(t => {
        if (!t || !t.id || seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });

      setAlbum({
        id: 'liked',
        name: 'Liked Music',
        artist: 'Auto playlist',
        cover: uniqueFavs[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        tracks: uniqueFavs,
        releaseDate: 'Playlist'
      });
      setLoading(false);
      return;
    }

    // 2. Custom User Playlists
    const decodedId = safeDecode(albumId).toLowerCase();
    const localPl = (playlists || []).find(p => p && (p.id === albumId || (p.name && p.name.toLowerCase() === decodedId)));
    if (localPl) {
      const seen = new Set<string>();
      const uniqueTracks = (localPl.tracks || []).filter(t => {
        if (!t || !t.id || seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });

      setAlbum({
        id: localPl.id,
        name: localPl.name || 'Playlist',
        description: localPl.description,
        artist: localPl.author || 'Playlist',
        cover: localPl.cover || '',
        tracks: uniqueTracks,
        releaseDate: 'Playlist'
      });
      setLoading(false);
      return;
    }

    // 3. Online Releases & Community Playlists
    let rawAlbumName = albumName || safeDecode(albumId).replace('album-', '').replace('single-', '');
    if (rawAlbumName.startsWith('@') || rawAlbumName.toLowerCase().includes('+')) {
      rawAlbumName = trackTitleParam || '';
    }
    const resolvedAlbumName = rawAlbumName;
    const resolvedArtistName = artistName || '';
    const trackArtistId = searchParams.get('artistId') || searchParams.get('channelId') || undefined;
    const trackVideoId = searchParams.get('videoId') || undefined;

    const cleanAlbumId = (albumId || '').replace('album-', '').replace('album-derived-', '');
    const isPlaylistId = Boolean(
      cleanAlbumId.startsWith('PL') || 
      cleanAlbumId.startsWith('VLPL') || 
      cleanAlbumId.startsWith('RD') || 
      cleanAlbumId.startsWith('community-') || 
      cleanAlbumId.startsWith('mix-')
    );

    const loadArtistContent = (artist: string, id?: string | number) => {
      if (!artist || isPlaylistId) return;
      const strId = id !== undefined && id !== null ? String(id) : undefined;
      resolveArtistAvatar(artist, strId, id).then(avatar => {
        if (!isCancelled && avatar) setArtistAvatar(avatar);
      });

      fetchArtistProfileFromYTM(artist, strId, id).then(profile => {
        if (!isCancelled && profile) {
          const combined = [
            ...(profile.singlesAndEPs || []),
            ...(profile.albums || [])
          ].filter(r => r && r.name && r.name.toLowerCase() !== resolvedAlbumName.toLowerCase());
          
          // Deduplicate by name
          const uniqueMap = new Map<string, ReleaseItem>();
          combined.forEach(r => {
            if (r && r.name && !uniqueMap.has(r.name.toLowerCase())) {
              uniqueMap.set(r.name.toLowerCase(), r);
            }
          });
          setMoreReleases(Array.from(uniqueMap.values()).slice(0, 8));
        }
      });
    };

    fetchAlbumDetails(albumId, resolvedAlbumName, resolvedArtistName, initialCover, trackTitleParam, trackArtistId, trackVideoId)
      .then(data => {
        if (!isCancelled && data) {
          const seen = new Set<string>();
          const uniqueTracks = (data.tracks || []).filter(t => {
            if (!t || !t.id || seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });
          setAlbum({
            ...data,
            tracks: uniqueTracks
          });

          if (data.artist && !isPlaylistId) {
            const effectiveId = data.channelId || data.artistId || trackArtistId;
            loadArtistContent(data.artist, effectiveId);
          }
        }
      })
      .catch(err => {
        if (!isCancelled) {
          console.warn('Error loading album details:', err);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    if (resolvedArtistName && !isPlaylistId) {
      loadArtistContent(resolvedArtistName, trackArtistId);
    }

    return () => {
      isCancelled = true;
    };
  }, [albumId, albumName, artistName, initialCover, favorites, playlists]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--accent-primary)', gap: '12px' }}>
        <Loader2 size={32} className="animate-spin" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Loading release...</span>
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
  const isSingle = !isPlaylist && (releaseTypeLower.includes('single') || trackCount === 1);
  const isEP = !isPlaylist && (releaseTypeLower.includes('ep') || (trackCount > 1 && trackCount <= 6));
  const isAlbum = !isPlaylist && (releaseTypeLower.includes('album') || trackCount > 6);
  
  const releaseLabel = isPlaylist ? 'Playlist' : (isSingle ? 'Single' : (isEP ? 'EP' : (isAlbum ? 'Album' : 'Official Release')));
  const playButtonText = isPlaylist ? 'Play Playlist' : (isSingle ? 'Play Single' : (isEP ? 'Play EP' : (isAlbum ? 'Play Album' : 'Play Release')));
  const displayCover = cleanGoogleImageUrl(album.cover || initialCover, 500);

  // Check if currently playing any track from this release/playlist context
  const isAnyTrackActiveInRelease = Boolean(
    currentTrack && safeTracks.some(t => isSameTrack(t, currentTrack))
  );

  const isCurrentReleasePlaying = Boolean(isPlaying && isAnyTrackActiveInRelease);
  const totalSeconds = safeTracks.reduce((acc, t) => acc + (t?.duration || 180), 0);

  const isSavedToLibrary = Boolean(
    isPlaylist
      ? (playlists || []).some(p => p && (p.id === album.id || (p.name && album.name && p.name.toLowerCase() === album.name.toLowerCase())))
      : (album && (savedAlbums || []).some(
          a => a && (a.id === album.id || (a.name && album.name && a.artist && album.artist && a.name.toLowerCase() === album.name.toLowerCase() && a.artist.toLowerCase() === album.artist.toLowerCase()))
        ))
  );
  const isAllAlbumDownloaded = Boolean(album && trackCount > 0 && safeTracks.every(t => t && t.id && Boolean(downloadedTrackIds[t.id])));
  const isAlbumDownloading = Boolean(album && safeTracks.some(t => t && t.id && downloadingTrackIds[t.id] !== undefined));

  const isCustomUserPlaylist = Boolean(album && (playlists || []).some(p => p && p.id === album.id) && album.id !== 'liked');
  const albumContextType = isCustomUserPlaylist ? 'user_playlist' : 'finite';

  const handlePlayTrack = (track: Track) => {
    if (isSameTrack(currentTrack, track)) {
      togglePlayPause();
    } else {
      const idx = safeTracks.findIndex(t => isSameTrack(t, track));
      setQueue(safeTracks, Math.max(0, idx), `${album.name}`, true, albumContextType);
      setIsPlaying(true);
    }
  };

  const handlePlayRelease = () => {
    if (isAnyTrackActiveInRelease) {
      togglePlayPause();
    } else if (safeTracks.length > 0) {
      setQueue(safeTracks, 0, `${album.name}`, true, albumContextType);
      setIsPlaying(true);
    }
  };

  const handleShuffleRelease = () => {
    if (!album || safeTracks.length === 0) return;
    const shuffled = [...safeTracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0, `${album.name} (Shuffle)`, true, albumContextType);
    setIsPlaying(true);
  };

  const handleAddAllToQueue = () => {
    if (!album || !safeTracks.length) return;
    safeTracks.forEach(t => addToQueue(t));
    showToast(`Added ${safeTracks.length} tracks to queue`);
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
        onContextMenu={(e) => {
          if (isPlaylist) {
            openPlaylistContextMenu(e, {
              id: album.id,
              name: album.name,
              description: album.description,
              cover: album.cover,
              author: album.artist,
              tracks: safeTracks
            });
          } else {
            openAlbumContextMenu(e, {
              id: album.id,
              name: album.name,
              artist: album.artist,
              cover: album.cover || initialCover,
              releaseDate: album.releaseDate,
              tracks: safeTracks,
              artistId: album.artistId
            });
          }
        }}
      >
        {/* Cover Artwork */}
        {isPlaylist ? (
          <PlaylistCover 
            tracks={safeTracks}
            cover={album.cover}
            name={album.name}
            size={240}
            borderRadius="12px"
            fallbackIconSize={48}
          />
        ) : (
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
        )}

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

          {/* Title & Pencil Edit Icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', margin: '4px 0 8px' }}>
            <h1 style={{ 
              fontSize: 'clamp(2rem, 4vw, 3.2rem)', 
              fontWeight: 800, 
              margin: 0,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)'
            }}>
              {album.name}
            </h1>

            {isCustomUserPlaylist && (
              <button 
                onClick={() => {
                  setEditName(album.name);
                  setEditDescription(album.description || '');
                  setEditCover(album.cover || '');
                  setShowEditModal(true);
                }}
                title="Edit playlist name & description"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
              >
                <Pencil size={17} />
              </button>
            )}
          </div>

          {/* Optional Playlist Description */}
          {album.description && (
            <p style={{ margin: '0 0 12px', fontSize: '0.92rem', color: 'var(--text-secondary)', maxWidth: '640px', lineHeight: 1.45 }}>
              {album.description}
            </p>
          )}

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
            {/* Creator / Artist Info */}
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: isPlaylist ? 'default' : 'pointer',
                color: 'var(--text-primary)',
                fontWeight: 700
              }}
              onClick={() => {
                if (!isPlaylist) {
                  const targetArtistId = album.artistId || album.channelId || trackArtistId;
                  navigate(`/artist/${encodeURIComponent(album.artist)}${targetArtistId ? `?channelId=${encodeURIComponent(targetArtistId)}` : ''}`);
                }
              }}
            >
              {artistAvatar && !isPlaylist && (
                <img 
                  src={artistAvatar} 
                  alt={album.artist} 
                  style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} 
                />
              )}
              <span style={{ textDecoration: isPlaylist ? 'none' : 'underline', textUnderlineOffset: '3px' }}>{album.artist}</span>
            </div>

            <span>• {isPlaylist ? 'Playlist' : (album.releaseDate || 'Official Release')}</span>
            <span>• {trackCount} {trackCount === 1 ? 'track' : 'tracks'}</span>
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
            {trackCount > 1 && (
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
                    author: album.artist,
                    cover: album.cover,
                    tracks: safeTracks
                  });
                } else {
                  toggleSaveAlbum({
                    id: album.id,
                    name: album.name,
                    artist: album.artist,
                    cover: album.cover || initialCover,
                    releaseDate: album.releaseDate,
                    trackCount: trackCount,
                    artistId: album.artistId
                  });
                }
              }}
              title={isSavedToLibrary ? "Remove from library" : "Save to library"}
              style={{
                backgroundColor: isSavedToLibrary ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '46px',
                height: '46px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isSavedToLibrary ? 'var(--accent-primary)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isSavedToLibrary ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255,255,255,0.06)'}
            >
              <Heart size={18} fill={isSavedToLibrary ? "currentColor" : "none"} />
            </button>

            {/* Download Album / Playlist Button */}
            <button 
              onClick={() => {
                if (isAllAlbumDownloaded) {
                  showToast('Entire release is already downloaded for offline listening!');
                  return;
                }
                const unDownloaded = safeTracks.filter(t => t && t.id && !downloadedTrackIds[t.id]);
                if (unDownloaded.length > 0) {
                  downloadTrackBatch(unDownloaded, album.name);
                }
              }}
              disabled={isAlbumDownloading}
              title={isAllAlbumDownloaded ? "All tracks downloaded" : "Download release for offline playback"}
              style={{
                backgroundColor: isAllAlbumDownloaded ? 'rgba(30, 144, 255, 0.18)' : 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                width: '46px',
                height: '46px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isAllAlbumDownloaded ? '#60a5fa' : 'var(--text-primary)',
                cursor: isAlbumDownloading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: isAlbumDownloading ? 0.7 : 1
              }}
              onMouseEnter={(e) => {
                if (!isAlbumDownloading) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isAlbumDownloading) e.currentTarget.style.backgroundColor = isAllAlbumDownloaded ? 'rgba(30, 144, 255, 0.18)' : 'rgba(255,255,255,0.06)';
              }}
            >
              {isAlbumDownloading ? (
                <Loader2 size={18} className="animate-spin" color="var(--accent-primary)" />
              ) : isAllAlbumDownloaded ? (
                <HardDrive size={18} color="#60a5fa" />
              ) : (
                <Download size={18} />
              )}
            </button>

            {/* YouTube Music 3-Dots Dropdown Options Menu */}
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button 
                onClick={() => setShowOptionsMenu(prev => !prev)}
                title="More options"
                style={{
                  backgroundColor: showOptionsMenu ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '50%',
                  width: '46px',
                  height: '46px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = showOptionsMenu ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}
              >
                <MoreVertical size={18} />
              </button>

              {/* Options Dropdown Menu */}
              {showOptionsMenu && (
                <div 
                  style={{
                    position: 'absolute',
                    top: '52px',
                    left: 0,
                    backgroundColor: 'var(--bg-card, #1e1e24)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '8px 0',
                    minWidth: '220px',
                    boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
                    zIndex: 1000,
                    backdropFilter: 'blur(16px)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      handleShuffleRelease();
                    }}
                  >
                    <Shuffle size={16} />
                    <span>Shuffle play</span>
                  </button>

                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowFilter(true);
                    }}
                  >
                    <Search size={16} />
                    <span>Find in playlist</span>
                  </button>

                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      if (safeTracks.length > 0) {
                        safeTracks.slice().reverse().forEach(t => playNext(t));
                        showToast(`Playing "${album.name}" next`);
                      }
                    }}
                  >
                    <ListPlus size={16} />
                    <span>Play next</span>
                  </button>

                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      handleAddAllToQueue();
                    }}
                  >
                    <Plus size={16} />
                    <span>Add to queue</span>
                  </button>

                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      downloadTrackBatch(safeTracks, album.name);
                    }}
                  >
                    <Download size={16} />
                    <span>Download playlist</span>
                  </button>

                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      navigator.clipboard.writeText(window.location.href);
                      showToast('Playlist link copied to clipboard');
                    }}
                  >
                    <Share2 size={16} />
                    <span>Share</span>
                  </button>

                  {isCustomUserPlaylist && (
                    <>
                      <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
                      <button 
                        className="track-menu-item"
                        onClick={() => {
                          setShowOptionsMenu(false);
                          setEditName(album.name);
                          setEditDescription(album.description || '');
                          setEditCover(album.cover || '');
                          setShowEditModal(true);
                        }}
                      >
                        <Pencil size={16} />
                        <span>Edit playlist</span>
                      </button>
                      <button 
                        className="track-menu-item"
                        style={{ color: '#e74c3c' }}
                        onClick={() => {
                          setShowOptionsMenu(false);
                          deletePlaylist(album.id);
                          navigate('/library?tab=playlists');
                        }}
                      >
                        <Trash2 size={16} color="#e74c3c" />
                        <span>Delete playlist</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TRACKLIST TABLE                                                          */}
      {/* ========================================================================= */}
      <div style={{ marginBottom: '56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 className="section-header" style={{ fontSize: '1.2rem', margin: 0 }}>
            Tracklist {filteredTracks.length !== trackCount && `(${filteredTracks.length} of ${trackCount})`}
          </h3>

          {/* Quick toggle search if not opened via menu */}
          <button 
            onClick={() => setShowFilter(prev => !prev)}
            title="Filter tracks in playlist"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: showFilter ? 'rgba(255,255,255,0.12)' : 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.15s'
            }}
          >
            <Search size={14} />
            <span>{showFilter ? 'Hide Filter' : 'Find in playlist'}</span>
          </button>
        </div>

        {/* Find in playlist Search Bar */}
        {showFilter && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '24px',
            padding: '8px 16px',
            marginBottom: '16px',
            maxWidth: '380px'
          }}>
            <Search size={15} color="var(--text-secondary)" />
            <input 
              type="text"
              placeholder="Search in this playlist..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              autoFocus
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                outline: 'none'
              }}
            />
            {filterQuery && (
              <button 
                onClick={() => setFilterQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, display: 'flex' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="top-tracks-list">
          {filteredTracks.map((track, idx) => {
            const isCurrent = isSameTrack(currentTrack, track);
            const isFav = favorites.some(f => f.id === track.id);
            const isAdded = addedTrackId === track.id;

            return (
              <div 
                key={`${album.id || albumId}-${track.id}-${idx}`} 
                className={`track-row ${isCurrent ? 'active-playing' : ''}`}
                onClick={() => handlePlayTrack(track)}
                onContextMenu={(e) => openTrackContextMenu(e, track, {
                  onRemoveFromPlaylist: isCustomUserPlaylist ? () => removeTrackFromPlaylist(album.id, track.id) : undefined
                })}
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

                {/* Action Buttons (Heart & Plus & TrackOptionsMenu) */}
                <div 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '16px' }}
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

                  <TrackOptionsMenu 
                    track={track}
                    onRemoveFromPlaylist={isCustomUserPlaylist ? () => {
                      removeTrackFromPlaylist(album.id, track.id);
                      setAlbum(prev => prev ? { ...prev, tracks: prev.tracks.filter(t => t.id !== track.id) } : null);
                    } : undefined}
                  />
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
      {/* MORE RELEASES BY ARTIST SHELF (Official Releases Only)                    */}
      {/* ========================================================================= */}
      {!isPlaylist && moreReleases.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h3 className="section-header" style={{ fontSize: '1.25rem', margin: 0 }}>
              More by {album.artist}
            </h3>
            <button 
              className="secondary-btn"
              onClick={() => {
                const targetArtistId = album.artistId || album.channelId || trackArtistId;
                navigate(`/artist/${encodeURIComponent(album.artist)}${targetArtistId ? `?channelId=${encodeURIComponent(targetArtistId)}` : ''}`);
              }}
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

      {/* ========================================================================= */}
      {/* EDIT PLAYLIST DETAILS MODAL                                              */}
      {/* ========================================================================= */}
      {showEditModal && (
        <div className="playlist-detail-modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="playlist-detail-modal-dialog" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Edit playlist details</h2>
              <button 
                onClick={() => setShowEditModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!editName.trim()) return;
              updatePlaylist(album.id, { 
                name: editName.trim(), 
                description: editDescription.trim(), 
                cover: editCover.trim() 
              });
              setAlbum(prev => prev ? { 
                ...prev, 
                name: editName.trim(), 
                description: editDescription.trim(), 
                cover: editCover.trim() 
              } : null);
              setShowEditModal(false);
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Title</label>
                  <input 
                    type="text" 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="new-playlist-input"
                    placeholder="Playlist title"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Description</label>
                  <textarea 
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="new-playlist-input"
                    placeholder="Add an optional description"
                    rows={3}
                    style={{ resize: 'vertical', minHeight: '70px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Custom Cover URL (optional)</label>
                  <input 
                    type="url" 
                    value={editCover}
                    onChange={e => setEditCover(e.target.value)}
                    className="new-playlist-input"
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="modal-footer" style={{ marginTop: '24px' }}>
                <button type="button" className="modal-close-btn" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="modal-play-all-btn">
                  <Check size={16} color="#000" />
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
