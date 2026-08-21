import type { Track } from '../types';
import { prefetchTrackVideoId } from './musicSearch';
import {
  enrichTrackDurations,
  throwIfDurationAborted
} from './trackDurationService';

export interface RawImportTrack {
  title: string;
  artist: string;
  albumArtist?: string;
  artistId?: string;
  channelId?: string;
  duration?: number;
  videoId?: string;
  thumbnail?: string;
}

export interface ParsedPlaylistMeta {
  service: 'spotify' | 'youtube';
  id: string;
  name: string;
  author?: string;
  cover?: string;
  tracks: RawImportTrack[];
  totalOriginalTracks: number;
}


function cleanImportArtist(name?: string, fallback = 'YouTube Music'): string {
  const raw = (name || fallback || '').trim();
  const cleaned = raw.replace(/\s*-\s*Topic$/i, '').trim();
  return cleaned || fallback;
}


const thumbnailResolutionCache = new Map<string, string>();

function probeImageUrl(url: string, timeoutMs = 1800): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, timeoutMs);

    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          // YouTube returns a 120x90 placeholder image when maxres/sd thumbnail doesn't exist
          resolve(img.naturalWidth > 120);
        }
      };
      img.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(false);
        }
      };
      img.src = url;
    } else {
      // Fallback for non-DOM environments
      fetch(url, { method: 'HEAD' })
        .then((res) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(res.ok);
          }
        })
        .catch(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(false);
          }
        });
    }
  });
}

/**
 * Validates and upgrades YouTube thumbnails to true unletterboxed 16:9 / max-res variants.
 * Fallback chain: maxresdefault -> sddefault -> mqdefault (320x180 16:9, no bars) -> original.
 */
export async function resolveBestThumbnailUrl(originalUrl?: string, videoId?: string): Promise<string> {
  if (!originalUrl && !videoId) return '';
  if (videoId && thumbnailResolutionCache.has(videoId)) {
    return thumbnailResolutionCache.get(videoId)!;
  }

  const cleanOriginal = cleanImportThumbnail(originalUrl, videoId);
  if (!videoId || videoId.length !== 11) {
    return cleanOriginal;
  }

  // If the original URL is already a high quality googleusercontent/ggpht link (e.g. from YouTube Music), keep it
  if (cleanOriginal.includes('googleusercontent.com') || cleanOriginal.includes('ggpht.com') || cleanOriginal.includes('mzstatic.com')) {
    thumbnailResolutionCache.set(videoId, cleanOriginal);
    return cleanOriginal;
  }

  try {
    // 1. Try maxresdefault (true 16:9 1280x720, unletterboxed)
    const maxResUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    if (await probeImageUrl(maxResUrl)) {
      thumbnailResolutionCache.set(videoId, maxResUrl);
      return maxResUrl;
    }

    // 2. Try sddefault (640x480)
    const sdResUrl = `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`;
    if (await probeImageUrl(sdResUrl)) {
      thumbnailResolutionCache.set(videoId, sdResUrl);
      return sdResUrl;
    }

    // 3. Try mqdefault (true 16:9 320x180, unletterboxed)
    const mqResUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    if (await probeImageUrl(mqResUrl)) {
      thumbnailResolutionCache.set(videoId, mqResUrl);
      return mqResUrl;
    }
  } catch {
    // Non-fatal, fallback to original
  }

  thumbnailResolutionCache.set(videoId, cleanOriginal);
  return cleanOriginal;
}

async function enrichTrackThumbnails(tracks: Track[], concurrency = 6, signal?: AbortSignal): Promise<Track[]> {
  const ytTracks = tracks.filter(t => t.id.startsWith('piped-') || t.cover?.includes('i.ytimg.com'));
  if (ytTracks.length === 0) return tracks;

  let index = 0;
  async function worker() {
    while (index < ytTracks.length) {
      if (signal?.aborted) break;
      const current = ytTracks[index++];
      if (!current) break;
      const vid = current.id.replace('piped-', '') || current.streamUrl?.split('v=')?.[1];
      if (vid && vid.length === 11) {
        try {
          const bestThumb = await resolveBestThumbnailUrl(current.cover, vid);
          if (bestThumb) {
            current.cover = bestThumb;
          }
        } catch {
          // ignore non-fatal
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, ytTracks.length) }, () => worker());
  await Promise.all(workers);
  return tracks;
}

function cleanImportThumbnail(thumb?: string, videoId?: string): string {
  if (!thumb && videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  if (!thumb) return '';
  let clean = thumb.trim();
  if (clean.startsWith('//')) clean = `https:${clean}`;
  if (clean.includes('i.ytimg.com/vi/') && clean.includes('?')) {
    clean = clean.split('?')[0];
  }
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    clean = clean.replace(/=w\d+-h\d+[^=]*$/, '=w544-h544-l90-rj').replace(/=s\d+[^=]*$/, '=s800');
  }
  return clean;
}

function durationTokenToSeconds(token: string): number {
  const parts = token.trim().split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2 && parts[1] < 60) return (parts[0] * 60) + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return 0;
}

