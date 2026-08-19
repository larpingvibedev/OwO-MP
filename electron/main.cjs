const { app, BrowserWindow, ipcMain, shell, dialog, protocol, session } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const vm = require('node:vm');
const { Readable } = require('stream');

// ----------------------------------------------------
// PORTABLE BUILD SELF-CONTAINMENT LOGIC
// ----------------------------------------------------
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
if (isPortable) {
  const portableBase = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'owo-data');
  const subdirs = [
    portableBase,
    path.join(portableBase, 'userData'),
    path.join(portableBase, 'sessionData'),
    path.join(portableBase, 'userCache'),
    path.join(portableBase, 'logs'),
    path.join(portableBase, 'crashDumps'),
    path.join(portableBase, 'temp'),
    path.join(portableBase, 'Music')
  ];
  for (const dir of subdirs) {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
  }

  try { app.setPath('userData', path.join(portableBase, 'userData')); } catch (e) {}
  try { app.setPath('appData', portableBase); } catch (e) {}
  try { app.setPath('sessionData', path.join(portableBase, 'sessionData')); } catch (e) {}
  try { app.setPath('userCache', path.join(portableBase, 'userCache')); } catch (e) {}
  try { app.setPath('logs', path.join(portableBase, 'logs')); } catch (e) {}
  try { app.setPath('crashDumps', path.join(portableBase, 'crashDumps')); } catch (e) {}
  try { app.setPath('temp', path.join(portableBase, 'temp')); } catch (e) {}
}

function getDefaultMusicDirectory() {
  if (isPortable) {
    const portableMusicDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'owo-data', 'Music');
    if (!fs.existsSync(portableMusicDir)) {
      try { fs.mkdirSync(portableMusicDir, { recursive: true }); } catch (e) {}
    }
    return portableMusicDir;
  }
  const defaultDir = path.join(os.homedir(), 'Music', 'OwO Music');
  if (!fs.existsSync(defaultDir)) {
    try { fs.mkdirSync(defaultDir, { recursive: true }); } catch (e) {}
  }
  return defaultDir;
}

// Universal autoplay & audio engine enablement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let proxyPort = 41721;
let cachedVisitorSession = null;
const resolvedAudioCache = new Map(); // videoId -> { audioInfo: { url, mimeType }, time: number }

let innertubeInstance = null;
let innertubeInitPromise = null;

async function getInnertube() {
  if (innertubeInstance) return innertubeInstance;
  if (innertubeInitPromise) return innertubeInitPromise;

  innertubeInitPromise = (async () => {
    try {
      const { Innertube, UniversalCache, Platform } = await import('youtubei.js');

      // Configure VM Sandbox evaluator for youtubei.js signature & nsig deciphering
      Platform.shim.eval = (data, env = {}) => {
        const code = data?.output || data;
        if (typeof code === 'string') {
          const sandbox = { ...env };
          const context = vm.createContext(sandbox);
          const wrappedCode = `(function() {\n${code}\n})()`;
          const result = vm.runInContext(wrappedCode, context);
          return result || sandbox;
        }
        return {};
      };

      const yt = await Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true
      });

      innertubeInstance = yt;
      console.log('[Innertube] Initialized successfully with VM decipher engine.');
      return yt;
    } catch (err) {
      console.error('[Innertube] Initialization error:', err.message);
      return null;
    } finally {
      innertubeInitPromise = null;
    }
  })();

  return innertubeInitPromise;
}

// Pre-initialize Innertube on launch
getInnertube().catch(() => {});

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getSessionCachePath() {
  try {
    return path.join(app.getPath('userData'), 'session_cache.json');
  } catch (e) {
    return path.join(__dirname, 'session_cache.json');
  }
}

function fetchSessionCandidate() {
  return new Promise((resolve) => {
    const visitor_id = generateRandomString(11);
    const prefCookie = `PREF=tz=America.New_York;VISITOR_INFO1_LIVE=${visitor_id};`;
    
    const req = https.request({
      hostname: 'www.youtube.com',
      path: '/',
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Cookie': prefCookie
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/"VISITOR_DATA":\s*"([^"]+)"/) || data.match(/"visitorData":\s*"([^"]+)"/);
        const visitorData = match ? match[1] : undefined;
        let setCookies = '';
        if (res.headers['set-cookie']) {
          setCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        }
        const combinedCookies = [prefCookie, setCookies].filter(Boolean).join('; ');
        resolve({ visitorData, cookie: combinedCookies, status: res.statusCode });
      });
    });
    req.on('error', (err) => {
      console.warn('[Session Candidate] Network error:', err.message);
      resolve({ visitorData: undefined, cookie: '', status: 500 });
    });
    req.setTimeout(4500, () => {
      req.destroy();
      resolve({ visitorData: undefined, cookie: '', status: 500 });
    });
    req.end();
  });
}

async function verifySessionCandidate(session) {
  if (!session || !session.visitorData) return false;
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Cookie': session.cookie
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID_VR',
            clientVersion: '1.60.19',
            deviceModel: 'Quest 3',
            hl: 'en',
            gl: 'US',
            visitorData: session.visitorData
          }
        },
        videoId: 'VRmzaiur0fI'
      }),
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    const formats = (data.streamingData?.adaptiveFormats || []).filter(f => f.mimeType?.includes('audio') && Boolean(f.url));
    return formats.length > 0;
  } catch (e) {
    return false;
  }
}

async function getVisitorSession(forceRefresh = false) {
  if (!forceRefresh && cachedVisitorSession && cachedVisitorSession.visitorData && (Date.now() - cachedVisitorSession.time < 86400000)) {
    return cachedVisitorSession;
  }

  const cacheFile = getSessionCachePath();
  if (!forceRefresh && fs.existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (saved.visitorData && (Date.now() - (saved.time || 0) < 86400000)) {
        cachedVisitorSession = saved;
        return cachedVisitorSession;
      }
    } catch (e) {}
  }

  console.log('[VisitorSession] Acquiring verified warm session...');
  for (let attempt = 1; attempt <= 6; attempt++) {
    const candidate = await fetchSessionCandidate();
    if (candidate.visitorData) {
      const isWarm = await verifySessionCandidate(candidate);
      if (isWarm) {
        cachedVisitorSession = { visitorData: candidate.visitorData, cookie: candidate.cookie, time: Date.now() };
        try {
          fs.writeFileSync(cacheFile, JSON.stringify(cachedVisitorSession), 'utf8');
        } catch (e) {}
        console.log('[VisitorSession] Verified warm session established and persisted!');
        return cachedVisitorSession;
      }
    }
  }

  return { visitorData: undefined, cookie: '', time: Date.now() };
}

