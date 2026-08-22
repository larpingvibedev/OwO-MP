import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { DiscordPresencePayload } from '../../types';

/**
 * Headless Manager for Discord Rich Presence (RPC).
 * 
 * - Thin bridge connecting Zustand playback state with Electron Main Discord RPC service.
 * - Detects track changes, play/pause transitions, explicit user seeks, and privacy toggles.
 * - Authoritative snapshot dispatcher: leaves rate-limiting & connection state machine to Main Process.
 */
export function DiscordRPCManager() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const discordRpcEnabled = usePlayerStore((s) => s.discordRpcEnabled);

  // Tracking refs to detect genuine state changes and avoid unneeded IPC noise
  const lastTrackIdRef = useRef<string | null>(null);
  const lastIsPlayingRef = useRef<boolean | null>(null);
  const lastSentTimeRef = useRef<number>(0);
  const lastSentClockRef = useRef<number>(0);
  const lastEnabledRef = useRef<boolean>(discordRpcEnabled);
  const hasInitializedRef = useRef<boolean>(false);

  const dispatchPresence = useCallback((customTime?: number) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.updateDiscordPresence || !electronAPI?.clearDiscordPresence) {
      return;
    }

    const state = usePlayerStore.getState();
    if (!state.discordRpcEnabled || !state.currentTrack) {
      return;
    }

    const track = state.currentTrack;
    const currentTrackId = track.id || `${track.title}-${track.artist}`;
    const effectiveTime = typeof customTime === 'number' ? customTime : state.currentTime;
    const now = Date.now();

    lastTrackIdRef.current = currentTrackId;
    lastIsPlayingRef.current = state.isPlaying;
    lastSentTimeRef.current = effectiveTime;
    lastSentClockRef.current = now;

    const rawCover = track.cover || (track as any).thumbnail;
    let artworkUrl: string | undefined = undefined;
    if (typeof rawCover === 'string' && (rawCover.startsWith('http://') || rawCover.startsWith('https://'))) {
      artworkUrl = rawCover;
    }

    const effectiveDuration = state.duration > 0 ? state.duration : (track.duration || 0);

    const payload: DiscordPresencePayload = {
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || track.title || undefined,
      artworkUrl,
      duration: effectiveDuration,
      currentTime: Math.max(0, effectiveTime),
      isPlaying: state.isPlaying
    };

    electronAPI.updateDiscordPresence(payload).catch((err) => {
      console.debug('[DiscordRPCManager] Failed to update presence:', err);
    });
  }, []);

  // 1. Explicit Scrubbing / Seek Listener (music:seek)
  useEffect(() => {
    const handleSeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ time: number }>;
      const targetTime = customEvent.detail?.time ?? 0;
      dispatchPresence(targetTime);
    };

    window.addEventListener('music:seek', handleSeek);
    return () => window.removeEventListener('music:seek', handleSeek);
  }, [dispatchPresence]);

  // 2. Playback Lifecycle & Privacy Sync
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.updateDiscordPresence || !electronAPI?.clearDiscordPresence) {
      return;
    }

    // Handle initial startup sync of enabled preference
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (electronAPI.setDiscordPresenceEnabled) {
        electronAPI.setDiscordPresenceEnabled(discordRpcEnabled);
      }
    }

    // Handle privacy toggle change
    if (lastEnabledRef.current !== discordRpcEnabled) {
      lastEnabledRef.current = discordRpcEnabled;
      if (electronAPI.setDiscordPresenceEnabled) {
        electronAPI.setDiscordPresenceEnabled(discordRpcEnabled);
      }
      if (!discordRpcEnabled) {
        electronAPI.clearDiscordPresence().catch(() => {});
        return;
      }
    }

    if (!discordRpcEnabled) {
      return;
    }

    // Handle playback cleared / no track
    if (!currentTrack) {
      if (lastTrackIdRef.current !== null) {
        lastTrackIdRef.current = null;
        lastIsPlayingRef.current = null;
        electronAPI.clearDiscordPresence().catch(() => {});
      }
      return;
    }

    const currentTrackId = currentTrack.id || `${currentTrack.title}-${currentTrack.artist}`;
    const now = Date.now();

    // Detect state changes
    const trackChanged = lastTrackIdRef.current !== currentTrackId;
    const playStateChanged = lastIsPlayingRef.current !== isPlaying;
    
    // Seek Detection: compare currentTime with linearly projected time
    let isSeek = false;
    if (!trackChanged && !playStateChanged) {
      if (isPlaying) {
        const elapsedSec = (now - lastSentClockRef.current) / 1000;
        const expectedTime = lastSentTimeRef.current + elapsedSec;
        if (Math.abs(currentTime - expectedTime) > 2.5) {
          isSeek = true;
        }
      } else {
        // Paused seek
        if (Math.abs(currentTime - lastSentTimeRef.current) > 2.0) {
          isSeek = true;
        }
      }
    }

    if (trackChanged || playStateChanged || isSeek) {
      dispatchPresence(currentTime);
    }
  }, [currentTrack, isPlaying, currentTime, duration, discordRpcEnabled, dispatchPresence]);

  return null;
}
