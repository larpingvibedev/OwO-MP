export interface ParsedLyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  synced: ParsedLyricLine[] | null;
  plain: string | null;
  source: 'LRCLIB' | 'Genius' | 'Musixmatch' | 'AZLyrics' | 'Community' | 'None';
  isSynced: boolean;
  geniusUrl?: string;
  geniusTitle?: string;
  geniusArtist?: string;
  geniusThumbnail?: string;
}

/**
 * Clean plain lyric strings to remove stray LRC metadata tags (like [offset:xxx], [ar:xxx])
 */
export function cleanPlainLyricsText(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\[(ar|ti|al|by|length|offset|re|ve|tool|encoding):/i.test(trimmed)) return false;
      if (/^\d+\s*Contributors$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Clean track title and artist for maximum lyric search matching across all providers.
 */
export function cleanLyricsSearchQuery(title: string, artist: string): { cleanTitle: string; cleanArtist: string; baseTitle: string } {
  let cleanTitle = (title || '')
    .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?|official|music video|audio|visualizer|remix|slowed|reverb|lyrics|lyric video|sped up|nightcore|unreleased|full version|no ai|hq|hd|clean|explicit|deluxe|bonus|extended|live).*?[\)\]]/gi, '')
    .replace(/\s*-\s*(official|music video|audio|visualizer|remix|single|ep|lyrics|lyric video|unreleased|full version).*$/gi, '')
    .replace(/\b(full version|official audio|music video|official video|lyric video|visualizer|unreleased|no ai|sped up|nightcore|slowed \+ reverb|slowed and reverb|slowed reverb)\b/gi, '')
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const baseTitle = (title || '')
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .replace(/\s*-\s*.*$/g, '')
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
    baseTitle: baseTitle || cleanTitle || title,
    cleanArtist: cleanArtist || artist
  };
}

/**
 * Fetch Official YouTube Music / Musixmatch Synchronized Subtitles via InnerTube
 */
async function fetchYouTubeMusicMusixmatchLyrics(
  videoId?: string,
  title?: string,
  artist?: string
): Promise<LyricsResult | null> {
  const context = {
    client: {
      clientName: 'ANDROID_MUSIC',
      clientVersion: '6.43.52',
      osName: 'Android',
      osVersion: '13',
      hl: 'en',
      gl: 'US'
    }
  };

  const tryGetFromId = async (vId: string): Promise<LyricsResult | null> => {
    if (!vId || vId.startsWith('local-')) return null;
    try {
      // 1. Get lyrics browseId from Next
      const nextRes = await fetch('https://music.youtube.com/youtubei/v1/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, videoId: vId })
      });
      if (!nextRes.ok) return null;
      const nextData = await nextRes.json();
      const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
      const lyricsTab = tabs.find((t: any) => t?.tabRenderer?.endpoint?.browseEndpoint?.browseId?.startsWith('MPLYt'));
      const browseId = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
      if (!browseId) return null;

      // 2. Fetch lyrics Browse data
      const browseRes = await fetch('https://music.youtube.com/youtubei/v1/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, browseId })
      });
      if (!browseRes.ok) return null;
      const browseData = await browseRes.json();

      // 3. Extract Timed Lyrics (Musixmatch) with cue verification
      const timedLyrics = browseData?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData?.timedLyricsData;
      if (Array.isArray(timedLyrics) && timedLyrics.length > 0) {
        const hasValidCues = timedLyrics.some(item => 
          item?.cueRange?.startTimeMilliseconds !== undefined && 
          parseInt(item.cueRange.startTimeMilliseconds, 10) > 0
        );

        if (hasValidCues) {
          const synced: ParsedLyricLine[] = timedLyrics
            .map((item: any) => ({
              time: (parseInt(item?.cueRange?.startTimeMilliseconds, 10) || 0) / 1000,
              text: item?.lyricLine || '♪'
            }))
            .filter((l: ParsedLyricLine) => l.text.trim());

          const plain = synced.map(l => l.text).join('\n');
          return {
            synced,
            plain: cleanPlainLyricsText(plain),
            source: 'Musixmatch',
            isSynced: true
          };
        } else {
          // If no timing cues, use as static plain lyrics
          const plain = timedLyrics
            .map((item: any) => item?.lyricLine || '')
            .filter((t: string) => t.trim())
            .join('\n');
          if (plain) {
            return {
              synced: null,
              plain: cleanPlainLyricsText(plain),
              source: 'Musixmatch',
              isSynced: false
            };
          }
        }
      }

      // 4. Extract Plain Lyrics fallback from Description Shelf
      const sectionList = browseData?.contents?.sectionListRenderer?.contents || [];
      for (const section of sectionList) {
        const shelf = section?.musicDescriptionShelfRenderer;
        if (shelf?.description?.runs) {
          const plain = shelf.description.runs.map((r: any) => r.text).join('').trim();
          if (plain) {
            return {
              synced: null,
              plain: cleanPlainLyricsText(plain),
              source: 'Musixmatch',
              isSynced: false
            };
          }
        }
      }
    } catch (e) {}
    return null;
  };

  // 1. Try directly with current videoId if provided
  let directResult: LyricsResult | null = null;
  if (videoId && !videoId.startsWith('local-')) {
    directResult = await tryGetFromId(videoId);
    if (directResult && directResult.synced) return directResult;
  }

  // 2. If direct videoId didn't have valid synced lyrics or wasn't provided, resolve official release candidates on YouTube Music
  if (title && artist) {
    try {
      const { cleanTitle, cleanArtist } = cleanLyricsSearchQuery(title, artist);
      const query = `${cleanArtist} ${cleanTitle}`.trim();
      if (query) {
        const searchContext = {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        };

        const res = await fetch('https://music.youtube.com/youtubei/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: searchContext, query })
        });
        if (res.ok) {
          const data = await res.json();
          const str = JSON.stringify(data);
          const videoIdMatches = Array.from(str.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)).map(m => m[1]);
          const uniqueIds = Array.from(new Set(videoIdMatches)).filter(id => id !== videoId).slice(0, 5);

          for (const candId of uniqueIds) {
            const resolvedResult = await tryGetFromId(candId);
            if (resolvedResult && resolvedResult.synced) {
              return resolvedResult;
            }
          }
        }
      }
    } catch (e) {}
  }

  return directResult;
}

