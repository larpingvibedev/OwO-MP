import React, { useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/usePlayerStore';
import { audioEngine } from '../../services/audioEngine';
import { extractAlbumPalette, type ExtractedPalette } from '../../utils/colorExtractor';

interface AudioVisualizerProps {
  isPlaying?: boolean;
  barCount?: number;
  height?: number;
  variant?: 'rmpc' | 'minimal' | 'cyber';
  style?: React.CSSProperties;
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
  const paletteRef = useRef<ExtractedPalette | null>(null);

  const {
    isPlaying: storeIsPlaying,
    currentTrack,
    volume
  } = usePlayerStore();

  const isPlaying = propIsPlaying !== undefined ? propIsPlaying : storeIsPlaying;

  // Extract vibrant album art palette whenever currentTrack cover changes
  useEffect(() => {
    let isMounted = true;
    if (currentTrack?.cover) {
      extractAlbumPalette(currentTrack.cover).then((palette) => {
        if (isMounted) {
          paletteRef.current = palette;
        }
      });
    } else {
      paletteRef.current = null;
    }
    return () => {
      isMounted = false;
    };
  }, [currentTrack?.cover]);

  // Keep references to avoid re-triggering the animation loop on state changes
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

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
      const curVol = volumeRef.current;
      const activePalette = paletteRef.current;

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

      // Color scheme based on Dynamic Album Cover Palette
      let gradient: CanvasGradient;
      if (activePalette) {
        gradient = ctx.createLinearGradient(0, h, 0, 0);
        if (activePalette.isMonochrome) {
          // Sleek Monochrome / Silver Gradient for Black & White Album Artwork
          gradient.addColorStop(0, activePalette.secondary); // Deep Charcoal / Slate base (#475569)
          gradient.addColorStop(0.52, activePalette.primary);  // Crisp Ice Silver (#e2e8f0)
          gradient.addColorStop(1, '#ffffff');               // Light treble pure white peak
        } else {
          // Dynamic Album Art Palette (Adaptive Vibrant Color Gradient)
          gradient.addColorStop(0, activePalette.secondary); // Deep rich bottom accent
          gradient.addColorStop(0.52, activePalette.primary);  // Vibrant primary artwork color
          gradient.addColorStop(1, '#ffffff');               // Light treble peak shimmer
        }
      } else {
        // Signature Synthwave / RMPC Neon Gradient (Hot Pink -> Violet -> Cyan -> Sky Blue)
        gradient = ctx.createLinearGradient(0, h, 0, 0);
        gradient.addColorStop(0, '#ff007f');     // Hot Neon Pink (Sub-Bass)
        gradient.addColorStop(0.35, '#a855f7');  // Cyber Violet (Low-Mids)
        gradient.addColorStop(0.72, '#00d2ff');  // Electric Cyan (Mids / Vocals)
        gradient.addColorStop(1, '#38bdf8');     // Sky Blue (Treble Sparkle)
      }

      // Check for 100% TRUE LIVE FREQUENCY DATA FROM WEB AUDIO API (Symmetrical Bell Curve Mode)
      const liveFrequencies = activeIsPlaying ? audioEngine.getLiveFrequencies(barCount, 'bell') : null;

      for (let i = 0; i < barCount; i++) {
        let targetHeight = 2;

        if (activeIsPlaying) {
          if (liveFrequencies && liveFrequencies.length === barCount) {
            // MODE A: 100% True Physical FFT Spectrum Analysis
            const rawEnergy = liveFrequencies[i];
            if (rawEnergy < 0.008 || curVol <= 0.005) {
              targetHeight = 2; // Flat baseline during silence/quiet
            } else {
              targetHeight = Math.max(2, rawEnergy * (h - 4) * Math.min(1.0, Math.max(0.45, curVol * 1.2)));
            }
          } else {
            targetHeight = 2;
          }
        } else {
          // Paused idle baseline
          targetHeight = 2;
        }

        // Fast explosive attack for maximum beat reactivity, smooth decay
        const currentH = barsDataRef.current[i] || 2;
        const attackFactor = targetHeight > currentH ? 0.88 : 0.22;
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
