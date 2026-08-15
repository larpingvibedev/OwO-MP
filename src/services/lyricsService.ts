export interface ParsedLyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  synced: ParsedLyricLine[] | null;
  plain: string | null;
  source: 'LRCLIB' | 'Genius' | 'Musixmatch' | 'Community' | 'None';
  isSynced: boolean;
  geniusUrl?: string;
  geniusTitle?: string;
  geniusArtist?: string;
  geniusThumbnail?: string;
}

/**
 * Clean track title and artist for maximum lyric search matching across LRCLIB and Genius.
 */
export function cleanLyricsSearchQuery(title: string, artist: string): { cleanTitle: string; cleanArtist: string } {
  const cleanTitle = (title || '')
    .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?|official|music video|audio|visualizer|remix|slowed|reverb|lyrics|lyric video|sped up|nightcore).*?[\)\]]/gi, '')
    .replace(/\s*-\s*(official|music video|audio|visualizer|remix|single|ep|lyrics|lyric video).*$/gi, '')
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanArtist = (artist || '')
    .split(/[,&/]| feat\.? | ft\.? | x /i)[0]
    .replace(/\s*-\s*topic/i, '')
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanTitle: cleanTitle || title,
    cleanArtist: cleanArtist || artist
  };
}

/**
 * Parse standard and extended LRC format into timed lines.
 */
