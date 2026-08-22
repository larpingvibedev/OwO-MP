import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { 
  DndContext, 
  DragOverlay, 
  closestCenter, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  type DragEndEvent 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { fetchAlbumDetails, fetchArtistProfileFromYTM, cleanGoogleImageUrl, resolveArtistAvatar } from '../services/musicSearch';
import { usePlayerStore } from '../store/usePlayerStore';
import { useSelectionStore } from '../store/useSelectionStore';
import { savePlaylistCover } from '../services/playlistCoverStorage';
import { isSameTrack } from '../utils/trackUtils';
import { 
  Play, Pause, Shuffle, Heart, ChevronLeft, Loader2, Disc, 
  Download, HardDrive, ListMusic, Trash2, Pencil, MoreVertical, 
  Search, Share2, ListPlus, X, Camera, GripVertical 
} from 'lucide-react';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { SortableTrackRow } from '../components/common/SortableTrackRow';
import { EditPlaylistModal } from '../components/modals/EditPlaylistModal';
import { useContextMenuStore } from '../store/useContextMenuStore';
import type { AlbumDetail, Track, Album as ReleaseItem } from '../types';
import { getTrackInstanceId, ensureTrackInstanceId } from '../types';

function safeDecode(str?: string): string {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
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

  // Edit Playlist Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // 3-Dots Menu & In-Playlist Search State
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const { 
    currentTrack, 
    isPlaying, 
    setQueue, 
    setIsPlaying, 
    togglePlayPause,
    favorites,
    addToQueue,
    playNext,
    playlists,
    localPlaylistMetadata,
    updatePlaylist,
    reorderPlaylistTrack,
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

  const { 
    setContext, 
    toggleItem, 
    selectAll, 
    clearSelection, 
    selectedItemIds, 
    selectionMode 
  } = useSelectionStore();

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

  // Sync selection context
  useEffect(() => {
    if (albumId && safeTracks.length > 0) {
      setContext(`playlist-${albumId}`, safeTracks);
    }
  }, [albumId, safeTracks, setContext]);

  // Keyboard shortcut listeners (Ctrl/Cmd+A to select all, Escape to clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const target = e.target as HTMLElement;
        if (target && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          selectAll(filteredTracks);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, selectAll, filteredTracks]);

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
      const uniqueFavs = (favorites || []).filter(Boolean);

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
    const cleanAlbumId = (albumId || '').replace('album-', '').replace('album-derived-', '');
    const decodedId = safeDecode(albumId).toLowerCase();
    const localPl = (playlists || []).find(p => p && (p.id === albumId || p.id === cleanAlbumId || (p.name && p.name.toLowerCase() === decodedId)));
    if (localPl) {
      const plTracks = (localPl.tracks || []).filter(Boolean).map(ensureTrackInstanceId);
      const effectiveCoverId = localPlaylistMetadata?.[localPl.id]?.coverId ?? localPl.coverId;
      setAlbum({
        id: localPl.id,
        name: localPl.name || 'Playlist',
        description: localPl.description,
        artist: localPl.author || 'Playlist',
        cover: localPl.cover || '',
        coverId: effectiveCoverId,
        tracks: plTracks,
        releaseDate: 'Playlist'
      });
      setLoading(false);
      return;
    }

    // Defensive Guard: If this is a local playlist ID ('pl-...') that was deleted or doesn't exist locally,
    // do NOT fall through to YouTube release lookup. Redirect home immediately.
    if (cleanAlbumId.startsWith('pl-')) {
      setLoading(false);
      navigate('/', { replace: true });
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
          <div 
            style={{ 
              position: 'relative', 
              width: '240px', 
              height: '240px', 
              borderRadius: '12px', 
              overflow: 'hidden', 
              cursor: isCustomUserPlaylist ? 'pointer' : 'default', 
              flexShrink: 0,
              boxShadow: '0 16px 40px rgba(0,0,0,0.6)'
            }}
            onClick={isCustomUserPlaylist ? () => setShowEditModal(true) : undefined}
            title={isCustomUserPlaylist ? "Click to change cover & edit details" : undefined}
          >
            <PlaylistCover 
              playlistId={album.id}
              tracks={safeTracks}
              cover={album.cover}
              coverId={localPlaylistMetadata?.[album.id]?.coverId ?? album.coverId}
              name={album.name}
              size={240}
              borderRadius="12px"
              fallbackIconSize={48}
            />
            {isCustomUserPlaylist && (
              <div 
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.55)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#ffffff',
                  opacity: 0,
                  transition: 'opacity 0.2s ease',
                  backdropFilter: 'blur(3px)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
              >
                <Camera size={32} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Change Cover</span>
              </div>
            )}
          </div>
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
                onClick={() => setShowEditModal(true)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Play All / Pause Button */}
            <button 
              onClick={handlePlayRelease}
              className="primary-btn"
              style={{ 
                padding: '12px 28px', 
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: 'var(--accent-primary)',
                color: '#000',
                fontWeight: 700,
                border: 'none',
                borderRadius: '32px',
                cursor: 'pointer',
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

              {/* 3-Dots Dropdown Menu */}
              {showOptionsMenu && (
                <div 
                  className="track-options-menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    zIndex: 100,
                    minWidth: '200px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}
                >
                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      if (safeTracks.length > 0) {
                        playNext(safeTracks[0]);
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
                      safeTracks.forEach(t => addToQueue(t));
                      showToast(`Added ${safeTracks.length} tracks to queue`);
                    }}
                  >
                    <ListMusic size={16} />
                    <span>Add to queue</span>
                  </button>
                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowFilter(prev => !prev);
                    }}
                  >
                    <Search size={16} />
                    <span>Find in playlist</span>
                  </button>
                  <button 
                    className="track-menu-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(window.location.href);
                        showToast('Link copied to clipboard!');
                      }
                    }}
                  >
                    <Share2 size={16} />
                    <span>Share</span>
                  </button>

                  {isCustomUserPlaylist && (
                    <>
                      <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                      <button 
                        className="track-menu-item"
                        onClick={() => {
                          setShowOptionsMenu(false);
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
                          navigate('/', { replace: true });
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
      {/* TRACKLIST TABLE WITH SORTABLE DND & MULTI-SELECTION                      */}
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={(event) => setActiveDragId(String(event.active.id))}
          onDragEnd={(event: DragEndEvent) => {
            setActiveDragId(null);
            const { active, over } = event;
            if (over && active.id !== over.id && album && isCustomUserPlaylist) {
              reorderPlaylistTrack(album.id, String(active.id), String(over.id));
              // Update local state snapshot instantly for snappy feel
              setAlbum(prev => {
                if (!prev) return null;
                const tracks = [...prev.tracks];
                const activeIdx = tracks.findIndex((t, i) => getTrackInstanceId(t, i) === active.id || t._uid === active.id);
                const overIdx = tracks.findIndex((t, i) => getTrackInstanceId(t, i) === over.id || t._uid === over.id);
                if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return prev;
                const [moved] = tracks.splice(activeIdx, 1);
                tracks.splice(overIdx, 0, moved);
                return { ...prev, tracks };
              });
            }
          }}
          onDragCancel={() => setActiveDragId(null)}
        >
          <SortableContext
            items={filteredTracks.map((t, i) => getTrackInstanceId(t, i))}
            strategy={verticalListSortingStrategy}
          >
            <div className="top-tracks-list">
              {filteredTracks.map((track, idx) => {
                const itemId = getTrackInstanceId(track, idx);
                const isCurrent = isSameTrack(currentTrack, track);
                const isSelected = selectedItemIds.has(itemId);

                return (
                  <SortableTrackRow
                    key={itemId}
                    itemId={itemId}
                    track={track}
                    index={idx}
                    isCurrent={isCurrent}
                    isPlaying={isPlaying}
                    isSelected={isSelected}
                    selectionMode={selectionMode}
                    canReorder={Boolean(isCustomUserPlaylist && !filterQuery.trim())}
                    onPlay={() => handlePlayTrack(track)}
                    onSelect={(e) => {
                      toggleItem(itemId, {
                        isMulti: e.ctrlKey || e.metaKey,
                        isRange: e.shiftKey,
                        allItems: filteredTracks
                      });
                    }}
                    onContextMenu={(e) => openTrackContextMenu(e, track, {
                      onRemoveFromPlaylist: isCustomUserPlaylist ? () => {
                        removeTrackFromPlaylist(album.id, track.id);
                        setAlbum(prev => prev ? { ...prev, tracks: prev.tracks.filter(t => t.id !== track.id) } : null);
                      } : undefined
                    })}
                    displayCover={displayCover}
                  />
                );
              })}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeDragId ? (() => {
              const activeTrack = safeTracks.find((t, i) => getTrackInstanceId(t, i) === activeDragId || t._uid === activeDragId);
              if (!activeTrack) return null;
              return (
                <div className="track-drag-overlay">
                  <GripVertical size={16} color="var(--accent-primary)" />
                  <img
                    src={cleanGoogleImageUrl(activeTrack.cover || displayCover, 120)}
                    alt={activeTrack.title}
                    style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {activeTrack.title}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>
                      {activeTrack.artist}
                    </div>
                  </div>
                </div>
              );
            })() : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Edit Playlist Modal */}
      {isCustomUserPlaylist && album && (
        <EditPlaylistModal
          isOpen={showEditModal}
          playlist={{
            id: album.id,
            name: album.name,
            description: album.description,
            cover: album.cover,
            coverId: localPlaylistMetadata?.[album.id]?.coverId ?? album.coverId,
            tracks: safeTracks
          }}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            let newCoverId = localPlaylistMetadata?.[album.id]?.coverId ?? album.coverId;
            if (updates.removeCover) {
              newCoverId = undefined;
            } else if (updates.coverBlob) {
              const coverKey = `cov_${album.id}_${Date.now()}`;
              await savePlaylistCover(coverKey, updates.coverBlob);
              newCoverId = coverKey;
            }
            updatePlaylist(album.id, {
              name: updates.name,
              description: updates.description,
              coverId: newCoverId,
              cover: updates.removeCover ? '' : (updates.coverBlob ? '' : album.cover)
            });
            setAlbum(prev => prev ? {
              ...prev,
              name: updates.name,
              description: updates.description,
              coverId: newCoverId,
              cover: updates.removeCover ? '' : (updates.coverBlob ? '' : prev.cover)
            } : null);
          }}
        />
      )}

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
    </div>
  );
}
