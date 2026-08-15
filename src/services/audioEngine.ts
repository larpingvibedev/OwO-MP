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
        this.analyser.fftSize = 128; // 64 frequency bins
        this.analyser.smoothingTimeConstant = 0.75;
        this.analyser.minDecibels = -85;
        this.analyser.maxDecibels = -10;
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
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /**
   * Returns normalized real-time frequency data (0.0 to 1.0) resampled to `barCount` bars.
   * Returns null if HTML5 audio element is idle so visualizer can use Mode B Synthwave Rhythm.
   */
  public getLiveFrequencies(barCount: number): number[] | null {
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
    if (sum < 1.0) {
      return null;
    }

    const result: number[] = new Array(barCount);

    // Resample the 64 FFT bins to target `barCount` (e.g. 42 bars) with logarithmic frequency distribution
    for (let i = 0; i < barCount; i++) {
      const norm = i / (barCount - 1);
      const logIndex = Math.pow(norm, 1.45) * (len - 1);
      const lowIdx = Math.floor(logIndex);
      const highIdx = Math.min(len - 1, Math.ceil(logIndex));
      const frac = logIndex - lowIdx;

      const rawVal = this.freqData[lowIdx] * (1 - frac) + this.freqData[highIdx] * frac;
      
      // True linear normalization: 0 to 255 -> 0.0 to 1.0 with high-frequency compensation
      const eqBoost = 1.0 + norm * 0.55;
      result[i] = Math.min(1.0, (rawVal / 255.0) * eqBoost);
    }

    return result;
  }
}

export const audioEngine = new AudioEngineManager();
