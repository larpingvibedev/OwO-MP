import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const {
    currentTrack,
    isPlaying,
    volume,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    nextTrack,
    prevTrack
  } = usePlayerStore();

  // Handle Play/Pause
  useEffect(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Playback prevented or interrupted:', err);
          setIsPlaying(false);
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentTrack, setIsPlaying]);

  // Handle Volume change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Track change
  useEffect(() => {
    if (audioRef.current && currentTrack) {
      audioRef.current.src = currentTrack.streamUrl;
      if (isPlaying) {
        audioRef.current.play().catch(console.warn);
      }
    }
  }, [currentTrack]);

  // MediaSession API Integration for Windows Media Keys & Car Bluetooth Controls
  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || 'Nuclear Plus',
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
      onTimeUpdate={() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }}
      onLoadedMetadata={() => {
        if (audioRef.current) {
          setDuration(audioRef.current.duration);
        }
      }}
      onEnded={() => {
        nextTrack();
      }}
      style={{ display: 'none' }}
    />
  );
};
