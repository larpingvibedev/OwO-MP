import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { 
  getDirectYouTubeId,
  resolveYouTubeVideoId, 
  resolveYouTubeMusicATV,
  getFallbackVideoId, 
  invalidateVideoId, 
  prefetchTrackVideoId,
  fetchUpNextMix 
} from '../services/musicSearch';

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef<boolean>(false);
  const intervalRef = useRef<any>(null);
  
  const currentVideoIdRef = useRef<string | null>(null);
  const pendingVideoIdRef = useRef<string | null>(null);
  const isSwitchingRef = useRef<boolean>(false);
  const activeLoadedTrackIdRef = useRef<string | null>(null);

  const {
    currentTrack,
    isPlaying,
    volume,
    queue,
    shuffledQueue,
    queueIndex,
    isShuffle,
    repeatMode,
    favorites,
    playHistory,
    nextTrack,
    prevTrack,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    recordPlay,
    setRecommendedUpNext
  } = usePlayerStore();

  // 1. Initialize YouTube IFrame API
  useEffect(() => {
    function createYTPlayer() {
      if (ytPlayerRef.current || !window.YT || !window.YT.Player) return;

      ytPlayerRef.current = new window.YT.Player('yt-audio-player', {
        height: '200',
        width: '200',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            if (ytPlayerRef.current) {
              try {
                ytPlayerRef.current.setVolume(volume * 100);
              } catch (e) {}

              // If a track was queued before iframe was ready, play it immediately!
              if (pendingVideoIdRef.current) {
                const vid = pendingVideoIdRef.current;
                pendingVideoIdRef.current = null;
                currentVideoIdRef.current = vid;
                try {
                  ytPlayerRef.current.loadVideoById(vid);
                } catch (err) {
                  console.warn('Error playing pending video:', err);
                }
              }
            }
          },
          onStateChange: (event: any) => {
            // 0 = ENDED
            if (event.data === 0) {
              if (!isSwitchingRef.current) {
                isSwitchingRef.current = true;
                const currentRepeat = usePlayerStore.getState().repeatMode;
                if (currentRepeat === 'one') {
                  if (ytPlayerRef.current) {
                    try {
                      ytPlayerRef.current.seekTo(0);
                      ytPlayerRef.current.playVideo();
                      isSwitchingRef.current = false;
                    } catch (e) {}
                  }
                } else {
                  usePlayerStore.getState().nextTrack();
                }
              }
            }
            // 1 = PLAYING
            if (event.data === 1) {
              isSwitchingRef.current = false;
              if (!usePlayerStore.getState().isPlaying) {
                setIsPlaying(true);
              }
              // Immediately sync live YouTube video duration
              if (ytPlayerRef.current?.getDuration) {
                const realDur = ytPlayerRef.current.getDuration();
                if (realDur > 0) {
                  usePlayerStore.getState().setDuration(realDur);
                }
              }
            }
          },
          onError: (event: any) => {
            console.warn('YouTube Player Error code:', event.data);
            isSwitchingRef.current = false;
            const state = usePlayerStore.getState();
            const curTrack = state.currentTrack;
            if (curTrack) {
              invalidateVideoId(curTrack.artist, curTrack.title);
              const fallbackId = getFallbackVideoId(curTrack.artist, curTrack.title);
              if (fallbackId && ytPlayerRef.current?.loadVideoById) {
                console.log('Attempting fallback audio candidate:', fallbackId);
                currentVideoIdRef.current = fallbackId;
                ytPlayerRef.current.loadVideoById(fallbackId);
                return;
              }
            }
            // If error is unrecoverable, smoothly advance to next track
            usePlayerStore.getState().nextTrack();
          }
        }
      });
    }

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        createYTPlayer();
      };
    } else if (window.YT && window.YT.Player) {
      createYTPlayer();
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const isYouTubeTrack = (t: typeof currentTrack) => {
    if (!t) return false;
    if (t.source === 'youtube') return true;
    if (t.resolvedStreamUrl?.startsWith('http')) return false;
    return true;
  };

  // 2. Sync Time & Duration tracking & Seamless End-of-Track Autoplay Trigger
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      if (isYouTubeTrack(currentTrack) && ytReadyRef.current && ytPlayerRef.current) {
        try {
          const time = ytPlayerRef.current.getCurrentTime?.() || 0;
          const ytDur = ytPlayerRef.current.getDuration?.() || 0;

          // Always ensure the store's duration matches the actual video duration from YouTube
          if (ytDur > 0) {
            const currentStoreDur = usePlayerStore.getState().duration;
            if (Math.abs(currentStoreDur - ytDur) >= 0.5) {
              setDuration(ytDur);
            }
          }

          const effectiveDur = ytDur > 0 ? ytDur : (usePlayerStore.getState().duration || 180);
          const clampedTime = Math.min(time, effectiveDur);
          if (clampedTime >= 0) {
            setCurrentTime(clampedTime);
          }

          // Fallback end-of-track trigger ONLY when the audio has reached 100% of its full duration
          if (ytDur > 5 && time >= ytDur && !isSwitchingRef.current) {
            isSwitchingRef.current = true;
            setTimeout(() => { isSwitchingRef.current = false; }, 3500);

            const currentRepeat = usePlayerStore.getState().repeatMode;
            if (currentRepeat === 'one') {
              ytPlayerRef.current.seekTo(0);
              ytPlayerRef.current.playVideo();
              isSwitchingRef.current = false;
            } else {
              usePlayerStore.getState().nextTrack();
            }
          }
        } catch (e) {}
      }
    }, 400);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentTrack?.id, setCurrentTime, setDuration]);

  // 3. Play / Pause Control
  useEffect(() => {
    if (isYouTubeTrack(currentTrack)) {
      if (audioRef.current) audioRef.current.pause();

      if (ytReadyRef.current && ytPlayerRef.current && !isSwitchingRef.current) {
        if (isPlaying) {
          try { ytPlayerRef.current.playVideo(); } catch (e) { console.warn(e); }
        } else {
          try { ytPlayerRef.current.pauseVideo(); } catch (e) { console.warn(e); }
        }
      }
    } else {
      if (ytReadyRef.current && ytPlayerRef.current) {
        try { ytPlayerRef.current.pauseVideo(); } catch (e) { console.warn(e); }
      }

      if (audioRef.current && currentTrack) {
        if (isPlaying) {
          audioRef.current.play().catch(() => setIsPlaying(false));
        } else {
          audioRef.current.pause();
        }
      }
    }
  }, [isPlaying, currentTrack?.id, setIsPlaying]);

  // 4. Volume Control
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    if (ytReadyRef.current && ytPlayerRef.current?.setVolume) {
      try { ytPlayerRef.current.setVolume(volume * 100); } catch (e) {}
    }
  }, [volume]);

  // 5. Seek Event Listener (Supports both HTML5 Audio and YouTube Iframe seamlessly)
  useEffect(() => {
    const handleSeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ time: number }>;
      const targetTime = customEvent.detail?.time ?? 0;

      if (isYouTubeTrack(currentTrack)) {
        if (ytReadyRef.current && ytPlayerRef.current?.seekTo) {
          try {
            ytPlayerRef.current.seekTo(targetTime, true);
          } catch (err) {
            console.warn('YT seek error:', err);
          }
        }
      } else {
        if (audioRef.current) {
          try {
            audioRef.current.currentTime = targetTime;
          } catch (err) {
            console.warn('Audio seek error:', err);
          }
        }
      }
    };

    window.addEventListener('music:seek', handleSeek);
    return () => window.removeEventListener('music:seek', handleSeek);
  }, [currentTrack?.id]);

  // 5. Track Change & Stream Resolution
  useEffect(() => {
    let isCancelled = false;

    async function loadTrack() {
      if (!currentTrack) return;

      // Prevent reloading identical track and stuttering opening second
      if (currentTrack.id === activeLoadedTrackIdRef.current) {
        return;
      }
      activeLoadedTrackIdRef.current = currentTrack.id;
      isSwitchingRef.current = true;

      recordPlay(currentTrack);

      // Direct HTTP audio preview/stream
      if (currentTrack.resolvedStreamUrl?.startsWith('http')) {
        if (audioRef.current) {
          audioRef.current.src = currentTrack.resolvedStreamUrl;
          if (isPlaying) {
            audioRef.current.play().catch(console.warn);
          }
        }
        isSwitchingRef.current = false;
        return;
      }

      // Stop any active HTML5 audio when switching to YouTube
      if (audioRef.current) {
        audioRef.current.pause();
      }

      // 1. Direct YouTube Video ID (If track already comes from YouTube search/suggestions/profile)
      let videoId: string | null = getDirectYouTubeId(currentTrack);

      // 2. If no direct videoId (e.g. iTunes or imported track), resolve via ATV & scoring search
      if (!videoId) {
        try {
          const atvId = await resolveYouTubeMusicATV(currentTrack.artist, currentTrack.title);
          if (atvId) {
            videoId = atvId;
          }
        } catch (e) {}
      }

      if (!videoId) {
        videoId = await resolveYouTubeVideoId(
          currentTrack.artist, 
          currentTrack.title, 
          currentTrack.albumArtist, 
          currentTrack.duration
        );
      }

      if (isCancelled) return;

      if (videoId) {
        if (ytReadyRef.current && ytPlayerRef.current?.loadVideoById) {
          currentVideoIdRef.current = videoId;
          try {
            ytPlayerRef.current.loadVideoById({
              videoId,
              startSeconds: 0
            });
          } catch (err) {
            console.warn('Error loading video by ID:', err);
          }
        } else {
          // If player is still preparing, stash videoId to play when onReady fires
          pendingVideoIdRef.current = videoId;
        }
      }

      // 6. Prefetch upcoming tracks in queue for instant 0ms switching
      const activeQueue = isShuffle ? shuffledQueue : queue;
      if (activeQueue.length > 0) {
        const next1 = activeQueue[queueIndex + 1];
        const next2 = activeQueue[queueIndex + 2];
        if (next1) prefetchTrackVideoId(next1);
        if (next2) prefetchTrackVideoId(next2);
      }

      // 7. Background Auto-Mix Pre-Generation (Instant 200ms so queue always has upcoming stream)
      setTimeout(() => {
        if (isCancelled) return;
        const queuedIds = new Set(activeQueue.map(t => t.id));
        fetchUpNextMix(currentTrack, favorites, playHistory, queuedIds)
          .then(mix => {
            if (!isCancelled && mix && mix.length > 0) {
              setRecommendedUpNext(mix);
              // Pre-resolve first auto-mix song so autoplay starts with 0ms latency!
              prefetchTrackVideoId(mix[0]);
            }
          })
          .catch(() => {});
      }, 200);
    }

    loadTrack();

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id]);

  // 7. MediaSession Integration
  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || 'OwO Music Player',
        artwork: [
          { src: currentTrack.cover, sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
    }
  }, [currentTrack, setIsPlaying, prevTrack, nextTrack]);

  return (
    <>
      {/* HTML5 Audio Player for Direct Full-Length Streams */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current && currentTrack?.source !== 'youtube') {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && currentTrack?.source !== 'youtube') {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          if (currentTrack?.source !== 'youtube') {
            if (repeatMode === 'one') {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(console.warn);
              }
            } else {
              usePlayerStore.getState().nextTrack();
            }
          }
        }}
        style={{ display: 'none' }}
      />

      {/* Hidden YouTube Official Audio Engine Element */}
      <div 
        style={{ 
          position: 'fixed', 
          bottom: '-1000px', 
          left: '-1000px', 
          width: '200px', 
          height: '200px', 
          overflow: 'hidden', 
          pointerEvents: 'none', 
          zIndex: -999 
        }}
      >
        <div id="yt-audio-player" />
      </div>
    </>
  );
};
