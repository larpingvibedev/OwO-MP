import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { 
  getDirectYouTubeId,
  resolveYouTubeVideoId, 
  resolveAlternativeVideoId,
  getFallbackVideoId, 
  invalidateVideoId, 
  prefetchTrackVideoId,
  fetchUpNextMix
} from '../services/musicSearch';
import { audioEngine } from '../services/audioEngine';
import { getOfflineTrackBlobUrl } from '../services/downloadService';

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
  const trackStartTimeRef = useRef<number>(0);
  const trackFailedCountRef = useRef<Map<string, number>>(new Map());
  const isOfflineTrackRef = useRef<boolean>(false);

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
    dislikedTracks,
    blockedArtists,
    nextTrack,
    prevTrack,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    recordPlay,
    setRecommendedUpNext,
    syncOfflineTracks
  } = usePlayerStore();

  const isElectron = Boolean((window as any).electronAPI?.isElectron);

  const isYouTubeTrack = (t: typeof currentTrack) => {
    if (!t) return false;
    if (isElectron) return false; // Native Electron uses direct HTML5 stream
    if (isOfflineTrackRef.current) return false;
    if (t.resolvedStreamUrl?.startsWith('http') || t.resolvedStreamUrl?.startsWith('blob:')) return false;
    return true;
  };

  // 1. Initialize Web Audio API engine & YouTube IFrame API
  useEffect(() => {
    syncOfflineTracks();

    if (audioRef.current) {
      audioEngine.init(audioRef.current);
    }

    const handleUserInteraction = () => {
      audioEngine.resume();
    };

    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });

    function createYTPlayer() {
      if (ytPlayerRef.current || !window.YT || !window.YT.Player) return;

      ytPlayerRef.current = new window.YT.Player('yt-audio-player', {
        height: '200',
        width: '200',
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          enablejsapi: 1,
          rel: 0
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
                trackStartTimeRef.current = Date.now();
                isSwitchingRef.current = true;
                try {
                  ytPlayerRef.current.loadVideoById({
                    videoId: vid,
                    startSeconds: 0
                  });
                } catch (err) {
                  console.warn('Error playing pending video:', err);
                }
              }
            }
          },
          onStateChange: (event: any) => {
            // 0 = ENDED
            if (event.data === 0) {
              const state = usePlayerStore.getState();
              const dur = ytPlayerRef.current?.getDuration?.() || state.duration || 0;
              const curTime = ytPlayerRef.current?.getCurrentTime?.() || state.currentTime || 0;
              const elapsedSinceLoad = (Date.now() - trackStartTimeRef.current) / 1000;

              // Guard against premature / spurious ENDED events during initial buffering / cueing
              const isLegitimateEnd = dur > 0 
                ? (curTime >= Math.max(5, dur - 4) || elapsedSinceLoad >= Math.max(5, dur - 4))
                : (elapsedSinceLoad > 10);

              if (isLegitimateEnd && !isSwitchingRef.current) {
                isSwitchingRef.current = true;
                const currentRepeat = state.repeatMode;
                if (currentRepeat === 'one') {
                  if (ytPlayerRef.current) {
                    try {
                      ytPlayerRef.current.seekTo(0);
                      ytPlayerRef.current.playVideo();
                      isSwitchingRef.current = false;
                    } catch (e) {}
                  }
                } else {
                  state.nextTrack();
                }
              }
            }
            // 1 = PLAYING
            if (event.data === 1) {
              setTimeout(() => {
                isSwitchingRef.current = false;
              }, 600);

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
          onError: async (event: any) => {
            console.warn('YouTube Player Error code:', event.data);
            isSwitchingRef.current = false;
            const state = usePlayerStore.getState();
            const curTrack = state.currentTrack;
            if (!curTrack) return;

            invalidateVideoId(curTrack.artist, curTrack.title);

            // Attempt to resolve an alternative video candidate for the SAME song instead of skipping
            let fallbackId = getFallbackVideoId(curTrack.artist, curTrack.title);
            if (!fallbackId || fallbackId === currentVideoIdRef.current) {
              try {
                fallbackId = await resolveAlternativeVideoId(curTrack.artist, curTrack.title, currentVideoIdRef.current);
              } catch (e) {}
            }

            if (fallbackId && ytPlayerRef.current?.loadVideoById && fallbackId !== currentVideoIdRef.current) {
              console.log('Switching to alternative candidate for same track:', fallbackId);
              currentVideoIdRef.current = fallbackId;
              trackStartTimeRef.current = Date.now();
              isSwitchingRef.current = true;
              try {
                ytPlayerRef.current.loadVideoById({
                  videoId: fallbackId,
                  startSeconds: 0
                });
              } catch (err) {
                console.warn('Error loading fallback video candidate:', err);
              }
              return;
            }

            // Only if multiple alternative video candidates for this track failed completely
            const failCount = (trackFailedCountRef.current.get(curTrack.id) || 0) + 1;
            trackFailedCountRef.current.set(curTrack.id, failCount);

            if (failCount >= 2) {
              state.showToast(`Unable to stream "${curTrack.title}"`);
              usePlayerStore.getState().nextTrack();
            }
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

          // Fallback end-of-track trigger ONLY when the audio has legitimately reached 100% of its full duration
          if (ytDur > 10 && time > 10 && time >= (ytDur - 0.5) && !isSwitchingRef.current) {
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
          // Only trigger play if the audio element is currently loaded with the active track
          if (activeLoadedTrackIdRef.current === currentTrack.id && audioRef.current.src) {
            audioEngine.resume();
            audioRef.current.play().catch((err) => {
              console.warn('Audio play notice (buffering):', err);
            });
          }
        } else {
          audioRef.current.pause();
        }
      }
    }
  }, [isPlaying, currentTrack?.id]);

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

  // 6. Track Change & Stream Resolution
  useEffect(() => {
    let isCancelled = false;

    async function loadTrack() {
      if (!currentTrack) return;

      // Prevent reloading identical track and stuttering opening second
      if (currentTrack.id === activeLoadedTrackIdRef.current) {
        return;
      }

      // Immediately silence & reset the previous audio buffer so it NEVER replays when switching
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
      if (ytPlayerRef.current?.pauseVideo) {
        try { ytPlayerRef.current.pauseVideo(); } catch (e) {}
      }

      activeLoadedTrackIdRef.current = currentTrack.id;
      isSwitchingRef.current = true;
      trackStartTimeRef.current = Date.now();

      recordPlay(currentTrack);

      // 0. Check Offline Storage for instant 100% local audio playback
      const offlineBlobUrl = await getOfflineTrackBlobUrl(currentTrack.id);
      if (isCancelled) return;
      if (offlineBlobUrl) {
        isOfflineTrackRef.current = true;
        if (ytReadyRef.current && ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo(); } catch (e) {}
        }
        if (audioRef.current) {
          audioRef.current.src = offlineBlobUrl;
          audioRef.current.volume = volume;
          if (isPlaying) {
            audioRef.current.play().catch(console.warn);
          }
        }
        isSwitchingRef.current = false;
        return;
      }
      isOfflineTrackRef.current = false;

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

      // 1. Resolve 100% official studio topic release via Topic / ATV Resolver FIRST
      let videoId = await resolveYouTubeVideoId(
        currentTrack.artist, 
        currentTrack.title, 
        currentTrack.albumArtist, 
        currentTrack.duration
      );

      // 2. Fall back to existing direct YouTube ID if topic search returned nothing
      if (!videoId) {
        videoId = getDirectYouTubeId(currentTrack);
      }

      if (isCancelled) return;

      // In Electron Desktop, stream directly via internal proxy to native HTML5 <audio>
      if (isElectron) {
        if (videoId && audioRef.current) {
          try {
            const port = (await (window as any).electronAPI?.getProxyPort?.()) || 41721;
            const streamUrl = `http://127.0.0.1:${port}/api/download-stream?videoId=${videoId}`;
            activeLoadedTrackIdRef.current = currentTrack.id;
            audioRef.current.src = streamUrl;
            audioRef.current.volume = volume;
            audioEngine.resume();
            if (isPlaying) {
              audioRef.current.play().catch(console.warn);
            }
          } catch (err) {
            console.warn('Native audio play error:', err);
          }
        }
        isSwitchingRef.current = false;
        return;
      }

      if (videoId) {
        // Play via YouTube Iframe continuously without mid-playback stream swapping
        if (ytReadyRef.current && ytPlayerRef.current?.loadVideoById) {
          if (currentVideoIdRef.current !== videoId) {
            currentVideoIdRef.current = videoId;
            try {
              ytPlayerRef.current.loadVideoById({
                videoId,
                startSeconds: 0
              });
            } catch (err) {
              console.warn('Error loading video by ID:', err);
            }
          }
        } else {
          // If player is still preparing, stash videoId to play when onReady fires
          pendingVideoIdRef.current = videoId;
        }
      }

      // Prefetch upcoming tracks in queue for instant switching
      const activeQueue = isShuffle ? shuffledQueue : queue;
      if (activeQueue.length > 0) {
        const next1 = activeQueue[queueIndex + 1];
        const next2 = activeQueue[queueIndex + 2];
        if (next1) prefetchTrackVideoId(next1);
        if (next2) prefetchTrackVideoId(next2);
      }

      // Background Auto-Mix Pre-Generation for the queue session
      setTimeout(() => {
        if (isCancelled) return;
        const currentRecommended = usePlayerStore.getState().recommendedUpNext;
        if (!currentRecommended || currentRecommended.length < 3) {
          const queuedIds = new Set(activeQueue.map(t => t.id));
          fetchUpNextMix(activeQueue.length > 0 ? activeQueue : currentTrack, favorites, playHistory, queuedIds, dislikedTracks, blockedArtists)
            .then(mix => {
              if (!isCancelled && mix && mix.length > 0) {
                setRecommendedUpNext(mix);
                prefetchTrackVideoId(mix[0]);
              }
            })
            .catch(() => {});
        } else if (currentRecommended[0]) {
          prefetchTrackVideoId(currentRecommended[0]);
        }
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
        preload="auto"
        onCanPlay={() => {
          if (usePlayerStore.getState().isPlaying && audioRef.current && audioRef.current.paused) {
            audioEngine.resume();
            audioRef.current.play().catch(console.warn);
          }
        }}
        onPlaying={() => {
          audioEngine.resume();
        }}
        onTimeUpdate={() => {
          if (audioRef.current && !isYouTubeTrack(currentTrack)) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && !isYouTubeTrack(currentTrack)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          if (!isYouTubeTrack(currentTrack)) {
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


