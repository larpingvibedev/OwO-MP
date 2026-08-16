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

  // 1. Initialize Web Audio Engine
  useEffect(() => {
    syncOfflineTracks();

    if (audioRef.current) {
      audioEngine.init(audioRef.current);
    }

    const handleUserInteraction = () => {
      audioEngine.resume();
      if (audioRef.current && usePlayerStore.getState().isPlaying && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });
  }, []);

  // 2. Play / Pause Control
  useEffect(() => {
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
  }, []);

  // 5. Track Loading & Native Streaming
  useEffect(() => {
    let isCancelled = false;

    async function loadTrack() {
      if (!currentTrack || !audioRef.current) return;

      const isSameTrackId = currentTrack.id === activeLoadedTrackIdRef.current;
      const isSameNonce = playNonce === activeLoadedNonceRef.current;

      // Prevent reloading identical track if already playing and same queue session
      if (isSameTrackId && isSameNonce && audioRef.current.src && !audioRef.current.paused) {
        return;
      }

      // If exact same track was already loaded with a valid audio src, but user requested play / new mix session:
      if (isSameTrackId && audioRef.current.src && audioRef.current.src !== window.location.href) {
        try {
          audioRef.current.currentTime = 0;
          audioEngine.resume();
          await audioRef.current.play();
          setIsPlaying(true);
          activeLoadedNonceRef.current = playNonce;
          isSwitchingRef.current = false;
          return;
        } catch (err) {
          console.warn('[AudioPlayer] Replay existing src failed, reloading fresh stream:', err);
        }
      }

      // Silence and prepare new buffer
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();

      activeLoadedTrackIdRef.current = currentTrack.id;
      activeLoadedNonceRef.current = playNonce;
      isSwitchingRef.current = true;
      recordPlay(currentTrack);

      // A0. Check Local PC Audio File (Direct High-Speed Local Proxy Streaming)
      const localFilePath = (currentTrack as any).filePath || (currentTrack.id.startsWith('local-') ? (currentTrack as any).filePath : null);
      if (localFilePath) {
        const electronAPI = (window as any).electronAPI;
        let proxyPort = 41721;
        if (electronAPI?.getProxyPort) {
          proxyPort = await electronAPI.getProxyPort();
        }
        const localStreamUrl = `http://127.0.0.1:${proxyPort}/api/local-file?path=${encodeURIComponent(localFilePath)}`;
        audioRef.current.src = localStreamUrl;
        audioEngine.setVolume(volume);
        if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
        audioEngine.resume();
        audioRef.current.play().catch(console.warn);
        setIsPlaying(true);
        activeLoadedNonceRef.current = playNonce;
        isSwitchingRef.current = false;
        return;
      }

      // A. Check Offline Local Storage First (0ms Instant Audio)
      const offlineBlobUrl = await getOfflineTrackBlobUrl(currentTrack.id);
      if (isCancelled) return;
      if (offlineBlobUrl) {
        audioRef.current.src = offlineBlobUrl;
        audioEngine.setVolume(volume);
        if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
        audioEngine.resume();
        audioRef.current.play().catch(console.warn);
        setIsPlaying(true);
        isSwitchingRef.current = false;
        prefetchUpcoming();
        return;
      }

      // B. Direct Blob Preview
      if (currentTrack.resolvedStreamUrl?.startsWith('blob:')) {
        audioRef.current.src = currentTrack.resolvedStreamUrl;
        audioEngine.setVolume(volume);
        if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
        audioEngine.resume();
        audioRef.current.play().catch(console.warn);
        setIsPlaying(true);
        isSwitchingRef.current = false;
        prefetchUpcoming();
        return;
      }

      // C. Resolve Online Stream via High-Speed Native Proxy
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
          const electronAPI = (window as any).electronAPI;
          let directStreamUrl: string | null = null;

          if (electronAPI?.extractStreamUrl) {
            directStreamUrl = await electronAPI.extractStreamUrl(videoId);
          }

          if (!directStreamUrl) {
            let proxyPort = 41721;
            if (electronAPI?.getProxyPort) {
              proxyPort = await electronAPI.getProxyPort();
            }
            directStreamUrl = `http://127.0.0.1:${proxyPort}/api/stream?videoId=${videoId}`;
          }

          if (isCancelled) return;

          audioRef.current.src = directStreamUrl;
          audioEngine.setVolume(volume);
          if (!audioEngine.isConnectedToWebAudio()) audioRef.current.volume = volume;
          audioEngine.resume();
          audioRef.current.play().catch((err) => {
            console.warn('[AudioPlayer] Native play notice:', err.message);
          });
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
        if (usePlayerStore.getState().isPlaying && audioRef.current && audioRef.current.paused) {
          audioEngine.resume();
          audioRef.current.play().catch(() => {});
        }
      }}
      onPlaying={() => {
        audioEngine.resume();
        if (!usePlayerStore.getState().isPlaying) {
          setIsPlaying(true);
        }
      }}
      onTimeUpdate={() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }}
      onLoadedMetadata={() => {
        if (audioRef.current && audioRef.current.duration > 0) {
          setDuration(audioRef.current.duration);
        }
      }}
      onEnded={() => {
        if (repeatMode === 'one') {
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(console.warn);
          }
        } else {
          nextTrack();
        }
      }}
      onError={async (e) => {
        console.warn('[AudioPlayer] HTML5 Audio element error:', e);
        if (!currentTrack) return;

        invalidateVideoId(currentTrack.artist, currentTrack.title);

        const currentFailCount = (trackFailedCountRef.current.get(currentTrack.id) || 0) + 1;
        trackFailedCountRef.current.set(currentTrack.id, currentFailCount);

        if (currentFailCount <= 2) {
          // Attempt fallback video candidate
          try {
            const fallbackId = await resolveAlternativeVideoId(
              currentTrack.artist,
              currentTrack.title,
              getDirectYouTubeId(currentTrack) || undefined
            );
            if (fallbackId && audioRef.current) {
              const electronAPI = (window as any).electronAPI;
              let directUrl: string | null = null;
              if (electronAPI?.extractStreamUrl) {
                directUrl = await electronAPI.extractStreamUrl(fallbackId);
              }
              if (!directUrl) {
                const port = await electronAPI?.getProxyPort?.() || 41721;
                directUrl = `http://127.0.0.1:${port}/api/stream?videoId=${fallbackId}`;
              }

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