/**
 * Parse standard and extended LRC format into timed lines with multi-timestamp handling.
 */
export function parseLrcLyrics(lrcText: string): ParsedLyricLine[] {
  if (!lrcText) return [];

  let globalOffsetSeconds = 0;
  const lines: ParsedLyricLine[] = [];
  const rawLines = lrcText.split('\n');

  // 1. First pass: extract [offset:+/-millis]
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    const offsetMatch = trimmed.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch) {
      globalOffsetSeconds = parseInt(offsetMatch[1], 10) / 1000;
    }
  }

  // 2. Second pass: parse timestamps (supporting multi-timestamp lines like [01:23.45][02:34.56]Text)
  const timeTagRegex = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata headers
    if (/^\[(ar|ti|al|by|length|offset|re|ve|tool|encoding):/i.test(trimmed)) {
      continue;
    }

    const matches = Array.from(trimmed.matchAll(timeTagRegex));
    if (matches.length > 0) {
      const text = trimmed.replace(timeTagRegex, '').trim();

      for (const match of matches) {
        const hours = match[1] ? parseInt(match[1], 10) : 0;
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const millisStr = match[4] || '0';
        const millis = parseInt(millisStr.padEnd(3, '0').slice(0, 3), 10);

        const rawTime = hours * 3600 + minutes * 60 + seconds + millis / 1000;
        const finalTime = Math.max(0, rawTime + globalOffsetSeconds);

        lines.push({
          time: finalTime,
          text: text || '♪'
        });
      }
    }
  }

  // Ensure timestamps are valid and increasing
  const sorted = lines.sort((a, b) => a.time - b.time);
  const hasDistinctTimings = sorted.length > 1 && sorted[sorted.length - 1].time > sorted[0].time;
  return hasDistinctTimings ? sorted : [];
}

/**
 * Score and rank LRCLIB search candidates to pick the candidate with closest duration and accurate sync.
 */
