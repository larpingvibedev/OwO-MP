/**
 * Discord Rich Presence (RPC) Service for OwO Music Player
 * 
 * Modular service running inside Electron Main Process using @xhayper/discord-rpc.
 * - Application ID: 1540731276166828163
 * - Discord API v10 StatusDisplayType.DETAILS (renders song title as status)
 * - ActivityType.Listening (type: 2) with graceful automatic fallback
 * - Resilient finite state machine: DISCONNECTED -> CONNECTING -> READY -> FAILED
 * - Exponential backoff auto-reconnect (5s -> 15s -> 30s -> 60s cap)
 * - Cached desired activity: publishes immediately when Discord starts/reconnects
 * - Safe payload validation, sanitization, and fallback artwork handling
 * - Idempotent cleanup on app quit
 */

const DISCORD_CLIENT_ID = '1540731276166828163';
const FALLBACK_LOGO_KEY = 'owo-logo';

const BACKOFF_DELAYS = [5000, 15000, 30000, 60000];

class DiscordPresenceService {
  constructor() {
    this.rpc = null;
    this.state = 'DISCONNECTED'; // 'DISCONNECTED' | 'CONNECTING' | 'READY' | 'FAILED'
    this.enabled = true;
    this.reconnectTimer = null;
    this.backoffIndex = 0;
    
    // Cached desired activity snapshot so reconnects can immediately republish
    this.cachedActivity = null;
    this.lastPublishedPayloadKey = null;
    
    // Throttle / Debounce
    this.debounceTimer = null;
    this.lastSentTimestamp = 0;
    this.pendingActivity = null;
    this.isDestroyed = false;
    this.statusDisplayTypeSupported = true;
    this.type2Supported = true;

    this.initRPC();
  }

  /**
   * Initializes RPC client library and registers event listeners.
   */
  initRPC() {
    if (this.isDestroyed) return;

    let DiscordRPC = null;
    try {
      DiscordRPC = require('@xhayper/discord-rpc');
    } catch (e) {
      console.warn('[DiscordRPC] @xhayper/discord-rpc module not found or failed to load:', e?.message || e);
      this.state = 'FAILED';
      return;
    }

    try {
      const { Client } = DiscordRPC;
      this.rpc = new Client({ clientId: DISCORD_CLIENT_ID });

      this.rpc.on('ready', () => {
        console.log(`[DiscordRPC] Connected as ${this.rpc.user?.username || 'OwO Music Player'}`);
        this.state = 'READY';
        this.backoffIndex = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Immediately publish desired activity if one was cached while disconnected
        if (this.enabled && this.cachedActivity) {
          this.publishActivity(this.cachedActivity);
        }
      });

      this.rpc.on('disconnected', () => {
        console.log('[DiscordRPC] Disconnected from Discord client. Will retry with backoff.');
        this.handleDisconnect();
      });

      this.connect();
    } catch (err) {
      console.warn('[DiscordRPC] Error initializing client:', err?.message || err);
      this.handleDisconnect();
    }
  }

  /**
   * Initiates login connection to Discord client.
   */
  connect() {
    if (this.isDestroyed || !this.rpc) return;
    if (this.state === 'CONNECTING' || this.state === 'READY') return;

    this.state = 'CONNECTING';
    
    this.rpc.login().catch(() => {
      // Discord client is likely closed or not installed; handle silently with backoff
      this.handleDisconnect();
    });
  }