// Pre-warm visitor session immediately on launch
getVisitorSession().catch(() => {});

async function resolveBestAudioUrl(videoId, forceFresh = false) {
  if (!videoId) return null;

  // 1. Check Cache with Dynamic Expiration Validation
  if (!forceFresh) {
    const cached = resolvedAudioCache.get(videoId);
    if (cached) {
      const isExpired = cached.expireTimestamp ? (Date.now() / 1000 > (cached.expireTimestamp - 300)) : false;
      const isWithinTtl = (Date.now() - cached.time) < 7200000; // 2 hours max
      if (!isExpired && isWithinTtl) {
        return cached.audioInfo;
      }
    }
  }

  // 2. High-speed Innertube Multi-Client Decipher Engine (YTMUSIC, MWEB, IOS, ANDROID, WEB)
  try {
    const yt = await getInnertube();
    if (yt) {
      for (const clientName of ['YTMUSIC', 'MWEB', 'IOS', 'ANDROID', 'WEB']) {
        try {
          const info = await yt.getBasicInfo(videoId, { client: clientName });
          const format = info.chooseFormat({ type: 'audio', quality: 'best' });
          if (format) {
            const deciphered = await format.decipher(yt.session.player);
            const streamUrl = typeof deciphered === 'string' ? deciphered : (deciphered?.toString?.() || '');
            if (streamUrl && streamUrl.startsWith('http')) {
              let expireTimestamp = null;
              try {
                const u = new URL(streamUrl);
                const exp = u.searchParams.get('expire');
                if (exp) expireTimestamp = parseInt(exp, 10);
              } catch (e) {}

              const totalSize = Number(format.content_length || format.raw_data?.contentLength || 0);

              const audioInfo = {
                url: streamUrl,
                mimeType: format.mime_type || 'audio/mp4',
                bitrate: format.bitrate,
                totalSize,
                clientName,
                headers: clientName === 'IOS'
                  ? { 'User-Agent': 'com.google.ios.youtube/19.43.2 (iPhone14,3; U; CPU iOS 18_1 like Mac OS X; en_US)' }
                  : clientName === 'YTMUSIC'
                  ? {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                      'Referer': 'https://music.youtube.com/',
                      'Origin': 'https://music.youtube.com'
                    }
                  : { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' }
              };

              resolvedAudioCache.set(videoId, { audioInfo, time: Date.now(), expireTimestamp });
              return audioInfo;
            }
          }
        } catch (clientErr) {
          // Continue to next client
        }
      }
    }
  } catch (err) {
    console.warn('[resolveBestAudioUrl] Innertube error:', err.message);
  }

  // 3. Fallback: Direct Native Android_VR Innertube Client with visitor session
  let activeSession = await getVisitorSession();
  const fallbackClients = [
    { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceModel: 'Quest 3', hl: 'en', gl: 'US' },
    { clientName: 'ANDROID', clientVersion: '19.29.35', hl: 'en', gl: 'US' }
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const c of fallbackClients) {
      try {
        const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            ...(activeSession?.cookie ? { 'Cookie': activeSession.cookie } : {})
          },
          body: JSON.stringify({
            context: {
              client: {
                ...c,
                visitorData: activeSession?.visitorData
              }
            },
            videoId: videoId
          }),
          signal: AbortSignal.timeout(2800)
        });

        if (playerRes.ok) {
          const data = await playerRes.json();
          const formats = (data.streamingData?.adaptiveFormats || []).filter(
            f => f.mimeType?.includes('audio') && Boolean(f.url)
          );
          if (formats.length > 0) {
            formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            const bestF = formats[0];
            const audioInfo = {
              url: bestF.url,
              mimeType: bestF.mimeType || 'audio/mp4',
              bitrate: bestF.bitrate,
              totalSize: Number(bestF.contentLength || 0),
              clientName: c.clientName,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            };
            resolvedAudioCache.set(videoId, { audioInfo, time: Date.now() });
            return audioInfo;
          }
        }
      } catch (e) {}
    }

    if (attempt === 0) {
      activeSession = await getVisitorSession(true);
    }
  }

  return null;
}

