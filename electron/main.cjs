const { app, BrowserWindow, ipcMain, shell, dialog, protocol, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');

// Universal autoplay & audio engine enablement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let proxyPort = 41721;
const https = require('https');
let cachedVisitorSession = null;
const resolvedAudioCache = new Map(); // videoId -> { audioInfo: { url, mimeType }, time: number }

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

async function resolveBestAudioUrl(videoId, session) {
  if (!videoId) return null;

  // 1. Instant Cache hit (Valid for 3 hours)
  const cached = resolvedAudioCache.get(videoId);
  if (cached && (Date.now() - cached.time < 10800000)) {
    return cached.audioInfo;
  }

  let activeSession = session;
  if (!activeSession || !activeSession.visitorData) {
    activeSession = await getVisitorSession();
  }

  // 2. High-speed Direct Native Innertube Client (Fastest: ~120ms)
  const clients = [
    { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceModel: 'Quest 3', hl: 'en', gl: 'US' },
    { clientName: 'ANDROID', clientVersion: '19.29.35', hl: 'en', gl: 'US' }
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const c of clients) {
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
            const m4aFormats = formats.filter(f => f.mimeType?.includes('audio/mp4') || f.mimeType?.includes('mp4a'));
            let audioInfo = null;
            if (m4aFormats.length > 0) {
              m4aFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              audioInfo = { url: m4aFormats[0].url, mimeType: 'audio/mp4' };
            } else {
              formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              audioInfo = { url: formats[0].url, mimeType: formats[0].mimeType || 'audio/mp4' };
            }
            resolvedAudioCache.set(videoId, { audioInfo, time: Date.now() });
            return audioInfo;
          }
        }
      } catch (e) {}
    }

    // If first attempt failed, re-warm session and retry
    if (attempt === 0) {
      console.warn('[resolveBestAudioUrl] First attempt failed. Refreshing warm session token...');
      activeSession = await getVisitorSession(true);
    }
  }

  return null;
}

// Local background streaming proxy for YouTube audio
function startInternalProxyServer() {
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

      if (url.pathname === '/api/download-stream' || url.pathname === '/api/stream') {
        const videoId = url.searchParams.get('videoId') || url.searchParams.get('id');
        if (!videoId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'videoId is required' }));
          return;
        }

        const session = await getVisitorSession();
        const audioInfo = await resolveBestAudioUrl(videoId, session);

        if (!audioInfo || !audioInfo.url) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Audio stream not available' }));
          return;
        }

        const range = req.headers.range;
        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        };
        if (range) fetchHeaders['Range'] = range;

        const streamRes = await fetch(audioInfo.url, { headers: fetchHeaders });
        
        res.statusCode = streamRes.status;
        res.setHeader('Content-Type', streamRes.headers.get('content-type') || audioInfo.mimeType || 'audio/mp4');
        if (streamRes.headers.get('content-length')) {
          res.setHeader('Content-Length', streamRes.headers.get('content-length'));
        }
        if (streamRes.headers.get('content-range')) {
          res.setHeader('Content-Range', streamRes.headers.get('content-range'));
        }
        res.setHeader('Accept-Ranges', 'bytes');

        if (!streamRes.body) {
          res.end();
          return;
        }

        const nodeReadable = Readable.fromWeb(streamRes.body);
        nodeReadable.on('error', (err) => {
          console.warn('[Proxy Stream Pipe Warn]:', err.message);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        });

        req.on('close', () => {
          nodeReadable.destroy();
        });

        nodeReadable.pipe(res);
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0e11',
    title: 'OwO Music Player',
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
  });
}

// IPC Handlers for Native Windows features
ipcMain.handle('get-proxy-port', () => proxyPort);

ipcMain.handle('extract-stream-url', async (event, videoId) => {
  if (!videoId) return null;
  try {
    const session = await getVisitorSession();
    console.log(`[extract-stream-url] Got visitor session for ${videoId}. visitorData: ${session.visitorData ? 'YES' : 'NO'}`);
    const audioInfo = await resolveBestAudioUrl(videoId, session);
    console.log(`[extract-stream-url] Resolved audio for ${videoId}: ${audioInfo ? 'SUCCESS' : 'FAIL'} - ${audioInfo?.url?.slice(0, 50)}...`);
    return audioInfo?.url || null;
  } catch (err) {
    console.error('[extract-stream-url] Fatal error:', err);
    return null;
  }
});

