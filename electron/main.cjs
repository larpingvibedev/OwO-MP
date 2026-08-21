const { app, BrowserWindow, ipcMain, shell, dialog, protocol, session, net } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const vm = require('node:vm');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const { FinalPathMutationQueue } = require('./final-path-mutation-queue.cjs');
const { YouTubeRequestDispatcher } = require('./youtube-request-dispatcher.cjs');
const {
  sanitizeStableVideoId,
  appendVideoIdSuffix,
  getAudioFileNames,
  hasAudioFile,
  shouldDeleteLegacyAudio
} = require('./audio-file-ownership.cjs');
const { deriveDirectStreamIdentity, decideDirectStreamRefresh } = require('./direct-stream-identity.cjs');
const {
  createResolverContext,
  throwIfResolverExpired,
  getResolverFetchSignal,
  awaitResolverStep,
  normalizeResolverError
} = require('./resolver-deadline.cjs');
let mm = null;
try { mm = require('music-metadata'); } catch (e) {}

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
// A video can legitimately have more than one request in flight (for example a
// retry beginning before the first request has unwound). Keep request ownership
// separate so one completion can never delete or abort another request.
const activeDownloads = new Map(); // videoId -> Map<requestId, AbortController>
let nextDownloadRequestId = 1;
const finalPathMutationQueue = new FinalPathMutationQueue();
// The authenticated extractor uses one shared Electron session and one webRequest
// listener. Electron replaces a session listener when another is registered, so
// extractor work must be serialized to keep each track's bytes isolated.
let browserDownloadTail = Promise.resolve();

function runBrowserDownloadExclusive(task) {
  const run = browserDownloadTail.then(task, task);
  browserDownloadTail = run.catch(() => {});
  return run;
}

function registerActiveDownload(videoId) {
  const requestId = nextDownloadRequestId++;
  const controller = new AbortController();
  let requests = activeDownloads.get(videoId);
  if (!requests) {
    requests = new Map();
    activeDownloads.set(videoId, requests);
  }
  requests.set(requestId, controller);
  return { requestId, controller };
}

function unregisterActiveDownload(videoId, requestId) {
  const requests = activeDownloads.get(videoId);
  if (!requests) return;
  requests.delete(requestId);
  if (requests.size === 0 && activeDownloads.get(videoId) === requests) {
    activeDownloads.delete(videoId);
  }
}

function cancelActiveDownloads(videoId) {
  const requests = activeDownloads.get(videoId);
  if (!requests || requests.size === 0) return 0;

  // Snapshot ownership at cancellation time. Requests registered later are not
  // accidentally cancelled, and each cancelled request removes only itself.
  const controllers = Array.from(requests.values());
  for (const controller of controllers) {
    try { controller.abort(); } catch {}
  }
  return controllers.length;
}

function runFinalPathExclusive(finalPath, task) {
  return finalPathMutationQueue.run(finalPath, task);
}

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

async function resolveBestAudioUrl(videoId, forceFresh = false, options = {}) {
  if (!videoId) return null;
  const resolverContext = createResolverContext(options);
  throwIfResolverExpired(resolverContext);

  // 1. Check Cache with Dynamic Expiration Validation
  if (forceFresh) {
    resolvedAudioCache.delete(videoId);
  } else {
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
    const yt = await awaitResolverStep(getInnertube(), resolverContext, 'Innertube initialization');
    if (yt) {
      for (const clientName of ['YTMUSIC', 'MWEB', 'IOS', 'ANDROID', 'WEB']) {
        throwIfResolverExpired(resolverContext, `${clientName} stream resolution`);
        try {
          const info = await awaitResolverStep(
            yt.getBasicInfo(videoId, { client: clientName }),
            resolverContext,
            `${clientName} video info`
          );
          const format = info.chooseFormat({ type: 'audio', quality: 'best' });
          if (format) {
            const deciphered = await awaitResolverStep(
              format.decipher(yt.session.player),
              resolverContext,
              `${clientName} stream decipher`
            );
            const streamUrl = typeof deciphered === 'string' ? deciphered : (deciphered?.toString?.() || '');
            if (streamUrl && streamUrl.startsWith('http')) {
              let expireTimestamp = null;
              try {
                const u = new URL(streamUrl);
                const exp = u.searchParams.get('expire');
                if (exp) expireTimestamp = parseInt(exp, 10);
              } catch (e) {}

              const totalSize = Number(format.content_length || format.raw_data?.contentLength || 0);

              let clientHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
              };

              if (clientName === 'IOS') {
                clientHeaders = {
                  'User-Agent': 'com.google.ios.youtube/19.43.2 (iPhone14,3; U; CPU iOS 18_1 like Mac OS X; en_US)'
                };
              } else if (clientName === 'YTMUSIC') {
                clientHeaders = {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                  'Referer': 'https://music.youtube.com/',
                  'Origin': 'https://music.youtube.com'
                };
              } else if (clientName === 'WEB' || clientName === 'MWEB') {
                clientHeaders = {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                  'Referer': 'https://www.youtube.com/',
                  'Origin': 'https://www.youtube.com'
                };
              }

              const audioInfo = {
                url: streamUrl,
                mimeType: format.mime_type || 'audio/mp4',
                bitrate: format.bitrate,
                totalSize,
                clientName,
                resolverSessionScope: 'innertube-process',
                headers: clientHeaders
              };

              resolvedAudioCache.set(videoId, { audioInfo, time: Date.now(), expireTimestamp });
              return audioInfo;
            }
          }
        } catch (clientErr) {
          const normalized = normalizeResolverError(clientErr, resolverContext, `${clientName} stream resolution`);
          if (normalized?.stage === 'DOWNLOAD_CANCELLED' || normalized?.stage === 'DIRECT_RANGE_RESOLVE_TIMEOUT') {
            throw normalized;
          }
          // Continue to next client
        }
      }
    }
  } catch (err) {
    const normalized = normalizeResolverError(err, resolverContext, 'Innertube stream resolution');
    if (normalized?.stage === 'DOWNLOAD_CANCELLED' || normalized?.stage === 'DIRECT_RANGE_RESOLVE_TIMEOUT') {
      throw normalized;
    }
    console.warn('[resolveBestAudioUrl] Innertube error:', err.message);
  }

  // 3. Fallback: Direct Native Android_VR Innertube Client with visitor session
  let activeSession = await awaitResolverStep(
    getVisitorSession(),
    resolverContext,
    'Visitor session resolution'
  );
  const fallbackClients = [
    { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceModel: 'Quest 3', hl: 'en', gl: 'US' },
    { clientName: 'ANDROID', clientVersion: '19.29.35', hl: 'en', gl: 'US' }
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const c of fallbackClients) {
      try {
        const playerRes = await awaitResolverStep(fetch('https://www.youtube.com/youtubei/v1/player', {
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
          signal: getResolverFetchSignal(resolverContext)
        }), resolverContext, `${c.clientName} player request`);

        if (playerRes.ok) {
          const data = await awaitResolverStep(
            playerRes.json(),
            resolverContext,
            `${c.clientName} player response`
          );
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
              resolverSessionScope: `visitor-${activeSession?.time || 'ephemeral'}`,
              headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                ...(activeSession?.cookie ? { 'Cookie': activeSession.cookie } : {})
              }
            };
            resolvedAudioCache.set(videoId, { audioInfo, time: Date.now() });
            return audioInfo;
          }
        }
      } catch (error) {
        const normalized = normalizeResolverError(error, resolverContext, `${c.clientName} player request`);
        if (normalized?.stage === 'DOWNLOAD_CANCELLED' || normalized?.stage === 'DIRECT_RANGE_RESOLVE_TIMEOUT') {
          throw normalized;
        }
      }
    }

    if (attempt === 0) {
      activeSession = await awaitResolverStep(
        getVisitorSession(true),
        resolverContext,
        'Visitor session refresh'
      );
    }
  }

  throwIfResolverExpired(resolverContext);
  return null;
}

const DIRECT_DOWNLOAD_CHUNK_SIZE = 1024 * 1024;
const DIRECT_RANGE_CEILING_CACHE_TTL_MS = 10 * 60 * 1000;
const DIRECT_RANGE_FETCH_TIMEOUT_MS = 12000;
const BROWSER_CAPTURE_FETCH_TIMEOUT_MS = 10000;
const BROWSER_GAP_FETCH_TIMEOUT_MS = 12000;
const directRangeCeilingCache = new Map(); // resolver client/host/session scope -> confirmation

function getDirectRangeScope(audioInfo) {
  if (!audioInfo?.url) return null;
  try {
    const streamUrl = new URL(audioInfo.url);
    const client = String(audioInfo.clientName || 'unknown').toLowerCase();
    const host = streamUrl.hostname.toLowerCase();
    const urlClient = String(streamUrl.searchParams.get('c') || 'none').toLowerCase();
    const sessionScope = String(audioInfo.resolverSessionScope || 'process');
    return `${client}|${host}|${urlClient}|${sessionScope}`;
  } catch {
    return null;
  }
}

function getActiveDirectRangeCeiling(scopeKey) {
  if (!scopeKey) return null;
  const cached = directRangeCeilingCache.get(scopeKey);
  if (!cached) return null;
  if (Date.now() - cached.confirmedAt >= DIRECT_RANGE_CEILING_CACHE_TTL_MS) {
    directRangeCeilingCache.delete(scopeKey);
    return null;
  }
  return cached;
}

function parseContentRangeHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) return null;
  if (start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}

function getDownloadStage(error, fallbackStage) {
  if (error && typeof error.stage === 'string' && error.stage) return error.stage;
  const message = error && typeof error.message === 'string' ? error.message : '';
  const match = /^\[([A-Z0-9_]+)\]/.exec(message);
  return match ? match[1] : fallbackStage;
}

function createDownloadStageError(stage, message) {
  const error = new Error(`[${stage}] ${message}`);
  error.stage = stage;
  return error;
}

function createBoundedFetchContext(callerSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    callerSignal,
    timeoutSignal,
    signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  };
}

function getBoundedFetchAbortError(context, timeoutStage, description) {
  if (context?.callerSignal?.aborted) {
    return createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
  }
  if (context?.timeoutSignal?.aborted) {
    return createDownloadStageError(timeoutStage, `${description} timed out`);
  }
  return null;
}

function throwIfBoundedFetchAborted(context, timeoutStage, description) {
  const error = getBoundedFetchAbortError(context, timeoutStage, description);
  if (error) throw error;
}

async function readValidatedRangeBody(response, expectedLength, fetchContext, timeoutStage, description) {
  if (!response.body) {
    throw createDownloadStageError('DIRECT_RANGE_EMPTY_BODY', 'Range response did not contain a body');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  try {
    while (true) {
      if (fetchContext?.signal?.aborted) {
        try { await reader.cancel(); } catch {}
        throwIfBoundedFetchAborted(fetchContext, timeoutStage, description);
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      received += value.length;
      if (received > expectedLength) {
        try { await reader.cancel(); } catch {}
        throw createDownloadStageError(
          'DIRECT_RANGE_LENGTH_MISMATCH',
          `Range body exceeded its declared length (${received}/${expectedLength} bytes)`
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    const boundedError = getBoundedFetchAbortError(fetchContext, timeoutStage, description);
    if (boundedError) throw boundedError;
    throw error;
  }

  if (received !== expectedLength) {
    throw createDownloadStageError(
      'DIRECT_RANGE_LENGTH_MISMATCH',
      `Range body length did not match Content-Range (${received}/${expectedLength} bytes)`
    );
  }

  return Buffer.concat(chunks, received);
}

async function writeBufferAtPosition(fileHandle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await fileHandle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset
    );
    if (!bytesWritten) {
      throw createDownloadStageError(
        'DIRECT_RANGE_DISK_WRITE',
        `Disk write stopped after ${offset}/${buffer.length} bytes`
      );
    }
    offset += bytesWritten;
  }
}

// Downloads one exact video stream using explicit byte ranges. Every response is
// validated before it is written, so expired URLs, HTML error bodies, missing
// chunks, and overlapping/out-of-order ranges can never be accepted as audio.
async function downloadTrackViaValidatedRanges(videoId, tempPath, onProgress, abortSignal = null) {
  if (!videoId) {
    return { success: false, stage: 'DIRECT_RANGE_RESOLVE', error: '[DIRECT_RANGE_RESOLVE] Missing videoId' };
  }

  let fileHandle = null;
  let audioInfo = null;
  let expectedTotal = 0;
  let downloadedBytes = 0;
  let streamIdentity = null;
  let streamRestartCount = 0;
  const attempts = [];

  try {
    audioInfo = await resolveBestAudioUrl(videoId, false, { signal: abortSignal, timeoutMs: 15000 });
    if (!audioInfo || !audioInfo.url) {
      throw createDownloadStageError('DIRECT_RANGE_RESOLVE', `Could not resolve an audio stream for ${videoId}`);
    }

    const directRangeScope = getDirectRangeScope(audioInfo);
    const cachedCeiling = getActiveDirectRangeCeiling(directRangeScope);
    if (cachedCeiling) {
      const ageMs = Date.now() - cachedCeiling.confirmedAt;
      console.log(
        `[Download] Skipping direct range probe for ${videoId}; resolver scope ${cachedCeiling.scopeLabel} confirmed a ${cachedCeiling.ceilingBytes}-byte ceiling ${ageMs}ms ago.`
      );
      return {
        success: false,
        stage: 'DIRECT_RANGE_CEILING_CACHED',
        error: `[DIRECT_RANGE_CEILING_CACHED] Resolver scope is temporarily capped at ${cachedCeiling.ceilingBytes} bytes`,
        diagnostics: [{
          cacheHit: true,
          scope: cachedCeiling.scopeLabel,
          ceilingBytes: cachedCeiling.ceilingBytes,
          confirmedAt: cachedCeiling.confirmedAt,
          expiresInMs: Math.max(0, DIRECT_RANGE_CEILING_CACHE_TTL_MS - ageMs)
        }]
      };
    }

    fileHandle = await fs.promises.open(tempPath, 'w');

    while (!expectedTotal || downloadedBytes < expectedTotal) {
      if (abortSignal && abortSignal.aborted) {
        throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
      }

      const start = downloadedBytes;
      const requestedEnd = expectedTotal
        ? Math.min(expectedTotal - 1, start + DIRECT_DOWNLOAD_CHUNK_SIZE - 1)
        : start + DIRECT_DOWNLOAD_CHUNK_SIZE - 1;
      const range = `bytes=${start}-${requestedEnd}`;
      let rangeResult = null;
      let lastError = null;
      let restartRequested = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (abortSignal && abortSignal.aborted) {
          throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
        }

        try {
          const fetchContext = createBoundedFetchContext(abortSignal, DIRECT_RANGE_FETCH_TIMEOUT_MS);
          let response;
          try {
            response = await fetch(audioInfo.url, {
              headers: {
                ...(audioInfo.headers || {}),
                'Accept-Encoding': 'identity',
                'Range': range
              },
              signal: fetchContext.signal
            });
          } catch (error) {
            const boundedError = getBoundedFetchAbortError(
              fetchContext,
              'DIRECT_RANGE_TIMEOUT',
              `Direct range ${range}`
            );
            attempts.push({
              range,
              attempt: attempt + 1,
              client: audioInfo.clientName || 'unknown',
              scope: getDirectRangeScope(audioInfo),
              status: null,
              contentRange: null,
              stage: getDownloadStage(boundedError || error, 'DIRECT_RANGE_FETCH')
            });
            throw boundedError || error;
          }
          const contentRangeValue = response.headers.get('content-range');
          attempts.push({
            range,
            attempt: attempt + 1,
            client: audioInfo.clientName || 'unknown',
            scope: getDirectRangeScope(audioInfo),
            status: response.status,
            contentRange: contentRangeValue || null
          });

          if (response.status !== 206) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_HTTP_STATUS',
              `${range} returned HTTP ${response.status} ${response.statusText || ''}`.trim()
            );
          }

          const contentRange = parseContentRangeHeader(contentRangeValue);
          if (!contentRange) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_INVALID_HEADER',
              `${range} returned invalid Content-Range "${contentRangeValue || ''}"`
            );
          }
          if (contentRange.start !== start || contentRange.end > requestedEnd) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_BOUNDARY_MISMATCH',
              `${range} returned bytes ${contentRange.start}-${contentRange.end}`
            );
          }
          if (contentRange.end < requestedEnd && contentRange.end !== contentRange.total - 1) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_BOUNDARY_MISMATCH',
              `${range} ended early at byte ${contentRange.end} of ${contentRange.total}`
            );
          }
          if (expectedTotal && contentRange.total !== expectedTotal) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_STREAM_CHANGED',
              `Resolved stream size changed from ${expectedTotal} to ${contentRange.total} bytes`
            );
          }

          const responseIdentity = deriveDirectStreamIdentity(audioInfo, contentRange.total);
          if (!responseIdentity) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError('DIRECT_RANGE_IDENTITY_MISSING', `${range} did not expose a stable stream identity`);
          }
          if (streamIdentity && responseIdentity !== streamIdentity) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError('DIRECT_RANGE_STREAM_CHANGED', `${range} changed stream identity`);
          }
          if (!streamIdentity) streamIdentity = responseIdentity;

          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('text/html') || contentType.includes('application/json')) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_INVALID_CONTENT',
              `${range} returned non-audio content type ${contentType}`
            );
          }

          const expectedLength = contentRange.end - contentRange.start + 1;
          const declaredLength = Number(response.headers.get('content-length') || 0);
          if (declaredLength > 0 && declaredLength !== expectedLength) {
            try { if (response.body) await response.body.cancel(); } catch {}
            throw createDownloadStageError(
              'DIRECT_RANGE_LENGTH_MISMATCH',
              `${range} declared ${declaredLength} bytes but Content-Range described ${expectedLength}`
            );
          }

          const buffer = await readValidatedRangeBody(
            response,
            expectedLength,
            fetchContext,
            'DIRECT_RANGE_TIMEOUT',
            `Direct range ${range}`
          );
          rangeResult = { contentRange, buffer };
          break;
        } catch (error) {
          if (abortSignal && abortSignal.aborted) {
            throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
          }

          lastError = error;
          const latestAttempt = attempts[attempts.length - 1];
          if (latestAttempt?.range === range && latestAttempt?.attempt === attempt + 1 && !latestAttempt.stage) {
            latestAttempt.stage = getDownloadStage(error, 'DIRECT_RANGE_FETCH');
          }
          if (attempt === 0) {
            const refreshedAudioInfo = await resolveBestAudioUrl(videoId, true, { signal: abortSignal, timeoutMs: 15000 });
            if (!refreshedAudioInfo || !refreshedAudioInfo.url) {
              throw createDownloadStageError(
                'DIRECT_RANGE_RESOLVE',
                `Could not refresh the audio stream after ${range} failed: ${error.message}`
              );
            }
            if (downloadedBytes > 0 && streamIdentity) {
              const refreshedIdentity = deriveDirectStreamIdentity(refreshedAudioInfo, expectedTotal);
              const refreshAction = decideDirectStreamRefresh(
                streamIdentity,
                refreshedIdentity,
                downloadedBytes,
                streamRestartCount
              );
              if (refreshAction === 'fail') {
                  throw createDownloadStageError(
                    'DIRECT_RANGE_STREAM_CHANGED',
                    `Refreshed stream identity changed after ${downloadedBytes} bytes and restart limit was exhausted`
                  );
              }
              if (refreshAction === 'restart') {
                streamRestartCount++;
                await fileHandle.truncate(0);
                downloadedBytes = 0;
                expectedTotal = 0;
                streamIdentity = null;
                audioInfo = refreshedAudioInfo;
                attempts.push({ range, stage: 'DIRECT_RANGE_IDENTITY_RESTART', restart: streamRestartCount });
                restartRequested = true;
                break;
              }
            }
            audioInfo = refreshedAudioInfo;
          }
        }
      }

      if (restartRequested) continue;

      if (!rangeResult) {
        const prefixRange = `bytes=0-${DIRECT_DOWNLOAD_CHUNK_SIZE - 1}`;
        const boundaryAttempts = attempts.filter(item => item.range === range);
        const boundaryScope = boundaryAttempts[0]?.scope || null;
        const validatedPrefix = attempts.some(item =>
          item.range === prefixRange &&
          item.scope === boundaryScope &&
          item.status === 206 &&
          item.contentRange?.startsWith(`bytes 0-${DIRECT_DOWNLOAD_CHUNK_SIZE - 1}/`)
        );
        const confirmedCeiling =
          Boolean(boundaryScope) &&
          start === DIRECT_DOWNLOAD_CHUNK_SIZE &&
          downloadedBytes === DIRECT_DOWNLOAD_CHUNK_SIZE &&
          validatedPrefix &&
          boundaryAttempts.length >= 2 &&
          boundaryAttempts.every(item => item.status === 403 && item.scope === boundaryScope);

        if (confirmedCeiling) {
          const [client, host, urlClient, sessionScope] = boundaryScope.split('|');
          const scopeLabel = `${client}/${host}/${urlClient}/${sessionScope}`;
          directRangeCeilingCache.set(boundaryScope, {
            ceilingBytes: DIRECT_DOWNLOAD_CHUNK_SIZE,
            confirmedAt: Date.now(),
            scopeLabel
          });
          console.warn(
            `[Download] Confirmed resolver range ceiling at ${DIRECT_DOWNLOAD_CHUNK_SIZE} bytes for ${scopeLabel}; bypassing matching-scope probes for ${DIRECT_RANGE_CEILING_CACHE_TTL_MS}ms.`
          );
        }
        throw lastError || createDownloadStageError('DIRECT_RANGE_FETCH', `${range} could not be downloaded`);
      }

      if (!expectedTotal) expectedTotal = rangeResult.contentRange.total;
      await writeBufferAtPosition(fileHandle, rangeResult.buffer, rangeResult.contentRange.start);

      downloadedBytes = rangeResult.contentRange.end + 1;
      if (typeof onProgress === 'function') {
        onProgress({
          videoId,
          percent: Math.min(95, 10 + Math.round((downloadedBytes / expectedTotal) * 85)),
          downloadedBytes,
          totalBytes: expectedTotal
        });
      }
    }

    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;

    const stat = await fs.promises.stat(tempPath);
    if (stat.size !== expectedTotal || downloadedBytes !== expectedTotal) {
      throw createDownloadStageError(
        'DIRECT_RANGE_FINAL_SIZE_MISMATCH',
        `Validated ${downloadedBytes}/${expectedTotal} bytes but temporary file size is ${stat.size}`
      );
    }

    return {
      success: true,
      stage: 'DIRECT_RANGE_COMPLETE',
      totalLength: expectedTotal,
      mimeType: audioInfo.mimeType || 'audio/mp4',
      diagnostics: { client: audioInfo.clientName || 'unknown', ranges: attempts.length }
    };
  } catch (error) {
    if (fileHandle) {
      try { await fileHandle.close(); } catch {}
      fileHandle = null;
    }
    try { await fs.promises.unlink(tempPath); } catch {}

    const stage = getDownloadStage(error, 'DIRECT_RANGE_FETCH');
    return {
      success: false,
      stage,
      error: error && error.message ? error.message : `[${stage}] Direct ranged audio acquisition failed`,
      diagnostics: attempts.slice(-4)
    };
  }
}