function rankLrcLibCandidates(
  candidates: any[],
  cleanTitle: string,
  cleanArtist: string,
  duration?: number
): any | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const scored = candidates.map(item => {
    let score = 0;
    if (item.syncedLyrics) score += 100;
    else if (item.plainLyrics) score += 20;

    const tName = (item.trackName || '').toLowerCase();
    const aName = (item.artistName || '').toLowerCase();
    const cTitle = cleanTitle.toLowerCase();
    const cArtist = cleanArtist.toLowerCase();

    if (tName === cTitle) score += 30;
    else if (tName.includes(cTitle) || cTitle.includes(tName)) score += 15;

    if (aName === cArtist) score += 30;
    else if (aName.includes(cArtist) || cArtist.includes(aName)) score += 15;

    // Duration match
    if (duration && duration > 0 && item.duration && item.duration > 0) {
      const diff = Math.abs(item.duration - duration);
      if (diff <= 3) score += 40;
      else if (diff <= 8) score += 25;
      else if (diff <= 20) score += 10;
      else if (diff > 45) score -= 30;
    }

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

/**
 * LRCLIB Multi-step Resolution with Candidate Ranking
 */
async function fetchLrcLib(
  title: string,
  artist: string,
  cleanTitle: string,
  cleanArtist: string,
  album?: string,
  duration?: number
): Promise<{ syncedLyrics?: string; plainLyrics?: string; duration?: number } | null> {
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
  if (result?.syncedLyrics) return result;

  // 2. Try Cleaned Title & Artist Get
  if (cleanTitle !== title || cleanArtist !== artist) {
    result = await tryGet(cleanTitle, cleanArtist);
    if (result?.syncedLyrics) return result;
  }

  // 3. Search multi-endpoints in parallel to collect all candidate cuts
  const searchUrls = [
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`,
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`
  ];

  const candidatePromises = searchUrls.map(async (u) => {
    try {
      const res = await fetch(u);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) return list;
      }
    } catch {}
    return [];
  });

  const searchResults = await Promise.allSettled(candidatePromises);
  const allCandidates: any[] = [];
  const seenIds = new Set<number>();

  for (const r of searchResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const item of r.value) {
        if (item && item.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          allCandidates.push(item);
        }
      }
    }
  }

  if (allCandidates.length > 0) {
    const best = rankLrcLibCandidates(allCandidates, cleanTitle, cleanArtist, duration);
    if (best) return best;
  }

  return result || null;
}

/**
 * Fetch Full Plain Lyrics from AZLyrics
 */