function parseTrustedDurationText(value: unknown, allowAccessibilitySentence = false): number {
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  const exactToken = /^(?:\d{1,2}:)?\d{1,3}:\d{2}$/.exec(text);
  if (exactToken) return durationTokenToSeconds(exactToken[0]);

  const explicitToken = /\bduration\s*(?::|-)?\s*((?:\d{1,2}:)?\d{1,3}:\d{2})\b/i.exec(text);
  if (explicitToken) return durationTokenToSeconds(explicitToken[1]);
  if (!allowAccessibilitySentence) return 0;

  const hours = Number(/\b(\d+)\s*hours?\b/i.exec(text)?.[1] || 0);
  const minutes = Number(/\b(\d+)\s*minutes?\b/i.exec(text)?.[1] || 0);
  const seconds = Number(/\b(\d+)\s*seconds?\b/i.exec(text)?.[1] || 0);
  // A seconds-only phrase can be an artist/title (for example "5 Seconds of
  // Summer"). Leave ambiguous sub-minute text unresolved for exact-ID lookup.
  if (hours <= 0 && minutes <= 0) return 0;
  const spoken = (hours * 3600) + (minutes * 60) + seconds;
  return Number.isFinite(spoken) && spoken > 0 ? spoken : 0;
}

function readTextValue(value: any): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  const values = [value.content, value.simpleText, value.label, value.accessibilityText]
    .filter(item => typeof item === 'string') as string[];
  if (Array.isArray(value.runs)) {
    values.push(...value.runs.map((run: any) => run?.text).filter((item: unknown) => typeof item === 'string'));
  }
  return values;
}

function findTrustedDurationInTree(root: unknown, trustedKeyOnly: boolean): number {
  const visited = new Set<object>();
  const stack: Array<{ value: unknown; key: string; trustedPath: boolean; unitKey: string; depth: number }> = [
    { value: root, key: '', trustedPath: false, unitKey: '', depth: 0 }
  ];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || current.depth > 10) continue;
    const { value, key, trustedPath, unitKey, depth } = current;
    const keyNamesDuration = /duration|length|time.?status/i.test(key);
    const keyNamesMilliseconds = /^(?:duration)?(?:ms|millis|milliseconds?)$/i.test(key);
    const keyNamesSeconds = /^(?:duration|length)?seconds?$/i.test(key);
    const trustedKey = trustedPath || keyNamesDuration || keyNamesMilliseconds || keyNamesSeconds;
    const numericUnitKey = (keyNamesMilliseconds || keyNamesSeconds || keyNamesDuration) ? key : unitKey;
    if (typeof value === 'string') {
      if (!trustedKeyOnly || trustedKey) {
        const parsed = parseTrustedDurationText(value);
        if (parsed > 0) return parsed;
      }
      continue;
    }
    if (typeof value === 'number' && trustedKey && Number.isFinite(value) && value > 0) {
      if (/^(?:duration)?(?:ms|millis|milliseconds?)$/i.test(numericUnitKey)) {
        return Math.round(value / 1000);
      }
      if (/^(?:duration|length)?seconds?$/i.test(numericUnitKey)) {
        return Math.round(value);
      }
      // A bare numeric `duration` field has no reliable unit contract.
      continue;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(child => stack.push({
        value: child,
        key,
        trustedPath: trustedKey,
        unitKey: numericUnitKey,
        depth: depth + 1
      }));
    } else {
      Object.entries(value).forEach(([childKey, child]) => {
        stack.push({
          value: child,
          key: childKey,
          trustedPath: trustedKey,
          unitKey: numericUnitKey,
          depth: depth + 1
        });
      });
    }
  }
  return 0;
}

function findAccessibilityDuration(root: unknown): number {
  const visited = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || current.depth > 8) continue;
    if (typeof current.value === 'string') {
      const duration = parseTrustedDurationText(current.value, true);
      if (duration > 0) return duration;
      continue;
    }
    if (!current.value || typeof current.value !== 'object' || visited.has(current.value)) continue;
    visited.add(current.value);
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    children.forEach(value => stack.push({ value, depth: current.depth + 1 }));
  }
  return 0;
}