// Local background streaming proxy for YouTube audio with dynamic chunk streaming
function startInternalProxyServer() {
  const CHUNK_STREAM_SIZE = 512 * 1024; // 512 KB per upstream chunk

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/api/local-file') {
        const filePath = url.searchParams.get('path');
        if (!filePath || !fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Local file not found' }));
          return;
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const ext = path.extname(filePath).toLowerCase();
        let mimeType = 'audio/mpeg';
        if (ext === '.m4a' || ext === '.mp4' || ext === '.aac') mimeType = 'audio/mp4';
        else if (ext === '.wav') mimeType = 'audio/wav';
        else if (ext === '.flac') mimeType = 'audio/flac';
        else if (ext === '.ogg' || ext === '.opus') mimeType = 'audio/ogg';

        res.setHeader('Accept-Ranges', 'bytes');

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const fileStream = fs.createReadStream(filePath, { start, end });
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunksize,
            'Content-Type': mimeType
          });
          fileStream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mimeType
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }

      if (url.pathname === '/api/download-stream' || url.pathname === '/api/stream') {
        const videoId = url.searchParams.get('videoId') || url.searchParams.get('id');
        if (!videoId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'videoId is required' }));
          return;
        }

        let audioInfo = await resolveBestAudioUrl(videoId);

        if (!audioInfo || !audioInfo.url) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Audio stream not available' }));
          return;
        }

        // Determine total stream size
        let totalSize = audioInfo.totalSize || 0;
        if (!totalSize) {
          try {
            const probe = await fetch(audioInfo.url, {
              headers: {
                ...(audioInfo.headers || {}),
                'Range': 'bytes=0-1024'
              },
              signal: AbortSignal.timeout(3000)
            });
            const cr = probe.headers.get('content-range');
            if (cr && cr.includes('/')) {
              totalSize = parseInt(cr.split('/')[1], 10) || 0;
              audioInfo.totalSize = totalSize;
            }
          } catch (e) {}
        }

        // Fallback default size if unknown (~3.5 MB)
        if (!totalSize || isNaN(totalSize)) totalSize = 3800000;

        const range = req.headers.range;
        let start = 0;
        let end = totalSize - 1;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          start = parseInt(parts[0], 10) || 0;
          if (parts[1]) {
            end = parseInt(parts[1], 10);
          }
        }

        const contentLength = (end - start) + 1;

        res.statusCode = 206;
        res.setHeader('Content-Type', audioInfo.mimeType || 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', contentLength);

        let currentStart = start;
        let isClientClosed = false;

        req.on('close', () => {
          isClientClosed = true;
        });

        while (currentStart <= end && !isClientClosed) {
          const currentEnd = Math.min(currentStart + CHUNK_STREAM_SIZE - 1, end);
          const chunkRange = `bytes=${currentStart}-${currentEnd}`;

          let chunkRes;
          try {
            chunkRes = await fetch(audioInfo.url, {
              headers: {
                ...(audioInfo.headers || {}),
                'Range': chunkRange
              },
              signal: AbortSignal.timeout(6000)
            });

            // If chunk fails (e.g. 403 expired), refresh URL and retry once
            if (!chunkRes.ok && (chunkRes.status === 403 || chunkRes.status === 404)) {
              console.warn(`[Proxy] Chunk ${chunkRange} returned ${chunkRes.status}. Refreshing URL for ${videoId}...`);
              audioInfo = await resolveBestAudioUrl(videoId, true);
              if (audioInfo?.url) {
                chunkRes = await fetch(audioInfo.url, {
                  headers: {
                    ...(audioInfo.headers || {}),
                    'Range': chunkRange
                  },
                  signal: AbortSignal.timeout(6000)
                });
              }
            }
          } catch (fetchErr) {
            console.warn('[Proxy Chunk Fetch Error]:', fetchErr.message);
            break;
          }

          if (!chunkRes || !chunkRes.ok || !chunkRes.body) {
            break;
          }

          const reader = chunkRes.body.getReader();
          while (!isClientClosed) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }

          currentStart = currentEnd + 1;
        }

        res.end();
        return;
      }

      res.statusCode = 404;
      res.end('Not Found');
    } catch (err) {
      console.error('[Electron Proxy Error]:', err.message);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      proxyPort++;
      server.listen(proxyPort, '127.0.0.1');
    }
  });

  server.listen(proxyPort, '127.0.0.1', () => {
    console.log(`[Electron Native Proxy] Running on http://127.0.0.1:${proxyPort}`);
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/app.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0e11',
    title: 'OwO Music Player',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  // Expose proxy port to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('set-proxy-port', proxyPort);
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (bgPlayerWindow && !bgPlayerWindow.isDestroyed()) {
      try {
        bgPlayerWindow.destroy();
      } catch (e) {}
      bgPlayerWindow = null;
    }
  });
}

// ----------------------------------------------------
// AD-BLOCKING & TELEMETRY FILTERING FOR BG ENGINE
// ----------------------------------------------------
const BLOCKED_AD_HOSTS = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'pagead-googlehosted.l.google.com',
  'ad.doubleclick.net',
  'stats.g.doubleclick.net'
];

function shouldBlockRequest(urlStr, resourceType) {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    // Explicit allow-list for essential playback and media streams
    if (hostname.includes('googlevideo.com') || hostname.includes('music.youtube.com') || hostname.includes('youtube.com')) {
      if (hostname.startsWith('pagead') || hostname.startsWith('ad.')) {
        return true;
      }
      return false;
    }

    const isBlocked = BLOCKED_AD_HOSTS.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked));
    if (isBlocked && (process.env.NODE_ENV === 'development' || !app.isPackaged)) {
      console.log(`[AdBlock Network] Blocked: ${hostname} (${resourceType || 'unknown'})`);
    }
    return isBlocked;
  } catch (e) {
    return false;
  }
}

const INJECTED_AD_HANDLER_SCRIPT = `
(() => {
  if (window.__owoAdHandlerInstalled) return;
  window.__owoAdHandlerInstalled = true;

  let wasAdPlaying = false;
  let preAdVolume = null;
  let preAdMuted = false;

  function safeCheckAd() {
    try {
      const v = document.querySelector('video');
      const player = document.getElementById('movie_player');
      if (!v) return;

      // Active ad detection (using active indicators rather than static containers)
      const hasAdClass = document.querySelector('.ad-showing') !== null ||
                         document.querySelector('.ad-interrupting') !== null;
      const apiAdState = (player && typeof player.getAdState === 'function') ? player.getAdState() : 0;
      const isAdApi = (player && typeof player.isAd === 'function') ? player.isAd() : false;

      // Confirmed ad state: player API confirms ad or player DOM has active ad-showing class
      const isAd = (apiAdState > 0) || isAdApi || hasAdClass;

      if (isAd) {
        if (!wasAdPlaying) {
          wasAdPlaying = true;
          preAdMuted = v.muted;
          preAdVolume = v.volume;
        }

        // Mute video defensively during ad
        if (!v.muted) {
          v.muted = true;
        }

        // 1. Attempt clicking legitimate skip buttons
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-overlay-close-button');
        if (skipBtn) {
          skipBtn.click();
        }

        // 2. Opportunistic internal player API skip (if present and safe)
        if (player && typeof player.skipAd === 'function') {
          try { player.skipAd(); } catch (e) {}
        }

        // 3. Fail-safe seek: Only if duration is valid, finite, and positive
        if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration) {
          v.currentTime = Math.max(0, v.duration - 0.1);
        }
      } else {
        // Normal playback / Ad ended
        if (wasAdPlaying) {
          wasAdPlaying = false;
          // Restore user's original volume and mute state
          if (preAdMuted !== null) {
            v.muted = preAdMuted;
          }
          if (preAdVolume !== null) {
            v.volume = preAdVolume;
          }
        }
      }
    } catch (err) {
      // Fail-safe: do not disrupt playback on unexpected DOM exceptions
    }
  }

  // Defensive interval check
  const adInterval = setInterval(safeCheckAd, 200);

  // MutationObserver for immediate response to DOM changes
  const observer = new MutationObserver(() => {
    safeCheckAd();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id']
  });

  // Idempotent teardown on navigation / page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(adInterval);
    observer.disconnect();
    window.__owoAdHandlerInstalled = false;
  }, { once: true });
})();
`;