function getFfmpegPath() {
  try {
    let p = require('ffmpeg-static');
    if (app.isPackaged && typeof p === 'string') {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return null;
}

function getHighResolutionCoverCandidates(coverUrl) {
  if (!coverUrl || typeof coverUrl !== 'string' || !coverUrl.startsWith('http')) return [];

  const original = coverUrl.trim();
  let upgraded = original;

  try {
    const parsed = new URL(original);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('googleusercontent.com') || host.includes('ggpht.com')) {
      if (/=[^=]+$/.test(upgraded)) {
        upgraded = upgraded.replace(/=[^=]+$/, '=w1200-h1200-l90-rj');
      } else {
        upgraded = `${upgraded}=w1200-h1200-l90-rj`;
      }
    } else if (host.includes('mzstatic.com')) {
      upgraded = upgraded.replace(/\d+x\d+bb(?:-\d+)?/i, '1200x1200bb');
    } else if (host.includes('i.ytimg.com') || host.includes('img.youtube.com')) {
      upgraded = upgraded
        .replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(?:jpg|webp)(?:\?.*)?$/i, '/maxresdefault.jpg')
        .replace(/\?.*$/, '');
    } else if (host.includes('unsplash.com')) {
      parsed.searchParams.set('w', '1200');
      parsed.searchParams.set('q', '92');
      upgraded = parsed.toString();
    }
  } catch {}

  return Array.from(new Set([upgraded, original]));
}

