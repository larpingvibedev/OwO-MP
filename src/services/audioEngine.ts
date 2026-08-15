/**
 * Global Web Audio API Engine & Real-Time Spectrum Analyzer
 * Connects directly to the HTML5 Audio Element to extract 100% accurate FFT frequency spectrum data.
 */

class AudioEngineManager {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private freqData: Uint8Array | null = null;
  private isConnected = false;

  /**
   * Initializes the Web Audio API context and connects the audio element to the analyser.
   */
  public init(audioEl: HTMLAudioElement | null): void {
    if (!audioEl || this.isConnected) return;
    this.audioElement = audioEl;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }

      if (!this.analyser) {
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256; // 128 frequency bins for rich definition
        this.analyser.smoothingTimeConstant = 0.58; // Snappy, punchy response to transient beats
        this.analyser.minDecibels = -90;
        this.analyser.maxDecibels = -18;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      }

      if (!this.sourceNode && this.audioElement) {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        this.isConnected = true;
      }
    } catch (err) {
      console.warn('Web Audio API connection notice:', err);
    }
  }

  /**
   * Returns whether Web Audio API is actively connected and playing.
   */
  public isAudioActive(): boolean {
    return this.isConnected && Boolean(this.audioElement && !this.audioElement.paused && this.audioElement.currentTime > 0);
  }

  /**
   * Resumes AudioContext if suspended by browser autoplay policy.
   */
  public resume(): void {
    if (this.audioCtx && (this.audioCtx.state === 'suspended' || this.audioCtx.state === 'interrupted')) {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /**
   * Returns normalized real-time frequency data (0.0 to 1.0) resampled to `barCount` bars.
   * Returns null if HTML5 audio element is idle so visualizer stays quiet.
   */
  public getLiveFrequencies(barCount: number = 42, layout: 'bell' | 'linear' = 'bell'): number[] | null {
    if (!this.analyser || !this.freqData || !this.audioCtx) return null;

    // If audio element is paused or not actively streaming direct audio, return null
    if (!this.audioElement || this.audioElement.paused || this.audioElement.currentTime <= 0) {
      return null;
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    this.analyser.getByteFrequencyData(this.freqData as any);

    // Verify real audio signal energy is flowing through the buffer
    let sum = 0;
    const len = this.freqData.length;
    for (let i = 0; i < len; i++) {
      sum += this.freqData[i];
    }
    if (sum < 0.5) {
      return null;
    }

    const result: number[] = new Array(barCount);
    // Active musical band: Bin 1 (~40 Hz) to Bin 48 (~8 kHz)
    const maxMusicalBin = Math.min(len - 1, 48);
    const minMusicalBin = 1;

    const sampleFrequency = (norm: number) => {
      // Logarithmic distribution: ample resolution for Sub-bass (norm 0.0), Mids (0.5), and Highs (1.0)
      const logNorm = Math.pow(norm, 1.22);
      const binIdx = minMusicalBin + logNorm * (maxMusicalBin - minMusicalBin);
      
      const lowIdx = Math.floor(binIdx);
      const highIdx = Math.min(maxMusicalBin, Math.ceil(binIdx));
      const frac = binIdx - lowIdx;

      const rawVal = (this.freqData![lowIdx] || 0) * (1 - frac) + (this.freqData![highIdx] || 0) * frac;
      
      // Dynamic frequency tilt: balances mids & high-treble so the entire width stays full and lively
      const trebleComp = 1.05 + Math.pow(norm, 0.85) * 1.75;
      const normalized = Math.min(1.0, (rawVal / 205.0) * trebleComp);
      
      return Math.pow(normalized, 0.82);
    };

    if (layout === 'bell') {
      // Symmetrical Bell Curve: Powerful Sub-Bass / Kicks in the Center, rippling outward to Mids, Vocals, and Treble wings
      const mid = (barCount - 1) / 2;
      for (let i = 0; i < barCount; i++) {
        const distFromCenter = Math.abs(i - mid) / mid; // 0.0 at center, 1.0 at outer left/right
        result[i] = sampleFrequency(distFromCenter);
      }
    } else {
      for (let i = 0; i < barCount; i++) {
        const norm = i / (barCount - 1);
        result[i] = sampleFrequency(norm);
      }
    }

    return result;
  }
}

export const audioEngine = new AudioEngineManager();
