import { useState, useEffect, useRef } from 'react';
import { 
  X, Sparkles, Music, Play, Plus, Trash2, Mic2, ListMusic, 
  Compass, Radio, Volume2, Check, ExternalLink, Loader2, Info, Disc
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import { fetchUpNextMix, fetchSimilarArtists, fetchArtistDeepTracks } from '../../services/musicSearch';
import type { Track, SimilarArtist } from '../../types';

interface ParsedLyricLine {
  time: number;
  text: string;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function PlayerDrawer() {
  const navigate = useNavigate();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    queue,
    shuffledQueue,
    queueIndex,
    isShuffle,
    autoplay,
    playingFrom,
    recommendedUpNext,
    activePlayerTab,
    isPlayerDrawerOpen,
    favorites,
    playHistory,
    setQueue,
    addToQueue,
    removeFromQueue,
    toggleAutoplay,
    setRecommendedUpNext,
    setActivePlayerTab,
    closePlayerDrawer,
    setCurrentTime
  } = usePlayerStore();

  const [isLoadingMix, setIsLoadingMix] = useState(false);
  const [lyricsData, setLyricsData] = useState<{ synced: ParsedLyricLine[] | null; plain: string | null } | null>(null);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [addedTrackIds, setAddedTrackIds] = useState<Set<string>>(new Set());
  
  // Related Tab Data
  const [similarArtists, setSimilarArtists] = useState<SimilarArtist[]>([]);
  const [isSimilarArtistsLoading, setIsSimilarArtistsLoading] = useState(false);
  const [moreFromArtist, setMoreFromArtist] = useState<Track[]>([]);
  const [isMoreFromArtistLoading, setIsMoreFromArtistLoading] = useState(false);

  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);
  const currentQueueItemRef = useRef<HTMLDivElement>(null);

  const activeQueue = isShuffle ? shuffledQueue : queue;

  // Auto-scroll to current track in queue
  useEffect(() => {
    if (currentQueueItemRef.current && activePlayerTab === 'up_next') {
      currentQueueItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [queueIndex, activePlayerTab, isPlayerDrawerOpen]);

  // 1. Fetch Dynamic Algorithmic "Up Next / Auto-Mix" when current track changes
  useEffect(() => {
    if (!currentTrack) return;

    let isMounted = true;
    setIsLoadingMix(true);

    const queuedIds = new Set(activeQueue.map(t => t.id));

    fetchUpNextMix(currentTrack, favorites, playHistory, queuedIds)
      .then(mix => {
        if (isMounted) {
          setRecommendedUpNext(mix);
          setIsLoadingMix(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoadingMix(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentTrack?.id, favorites.length]);

  // 2. Fetch Synced & Plain Lyrics from LRCLIB
  useEffect(() => {
    if (!currentTrack || activePlayerTab !== 'lyrics') return;

    let isMounted = true;
    setIsLyricsLoading(true);
    setLyricsData(null);

    const fetchLyrics = async () => {
      try {
        const url = new URL('https://lrclib.net/api/get');
        url.searchParams.append('track_name', currentTrack.title);
        url.searchParams.append('artist_name', currentTrack.artist);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error('Lyrics not found');

        const data = await res.json();
        if (!isMounted) return;

        if (data.syncedLyrics) {
          // Parse LRC format [mm:ss.xx]
          const lines: ParsedLyricLine[] = [];
          const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

          data.syncedLyrics.split('\n').forEach((line: string) => {
            const match = line.match(regex);
            if (match) {
              const minutes = parseInt(match[1], 10);
              const seconds = parseInt(match[2], 10);
              const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
              const time = minutes * 60 + seconds + millis / 1000;
              const text = match[4].trim();
              if (text) {
                lines.push({ time, text });
              }
            }
          });

          setLyricsData({
            synced: lines.length > 0 ? lines : null,
            plain: data.plainLyrics || data.syncedLyrics
          });
        } else if (data.plainLyrics) {
          setLyricsData({ synced: null, plain: data.plainLyrics });
        } else {
          setLyricsData(null);
        }
      } catch (err) {
        if (isMounted) {
          setLyricsData(null);
        }
      } finally {
        if (isMounted) setIsLyricsLoading(false);
      }
    };

    fetchLyrics();

    return () => {
      isMounted = false;
    };
  }, [currentTrack?.id, activePlayerTab]);

  // 3. Auto-Scroll Synced Lyrics
  useEffect(() => {
    if (activeLyricRef.current && activePlayerTab === 'lyrics') {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
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
  }, [currentTrack?.id, currentTrack?.artist, activePlayerTab]);

  if (!isPlayerDrawerOpen) return null;

  const handlePlayRecommendedTrack = (track: Track) => {
    // Insert into queue right after current track and play
    const newQueue = [...activeQueue.slice(0, queueIndex + 1), track, ...activeQueue.slice(queueIndex + 1)];
    setQueue(newQueue, queueIndex + 1, `${track.artist} Mix`);
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

  return (
    <div 
      className="player-drawer-container"
      style={{
        width: '380px',
        backgroundColor: 'var(--bg-card)',
        borderLeft: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 25,
        height: '100%',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        position: 'relative'
      }}
    >
      {/* Header with YouTube Music Tabs */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'var(--bg-secondary)'
      }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setActivePlayerTab('up_next')}
            style={{
              background: 'none',
              border: 'none',
              color: activePlayerTab === 'up_next' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: activePlayerTab === 'up_next' ? 'rgba(52, 152, 219, 0.1)' : 'transparent',
              transition: 'all 0.15s ease'
            }}
          >
            <ListMusic size={15} />
            <span>UP NEXT</span>
          </button>

          <button
            onClick={() => setActivePlayerTab('lyrics')}
            style={{
              background: 'none',
              border: 'none',
              color: activePlayerTab === 'lyrics' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: activePlayerTab === 'lyrics' ? 'rgba(52, 152, 219, 0.1)' : 'transparent',
              transition: 'all 0.15s ease'
            }}
          >
            <Mic2 size={15} />
            <span>LYRICS</span>
          </button>

          <button
            onClick={() => setActivePlayerTab('related')}
            style={{
              background: 'none',
              border: 'none',
              color: activePlayerTab === 'related' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: activePlayerTab === 'related' ? 'rgba(52, 152, 219, 0.1)' : 'transparent',
              transition: 'all 0.15s ease'
            }}
          >
            <Compass size={15} />
            <span>RELATED</span>
          </button>
        </div>

        <button 
          onClick={closePlayerDrawer}
          className="secondary-btn"
          style={{ padding: '6px', borderRadius: '50%' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Drawer Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* ========================================================================= */}
        {/* TAB 1: UP NEXT                                                            */}
        {/* ========================================================================= */}
        {activePlayerTab === 'up_next' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Playing From Context Banner (YouTube Music Style) */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.05em' }}>
                  Playing from
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Radio size={14} color="var(--accent-primary)" />
                  <span>{playingFrom || `${currentTrack?.artist || 'Music'} Mix`}</span>
                </div>
              </div>

              {/* Autoplay Toggle Switch */}
              <div 
                onClick={toggleAutoplay}
                title="Autoplay similar tracks continuously when queue ends"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: autoplay ? 'rgba(52, 152, 219, 0.15)' : 'var(--bg-card)',
                  border: `1px solid ${autoplay ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  padding: '6px 12px',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: autoplay ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                  Autoplay {autoplay ? 'ON' : 'OFF'}
                </span>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: autoplay ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  boxShadow: autoplay ? '0 0 8px var(--accent-primary)' : 'none'
                }} />
              </div>
            </div>

            {/* Unified Queue Section (Previous Songs + Active Playing + Upcoming) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Queue ({activeQueue.length})
                </div>
                {activeQueue.length > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Track {queueIndex + 1} of {activeQueue.length}
                  </div>
                )}
              </div>

              {activeQueue.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeQueue.map((track, idx) => {
                    const isCurrent = idx === queueIndex;
                    const isPast = idx < queueIndex;

                    return (
                      <div 
                        key={`queue-item-${track.id}-${idx}`}
                        ref={isCurrent ? currentQueueItemRef : null}
                        onClick={() => usePlayerStore.setState({ queueIndex: idx, currentTrack: track, currentTime: 0, isPlaying: true })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: isCurrent ? '10px' : '8px',
                          borderRadius: '6px',
                          backgroundColor: isCurrent ? 'rgba(52, 152, 219, 0.12)' : 'var(--bg-card)',
                          border: `1px solid ${isCurrent ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          opacity: isPast ? 0.6 : 1,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isCurrent ? '0 0 12px rgba(52, 152, 219, 0.25)' : 'none'
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '0.75rem',
                            color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            fontWeight: isCurrent ? 700 : 400
                          }}>
                            {formatDuration(track.duration)}
                          </span>

                          {!isCurrent && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromQueue(idx);
                              }}
                              title="Remove from queue"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '12px 0' }}>
                  Queue is empty.
                </div>
              )}
            </div>

            {/* Recommended Auto-Mix Section (YouTube Music Algorithm) */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '0.05em' }}>
                    Recommended Auto-Mix
                  </span>
                </div>
                {isLoadingMix && <Loader2 size={13} className="animate-spin" color="var(--accent-primary)" />}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Similar tracks selected by the algorithm based on your listening tastes.
              </div>

              {recommendedUpNext.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {recommendedUpNext.map((track) => {
                    const isAdded = addedTrackIds.has(track.id);
                    return (
                      <div 
                        key={`rec-${track.id}`}
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
                            width: '40px',
                            height: '40px',
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
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '16px 0', textAlign: 'center' }}>
                  {isLoadingMix ? 'Generating your personalized auto-mix...' : 'No additional recommendations found.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: LYRICS (Synced & Plain)                                            */}
        {/* ========================================================================= */}
        {activePlayerTab === 'lyrics' && (
          <div ref={lyricsScrollRef} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {currentTrack && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div 
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '6px',
                    backgroundImage: `url(${currentTrack.cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    flexShrink: 0
                  }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{currentTrack.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{currentTrack.artist}</div>
                </div>
              </div>
            )}

            {isLyricsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: 'var(--accent-primary)' }}>
                <Loader2 size={28} className="animate-spin" />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Searching lyrics...</span>
              </div>
            ) : lyricsData?.synced ? (
              /* Synced Real-Time Lyrics */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingBottom: '32px' }}>
                {lyricsData.synced.map((line, index) => {
                  const nextLine = lyricsData.synced![index + 1];
                  const isCurrent = currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
                  const isPast = nextLine && currentTime >= nextLine.time;

                  return (
                    <div
                      key={`lyric-${index}`}
                      ref={isCurrent ? activeLyricRef : null}
                      onClick={() => handleSeekToLyric(line.time)}
                      style={{
                        fontSize: isCurrent ? '1.15rem' : '0.95rem',
                        fontWeight: isCurrent ? 800 : 500,
                        color: isCurrent 
                          ? 'var(--accent-primary)' 
                          : isPast 
                            ? 'rgba(255,255,255,0.45)' 
                            : 'rgba(255,255,255,0.75)',
                        cursor: 'pointer',
                        lineHeight: '1.5',
                        transition: 'all 0.2s ease',
                        padding: '4px 0',
                        textShadow: isCurrent ? '0 0 16px rgba(52, 152, 219, 0.4)' : 'none'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
                      onMouseLeave={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.color = isPast ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.75)';
                        }
                      }}
                    >
                      {line.text}
                    </div>
                  );
                })}
              </div>
            ) : lyricsData?.plain ? (
              /* Plain Text Lyrics */
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {lyricsData.plain}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: 'var(--text-secondary)' }}>
                <Music size={32} />
                <span style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>No lyrics found for this track.</span>
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
                    const releaseTargetId = currentTrack.album 
                      ? (currentTrack.id.startsWith('profile-') ? `album-derived-${currentTrack.id.replace('profile-', '')}` : currentTrack.id)
                      : (currentTrack.id.startsWith('piped-') ? currentTrack.id.replace('piped-', '') : currentTrack.id);
                    const releaseName = currentTrack.album || currentTrack.title;
                    
                    navigate(`/album/${encodeURIComponent(releaseTargetId)}?name=${encodeURIComponent(releaseName)}&artist=${encodeURIComponent(currentTrack.artist)}`);
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
  );
}