// Transcode raw stream and embed ID3 tags / album art via FFmpeg
async function transcodeAndTagAudio({ inputPath, outputPath, format, title, artist, album, coverUrl, abortSignal }) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    console.warn('[FFmpeg] ffmpeg binary not found, copying raw stream directly to destination');
    await fs.promises.copyFile(inputPath, outputPath);
    return;
  }

  let tempCoverPath = null;
  const isMp3 = format === 'mp3';
  const isM4a = format === 'm4a';

  try {
    const coverCandidates = getHighResolutionCoverCandidates(coverUrl);
    for (const candidate of coverCandidates) {
      try {
        const coverRes = await net.fetch(candidate, { signal: abortSignal });
        if (!coverRes.ok) continue;

        const coverBuf = Buffer.from(await coverRes.arrayBuffer());
        if (coverBuf.length > 0) {
          tempCoverPath = path.join(path.dirname(outputPath), `.cover_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
          await fs.promises.writeFile(tempCoverPath, coverBuf);
          break;
        }
      } catch (e) {
        if (abortSignal && abortSignal.aborted) throw e;
        console.warn('[Cover Art Download Warning]:', e.message);
      }
    }

    const args = ['-y', '-threads', '0', '-i', inputPath];

    if (tempCoverPath && fs.existsSync(tempCoverPath)) {
      args.push('-i', tempCoverPath);
      args.push('-map', '0:a', '-map', '1:0');
    } else {
      args.push('-map', '0:a');
    }

    if (isMp3) {
      args.push('-c:a', 'libmp3lame', '-b:a', '256k', '-f', 'mp3');
      if (tempCoverPath && fs.existsSync(tempCoverPath)) {
        args.push('-c:v', 'copy', '-id3v2_version', '3');
        args.push('-metadata:s:v', 'title="Album cover"');
        args.push('-metadata:s:v', 'comment="Cover (front)"');
      }
    } else if (isM4a) {
      args.push('-c:a', 'aac', '-b:a', '256k', '-f', 'mp4');
      if (tempCoverPath && fs.existsSync(tempCoverPath)) {
        args.push('-c:v', 'copy', '-disposition:v:0', 'attached_pic');
      }
    } else {
      args.push('-c:a', 'copy');
    }

    if (title) args.push('-metadata', `title=${title}`);
    if (artist) args.push('-metadata', `artist=${artist}`);
    if (album) args.push('-metadata', `album=${album}`);

    args.push(outputPath);

    await new Promise((resolve, reject) => {
      const proc = execFile(ffmpeg, args, (err, stdout, stderr) => {
        if (err) {
          if (abortSignal && abortSignal.aborted) {
            return reject(new Error('Download cancelled'));
          }
          console.warn('[FFmpeg Process Error]:', err.message, stderr);
          return reject(err);
        }
        resolve();
      });

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          try { proc.kill('SIGKILL'); } catch (e) {}
        });
      }
    });
  } finally {
    if (tempCoverPath && fs.existsSync(tempCoverPath)) {
      await fs.promises.unlink(tempCoverPath).catch(() => {});
    }
  }
}

// Verifies continuous byte-range coverage from byte 0 up to targetClen
function checkByteCoverage(bucket, targetClen) {
  if (!targetClen || !bucket || bucket.size === 0) return { complete: false, coveredUntil: 0, totalBytes: 0 };
  const sortedStarts = Array.from(bucket.keys()).sort((a, b) => a - b);
  let coveredUntil = 0;
  let totalBytes = 0;

  for (const start of sortedStarts) {
    const item = bucket.get(start);
    totalBytes += item.buffer.length;
    if (start <= coveredUntil + 1) {
      if (item.end > coveredUntil) {
        coveredUntil = item.end;
      }
    }
  }

  // Complete only with exact continuous coverage through the final byte.
  const complete = bucket.has(0) && coveredUntil >= targetClen - 1;
  return { complete, coveredUntil, totalBytes };
}

function getByteCoverageGaps(bucket, targetClen) {
  if (!bucket || !targetClen) return [];
  const intervals = Array.from(bucket.entries())
    .map(([start, item]) => ({ start, end: item.end }))
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;

  for (const interval of intervals) {
    if (interval.end < cursor) continue;
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start - 1 });
    cursor = Math.max(cursor, interval.end + 1);
    if (cursor >= targetClen) break;
  }
  if (cursor < targetClen) gaps.push({ start: cursor, end: targetClen - 1 });
  return gaps;
}

function parseBrowserAudioRangeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const clen = Number(url.searchParams.get('clen'));
    const rangeValue = url.searchParams.get('range') || '';
    const rangeMatch = /^(\d+)-(\d+)$/.exec(rangeValue);
    const mime = String(url.searchParams.get('mime') || '').split(';')[0].trim().toLowerCase();
    const itag = url.searchParams.get('itag') || '';
    const streamId = url.searchParams.get('id') || '';

    if (!Number.isSafeInteger(clen) || clen <= 1000000 || !rangeMatch) return null;
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || end < start || end >= clen) return null;
    if (!mime.startsWith('audio/') || !/^\d+$/.test(itag) || !streamId) return null;

    // The signed Google media id + itag + declared length/mime is the strongest
    // stable identity exposed by query-range HTTP 200 responses. CDN host and
    // signature may change across redirects, so they are intentionally excluded.
    const identity = `${streamId}|${itag}|${clen}|${mime}`;
    return { url, clen, start, end, mime, identity };
  } catch {
    return null;
  }
}

// Browser-Assisted YouTube Authenticated Stream Downloader (persist:youtube)
async function downloadTrackViaBrowserBuffer(videoId, tempPath, onProgress, abortSignal = null) {
  if (!videoId) return { success: false, error: 'Missing videoId' };
  const s = session.fromPartition('persist:youtube');

  const streamBuckets = new Map(); // clen -> Map<start, { end, buffer }>
  let mimeType = 'audio/webm';
  let observedAudioRequests = 0;
  let preReadinessAudioRequests = 0;
  let rejectedAudioRanges = 0;
  let capturedRangeTimeouts = 0;
  let queryRangeResponsesWithoutContentRange = 0;
  let synthesizedGapRanges = 0;
  let targetSongClen = 0;
  let targetStreamIdentity = null;
  let validatedStreamTemplateUrl = null;
  let maxValidatedNaturalRangeLength = 0;
  let maxEmittedPercent = 5;
  const pendingFetches = new Set();
  const pendingRangeKeys = new Set();
  const eligibleRequestIds = new Set();
  let win = null;
  let removeBeforeRequestObserver = null;
  let exactTrackReady = false;
  let captureGeneration = 0;
  const startTime = Date.now();

  const emitProgress = (computedPercent, downloadedBytes, totalBytes) => {
    maxEmittedPercent = Math.max(maxEmittedPercent, Math.min(99, Math.round(computedPercent)));
    if (typeof onProgress === 'function') {
      onProgress({
        videoId,
        percent: maxEmittedPercent,
        downloadedBytes,
        totalBytes
      });
    }
  };

  try {
    win = new BrowserWindow({
      show: false,
      width: 600,
      height: 400,
      webPreferences: {
        session: s,
        nodeIntegration: false,
        contextIsolation: true,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });

    // Enforce Chromium-level hardware mute for the entire lifespan of this extractor window
    win.webContents.setAudioMuted(true);

    const userAgent = win.webContents.userAgent;

    const requestFilter = { urls: ['*://*.googlevideo.com/videoplayback*'] };
    const beforeRequestObserver = (details) => {
      const belongsToExtractor = win && !win.isDestroyed() && details.webContentsId === win.webContents.id;
      const isAudioRequest = details.url.includes('videoplayback') && details.url.includes('mime=audio');
      if (belongsToExtractor && isAudioRequest) {
        observedAudioRequests++;
        if (exactTrackReady) {
          eligibleRequestIds.add(details.id);
        } else {
          preReadinessAudioRequests++;
        }
      }
    };

    const responseListener = (details) => {
      // The persist:youtube session is also used elsewhere in the app. Only
      // collect requests initiated by this extractor window after exact-video
      // readiness. A pre-readiness request whose response arrives later is not
      // eligible because its request id was never admitted above.
      if (!win || win.isDestroyed() || details.webContentsId !== win.webContents.id) return;
      if (
        details.url.includes('videoplayback') &&
        details.url.includes('mime=audio') &&
        (details.statusCode === 200 || details.statusCode === 206)
      ) {
        if (!exactTrackReady || !eligibleRequestIds.has(details.id)) return;
        eligibleRequestIds.delete(details.id);

        const parsed = parseBrowserAudioRangeUrl(details.url);
        if (!parsed) {
          rejectedAudioRanges++;
          return;
        }

        const { url: u, clen, start, end, mime, identity } = parsed;
        if (!targetStreamIdentity) {
          targetStreamIdentity = identity;
          targetSongClen = clen;
          mimeType = mime;
        } else if (identity !== targetStreamIdentity || clen !== targetSongClen || mime !== mimeType) {
          rejectedAudioRanges++;
          return;
        }

        // Strip UMP wrapping so YouTube delivers pristine WebM/MP4 media chunks starting with valid headers
        u.searchParams.delete('ump');
        u.searchParams.delete('srfvp');
        const cleanFetchUrl = u.toString();

        if (!streamBuckets.has(clen)) streamBuckets.set(clen, new Map());
        const bucket = streamBuckets.get(clen);
        const rangeKey = `${identity}|${start}`;
        if (!bucket.has(start) && !pendingRangeKeys.has(rangeKey)) {
          const requestGeneration = captureGeneration;
          pendingRangeKeys.add(rangeKey);
          const fetchP = (async () => {
            if (abortSignal && abortSignal.aborted) return;
            const fetchContext = createBoundedFetchContext(abortSignal, BROWSER_CAPTURE_FETCH_TIMEOUT_MS);
            try {
              const res = await net.fetch(cleanFetchUrl, {
                headers: {
                  'Accept-Encoding': 'identity',
                  'User-Agent': userAgent,
                  'Referer': 'https://music.youtube.com/'
                },
                signal: fetchContext.signal
              });
              if (res.status !== 200 && res.status !== 206) {
                rejectedAudioRanges++;
                return;
              }

              const responseType = String(res.headers.get('content-type') || '')
                .split(';')[0]
                .trim()
                .toLowerCase();
              if (!responseType.startsWith('audio/') && responseType !== 'application/octet-stream') {
                rejectedAudioRanges++;
                return;
              }

              const responseUrl = res.url ? parseBrowserAudioRangeUrl(res.url) : parsed;
              if (!responseUrl || responseUrl.identity !== identity || responseUrl.start !== start || responseUrl.end !== end) {
                rejectedAudioRanges++;
                return;
              }

              const expectedLength = end - start + 1;
              const contentRangeValue = res.headers.get('content-range');
              const responseRange = parseContentRangeHeader(contentRangeValue);
              if (contentRangeValue) {
                if (
                  !responseRange ||
                  responseRange.start !== start ||
                  responseRange.end !== end ||
                  responseRange.total !== clen
                ) {
                  rejectedAudioRanges++;
                  return;
                }
              } else if (res.status === 206) {
                rejectedAudioRanges++;
                return;
              } else {
                // Google query-range responses normally use HTTP 200 without a
                // Content-Range header. In that case the signed query bounds,
                // response URL identity, declared length, and exact body length
                // collectively bind the bytes.
                queryRangeResponsesWithoutContentRange++;
              }

              const declaredLength = Number(res.headers.get('content-length') || 0);
              if (declaredLength > 0 && declaredLength !== expectedLength) {
                rejectedAudioRanges++;
                return;
              }

              const ab = await res.arrayBuffer();
              throwIfBoundedFetchAborted(
                fetchContext,
                'BROWSER_CAPTURE_RANGE_TIMEOUT',
                `Captured range ${start}-${end}`
              );
              const buffer = Buffer.from(ab);
              if (
                !exactTrackReady ||
                requestGeneration !== captureGeneration ||
                identity !== targetStreamIdentity ||
                buffer.length !== expectedLength
              ) {
                rejectedAudioRanges++;
                return;
              }
              bucket.set(start, { end, buffer });
              validatedStreamTemplateUrl = cleanFetchUrl;
              maxValidatedNaturalRangeLength = Math.max(maxValidatedNaturalRangeLength, expectedLength);

              const cov = checkByteCoverage(bucket, targetSongClen);
              const pct = Math.min(90, 5 + Math.round((cov.totalBytes / targetSongClen) * 85));
              emitProgress(pct, cov.totalBytes, targetSongClen);
            } catch (error) {
              if (abortSignal && abortSignal.aborted) return;
              const boundedError = getBoundedFetchAbortError(
                fetchContext,
                'BROWSER_CAPTURE_RANGE_TIMEOUT',
                `Captured range ${start}-${end}`
              );
              if (boundedError?.stage === 'BROWSER_CAPTURE_RANGE_TIMEOUT') capturedRangeTimeouts++;
              rejectedAudioRanges++;
              const reportedError = boundedError || error;
              console.warn(`[Browser Extractor] Range ${start}-${end} rejected: ${reportedError.message}`);
            }
          })();
          pendingFetches.add(fetchP);
          fetchP.finally(() => {
            pendingFetches.delete(fetchP);
            pendingRangeKeys.delete(rangeKey);
          });
        }
      }
    };

    removeBeforeRequestObserver = ensureYouTubeRequestDispatcher().addObserver(beforeRequestObserver);
    s.webRequest.onResponseStarted(requestFilter, responseListener);

    win.loadURL(`https://music.youtube.com/watch?v=${videoId}`).catch(() => {});

    let trackDuration = 0;
    let lastDomState = { hasVideo: false, isAd: false, readyState: 0, duration: 0, currentTime: 0, videoId: null };

    // Stage-based readiness polling loop (up to 30 seconds)
    const MAX_WAIT_MS = 30000;
    const POLL_INTERVAL_MS = 150;
    const maxIterations = Math.ceil(MAX_WAIT_MS / POLL_INTERVAL_MS);

    for (let i = 0; i < maxIterations; i++) {
      if (abortSignal && abortSignal.aborted) throw new Error('Download cancelled');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      if (win && !win.isDestroyed()) {
        const state = await win.webContents.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            const p = document.getElementById('movie_player');
            if (v) {
              v.muted = true;
              v.volume = 0;
            }
            let isAd = false;
            if (p) {
              isAd = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
              if (typeof p.getAdState === 'function' && p.getAdState() > 0) isAd = true;
              if (isAd && v && Number.isFinite(v.duration) && v.duration > 0) {
                v.currentTime = v.duration;
              }
              const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
              if (skipBtn) skipBtn.click();
              if (typeof p.playVideo === 'function') {
                try { p.playVideo(); } catch(e) {}
              } else if (v) {
                v.play().catch(() => {});
              }
            } else if (v) {
              v.play().catch(() => {});
            }
            const videoData = (p && typeof p.getVideoData === 'function') ? p.getVideoData() : null;
            return {
              hasVideo: !!v,
              isAd,
              readyState: v ? v.readyState : 0,
              duration: v && Number.isFinite(v.duration) ? v.duration : 0,
              currentTime: v ? v.currentTime : 0,
              videoId: videoData ? videoData.video_id : null
            };
          })()
        `).catch((err) => ({
          hasVideo: false,
          isAd: false,
          readyState: 0,
          duration: 0,
          currentTime: 0,
          videoId: null,
          evalError: err.message
        }));

        lastDomState = state;

        if (!state.isAd && state.hasVideo && state.duration > 0 && state.readyState >= 2 && state.videoId === videoId) {
          trackDuration = state.duration;
          // Start a fresh capture epoch only after the DOM player proves it is
          // rendering the requested exact video. Nothing observed earlier is
          // eligible for selection or assembly.
          captureGeneration++;
          streamBuckets.clear();
          pendingRangeKeys.clear();
          eligibleRequestIds.clear();
          exactTrackReady = true;
          targetSongClen = 0;
          targetStreamIdentity = null;
          console.log(`[Extractor Ready] videoId=${videoId}, duration=${trackDuration}s, readyState=${state.readyState}, elapsedMs=${Date.now() - startTime}ms`);
          break;
        }
      }
    }

    // Hard invariant: never begin scrubbing without validated media readiness
    if (!trackDuration || trackDuration <= 0) {
      let stageCode = 'PLAYER_INITIALIZATION_TIMEOUT';
      if (!lastDomState.hasVideo) {
        stageCode = 'VIDEO_ELEMENT_TIMEOUT';
      } else if (lastDomState.isAd) {
        stageCode = 'AD_PLAYING_TIMEOUT';
      } else if (lastDomState.duration <= 0) {
        stageCode = 'MEDIA_DURATION_TIMEOUT';
      } else if (lastDomState.readyState < 2) {
        stageCode = 'MEDIA_READYSTATE_TIMEOUT';
      }
      throw new Error(`[${stageCode}] YouTube Music player failed readiness checks within 30s (duration=${lastDomState.duration}, isAd=${lastDomState.isAd}, readyState=${lastDomState.readyState}, observedAudioRequests=${observedAudioRequests}, elapsedMs=${Date.now() - startTime}ms)`);
    }

    // Seek densely enough for the player to issue its natural authenticated
    // ranges. Very large/fast jumps leave permanent holes even though later
    // ranges arrive successfully.
    const jumpSeconds = 3;
    const stepCount = Math.ceil(trackDuration / jumpSeconds);

    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step <= stepCount; step++) {
        if (abortSignal && abortSignal.aborted) throw new Error('Download cancelled');

        if (targetSongClen) {
          const bucket = streamBuckets.get(targetSongClen);
          if (bucket) {
            const cov = checkByteCoverage(bucket, targetSongClen);
            if (cov.complete) {
              console.log(`[Download] 100% byte coverage achieved in ${Date.now() - startTime}ms (pass ${pass + 1}, step ${step}/${stepCount})`);
              break;
            }
          }
        }

        const passOffset = pass === 0 ? 0 : jumpSeconds / 2;
        const targetTime = Math.min(trackDuration - 0.1, (step * jumpSeconds) + passOffset);

        if (win && !win.isDestroyed()) {
          await win.webContents.executeJavaScript(`
            (() => {
              const v = document.querySelector('video');
              if (v && v.duration > 0) {
                v.currentTime = ${targetTime};
                v.play().catch(() => {});
              }
            })()
          `).catch(() => {});
        }

        await new Promise((r) => setTimeout(r, 180));
      }

      await Promise.all(Array.from(pendingFetches));
      if (abortSignal && abortSignal.aborted) {
        throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
      }
      if (targetSongClen) {
        const bucket = streamBuckets.get(targetSongClen);
        if (bucket && checkByteCoverage(bucket, targetSongClen).complete) break;
      }
    }

    // Wait for any trailing chunk fetches
    await Promise.all(Array.from(pendingFetches));
    if (abortSignal && abortSignal.aborted) {
      throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
    }

    // Chromium often buffers the opening segment before DOM readiness. That
    // request is intentionally discarded. Once a later post-readiness natural
    // range has been fully validated, use its exact signed stream identity as a
    // template to request only the remaining gaps, with all validations repeated.
    const targetBucket = targetSongClen ? streamBuckets.get(targetSongClen) : null;
    if (
      targetBucket &&
      targetStreamIdentity &&
      validatedStreamTemplateUrl &&
      !checkByteCoverage(targetBucket, targetSongClen).complete
    ) {
      const naturalChunkLength = Math.min(
        DIRECT_DOWNLOAD_CHUNK_SIZE,
        Math.max(64 * 1024, maxValidatedNaturalRangeLength || 256 * 1024)
      );
      const gaps = getByteCoverageGaps(targetBucket, targetSongClen);

      for (const gap of gaps) {
        for (let start = gap.start; start <= gap.end; start += naturalChunkLength) {
          if (abortSignal && abortSignal.aborted) throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
          const end = Math.min(gap.end, start + naturalChunkLength - 1);
          const gapUrl = new URL(validatedStreamTemplateUrl);
          gapUrl.searchParams.set('range', `${start}-${end}`);
          const parsedGap = parseBrowserAudioRangeUrl(gapUrl.toString());
          if (!parsedGap || parsedGap.identity !== targetStreamIdentity) {
            throw createDownloadStageError('BROWSER_GAP_RANGE_INVALID', `Could not bind synthesized range ${start}-${end} to the validated stream`);
          }

          const gapFetchContext = createBoundedFetchContext(abortSignal, BROWSER_GAP_FETCH_TIMEOUT_MS);
          let res;
          try {
            res = await net.fetch(gapUrl.toString(), {
              headers: {
                'Accept-Encoding': 'identity',
                'User-Agent': userAgent,
                'Referer': 'https://music.youtube.com/'
              },
              signal: gapFetchContext.signal
            });
          } catch (error) {
            throw getBoundedFetchAbortError(
              gapFetchContext,
              'BROWSER_GAP_TIMEOUT',
              `Gap range ${start}-${end}`
            ) || error;
          }
          if (res.status !== 200 && res.status !== 206) {
            throw createDownloadStageError('BROWSER_GAP_HTTP_STATUS', `Gap range ${start}-${end} returned HTTP ${res.status}`);
          }

          const responseType = String(res.headers.get('content-type') || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
          if (!responseType.startsWith('audio/') && responseType !== 'application/octet-stream') {
            throw createDownloadStageError('BROWSER_GAP_CONTENT_TYPE', `Gap range ${start}-${end} returned ${responseType || 'no content type'}`);
          }

          const responseUrl = res.url ? parseBrowserAudioRangeUrl(res.url) : parsedGap;
          if (
            !responseUrl ||
            responseUrl.identity !== targetStreamIdentity ||
            responseUrl.start !== start ||
            responseUrl.end !== end
          ) {
            throw createDownloadStageError('BROWSER_GAP_STREAM_MISMATCH', `Gap range ${start}-${end} changed stream identity or boundaries`);
          }

          const expectedLength = end - start + 1;
          const contentRangeValue = res.headers.get('content-range');
          const responseRange = parseContentRangeHeader(contentRangeValue);
          if (contentRangeValue) {
            if (
              !responseRange ||
              responseRange.start !== start ||
              responseRange.end !== end ||
              responseRange.total !== targetSongClen
            ) {
              throw createDownloadStageError('BROWSER_GAP_CONTENT_RANGE', `Gap range ${start}-${end} returned invalid Content-Range`);
            }
          } else if (res.status === 206) {
            throw createDownloadStageError('BROWSER_GAP_CONTENT_RANGE', `HTTP 206 gap range ${start}-${end} omitted Content-Range`);
          } else {
            queryRangeResponsesWithoutContentRange++;
          }

          const declaredLength = Number(res.headers.get('content-length') || 0);
          if (declaredLength > 0 && declaredLength !== expectedLength) {
            throw createDownloadStageError('BROWSER_GAP_LENGTH_MISMATCH', `Gap range ${start}-${end} declared ${declaredLength}/${expectedLength} bytes`);
          }

          let gapArrayBuffer;
          try {
            gapArrayBuffer = await res.arrayBuffer();
            throwIfBoundedFetchAborted(
              gapFetchContext,
              'BROWSER_GAP_TIMEOUT',
              `Gap range ${start}-${end}`
            );
          } catch (error) {
            throw getBoundedFetchAbortError(
              gapFetchContext,
              'BROWSER_GAP_TIMEOUT',
              `Gap range ${start}-${end}`
            ) || error;
          }
          const buffer = Buffer.from(gapArrayBuffer);
          if (
            !exactTrackReady ||
            parsedGap.identity !== targetStreamIdentity ||
            buffer.length !== expectedLength
          ) {
            throw createDownloadStageError('BROWSER_GAP_LENGTH_MISMATCH', `Gap range ${start}-${end} returned ${buffer.length}/${expectedLength} bytes`);
          }
          targetBucket.set(start, { end, buffer });
          synthesizedGapRanges++;
        }
      }
    }

    // Only the single post-readiness signed stream identity selected above is
    // eligible. Never fall back to a merely large bucket from another request.
    const bestClen = targetSongClen || 0;
    const bestBucket = bestClen && targetStreamIdentity ? streamBuckets.get(bestClen) : null;
    let maxBytes = 0;
    if (bestBucket) {
      for (const item of bestBucket.values()) maxBytes += item.buffer.length;
    }

    if (!bestBucket || bestBucket.size === 0) {
      if (capturedRangeTimeouts > 0) {
        throw createDownloadStageError(
          'BROWSER_CAPTURE_RANGE_TIMEOUT',
          `${capturedRangeTimeouts} post-readiness range request(s) timed out before any audio chunk was validated`
        );
      }
      throw new Error(`[NO_AUDIO_CHUNKS_CAPTURED] 0 eligible post-readiness chunks collected (trackDuration=${trackDuration}s, observedAudioRequests=${observedAudioRequests}, preReadinessRequests=${preReadinessAudioRequests}, rejectedRanges=${rejectedAudioRanges})`);
    }

    const finalCoverage = checkByteCoverage(bestBucket, bestClen);
    if (!finalCoverage.complete) {
      throw new Error(`[INCOMPLETE_AUDIO_CAPTURE] Captured ${finalCoverage.totalBytes}/${bestClen} bytes with continuous coverage through ${finalCoverage.coveredUntil}`);
    }

    emitProgress(92, maxBytes, bestClen || maxBytes);

    // Assemble by absolute byte position. Overlapping browser requests are
    // common, so concatenating whole response buffers would duplicate bytes.
    const sortedStarts = Array.from(bestBucket.keys()).sort((a, b) => a - b);
    const assembled = Buffer.allocUnsafe(bestClen);
    let assembledThrough = 0;

    for (const start of sortedStarts) {
      const item = bestBucket.get(start);
      if (start > assembledThrough) {
        throw new Error(`[INCOMPLETE_AUDIO_CAPTURE] Gap before byte ${start}; assembled through ${assembledThrough}`);
      }

      const sourceOffset = Math.max(0, assembledThrough - start);
      const available = item.buffer.length - sourceOffset;
      if (available <= 0) continue;
      const copyLength = Math.min(available, bestClen - assembledThrough);
      item.buffer.copy(assembled, assembledThrough, sourceOffset, sourceOffset + copyLength);
      assembledThrough += copyLength;
      if (assembledThrough >= bestClen) break;
    }

    if (assembledThrough !== bestClen) {
      throw new Error(`[INCOMPLETE_AUDIO_CAPTURE] Assembled ${assembledThrough}/${bestClen} validated bytes`);
    }

    await fs.promises.writeFile(tempPath, assembled);

    emitProgress(95, maxBytes, bestClen || maxBytes);

    return {
      success: true,
      totalLength: bestClen,
      mimeType,
      diagnostics: {
        preReadinessAudioRequests,
        rejectedAudioRanges,
        capturedRangeTimeouts,
        queryRangeResponsesWithoutContentRange,
        synthesizedGapRanges
      }
    };
  } catch (err) {
    const stage = getDownloadStage(err, 'BROWSER_EXTRACTION_FAILED');
    return {
      success: false,
      stage,
      error: err.message,
      diagnostics: {
        preReadinessAudioRequests,
        rejectedAudioRanges,
        capturedRangeTimeouts,
        queryRangeResponsesWithoutContentRange,
        synthesizedGapRanges
      }
    };
  } finally {
    if (removeBeforeRequestObserver) {
      try { removeBeforeRequestObserver(); } catch (e) {}
      removeBeforeRequestObserver = null;
    }
    try {
      s.webRequest.onResponseStarted({ urls: ['*://*.googlevideo.com/videoplayback*'] }, null);
    } catch (e) {}
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch (e) {}
    }
    if (pendingFetches.size > 0) {
      await Promise.allSettled(Array.from(pendingFetches));
    }
    pendingFetches.clear();
    pendingRangeKeys.clear();
    eligibleRequestIds.clear();
  }
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

let youtubeRequestDispatcher = null;

function ensureYouTubeRequestDispatcher() {
  if (youtubeRequestDispatcher) return youtubeRequestDispatcher;

  const youtubeSession = session.fromPartition('persist:youtube');
  youtubeRequestDispatcher = new YouTubeRequestDispatcher(shouldBlockRequest);
  // Electron permits one onBeforeRequest listener per session. This dispatcher
  // owns it for the lifetime of the partition, so creating/destroying extractor
  // or background windows can never replace the ad filter or each other.
  youtubeSession.webRequest.onBeforeRequest((details, callback) => {
    youtubeRequestDispatcher.dispatch(details, callback);
  });
  return youtubeRequestDispatcher;
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
let errorSignalSentForVideoId = null;
let loadRequestId = 0;
const NAVIGATION_TIMEOUT_MS = 12000;

function getOrCreateBgPlayerWindow() {
  if (bgPlayerWindow && !bgPlayerWindow.isDestroyed()) {
    return bgPlayerWindow;
  }

  const s = session.fromPartition('persist:youtube');
  ensureYouTubeRequestDispatcher();

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

            const response = (p && typeof p.getPlayerResponse === 'function') ? p.getPlayerResponse() : null;
            const playabilityStatus = response?.playabilityStatus?.status || null;

            return {
              currentTime: v.currentTime || 0,
              duration: v.duration || 0,
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
              playerState: playerState,
              urlVideoId: urlVideoId,
              apiVideoId: apiVideoId,
              isAd: isAd,
              playabilityStatus: playabilityStatus
            };
          } catch (e) {
            return null;
          }
        })()
      `);

      if (!state) return;

      const { currentTime, duration, paused, ended, playerState, urlVideoId, apiVideoId, isAd, playabilityStatus } = state;

      // Check for playback errors like age-restriction or unplayable tracks with strict per-track attribution & idempotency
      if (playabilityStatus === 'LOGIN_REQUIRED' || playabilityStatus === 'UNPLAYABLE' || playabilityStatus === 'ERROR') {
        if (requestedVideoId && navigationInProgress && errorSignalSentForVideoId !== requestedVideoId) {
          const hasUrl = !!urlVideoId;
          const hasApi = !!apiVideoId;
          let isAttributedToRequested = false;

          if (hasUrl && hasApi) {
            isAttributedToRequested = (urlVideoId === requestedVideoId && apiVideoId === requestedVideoId);
          } else if (hasUrl) {
            isAttributedToRequested = (urlVideoId === requestedVideoId);
          } else if (hasApi) {
            isAttributedToRequested = (apiVideoId === requestedVideoId);
          }

          if (isAttributedToRequested) {
            errorSignalSentForVideoId = requestedVideoId;
            console.warn(`[BgPlayer StateMachine] Playback failed for ${requestedVideoId} due to ${playabilityStatus}`);
            mainWindow.webContents.send('yt-player-state-update', {
              error: playabilityStatus,
              videoId: requestedVideoId
            });
            navigationInProgress = false;
            requestedVideoId = null;
          }
        }
      }

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

      // Send normal telemetry update only when navigation has settled AND the active video ID matches
      if (currentPlayingVideoId && !isAd && !navigationInProgress && resolvedActualId === currentPlayingVideoId) {
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
    errorSignalSentForVideoId = null;
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
  errorSignalSentForVideoId = null;

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

ipcMain.handle('get-youtube-track-duration', async (event, videoId) => {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return 0;
  try {
    const yt = await getInnertube();
    if (!yt) return 0;
    const info = await yt.getBasicInfo(videoId, { client: 'YTMUSIC' });
    const duration = Math.round(Number(info?.basic_info?.duration || 0));
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch (error) {
    console.warn(`[Track Duration] Failed to resolve ${videoId}:`, error.message);
    return 0;
  }
});

ipcMain.handle('get-default-music-dir', () => {
  return getDefaultMusicDirectory();
});

ipcMain.handle('save-audio-to-disk', async (event, { filename, buffer, targetDir, videoId }) => {
  let tempPath = null;
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const ownedFilename = appendVideoIdSuffix(filename, videoId);
    const fullPath = path.join(dir, ownedFilename);
    tempPath = path.join(
      path.dirname(fullPath),
      `.${path.basename(fullPath)}.export.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    );
    await runFinalPathExclusive(fullPath, async () => {
      await fs.promises.writeFile(tempPath, Buffer.from(buffer));
      if (fs.existsSync(fullPath)) await fs.promises.unlink(fullPath);
      await fs.promises.rename(tempPath, fullPath);
      tempPath = null;
    });
    return { success: true, filePath: fullPath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try { await fs.promises.unlink(tempPath); } catch {}
    }
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

// --- YouTube Authentication IPC ---
let youtubeAuthWindow = null;

async function checkYouTubeAuthStatus() {
  try {
    const s = session.fromPartition('persist:youtube');
    const [ytCookies, googleCookies] = await Promise.all([
      s.cookies.get({ domain: '.youtube.com' }),
      s.cookies.get({ domain: '.google.com' })
    ]);
    const allCookies = [...ytCookies, ...googleCookies];

    // Authoritative Google/YouTube session cookies
    const authCookieNames = new Set([
      'LOGIN_INFO',
      'SAPISID',
      '__Secure-3PSID',
      '__Secure-1PSID',
      '__Secure-3PAPISID',
      '__Secure-1PAPISID',
      'SID',
      'SSID'
    ]);

    const hasAuthCookie = allCookies.some(c => authCookieNames.has(c.name) && Boolean(c.value));
    return hasAuthCookie ? 'signed_in' : 'signed_out';
  } catch (e) {
    return 'signed_out';
  }
}

async function verifyAuthWindowInPage(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    const inPageState = await win.webContents.executeJavaScript(`
      (() => {
        try {
          if (typeof window.ytcfg !== 'undefined' && typeof window.ytcfg.get === 'function') {
            if (window.ytcfg.get('LOGGED_IN') === true) return true;
          }
          if (window.yt?.config_?.LOGGED_IN === true) return true;
          if (document.querySelector('ytd-topbar-menu-button-renderer #avatar-btn, #avatar-btn, ytmusic-settings-button, button[aria-label*="Account"], yt-img-shadow#avatar')) return true;
          return false;
        } catch (e) {
          return false;
        }
      })()
    `);
    return Boolean(inPageState);
  } catch (e) {
    return false;
  }
}

ipcMain.handle('open-youtube-signin', async () => {
  if (youtubeAuthWindow && !youtubeAuthWindow.isDestroyed()) {
    youtubeAuthWindow.focus();
    return false;
  }
  
  return new Promise((resolve) => {
    let hasResolved = false;
    let isChecking = false;

    const safeResolve = (val) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve(val);
      }
    };

    youtubeAuthWindow = new BrowserWindow({
      width: 850,
      height: 720,
      title: 'Sign In to YouTube',
      webPreferences: {
        partition: 'persist:youtube',
        nodeIntegration: false,
        contextIsolation: true
      },
      autoHideMenuBar: true
    });

    youtubeAuthWindow.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/');

    const maybeCheckYouTubeAuth = async () => {
      if (isChecking || hasResolved || !youtubeAuthWindow || youtubeAuthWindow.isDestroyed()) return;
      isChecking = true;
      try {
        const currentUrl = youtubeAuthWindow.webContents.getURL() || '';
        let isYouTubeHost = false;
        try {
          const parsed = new URL(currentUrl);
          const hostname = parsed.hostname.toLowerCase();
          isYouTubeHost = (
            hostname === 'youtube.com' ||
            hostname === 'www.youtube.com' ||
            hostname === 'music.youtube.com' ||
            hostname.endsWith('.youtube.com')
          ) && !hostname.includes('accounts.google.com') && !currentUrl.includes('/ServiceLogin');
        } catch (e) {}

        if (isYouTubeHost) {
          const cookieAuthState = await checkYouTubeAuthStatus();
          const inPageAuth = await verifyAuthWindowInPage(youtubeAuthWindow);
          const isAuthenticated = (cookieAuthState === 'signed_in') || inPageAuth;
          
          console.log(`[YouTube Auth] Auth verification check: authenticated=${isAuthenticated}`);
          if (isAuthenticated) {
            if (youtubeAuthWindow && !youtubeAuthWindow.isDestroyed()) {
              setTimeout(() => {
                if (youtubeAuthWindow && !youtubeAuthWindow.isDestroyed()) {
                  youtubeAuthWindow.close();
                }
              }, 400);
            }
          }
        }
      } catch (err) {
        console.warn('[YouTube Auth] Auth verification exception:', err.message);
      } finally {
        isChecking = false;
      }
    };

    youtubeAuthWindow.webContents.on('did-navigate', maybeCheckYouTubeAuth);
    youtubeAuthWindow.webContents.on('did-navigate-in-page', maybeCheckYouTubeAuth);
    youtubeAuthWindow.webContents.on('did-finish-load', maybeCheckYouTubeAuth);

    youtubeAuthWindow.on('closed', () => {
      youtubeAuthWindow = null;
      safeResolve(true);
    });
  });
});

ipcMain.handle('sign-out-youtube', async () => {
  try {
    const s = session.fromPartition('persist:youtube');
    await s.clearStorageData();
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('get-youtube-auth-state', async () => {
  return await checkYouTubeAuthStatus();
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

ipcMain.handle('cancel-download-native', async (event, videoId) => {
  if (!videoId) return { success: false, cancelledRequests: 0 };
  const cancelledRequests = cancelActiveDownloads(videoId);
  return { success: cancelledRequests > 0, cancelledRequests };
});

ipcMain.handle('download-track-native', async (event, { videoId, title, artist, album, cover, format, targetDir }) => {
  if (!videoId) {
    return { success: false, error: 'Missing videoId' };
  }

  const { requestId, controller } = registerActiveDownload(videoId);
  let requestRegistered = true;

  let tempRawPath = null;
  let tempProcessedPath = null;
  let acquisitionDiagnostics = null;

  try {
    event.sender.send('download-progress-event', { videoId, percent: 5 });

    const cleanArtistStr = (artist || 'Unknown Artist').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitleStr = (title || 'Unknown Track').replace(/[\\/:*?"<>|]/g, '_').trim();
    const ext = format === 'm4a' ? 'm4a' : 'mp3';
    const fileName = appendVideoIdSuffix(`${cleanArtistStr} - ${cleanTitleStr}.${ext}`, videoId);

    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, fileName);
    tempRawPath = path.join(dir, `.${fileName}.raw.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`);
    tempProcessedPath = path.join(dir, `.${fileName}.proc.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.${ext}`);

    const onProgress = (data) => {
      event.sender.send('download-progress-event', data);
    };

    // 1. Primary: exact-video, fully validated HTTP byte-range acquisition.
    console.log(`[Download] Starting validated ranged download for ${videoId}...`);
    const directResult = await downloadTrackViaValidatedRanges(
      videoId,
      tempRawPath,
      onProgress,
      controller.signal
    );

    let browserResult = null;
    if (!directResult.success) {
      if (controller.signal.aborted || directResult.stage === 'DOWNLOAD_CANCELLED') {
        throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
      }

      console.warn(`[Download] Direct ranged acquisition failed for ${videoId}: ${directResult.error}`);
      console.log(`[Download] Falling back to authenticated browser extraction for ${videoId}...`);
      browserResult = await runBrowserDownloadExclusive(async () => {
        if (controller.signal.aborted) {
          return {
            success: false,
            stage: 'DOWNLOAD_CANCELLED',
            error: '[DOWNLOAD_CANCELLED] Download cancelled'
          };
        }
        return downloadTrackViaBrowserBuffer(videoId, tempRawPath, onProgress, controller.signal);
      });

      if (!browserResult.success) {
        if (controller.signal.aborted || browserResult.stage === 'DOWNLOAD_CANCELLED') {
          throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled');
        }
        acquisitionDiagnostics = {
          direct: {
            stage: directResult.stage,
            error: directResult.error,
            attempts: directResult.diagnostics || []
          },
          browser: {
            stage: browserResult.stage || 'BROWSER_EXTRACTION_FAILED',
            error: browserResult.error || 'Unknown browser extraction failure',
            details: browserResult.diagnostics || null
          }
        };
        const error = createDownloadStageError(
          'AUDIO_ACQUISITION_FAILED',
          `Direct ranged acquisition failed: ${directResult.error}; browser fallback failed: ${browserResult.error || 'Unknown error'}`
        );
        error.diagnostics = acquisitionDiagnostics;
        throw error;
      }
    }

    acquisitionDiagnostics = directResult.success
      ? {
          method: 'validated-ranges',
          stage: directResult.stage,
          totalLength: directResult.totalLength,
          details: directResult.diagnostics || null
        }
      : {
          method: 'browser-fallback',
          direct: {
            stage: directResult.stage,
            error: directResult.error,
            attempts: directResult.diagnostics || []
          },
          browser: {
            stage: 'BROWSER_EXTRACTION_COMPLETE',
            details: browserResult?.diagnostics || null
          }
        };

    // 2. Verification of raw stream
    if (!fs.existsSync(tempRawPath)) {
      throw new Error('Downloaded temporary file was not created');
    }
    const rawStat = await fs.promises.stat(tempRawPath);
    if (rawStat.size === 0) {
      await fs.promises.unlink(tempRawPath).catch(() => {});
      throw new Error('Downloaded audio file is empty (0 bytes)');
    }

    // 3. Transcode & Embed ID3 Metadata / Cover Art via FFmpeg
    console.log(`[FFmpeg Processing] Transcoding and tagging "${fileName}"...`);
    event.sender.send('download-progress-event', {
      videoId,
      percent: 96,
      downloadedBytes: rawStat.size,
      totalBytes: rawStat.size
    });

    await transcodeAndTagAudio({
      inputPath: tempRawPath,
      outputPath: tempProcessedPath,
      format: ext,
      title: title || 'Unknown Track',
      artist: artist || 'Unknown Artist',
      album: album || 'OwO Music',
      coverUrl: cover,
      abortSignal: controller.signal
    });

    event.sender.send('download-progress-event', {
      videoId,
      percent: 98,
      downloadedBytes: rawStat.size,
      totalBytes: rawStat.size
    });

    const targetFileToUse = fs.existsSync(tempProcessedPath) ? tempProcessedPath : tempRawPath;
    await fs.promises.stat(targetFileToUse);

    // Different video IDs can sanitize to the same output name. Serialize the
    // complete replace/rename/read sequence for that normalized path so each
    // request returns the bytes it produced, never a later request's file.
    const finalized = await runFinalPathExclusive(fullPath, async () => {
      if (controller.signal.aborted) {
        throw createDownloadStageError('DOWNLOAD_CANCELLED', 'Download cancelled before final file commit');
      }

      if (fs.existsSync(fullPath)) {
        try { await fs.promises.unlink(fullPath); } catch {}
      }
      await fs.promises.rename(targetFileToUse, fullPath);
      if (targetFileToUse === tempProcessedPath) tempProcessedPath = null;
      if (targetFileToUse === tempRawPath) tempRawPath = null;

      const finalStat = await fs.promises.stat(fullPath);
      const fileBuffer = await fs.promises.readFile(fullPath);
      if (fileBuffer.length !== finalStat.size) {
        throw createDownloadStageError(
          'FINAL_FILE_READ_MISMATCH',
          `Final file changed while being read (${fileBuffer.length}/${finalStat.size} bytes)`
        );
      }
      // Rename is the commit boundary. Cancellation after this point must not
      // unlink a committed file; the request completes with its own bytes.
      return { finalStat, fileBuffer };
    });

    // The replace/read operation is the commit boundary. Once it finishes, the
    // request is no longer cancellable and must not be included in a later
    // video-wide cancellation snapshot while it emits progress/returns data.
    unregisterActiveDownload(videoId, requestId);
    requestRegistered = false;

    // Clean up any remaining temp files
    if (tempRawPath && fs.existsSync(tempRawPath)) {
      await fs.promises.unlink(tempRawPath).catch(() => {});
    }
    if (tempProcessedPath && fs.existsSync(tempProcessedPath)) {
      await fs.promises.unlink(tempProcessedPath).catch(() => {});
    }
    tempRawPath = null;
    tempProcessedPath = null;

    event.sender.send('download-progress-event', {
      videoId,
      percent: 100,
      downloadedBytes: finalized.finalStat.size,
      totalBytes: finalized.finalStat.size
    });

    console.log(`[Download] Track "${fileName}" successfully saved to ${fullPath} (${(finalized.finalStat.size / (1024 * 1024)).toFixed(2)} MB).`);

    return {
      success: true,
      filePath: fullPath,
      buffer: finalized.fileBuffer,
      mimeType: ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg',
      size: finalized.finalStat.size,
      diagnostics: acquisitionDiagnostics
    };
  } catch (err) {
    if (tempRawPath && fs.existsSync(tempRawPath)) {
      try { await fs.promises.unlink(tempRawPath); } catch {}
    }
    if (tempProcessedPath && fs.existsSync(tempProcessedPath)) {
      try { await fs.promises.unlink(tempProcessedPath); } catch {}
    }
    const stage = controller.signal.aborted
      ? 'DOWNLOAD_CANCELLED'
      : getDownloadStage(err, 'DOWNLOAD_PROCESSING_FAILED');
    const diagnostics = err.diagnostics || acquisitionDiagnostics || null;
    console.error(`[Download Error for ${videoId}] [${stage}]:`, err.message, diagnostics || '');
    const error = controller.signal.aborted ? '[DOWNLOAD_CANCELLED] Download cancelled' : err.message;
    return { success: false, stage, error, diagnostics };
  } finally {
    if (requestRegistered) unregisterActiveDownload(videoId, requestId);
  }
});

ipcMain.handle('delete-audio-from-disk', async (event, { title, artist, videoId, legacyFallback, targetDir }) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    const cleanArtistStr = (artist || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitleStr = (title || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const stableId = sanitizeStableVideoId(videoId);
    const base = `${cleanArtistStr} - ${cleanTitleStr}`;
    const files = getAudioFileNames(base, stableId);
    for (const f of files) {
      const p = path.join(dir, f);
      await runFinalPathExclusive(p, async () => {
        if (fs.existsSync(p)) await fs.promises.unlink(p);
      });
    }
    if (legacyFallback && stableId) {
      const existing = fs.existsSync(dir) ? await fs.promises.readdir(dir) : [];
      if (shouldDeleteLegacyAudio(existing, base)) {
        for (const legacyName of getAudioFileNames(base, '')) {
          const legacyPath = path.join(dir, legacyName);
          await runFinalPathExclusive(legacyPath, async () => {
            if (fs.existsSync(legacyPath)) await fs.promises.unlink(legacyPath);
          });
        }
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-audio-on-disk', async (event, { title, artist, videoId, legacyFallback, targetDir }) => {
  try {
    const dir = targetDir || getDefaultMusicDirectory();
    if (!fs.existsSync(dir)) return false;
    const cleanArtistStr = (artist || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
    const cleanTitleStr = (title || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
    const allFiles = await fs.promises.readdir(dir);
    const base = `${cleanArtistStr} - ${cleanTitleStr}`;
    return hasAudioFile(allFiles, base, videoId, Boolean(legacyFallback));
  } catch (e) {
    return false;
  }
});

ipcMain.handle('get-disk-audio-files', async (event, targetDir) => {
  const dir = targetDir || getDefaultMusicDirectory();
  try {
    if (!fs.existsSync(dir)) {
      return { success: false, files: [], stage: 'DISK_DIRECTORY_UNAVAILABLE', error: `Audio directory is unavailable: ${dir}` };
    }
    const files = await fs.promises.readdir(dir);
    return { success: true, files: files.map(f => f.toLowerCase()), targetDir: dir };
  } catch (error) {
    return {
      success: false,
      files: [],
      stage: 'DISK_DIRECTORY_LIST_FAILED',
      error: error?.message || `Could not list audio directory: ${dir}`,
      targetDir: dir
    };
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

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      if (
        lowerName.startsWith('.') || 
        lowerName.startsWith('$') || 
        lowerName === 'node_modules' || 
        lowerName === 'appdata' || 
        lowerName === 'windows'
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
            let album = path.basename(dirPath) || 'Local Audio';
            let duration = 0;
            let cover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80';

            if (baseName.includes(' - ')) {
              const parts = baseName.split(' - ');
              artist = parts[0].trim() || 'Local Artist';
              title = parts.slice(1).join(' - ').trim() || baseName;
            }

            if (mm) {
              try {
                const meta = await mm.parseFile(fullPath, { duration: true, skipCovers: false });
                if (meta.common) {
                  if (meta.common.title && meta.common.title.trim()) title = meta.common.title.trim();
                  if (meta.common.artist && meta.common.artist.trim()) artist = meta.common.artist.trim();
                  if (meta.common.album && meta.common.album.trim()) album = meta.common.album.trim();
                  if (meta.common.picture && meta.common.picture.length > 0) {
                    const pic = meta.common.picture[0];
                    const mime = pic.format || 'image/jpeg';
                    cover = `data:${mime};base64,${pic.data.toString('base64')}`;
                  }
                }
                if (meta.format && Number.isFinite(meta.format.duration) && meta.format.duration > 0) {
                  duration = Math.round(meta.format.duration);
                }
              } catch (parseErr) {}
            }

            results.push({
              id: 'local-' + Buffer.from(fullPath).toString('base64'),
              title,
              artist,
              album,
              duration,
              cover,
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

  // Sort by oldest added first (so newly downloaded/added files append to bottom)
  allTracks.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
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
  ensureYouTubeRequestDispatcher();
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
