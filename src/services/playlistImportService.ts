import type { Track } from '../types';
import { prefetchTrackVideoId } from './musicSearch';

export interface RawImportTrack {
  title: string;
  artist: string;
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
              rawTracks.push({
                videoId,
                title: titleContent,
                artist: artistName || author || 'YouTube Music',
                thumbnail: thumb
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
              rawTracks.push({
                videoId,
                title: titleText,
                artist: artistText || author || 'YouTube Music',
                thumbnail: thumb,
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
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${inst}/api/v1/playlists/${playlistId}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const pl = await res.json();
        if (pl && pl.videos && Array.isArray(pl.videos)) {
          const rawTracks: RawImportTrack[] = pl.videos.map((v: any) => ({
            videoId: v.videoId,
            title: v.title,
            artist: v.author || pl.author || 'YouTube Music',
            thumbnail: v.videoThumbnails?.slice(-1)?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: v.lengthSeconds || 0
          })).filter((t: RawImportTrack) => t.videoId && t.title);

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
    } catch (e) {
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
    if (signal?.aborted) throw new Error('Import cancelled.');
    const raw = rawTracks[i];
    if (!raw) continue;

    if (raw.videoId) {
      resolvedTracks.push({
        id: `piped-${raw.videoId}`,
        title: raw.title,
        artist: raw.artist,
        albumArtist: raw.artist,
        album: 'YouTube Playlist',
        duration: raw.duration || 0,
        cover: raw.thumbnail || `https://i.ytimg.com/vi/${raw.videoId}/hqdefault.jpg`,
        streamUrl: `https://www.youtube.com/watch?v=${raw.videoId}`,
        source: 'youtube',
        category: 'song'
      });
    } else {
      // Spotify track: complete metadata. Audio stream resolved on-demand when played
      resolvedTracks.push({
        id: `spotify-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
        title: raw.title,
        artist: raw.artist,
        albumArtist: raw.artist,
        album: 'Spotify Playlist',
        duration: raw.duration || 0,
        cover: raw.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        streamUrl: `${raw.artist} - ${raw.title}`,
        source: 'youtube',
        category: 'song'
      });
    }

    if (onProgress && (i % batchStep === 0 || i === total - 1)) {
      onProgress(i + 1, total, raw.title);
      if (total > 50 && i % batchStep === 0) {
        await new Promise(r => setTimeout(r, 6));
      }
    }
  }

  // Pre-fetch top 3 tracks in background for instant playback if played immediately
  const topSeeds = resolvedTracks.slice(0, 3);
  topSeeds.forEach(t => {
    prefetchTrackVideoId(t);
  });

  return resolvedTracks;
}
