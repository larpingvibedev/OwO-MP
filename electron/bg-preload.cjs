// Finite Startup Guard & Web Audio FFT Analyzer for YouTube Background Player
// 1. Intercepts initial autoplay attempts while the page initializes, holding media paused at 0:00.
// 2. Extracts 100% volume-independent, unattenuated FFT spectrum data and bridges it via IPC.
// 3. Implements clean GainNode output control for audible speaker playback.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Expose high-performance bridge from main world to Electron IPC
contextBridge.exposeInMainWorld('__owoBgBridge', {
  sendFFT: (buffer) => {
    try {
      ipcRenderer.send('bg-audio-fft', buffer);
    } catch (e) {}
  }
});

webFrame.executeJavaScript(`
  (() => {
    window.__owoStartupGuard = {
      active: true
    };

    const origPlay = HTMLMediaElement.prototype.play;
    window.__owoOrigPlay = origPlay;

    // Scoped play interceptor active ONLY during startup guard
    HTMLMediaElement.prototype.play = function() {
      if (window.__owoStartupGuard && window.__owoStartupGuard.active) {
        this.volume = 0;
        this.muted = true;
        return Promise.resolve();
      }
      return origPlay.apply(this, arguments);
    };

    // Web Audio Context & Analyzer Graph
    let audioCtx = null;
    let analyserNode = null;
    let gainNode = null;
    let currentTargetVolume = 1.0;
    let freqDataArray = null;
    let lastFFTSendTime = 0;

    function initAudioGraph(video) {
      if (!video || video.__owoAudioAttached) return;
      video.__owoAudioAttached = true;

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        if (!audioCtx) {
          audioCtx = new AudioContextClass();
        }

        if (!analyserNode) {
          analyserNode = audioCtx.createAnalyser();
          analyserNode.fftSize = 256; // 128 frequency bins
          analyserNode.smoothingTimeConstant = 0.65;
          analyserNode.minDecibels = -80;
          analyserNode.maxDecibels = -12;
          freqDataArray = new Uint8Array(analyserNode.frequencyBinCount);
        }

        if (!gainNode) {
          gainNode = audioCtx.createGain();
          gainNode.gain.setValueAtTime(currentTargetVolume, audioCtx.currentTime);
        }

        // Graph: MediaElementSource -> AnalyserNode (unattenuated)
        //        MediaElementSource -> GainNode -> Destination (speaker volume)
        const sourceNode = audioCtx.createMediaElementSource(video);
        sourceNode.connect(analyserNode);
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        window.__owoAudioCtx = audioCtx;
        window.__owoGainNode = gainNode;

        console.log('[BgPlayer WebAudio] Analyzer & Gain graph attached in main world.');
      } catch (err) {
        console.warn('[BgPlayer WebAudio] Audio graph attach notice:', err);
      }
    }

    // 40Hz throttled FFT sampling loop (uses setInterval to remain active when window is hidden)
    function startSpectrumLoop() {
      function tick() {
        if (!analyserNode || !freqDataArray || !audioCtx) return;

        // Rule: Visualizer only moves during audible, active playback (guard released, unpaused, playing)
        if (window.__owoStartupGuard && window.__owoStartupGuard.active) return;

        const v = document.querySelector('video');
        if (!v || v.paused || v.ended || v.currentTime <= 0) return;

        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }

        analyserNode.getByteFrequencyData(freqDataArray);

        // Verify energy presence
        let sum = 0;
        for (let i = 0; i < freqDataArray.length; i++) {
          sum += freqDataArray[i];
        }

        if (sum > 0.5 && window.__owoBgBridge && typeof window.__owoBgBridge.sendFFT === 'function') {
          window.__owoBgBridge.sendFFT(freqDataArray);
        }
      }

      setInterval(tick, 25);
    }

    startSpectrumLoop();


    // Watch for video element attachments & SPA navigations
    function checkAndAttach() {
      const video = document.querySelector('video');
      if (video && !video.__owoAudioAttached) {
        initAudioGraph(video);
      }
    }

    document.addEventListener('loadedmetadata', (e) => {
      if (e.target && e.target.tagName === 'VIDEO') {
        initAudioGraph(e.target);
      }
    }, true);

    setInterval(checkAndAttach, 400);

    // Volume Controller Helper
    // Keeps source <video> and YouTube player at 100% unity gain so the AnalyserNode receives
    // the full unattenuated frequency spectrum, while GainNode scales speaker output volume.
    window.__owoSetGainVolume = function(vol) {
      currentTargetVolume = Math.max(0, Math.min(1, vol));
      if (gainNode && audioCtx) {
        try {
          gainNode.gain.setValueAtTime(currentTargetVolume, audioCtx.currentTime);
        } catch (e) {
          gainNode.gain.value = currentTargetVolume;
        }
      }
      const v = document.querySelector('video');
      if (v) {
        v.volume = 1.0;
      }
      const p = document.getElementById('movie_player');
      if (p && typeof p.setVolume === 'function') {
        p.setVolume(100);
      }
    };

    // Release helper to transition seamlessly from STARTUP_GUARD to PLAYING
    window.__owoReleaseStartupGuard = function(targetVol, targetTime) {
      if (!window.__owoStartupGuard) return;
      window.__owoStartupGuard.active = false;

      if (typeof targetVol === 'number') {
        window.__owoSetGainVolume(targetVol);
      }

      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const v = document.querySelector('video');
      const p = document.getElementById('movie_player');
      if (v) {
        v.muted = false;
        v.volume = 1.0;
        if (typeof targetTime === 'number' && targetTime > 0 && Math.abs(v.currentTime - targetTime) > 0.2) {
          v.currentTime = targetTime;
        }
        window.__owoOrigPlay.call(v).catch(() => {});
      }
      if (p) {
        if (typeof p.unMute === 'function') p.unMute();
        if (typeof p.setVolume === 'function') p.setVolume(100);
        if (typeof p.playVideo === 'function') p.playVideo();
      }
    };
  })();
`);