  /**
   * Handles disconnections and schedules an exponential backoff retry.
   */
  handleDisconnect() {
    this.state = 'DISCONNECTED';
    if (this.isDestroyed) return;

    if (!this.reconnectTimer) {
      const delay = BACKOFF_DELAYS[Math.min(this.backoffIndex, BACKOFF_DELAYS.length - 1)];
      this.backoffIndex++;
      
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.state === 'DISCONNECTED' && !this.isDestroyed) {
          this.connect();
        }
      }, delay);
    }
  }

  /**
   * Sanitizes strings to comply with Discord Rich Presence limits.
   */
  sanitizeString(val, maxLen = 128, fallback = '') {
    if (!val || typeof val !== 'string') return fallback;
    let clean = val.trim();
    if (!clean) return fallback;
    // Strip trailing extensions if title looks like a raw filename (e.g. track.mp3)
    clean = clean.replace(/\.(mp3|m4a|wav|flac|ogg|aac|opus|webm)$/i, '').trim();
    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen - 1).trim() + '…';
    }
    return clean || fallback;
  }

  /**
   * Sanitizes image URLs. Rejects local file paths, blobs, or invalid schemas.
   */
  sanitizeArtworkUrl(url) {
    if (!url || typeof url !== 'string') return FALLBACK_LOGO_KEY;
    const trimmed = url.trim();
    // Only accept valid remote http/https URLs
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed;
    }
    return FALLBACK_LOGO_KEY;
  }

  /**
   * Public entrypoint: updates current activity with debouncing.
   */
  updateActivity(payload) {
    if (!payload || typeof payload !== 'object') {
      this.clearActivity();
      return;
    }

    // Defensive validation & clamping
    const title = this.sanitizeString(payload.title, 128, 'Unknown Track');
    const artist = this.sanitizeString(payload.artist, 128, 'Unknown Artist');
    const album = this.sanitizeString(payload.album, 128, title);
    const artworkUrl = this.sanitizeArtworkUrl(payload.artworkUrl);
    const duration = Math.max(0, typeof payload.duration === 'number' && !isNaN(payload.duration) ? payload.duration : 0);
    const currentTime = Math.max(0, typeof payload.currentTime === 'number' && !isNaN(payload.currentTime) ? payload.currentTime : 0);
    const isPlaying = Boolean(payload.isPlaying);

    const activityData = {
      title,
      artist,
      album,
      artworkUrl,
      duration,
      currentTime,
      isPlaying
    };

    // Cache latest desired snapshot
    this.cachedActivity = activityData;

    if (!this.enabled) {
      return;
    }

    // Debounce to prevent rate-limit penalties while keeping play/pause instant
    this.pendingActivity = activityData;
    const now = Date.now();
    const timeSinceLast = now - this.lastSentTimestamp;
    const MIN_INTERVAL_MS = 500;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (timeSinceLast >= MIN_INTERVAL_MS) {
      this.publishActivity(activityData);
    } else {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingActivity) {
          this.publishActivity(this.pendingActivity);
          this.pendingActivity = null;
        }
      }, MIN_INTERVAL_MS - timeSinceLast);
    }
  }

  /**
   * Formats and publishes the Discord activity payload to the client.
   */
  publishActivity(activity) {
    if (!this.rpc || this.state !== 'READY' || !this.enabled || !activity) return;

    try {
      const now = Date.now();
      this.lastSentTimestamp = now;

      const { title, artist, album, artworkUrl, duration, currentTime, isPlaying } = activity;

      // Unique payload key to avoid duplicate dispatches
      const payloadKey = `${title}|${artist}|${isPlaying}|${duration}|${Math.round(currentTime)}`;
      if (this.lastPublishedPayloadKey === payloadKey) {
        return;
      }
      this.lastPublishedPayloadKey = payloadKey;

      const activityInfo = {
        type: this.type2Supported ? 2 : 0, // 2 = Listening, 0 = Playing
        details: title,
        state: isPlaying ? `by ${artist}` : `${artist} • Paused`,
        largeImageKey: artworkUrl,
        largeImageText: isPlaying ? (album || title) : '⏸︎ Paused',
        smallImageKey: isPlaying ? 'play' : 'pause',
        smallImageText: isPlaying ? 'Playing' : 'Paused',
        instance: false
      };

      if (this.statusDisplayTypeSupported) {
        // StatusDisplayType.DETAILS (2) displays the activity details (Song Title) in status text!
        activityInfo.statusDisplayType = 2;
      }

      if (isPlaying) {
        // Calculate accurate countdown timestamps
        const startSec = Math.max(0, Math.floor(currentTime));
        const startTimestamp = Math.floor(now - (startSec * 1000));
        activityInfo.startTimestamp = startTimestamp;

        if (duration > 0 && duration > currentTime) {
          activityInfo.endTimestamp = Math.floor(startTimestamp + (duration * 1000));
        }
      }
      // Note: When paused, startTimestamp & endTimestamp are left undefined so Discord does not tick up

      this.sendActivityPayload(activityInfo);
    } catch (err) {
      console.warn('[DiscordRPC] publishActivity error:', err?.message || err);
    }
  }

  /**
   * Sends activity payload to Discord RPC client with fallback handling.
   */
  async sendActivityPayload(activityInfo) {
    if (!this.rpc || this.state !== 'READY' || !this.rpc.user) return;

    try {
      await this.rpc.user.setActivity(activityInfo);
    } catch (err) {
      console.log('[DiscordRPC] setActivity notice, attempting fallback:', err?.message || err);
      // Fallback 1: disable statusDisplayType if unsupported
      if (activityInfo.statusDisplayType !== undefined) {
        this.statusDisplayTypeSupported = false;
        try {
          const fallback1 = { ...activityInfo, statusDisplayType: undefined };
          await this.rpc.user.setActivity(fallback1);
          return;
        } catch (f1Err) {
          console.log('[DiscordRPC] Fallback 1 failed:', f1Err?.message || f1Err);
        }
      }

      // Fallback 2: standard Playing type
      if (activityInfo.type === 2) {
        this.type2Supported = false;
        try {
          const fallback2 = { ...activityInfo, type: 0, statusDisplayType: undefined };
          await this.rpc.user.setActivity(fallback2);
        } catch (f2Err) {
          console.warn('[DiscordRPC] Standard activity fallback failed:', f2Err?.message || f2Err);
        }
      }
    }
  }

  /**
   * Clears Discord Rich Presence.
   */
  clearActivity() {
    this.cachedActivity = null;
    this.lastPublishedPayloadKey = null;
    this.pendingActivity = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.rpc && this.state === 'READY' && this.rpc.user) {
      try {
        this.rpc.user.clearActivity().catch(() => {});
      } catch (e) {}
    }
  }

  /**
   * Enables or disables presence sharing based on user privacy setting.
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.clearActivity();
    } else if (this.cachedActivity) {
      this.publishActivity(this.cachedActivity);
    }
  }

  /**
   * Graceful and idempotent cleanup on app exit.
   */
  cleanup() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.rpc) {
      try {
        if (this.rpc.user) {
          this.rpc.user.clearActivity().catch(() => {});
        }
        this.rpc.destroy().catch(() => {});
      } catch (e) {}
      this.rpc = null;
    }
    this.state = 'DISCONNECTED';
  }
}

// Singleton instance
let instance = null;

function getDiscordPresenceService() {
  if (!instance) {
    instance = new DiscordPresenceService();
  }
  return instance;
}

module.exports = {
  DiscordPresenceService,
  getDiscordPresenceService
};
