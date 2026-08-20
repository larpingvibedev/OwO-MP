import { useEffect, useRef } from 'react';
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
  const isSwitchingRef = useRef<boolean>(false);
  const isOnlineYtTrackRef = useRef<boolean>(false);
  const trackFailedCountRef = useRef<Map<string, number>>(new Map());

  const {
    currentTrack,
    isPlaying,
    volume,
    playNonce,
    queue,
    shuffledQueue,
    isShuffle,
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
        
        // Guard against mismatched telemetry from previous tracks
        if (data.videoId) {
          const cur = usePlayerStore.getState().currentTrack;
          const currentDirectId = cur ? getDirectYouTubeId(cur) : null;
          if (currentDirectId && data.videoId !== currentDirectId && data.videoId !== cur?.id) {
            return;
          }
        }
        
        if (data.error) {
          if (data.error === 'LOGIN_REQUIRED') {
            const authState = electronAPI.getYoutubeAuthState ? await electronAPI.getYoutubeAuthState() : 'signed_out';
            if (authState === 'signed_in') {
              showToast("This track isn't available for this account.");
            } else {
              showToast("Sign in to YouTube (Settings) to play this track.");
            }
          } else if (data.error === 'UNPLAYABLE' || data.error === 'ERROR') {
            showToast("This track is unavailable or age-restricted.");
          }
          nextTrack();
          return;
        }

        if (data.duration && data.duration > 0) {
          setDuration(data.duration);
        }
        if (typeof data.currentTime === 'number') {
          setCurrentTime(data.currentTime);
        }
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
  }, []);

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
        return;
      }

      if (audioRef.current) {
        try {
          audioRef.current.currentTime = targetTime;
        } catch (err) {
          console.warn('[AudioPlayer] Seek error:', err);
        }
      }
    };

    window.addEventListener('music:seek', handleSeek);
    return () => window.removeEventListener('music:seek', handleSeek);
  }, [setCurrentTime]);

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

      activeLoadedTrackIdRef.current = currentTrack.id;
      activeLoadedNonceRef.current = playNonce;
      isSwitchingRef.current = true;
      recordPlay(currentTrack);

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
        isSwitchingRef.current = false;
        return;
      }

      // A. Check Offline Local Storage First (0ms Instant Audio)
      const offlineBlobUrl = await getOfflineTrackBlobUrl(currentTrack.id);
      if (isCancelled) return;
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
        isSwitchingRef.current = false;
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
        isSwitchingRef.current = false;
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
      }

      if (isCancelled) return;

      if (videoId) {
        try {
          if (electronAPI?.playYouTubeTrack) {
            isOnlineYtTrackRef.current = true;
            audioEngine.setPlaybackSource('youtube');
            console.log(`[AudioPlayer] Playing via native background engine for ${currentTrack.title} (${videoId}) with volume ${volume}`);
            const playRes = await electronAPI.playYouTubeTrack(videoId, 0, volume);
            
            if (playRes?.success) {
              setIsPlaying(true);
              isSwitchingRef.current = false;
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

          if (isCancelled) return;
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
          isSwitchingRef.current = false;
        } catch (err) {
          console.error('[AudioPlayer] Stream setup error:', err);
        }
      } else {
        console.warn('[AudioPlayer] Could not resolve video ID for:', currentTrack.title);
        showToast(`Could not find stream for "${currentTrack.title}"`);
        nextTrack();
      }


      prefetchUpcoming();
    }

    function prefetchUpcoming() {
      setTimeout(async () => {
        const activeQueue = isShuffle ? shuffledQueue : queue;
        const curIdx = activeQueue.findIndex(t => t.id === currentTrack?.id);
        const nextTracks = activeQueue.slice(curIdx + 1, curIdx + 3);

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

  // 6. MediaSession Integration
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
          setCurrentTime(audioRef.current.currentTime);
        }
      }}
      onLoadedMetadata={() => {
        if (!isOnlineYtTrackRef.current && audioRef.current && audioRef.current.duration > 0) {
          setDuration(audioRef.current.duration);
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