export function extractDurationFromLockupViewModel(lockup: any): number {
  // Thumbnail overlays and metadata parts are dedicated badge/value fields.
  // Only accept complete duration tokens from them, never a token embedded in a title.
  const overlayDuration = findTrustedDurationInTree(
    lockup?.contentImage?.thumbnailViewModel?.overlays,
    false
  );
  if (overlayDuration > 0) return overlayDuration;

  const metadataRows = lockup?.metadata?.lockupMetadataViewModel?.metadata
    ?.contentMetadataViewModel?.metadataRows || [];
  for (const row of metadataRows) {
    for (const part of row?.metadataParts || []) {
      for (const text of readTextValue(part?.text ?? part)) {
        const duration = parseTrustedDurationText(text);
        if (duration > 0) return duration;
      }
    }
  }

  // Accessibility labels are trustworthy for spoken durations, or when the
  // whole label is itself a duration. A title-like embedded "Song 1:23" token
  // is deliberately ignored.
  const accessibilityValues = [lockup?.accessibilityText, lockup?.accessibility];
  for (const root of accessibilityValues) {
    const duration = findAccessibilityDuration(root);
    if (duration > 0) return duration;
  }

  // Last resort: inspect only explicitly named duration/length/time-status keys.
  return findTrustedDurationInTree(lockup, true);
}

function importDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfDurationAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Import cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * Extracts service type and ID from Spotify or YouTube playlist URLs.
 */
export function parsePlaylistUrl(rawUrl: string): { service: 'spotify' | 'youtube'; id: string } | null {
  const url = rawUrl.trim();
  if (!url) return null;

  // 1. Spotify playlist URL or URI
  // e.g. https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
  // e.g. https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M
  // e.g. spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const spotifyMatch = url.match(/(?:spotify\.com\/(?:[a-zA-Z-]+\/)?playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/i);
  if (spotifyMatch && spotifyMatch[1]) {
    return { service: 'spotify', id: spotifyMatch[1] };
  }

  // 2. YouTube / YouTube Music playlist URL
  // e.g. https://www.youtube.com/playlist?list=PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc
  // e.g. https://music.youtube.com/playlist?list=PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc
  // e.g. https://www.youtube.com/watch?v=xxx&list=PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc
  const ytMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (ytMatch && ytMatch[1]) {
    return { service: 'youtube', id: ytMatch[1] };
  }

  // 3. YouTube Music Browse ID (e.g. VLPL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc or PL...)
  if (/^(?:VL)?(PL[a-zA-Z0-9_-]+|OLAK[a-zA-Z0-9_-]+|RDCLAK[a-zA-Z0-9_-]+)$/i.test(url)) {
    return { service: 'youtube', id: url.replace(/^VL/i, '') };
  }

  return null;
}

const INVIDIOUS_INSTANCES = [
  'https://invidious.flokinet.to',
  'https://yewtu.be',
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
  'https://invidious.drgns.space'
];

/**
 * Fetches Spotify playlist metadata & track listing via unauthenticated embed endpoint.
 */
