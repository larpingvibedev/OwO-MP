import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { 
  getDirectYouTubeId,
  resolveYouTubeVideoId, 
  resolveAlternativeVideoId,
  invalidateVideoId, 
  prefetchTrackVideoId
} from '../services/musicSearch';
import { audioEngine } from '../services/audioEngine';
import { getOfflineTrackBlobUrl } from '../services/downloadService';

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeLoadedTrackIdRef = useRef<string | null>(null);
  const activeLoadedNonceRef = useRef<number>(-1);
  const loadGenerationRef = useRef<number>(0);
  const isSwitchingRef = useRef<boolean>(false);
  const isOnlineYtTrackRef = useRef<boolean>(false);
  const trackFailedCountRef = useRef<Map<string, number>>(new Map());

  const {
    currentTrack,
    isPlaying,
    volume,
    playNonce,
    repeatMode,
    nextTrack,
    prevTrack,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    recordPlay,
    syncOfflineTracks,
    showToast
  } = usePlayerStore();

  // Authoritative, validated MediaSession position state synchronizer (Windows SMTC & OS Controls)
  const syncMediaSessionPosition = useCallback((customTime?: number, customDuration?: number) => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const state = usePlayerStore.getState();
    const effectiveDuration = customDuration !== undefined ? customDuration : state.duration;
    const effectiveTime = customTime !== undefined ? customTime : state.currentTime;

    if (!state.currentTrack || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0 || !Number.isFinite(effectiveTime)) {
      return;
    }

    try {
      navigator.mediaSession.setPositionState({
        duration: effectiveDuration,
        playbackRate: state.isPlaying ? 1 : 0,
        position: Math.min(Math.max(effectiveTime, 0), effectiveDuration)
      });
    } catch {
      // Safe no-op on transient boundary condition
    }
  }, []);

  // 1. Initialize Web Audio Engine & Listeners
  useEffect(() => {
    syncOfflineTracks();

    if (audioRef.current) {
      audioEngine.init(audioRef.current);
    }

    const electronAPI = (window as any).electronAPI;
    let unsubscribeYtState: (() => void) | undefined;

    if (electronAPI?.onYouTubeStateUpdate) {
      unsubscribeYtState = electronAPI.onYouTubeStateUpdate(async (data: any) => {
        if (!isOnlineYtTrackRef.current) return;
        
        // 1. Process Errors safely (Emitted by main.cjs strictly for the requested track during setup)
        if (data.error) {
          const cur = usePlayerStore.getState().currentTrack;
          const currentDirectId = cur ? getDirectYouTubeId(cur) : null;
          if (data.videoId && currentDirectId && data.videoId !== currentDirectId && data.videoId !== cur?.id) {
            return;
          }

          if (cur) {
            console.warn('[AudioPlayer] Background YouTube error, falling back:', data.error);
            invalidateVideoId(cur.artist, cur.title);
            const currentFailCount = (trackFailedCountRef.current.get(cur.id) || 0) + 1;
            trackFailedCountRef.current.set(cur.id, currentFailCount);

            if (currentFailCount <= 2) {
              try {
                const fallbackId = await resolveAlternativeVideoId(
                  cur.artist,
                  cur.title,
                  getDirectYouTubeId(cur) || undefined
                );
                if (fallbackId && electronAPI?.playYouTubeTrack) {
                  electronAPI.playYouTubeTrack(fallbackId, cur.title, cur.artist, volume);
                  return;
                }
              } catch (e) {
                console.warn('[AudioPlayer] Fallback resolution failed:', e);
              }
            }
          }
          nextTrack();
          return;
        }

        // 2. Block stale time/duration telemetry from previous tracks during setup
        if (isSwitchingRef.current) return;
        
        // Guard against mismatched telemetry from previous tracks
        if (data.videoId) {
          const cur = usePlayerStore.getState().currentTrack;
          const currentDirectId = cur ? getDirectYouTubeId(cur) : null;
          if (currentDirectId && data.videoId !== currentDirectId && data.videoId !== cur?.id) {
            return;
          }
        }

        if (data.duration && data.duration > 0) {
          setDuration(data.duration);
        }
        if (typeof data.currentTime === 'number') {
          setCurrentTime(data.currentTime);
        }
        syncMediaSessionPosition(data.currentTime, data.duration);

        if (data.ended) {
          if (usePlayerStore.getState().repeatMode === 'one') {
            electronAPI.seekYouTubeTrack?.(0);
            electronAPI.resumeYouTubeTrack?.();
          } else {
            nextTrack();
          }
        }
      });
    }

    const handleUserInteraction = () => {
      audioEngine.resume();
      if (audioRef.current && usePlayerStore.getState().isPlaying && audioRef.current.paused && !isOnlineYtTrackRef.current) {
        audioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });

    return () => {
      if (unsubscribeYtState) unsubscribeYtState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncMediaSessionPosition]);

  // 2. Play / Pause Control
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;

    if (isOnlineYtTrackRef.current && electronAPI?.playYouTubeTrack) {
      if (isPlaying) {
        electronAPI.resumeYouTubeTrack?.(volume);
      } else {
        electronAPI.pauseYouTubeTrack?.();
      }
      return;
    }

    if (!audioRef.current) return;

    if (isPlaying) {
      audioEngine.resume();
      if (audioRef.current.src && audioRef.current.paused) {
        audioRef.current.play().catch((err) => {
          console.warn('[AudioPlayer] Play notice (buffering):', err.message);
        });
      }
    } else {
      if (!audioRef.current.paused) {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  // 3. Volume Control
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (isOnlineYtTrackRef.current && electronAPI?.setYouTubeVolume) {
      electronAPI.setYouTubeVolume(volume);
    }

    audioEngine.setVolume(volume);
    if (audioRef.current && !audioEngine.isConnectedToWebAudio()) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 4. Native Seek Event Listener
  useEffect(() => {
    const handleSeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ time: number }>;
      const targetTime = customEvent.detail?.time ?? 0;

      const electronAPI = (window as any).electronAPI;
      if (isOnlineYtTrackRef.current && electronAPI?.seekYouTubeTrack) {
        electronAPI.seekYouTubeTrack(targetTime);
        setCurrentTime(targetTime);
        syncMediaSessionPosition(targetTime);
        return;
      }

      if (audioRef.current) {
        try {
          audioRef.current.currentTime = targetTime;
          syncMediaSessionPosition(targetTime);
        } catch (err) {
          console.warn('[AudioPlayer] Seek error:', err);
        }
      }
    };

    window.addEventListener('music:seek', handleSeek);
    return () => window.removeEventListener('music:seek', handleSeek);
  }, [setCurrentTime, syncMediaSessionPosition]);

  // 5. Track Loading & Native Streaming
  useEffect(() => {
    let isCancelled = false;

    async function loadTrack() {
      if (!currentTrack) return;

      const isSameTrackId = currentTrack.id === activeLoadedTrackIdRef.current;
      const isSameNonce = playNonce === activeLoadedNonceRef.current;

      if (isSameTrackId && isSameNonce) {
        return;
      }

      const electronAPI = (window as any).electronAPI;

      // Silence any previous playback cleanly across both local WebAudio and native background YouTube player
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src) {
          audioRef.current.src = '';
        }
      }
      electronAPI?.pauseYouTubeTrack?.();

      const myLoadGen = ++loadGenerationRef.current;
      activeLoadedTrackIdRef.current = currentTrack.id;
      activeLoadedNonceRef.current = playNonce;
      isSwitchingRef.current = true;
      recordPlay(currentTrack);

      try {
        // A0. Check Local PC Audio File (Direct High-Speed Local Proxy Streaming)
        const localFilePath = (currentTrack as any).filePath || (currentTrack.id.startsWith('local-') ? (currentTrack as any).filePath : null);
        if (localFilePath) {
          isOnlineYtTrackRef.current = false;
          audioEngine.setPlaybackSource('local');
          electronAPI?.stopYouTubeTrack?.();

          let proxyPort = 41721;
          if (electronAPI?.getProxyPort) {
            proxyPort = await electronAPI.getProxyPort();
          }
          const localStreamUrl = `http://127.0.0.1:${proxyPort}/api/local-file?path=${encodeURIComponent(localFilePath)}`;
          if (audioRef.current) {
            audioRef.current.src = localStreamUrl;
            audioEngine.setVolume(volume);
            if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
            audioEngine.resume();
            audioRef.current.play().catch(console.warn);
          }
          setIsPlaying(true);
          activeLoadedNonceRef.current = playNonce;
          return;
        }

        // A. Check Offline Local Storage First (0ms Instant Audio)
        const offlineBlobUrl = await getOfflineTrackBlobUrl(currentTrack.id);
        if (isCancelled || loadGenerationRef.current !== myLoadGen) return;
        if (offlineBlobUrl) {
          isOnlineYtTrackRef.current = false;
          audioEngine.setPlaybackSource('local');
          electronAPI?.stopYouTubeTrack?.();

          if (audioRef.current) {
            audioRef.current.src = offlineBlobUrl;
            audioEngine.setVolume(volume);
            if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
            audioEngine.resume();
            audioRef.current.play().catch(console.warn);
          }
          setIsPlaying(true);
          prefetchUpcoming();
          return;
        }

        // B. Direct Blob Preview
        if (currentTrack.resolvedStreamUrl?.startsWith('blob:')) {
          isOnlineYtTrackRef.current = false;
          audioEngine.setPlaybackSource('local');
          electronAPI?.stopYouTubeTrack?.();

          if (audioRef.current) {
            audioRef.current.src = currentTrack.resolvedStreamUrl;
            audioEngine.setVolume(volume);
            if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
            audioEngine.resume();
            audioRef.current.play().catch(console.warn);
          }
          setIsPlaying(true);
          prefetchUpcoming();
          return;
        }

        // C. Resolve Online Track via Native Background YouTube Player Engine or Proxy
        let videoId = getDirectYouTubeId(currentTrack);

        if (!videoId) {
          videoId = await resolveYouTubeVideoId(
            currentTrack.artist,
            currentTrack.title,
            currentTrack.albumArtist,
            currentTrack.duration
          );

          // Bounded single retry guarded by cancellation and load generation
          if (!videoId && !isCancelled && loadGenerationRef.current === myLoadGen) {
            await new Promise(r => setTimeout(r, 500));
            if (!isCancelled && loadGenerationRef.current === myLoadGen) {
              videoId = await resolveYouTubeVideoId(
                currentTrack.artist,
                currentTrack.title,
                currentTrack.albumArtist,
                currentTrack.duration
              );
            }
          }
        }

        if (isCancelled || loadGenerationRef.current !== myLoadGen) return;

        if (videoId) {
          try {
            if (electronAPI?.playYouTubeTrack) {
              isOnlineYtTrackRef.current = true;
              audioEngine.setPlaybackSource('youtube');
              console.log(`[AudioPlayer] Playing via native background engine for ${currentTrack.title} (${videoId}) with volume ${volume}`);
              const playRes = await electronAPI.playYouTubeTrack(videoId, 0, volume);
              
              if (playRes?.success) {
                setIsPlaying(true);
                prefetchUpcoming();
                return;
              }
            }

            // Web fallback
            let proxyPort = 41721;
            if (electronAPI?.getProxyPort) {
              proxyPort = await electronAPI.getProxyPort();
            }
            const directStreamUrl = `http://127.0.0.1:${proxyPort}/api/stream?videoId=${videoId}`;

            if (isCancelled || loadGenerationRef.current !== myLoadGen) return;
            isOnlineYtTrackRef.current = false;
            audioEngine.setPlaybackSource('local');

            if (audioRef.current) {
              audioRef.current.src = directStreamUrl;
              audioEngine.setVolume(volume);
              if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
              audioEngine.resume();
              audioRef.current.play().catch((err) => {
                console.warn('[AudioPlayer] Play notice:', err.message);
              });
            }
            setIsPlaying(true);
          } catch (err) {
            console.error('[AudioPlayer] Stream setup error:', err);
          }
        } else {
          console.warn('[AudioPlayer] Could not resolve video ID for:', currentTrack.title);
          showToast(`Could not find stream for "${currentTrack.title}"`);
          nextTrack();
        }

        prefetchUpcoming();
      } finally {
        if (loadGenerationRef.current === myLoadGen) {
          isSwitchingRef.current = false;
        }
      }
    }

    function prefetchUpcoming() {
      setTimeout(async () => {
        const state = usePlayerStore.getState();
        const activeQueue = state.isShuffle ? state.shuffledQueue : state.queue;
        const curIdx = activeQueue.findIndex(t => t.id === state.currentTrack?.id);
        const nextTracks = curIdx >= 0 ? activeQueue.slice(curIdx + 1, curIdx + 3) : [];

        // Read-only lookahead into recommendedUpNext if autoplay is enabled and queue is ending
        if (nextTracks.length < 2 && state.autoplay && state.recommendedUpNext && state.recommendedUpNext.length > 0) {
          const needed = 2 - nextTracks.length;
          const upNextPeeks = state.recommendedUpNext.slice(0, needed);
          nextTracks.push(...upNextPeeks);
        }

        const videoIdsToPreload: string[] = [];
        for (const t of nextTracks) {
          prefetchTrackVideoId(t);
          const directId = getDirectYouTubeId(t);
          if (directId) videoIdsToPreload.push(directId);
        }

        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.prefetchStreamUrls && videoIdsToPreload.length > 0) {
          electronAPI.prefetchStreamUrls(videoIdsToPreload).catch(() => {});
        }
      }, 400);
    }

    loadTrack();

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, playNonce]);

  // 6. MediaSession Integration & System Media Transport Controls (Windows/Mac/Mobile)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (currentTrack) {
      const artwork: MediaImage[] = [];
      if (currentTrack.cover && (currentTrack.cover.startsWith('http://') || currentTrack.cover.startsWith('https://') || currentTrack.cover.startsWith('data:') || currentTrack.cover.startsWith('blob:'))) {
        artwork.push({
          src: currentTrack.cover,
          sizes: '512x512',
          type: 'image/png'
        });
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Track',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'OwO Music Player',
        artwork
      });
    } else {
      navigator.mediaSession.metadata = null;
    }

    syncMediaSessionPosition();
  }, [currentTrack, syncMediaSessionPosition]);

  // 7. MediaSession Playback State
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      syncMediaSessionPosition();
    }
  }, [isPlaying, syncMediaSessionPosition]);

  // 8. MediaSession Action Handlers (Seek bar, Next/Prev, Play/Pause)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const safeSetAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    };

    safeSetAction('play', () => {
      setIsPlaying(true);
    });

    safeSetAction('pause', () => {
      setIsPlaying(false);
    });

    safeSetAction('previoustrack', () => {
      prevTrack();
    });

    safeSetAction('nexttrack', () => {
      nextTrack();
    });

    safeSetAction('seekto', (details) => {
      if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) {
        const state = usePlayerStore.getState();
        const duration = state.duration || 0;
        const target = Math.max(0, duration > 0 ? Math.min(details.seekTime, duration) : details.seekTime);
        window.dispatchEvent(new CustomEvent('music:seek', { detail: { time: target } }));
        syncMediaSessionPosition(target, duration);
      }
    });

    safeSetAction('seekforward', (details) => {
      const state = usePlayerStore.getState();
      const offset = details.seekOffset || 10;
      const duration = state.duration || 0;
      const target = duration > 0 ? Math.min(duration, state.currentTime + offset) : state.currentTime + offset;
      window.dispatchEvent(new CustomEvent('music:seek', { detail: { time: target } }));
      syncMediaSessionPosition(target, duration);
    });

    safeSetAction('seekbackward', (details) => {
      const state = usePlayerStore.getState();
      const offset = details.seekOffset || 10;
      const target = Math.max(0, state.currentTime - offset);
      window.dispatchEvent(new CustomEvent('music:seek', { detail: { time: target } }));
      syncMediaSessionPosition(target, state.duration);
    });

    return () => {
      const actions: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekforward', 'seekbackward'];
      actions.forEach((act) => {
        safeSetAction(act, null);
      });
    };
  }, [setIsPlaying, prevTrack, nextTrack, syncMediaSessionPosition]);

  return (
    <audio
      ref={audioRef}
      crossOrigin="anonymous"
      preload="auto"
      onCanPlay={() => {
        if (!isOnlineYtTrackRef.current && usePlayerStore.getState().isPlaying && audioRef.current && audioRef.current.paused) {
          audioEngine.resume();
          audioRef.current.play().catch(() => {});
        }
      }}
      onPlaying={() => {
        if (!isOnlineYtTrackRef.current) {
          audioEngine.resume();
          if (!usePlayerStore.getState().isPlaying) {
            setIsPlaying(true);
          }
        }
      }}
      onTimeUpdate={() => {
        if (!isOnlineYtTrackRef.current && audioRef.current) {
          const cur = audioRef.current.currentTime;
          setCurrentTime(cur);
          syncMediaSessionPosition(cur, audioRef.current.duration);
        }
      }}
      onLoadedMetadata={() => {
        if (!isOnlineYtTrackRef.current && audioRef.current && audioRef.current.duration > 0) {
          const dur = audioRef.current.duration;
          setDuration(dur);
          syncMediaSessionPosition(audioRef.current.currentTime, dur);
        }
      }}
      onEnded={() => {
        if (!isOnlineYtTrackRef.current) {
          if (repeatMode === 'one') {
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(console.warn);
            }
          } else {
            nextTrack();
          }
        }
      }}
      onError={async (e) => {
        if (isOnlineYtTrackRef.current) return;
        console.warn('[AudioPlayer] HTML5 Audio element error:', e);
        if (!currentTrack) return;

        invalidateVideoId(currentTrack.artist, currentTrack.title);

        const currentFailCount = (trackFailedCountRef.current.get(currentTrack.id) || 0) + 1;
        trackFailedCountRef.current.set(currentTrack.id, currentFailCount);

        if (currentFailCount <= 2) {
          try {
            const fallbackId = await resolveAlternativeVideoId(
              currentTrack.artist,
              currentTrack.title,
              getDirectYouTubeId(currentTrack) || undefined
            );
            if (fallbackId && audioRef.current) {
              const electronAPI = (window as any).electronAPI;
              const port = await electronAPI?.getProxyPort?.() || 41721;
              const directUrl = `http://127.0.0.1:${port}/api/stream?videoId=${fallbackId}`;

              audioRef.current.src = directUrl;
              if (usePlayerStore.getState().isPlaying) {
                audioEngine.resume();
                audioRef.current.play().catch(console.warn);
              }
              return;
            }
          } catch (err) {}
        }

        showToast(`Unable to stream "${currentTrack.title}"`);
        nextTrack();
      }}
      style={{ display: 'none' }}
    />
  );
};
