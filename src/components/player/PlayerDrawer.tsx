import { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Music, Play, Plus,
  Compass, Volume2, Check, ExternalLink, Loader2, Info, Disc, ListPlus,
  Copy, BookOpen, Search, Heart, Radio, ChevronLeft, ChevronRight, GripVertical
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, type PlaybackContextType } from '../../store/usePlayerStore';
import { fetchUpNextMix, fetchSimilarArtists, fetchArtistDeepTracks, cleanGoogleImageUrl } from '../../services/musicSearch';
import { fetchLyrics, type LyricsResult } from '../../services/lyricsService';
import type { Track, SimilarArtist } from '../../types';
import { TrackOptionsMenu } from '../common/TrackOptionsMenu';
import { useContextMenuStore } from '../../store/useContextMenuStore';
import { AudioVisualizer } from './AudioVisualizer';

function formatDuration(seconds: number): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface FilterChipsScrollerProps {
  chips: Array<{ id: string; label: string }>;
  activeFilter: string;
  onSelectFilter: (id: string) => void;
}

function FilterChipsScroller({ chips, activeFilter, onSelectFilter }: FilterChipsScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();

    el.addEventListener('scroll', checkScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkScroll();
      });
      resizeObserver.observe(el);
    }

    const handleWindowResize = () => checkScroll();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [chips]);

  const handleScroll = (offset: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', marginBottom: '4px' }}>
      {/* Left Scroll Arrow Overlay */}
      {canScrollLeft && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          paddingRight: '12px',
          background: 'linear-gradient(to right, rgba(16, 18, 22, 0.95) 60%, transparent)',
          pointerEvents: 'none'
        }}>
          <button
            onClick={() => handleScroll(-140)}
            title="Previous filters"
            style={{
              pointerEvents: 'auto',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'}
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      )}

      {/* Horizontally Scrollable Chips */}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '4px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}
      >
        {chips.map((chip) => {
          const isActive = activeFilter === chip.id;
          return (
            <button
              key={chip.id}
              onClick={() => onSelectFilter(chip.id)}
              style={{
                padding: '5px 14px',
                borderRadius: '16px',
                fontSize: '0.75rem',
                fontWeight: isActive ? 700 : 500,
                backgroundColor: isActive ? 'var(--text-primary)' : 'rgba(255,255,255,0.06)',
                color: isActive ? '#111111' : 'var(--text-secondary)',
                border: `1px solid ${isActive ? 'transparent' : 'var(--border-color)'}`,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Right Scroll Arrow Overlay */}
      {canScrollRight && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '12px',
          background: 'linear-gradient(to left, rgba(16, 18, 22, 0.95) 60%, transparent)',
          pointerEvents: 'none'
        }}>
          <button
            onClick={() => handleScroll(140)}
            title="Next filters"
            style={{
              pointerEvents: 'auto',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

interface PlayerDrawerProps {
  onOpenDeviceModal?: () => void;
}

export function PlayerDrawer({ onOpenDeviceModal }: PlayerDrawerProps = {}) {
  const navigate = useNavigate();
  const { openTrackContextMenu } = useContextMenuStore();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    queue,
    shuffledQueue,
    queueIndex,
    isShuffle,
    autoplay,
    playingFrom,
    playbackContext,
    recommendedUpNext,
    queueSessionId,
    activePlayerTab,
    isPlayerDrawerOpen,
    favorites,
    playHistory,
    dislikedTracks,
    blockedArtists,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    playQueueIndex,
    playUpNextTrack,
    toggleAutoplay,
    setRecommendedUpNext,
    setActivePlayerTab,
    closePlayerDrawer,
    setCurrentTime,
    saveQueueAsPlaylist,
    toggleFavorite,
    useRotatingCD
  } = usePlayerStore();

  const [isLoadingMix, setIsLoadingMix] = useState(false);
  const [lyricsResult, setLyricsResult] = useState<LyricsResult | null>(null);
  const [lyricsMode, setLyricsMode] = useState<'synced' | 'plain'>('synced');
  const [lyricsFontSize, setLyricsFontSize] = useState<number>(1.05);
  const [isCopied, setIsCopied] = useState(false);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [addedTrackIds, setAddedTrackIds] = useState<Set<string>>(new Set());
  const [autoplayFilter, setAutoplayFilter] = useState<'all' | 'familiar' | 'popular' | 'discover' | 'deep_cuts' | 'downbeat' | 'upbeat' | 'instrumental'>('all');
  
  // Related Tab Data
  const [similarArtists, setSimilarArtists] = useState<SimilarArtist[]>([]);
  const [isSimilarArtistsLoading, setIsSimilarArtistsLoading] = useState(false);
  const [moreFromArtist, setMoreFromArtist] = useState<Track[]>([]);
  const [isMoreFromArtistLoading, setIsMoreFromArtistLoading] = useState(false);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState<number | null>(null);

  const contentColRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);
  const currentQueueItemRef = useRef<HTMLDivElement>(null);

  const activeQueue = isShuffle ? shuffledQueue : queue;

  // Auto-scroll to current track in queue strictly inside the content column
  useEffect(() => {
    if (activePlayerTab !== 'up_next') return;
    const container = contentColRef.current;
    const activeElement = currentQueueItemRef.current;
    if (container && activeElement) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = activeElement.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = relativeTop - 120;

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }
  }, [queueIndex, activePlayerTab, isPlayerDrawerOpen]);

  // Allow pressing Escape to close the full view player
  useEffect(() => {
    if (!isPlayerDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (e.key === 'Escape') {
        closePlayerDrawer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerDrawerOpen, closePlayerDrawer]);

  const isLocalTrackSession = currentTrack?.isLocal || currentTrack?.id?.startsWith('local-') || activeQueue.some(t => t.isLocal || t.id?.startsWith('local-'));
  const effectiveContext: PlaybackContextType = isLocalTrackSession ? 'user_playlist' : (playbackContext || (
    playingFrom && (playingFrom.endsWith('Mix') || playingFrom.includes('Discover') || playingFrom.includes('Radio') || playingFrom.includes('Supermix'))
      ? 'radio'
      : 'finite'
  ));

  // 1. Sync Up Next loading state with the active queue session without firing duplicate parallel fetches
  useEffect(() => {
    if (!currentTrack || activeQueue.length === 0 || effectiveContext === 'user_playlist' || isLocalTrackSession) {
      setIsLoadingMix(false);
      return;
    }

    if (recommendedUpNext.length > 0) {
      setIsLoadingMix(false);
    } else {
      setIsLoadingMix(true);
      // Fallback timeout in case initial background fetch in store encountered network issue
      const timer = setTimeout(() => {
        if (usePlayerStore.getState().recommendedUpNext.length === 0) {
          const queuedIds = new Set(activeQueue.map(t => t.id));
          fetchUpNextMix(activeQueue, favorites, playHistory, queuedIds, dislikedTracks, blockedArtists, false)
            .then(mix => {
              if (mix && mix.length > 0 && usePlayerStore.getState().queueSessionId === queueSessionId) {
                setRecommendedUpNext(mix);
              }
            })
            .catch(() => {})
            .finally(() => setIsLoadingMix(false));
        } else {
          setIsLoadingMix(false);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSessionId, currentTrack?.id, recommendedUpNext.length, effectiveContext]);

  // 2. Fetch Multi-Tier Lyrics from LRCLIB, Genius & Musixmatch
  useEffect(() => {
    if (!currentTrack || activePlayerTab !== 'lyrics') return;

    let isMounted = true;
    setIsLyricsLoading(true);
    setLyricsResult(null);

    fetchLyrics(currentTrack.title, currentTrack.artist, currentTrack.album, currentTrack.duration, currentTrack.id)
      .then(result => {
        if (!isMounted) return;
        setLyricsResult(result);
        if (result.synced && result.synced.length > 0) {
          setLyricsMode('synced');
        } else {
          setLyricsMode('plain');
        }
      })
      .catch(() => {
        if (isMounted) setLyricsResult(null);
      })
      .finally(() => {
        if (isMounted) setIsLyricsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, activePlayerTab]);

  // 3. Auto-Scroll Synced Lyrics strictly inside the content column without moving parent screens
  useEffect(() => {
    if (activePlayerTab !== 'lyrics') return;
    const container = contentColRef.current;
    const activeElement = activeLyricRef.current;
    if (container && activeElement) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = activeElement.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = relativeTop - (container.clientHeight / 2) + (activeElement.clientHeight / 2);

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }
  }, [currentTime, activePlayerTab]);

  // 4. Fetch Similar Artists and More From Artist when Related tab is opened
  useEffect(() => {
    if (!currentTrack || activePlayerTab !== 'related') return;

    let isMounted = true;
    setIsSimilarArtistsLoading(true);
    setIsMoreFromArtistLoading(true);

    // 1. Fetch Similar Artists (contextual to the current track and artist)
    fetchSimilarArtists(currentTrack.artist, currentTrack.id)
      .then(artists => {
        if (isMounted) {
          setSimilarArtists(artists);
          setIsSimilarArtistsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsSimilarArtistsLoading(false);
      });

    // 2. Fetch More from Current Artist
    fetchArtistDeepTracks(currentTrack.artist)
      .then(tracks => {
        if (isMounted) {
          const filtered = tracks.filter(t => t.id !== currentTrack.id && t.title.toLowerCase() !== currentTrack.title.toLowerCase());
          setMoreFromArtist(filtered.slice(0, 10));
          setIsMoreFromArtistLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsMoreFromArtistLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.artist, activePlayerTab]);

  if (!currentTrack) return null;

  const handlePlayRecommendedTrack = (track: Track) => {
    // 1. Find index of clicked track in the current recommended mix
    const clickedIdx = recommendedUpNext.findIndex(t => t.id === track.id);
    const skippedFromUpNext = clickedIdx >= 0 ? recommendedUpNext.slice(0, clickedIdx) : [];
    const remainingUpNext = clickedIdx >= 0 ? recommendedUpNext.slice(clickedIdx + 1) : recommendedUpNext.filter(t => t.id !== track.id);

    // 2. Play track cleanly via centralized store action
    playUpNextTrack(track, remainingUpNext, skippedFromUpNext);
  };

  const handleAddRecommendedToQueue = (track: Track) => {
    addToQueue(track);
    setAddedTrackIds(prev => new Set(prev).add(track.id));
    setTimeout(() => {
      setAddedTrackIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }, 2000);
  };

  const handleSeekToLyric = (time: number) => {
    setCurrentTime(time);
    window.dispatchEvent(new CustomEvent('music:seek', { detail: { time } }));
  };

  const isFavorite = currentTrack && favorites.some(f => f.id === currentTrack.id);

  return (
    <div className={`player-drawer-container ${isPlayerDrawerOpen ? 'open' : 'closed'}`}>
      {/* Dynamic Ambient Blur Glow (Matching Album Artwork) */}
      <div 
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: currentTrack ? `url(${currentTrack.cover})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(90px) saturate(1.8) brightness(0.2)',
          opacity: 0.85,
          transform: 'scale(1.2)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Expanded Now Playing Body: 2-Column Split */}
      <div className="expanded-now-playing-body">
        
        {/* ========================================================================= */}
        {/* LEFT COLUMN: COVER ART & RMPC SPECTRUM VISUALIZER                         */}
        {/* ========================================================================= */}
        <div className="expanded-cover-col">
          {/* Main Album Artwork: Dynamic Rotating CD or Classic Square */}
          {useRotatingCD ? (
            <div className="cd-disc-wrapper">
              <div className={`cd-disc-disc ${isPlaying ? 'playing' : 'paused'}`}>
                {/* Artwork Disc Layer (with overscan edge-fill to eliminate pillarbox padding) */}
                <div 
                  className="cd-disc-art"
                  style={{
                    backgroundImage: currentTrack ? `url(${cleanGoogleImageUrl(currentTrack.cover, 800)})` : 'none',
                  }}
                />
                {/* Concentric Vinyl / CD Grooves */}
                <div className="cd-disc-grooves" />
                {/* Gloss & Light Glare Reflection */}
                <div className="cd-disc-glare" />
                {/* Center Spindle Hole */}
                <div className="cd-disc-center-hole" />
              </div>
            </div>
          ) : (
            <div 
              style={{
                width: 'min(480px, 90%)',
                aspectRatio: '1',
                maxHeight: 'min(480px, 50vh)',
                borderRadius: '16px',
                backgroundImage: currentTrack ? `url(${cleanGoogleImageUrl(currentTrack.cover, 800)})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxShadow: '0 28px 70px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.12)',
                position: 'relative',
                flexShrink: 0
              }}
            />
          )}

          {/* Track Info & Controls */}
          <div style={{ width: '100%', maxWidth: '480px', marginTop: '22px', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ 
                  fontSize: '1.55rem', 
                  fontWeight: 900, 
                  color: 'var(--text-primary)', 
                  letterSpacing: '-0.02em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: '1.2'
                }}>
                  {currentTrack?.title || 'No Track Selected'}
                </div>
                <div 
                  onClick={() => {
                    if (currentTrack) {
                      navigate(`/artist/${encodeURIComponent(currentTrack.artist)}${currentTrack.artistId ? `?artistId=${encodeURIComponent(currentTrack.artistId)}` : (currentTrack.channelId ? `?channelId=${encodeURIComponent(currentTrack.channelId)}` : '')}`);
                      closePlayerDrawer();
                    }
                  }}
                  style={{ 
                    fontSize: '1.08rem', 
                    fontWeight: 600,
                    color: 'var(--text-secondary)', 
                    marginTop: '5px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                >
                  {currentTrack?.artist || 'OwO Music Player'}
                </div>
                {currentTrack?.album && 
                 currentTrack.album !== 'Single' && 
                 currentTrack.album !== 'Official Release' && 
                 currentTrack.album !== 'YouTube Music' && 
                 !currentTrack.album.startsWith('@') && 
                 !currentTrack.album.includes('+') && (
                  <div style={{ fontSize: '0.86rem', color: 'var(--accent-primary)', marginTop: '3px', opacity: 0.9 }}>
                    {currentTrack.album}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {currentTrack && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <button 
                    className="secondary-btn" 
                    onClick={() => {
                      if (onOpenDeviceModal) onOpenDeviceModal();
                      else (window as any).__openDeviceModal?.();
                    }}
                    style={{ color: 'var(--text-secondary)', padding: '8px' }}
                    title="Connect to a Device (Handoff)"
                  >
                    <Radio size={20} />
                  </button>
                  <button 
                    className="secondary-btn" 
                    onClick={() => toggleFavorite(currentTrack)}
                    style={{ color: isFavorite ? 'var(--accent-primary)' : 'var(--text-secondary)', padding: '8px' }}
                    title={isFavorite ? "Remove from liked" : "Add to liked"}
                  >
                    <Heart size={22} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                  <TrackOptionsMenu track={currentTrack} variant="row" />
                </div>
              )}
            </div>

            {/* RMPC Dynamic Equalizer Audio Spectrum Visualizer */}
            <div style={{ 
              marginTop: '18px', 
              width: '100%', 
              backgroundColor: 'rgba(0,0,0,0.4)', 
              padding: '14px 16px', 
              borderRadius: '12px', 
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.5)'
            }}>
              <AudioVisualizer isPlaying={isPlaying} height={68} barCount={42} />
              
              {/* RMPC Retro Status Line */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '10px',
                fontSize: '0.75rem', 
                fontFamily: 'monospace',
                color: 'var(--text-secondary)',
                letterSpacing: '0.02em',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: '8px'
              }}>
                <span style={{ color: isPlaying ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700 }}>
                  [{isPlaying ? 'Playing' : 'Paused'}] {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>
                <span style={{ color: '#2ecc71', fontWeight: 700 }}>
                  160 kbps Opus (High Quality)
                </span>
              </div>
            </div>
          </div>
        </div>


        {/* ========================================================================= */}
        {/* RIGHT COLUMN: TAB CONTENT (UP NEXT / LYRICS / RELATED)                     */}
        {/* ========================================================================= */}
        <div className="expanded-content-col">
          {/* Native YouTube Music Fixed Tabs Header */}
          <div className="expanded-tabs-header">
            <button
              onClick={() => setActivePlayerTab('up_next')}
              className={`expanded-tab-btn ${activePlayerTab === 'up_next' ? 'active' : ''}`}
            >
              <span>UP NEXT</span>
              {activePlayerTab === 'up_next' && <div className="expanded-tab-indicator" />}
            </button>

            <button
              onClick={() => setActivePlayerTab('lyrics')}
              className={`expanded-tab-btn ${activePlayerTab === 'lyrics' ? 'active' : ''}`}
            >
              <span>LYRICS</span>
              {activePlayerTab === 'lyrics' && <div className="expanded-tab-indicator" />}
            </button>

            <button
              onClick={() => setActivePlayerTab('related')}
              className={`expanded-tab-btn ${activePlayerTab === 'related' ? 'active' : ''}`}
            >
              <span>RELATED</span>
              {activePlayerTab === 'related' && <div className="expanded-tab-indicator" />}
            </button>
          </div>

          {/* Scrollable Tab Content Container */}
          <div className="expanded-tab-scroll-body" ref={contentColRef}>
        
        {/* ========================================================================= */}
        {/* TAB 1: UP NEXT                                                            */}
        {/* ========================================================================= */}
        {activePlayerTab === 'up_next' && (() => {
          // Filter chips definition
          const filterChipsList = [
            { id: 'all', label: 'All' },
            { id: 'familiar', label: 'Familiar' },
            { id: 'popular', label: 'Popular' },
            { id: 'discover', label: 'Discover' },
            { id: 'deep_cuts', label: 'Deep cuts' },
            { id: 'downbeat', label: 'Downbeat' },
            { id: 'upbeat', label: 'Upbeat' },
            { id: 'instrumental', label: 'Instrumental' }
          ];

          // Helper: Filter Chips Row
          const renderFilterChips = () => (
            <FilterChipsScroller
              chips={filterChipsList}
              activeFilter={autoplayFilter}
              onSelectFilter={(id) => setAutoplayFilter(id as any)}
            />
          );

          // Helper: Autoplay Toggle Card (Screenshot 3)
          const renderAutoplayToggleCard = () => (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px'
            }}>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Autoplay
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Add similar content to the end of the queue
                </div>
              </div>

              {/* Toggle Switch */}
              <div 
                onClick={toggleAutoplay}
                title="Toggle Autoplay"
                style={{
                  width: '42px',
                  height: '24px',
                  borderRadius: '12px',
                  backgroundColor: autoplay ? 'var(--accent-primary)' : 'rgba(255,255,255,0.2)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0
                }}
              >
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  position: 'absolute',
                  top: '3px',
                  left: autoplay ? '21px' : '3px',
                  transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }} />
              </div>
            </div>
          );

          // Helper: Active Queue List
          const renderActiveQueue = () => (
            activeQueue.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeQueue.map((track, idx) => {
                  const isCurrent = idx === queueIndex;
                  const isPast = idx < queueIndex;

                  return (
                    <div 
                      key={`queue-item-${track.id}-${idx}`}
                      ref={isCurrent ? currentQueueItemRef : null}
                      onClick={() => playQueueIndex(idx)}
                      onContextMenu={(e) => openTrackContextMenu(e, track, {
                        onRemoveFromQueue: !isCurrent ? () => removeFromQueue(idx) : undefined
                      })}
                      onDragOver={(event) => {
                        if (draggedQueueIndex === null || idx <= queueIndex) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDragOverQueueIndex(idx);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedQueueIndex !== null && draggedQueueIndex > queueIndex && idx > queueIndex && draggedQueueIndex !== idx) {
                          reorderQueue(draggedQueueIndex, idx);
                        }
                        setDraggedQueueIndex(null);
                        setDragOverQueueIndex(null);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: isCurrent ? '10px' : '8px',
                        borderRadius: '6px',
                        backgroundColor: isCurrent ? 'rgba(52, 152, 219, 0.12)' : 'var(--bg-card)',
                        border: `1px solid ${isCurrent ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isCurrent ? '0 0 12px rgba(52, 152, 219, 0.25)' : 'none',
                        borderTop: dragOverQueueIndex === idx ? '2px solid var(--accent-primary)' : undefined,
                        opacity: draggedQueueIndex === idx ? 0.45 : (isPast ? 0.6 : 1)
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                        if (isPast) e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                        if (isPast) e.currentTarget.style.opacity = '0.6';
                      }}
                    >
                      {idx > queueIndex && (
                        <div
                          className="track-drag-handle"
                          draggable
                          title="Drag to reorder upcoming tracks"
                          onClick={event => event.stopPropagation()}
                          onDragStart={(event) => {
                            setDraggedQueueIndex(idx);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', String(idx));
                          }}
                          onDragEnd={() => {
                            setDraggedQueueIndex(null);
                            setDragOverQueueIndex(null);
                          }}
                        >
                          <GripVertical size={15} />
                        </div>
                      )}

                      {/* Cover Art */}
                      <div 
                        style={{
                          width: isCurrent ? '42px' : '36px',
                          height: isCurrent ? '42px' : '36px',
                          borderRadius: '4px',
                          backgroundImage: `url(${track.cover})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          position: 'relative',
                          flexShrink: 0
                        }}
                      >
                        {isCurrent && isPlaying && (
                          <div style={{
                            position: 'absolute',
                            bottom: '2px',
                            right: '2px',
                            backgroundColor: 'rgba(0,0,0,0.75)',
                            borderRadius: '3px',
                            padding: '2px 3px',
                            display: 'flex',
                            alignItems: 'center'
                          }}>
                            <Volume2 size={11} color="var(--accent-primary)" />
                          </div>
                        )}
                      </div>

                      {/* Track Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: isCurrent ? 700 : 600,
                          fontSize: isCurrent ? '0.9rem' : '0.85rem',
                          color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {track.title}
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)',
                          opacity: isCurrent ? 0.85 : 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '2px'
                        }}>
                          {track.artist}
                        </div>
                      </div>

                      {/* Duration & Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)',
                          fontWeight: isCurrent ? 700 : 400
                        }}>
                          {formatDuration(isCurrent && duration > 0 ? duration : track.duration)}
                        </span>

                        <TrackOptionsMenu 
                          track={track} 
                          variant="row" 
                          onRemoveFromQueue={!isCurrent ? () => removeFromQueue(idx) : undefined} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null
          );

          // Helper: Recommendations Stream
          const renderRecommendationsList = () => {
            let list = recommendedUpNext;
            if (autoplayFilter === 'familiar') {
              const filtered = recommendedUpNext.filter(t => 
                t.artist.toLowerCase() === currentTrack?.artist.toLowerCase() ||
                favorites.some(f => f.id === t.id) ||
                Boolean(playHistory[t.id])
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'popular') {
              const filtered = recommendedUpNext.filter(t => 
                t.artist.toLowerCase() === currentTrack?.artist.toLowerCase() ||
                (t.duration > 110 && t.duration < 280)
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'discover') {
              const filtered = recommendedUpNext.filter(t => 
                !favorites.some(f => f.id === t.id) &&
                !playHistory[t.id] &&
                t.artist.toLowerCase() !== currentTrack?.artist.toLowerCase()
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'deep_cuts') {
              const filtered = recommendedUpNext.filter(t => 
                t.title.toLowerCase().includes('remix') ||
                t.title.toLowerCase().includes('feat') ||
                t.title.toLowerCase().includes('slowed') ||
                t.title.toLowerCase().includes('acoustic') ||
                t.album === 'Single'
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'downbeat') {
              const filtered = recommendedUpNext.filter(t => 
                t.duration > 160 ||
                t.title.toLowerCase().includes('acoustic') ||
                t.title.toLowerCase().includes('slowed') ||
                t.title.toLowerCase().includes('instrumental') ||
                t.title.toLowerCase().includes('outro')
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'upbeat') {
              const filtered = recommendedUpNext.filter(t => 
                (t.duration > 0 && t.duration < 195) &&
                !t.title.toLowerCase().includes('acoustic') &&
                !t.title.toLowerCase().includes('slowed') &&
                !t.title.toLowerCase().includes('outro')
              );
              if (filtered.length > 0) list = filtered;
            } else if (autoplayFilter === 'instrumental') {
              const filtered = recommendedUpNext.filter(t => 
                t.title.toLowerCase().includes('instrumental') ||
                t.title.toLowerCase().includes('beat') ||
                t.title.toLowerCase().includes('intro') ||
                t.title.toLowerCase().includes('ost') ||
                t.title.toLowerCase().includes('piano')
              );
              if (filtered.length > 0) list = filtered;
            }

            if (list.length > 0) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {list.map((track, idx) => {
                    const isAdded = addedTrackIds.has(track.id);
                    return (
                      <div 
                        key={`rec-upnext-${track.id}-${idx}`}
                        onContextMenu={(e) => openTrackContextMenu(e, track)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-color)',
                          transition: 'background-color 0.15s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                      >
                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '4px',
                            backgroundImage: `url(${track.cover})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            cursor: 'pointer',
                            position: 'relative',
                            flexShrink: 0
                          }}
                        >
                          <div style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.3)',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Play size={13} fill="white" color="white" />
                          </div>
                        </div>

                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                            {track.artist}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {formatDuration(track.duration)}
                          </span>

                          <button
                            onClick={() => handleAddRecommendedToQueue(track)}
                            title={isAdded ? 'Added to queue' : 'Add to queue'}
                            style={{
                              background: isAdded ? 'var(--accent-primary)' : 'none',
                              border: `1px solid ${isAdded ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                              color: isAdded ? '#ffffff' : 'var(--text-secondary)',
                              borderRadius: '50%',
                              width: '26px',
                              height: '26px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s'
                            }}
                          >
                            {isAdded ? <Check size={13} /> : <Plus size={13} />}
                          </button>

                          <TrackOptionsMenu track={track} variant="row" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            if (isLoadingMix) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[1, 2, 3, 4].map(idx => (
                    <div
                      key={`upnext-skel-${idx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-color)',
                        opacity: 0.6,
                        animation: 'pulse 1.5s infinite ease-in-out'
                      }}
                    >
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        flexShrink: 0
                      }} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ height: '12px', width: `${55 + (idx * 11) % 30}%`, borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.07)' }} />
                        <div style={{ height: '10px', width: `${30 + (idx * 9) % 25}%`, borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.04)' }} />
                      </div>
                      <div style={{ width: '28px', height: '10px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.04)' }} />
                    </div>
                  ))}
                </div>
              );
            }

            return (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '16px 0', textAlign: 'center' }}>
                No additional recommendations found.
              </div>
            );
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Playing From Context Banner & Save Button (YouTube Music Style) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '4px'
              }}>
                <div>
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.04em' }}>
                    Playing from
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {playingFrom || `${currentTrack?.title || currentTrack?.artist || 'Track'} Mix`}
                  </div>
                </div>

                {/* Save Queue as Playlist */}
                <button
                  onClick={() => saveQueueAsPlaylist()}
                  title="Save queue to your playlists"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                >
                  <ListPlus size={15} />
                  <span>Save</span>
                </button>
              </div>

              {/* MODE 1: RADIO (Screenshots 1 & 2 - Endless Seamless Radio with Filter Chips at Top) */}
              {effectiveContext === 'radio' && (
                <>
                  {renderFilterChips()}
                  {renderActiveQueue()}
                  {renderRecommendationsList()}
                </>
              )}

              {/* MODE 2: FINITE (Screenshots 3 & 4 - Single Search Result, Album, Community Playlist) */}
              {effectiveContext === 'finite' && (
                <>
                  {renderAutoplayToggleCard()}
                  {renderActiveQueue()}
                  {autoplay && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                          Autoplay is on
                        </span>
                        {isLoadingMix && <Loader2 size={13} className="animate-spin" color="var(--accent-primary)" />}
                      </div>
                      {renderFilterChips()}
                      {renderRecommendationsList()}
                    </div>
                  )}
                </>
              )}

              {/* MODE 3: USER PLAYLIST (Library User Playlists & Local Files - Strict Queue, No Autoplay Divider) */}
              {effectiveContext === 'user_playlist' && (
                <>
                  {renderActiveQueue()}
                </>
              )}
            </div>
          );
        })()}

        {/* ========================================================================= */}
        {/* TAB 2: LYRICS (LRCLIB Synced Karaoke, Plain & Genius Integration)          */}
        {/* ========================================================================= */}
        {activePlayerTab === 'lyrics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {currentTrack && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                paddingBottom: '14px',
                borderBottom: '1px solid var(--border-color)'
              }}>
                {/* Track Info & Provider Badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div 
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '6px',
                        backgroundImage: `url(${currentTrack.cover})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        flexShrink: 0
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentTrack.title}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentTrack.artist}
                      </div>
                    </div>
                  </div>

                  {/* Lyrics Provider Badge */}
                  {lyricsResult && lyricsResult.source !== 'None' && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: lyricsResult.isSynced ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      flexShrink: 0
                    }}>
                      <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: lyricsResult.isSynced ? 'var(--accent-primary)' : 'var(--text-secondary)'
                      }} />
                      <span>{lyricsResult.isSynced ? `Synced • ${lyricsResult.source}` : lyricsResult.source}</span>
                    </div>
                  )}
                </div>

                {/* Lyrics Toolbar: Synced/Plain Mode, Font Size, Copy */}
                {lyricsResult && (lyricsResult.synced || lyricsResult.plain) && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
                    {/* Mode Toggle (if synced lyrics available) */}
                    {lyricsResult.synced && (
                      <div style={{ display: 'flex', gap: '4px', backgroundColor: 'rgba(255,255,255,0.04)', padding: '2px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                        <button
                          onClick={() => setLyricsMode('synced')}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '14px',
                            fontSize: '0.72rem',
                            fontWeight: lyricsMode === 'synced' ? 700 : 500,
                            backgroundColor: lyricsMode === 'synced' ? 'var(--accent-primary)' : 'transparent',
                            color: lyricsMode === 'synced' ? '#ffffff' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          Synced
                        </button>
                        <button
                          onClick={() => setLyricsMode('plain')}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '14px',
                            fontSize: '0.72rem',
                            fontWeight: lyricsMode === 'plain' ? 700 : 500,
                            backgroundColor: lyricsMode === 'plain' ? 'var(--accent-primary)' : 'transparent',
                            color: lyricsMode === 'plain' ? '#ffffff' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          Static
                        </button>
                      </div>
                    )}

                    {/* Font Size & Copy Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                      {/* Font Size Controls */}
                      <button
                        onClick={() => setLyricsFontSize(prev => Math.max(0.85, prev - 0.1))}
                        title="Smaller lyrics font"
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-secondary)',
                          fontSize: '0.72rem',
                          cursor: 'pointer'
                        }}
                      >
                        A-
                      </button>
                      <button
                        onClick={() => setLyricsFontSize(prev => Math.min(1.45, prev + 0.1))}
                        title="Larger lyrics font"
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-secondary)',
                          fontSize: '0.72rem',
                          cursor: 'pointer'
                        }}
                      >
                        A+
                      </button>

                      {/* Copy Lyrics */}
                      <button
                        onClick={() => {
                          const text = lyricsResult.plain || (lyricsResult.synced ? lyricsResult.synced.map(s => s.text).join('\n') : '');
                          if (text) {
                            navigator.clipboard.writeText(text);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }
                        }}
                        title="Copy full lyrics"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          backgroundColor: isCopied ? 'rgba(46, 204, 113, 0.15)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isCopied ? '#2ecc71' : 'var(--border-color)'}`,
                          color: isCopied ? '#2ecc71' : 'var(--text-secondary)',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isLyricsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: 'var(--accent-primary)' }}>
                <Loader2 size={28} className="animate-spin" />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Searching LRCLIB & Genius...</span>
              </div>
            ) : lyricsResult?.synced && lyricsMode === 'synced' ? (
              /* Synced Real-Time Lyrics with Tap-to-Seek */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
                {lyricsResult.synced.map((line, index) => {
                  const nextLine = lyricsResult.synced![index + 1];
                  const adjustedTime = currentTime + 0.08;
                  const isCurrent = adjustedTime >= line.time && (!nextLine || adjustedTime < nextLine.time);
                  const isPast = nextLine && adjustedTime >= nextLine.time;

                  return (
                    <div
                      key={`lyric-${index}`}
                      ref={isCurrent ? activeLyricRef : null}
                      onClick={() => handleSeekToLyric(line.time)}
                      title={`Click to jump to ${formatDuration(line.time)}`}
                      style={{
                        fontSize: isCurrent ? `${1.25 * lyricsFontSize}rem` : `${1.05 * lyricsFontSize}rem`,
                        fontWeight: isCurrent ? 800 : 500,
                        color: isCurrent 
                          ? 'var(--accent-primary)' 
                          : isPast 
                            ? 'rgba(255,255,255,0.4)' 
                            : 'rgba(255,255,255,0.75)',
                        cursor: 'pointer',
                        lineHeight: '1.6',
                        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        backgroundColor: isCurrent ? 'rgba(52, 152, 219, 0.1)' : 'transparent',
                        textShadow: isCurrent ? '0 0 20px rgba(52, 152, 219, 0.5)' : 'none',
                        transform: isCurrent ? 'scale(1.02)' : 'scale(1)',
                        transformOrigin: 'left center'
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {line.text}
                    </div>
                  );
                })}
              </div>
            ) : lyricsResult?.plain ? (
              /* Plain Text Static Lyrics */
              <div style={{
                whiteSpace: 'pre-wrap',
                lineHeight: '1.9',
                fontSize: `${lyricsFontSize}rem`,
                color: 'var(--text-primary)',
                padding: '8px 4px 32px'
              }}>
                {lyricsResult.plain}
              </div>
            ) : (
              /* Empty Fallback State with Direct Search */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '16px', color: 'var(--text-secondary)' }}>
                <Music size={36} opacity={0.4} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    No Automated Lyrics Found
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Search directly on leading lyrics platforms:
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <a
                    href={`https://genius.com/search?q=${encodeURIComponent(`${currentTrack?.artist || ''} ${currentTrack?.title || ''}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 0, 0.1)',
                      border: '1px solid rgba(255, 255, 0, 0.3)',
                      color: '#ffff55',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textDecoration: 'none'
                    }}
                  >
                    <BookOpen size={14} />
                    <span>Search Genius ↗</span>
                  </a>

                  <a
                    href={`https://www.musixmatch.com/search/${encodeURIComponent(`${currentTrack?.artist || ''} ${currentTrack?.title || ''}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 75, 75, 0.1)',
                      border: '1px solid rgba(255, 75, 75, 0.3)',
                      color: '#ff6b6b',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textDecoration: 'none'
                    }}
                  >
                    <Search size={14} />
                    <span>Search Musixmatch ↗</span>
                  </a>
                </div>
              </div>
            )}

            {/* Genius Annotation & Meaning Card */}
            {lyricsResult?.geniusUrl && (
              <div style={{
                marginTop: '12px',
                padding: '14px 16px',
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <BookOpen size={18} color="#ffff55" />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Genius Verified Annotations
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Read story, meanings, and line-by-line breakdowns
                    </div>
                  </div>
                </div>

                <a
                  href={lyricsResult.geniusUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <span>Open</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: RELATED                                                            */}
        {/* ========================================================================= */}
        {activePlayerTab === 'related' && currentTrack && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', paddingBottom: '32px' }}>
            
            {/* 1. YOU MIGHT ALSO LIKE */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                    You Might Also Like
                  </span>
                </div>
                {isLoadingMix && <Loader2 size={13} className="animate-spin" color="var(--accent-primary)" />}
              </div>

              {recommendedUpNext.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recommendedUpNext.slice(0, 5).map((track) => {
                    const isAdded = addedTrackIds.has(track.id);
                    return (
                      <div 
                        key={`related-rec-${track.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                      >
                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '6px',
                            backgroundImage: `url(${track.cover})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            cursor: 'pointer',
                            position: 'relative',
                            flexShrink: 0
                          }}
                        >
                          <div style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.35)',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Play size={14} fill="white" color="white" />
                          </div>
                        </div>

                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                            {track.artist}
                          </div>
                        </div>

                        <button
                          onClick={() => handleAddRecommendedToQueue(track)}
                          title={isAdded ? 'Added to queue' : 'Add to queue'}
                          style={{
                            background: isAdded ? 'var(--accent-primary)' : 'none',
                            border: `1px solid ${isAdded ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                            color: isAdded ? '#ffffff' : 'var(--text-secondary)',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                            transition: 'all 0.15s'
                          }}
                        >
                          {isAdded ? <Check size={14} /> : <Plus size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '12px 0', textAlign: 'center' }}>
                  {isLoadingMix ? 'Finding recommendations...' : 'No related songs found.'}
                </div>
              )}
            </div>

            {/* 2. SIMILAR ARTISTS */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Compass size={16} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                    Similar Artists
                  </span>
                </div>
                {isSimilarArtistsLoading && <Loader2 size={13} className="animate-spin" color="var(--accent-primary)" />}
              </div>

              {similarArtists.length > 0 ? (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', 
                  gap: '12px' 
                }}>
                  {similarArtists.map((artist, idx) => (
                    <div 
                      key={`sim-art-${idx}-${artist.name}`}
                      onClick={() => {
                        navigate(`/artist/${encodeURIComponent(artist.name)}${artist.channelId ? `?channelId=${encodeURIComponent(artist.channelId)}` : (artist.artistId ? `?artistId=${encodeURIComponent(artist.artistId)}` : '')}`);
                        closePlayerDrawer();
                      }}
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        padding: '12px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div 
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          backgroundColor: 'var(--bg-main)',
                          marginBottom: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          border: '2px solid rgba(255,255,255,0.1)'
                        }}
                      >
                        <img 
                          src={artist.cover} 
                          alt={artist.name} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80'; }}
                        />
                      </div>
                      <div style={{ 
                        fontWeight: 700, 
                        fontSize: '0.8rem', 
                        color: 'var(--text-primary)', 
                        whiteSpace: 'nowrap', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis',
                        width: '100%' 
                      }}>
                        {artist.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', marginTop: '2px' }}>
                        View Profile
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '12px 0', textAlign: 'center' }}>
                  {isSimilarArtistsLoading ? 'Discovering similar artists...' : 'No similar artists found.'}
                </div>
              )}
            </div>

            {/* 3. MORE FROM ARTIST */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Music size={16} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                    More from {currentTrack.artist}
                  </span>
                </div>
                <button
                  onClick={() => {
                    navigate(`/artist/${encodeURIComponent(currentTrack.artist)}${currentTrack.artistId ? `?artistId=${encodeURIComponent(currentTrack.artistId)}` : (currentTrack.channelId ? `?channelId=${encodeURIComponent(currentTrack.channelId)}` : '')}`);
                    closePlayerDrawer();
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-primary)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>See All</span>
                  <ExternalLink size={12} />
                </button>
              </div>

              {moreFromArtist.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {moreFromArtist.slice(0, 6).map((track) => {
                    const isAdded = addedTrackIds.has(track.id);
                    return (
                      <div
                        key={`more-art-${track.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                      >
                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '6px',
                            backgroundImage: `url(${track.cover})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            cursor: 'pointer',
                            position: 'relative',
                            flexShrink: 0
                          }}
                        >
                          <div style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.35)',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Play size={14} fill="white" color="white" />
                          </div>
                        </div>

                        <div 
                          onClick={() => handlePlayRecommendedTrack(track)}
                          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {formatDuration(track.duration)} {track.album ? `• ${track.album}` : ''}
                          </div>
                        </div>

                        <button
                          onClick={() => handleAddRecommendedToQueue(track)}
                          title={isAdded ? 'Added to queue' : 'Add to queue'}
                          style={{
                            background: isAdded ? 'var(--accent-primary)' : 'none',
                            border: `1px solid ${isAdded ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                            color: isAdded ? '#ffffff' : 'var(--text-secondary)',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                            transition: 'all 0.15s'
                          }}
                        >
                          {isAdded ? <Check size={14} /> : <Plus size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '12px 0', textAlign: 'center' }}>
                  {isMoreFromArtistLoading ? `Loading tracks by ${currentTrack.artist}...` : 'No additional tracks found.'}
                </div>
              )}
            </div>

            {/* 4. SONG DETAILS (Official Page, Metadata) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Info size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                  Song Details
                </span>
              </div>

              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Track</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{currentTrack.title}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Artist</span>
                  <span 
                    onClick={() => {
                      navigate(`/artist/${encodeURIComponent(currentTrack.artist)}${currentTrack.artistId ? `?artistId=${encodeURIComponent(currentTrack.artistId)}` : (currentTrack.channelId ? `?channelId=${encodeURIComponent(currentTrack.channelId)}` : '')}`);
                      closePlayerDrawer();
                    }}
                    style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-primary)', cursor: 'pointer', textAlign: 'right' }}
                  >
                    {currentTrack.artist}
                  </span>
                </div>

                {currentTrack.album && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Album</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{currentTrack.album}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Duration</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{formatDuration(currentTrack.duration)}</span>
                </div>

                {/* Official Release Page Link (Within the Player) */}
                <button
                  onClick={() => {
                    const rawAlb = currentTrack.album?.trim();
                    const isGenericAlb = !rawAlb || 
                      rawAlb.toLowerCase() === 'web stream' || 
                      rawAlb.toLowerCase() === 'single' || 
                      rawAlb.toLowerCase() === 'official release' || 
                      rawAlb.toLowerCase() === 'official audio' || 
                      rawAlb.toLowerCase() === 'top track' || 
                      rawAlb.toLowerCase() === 'top songs' || 
                      rawAlb.toLowerCase() === 'youtube music' ||
                      rawAlb.startsWith('@') ||
                      rawAlb.toLowerCase().includes('+');
                    const releaseName = isGenericAlb ? currentTrack.title : rawAlb;
                    let releaseTargetId = (currentTrack as any).albumId;
                    if (releaseTargetId && (releaseTargetId.startsWith('PL') || releaseTargetId.startsWith('VLPL') || releaseTargetId.startsWith('RD') || releaseTargetId.startsWith('VLRD') || releaseTargetId.startsWith('community-') || releaseTargetId.startsWith('mix-'))) {
                      releaseTargetId = undefined;
                    }
                    if (!releaseTargetId) {
                      releaseTargetId = `album-${encodeURIComponent(releaseName)}`;
                    }
                    const releaseArtist = currentTrack.artist || currentTrack.albumArtist || '';
                    
                    navigate(`/album/${encodeURIComponent(releaseTargetId)}?name=${encodeURIComponent(releaseName)}&artist=${encodeURIComponent(releaseArtist)}&cover=${encodeURIComponent(currentTrack.cover || '')}&trackTitle=${encodeURIComponent(currentTrack.title || '')}`);
                    closePlayerDrawer();
                  }}
                  className="hero-play-btn"
                  style={{
                    marginTop: '6px',
                    padding: '10px 16px',
                    fontSize: '0.85rem',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
                >
                  <Disc size={16} color="var(--accent-primary)" />
                  <span>View Official Release Page</span>
                </button>
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}