// ----------------------------------------------------
// BACKGROUND YOUTUBE MUSIC AUDIO RUNTIME ENGINE & STATE MACHINE
// ----------------------------------------------------
let bgPlayerWindow = null;
let bgPlayerUpdateInterval = null;

// Authoritative State Machine Variables
let requestedVideoId = null;
let currentPlayingVideoId = null;
let navigationInProgress = false;
let navigationStartTime = 0;
let endedSignalSentForVideoId = null;
let loadRequestId = 0;
const NAVIGATION_TIMEOUT_MS = 12000;

function getOrCreateBgPlayerWindow() {
  if (bgPlayerWindow && !bgPlayerWindow.isDestroyed()) {
    return bgPlayerWindow;
  }

  const s = session.fromPartition('persist:owo-music-runtime');

  // Install network filter once per session partition
  if (!s.__owoAdFilterInstalled) {
    s.__owoAdFilterInstalled = true;
    s.webRequest.onBeforeRequest((details, callback) => {
      if (shouldBlockRequest(details.url, details.resourceType)) {
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    });
  }

  bgPlayerWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      session: s,
      preload: path.join(__dirname, 'bg-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  // Inject idempotent defensive ad handler
  const injectAdHandler = () => {
    if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return;
    bgPlayerWindow.webContents.executeJavaScript(INJECTED_AD_HANDLER_SCRIPT).catch(() => {});
  };

  bgPlayerWindow.webContents.on('dom-ready', injectAdHandler);
  bgPlayerWindow.webContents.on('did-finish-load', injectAdHandler);

  if (bgPlayerUpdateInterval) clearInterval(bgPlayerUpdateInterval);
  bgPlayerUpdateInterval = setInterval(async () => {
    if (!bgPlayerWindow || bgPlayerWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;
    try {
      // 1. Navigation Timeout Guard
      if (navigationInProgress && Date.now() - navigationStartTime > NAVIGATION_TIMEOUT_MS) {
        console.warn(`[BgPlayer StateMachine] Navigation timeout for ${requestedVideoId}. Resetting navigation lock.`);
        navigationInProgress = false;
      }

      // 2. Query In-DOM and Player State
      const state = await bgPlayerWindow.webContents.executeJavaScript(`
        (() => {
          try {
            const v = document.querySelector('video');
            const p = document.getElementById('movie_player');
            if (!v) return null;

            // Extract authoritative identity signals
            const urlParams = new URLSearchParams(window.location.search);
            const urlVideoId = urlParams.get('v');
            const apiVideoData = (p && typeof p.getVideoData === 'function') ? p.getVideoData() : null;
            const apiVideoId = apiVideoData ? apiVideoData.video_id : null;
            const playerState = (p && typeof p.getPlayerState === 'function') ? p.getPlayerState() : null;

            // Ad check
            const hasAdClass = document.querySelector('.ad-showing') !== null || document.querySelector('.ad-interrupting') !== null;
            const apiAdState = (p && typeof p.getAdState === 'function') ? p.getAdState() : 0;
            const isAd = (apiAdState > 0) || hasAdClass;

            return {
              currentTime: v.currentTime || 0,
              duration: v.duration || 0,
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
              playerState: playerState,
              urlVideoId: urlVideoId,
              apiVideoId: apiVideoId,
              isAd: isAd
            };
          } catch (e) {
            return null;
          }
        })()
      `);

      if (!state) return;

      const { currentTime, duration, paused, ended, playerState, urlVideoId, apiVideoId, isAd } = state;

      // Settle actual video ID (favor matching requested if in transition)
      let resolvedActualId = null;
      if (urlVideoId && apiVideoId && urlVideoId === apiVideoId) {
        resolvedActualId = urlVideoId;
      } else {
        resolvedActualId = urlVideoId || apiVideoId;
      }

      // Transition from LOADING -> PLAYING when requested track is confirmed
      if (navigationInProgress && requestedVideoId) {
        if (resolvedActualId === requestedVideoId && !isAd && currentTime > 0) {
          currentPlayingVideoId = requestedVideoId;
          navigationInProgress = false;
          endedSignalSentForVideoId = null;
          console.log(`[BgPlayer StateMachine] Confirmed PLAYING for ${currentPlayingVideoId}`);
        }
      }

      // Check for High-Confidence Track Completion
      // v.ended is highest confidence; playerState === 0 with duration/currentTime matching is supporting signal
      const isNaturalEnd = ended === true || (playerState === 0 && duration > 0 && Math.abs(currentTime - duration) < 1.5);

      if (isNaturalEnd && currentPlayingVideoId && !navigationInProgress && !isAd) {
        if (endedSignalSentForVideoId !== currentPlayingVideoId) {
          endedSignalSentForVideoId = currentPlayingVideoId;
          console.log(`[BgPlayer StateMachine] Track ${currentPlayingVideoId} naturally ENDED.`);
          // Immediately pause to prevent YouTube's internal radio/automix from starting audio
          bgPlayerWindow.webContents.executeJavaScript(`
            (() => {
              const v = document.querySelector('video');
              const p = document.getElementById('movie_player');
              if (v) v.pause();
              if (p && p.pauseVideo) p.pauseVideo();
            })()
          `).catch(() => {});

          mainWindow.webContents.send('yt-player-state-update', {
            currentTime: duration || currentTime,
            duration: duration,
            paused: true,
            ended: true,
            videoId: currentPlayingVideoId
          });
        }
        return;
      }

      // Check for Unauthorized YouTube Autoplay / Radio Navigation
      // Conditions:
      // 1. Not in intentional navigation
      // 2. Not in an ad
      // 3. We have an established currentPlayingVideoId
      // 4. resolvedActualId is known and definitively NOT currentPlayingVideoId
      if (!navigationInProgress && !isAd && currentPlayingVideoId && resolvedActualId && resolvedActualId !== currentPlayingVideoId) {
        if (endedSignalSentForVideoId !== currentPlayingVideoId) {
          endedSignalSentForVideoId = currentPlayingVideoId;
          console.warn(`[BgPlayer StateMachine] Unauthorized navigation detected! YouTube auto-switched to ${resolvedActualId} instead of ${currentPlayingVideoId}. Intercepting.`);

          // Immediately pause unauthorized track
          bgPlayerWindow.webContents.executeJavaScript(`
            (() => {
              const v = document.querySelector('video');
              const p = document.getElementById('movie_player');
              if (v) v.pause();
              if (p && p.pauseVideo) p.pauseVideo();
            })()
          `).catch(() => {});

          // Report ended: true to React queue for currentPlayingVideoId
          mainWindow.webContents.send('yt-player-state-update', {
            currentTime: duration,
            duration: duration,
            paused: true,
            ended: true,
            videoId: currentPlayingVideoId
          });
        }
        return;
      }

      // Send normal telemetry update
      if (currentPlayingVideoId && !isAd) {
        mainWindow.webContents.send('yt-player-state-update', {
          currentTime: currentTime,
          duration: duration,
          paused: paused,
          ended: ended,
          videoId: currentPlayingVideoId
        });
      }
    } catch (e) {}
  }, 250);

  bgPlayerWindow.on('closed', () => {
    bgPlayerWindow = null;
    requestedVideoId = null;
    currentPlayingVideoId = null;
    navigationInProgress = false;
    endedSignalSentForVideoId = null;
    if (bgPlayerUpdateInterval) clearInterval(bgPlayerUpdateInterval);
  });

  return bgPlayerWindow;
}

// IPC Handlers for Background YouTube Player Engine
ipcMain.handle('play-yt-track', async (event, { videoId, startTime, volume }) => {
  if (!videoId) return { success: false };
  
  const currentReqId = ++loadRequestId;
  requestedVideoId = videoId;
  navigationInProgress = true;
  navigationStartTime = Date.now();
  endedSignalSentForVideoId = null;

  const targetVol = Math.max(0, Math.min(1, typeof volume === 'number' ? volume : 1));

  const player = getOrCreateBgPlayerWindow();

  try {
    console.log(`[BgPlayer] Loading YouTube Music: ${videoId} (reqId=${currentReqId}, targetVol=${targetVol})...`);
    await player.loadURL(`https://music.youtube.com/watch?v=${videoId}`);

    if (currentReqId !== loadRequestId) {
      console.log(`[BgPlayer] Request ${currentReqId} superseded by ${loadRequestId}. Aborting auto-play setup.`);
      return { success: true };
    }

    // Named constants for playback settling delay and startup fade
    const STARTUP_SETTLE_DELAY_MS = 650;
    const STARTUP_FADE_DURATION_MS = 35;

    // Trigger auto-play and apply volume in DOM when ready
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (currentReqId !== loadRequestId) return { success: true };

      const res = await player.webContents.executeJavaScript(`
        (() => {
          try {
            const v = document.querySelector('video');
            const p = document.getElementById('movie_player');

            // Opportunistic attempt to disable Automix
            try {
              const automixToggle = document.querySelector('tp-yt-paper-switch#automix-toggle, ytmusic-player-bar tp-yt-paper-toggle-button');
              if (automixToggle && (automixToggle.hasAttribute('checked') || automixToggle.getAttribute('aria-checked') === 'true')) {
                automixToggle.click();
              }
            } catch (e) {}

            // Authoritative Ad Detection
            const hasAdClass = document.querySelector('.ad-showing') !== null || document.querySelector('.ad-interrupting') !== null;
            const apiAdState = (p && typeof p.getAdState === 'function') ? p.getAdState() : 0;
            const isAdApi = (p && typeof p.isAd === 'function') ? p.isAd() : false;
            const isAd = (apiAdState > 0) || isAdApi || hasAdClass;

            const urlParams = new URLSearchParams(window.location.search);
            const apiVideoData = (p && typeof p.getVideoData === 'function') ? p.getVideoData() : null;
            const apiVideoId = apiVideoData ? apiVideoData.video_id : null;
            const urlVideoId = urlParams.get('v');

            const isTargetVideo = (urlVideoId === '${videoId}') || (apiVideoId === '${videoId}');
            const hasValidDuration = !!v && Number.isFinite(v.duration) && v.duration > 0;
            const isReady = !!v && isTargetVideo && !isAd && hasValidDuration && v.readyState >= 2;

            return {
              ready: isReady,
              isAd: isAd
            };
          } catch(e) {
            return { ready: false, isAd: false };
          }
        })()
      `).catch(() => ({ ready: false, isAd: false }));

      if (res && res.ready && !res.isAd) {
        if (currentReqId === loadRequestId) {
          currentPlayingVideoId = videoId;
          navigationInProgress = false;

          const targetStartTime = typeof startTime === 'number' && startTime > 0 ? startTime : 0;

          // Transition seamlessly from STARTUP_GUARD to PLAYING directly at target volume and position
          await player.webContents.executeJavaScript(`
            (() => {
              try {
                if (typeof window.__owoReleaseStartupGuard === 'function') {
                  window.__owoReleaseStartupGuard(${targetVol}, ${targetStartTime});
                }
              } catch (e) {}
            })()
          `).catch(() => {});

          console.log(`[BgPlayer] Finite startup guard released. Cleanly playing ${videoId} at volume ${targetVol} (startTime=${targetStartTime}s)!`);
          break;
        }
      }
    }

    // Explicit recovery path: If loop completes and this is still the active request,
    // ensure volume and playback are applied cleanly
    if (currentReqId === loadRequestId) {
      currentPlayingVideoId = videoId;
      navigationInProgress = false;
      await player.webContents.executeJavaScript(`
        (() => {
          try {
            if (typeof window.__owoReleaseStartupGuard === 'function') {
              window.__owoReleaseStartupGuard(${targetVol}, ${typeof startTime === 'number' ? startTime : 0});
            } else {
              const v = document.querySelector('video');
              const p = document.getElementById('movie_player');
              if (v) {
                v.muted = false;
                v.volume = ${targetVol};
                if (v.paused) v.play().catch(()=>{});
              }
              if (p) {
                if (typeof p.unMute === 'function') p.unMute();
                if (typeof p.setVolume === 'function') p.setVolume(Math.round(${targetVol} * 100));
                if (typeof p.playVideo === 'function') p.playVideo();
              }
            }
          } catch(e) {}
        })()
      `).catch(() => {});
      console.log(`[BgPlayer] Auto-play setup completed (recovery path) for ${videoId}.`);
    }

    return { success: true };
  } catch (err) {
    console.error('[BgPlayer Error]:', err);
    return { success: false, error: err.message };
  } finally {
    if (currentReqId === loadRequestId) {
      navigationInProgress = false;
    }
  }
});

ipcMain.handle('pause-yt-track', async () => {
  if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return { success: true };
  try {
    await bgPlayerWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__activeFadeTimer) {
          clearInterval(window.__activeFadeTimer);
          window.__activeFadeTimer = null;
        }
        if (window.__activeFadeRaf) {
          cancelAnimationFrame(window.__activeFadeRaf);
          window.__activeFadeRaf = null;
        }
        const v = document.querySelector('video');
        const p = document.getElementById('movie_player');
        if (v) v.pause();
        if (p && typeof p.pauseVideo === 'function') p.pauseVideo();
      })()
    `);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

// Forward background Web Audio FFT stream directly to foreground window
ipcMain.on('bg-audio-fft', (event, buffer) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bg-audio-fft-event', buffer);
  }
});

ipcMain.handle('resume-yt-track', async (event, volume) => {
  if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return { success: true };
  try {
    const target = typeof volume === 'number' ? Math.max(0, Math.min(1, volume)) : null;
    await bgPlayerWindow.webContents.executeJavaScript(`
      (() => {
        try {
          if (window.__activeFadeTimer) {
            clearInterval(window.__activeFadeTimer);
            window.__activeFadeTimer = null;
          }
          if (window.__activeFadeRaf) {
            cancelAnimationFrame(window.__activeFadeRaf);
            window.__activeFadeRaf = null;
          }
          const v = document.querySelector('video');
          const p = document.getElementById('movie_player');
          if (${target !== null}) {
            if (typeof window.__owoSetGainVolume === 'function') {
              window.__owoSetGainVolume(${target});
            } else {
              if (v) v.volume = ${target};
              if (p && typeof p.setVolume === 'function') p.setVolume(Math.round(${target} * 100));
            }
          }
          if (v) v.play().catch(()=>{});
          if (p && typeof p.playVideo === 'function') p.playVideo();
        } catch (e) {}
      })()
    `).catch(() => {});

    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

ipcMain.handle('seek-yt-track', async (event, seconds) => {
  if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return { success: true };
  try {
    await bgPlayerWindow.webContents.executeJavaScript(`
      (() => {
        const v = document.querySelector('video');
        const p = document.getElementById('movie_player');
        if (v) v.currentTime = ${Number(seconds) || 0};
        if (p && p.seekTo) p.seekTo(${Number(seconds) || 0}, true);
      })()
    `);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

ipcMain.handle('set-yt-volume', async (event, volume) => {
  if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return { success: true };
  try {
    const vol = Math.max(0, Math.min(1, Number(volume) || 0));
    await bgPlayerWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__activeFadeTimer) {
          clearInterval(window.__activeFadeTimer);
          window.__activeFadeTimer = null;
        }
        if (window.__activeFadeRaf) {
          cancelAnimationFrame(window.__activeFadeRaf);
          window.__activeFadeRaf = null;
        }
        if (typeof window.__owoSetGainVolume === 'function') {
          window.__owoSetGainVolume(${vol});
        } else {
          const v = document.querySelector('video');
          if (v) v.volume = ${vol};
          const p = document.getElementById('movie_player');
          if (p && p.setVolume) p.setVolume(${Math.round(vol * 100)});
        }
      })()
    `);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

ipcMain.handle('stop-yt-track', async () => {
  requestedVideoId = null;
  currentPlayingVideoId = null;
  navigationInProgress = false;
  endedSignalSentForVideoId = null;
  if (!bgPlayerWindow || bgPlayerWindow.isDestroyed()) return { success: true };
  try {
    await bgPlayerWindow.loadURL('about:blank');
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

// IPC Handlers for Native Windows features
ipcMain.handle('get-proxy-port', () => proxyPort);

ipcMain.handle('extract-stream-url', async (event, videoId) => {
  if (!videoId) return null;
  try {
    const audioInfo = await resolveBestAudioUrl(videoId);
    return audioInfo?.url || null;
  } catch (err) {
    return null;
  }
});

ipcMain.handle('prefetch-stream-urls', async (event, videoIds) => {
  if (!Array.isArray(videoIds) || videoIds.length === 0) return;
  for (const id of videoIds.slice(0, 3)) {
    if (id && !resolvedAudioCache.has(id)) {
      resolveBestAudioUrl(id).catch(() => {});
    }
  }
});

ipcMain.handle('get-default-music-dir', () => {
  return getDefaultMusicDirectory();
});

ipcMain.handle('save-audio-to-disk', async (event, { filename, buffer, targetDir }) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, filename);
    await fs.promises.writeFile(fullPath, Buffer.from(buffer));
    return { success: true, filePath: fullPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
  } else {
    const defaultDir = getDefaultMusicDirectory();
    if (fs.existsSync(defaultDir)) {
      shell.openPath(defaultDir);
    }
  }
});

ipcMain.handle('show-item-in-folder', async (event, fullPath) => {
  if (fullPath && fs.existsSync(fullPath)) {
    shell.showItemInFolder(fullPath);
  }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Music Download Folder',
    defaultPath: getDefaultMusicDirectory()
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-genius-lyrics', async (event, query) => {
  try {
    const pubRes = await fetch(`https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!pubRes.ok) return null;
    const data = await pubRes.json();
    const sections = data?.response?.sections || [];
    const songHit = sections.flatMap(s => s.hits || []).find(h => h.type === 'song' || h.result?._type === 'song');
    if (!songHit?.result?.url) return null;

    const htmlRes = await fetch(songHit.result.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!htmlRes.ok) return null;
    const html = await htmlRes.text();

    const matches = html.match(/data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g);
    if (!matches || matches.length === 0) return null;

    const plainLyrics = matches.map(c => {
      return c
        .replace(/data-lyrics-container="true"[^>]*>/g, '')
        .replace(/<\/div>/g, '')
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/^\d+\s*Contributors.*$/gim, '')
        .trim();
    }).filter(Boolean).join('\n\n');

    return {
      plain: plainLyrics,
      title: songHit.result.title,
      artist: songHit.result.primary_artist?.name,
      url: songHit.result.url,
      thumbnail: songHit.result.song_art_image_thumbnail_url
    };
  } catch (err) {
    console.warn('[Genius IPC Error]:', err.message);
    return null;
  }
});

ipcMain.handle('download-track-native', async (event, { videoId, title, artist, format, targetDir }) => {
  try {
    let audioInfo = await resolveBestAudioUrl(videoId);
    if (!audioInfo || !audioInfo.url) {
      return { success: false, error: 'Could not resolve audio stream' };
    }

    event.sender.send('download-progress-event', { videoId, percent: 10 });

    // 1. Determine total stream size via Range probe
    let totalBytes = audioInfo.totalSize || 0;
    if (!totalBytes) {
      try {
        const probeRes = await fetch(audioInfo.url, {
          headers: {
            ...(audioInfo.headers || {}),
            'Range': 'bytes=0-1024'
          },
          signal: AbortSignal.timeout(3500)
        });
        const cr = probeRes.headers.get('content-range');
        if (cr && cr.includes('/')) {
          totalBytes = parseInt(cr.split('/')[1], 10) || 0;
          audioInfo.totalSize = totalBytes;
        }
      } catch (e) {}
    }

    if (!totalBytes || isNaN(totalBytes)) totalBytes = 3800000;

    // 2. Sequential/Parallel bounded 512KB chunk download
    const CHUNK_SIZE = 512 * 1024;
    const chunks = [];
    let downloadedBytes = 0;

    for (let start = 0; start < totalBytes; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, totalBytes - 1);
      const chunkRange = `bytes=${start}-${end}`;

      let chunkRes;
      try {
        chunkRes = await fetch(audioInfo.url, {
          headers: {
            ...(audioInfo.headers || {}),
            'Range': chunkRange
          },
          signal: AbortSignal.timeout(8000)
        });

        if (!chunkRes.ok && (chunkRes.status === 403 || chunkRes.status === 404)) {
          audioInfo = await resolveBestAudioUrl(videoId, true);
          if (audioInfo?.url) {
            chunkRes = await fetch(audioInfo.url, {
              headers: {
                ...(audioInfo.headers || {}),
                'Range': chunkRange
              },
              signal: AbortSignal.timeout(8000)
            });
          }
        }
      } catch (e) {}

      if (!chunkRes || !chunkRes.ok) {
        throw new Error(`Failed to download audio chunk ${chunkRange}`);
      }

      const buf = await chunkRes.arrayBuffer();
      chunks.push(Buffer.from(buf));
      downloadedBytes += buf.byteLength;

      event.sender.send('download-progress-event', {
        videoId,
        percent: Math.min(99, Math.round((downloadedBytes / totalBytes) * 90) + 10)
      });
    }

    const completeBuffer = Buffer.concat(chunks);

    const cleanArtistStr = (artist || 'Unknown Artist').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitleStr = (title || 'Unknown Track').replace(/[\\/:*?"<>|]/g, '_').trim();
    const ext = format === 'm4a' ? 'm4a' : 'mp3';
    const fileName = `${cleanArtistStr} - ${cleanTitleStr}.${ext}`;

    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, fileName);
    await fs.promises.writeFile(fullPath, completeBuffer);

    event.sender.send('download-progress-event', { videoId, percent: 100 });

    return {
      success: true,
      buffer: completeBuffer.buffer.slice(completeBuffer.byteOffset, completeBuffer.byteOffset + completeBuffer.byteLength),
      mimeType: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
      filePath: fullPath,
      fileName
    };
  } catch (err) {
    console.error('[Native Download Error]:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-audio-from-disk', async (event, { title, artist, targetDir }) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    const cleanArtistStr = (artist || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitleStr = (title || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const files = [
      `${cleanArtistStr} - ${cleanTitleStr}.mp3`,
      `${cleanArtistStr} - ${cleanTitleStr}.m4a`,
      `${cleanArtistStr} - ${cleanTitleStr}.webm`
    ];
    for (const f of files) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        await fs.promises.unlink(p);
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-audio-on-disk', async (event, { title, artist, targetDir }) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) return false;
    const cleanArtistStr = (artist || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
    const cleanTitleStr = (title || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
    const allFiles = (await fs.promises.readdir(dir)).map(f => f.toLowerCase());
    return allFiles.some(f => 
      (f.includes(cleanTitleStr) && f.includes(cleanArtistStr)) ||
      f.startsWith(`${cleanArtistStr} - ${cleanTitleStr}`)
    );
  } catch (e) {
    return false;
  }
});

ipcMain.handle('get-disk-audio-files', async (event, targetDir) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) return [];
    const files = await fs.promises.readdir(dir);
    return files.map(f => f.toLowerCase());
  } catch (e) {
    return [];
  }
});

// ----------------------------------------------------
// LOCAL MUSIC LIBRARY SCANNER & FOLDER MANAGEMENT
// ----------------------------------------------------
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac', '.opus', '.wma', '.m4b']);

function getLocalMusicConfigPath() {
  try {
    return path.join(app.getPath('userData'), 'local_music_folders.json');
  } catch (e) {
    return path.join(__dirname, 'local_music_folders.json');
  }
}

function getSavedLocalMusicFolders() {
  const configFile = getLocalMusicConfigPath();
  const defaultFolders = isPortable
    ? [getDefaultMusicDirectory()]
    : [
        path.join(os.homedir(), 'Music'),
        path.join(os.homedir(), 'Downloads')
      ].filter(p => fs.existsSync(p));

  if (fs.existsSync(configFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (Array.isArray(data)) {
        const combined = Array.from(new Set([...defaultFolders, ...data]))
          .filter(p => fs.existsSync(p) && !p.toLowerCase().endsWith('owo music'));
        return combined;
      }
    } catch (e) {}
  }
  return defaultFolders;
}

function saveLocalMusicFolders(folders) {
  try {
    const configFile = getLocalMusicConfigPath();
    const sanitized = (folders || []).filter(p => !p.toLowerCase().endsWith('owo music'));
    fs.writeFileSync(configFile, JSON.stringify(sanitized, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Local Music Config Save Error]:', e.message);
  }
}

async function scanDirectoryForAudio(dirPath, currentDepth = 0, maxDepth = 3) {
  const results = [];
  if (!dirPath || !fs.existsSync(dirPath) || currentDepth > maxDepth) return results;
  if (dirPath.toLowerCase().endsWith('owo music') || dirPath.toLowerCase().includes('owo music')) return results;

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      if (
        lowerName.startsWith('.') || 
        lowerName.startsWith('$') || 
        lowerName === 'node_modules' || 
        lowerName === 'appdata' || 
        lowerName === 'windows' ||
        lowerName === 'owo music'
      ) {
        continue;
      }
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const sub = await scanDirectoryForAudio(fullPath, currentDepth + 1, maxDepth);
        results.push(...sub);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          try {
            const stat = await fs.promises.stat(fullPath);
            const baseName = path.basename(entry.name, ext);
            let artist = 'Local Artist';
            let title = baseName;

            if (baseName.includes(' - ')) {
              const parts = baseName.split(' - ');
              artist = parts[0].trim() || 'Local Artist';
              title = parts.slice(1).join(' - ').trim() || baseName;
            }

            results.push({
              id: 'local-' + Buffer.from(fullPath).toString('base64'),
              title,
              artist,
              album: path.basename(dirPath) || 'Local Audio',
              duration: 0,
              cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
              filePath: fullPath,
              fileName: entry.name,
              sizeBytes: stat.size,
              addedAt: stat.mtimeMs,
              folder: dirPath,
              ext: ext.replace('.', '').toUpperCase(),
              isLocal: true,
              isOffline: true
            });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  return results;
}

ipcMain.handle('scan-local-music-files', async (event, customDirs) => {
  const folders = Array.isArray(customDirs) && customDirs.length > 0 
    ? customDirs 
    : getSavedLocalMusicFolders();

  const allTracks = [];
  const seenPaths = new Set();

  for (const f of folders) {
    if (fs.existsSync(f)) {
      const scanned = await scanDirectoryForAudio(f, 0, 3);
      for (const t of scanned) {
        if (!seenPaths.has(t.filePath)) {
          seenPaths.add(t.filePath);
          allTracks.push(t);
        }
      }
    }
  }

  // Sort by newest modified first
  allTracks.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return allTracks;
});

ipcMain.handle('get-local-music-folders', async () => {
  return getSavedLocalMusicFolders();
});

ipcMain.handle('add-local-music-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder with Music Files to Scan',
    defaultPath: getDefaultMusicDirectory()
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selected = result.filePaths[0];
    const current = getSavedLocalMusicFolders();
    if (!current.includes(selected)) {
      const updated = [...current, selected];
      saveLocalMusicFolders(updated);
      return { success: true, folder: selected, folders: updated };
    }
    return { success: true, folder: selected, folders: current };
  }
  return { success: false };
});

ipcMain.handle('remove-local-music-folder', async (event, folderPath) => {
  const current = getSavedLocalMusicFolders();
  const updated = current.filter(p => p !== folderPath);
  saveLocalMusicFolders(updated);
  return { success: true, folders: updated };
});

let musicFolderWatcher = null;
function setupMusicFolderWatcher(customDir) {
  try {
    if (musicFolderWatcher) {
      try { musicFolderWatcher.close(); } catch (e) {}
      musicFolderWatcher = null;
    }
    const dir = customDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    if (fs.existsSync(dir)) {
      let debounceTimer = null;
      musicFolderWatcher = fs.watch(dir, (eventType, filename) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('disk-music-folder-changed');
          }
        }, 150);
      });
    }
  } catch (err) {
    console.warn('[Music Folder Watcher Notice]:', err.message);
  }
}

app.whenReady().then(() => {
  // Set up header interception so YouTube Iframe API and media embeds run unrestricted in Electron
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url || '';
    if (url.includes('youtube.com') || url.includes('googlevideo.com') || url.includes('ytimg.com') || url.includes('youtube-nocookie.com')) {
      details.requestHeaders['Origin'] = 'https://www.youtube.com';
      details.requestHeaders['Referer'] = 'https://www.youtube.com/';
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['X-Frame-Options'];
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['Content-Security-Policy'];
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-headers'] = ['*'];
    responseHeaders['access-control-allow-methods'] = ['GET, HEAD, POST, OPTIONS'];
    responseHeaders['access-control-allow-credentials'] = ['true'];
    callback({ cancel: false, responseHeaders });
  });

  startInternalProxyServer();
  setupMusicFolderWatcher();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (musicFolderWatcher) {
    try { musicFolderWatcher.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