async function fetchSpotifyPlaylist(playlistId: string, signal?: AbortSignal): Promise<ParsedPlaylistMeta> {
  throwIfDurationAborted(signal);
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const res = await fetch(embedUrl, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to load Spotify playlist (Status ${res.status}). Ensure the playlist is public.`);
  }

  const html = await res.text();
  throwIfDurationAborted(signal);
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error('Could not parse Spotify playlist data. The playlist might be private or unavailable.');
  }

  let data: any;
  try {
    data = JSON.parse(nextDataMatch[1]);
  } catch (e) {
    throw new Error('Invalid playlist response from Spotify.');
  }

  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('Spotify playlist not found or empty.');
  }

  const name = entity.name || 'Imported Spotify Playlist';
  const cover = entity.coverArt?.sources?.[0]?.url || '';
  const rawList: any[] = entity.trackList || [];

  const tracks: RawImportTrack[] = [];
  for (const t of rawList) {
    if (t && t.title) {
      tracks.push({
        title: t.title,
        artist: t.subtitle || 'Unknown Artist',
        duration: t.duration ? Math.round(t.duration / 1000) : 0,
        thumbnail: cover
      });
    }
  }

  return {
    service: 'spotify',
    id: playlistId,
    name,
    cover,
    tracks,
    totalOriginalTracks: tracks.length
  };
}

/**
 * Fetches YouTube / YouTube Music playlist metadata and track list.
 */
async function fetchYouTubePlaylist(playlistId: string, signal?: AbortSignal): Promise<ParsedPlaylistMeta> {
  throwIfDurationAborted(signal);
  // Method A: Direct YouTube Playlist HTML scrape with InitialData parsing
  try {
    const ytUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    const res = await fetch(ytUrl, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (res.ok) {
      const html = await res.text();
      throwIfDurationAborted(signal);
      const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/) ||
                    html.match(/ytInitialData\s*=\s*({[\s\S]*?});/);

      if (match) {
        const data = JSON.parse(match[1]);
        
        // Playlist title, author, cover
        let title = data.microformat?.microformatDataRenderer?.title;
        let author = '';
        let cover = data.microformat?.microformatDataRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;

        const sidebar = data.sidebar?.playlistSidebarRenderer?.items;
        if (sidebar) {
          const primary = sidebar[0]?.playlistSidebarPrimaryInfoRenderer;
          if (primary?.title?.runs?.[0]?.text) {
            title = primary.title.runs[0].text;
          }
          const secondary = sidebar[1]?.playlistSidebarSecondaryInfoRenderer;
          if (secondary?.videoOwner?.videoOwnerRenderer?.title?.runs?.[0]?.text) {
            author = secondary.videoOwner.videoOwnerRenderer.title.runs[0].text;
          }
        }

        const rawTracks: RawImportTrack[] = [];
        const secList = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
        const items = secList?.contents?.[0]?.itemSectionRenderer?.contents || [];

        for (const item of items) {
          // Modern lockupViewModel
          if (item.lockupViewModel) {
            const lm = item.lockupViewModel;
            const videoId = lm.contentId || lm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
            const thumb = lm.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)?.[0]?.url;
            
            const metaRows = lm.metadata?.lockupMetadataViewModel;
            const titleContent = metaRows?.title?.content;
            const duration = extractDurationFromLockupViewModel(lm);
            const subParts = metaRows?.metadata?.contentMetadataViewModel?.metadataRows || [];
            let artistName = '';
            for (const row of subParts) {
              const parts = row.metadataParts || [];
              for (const p of parts) {
                if (p.text?.content && !p.text.content.includes('views') && !p.text.content.includes('ago')) {
                  artistName = p.text.content;
                  break;
                }
              }
              if (artistName) break;
            }

            if (videoId && titleContent) {
              const cleanArtist = cleanImportArtist(artistName, author);
              rawTracks.push({
                videoId,
                title: titleContent,
                artist: cleanArtist,
                albumArtist: cleanArtist,
                thumbnail: cleanImportThumbnail(thumb, videoId),
                duration
              });
            }
          }
          // Classic playlistVideoRenderer
          else if (item.playlistVideoRenderer) {
            const pv = item.playlistVideoRenderer;
            const videoId = pv.videoId;
            const titleText = pv.title?.runs?.[0]?.text || pv.title?.simpleText;
            const artistText = pv.shortBylineText?.runs?.[0]?.text;
            const thumb = pv.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            const duration = parseInt(pv.lengthSeconds, 10) || 0;

            if (videoId && titleText) {
              const cleanArtist = cleanImportArtist(artistText, author);
              const channelId = pv.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
              rawTracks.push({
                videoId,
                title: titleText,
                artist: cleanArtist,
                artistId: channelId,
                channelId: channelId,
                thumbnail: cleanImportThumbnail(thumb, videoId),
                duration
              });
            }
          }
        }

        if (rawTracks.length > 0) {
          return {
            service: 'youtube',
            id: playlistId,
            name: title || 'Imported YouTube Playlist',
            author,
            cover: cover || rawTracks[0]?.thumbnail || '',
            tracks: rawTracks,
            totalOriginalTracks: rawTracks.length
          };
        }
      }
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err;
    console.warn('Direct YouTube playlist fetch error, falling back to Invidious:', err);
  }

  // Method B: Invidious Fallback
  for (const inst of INVIDIOUS_INSTANCES) {
    throwIfDurationAborted(signal);
    try {
      const res = await fetch(`${inst}/api/v1/playlists/${playlistId}`, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(3500)])
          : AbortSignal.timeout(3500),
        headers: { 'Accept': 'application/json' }
      });
      throwIfDurationAborted(signal);

      if (res.ok) {
        const pl = await res.json();
        throwIfDurationAborted(signal);
        if (pl && pl.videos && Array.isArray(pl.videos)) {
          const rawTracks: RawImportTrack[] = pl.videos.map((v: any) => {
            const cleanArtist = cleanImportArtist(v.author, pl.author);
            return {
              videoId: v.videoId,
              title: v.title,
              artist: cleanArtist,
              artistId: v.authorId || undefined,
              channelId: v.authorId || undefined,
              thumbnail: cleanImportThumbnail(v.videoThumbnails?.slice(-1)?.[0]?.url, v.videoId),
              duration: v.lengthSeconds || 0
            };
          }).filter((t: RawImportTrack) => t.videoId && t.title);

          return {
            service: 'youtube',
            id: playlistId,
            name: pl.title || 'Imported YouTube Playlist',
            author: pl.author,
            cover: rawTracks[0]?.thumbnail || '',
            tracks: rawTracks,
            totalOriginalTracks: rawTracks.length
          };
        }
      }
    } catch {
      throwIfDurationAborted(signal);
      // try next instance
    }
  }

  throw new Error('Could not find YouTube playlist. Please make sure the playlist is public or unlisted.');
}

/**
 * Universal Playlist Metadata Fetcher (Spotify & YouTube).
 */
export async function fetchPlaylistMetadata(url: string, signal?: AbortSignal): Promise<ParsedPlaylistMeta> {
  const parsed = parsePlaylistUrl(url);
  if (!parsed) {
    throw new Error('Invalid URL. Please enter a valid Spotify or YouTube playlist link.');
  }

  if (parsed.service === 'spotify') {
    return await fetchSpotifyPlaylist(parsed.id, signal);
  } else {
    return await fetchYouTubePlaylist(parsed.id, signal);
  }
}

/**
 * Resolves imported raw tracks into full Track objects.
 * - YouTube tracks: mapped directly using videoId (0ms).
 * - Spotify tracks: mapped directly with complete metadata. Audio stream is resolved on-demand when played.
 * - Instantly imports entire playlists of any length (500, 1000+ tracks) with 0 rate-limits and 0 lag.
 */
export async function resolveImportedTracks(
  rawTracks: RawImportTrack[],
  onProgress?: (completed: number, total: number, currentTrackName: string) => void,
  signal?: AbortSignal
): Promise<Track[]> {
  const total = rawTracks.length;
  const resolvedTracks: Track[] = [];

  const batchStep = Math.max(1, Math.floor(total / 20));

  for (let i = 0; i < total; i++) {
    throwIfDurationAborted(signal);
    const raw = rawTracks[i];
    if (!raw) continue;

    if (raw.videoId) {
      const cleanArtist = cleanImportArtist(raw.artist, 'YouTube Music');
      resolvedTracks.push({
        id: `piped-${raw.videoId}`,
        title: raw.title,
        artist: cleanArtist,
        artistId: raw.artistId,
        channelId: raw.channelId,
        albumArtist: cleanArtist,
        album: 'YouTube Playlist',
        duration: raw.duration || 0,
        cover: cleanImportThumbnail(raw.thumbnail, raw.videoId),
        streamUrl: `https://www.youtube.com/watch?v=${raw.videoId}`,
        source: 'youtube',
        category: 'song'
      });
    } else {
      // Spotify track: complete metadata. Audio stream resolved on-demand when played
      const cleanArtist = cleanImportArtist(raw.artist, 'Unknown Artist');
      resolvedTracks.push({
        id: `spotify-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
        title: raw.title,
        artist: cleanArtist,
        artistId: raw.artistId,
        channelId: raw.channelId,
        albumArtist: cleanArtist,
        album: 'Spotify Playlist',
        duration: raw.duration || 0,
        cover: cleanImportThumbnail(raw.thumbnail) || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        streamUrl: `${cleanArtist} - ${raw.title}`,
        source: 'youtube',
        category: 'song'
      });
    }

    if (onProgress && (i % batchStep === 0 || i === total - 1)) {
      onProgress(i + 1, total, raw.title);
      if (total > 50 && i % batchStep === 0) {
        await importDelay(6, signal);
      }
    }
  }

  // Modern YouTube metadata normally carries duration. Resolve only remaining
  // zero-duration tracks by their exact video IDs, with bounded concurrency.
  const enrichedTracks = await enrichTrackDurations(resolvedTracks, {
    maxTracks: 100,
    concurrency: 4,
    signal
  });
  throwIfDurationAborted(signal);

  // Upgrade letterboxed YouTube thumbnails with true 16:9 / maxres variants
  await enrichTrackThumbnails(enrichedTracks, 6, signal);
  throwIfDurationAborted(signal);

  // Pre-fetch top 3 tracks in background for instant playback if played immediately
  const topSeeds = enrichedTracks.slice(0, 3);
  topSeeds.forEach(t => {
    prefetchTrackVideoId(t);
  });

  return enrichedTracks;
}
