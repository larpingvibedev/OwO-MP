import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

interface VisitorSession {
  visitorData?: string;
  cookie: string;
  time: number;
}

let cachedVisitorSession: VisitorSession | null = null;

async function getVisitorSession(): Promise<VisitorSession> {
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
    const cookies = (res.headers as any).getSetCookie 
      ? (res.headers as any).getSetCookie().map((c: string) => c.split(';')[0]).join('; ') 
      : (res.headers.get('set-cookie') || '');
    cachedVisitorSession = { visitorData, cookie: cookies, time: Date.now() };
    return cachedVisitorSession;
  } catch {
    return { visitorData: undefined, cookie: '', time: Date.now() };
  }
}

function audioDownloadPlugin(): Plugin {
  return {
    name: 'audio-download-plugin',
    configureServer(server) {
      server.middlewares.use('/api/download-stream', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const videoId = url.searchParams.get('videoId');
          if (!videoId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'videoId is required' }));
            return;
          }

          const session = await getVisitorSession();

          // Fetch stream from YouTube InnerTube ANDROID_VR with active session
          const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              ...(session.cookie ? { 'Cookie': session.cookie } : {})
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'ANDROID_VR',
                  clientVersion: '1.60.19',
                  deviceModel: 'Quest 3',
                  visitorData: session.visitorData,
                  hl: 'en',
                  gl: 'US'
                }
              },
              videoId: videoId
            })
          });

          if (!playerRes.ok) {
            res.statusCode = playerRes.status;
            res.end(JSON.stringify({ error: 'YouTube player request failed' }));
            return;
          }

          const data: any = await playerRes.json();
          const formats = (data.streamingData?.adaptiveFormats || []).filter(
            (f: any) => f.mimeType?.includes('audio') && Boolean(f.url)
          );

          if (formats.length === 0) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'No direct audio format found for video' }));
            return;
          }

          // Sort by highest audio bitrate (Opus 160k or AAC 128k)
          formats.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
          const bestAudio = formats[0];

          // Fetch audio stream directly with Node.js
          const range = req.headers.range;
          const fetchHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          };
          if (range) fetchHeaders['Range'] = range;

          const streamRes = await fetch(bestAudio.url, { headers: fetchHeaders });
          
          res.statusCode = streamRes.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', streamRes.headers.get('content-type') || 'audio/mp4');
          if (streamRes.headers.get('content-length')) {
            res.setHeader('Content-Length', streamRes.headers.get('content-length')!);
          }
          if (streamRes.headers.get('content-range')) {
            res.setHeader('Content-Range', streamRes.headers.get('content-range')!);
          }
          res.setHeader('Accept-Ranges', 'bytes');

          if (!streamRes.body) {
            res.end();
            return;
          }

          const reader = streamRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (err: any) {
          console.error('[AudioDownloadPlugin Error]:', err?.message);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err?.message || 'Server error' }));
          }
        }
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), audioDownloadPlugin()],
  server: {
    proxy: {
      '/api/ytmusic': {
        target: 'https://music.youtube.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ytmusic/, '')
      },
      '/api/youtube': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/youtube/, '')
      },
      '/api/piped': {
        target: 'https://pipedapi.kavin.rocks',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/piped/, '')
      }
    }
  }
})
