const { app, BrowserWindow, ipcMain, shell, dialog, protocol } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');

// Universal autoplay & audio engine enablement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');

let mainWindow = null;
let proxyPort = 41721;
let cachedVisitorSession = null;

async function getVisitorSession() {
  if (cachedVisitorSession && Date.now() - cachedVisitorSession.time < 3600000) {
    return cachedVisitorSession;
  }
  try {
    const res = await fetch('https://www.youtube.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const visitorMatch = html.match(/"VISITOR_DATA":\s*"([^"]+)"/) || html.match(/"visitorData":\s*"([^"]+)"/);
    const visitorData = visitorMatch ? visitorMatch[1] : undefined;
    const cookies = res.headers.getSetCookie 
      ? res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') 
      : (res.headers.get('set-cookie') || '');
    cachedVisitorSession = { visitorData, cookie: cookies, time: Date.now() };
    return cachedVisitorSession;
  } catch (e) {
    return { visitorData: undefined, cookie: '', time: Date.now() };
  }
}

async function resolveBestAudioUrl(videoId, session) {
  const clients = [
    { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceModel: 'Quest 3', hl: 'en', gl: 'US' },
    { clientName: 'ANDROID', clientVersion: '19.29.35', hl: 'en', gl: 'US' },
    { clientName: 'IOS', clientVersion: '19.29.1', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' },
    { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20241201.01.00', hl: 'en', gl: 'US' }
  ];

  for (const c of clients) {
    try {
      const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(session?.cookie ? { 'Cookie': session.cookie } : {})
        },
        body: JSON.stringify({
          context: {
            client: {
              ...c,
              visitorData: session?.visitorData
            }
          },
          videoId: videoId
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (playerRes.ok) {
        const data = await playerRes.json();
        const formats = (data.streamingData?.adaptiveFormats || []).filter(
          f => f.mimeType?.includes('audio') && Boolean(f.url)
        );
        if (formats.length > 0) {
          // Prioritize M4A / AAC format for standard music player compatibility
          const m4aFormats = formats.filter(f => f.mimeType?.includes('audio/mp4') || f.mimeType?.includes('mp4a'));
          if (m4aFormats.length > 0) {
            m4aFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            return { url: m4aFormats[0].url, mimeType: 'audio/mp4' };
          }
          formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return { url: formats[0].url, mimeType: formats[0].mimeType || 'audio/mp4' };
        }
      }
    } catch (e) {}
  }

  // Fallback to public instances
  const publicInstances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.privacydev.net',
    'https://piped-api.lunar.icu'
  ];

  for (const inst of publicInstances) {
    try {
      const res = await fetch(`${inst}/streams/${videoId}`, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const data = await res.json();
        const audios = (data.audioStreams || []).filter(f => Boolean(f.url));
        if (audios.length > 0) {
          const m4aAudios = audios.filter(f => f.mimeType?.includes('audio/mp4') || f.format === 'M4A');
          if (m4aAudios.length > 0) {
            m4aAudios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            return { url: m4aAudios[0].url, mimeType: 'audio/mp4' };
          }
          audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return { url: audios[0].url, mimeType: audios[0].mimeType || 'audio/mp4' };
        }
      }
    } catch (e) {}
  }

  return null;
}

// Local background streaming proxy for YouTube audio
function startInternalProxyServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

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
      webSecurity: false
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