ipcMain.handle('prefetch-stream-urls', async (event, videoIds) => {
  if (!Array.isArray(videoIds) || videoIds.length === 0) return;
  const session = await getVisitorSession();
  for (const id of videoIds.slice(0, 3)) {
    if (id && !resolvedAudioCache.has(id)) {
      resolveBestAudioUrl(id, session).catch(() => {});
    }
  }
});

ipcMain.handle('get-default-music-dir', () => {
  const musicPath = path.join(os.homedir(), 'Music', 'OwO Music');
  if (!fs.existsSync(musicPath)) {
    try {
      fs.mkdirSync(musicPath, { recursive: true });
    } catch (e) {}
  }
  return musicPath;
});

ipcMain.handle('save-audio-to-disk', async (event, { filename, buffer, targetDir }) => {
  try {
    const dir = targetDir || path.join(os.homedir(), 'Music', 'OwO Music');
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
    const defaultDir = path.join(os.homedir(), 'Music', 'OwO Music');
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
    defaultPath: path.join(os.homedir(), 'Music')
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
    const session = await getVisitorSession();
    const audioInfo = await resolveBestAudioUrl(videoId, session);
    if (!audioInfo || !audioInfo.url) {
      return { success: false, error: 'Could not resolve audio stream' };
    }

    event.sender.send('download-progress-event', { videoId, percent: 10 });

    // 1. Probe stream header for total content length
    let totalBytes = 0;
    try {
      const probeRes = await fetch(audioInfo.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(3500)
      });
      totalBytes = Number(probeRes.headers.get('content-length') || 0);
    } catch (e) {}

    let completeBuffer;

    if (totalBytes > 200000) {
      // 2. High-speed parallel unthrottled chunk download (4 streams in parallel)
      const CHUNK_COUNT = 4;
      const chunkSize = Math.ceil(totalBytes / CHUNK_COUNT);
      let downloadedChunks = 0;

      const chunkPromises = [];
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const start = i * chunkSize;
        const end = Math.min(totalBytes - 1, (i + 1) * chunkSize - 1);

        chunkPromises.push((async () => {
          const chunkRes = await fetch(audioInfo.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Range': `bytes=${start}-${end}`
            }
          });
          const buf = await chunkRes.arrayBuffer();
          downloadedChunks++;
          event.sender.send('download-progress-event', {
            videoId,
            percent: Math.min(99, Math.round((downloadedChunks / CHUNK_COUNT) * 100))
          });
          return { index: i, buffer: Buffer.from(buf) };
        })());
      }

      const results = await Promise.all(chunkPromises);
      results.sort((a, b) => a.index - b.index);
      completeBuffer = Buffer.concat(results.map(r => r.buffer));
    } else {
      // Fallback single stream
      const streamRes = await fetch(audioInfo.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const buf = await streamRes.arrayBuffer();
      completeBuffer = Buffer.from(buf);
    }

    const cleanArtistStr = (artist || 'Unknown Artist').replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitleStr = (title || 'Unknown Track').replace(/[\\/:*?"<>|]/g, '_').trim();
    const ext = format === 'm4a' ? 'm4a' : 'mp3';
    const fileName = `${cleanArtistStr} - ${cleanTitleStr}.${ext}`;

    const dir = targetDir || path.join(os.homedir(), 'Music', 'OwO Music');
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
    const dir = targetDir || path.join(os.homedir(), 'Music', 'OwO Music');
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
    const dir = targetDir || path.join(os.homedir(), 'Music', 'OwO Music');
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
    const dir = targetDir || path.join(os.homedir(), 'Music', 'OwO Music');
    if (!fs.existsSync(dir)) return [];
    const files = await fs.promises.readdir(dir);
    return files.map(f => f.toLowerCase());
  } catch (e) {
    return [];
  }
});

let musicFolderWatcher = null;
function setupMusicFolderWatcher(customDir) {
  try {
    if (musicFolderWatcher) {
      try { musicFolderWatcher.close(); } catch (e) {}
      musicFolderWatcher = null;
    }
    const dir = customDir || path.join(os.homedir(), 'Music', 'OwO Music');
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
