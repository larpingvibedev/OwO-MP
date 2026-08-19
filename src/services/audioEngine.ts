/**
 * Global Web Audio API Engine & Real-Time Spectrum Analyzer
 * Connects directly to HTML5 Audio Element & Background YouTube Engine to extract 100% accurate FFT frequency spectrum data.
 * Features Volume-Independent Analysis: audio is analyzed at full resolution before volume attenuation controls speaker output.
 */

export type PlaybackSource = 'youtube' | 'local' | 'none';

class AudioEngineManager {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private freqData: Uint8Array | null = null;
  private isConnected = false;
  private currentVolume = 1.0;

  // Source selection & Background YouTube Stream State
  private playbackSource: PlaybackSource = 'none';
  private bgFreqData: Uint8Array | null = null;
  private bgLastUpdateTime = 0;

  constructor() {
    this.setupBgListener();
  }

  private setupBgListener(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onBgAudioFFT) {
      electronAPI.onBgAudioFFT((data: Uint8Array | number[]) => {
        if (data) {
          if (!this.bgFreqData || this.bgFreqData.length !== (data.length || (data as any).byteLength)) {
            this.bgFreqData = new Uint8Array(data);
          } else {
            this.bgFreqData.set(data as any);
          }
          this.bgLastUpdateTime = performance.now();
        }
      });
    }
  }

  /**
   * Explicitly configure the active playback source for FFT analysis.
   */
  public setPlaybackSource(source: PlaybackSource): void {
    this.playbackSource = source;
  }

  /**
   * Initializes the Web Audio API context and connects the audio element to the analyser.
   * Audio Routing: Source -> AnalyserNode (Full Signal) -> GainNode (User Volume) -> Destination (Speakers)
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
        this.analyser.smoothingTimeConstant = 0.65; // Snappy, punchy response to transient beats
        this.analyser.minDecibels = -80;
        this.analyser.maxDecibels = -12;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      }

      if (!this.gainNode) {
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(this.currentVolume, this.audioCtx.currentTime);
      }

      if (!this.sourceNode && this.audioElement) {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);
        // Pure unattenuated signal enters Analyser
        this.sourceNode.connect(this.analyser);
        // Output from Analyser enters GainNode for listening volume control
        this.analyser.connect(this.gainNode);
        // Scaled volume exits to device speakers
        this.gainNode.connect(this.audioCtx.destination);
        this.isConnected = true;

        // Ensure HTML5 audio element stays at unity gain so Web Audio receives full dynamic range
        this.audioElement.volume = 1.0;
      }

      // Auto-resume on all audio element events
      audioEl.addEventListener('play', () => this.resume());
      audioEl.addEventListener('playing', () => this.resume());
      audioEl.addEventListener('canplay', () => this.resume());
      audioEl.addEventListener('canplaythrough', () => this.resume());

      // Auto-resume on user interactions
      window.addEventListener('pointerdown', () => this.resume());
      window.addEventListener('click', () => this.resume());
      window.addEventListener('keydown', () => this.resume());
    } catch (err) {
      console.warn('Web Audio API connection notice:', err);
    }
  }

  /**
   * Sets output volume via the Web Audio GainNode.
   * Preserves full unattenuated signal into the FFT Analyser.
   */
  public setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.currentVolume = clamped;
    if (this.gainNode && this.audioCtx) {
      try {
        this.gainNode.gain.setValueAtTime(clamped, this.audioCtx.currentTime);
      } catch (e) {
        this.gainNode.gain.value = clamped;
      }
    }
  }

  /**
   * Returns whether Web Audio API is actively connected and processing.
   */
  public isConnectedToWebAudio(): boolean {
    return this.isConnected;
  }

  /**
   * Returns whether Web Audio API is actively connected and playing.
   */
  public isAudioActive(): boolean {
    if (this.playbackSource === 'youtube') {
      return (performance.now() - this.bgLastUpdateTime) < 400;
    }
    return this.isConnected && Boolean(this.audioElement && !this.audioElement.paused && this.audioElement.currentTime > 0);
  }

  /**
   * Resumes AudioContext if suspended by browser autoplay policy.
   */
  public async resume(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state !== 'running') {
      try {
        await this.audioCtx.resume();
      } catch (e) {}
    }
  }

  /**
   * Resamples raw FFT byte frequency array to `barCount` bars using dynamic acoustic curve.
   */
  private processFrequencyBins(freqArray: Uint8Array, barCount: number, layout: 'bell' | 'linear'): number[] | null {
    const len = freqArray.length;
    if (!len) return null;

    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += freqArray[i];
    }
    if (sum < 0.5) {
      return null;
    }

    const result: number[] = new Array(barCount);
    // Active musical spectrum: Bin 1 (~40 Hz) to Bin 48 (~8.5 kHz)
    const maxMusicalBin = Math.min(len - 1, 48);
    const minMusicalBin = 1;

    const sampleFrequency = (norm: number) => {
      // Natural logarithmic distribution from sub-bass to high treble
      const logNorm = Math.pow(norm, 1.25);
      const binIdx = minMusicalBin + logNorm * (maxMusicalBin - minMusicalBin);
      
      const lowIdx = Math.floor(binIdx);
      const highIdx = Math.min(maxMusicalBin, Math.ceil(binIdx));
      const frac = binIdx - lowIdx;

      const rawVal = (freqArray[lowIdx] || 0) * (1 - frac) + (freqArray[highIdx] || 0) * frac;
      
      // rawVal is 0..255 from getByteFrequencyData
      const baseRatio = rawVal / 255.0;
      
      // Dynamic power curve: punchy transient peaks, clear separation between beats, prevents flat clipping
      const dynamicVal = Math.pow(baseRatio, 1.28) * 1.08;
      return Math.min(0.96, Math.max(0.0, dynamicVal));
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

  /**
   * Returns normalized real-time frequency data (0.0 to 1.0) resampled to `barCount` bars.
   * Operates on source audio dynamics, completely independent of the volume slider setting.
   */
  public getLiveFrequencies(barCount: number = 42, layout: 'bell' | 'linear' = 'bell'): number[] | null {
    // 1. YouTube Background Stream Source
    if (this.playbackSource === 'youtube') {
      if (!this.bgFreqData || (performance.now() - this.bgLastUpdateTime) > 350) {
        return null;
      }
      return this.processFrequencyBins(this.bgFreqData, barCount, layout);
    }

    // 2. Local HTML5 Audio Source
    if (this.playbackSource === 'local') {
      if (!this.analyser || !this.freqData || !this.audioCtx) return null;

      if (!this.audioElement || this.audioElement.paused || this.audioElement.currentTime <= 0) {
        return null;
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.analyser.getByteFrequencyData(this.freqData as any);
      return this.processFrequencyBins(this.freqData, barCount, layout);
    }

    // 3. Fallback: Opportunistic Auto-detect if source wasn't explicitly set
    if (this.bgFreqData && (performance.now() - this.bgLastUpdateTime) <= 350) {
      return this.processFrequencyBins(this.bgFreqData, barCount, layout);
    }

    if (this.analyser && this.freqData && this.audioElement && !this.audioElement.paused && this.audioElement.currentTime > 0) {
      if (this.audioCtx?.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.analyser.getByteFrequencyData(this.freqData as any);
      return this.processFrequencyBins(this.freqData, barCount, layout);
    }

    return null;
  }
}

export const audioEngine = new AudioEngineManager();

