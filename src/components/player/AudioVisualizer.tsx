import React, { useEffect, useRef, useMemo } from 'react';
import { usePlayerStore } from '../../store/usePlayerStore';
import { audioEngine } from '../../services/audioEngine';
import type { Track } from '../../types';

interface AudioVisualizerProps {
  isPlaying?: boolean;
  barCount?: number;
  height?: number;
  variant?: 'rmpc' | 'minimal' | 'cyber';
  style?: React.CSSProperties;
}

function computeTrackSeed(track: Track | null): { bpm: number; bassWeight: number; midWeight: number; trebleWeight: number } {
  if (!track) return { bpm: 120, bassWeight: 1.2, midWeight: 1.0, trebleWeight: 1.1 };
  const str = `${track.id}-${track.title}-${track.artist}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);
  return {
    bpm: 100 + (posHash % 45), // 100 to 145 BPM
    bassWeight: 1.0 + ((posHash >> 2) % 30) / 100,
    midWeight: 0.95 + ((posHash >> 6) % 30) / 100,
    trebleWeight: 1.0 + ((posHash >> 10) % 30) / 100
  };
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isPlaying: propIsPlaying,
  barCount = 42,
  height = 70,
  variant = 'rmpc',
  style
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const barsDataRef = useRef<number[]>([]);
  const peakDataRef = useRef<number[]>([]);
  const peakVelocityRef = useRef<number[]>([]);

  const {
    currentTrack,
    isPlaying: storeIsPlaying,
    volume,
    theme,
    rustyColor
  } = usePlayerStore();

  const isPlaying = propIsPlaying !== undefined ? propIsPlaying : storeIsPlaying;
  const trackSeed = useMemo(() => computeTrackSeed(currentTrack), [currentTrack?.id, currentTrack?.title]);

  // Keep references to avoid re-triggering the animation loop on state changes
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const trackSeedRef = useRef(trackSeed);
  trackSeedRef.current = trackSeed;

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const rustyColorRef = useRef(rustyColor);
  rustyColorRef.current = rustyColor;

  useEffect(() => {
    barsDataRef.current = new Array(barCount).fill(3);
    peakDataRef.current = new Array(barCount).fill(3);
    peakVelocityRef.current = new Array(barCount).fill(0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animTime = 0;
    let lastTimestamp = performance.now();

    const render = (now: number) => {
      const delta = Math.min(0.05, (now - lastTimestamp) / 1000);
      lastTimestamp = now;

      const activeIsPlaying = isPlayingRef.current;
      const seed = trackSeedRef.current;
      const curTheme = themeRef.current;
      const curRustyColor = rustyColorRef.current;
      const curVol = volumeRef.current;

      // Increment clock
      animTime += activeIsPlaying ? delta : delta * 0.25;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width || 400;
      const h = height;

      if (canvas.width !== width * dpr || canvas.height !== h * dpr) {
        canvas.width = width * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, width, h);

      const totalBarWidth = width / barCount;
      const barWidth = Math.max(3, totalBarWidth - 3);
      const gap = totalBarWidth - barWidth;

      // Color scheme based on active theme
      let gradient: CanvasGradient;
      if (curTheme === 'rusty') {
        gradient = ctx.createLinearGradient(0, h, 0, 0);
        if (curRustyColor === 'green') {
          gradient.addColorStop(0, '#00ff66');
          gradient.addColorStop(1, '#00ffcc');
        } else if (curRustyColor === 'amber') {
          gradient.addColorStop(0, '#ff9900');
          gradient.addColorStop(1, '#ffcc00');
        } else {
          gradient.addColorStop(0, '#00ccff');
          gradient.addColorStop(1, '#33ffff');
        }
      } else {
        // Signature Synthwave / RMPC Neon Gradient (Hot Pink -> Violet -> Cyan -> Sky Blue)
        gradient = ctx.createLinearGradient(0, h, 0, 0);
        gradient.addColorStop(0, '#ff007f');     // Hot Neon Pink (Sub-Bass)
        gradient.addColorStop(0.35, '#a855f7');  // Cyber Violet (Low-Mids)
        gradient.addColorStop(0.72, '#00d2ff');  // Electric Cyan (Mids / Vocals)
        gradient.addColorStop(1, '#38bdf8');     // Sky Blue (Treble Sparkle)
      }

      // Check for 100% TRUE LIVE FREQUENCY DATA FROM WEB AUDIO API
      const liveFrequencies = activeIsPlaying ? audioEngine.getLiveFrequencies(barCount) : null;

      // Dynamic Beat Clock based on BPM for rhythm synthesis
      const bps = seed.bpm / 60;
      const beat = animTime * bps;
      const kick = Math.pow(Math.max(0, Math.sin(beat * Math.PI)), 2.8);
      const snare = Math.pow(Math.max(0, Math.sin((beat + 0.5) * Math.PI)), 3.2);
      const hat = Math.pow(Math.max(0, Math.sin(beat * 4 * Math.PI)), 2.0);

      for (let i = 0; i < barCount; i++) {
        const norm = i / (barCount - 1); // 0.0 (Bass) to 1.0 (Treble)
        let targetHeight = 3;

        if (activeIsPlaying) {
          if (liveFrequencies && liveFrequencies.length === barCount) {
            // MODE A: 100% Physical FFT Spectrum Analysis
            const rawEnergy = liveFrequencies[i];
            if (rawEnergy < 0.025 || curVol <= 0.01) {
              targetHeight = 2; // Flat baseline during silence/quiet
            } else {
              targetHeight = Math.max(2, rawEnergy * (h - 4) * Math.min(1.0, curVol * 1.15));
            }
          } else {
            // MODE B: High-Fidelity Synthwave Rhythm Engine (Responsive to Volume & Tempo)
            const bass = (Math.sin(animTime * 3.5 + i * 0.3) * 0.5 + 0.5) * 0.45 + kick * 0.55;
            const mid = (Math.sin(animTime * 5.0 - i * 0.4) * 0.5 + 0.5) * 0.45 + snare * 0.55;
            const treble = (Math.sin(animTime * 8.5 + i * 0.7) * 0.5 + 0.5) * 0.45 + hat * 0.55;

            let energy = 0;
            if (norm <= 0.35) {
              const w = norm / 0.35;
              energy = bass * seed.bassWeight * (1 - w * 0.3) + mid * (w * 0.3);
            } else if (norm <= 0.72) {
              const w = (norm - 0.35) / 0.37;
              energy = mid * seed.midWeight * (1 - w * 0.25) + treble * (w * 0.25);
            } else {
              const w = (norm - 0.72) / 0.28;
              energy = treble * seed.trebleWeight * (0.8 + w * 0.2);
            }

            const jitter = (Math.sin(animTime * 13.0 + i * 6.5) * 0.5 + 0.5) * 0.08;
            const finalVal = Math.max(0.04, Math.min(0.95, (energy * 0.75 + jitter) * Math.min(1.0, curVol * 1.15)));
            targetHeight = Math.max(3, finalVal * (h - 4));
          }
        } else {
          // Paused idle baseline
          targetHeight = 3 + (Math.sin(animTime * 1.5 + i * 0.2) * 0.5 + 0.5) * 2;
        }

        // Realistic Spring Physics: Fast attack on punchy beats, smooth natural decay
        const currentH = barsDataRef.current[i] || 3;
        const attackFactor = targetHeight > currentH ? 0.60 : 0.26;
        const newH = currentH + (targetHeight - currentH) * attackFactor;
        barsDataRef.current[i] = newH;

        // Realistic Peak Cap Physics (Gravity Drop)
        let peakH = peakDataRef.current[i] || 3;
        let peakVel = peakVelocityRef.current[i] || 0;

        if (newH >= peakH) {
          peakH = newH;
          peakVel = 0;
        } else {
          peakVel += 0.26; // Gravity acceleration
          peakH = Math.max(newH, peakH - peakVel);
        }
        peakDataRef.current[i] = peakH;
        peakVelocityRef.current[i] = peakVel;

        const x = i * (barWidth + gap);
        const y = h - newH;

        // Draw equalized spectrum bar with rounded top cap
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = Math.min(2.5, barWidth / 2);
        ctx.roundRect(x, y, barWidth, newH, [radius, radius, 0, 0]);
        ctx.fill();

        // Draw retro RMPC floating white peak indicator cap
        if (peakH > 7 && (liveFrequencies || activeIsPlaying)) {
          const peakY = h - peakH - 2;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, Math.max(0, peakY), barWidth, 2);
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [barCount, height]);

  return (
    <div 
      ref={containerRef}
      className={`audio-visualizer-wrapper visualizer-${variant}`}
      style={{
        width: '100%',
        height: `${height}px`,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        overflow: 'hidden',
        ...style
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          display: 'block'
        }}
      />
    </div>
  );
};