export function parseLrcLyrics(lrcText: string): ParsedLyricLine[] {
  if (!lrcText) return [];

  const lines: ParsedLyricLine[] = [];
  const rawLines = lrcText.split('\n');

  // Matches [mm:ss.xx], [mm:ss.xxx], [hh:mm:ss.xx], [m:ss.xx]
  const lrcRegex = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata headers like [ar:Artist], [ti:Title], [al:Album], [by:Creator], [length:03:45]
    if (/^\[(ar|ti|al|by|length|offset|re|ve|tool):/i.test(trimmed)) {
      continue;
    }

    const match = trimmed.match(lrcRegex);
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const millisStr = match[4] || '0';
      const millis = parseInt(millisStr.padEnd(3, '0').slice(0, 3), 10);

      const time = hours * 3600 + minutes * 60 + seconds + millis / 1000;
      const text = match[5].trim();

      // Keep line even if empty (instrumental gap) or text
      lines.push({ time, text: text || '♪' });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Multi-Tier Lyric Fetcher:
 * 1. LRCLIB Exact Match
 * 2. LRCLIB Sanitized Match
 * 3. LRCLIB Search Endpoint
 * 4. LRCLIB Full Text Query
 * 5. Genius Search & Annotation Metadata Fallback
 */
export async function fetchLyrics(
  title: string,
  artist: string,
  album?: string,
  duration?: number
): Promise<LyricsResult> {
  if (!title || !artist) {
    return { synced: null, plain: null, source: 'None', isSynced: false };
  }

  const { cleanTitle, cleanArtist } = cleanLyricsSearchQuery(title, artist);

  // Parallel fetch: LRCLIB search + Genius metadata
  const [lrclibData, geniusData] = await Promise.allSettled([
    fetchLrcLib(title, artist, cleanTitle, cleanArtist, album, duration),
    fetchGeniusMetadata(cleanTitle, cleanArtist)
  ]);

  const lrc = lrclibData.status === 'fulfilled' ? lrclibData.value : null;
  const genius = geniusData.status === 'fulfilled' ? geniusData.value : null;

  if (lrc && (lrc.syncedLyrics || lrc.plainLyrics)) {
    const parsedSynced = lrc.syncedLyrics ? parseLrcLyrics(lrc.syncedLyrics) : null;
    return {
      synced: parsedSynced && parsedSynced.length > 0 ? parsedSynced : null,
      plain: lrc.plainLyrics || (parsedSynced ? parsedSynced.map(p => p.text).join('\n') : null),
      source: 'LRCLIB',
      isSynced: Boolean(parsedSynced && parsedSynced.length > 0),
      geniusUrl: genius?.url,
      geniusTitle: genius?.title,
      geniusArtist: genius?.artist,
      geniusThumbnail: genius?.thumbnail
    };
  }

  // Fallback: If Genius lyrics are found
  if (genius) {
    return {
      synced: null,
      plain: genius.plain || null,
      source: 'Genius',
      isSynced: false,
      geniusUrl: genius.url,
      geniusTitle: genius.title,
      geniusArtist: genius.artist,
      geniusThumbnail: genius.thumbnail
    };
  }

  return { synced: null, plain: null, source: 'None', isSynced: false };
}

/**
 * LRCLIB Multi-step Resolution
 */
async function fetchLrcLib(
  title: string,
  artist: string,
  cleanTitle: string,
  cleanArtist: string,
  album?: string,
  duration?: number
): Promise<{ syncedLyrics?: string; plainLyrics?: string } | null> {
  const tryGet = async (tName: string, aName: string) => {
    try {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.append('track_name', tName);
      url.searchParams.append('artist_name', aName);
      if (album) url.searchParams.append('album_name', album);
      if (duration && duration > 0) url.searchParams.append('duration', Math.round(duration).toString());

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics || data.plainLyrics) return data;
      }
    } catch {}
    return null;
  };

  // 1. Try Exact Get
  let result = await tryGet(title, artist);
  if (result) return result;

  // 2. Try Cleaned Title & Artist Get
  if (cleanTitle !== title || cleanArtist !== artist) {
    result = await tryGet(cleanTitle, cleanArtist);
    if (result) return result;
  }

  // 3. Try LRCLIB Search with track_name & artist_name
  try {
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    const searchRes = await fetch(searchUrl);
    if (searchRes.ok) {
      const list = await searchRes.json();
      if (Array.isArray(list) && list.length > 0) {
        // Prioritize items with syncedLyrics
        const syncedItem = list.find((item: any) => item.syncedLyrics);
        if (syncedItem) return syncedItem;
        if (list[0].plainLyrics) return list[0];
      }
    }
  } catch {}

  // 4. Try LRCLIB general Query Search
  try {
    const qUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`;
    const qRes = await fetch(qUrl);
    if (qRes.ok) {
      const list = await qRes.json();
      if (Array.isArray(list) && list.length > 0) {
        const syncedItem = list.find((item: any) => item.syncedLyrics);
        if (syncedItem) return syncedItem;
        if (list[0].plainLyrics) return list[0];
      }
    }
  } catch {}

  return null;
}

/**
 * Fetch Genius Song Metadata & Full Plain Lyrics
 */
async function fetchGeniusMetadata(
  cleanTitle: string,
  cleanArtist: string
): Promise<{ url: string; title: string; artist: string; thumbnail?: string; plain?: string } | null> {
  const query = `${cleanArtist} ${cleanTitle}`.trim();

  // 1. If running inside Electron, use native IPC extractor (bypasses all browser CORS limitations)
  if ((window as any).electronAPI?.getGeniusLyrics) {
    try {
      const data = await (window as any).electronAPI.getGeniusLyrics(query);
      if (data && data.plain) {
        return data;
      }
    } catch (e) {}
  }

  // 2. Direct web fetch fallback
  try {
    const res = await fetch(`https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      const sections = data?.response?.sections || [];
      const songHit = sections.flatMap((s: any) => s.hits || []).find((h: any) => h.type === 'song' || h.result?._type === 'song');
      if (songHit?.result?.url) {
        const hit = songHit.result;
        return {
          url: hit.url,
          title: hit.title,
          artist: hit.primary_artist?.name || cleanArtist,
          thumbnail: hit.song_art_image_thumbnail_url || hit.header_image_thumbnail_url
        };
      }
    }
  } catch {}
  return null;
}
