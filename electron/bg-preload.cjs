// Finite Startup Guard for YouTube Background Player
// Intercepts initial autoplay attempts while the page initializes,
// holding the media element cleanly paused at 0:00 without sending audio frames.
// Completely deactivates once normal playback begins.
const { webFrame } = require('electron');

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

    // Release helper to transition seamlessly from STARTUP_GUARD to PLAYING
    window.__owoReleaseStartupGuard = function(targetVol, targetTime) {
      if (!window.__owoStartupGuard) return;
      window.__owoStartupGuard.active = false;

      const v = document.querySelector('video');
      const p = document.getElementById('movie_player');
      if (v) {
        v.muted = false;
        v.volume = targetVol;
        if (typeof targetTime === 'number' && targetTime > 0 && Math.abs(v.currentTime - targetTime) > 0.2) {
          v.currentTime = targetTime;
        }
        window.__owoOrigPlay.call(v).catch(() => {});
      }
      if (p) {
        if (typeof p.unMute === 'function') p.unMute();
        if (typeof p.setVolume === 'function') p.setVolume(Math.round(targetVol * 100));
        if (typeof p.playVideo === 'function') p.playVideo();
      }
    };
  })();
`);