async function fetchAZLyrics(
  title: string,
  artist: string
): Promise<{ plain: string; source: 'AZLyrics' } | null> {
  try {
    const cleanA = (artist || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanT = (title || '')
      .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?|official|music video|audio|visualizer|remix|slowed|reverb|lyrics|lyric video|sped up|nightcore|unreleased|full version|no ai|hq|hd|clean|explicit|deluxe|bonus|extended|live).*?[\)\]]/gi, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    if (!cleanA || !cleanT) return null;

    const url = `https://www.azlyrics.com/lyrics/${cleanA}/${cleanT}.html`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ringtoneIdx = html.indexOf('ringtone');
    if (ringtoneIdx !== -1) {
      const after = html.slice(ringtoneIdx);
      const divStart = after.indexOf('<div>');
      const divEnd = after.indexOf('</div>', divStart);
      if (divStart !== -1 && divEnd !== -1) {
        const raw = after.slice(divStart + 5, divEnd)
          .replace(/<br\s*[\/]?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
        if (raw && raw.length > 50) {
          return {
            plain: cleanPlainLyricsText(raw),
            source: 'AZLyrics'
          };
        }
      }
    }
  } catch (e) {}
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

  // 1. If running inside Electron, use native IPC extractor if available
  if ((window as any).electronAPI?.getGeniusLyrics) {
    try {
      const data = await (window as any).electronAPI.getGeniusLyrics(query);
      if (data && data.plain) {
        return {
          ...data,
          plain: cleanPlainLyricsText(data.plain)
        };
      }
    } catch (e) {}
  }

  // 2. Direct web fetch search & full page scraper
  try {
    const res = await fetch(`https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      const sections = data?.response?.sections || [];
      const songHit = sections.flatMap((s: any) => s.hits || []).find((h: any) => h.type === 'song' || h.result?._type === 'song');
      if (songHit?.result?.url) {
        const hit = songHit.result;
        let plain = '';

        try {
          const pageRes = await fetch(hit.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const containers = Array.from(html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g));
            for (const c of containers) {
              const chunk = c[1]
                .replace(/<br\s*[\/]?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .trim();
              if (chunk) {
                plain += (plain ? '\n\n' : '') + chunk;
              }
            }
          }
        } catch {}

        return {
          url: hit.url,
          title: hit.title,
          artist: hit.primary_artist?.name || cleanArtist,
          thumbnail: hit.song_art_image_thumbnail_url || hit.header_image_thumbnail_url,
          plain: plain ? cleanPlainLyricsText(plain) : undefined
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Multi-Tier Lyric Fetcher:
 * 1. YouTube Music / Musixmatch (Official studio synchronized karaoke lyrics with dynamic resolution)
 * 2. LRCLIB (Millisecond-accurate timed karaoke lyrics with duration matching)
 * 3. AZLyrics (Full comprehensive static studio lyrics)
 * 4. Genius (Metadata, annotations, and plain text fallback)
 */
export async function fetchLyrics(
  title: string,
  artist: string,
  album?: string,
  duration?: number,
  videoId?: string
): Promise<LyricsResult> {
  if (!title || !artist) {
    return { synced: null, plain: null, source: 'None', isSynced: false };
  }

  const { cleanTitle, cleanArtist } = cleanLyricsSearchQuery(title, artist);

  // Parallel fetch across all providers:
  // 1. YouTube Music Official Synced Musixmatch
  // 2. LRCLIB Synced / Plain
  // 3. AZLyrics Full Lyrics
  // 4. Genius Metadata & Lyrics
  const [ytmMusixmatchData, lrclibData, azData, geniusData] = await Promise.allSettled([
    fetchYouTubeMusicMusixmatchLyrics(videoId, title, artist),
    fetchLrcLib(title, artist, cleanTitle, cleanArtist, album, duration),
    fetchAZLyrics(cleanTitle, cleanArtist),
    fetchGeniusMetadata(cleanTitle, cleanArtist)
  ]);

  const ytmResult = ytmMusixmatchData.status === 'fulfilled' ? ytmMusixmatchData.value : null;
  const lrc = lrclibData.status === 'fulfilled' ? lrclibData.value : null;
  const az = azData.status === 'fulfilled' ? azData.value : null;
  const genius = geniusData.status === 'fulfilled' ? geniusData.value : null;

  // Priority 1: YouTube Music / Musixmatch Official Synced Lyrics
  if (ytmResult && ytmResult.synced && ytmResult.synced.length > 0) {
    return {
      synced: ytmResult.synced,
      plain: cleanPlainLyricsText(ytmResult.plain || ytmResult.synced.map(s => s.text).join('\n')),
      source: 'Musixmatch',
      isSynced: true,
      geniusUrl: genius?.url,
      geniusTitle: genius?.title,
      geniusArtist: genius?.artist,
      geniusThumbnail: genius?.thumbnail
    };
  }

  // Priority 2: LRCLIB Synced Lyrics
  if (lrc && lrc.syncedLyrics) {
    const parsedSynced = parseLrcLyrics(lrc.syncedLyrics);
    if (parsedSynced && parsedSynced.length > 0) {
      return {
        synced: parsedSynced,
        plain: cleanPlainLyricsText(ytmResult?.plain || lrc.plainLyrics || parsedSynced.map(p => p.text).join('\n')),
        source: 'LRCLIB',
        isSynced: true,
        geniusUrl: genius?.url,
        geniusTitle: genius?.title,
        geniusArtist: genius?.artist,
        geniusThumbnail: genius?.thumbnail
      };
    }
  }

  // Priority 3: AZLyrics Full Complete Plain Lyrics
  if (az && az.plain && az.plain.length > (genius?.plain?.length || 0)) {
    return {
      synced: null,
      plain: cleanPlainLyricsText(az.plain),
      source: 'AZLyrics',
      isSynced: false,
      geniusUrl: genius?.url,
      geniusTitle: genius?.title,
      geniusArtist: genius?.artist,
      geniusThumbnail: genius?.thumbnail
    };
  }

  // Priority 4: YouTube Music / Musixmatch Plain Lyrics
  if (ytmResult && ytmResult.plain) {
    return {
      synced: null,
      plain: cleanPlainLyricsText(ytmResult.plain),
      source: 'Musixmatch',
      isSynced: false,
      geniusUrl: genius?.url,
      geniusTitle: genius?.title,
      geniusArtist: genius?.artist,
      geniusThumbnail: genius?.thumbnail
    };
  }

  // Priority 5: Genius Plain Lyrics
  if (genius && genius.plain) {
    return {
      synced: null,
      plain: cleanPlainLyricsText(genius.plain),
      source: 'Genius',
      isSynced: false,
      geniusUrl: genius.url,
      geniusTitle: genius.title,
      geniusArtist: genius.artist,
      geniusThumbnail: genius.thumbnail
    };
  }

  // Priority 6: LRCLIB Plain Lyrics
  if (lrc && lrc.plainLyrics) {
    return {
      synced: null,
      plain: cleanPlainLyricsText(lrc.plainLyrics),
      source: 'LRCLIB',
      isSynced: false,
      geniusUrl: genius?.url,
      geniusTitle: genius?.title,
      geniusArtist: genius?.artist,
      geniusThumbnail: genius?.thumbnail
    };
  }

  return {
    synced: null,
    plain: null,
    source: 'None',
    isSynced: false,
    geniusUrl: genius?.url,
    geniusTitle: genius?.title,
    geniusArtist: genius?.artist,
    geniusThumbnail: genius?.thumbnail
  };
}
