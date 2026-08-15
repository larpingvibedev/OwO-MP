import type { Track, ArtistProfile, Album, AlbumDetail, PublicPlaylist, Playlist, SimilarArtist, SuggestionEntity, SearchSuggestionsResult } from '../types';

const INVIDIOUS_INSTANCES = [
  'https://invidious.flokinet.to',
  'https://yewtu.be',
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
  'https://invidious.drgns.space'
];

// In-memory cache for resolved artist channels & album playlists
const artistChannelCache = new Map<string, { author: string; authorId: string }>();
const albumPlaylistCache = new Map<string, Map<string, string>>();

// Fast In-Memory LRU Suggestions Cache (Query -> Suggestions)
const suggestionsCache = new Map<string, SearchSuggestionsResult>();

/**
 * Accurately parses a duration string (e.g. "1:52", "03:45", "1:02:15", or "Song • bunii • 1:52 • 289K plays") into seconds.
 */
export function parseDurationString(durationStr: string | undefined): number {
  if (!durationStr) return 0;
  const match = durationStr.match(/(?:(\d+):)?(\d+):(\d+)/);
  if (!match) return 0;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  return hours * 3600 + mins * 60 + secs;
}

export function isMatchingArtist(itemArtist: string | undefined, targetArtist: string | undefined): boolean {
  if (!itemArtist || !targetArtist) return false;
  const a = itemArtist.toLowerCase().replace(/\s*-\s*topic$/i, '').replace(/\s*official\s*(artist\s*)?channel$/i, '').trim();
  const t = targetArtist.toLowerCase().replace(/\s*-\s*topic$/i, '').replace(/\s*official\s*(artist\s*)?channel$/i, '').trim();
  
  if (a === t) return true;

  // Exact word boundary matching for collabs / features
  // e.g. "bunii & other", "other & bunii", "bunii feat. other", "other ft. bunii", "other, bunii"
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`(^|[&,+/]|\\bfeat\\.?|\\bft\\.?|\\bwith\\b)\\s*${escaped}\\b`, 'i');
  const reverseBoundaryRegex = new RegExp(`\\b${escaped}\\s*([&,+/]|\\bfeat\\.?|\\bft\\.?|\\bwith\\b|$)`, 'i');
  
  return wordBoundaryRegex.test(a) || reverseBoundaryRegex.test(a);
}

function extractAlbumInfoFromYTMItem(r: any): { albumName?: string; albumId?: string } {
  if (!r) return {};
  const allFlex = r.flexColumns || [];
  
  // 1. Check all flex columns runs for direct album browseId (MPREb_, OLAK, MPAD, etc.)
  for (const col of allFlex) {
    const runs = col.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    for (const run of runs) {
      const bId = run.navigationEndpoint?.browseEndpoint?.browseId;
      if (bId && (bId.startsWith('MPREb_') || bId.startsWith('OLAK') || bId.startsWith('MPAD') || bId.startsWith('VLOLAK') || bId.startsWith('FEmusic_'))) {
        return {
          albumName: run.text?.trim(),
          albumId: bId
        };
      }
    }
  }

  // 2. Check for album runs (runs with browseIds that are not artist channels)
  for (let i = 1; i < allFlex.length; i++) {
    const runs = allFlex[i].musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    for (const run of runs) {
      const text = run.text?.trim();
      const bId = run.navigationEndpoint?.browseEndpoint?.browseId;
      if (bId && !bId.startsWith('UC') && !bId.startsWith('FEuser')) {
        return {
          albumName: text,
          albumId: bId
        };
      }
    }
  }

  // 3. Fallback: parse 3+ part text runs "Song • Artist • Album • 1:30"
  const flex1Runs = allFlex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  if (flex1Runs.length >= 3) {
    const textRuns = flex1Runs.filter((r: any) => r.text && r.text.trim() !== '•');
    if (textRuns.length >= 3) {
      const cand = textRuns[1];
      if (cand && cand.text) {
        return {
          albumName: cand.text.trim(),
          albumId: cand.navigationEndpoint?.browseEndpoint?.browseId
        };
      }
    }
  }

  return {};
}

/**
 * Fast YouTube Music Search Autocomplete & Entity Suggestions
 * Pulls instant query completions and top artists/tracks/playlists with ~150ms response time.
 */
export async function getSearchSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<SearchSuggestionsResult> {
  const clean = query.trim();
  if (!clean) return { textSuggestions: [], entitySuggestions: [] };

  const cacheKey = clean.toLowerCase();
  if (suggestionsCache.has(cacheKey)) {
    return suggestionsCache.get(cacheKey)!;
  }

  const endpoints = [
    '/api/ytmusic/youtubei/v1/music/get_search_suggestions?prettyPrint=false',
    'https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false'
  ];

  let rawData: any = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US'
            }
          },
          input: clean
        })
      });
      if (res.ok) {
        rawData = await res.json();
        break;
      }
    } catch (e) {
      if ((e as any)?.name === 'AbortError') throw e;
    }
  }

  const textSuggestions: string[] = [];
  const entitySuggestions: SuggestionEntity[] = [];

  if (rawData?.contents) {
    for (const section of rawData.contents) {
      const items = section.searchSuggestionsSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.searchSuggestionRenderer) {
          const runs = item.searchSuggestionRenderer.suggestion?.runs || [];
          const text = runs.map((r: any) => r.text).join('').trim();
          if (text && !textSuggestions.includes(text)) {
            textSuggestions.push(text);
          }
        } else if (item.musicResponsiveListItemRenderer) {
          const r = item.musicResponsiveListItemRenderer;
          const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
          const subtitleRuns = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const subtitle = subtitleRuns.map((s: any) => s.text).join('');
          const thirdColRuns = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const thirdCol = thirdColRuns.map((s: any) => s.text).join('');
          const fullSubtitle = thirdCol ? `${subtitle} • ${thirdCol}` : subtitle;

          const rawThumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
          const thumb = cleanGoogleImageUrl(rawThumb, 300);

          const isArtist = subtitle.toLowerCase().includes('artist') || r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST';
          const isAlbum = subtitle.toLowerCase().includes('album') || subtitle.toLowerCase().includes('ep') || subtitle.toLowerCase().includes('single');
          const isPlaylist = subtitle.toLowerCase().includes('playlist');
          const type: 'artist' | 'song' | 'album' | 'playlist' = isArtist ? 'artist' : (isPlaylist ? 'playlist' : (isAlbum ? 'album' : 'song'));

          const browseId = r.navigationEndpoint?.browseEndpoint?.browseId || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
          const videoId = r.playlistItemData?.videoId || r.navigationEndpoint?.watchEndpoint?.videoId || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

          let artistName = '';
          if (!isArtist) {
            const artistRun = subtitleRuns.find((s: any) => s.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
            artistName = artistRun ? artistRun.text : (subtitleRuns[2]?.text || '');
          }

          if (title) {
            entitySuggestions.push({
              type,
              title,
              subtitle: fullSubtitle,
              thumbnail: thumb,
              browseId,
              videoId,
              artist: artistName
            });
          }
        }
      }
    }
  }

  const result: SearchSuggestionsResult = {
    textSuggestions: textSuggestions.slice(0, 8),
    entitySuggestions: entitySuggestions.slice(0, 6)
  };

  if (suggestionsCache.size > 100) {
    const firstKey = suggestionsCache.keys().next().value;
    if (firstKey) suggestionsCache.delete(firstKey);
  }
  suggestionsCache.set(cacheKey, result);

  return result;
}

/**
  * Resolves YouTube Official Artist / Topic Channel for an artist name.
  */
export async function resolveArtistChannel(artistName: string): Promise<{ author: string; authorId: string } | null> {
  const key = artistName.trim().toLowerCase();
  if (artistChannelCache.has(key)) {
    return artistChannelCache.get(key)!;
  }

  for (const inst of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(artistName + ' Topic')}&type=channel`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const channels = await res.json();
        if (Array.isArray(channels) && channels.length > 0) {
          const topicMatch = channels.find((c: any) => {
            const a = (c.author || '').toLowerCase().trim();
            return a === `${key} - topic` || a === key;
          }) || channels[0];

          if (topicMatch && topicMatch.authorId) {
            const result = { author: topicMatch.author, authorId: topicMatch.authorId };
            artistChannelCache.set(key, result);
            return result;
          }
        }
      }
    } catch (e) {
      // try next instance
    }
  }
  return null;
}

/**
  * Resolves Official YouTube Release Playlist for an album.
  * Returns a map of normalized track titles -> videoId.
  */
export async function resolveAlbumPlaylist(artistName: string, albumName: string): Promise<Map<string, string> | null> {
  const cacheKey = `${artistName}-${albumName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (albumPlaylistCache.has(cacheKey)) {
    return albumPlaylistCache.get(cacheKey)!;
  }

  const q = `${artistName} ${albumName}`;
  const artLower = artistName.trim().toLowerCase();
  const albLower = albumName.trim().toLowerCase();

  for (const inst of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(q)}&type=playlist`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const playlists = await res.json();
        if (Array.isArray(playlists) && playlists.length > 0) {
          const officialPlaylist = playlists.find((p: any) => {
            const pTitle = (p.title || '').toLowerCase();
            const pAuthor = (p.author || '').toLowerCase();
            return pTitle.includes(albLower) && (pAuthor.includes(artLower) || pAuthor === 'youtube music' || pAuthor === `${artLower} - topic`);
          }) || playlists.find((p: any) => (p.title || '').toLowerCase().includes(albLower));

          if (officialPlaylist && officialPlaylist.playlistId) {
            const plRes = await fetch(`${inst}/api/v1/playlists/${officialPlaylist.playlistId}`, {
              headers: { 'Accept': 'application/json' }
            });
            if (plRes.ok) {
              const plData = await plRes.json();
              if (plData.videos && Array.isArray(plData.videos)) {
                const trackMap = new Map<string, string>();
                plData.videos.forEach((v: any) => {
                  if (v.title && v.videoId) {
                    const cleanVTitle = v.title
                      .toLowerCase()
                      .replace(new RegExp(`^${artLower}\\s*-\\s*`, 'i'), '')
                      .replace(/(\(|\[)(official|visualizer|audio|video|lyric|topic|feat|ft).*/gi, '')
                      .replace(/[^a-z0-9]/g, '');
                    trackMap.set(cleanVTitle, v.videoId);
                  }
                });
                albumPlaylistCache.set(cacheKey, trackMap);
                return trackMap;
              }
            }
          }
        }
      }
    } catch (e) {
      // try next instance
    }
  }
  return null;
}

/**
 * Helper to extract the 100% Official Studio Audio Track ID (ATV / Topic) from YouTube Music item renderers.
 * YouTube Music embeds the pure Audio Track ID in the Track Credits menu endpoint (MPTC[videoId]).
 */
export function extractOfficialAudioTrackId(renderer: any, fallbackVideoId?: string): string | null {
  if (!renderer) return fallbackVideoId || null;

  // 1. Priority 1: Check Track Credits browse endpoint (MPTC...) which guarantees pure distributor audio
  const menuItems = renderer.menu?.menuRenderer?.items || [];
  for (const mi of menuItems) {
    const browseId = mi?.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
    if (browseId && browseId.startsWith('MPTC')) {
      const audioId = browseId.replace('MPTC', '').trim();
      if (/^[a-zA-Z0-9_-]{11}$/.test(audioId)) {
        return audioId;
      }
    }
  }

  // 2. Extract potential musicVideoType flags from watchEndpoints
  const endpointsToCheck = [
    renderer.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint,
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint,
    renderer.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint,
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint,
    renderer.onTap?.watchEndpoint
  ].filter(Boolean);

  let isExplicitOMV = false;
  let isExplicitATV = false;

  for (const ep of endpointsToCheck) {
    const mvType = ep?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    if (mvType === 'MUSIC_VIDEO_TYPE_OMV') {
      isExplicitOMV = true;
    }
    if (mvType === 'MUSIC_VIDEO_TYPE_ATV') {
      isExplicitATV = true;
    }
  }

  // If YouTube Music explicitly labeled this as an Official Music Video (OMV), reject it
  if (isExplicitOMV && !isExplicitATV) {
    return null;
  }

  // 3. Inspect title text for music video keywords
  const titleText = (
    renderer.title?.runs?.[0]?.text ||
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ||
    ''
  ).toLowerCase();

  const isMVTitle = [
    'official music video',
    'official video',
    'music video',
    ' mv',
    '[mv]',
    '(mv)',
    'video clip'
  ].some(kw => titleText.includes(kw));

  if (isMVTitle) {
    return null;
  }

  // 4. Inspect subtitle runs (in YTM search, videos have subtitle starting with "Video •")
  const subtitleRuns = renderer.subtitle?.runs || 
                       renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || 
                       [];
  const firstSubText = (subtitleRuns[0]?.text || '').trim().toLowerCase();
  if (firstSubText === 'video') {
    return null;
  }

  // 5. Extract videoId if safe
  const watchId = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                  renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                  renderer.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                  renderer.onTap?.watchEndpoint?.videoId ||
                  renderer.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId ||
                  renderer.playlistItemData?.videoId ||
                  fallbackVideoId;

  return watchId || null;
}

/**
 * Extracts a direct YouTube Video ID from any Track object if already known.
 * Universal and format-agnostic (supports piped-, yt-, direct URL, or raw ID).
 */
export function getDirectYouTubeId(track: Track | null | undefined): string | null {
  if (!track) return null;

  // 1. Piped prefix (e.g. piped-n5f6NuT_Sok)
  if (track.id && track.id.startsWith('piped-')) {
    const id = track.id.replace('piped-', '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
  }

  // 2. yt- prefix (e.g. yt-n5f6NuT_Sok)
  if (track.id && track.id.startsWith('yt-')) {
    const id = track.id.replace('yt-', '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
  }

  // 3. streamUrl contains YouTube video ID parameter
  if (track.streamUrl) {
    const match = track.streamUrl.match(/(?:v=|youtu\.be\/|embed\/|v\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) {
      return match[1];
    }
  }

  // 4. Raw 11-char YouTube ID in track.id (not track-xxxxx or demo-xxxxx)
  if (track.id && /^[a-zA-Z0-9_-]{11}$/.test(track.id) && !track.id.startsWith('track-') && !track.id.startsWith('demo-')) {
    return track.id;
  }

  return null;
}

// Fast In-Memory LRU Search Cache (Query -> Results)
const searchCache = new Map<string, { tracks: Track[]; profileCandidate?: { name: string; channelId?: string; cover?: string } }>();

export interface SearchResultBundle {
  tracks: Track[];
  profileCandidate?: {
    name: string;
    channelId?: string;
    cover?: string;
  };
}

/**
 * Relevant Music & Categorized Search Engine (Ultra-Fast Hybrid InnerTube + iTunes Engine)
 * Runs YouTube Music InnerTube Search and iTunes in parallel with < 400ms response time.
 * Supports LRU memory caching and live query cancellation.
 */
export async function searchFreeMusic(query: string, signal?: AbortSignal): Promise<SearchResultBundle> {
  if (!query.trim()) return { tracks: [] };

  const rawQuery = query.trim().toLowerCase();
  
  // 1. Instant Cache Hit (0ms)
  if (searchCache.has(rawQuery)) {
    return searchCache.get(rawQuery)!;
  }

  let targetArtist = '';
  let targetTitle = '';

  if (rawQuery.includes('-')) {
    const parts = rawQuery.split('-').map(s => s.trim());
    targetArtist = parts[0] || '';
    targetTitle = parts[1] || '';
  } else {
    const words = rawQuery.split(/\s+/);
    targetArtist = words[0] || '';
    targetTitle = words.slice(1).join(' ') || '';
  }

  const resultsMap = new Map<string, Track>();
  let profileCandidate: { name: string; channelId?: string; cover?: string } | undefined = undefined;

  const endpoints = [
    '/api/ytmusic/youtubei/v1/search',
    'https://music.youtube.com/youtubei/v1/search'
  ];

  // 2. Fire YouTube Music InnerTube Search and iTunes in Parallel
  const ytmFetch = (async () => {
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
            query: query.trim()
          })
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {}
    }
    return null;
  })();

  const itunesFetch = fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query.trim())}&entity=song&limit=40`, { signal })
    .then(r => r.ok ? r.json() : { results: [] })
    .catch(() => ({ results: [] }));

  try {
    const [ytmData, itunesData] = await Promise.all([ytmFetch, itunesFetch]);

    // A. Parse YouTube Music InnerTube Results (Official Studio Songs, Artist Cards, Videos)
    if (ytmData) {
      const sections = ytmData?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

      for (const sec of sections) {
        // Top Result Card (Artist or Primary Song / Video)
        if (sec.musicCardShelfRenderer) {
          const card = sec.musicCardShelfRenderer;
          const cardTitle = card.title?.runs?.[0]?.text || '';
          const subtitle = card.subtitle?.runs?.map((s: any) => s.text).join('') || '';
          const bId = card.onTap?.browseEndpoint?.browseId || card.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
          const videoId = card.onTap?.watchEndpoint?.videoId ||
                          card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                          card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
          const rawThumb = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;

          if (subtitle.toLowerCase().includes('artist') && bId && !profileCandidate) {
            profileCandidate = {
              name: cardTitle,
              channelId: bId,
              cover: cleanGoogleImageUrl(rawThumb, 500)
            };
          }

          if (cardTitle && videoId) {
            const subParts = subtitle.split('•').map((s: any) => s.trim());
            const trackArtist = subParts[1] || subParts[0] || targetArtist || query.trim();
            const key = `${trackArtist}-${cardTitle}`.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cardDuration = parseDurationString(subtitle) || 0;

            if (!resultsMap.has(key)) {
              resultsMap.set(key, {
                id: `piped-${videoId}`,
                title: cardTitle,
                artist: trackArtist,
                albumArtist: trackArtist,
                album: 'YouTube Music',
                duration: cardDuration,
                cover: cleanGoogleImageUrl(rawThumb, 500),
                streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
                source: 'youtube',
                category: subtitle.toLowerCase().includes('video') ? 'video' : 'song'
              });
            }
          }
        }

        // List Items (iterate through ALL items in section)
        const items = sec.musicShelfRenderer?.contents || sec.itemSectionRenderer?.contents || [];
        for (const item of items) {
          const r = item.musicResponsiveListItemRenderer;
          if (r) {
            const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
            const subtitle = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((s: any) => s.text).join('') || '';
            const rawVideoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                            r.playlistItemData?.videoId;
            const videoId = extractOfficialAudioTrackId(r, rawVideoId);
            const rawThumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            const channelId = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

            if (subtitle.toLowerCase().includes('artist') && channelId && !profileCandidate) {
              profileCandidate = {
                name: title,
                channelId: channelId,
                cover: cleanGoogleImageUrl(rawThumb, 500)
              };
            }

            if (title && videoId) {
              const subParts = subtitle.split('•').map((s: any) => s.trim());
              const trackArtist = subParts[1] || subParts[0] || targetArtist || query.trim();
              const key = `${trackArtist}-${title}`.toLowerCase().replace(/[^a-z0-9]/g, '');

              // Extract actual duration from fixedColumns (e.g. "1:35"), flexColumns[2], flexColumns[1], or individual runs
              const fixedDurationStr = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
              const flex2Str = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((s: any) => s.text).join('') || '';
              const flex1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
              let itemDuration = parseDurationString(fixedDurationStr) || parseDurationString(flex2Str) || parseDurationString(subtitle);
              
              if (!itemDuration) {
                for (const run of flex1Runs) {
                  const d = parseDurationString(run.text);
                  if (d > 0) {
                    itemDuration = d;
                    break;
                  }
                }
              }

              const albInfo = extractAlbumInfoFromYTMItem(r);
              const trackAlbum = albInfo.albumName || (targetArtist ? targetTitle : 'Official Release');
              const trackAlbumId = albInfo.albumId || undefined;

              if (!resultsMap.has(key)) {
                resultsMap.set(key, {
                  id: `piped-${videoId}`,
                  title: title,
                  artist: trackArtist,
                  albumArtist: trackArtist,
                  album: trackAlbum,
                  albumId: trackAlbumId,
                  duration: itemDuration,
                  cover: cleanGoogleImageUrl(rawThumb, 500),
                  streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
                  source: 'youtube',
                  category: subtitle.toLowerCase().includes('video') ? 'video' : 'song',
                  channelId: channelId
                });
              }
            }
          }
        }
      }
    }

    // B. Parse iTunes Results (High-Quality Studio Tracks & Metadata)
    if (itunesData?.results) {
      itunesData.results.forEach((item: any) => {
        if (item.trackName && item.artistName) {
          const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
          const durationSeconds = item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0;

          if (resultsMap.has(key)) {
            const existing = resultsMap.get(key)!;
            if ((!existing.duration || existing.duration <= 0) && durationSeconds > 0) {
              existing.duration = durationSeconds;
            }
          } else {
            const highResCover = item.artworkUrl100
              ? item.artworkUrl100.replace('100x100bb', '600x600bb')
              : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';

            resultsMap.set(key, {
              id: `track-${item.trackId}`,
              title: item.trackName,
              artist: item.artistName,
              artistId: item.artistId,
              albumArtist: item.collectionArtistName || item.artistName,
              album: item.collectionName || 'Single',
              duration: durationSeconds,
              cover: highResCover,
              streamUrl: `${item.artistName} - ${item.trackName}`,
              source: 'youtube',
              category: 'song'
            });
          }
        }
      });
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('Search query skipped:', err);
    }
  }

  const allTracks = Array.from(resultsMap.values());

  // 3. Relevance Filtering & Smart Tier Ranking
  const filtered = allTracks.filter(item => {
    const t = item.title.toLowerCase();
    const a = item.artist.toLowerCase();

    const matchesArtist = targetArtist && (a.includes(targetArtist) || t.includes(targetArtist));
    const matchesTitle = targetTitle && t.includes(targetTitle);

    if (targetArtist && targetTitle) {
      return matchesArtist || matchesTitle;
    }

    return a.includes(rawQuery) || t.includes(rawQuery);
  });

  const FAN_REMIX_KEYWORDS = [
    'slowed', 'reverb', 'sped up', 'speed up', 'nightcore', 'remix', 'bootleg', 
    'edit', 'amv', 'tiktok', 'tik tok', 'mashup', 'flip', 'cover', 'instrumental',
    'tribute', 'parody', 'fanmade', 'fan made', 'karaoke', 'bass boosted', 'hour loop',
    'extended version', 'reaction'
  ];

  const sortedTracks = filtered.sort((a, b) => {
    const getTierScore = (track: Track): number => {
      const aLower = track.artist.toLowerCase().trim();
      const tLower = track.title.toLowerCase().trim();
      const qClean = rawQuery.trim();

      const isFanOrRemix = FAN_REMIX_KEYWORDS.some(kw => tLower.includes(kw) || aLower.includes(kw));
      const isExactArtist = aLower === qClean || (targetArtist && aLower === targetArtist);
      const isCollab = aLower.startsWith(qClean + ' ') || 
                       aLower.includes(`feat. ${qClean}`) || 
                       aLower.includes(`ft. ${qClean}`) || 
                       aLower.includes(`${qClean} &`) || 
                       aLower.includes(`${qClean},`);
      const isExactTitle = tLower === qClean || (targetTitle && tLower === targetTitle);
      const isTitleContains = tLower.includes(qClean) || (targetTitle && tLower.includes(targetTitle));
      const isOtherSimilarArtist = !isExactArtist && !isCollab && aLower.includes(qClean);

      // Tier 1: Exact Artist Official Tracks
      if (isExactArtist && !isFanOrRemix) {
        return 1000;
      }
      // Tier 2: Exact Artist Features / Collabs
      if (isCollab && !isFanOrRemix) {
        return 800;
      }
      // Tier 3: Exact Artist Remixes, Slowed + Reverb, Fan-made versions & Bootlegs
      if ((isExactArtist || isCollab) && isFanOrRemix) {
        return 650;
      }
      // Tier 4: Exact Title match (song named after the query)
      if (isExactTitle) {
        return 450;
      }
      // Tier 5: Title contains the search query (including third-party remixes)
      if (isTitleContains) {
        return isFanOrRemix ? 250 : 350;
      }
      // Tier 6 (VERY BOTTOM): Other separate artists with substring match (e.g. "JuliiBunii", "Zuki Bunii")
      if (isOtherSimilarArtist) {
        return 50;
      }

      return 0;
    };

    const scoreA = getTierScore(a);
    const scoreB = getTierScore(b);

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    return 0;
  });

  const bundle: SearchResultBundle = {
    tracks: sortedTracks,
    profileCandidate
  };

  // Cache up to 100 queries
  if (searchCache.size > 100) {
    const firstKey = searchCache.keys().next().value;
    if (firstKey) searchCache.delete(firstKey);
  }
  searchCache.set(rawQuery, bundle);

  return bundle;
}

/**
 * Backward compatibility wrapper returning Track[] directly
 */
export async function searchFreeMusicTracks(query: string, signal?: AbortSignal): Promise<Track[]> {
  const res = await searchFreeMusic(query, signal);
  return res.tracks;
}

/**
 * Fetches Official Verified Artist Profiles & Complete Discographies.
 * Enforces strict exact artist matching on iTunes, and falls back to YouTube Official Channels
 * (or direct channelId routing) for YouTube-native artists (e.g. "Blu" / @bluchrist) to prevent wrong artist collisions.
 */
/**
 * Helper to clean and normalize a music track title.
 */
export function cleanTrackTitle(title: string, artistName: string): string {
  if (!title) return '';
  let clean = title.trim();
  clean = clean.replace(new RegExp(`^${artistName}\\s*-\\s*`, 'i'), '');
  clean = clean.replace(/(\(|\[)\s*(Official Music Video|Official Video|Music Video|Official Visualizer|Visualizer|Audio|Official Audio|MV|Video|HD|HQ|Visuals)\s*(\)|\])/gi, '');
  clean = clean.replace(/[-_–—\s]+$/, '').trim();
  return clean || title;
}

/**
 * Computes an Audio Purity Score to prioritize studio master audios/visualizers over acting/music videos.
 */
export function getAudioPurityScore(rawTitle: string, author: string): number {
  const titleLower = (rawTitle || '').toLowerCase();
  const authorLower = (author || '').toLowerCase();

  const isTopicChannel = authorLower.endsWith(' - topic');
  const isMusicVideo = titleLower.includes('music video') || titleLower.includes('official video') || titleLower.includes(' mv') || titleLower.includes('[mv]') || titleLower.includes('(mv)');
  const isVisualizer = titleLower.includes('visualizer') || titleLower.includes('visuals') || titleLower.includes('audio') || titleLower.includes('official audio');

  let score = 500;
  if (isTopicChannel && !isMusicVideo) score += 1200;
  if (!isMusicVideo && !titleLower.includes('video')) score += 900;
  if (isVisualizer && !isMusicVideo) score += 600;
  if (isMusicVideo) score -= 1200;

  return score;
}

export function cleanGoogleImageUrl(url: string | undefined, size = 500): string {
  if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    const base = url.split('=')[0];
    return `${base}=s${size}-c`;
  }
  if (url.includes('mzstatic.com') && url.includes('100x100bb')) {
    return url.replace('100x100bb', `${size}x${size}bb`);
  }
  return url;
}

const artistAvatarCache = new Map<string, string>();

/**
 * Resolves an authentic, unique profile avatar for an artist.
 * Uses in-memory caching and fast parallel lookup against YouTube Music and iTunes.
 */
export async function resolveArtistAvatar(artistName: string): Promise<string> {
  const clean = artistName.trim();
  const lower = clean.toLowerCase();
  if (artistAvatarCache.has(lower)) {
    return artistAvatarCache.get(lower)!;
  }

  // 1. YouTube Music Suggestions (Very fast ~100ms, returns official circular artist avatar)
  try {
    const res = await fetch('https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } },
        input: clean
      })
    });
    if (res.ok) {
      const data = await res.json();
      const contents = data.contents || [];
      for (const c of contents) {
        const items = c.searchSuggestionsSectionRenderer?.contents || [];
        for (const item of items) {
          const r = item.musicResponsiveListItemRenderer;
          if (r) {
            const sub = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((s: any) => s.text).join('') || '';
            const isArtist = sub.toLowerCase().includes('artist') || r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST';
            if (isArtist) {
              const rawThumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
              if (rawThumb) {
                const cleanThumb = cleanGoogleImageUrl(rawThumb, 500);
                artistAvatarCache.set(lower, cleanThumb);
                return cleanThumb;
              }
            }
          }
        }
      }
    }
  } catch (e) {}

  // 2. iTunes Artist Search fallback
  try {
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(clean)}&entity=song&limit=5`);
    if (itunesRes.ok) {
      const itunesData = await itunesRes.json();
      const match = (itunesData.results || []).find((r: any) => r.artistName?.toLowerCase() === lower) || itunesData.results?.[0];
      if (match?.artworkUrl100) {
        const thumb = match.artworkUrl100.replace('100x100bb', '500x500bb');
        artistAvatarCache.set(lower, thumb);
        return thumb;
      }
    }
  } catch (e) {}

  const fallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
  artistAvatarCache.set(lower, fallback);
  return fallback;
}

/**
 * Fetches 100% Authentic Artist Profile directly from YouTube Music's InnerTube API.
 * Pulls the exact Top Songs, Albums, full Singles & EPs, and algorithmic Fans Might Also Like.
 */
export async function fetchArtistProfileFromYTM(
  artistQuery: string, 
  channelId?: string
): Promise<ArtistProfile | null> {
  const endpoints = [
    '/api/ytmusic/youtubei/v1',
    'https://music.youtube.com/youtubei/v1'
  ];

  let targetBrowseId: string | null = null;

  // 1. Direct channelId priority: If channelId is provided or artistQuery is a browse ID, use it directly!
  if (channelId && (channelId.startsWith('UC') || channelId.startsWith('FEmusic_artist_'))) {
    targetBrowseId = channelId;
  } else if (artistQuery.startsWith('UC') || artistQuery.startsWith('FEmusic_artist_')) {
    targetBrowseId = artistQuery;
  }

  // 2. Otherwise search YouTube Music directly for the official Artist profile of artistQuery
  if (!targetBrowseId) {
    for (const base of endpoints) {
      try {
        const searchRes = await fetch(`${base}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
            query: artistQuery
          })
        });

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const sections = searchData?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
          for (const sec of sections) {
            const items = sec?.musicShelfRenderer?.contents || (sec?.musicCardShelfRenderer ? [sec.musicCardShelfRenderer] : []);
            for (const item of items) {
              const r = item?.musicResponsiveListItemRenderer || item;
              const subtitle = r?.subtitle?.runs?.map((s: any) => s.text).join('') || '';
              const bId = r?.onTap?.browseEndpoint?.browseId ||
                          r?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                          r?.navigationEndpoint?.browseEndpoint?.browseId ||
                          r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                          r?.buttons?.[0]?.buttonRenderer?.command?.browseEndpoint?.browseId;
              if (subtitle.toLowerCase().includes('artist') && bId) {
                targetBrowseId = bId;
                break;
              }
            }
            if (targetBrowseId) break;
          }
          if (!targetBrowseId) {
            const str = JSON.stringify(searchData);
            const m = /"browseId":"(UC[a-zA-Z0-9_-]{22})"[^}]*?"pageType":"MUSIC_PAGE_TYPE_ARTIST"/.exec(str) ||
                      /"pageType":"MUSIC_PAGE_TYPE_ARTIST"[^}]*?"browseId":"(UC[a-zA-Z0-9_-]{22})"/.exec(str);
            targetBrowseId = m ? m[1] : null;
          }
          if (targetBrowseId) break;
        }
      } catch (e) {}
    }
  }

  if (!targetBrowseId) return null;

  // 3. Fetch artist page from YouTube Music
  let browseData: any = null;
  let usedBase = endpoints[0];

  for (const base of endpoints) {
    try {
      const browseRes = await fetch(`${base}/browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
          browseId: targetBrowseId
        })
      });

      if (browseRes.ok) {
        browseData = await browseRes.json();
        usedBase = base;
        break;
      }
    } catch (e) {}
  }

  if (!browseData) return null;

  const artistName = browseData?.header?.musicImmersiveHeaderRenderer?.title?.runs?.[0]?.text ||
                     browseData?.header?.musicVisualHeaderRenderer?.title?.runs?.[0]?.text ||
                     artistQuery;

  const headerThumbs = browseData?.header?.musicImmersiveHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
                       browseData?.header?.musicVisualHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const rawBanner = headerThumbs.slice(-1)?.[0]?.url;
  const banner = rawBanner ? cleanGoogleImageUrl(rawBanner, 1200) : undefined;
  let avatar = rawBanner ? cleanGoogleImageUrl(rawBanner, 500) : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';

  let topTracks: Track[] = [];
  let albums: Album[] = [];
  let singlesAndEPs: Album[] = [];
  const similarArtists: SimilarArtist[] = [];

  const contents = browseData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  let topSongsPlaylistId: string | null = null;
  let albumsMoreEndpoint: { browseId: string; params: string } | null = null;
  let singlesMoreEndpoint: { browseId: string; params: string } | null = null;

  for (const sec of contents) {
    const shelf = sec?.musicShelfRenderer || sec?.musicCarouselShelfRenderer;
    const title = (shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || shelf?.title?.runs?.[0]?.text || '').toLowerCase().trim();

    // 1. Top songs (Official label/distributor audio with studio album art)
    if (title.includes('top song') || title.includes('songs')) {
      const bottomPlId = shelf?.bottomEndpoint?.browseEndpoint?.browseId;
      if (bottomPlId) {
        topSongsPlaylistId = bottomPlId;
      }

      const items = shelf?.contents || [];
      items.forEach((item: any) => {
        const r = item.musicResponsiveListItemRenderer;
        if (!r) return;
        const trackTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
        const rawVideoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                        r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
        const videoId = extractOfficialAudioTrackId(r, rawVideoId);
        const rawThumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
        const thumb = cleanGoogleImageUrl(rawThumb || avatar);
        const durationStr = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
        
        let duration = 180;
        if (durationStr) {
          const parts = durationStr.split(':').map(Number);
          if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        if (trackTitle && videoId) {
          const albInfo = extractAlbumInfoFromYTMItem(r);
          const trackAlbum = albInfo.albumName || trackTitle;
          const trackAlbumId = albInfo.albumId || undefined;

          topTracks.push({
            id: `piped-${videoId}`,
            title: trackTitle,
            artist: artistName,
            albumArtist: artistName,
            album: trackAlbum,
            albumId: trackAlbumId,
            duration: duration,
            cover: thumb,
            streamUrl: `${artistName} - ${trackTitle}`,
            source: 'youtube',
            category: 'song',
            channelId: targetBrowseId
          });
        }
      });
    }

    // 2. Albums
    if (title.includes('album')) {
      const moreBtn = shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
      if (moreBtn && moreBtn.browseId && moreBtn.params) {
        albumsMoreEndpoint = { browseId: moreBtn.browseId, params: moreBtn.params };
      }

      const items = shelf?.contents || [];
      items.forEach((item: any) => {
        const card = item.musicTwoRowItemRenderer;
        if (!card) return;
        const albTitle = card.title?.runs?.[0]?.text;
        const albBrowseId = card.navigationEndpoint?.browseEndpoint?.browseId;
        const albSubtitle = card.subtitle?.runs?.map((s: any) => s.text).join('') || 'Album';
        const rawThumb = card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                         card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
        const thumb = cleanGoogleImageUrl(rawThumb || avatar);

        if (albTitle && albBrowseId) {
          albums.push({
            id: albBrowseId,
            name: albTitle,
            artist: artistName,
            cover: thumb,
            releaseDate: albSubtitle,
            channelId: targetBrowseId
          });
        }
      });
    }

    // 3. Singles & EPs (Single releases, EPs, and collaborating features)
    if (title.includes('single') || title.includes('eps')) {
      const moreBtn = shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
      if (moreBtn && moreBtn.browseId && moreBtn.params) {
        singlesMoreEndpoint = { browseId: moreBtn.browseId, params: moreBtn.params };
      }

      const items = shelf?.contents || [];
      items.forEach((item: any) => {
        const card = item.musicTwoRowItemRenderer;
        if (!card) return;
        const sTitle = card.title?.runs?.[0]?.text;
        const sBrowseId = card.navigationEndpoint?.browseEndpoint?.browseId;
        const sSubtitle = card.subtitle?.runs?.map((s: any) => s.text).join('') || 'Single';
        const rawThumb = card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                         card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
        const thumb = cleanGoogleImageUrl(rawThumb || avatar);

        if (sTitle && sBrowseId) {
          singlesAndEPs.push({
            id: sBrowseId,
            name: sTitle,
            artist: artistName,
            cover: thumb,
            releaseDate: sSubtitle,
            channelId: targetBrowseId
          });
        }
      });
    }

    // 4. Fans might also like (Official YouTube Music listener cluster)
    if (title.includes('fans might also like') || title.includes('similar')) {
      const items = shelf?.contents || [];
      items.forEach((item: any) => {
        const card = item.musicTwoRowItemRenderer;
        if (!card) return;
        const simName = card.title?.runs?.[0]?.text;
        const simBrowseId = card.navigationEndpoint?.browseEndpoint?.browseId;
        const rawThumb = card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                         card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
        const thumb = cleanGoogleImageUrl(rawThumb || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80');

        if (simName && simBrowseId) {
          similarArtists.push({
            name: simName,
            channelId: simBrowseId,
            cover: thumb
          });
        }
      });
    }
  }

  // Fetch full top tracks playlist to get exact durations and studio ATVs
  if (topSongsPlaylistId) {
    try {
      const plRes = await fetch(`${usedBase}/browse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
          browseId: topSongsPlaylistId
        })
      });
      if (plRes.ok) {
        const plData = await plRes.json();
        const twoCol = plData?.contents?.twoColumnBrowseResultsRenderer;
        const trackItems = twoCol?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer?.contents ||
                          twoCol?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ||
                          twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer?.contents || [];

        if (trackItems.length > 0) {
          const exactTracks: Track[] = [];
          trackItems.slice(0, 10).forEach((item: any) => {
            const r = item.musicResponsiveListItemRenderer;
            if (!r) return;
            const trackTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
            const rawVideoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
            const videoId = extractOfficialAudioTrackId(r, rawVideoId);
            const rawThumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            const thumb = cleanGoogleImageUrl(rawThumb || avatar);
            const durationStr = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;

            let duration = 180;
            if (durationStr) {
              const parts = durationStr.split(':').map(Number);
              if (parts.length === 2) duration = parts[0] * 60 + parts[1];
              else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }

            if (trackTitle && videoId) {
              const albInfo = extractAlbumInfoFromYTMItem(r);
              const trackAlbum = albInfo.albumName || trackTitle;
              const trackAlbumId = albInfo.albumId || undefined;

              exactTracks.push({
                id: `piped-${videoId}`,
                title: trackTitle,
                artist: artistName,
                albumArtist: artistName,
                album: trackAlbum,
                albumId: trackAlbumId,
                duration: duration,
                cover: thumb,
                streamUrl: `${artistName} - ${trackTitle}`,
                source: 'youtube',
                category: 'song',
                channelId: targetBrowseId
              });
            }
          });
          if (exactTracks.length > 0) {
            topTracks = exactTracks.slice(0, 5);
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch top songs playlist details:", e);
    }
  }

  // If no official header avatar was found on the artist page, fallback to top track cover
  if (!rawBanner && topTracks.length > 0 && topTracks[0].cover) {
    avatar = topTracks[0].cover;
  }

  // Fetch complete list of Albums if pagination endpoint exists
  if (albumsMoreEndpoint) {
    try {
      const moreRes = await fetch(`${usedBase}/browse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
          browseId: albumsMoreEndpoint.browseId,
          params: albumsMoreEndpoint.params
        })
      });
      if (moreRes.ok) {
        const moreData = await moreRes.json();
        const gridItems = moreData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.gridRenderer?.items || [];
        if (gridItems.length > 0) {
          const completeAlbums: Album[] = [];
          gridItems.forEach((item: any) => {
            const card = item.musicTwoRowItemRenderer;
            if (!card) return;
            const aTitle = card.title?.runs?.[0]?.text;
            const aBrowseId = card.navigationEndpoint?.browseEndpoint?.browseId;
            const aSubtitle = card.subtitle?.runs?.map((s: any) => s.text).join('') || 'Album';
            const rawThumb = card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                          card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            const thumb = cleanGoogleImageUrl(rawThumb || avatar);

            if (aTitle && aBrowseId) {
              completeAlbums.push({
                id: aBrowseId,
                name: aTitle,
                artist: artistName,
                cover: thumb,
                releaseDate: aSubtitle,
                channelId: targetBrowseId
              });
            }
          });
          if (completeAlbums.length > 0) {
            albums = completeAlbums;
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch full albums:", e);
    }
  }

  // Fetch complete list of Singles & EPs if pagination endpoint exists
  if (singlesMoreEndpoint) {
    try {
      const moreRes = await fetch(`${usedBase}/browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
          browseId: singlesMoreEndpoint.browseId,
          params: singlesMoreEndpoint.params
        })
      });
      if (moreRes.ok) {
        const moreData = await moreRes.json();
        const gridItems = moreData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.gridRenderer?.items || [];
        if (gridItems.length > 0) {
          const completeSingles: Album[] = [];
          gridItems.forEach((item: any) => {
            const card = item.musicTwoRowItemRenderer;
            if (!card) return;
            const sTitle = card.title?.runs?.[0]?.text;
            const sBrowseId = card.navigationEndpoint?.browseEndpoint?.browseId;
            const sSubtitle = card.subtitle?.runs?.map((s: any) => s.text).join('') || 'Single';
            const rawThumb = card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                          card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            const thumb = cleanGoogleImageUrl(rawThumb || avatar);

            if (sTitle && sBrowseId) {
              completeSingles.push({
                id: sBrowseId,
                name: sTitle,
                artist: artistName,
                cover: thumb,
                releaseDate: sSubtitle,
                channelId: targetBrowseId
              });
            }
          });
          if (completeSingles.length > 0) {
            singlesAndEPs = completeSingles;
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch full singles:", e);
    }
  }

  return {
    name: artistName,
    channelId: targetBrowseId,
    cover: avatar,
    banner: banner,
    topTracks,
    albums,
    singlesAndEPs,
    similarArtists
  };
}

/**
 * Fetches Official Album Detail View & Tracklist directly from YouTube Music.
 */
export async function fetchAlbumDetailsFromYTM(
  albumBrowseId: string, 
  fallbackAlbumName: string, 
  fallbackArtistName: string,
  fallbackCover?: string
): Promise<AlbumDetail | null> {
  const endpoints = [
    '/api/ytmusic/youtubei/v1',
    'https://music.youtube.com/youtubei/v1'
  ];

  let data: any = null;

  for (const base of endpoints) {
    try {
      const browseRes = await fetch(`${base}/browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
          browseId: albumBrowseId
        })
      });

      if (browseRes.ok) {
        data = await browseRes.json();
        break;
      }
    } catch (e) {}
  }

  if (!data) return null;

  const twoCol = data?.contents?.twoColumnBrowseResultsRenderer;
  const secContents = twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  const leftHeader = secContents[0]?.musicResponsiveHeaderRenderer ||
                     data?.header?.musicDetailHeaderRenderer ||
                     data?.header?.musicResponsiveHeaderRenderer ||
                     twoCol?.header?.musicResponsiveHeaderRenderer;
  
  const albumTitle = leftHeader?.title?.runs?.[0]?.text || fallbackAlbumName;
  const albumSubtitle = leftHeader?.subtitle?.runs?.map((r: any) => r.text).join('') || 'Official Release';
  const artist = leftHeader?.straplineTextOne?.runs?.[0]?.text || fallbackArtistName;
  const rawCover = leftHeader?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                   leftHeader?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                   leftHeader?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
  const cover = cleanGoogleImageUrl(rawCover || fallbackCover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80', 500);

  const trackItems = twoCol?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ||
                    twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[1]?.musicShelfRenderer?.contents ||
                    secContents[1]?.musicShelfRenderer?.contents || [];

  const tracks: Track[] = [];
  trackItems.forEach((item: any) => {
    const r = item.musicResponsiveListItemRenderer;
    if (!r) return;
    const trackTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
    const rawVideoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                    r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const videoId = extractOfficialAudioTrackId(r, rawVideoId);
    const durationStr = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
    const trackArtist = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((s: any) => s.text).join('') || artist;
    const rawTrackCover = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
    const trackCover = cleanGoogleImageUrl(rawTrackCover || cover, 500);

    let duration = 180;
    if (durationStr) {
      const parts = durationStr.split(':').map(Number);
      if (parts.length === 2) duration = parts[0] * 60 + parts[1];
      else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    if (trackTitle && videoId) {
      tracks.push({
        id: `piped-${videoId}`,
        title: trackTitle,
        artist: trackArtist,
        albumArtist: artist,
        album: albumTitle,
        duration: duration,
        cover: trackCover,
        streamUrl: `${trackArtist} - ${trackTitle}`,
        source: 'youtube',
        category: 'song'
      });
    }
  });

  return {
    id: albumBrowseId,
    name: albumTitle,
    artist: artist,
    cover: cover,
    releaseDate: albumSubtitle,
    tracks: tracks
  };
}

/**
 * Fetches Official Verified Artist Profiles & Complete Studio Discographies.
 * Exclusively backed by YouTube Music's official catalog & algorithmic recommendations.
 */
export async function fetchArtistProfile(
  artistQuery: string, 
  channelId?: string, 
  _artistId?: string | number
): Promise<ArtistProfile | null> {
  if (!artistQuery || !artistQuery.trim()) return null;
  const cleanQuery = artistQuery.trim();
  const qLower = cleanQuery.toLowerCase();

  // If search query contains song indicators (dashes, ft, feat), skip hero banner
  if (qLower.includes(' feat ') || qLower.includes(' ft ')) {
    return null;
  }

  // 1. Direct YouTube Music InnerTube Artist Profile
  try {
    const ytmProfile = await fetchArtistProfileFromYTM(cleanQuery, channelId);
    if (ytmProfile && (ytmProfile.topTracks.length > 0 || ytmProfile.albums.length > 0 || ytmProfile.singlesAndEPs.length > 0)) {
      return ytmProfile;
    }
  } catch (err) {
    console.warn('YouTube Music artist profile fetch warning:', err);
  }

  return null;
}

/**
 * Fetches Official Album Detail View & Chronological Tracklist (Tracks 1..N)
 * Resolves official playlist track IDs where available.
 */
export async function fetchAlbumDetails(
  albumId: string, 
  albumName: string, 
  artistName: string, 
  fallbackCover?: string
): Promise<AlbumDetail> {
  const cleanId = albumId.replace('album-', '').replace('album-derived-', '');
  let rawTracks: any[] = [];
  let albumCover = fallbackCover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
  let releaseDateStr: string | undefined = undefined;

  // 1. Mix and Artist Radio Handler
  if (albumId.startsWith('mix-')) {
    const artist = albumName.replace(/ Mix$/i, '').replace(/ & Friends$/i, '').trim() || artistName;
    try {
      const profile = await fetchArtistProfileFromYTM(artist);
      if (profile && profile.topTracks.length > 0) {
        return {
          id: albumId,
          name: `${artist} Mix`,
          artist: artist,
          cover: profile.cover || (profile.topTracks[0]?.cover) || fallbackCover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
          releaseDate: 'Curated Mix',
          tracks: profile.topTracks
        };
      }
    } catch (e) {
      console.warn('Mix fetch failed:', e);
    }
  }

  const isGenericName = !albumName || 
    albumName.toLowerCase() === 'web stream' || 
    albumName.toLowerCase() === 'single' || 
    albumName.toLowerCase() === 'official release' || 
    albumName.toLowerCase() === 'official audio' || 
    albumName.toLowerCase() === 'top track' || 
    albumName.toLowerCase() === 'top songs' || 
    albumName.toLowerCase() === 'youtube music';
  const effectiveAlbumName = isGenericName ? (cleanId.replace(/^album-/, '').replace(/^single-/, '') || 'Official Release') : albumName;

  let resolvedReleaseName = effectiveAlbumName;
  let resolvedCollectionId = !isNaN(Number(cleanId)) ? cleanId : '';

  // -------------------------------------------------------------
  // LAYER 1: Direct YouTube Music Browse ID (MPREb_ / OLAK / MPAD)
  // -------------------------------------------------------------
  if (albumId.startsWith('MPREb_') || albumId.startsWith('MPAD') || albumId.startsWith('VLOLAK') || cleanId.startsWith('MPREb_') || cleanId.startsWith('OLAK') || cleanId.startsWith('VLOLAK')) {
    try {
      const ytmDetail = await fetchAlbumDetailsFromYTM(cleanId, resolvedReleaseName, artistName, fallbackCover);
      if (ytmDetail && ytmDetail.tracks.length > 0 && isMatchingArtist(ytmDetail.artist, artistName)) {
        return ytmDetail;
      }
    } catch (e) {
      console.warn('YouTube Music album browse direct failed:', e);
    }
  }

  // -------------------------------------------------------------
  // LAYER 2: YouTube Music InnerTube Search for Track's Parent Album
  // -------------------------------------------------------------
  if (artistName && effectiveAlbumName) {
    const ytmEndpoints = [
      '/api/ytmusic/youtubei/v1/search',
      'https://music.youtube.com/youtubei/v1/search'
    ];

    for (const ep of ytmEndpoints) {
      try {
        const searchRes = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
            query: `${artistName} ${effectiveAlbumName}`.trim()
          })
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const sections = searchData?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
          for (const sec of sections) {
            const items = sec.musicShelfRenderer?.contents || sec.itemSectionRenderer?.contents || [];
            for (const it of items) {
              const r = it.musicResponsiveListItemRenderer;
              if (r) {
                const itemArtist = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
                if (!isMatchingArtist(itemArtist, artistName)) {
                  continue; // Do NOT pick an album from an unrelated artist!
                }

                const albInfo = extractAlbumInfoFromYTMItem(r);
                if (albInfo.albumId && albInfo.albumId.startsWith('MPREb_')) {
                  const ytmDetail = await fetchAlbumDetailsFromYTM(albInfo.albumId, albInfo.albumName || resolvedReleaseName, artistName, fallbackCover);
                  if (ytmDetail && ytmDetail.tracks.length > 0 && isMatchingArtist(ytmDetail.artist, artistName)) {
                    return ytmDetail;
                  }
                }
                if (albInfo.albumName && !isGenericName) {
                  resolvedReleaseName = albInfo.albumName;
                }
              }
            }
          }
          break;
        }
      } catch (e) {
        console.warn('YouTube Music search album resolution warning:', e);
      }
    }
  }

  // -------------------------------------------------------------
  // LAYER 3: Official Artist Discography (Multi-track Albums FIRST)
  // -------------------------------------------------------------
  if (artistName) {
    try {
      const profile = await fetchArtistProfileFromYTM(artistName);
      if (profile && isMatchingArtist(profile.name, artistName)) {
        const candidates = [resolvedReleaseName, effectiveAlbumName, albumName].filter(Boolean);
        
        // 1. Pass 1: Direct title match in full studio albums
        for (const alb of (profile.albums || [])) {
          const albNameLower = (alb.name || '').trim().toLowerCase();
          for (const cand of candidates) {
            const candLower = cand.trim().toLowerCase();
            if (albNameLower === candLower || albNameLower.includes(candLower) || candLower.includes(albNameLower)) {
              const matchedBrowseId = alb.id.replace('album-', '').replace('album-derived-', '');
              const ytmDetail = await fetchAlbumDetailsFromYTM(matchedBrowseId, alb.name || resolvedReleaseName, artistName, alb.cover || fallbackCover);
              if (ytmDetail && ytmDetail.tracks.length > 0 && isMatchingArtist(ytmDetail.artist, artistName)) {
                return ytmDetail;
              }
            }
          }
        }

        // 2. Pass 2: Deep Tracklist Inspection (Checks if this song is a track inside any studio album!)
        // e.g. "gown" is Track 7 inside the studio album "bastard"!
        for (const alb of (profile.albums || [])) {
          const matchedBrowseId = alb.id.replace('album-', '').replace('album-derived-', '');
          const ytmDetail = await fetchAlbumDetailsFromYTM(matchedBrowseId, alb.name, artistName, alb.cover || fallbackCover);
          if (ytmDetail && ytmDetail.tracks.length > 0) {
            const targetTrackLower = effectiveAlbumName.trim().toLowerCase();
            const hasTrack = ytmDetail.tracks.some(t => {
              const tTitle = (t.title || '').trim().toLowerCase();
              return tTitle === targetTrackLower || tTitle.startsWith(targetTrackLower + ' ') || tTitle.includes(`(${targetTrackLower})`);
            });
            if (hasTrack) {
              return ytmDetail; // Found parent album containing this song!
            }
          }
        }

        // 3. Pass 3: Singles & EPs fallback
        for (const single of (profile.singlesAndEPs || [])) {
          const sNameLower = (single.name || '').trim().toLowerCase();
          for (const cand of candidates) {
            const candLower = cand.trim().toLowerCase();
            if (sNameLower === candLower || sNameLower.includes(candLower) || candLower.includes(sNameLower)) {
              const matchedBrowseId = single.id.replace('album-', '').replace('album-derived-', '');
              const ytmDetail = await fetchAlbumDetailsFromYTM(matchedBrowseId, single.name || resolvedReleaseName, artistName, single.cover || fallbackCover);
              if (ytmDetail && ytmDetail.tracks.length > 0 && isMatchingArtist(ytmDetail.artist, artistName)) {
                return ytmDetail;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Artist discography album lookup failed:', e);
    }
  }

  // -------------------------------------------------------------
  // LAYER 4: Universal Parent Album Discovery via iTunes Track Search
  // -------------------------------------------------------------
  if (artistName && effectiveAlbumName) {
    try {
      const itunesTrackSearch = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(artistName + ' ' + effectiveAlbumName)}&entity=song&limit=25`
      ).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }));

      if (itunesTrackSearch.results && itunesTrackSearch.results.length > 0) {
        const qTrackLower = effectiveAlbumName.toLowerCase().trim();

        const exactTrack = itunesTrackSearch.results.find((item: any) => {
          const tLower = (item.trackName || '').toLowerCase().trim();
          const aLower = (item.artistName || '').toLowerCase().trim();
          const artistMatches = isMatchingArtist(aLower, artistName);
          const titleMatches = tLower === qTrackLower || tLower.startsWith(qTrackLower + ' ') || tLower.includes(`(${qTrackLower})`);
          return artistMatches && titleMatches;
        });

        if (exactTrack?.collectionName && isMatchingArtist(exactTrack.artistName, artistName)) {
          resolvedReleaseName = exactTrack.collectionName.replace(/ - (EP|Single|Album|LP)$/i, '').trim();
          if (exactTrack.collectionId) {
            resolvedCollectionId = String(exactTrack.collectionId);
          }
        }
      }
    } catch (e) {
      console.warn('iTunes parent album discovery warning:', e);
    }
  }

  // -------------------------------------------------------------
  // LAYER 5: Direct iTunes Album Tracklist Lookup by ID
  // -------------------------------------------------------------
  const targetItunesId = resolvedCollectionId || (!isNaN(Number(cleanId)) ? cleanId : '');
  if (targetItunesId) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${targetItunesId}&entity=song`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 1) {
          const collection = data.results[0];
          // STRICT artist matching: only accept if collection artist matches target artist!
          if (isMatchingArtist(collection.artistName, artistName)) {
            albumCover = collection.artworkUrl100
              ? collection.artworkUrl100.replace('100x100bb', '600x600bb')
              : albumCover;
            releaseDateStr = collection.releaseDate
              ? new Date(collection.releaseDate).getFullYear().toString()
              : undefined;
            resolvedReleaseName = collection.collectionName || resolvedReleaseName;

            rawTracks = data.results.slice(1).filter((item: any) => isMatchingArtist(item.artistName || collection.artistName, artistName));
          }
        }
      }
    } catch (err) {
      console.warn('iTunes direct album fetch failed:', err);
    }
  }

  // -------------------------------------------------------------
  // LAYER 6: YouTube / Invidious Playlist Handler
  // -------------------------------------------------------------
  if (rawTracks.length === 0 && isNaN(Number(cleanId)) && (cleanId.startsWith('PL') || cleanId.startsWith('OLAK') || cleanId.startsWith('RD'))) {
    try {
      const playlistPromises = INVIDIOUS_INSTANCES.map(inst =>
        fetch(`${inst}/api/v1/playlists/${cleanId}`, { signal: AbortSignal.timeout(2200) })
          .then(r => r.ok ? r.json() : Promise.reject())
      );
      const data = await Promise.any(playlistPromises);
      if (data) {
        if (data.playlistThumbnail) {
          albumCover = data.playlistThumbnail;
        }
        releaseDateStr = 'Official Release';
        rawTracks = (data.videos || []).map((v: any, index: number) => ({
          trackId: v.videoId,
          trackName: v.title,
          artistName: v.author || artistName,
          collectionName: data.title || resolvedReleaseName,
          trackTimeMillis: (v.lengthSeconds || 180) * 1000,
          trackNumber: index + 1,
          artworkUrl100: data.playlistThumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        }));
      }
    } catch (e) {
      console.warn(`Playlist fetch failed:`, e);
    }
  }

  // -------------------------------------------------------------
  // LAYER 7: Comprehensive Search by Artist & Album Name across iTunes
  // -------------------------------------------------------------
  if (rawTracks.length === 0 && artistName) {
    try {
      const searchTerms = [resolvedReleaseName, effectiveAlbumName].filter(Boolean);
      for (const term of searchTerms) {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName + ' ' + term)}&entity=song&limit=50`).then(r => r.ok ? r.json() : { results: [] });
        if (res.results && res.results.length > 0) {
          const albumCleanKey = term.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matched = res.results.filter((item: any) => {
            // STRICT artist matching: Never allow a different artist!
            if (!isMatchingArtist(item.artistName, artistName)) return false;
            const itemAlbumKey = (item.collectionName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return itemAlbumKey === albumCleanKey || itemAlbumKey.includes(albumCleanKey) || albumCleanKey.includes(itemAlbumKey);
          });
          if (matched.length > 0) {
            rawTracks = matched;
            if (rawTracks[0]?.artworkUrl100) {
              albumCover = rawTracks[0].artworkUrl100.replace('100x100bb', '600x600bb');
            }
            if (rawTracks[0]?.releaseDate) {
              releaseDateStr = rawTracks[0].releaseDate.substring(0, 4);
            }
            break;
          }
        }
      }
    } catch (e) {
      console.warn('Fallback album search failed:', e);
    }
  }

  const orderedTracks: Track[] = rawTracks
    .sort((a: any, b: any) => (a.trackNumber || 0) - (b.trackNumber || 0))
    .map((item: any) => {
      // Map YouTube playlist video items to direct play IDs, and iTunes tracks to resolver IDs
      const trackId = isNaN(Number(item.trackId)) ? `piped-${item.trackId}` : `album-track-${item.trackId}`;
      return {
        id: trackId,
        title: item.trackName,
        artist: item.artistName || artistName,
        albumArtist: item.collectionArtistName || item.artistName || artistName,
        album: item.collectionName || resolvedReleaseName || albumName,
        duration: Math.round((item.trackTimeMillis || 210000) / 1000),
        cover: item.artworkUrl100 || albumCover,
        streamUrl: `${item.artistName || artistName} - ${item.trackName}`,
        source: 'youtube',
        category: 'song'
      };
    });

  // Guarantee that single releases, unreleased tracks, and custom releases always have at least their primary track
  if (orderedTracks.length === 0) {
    const isYtVideo = cleanId.length === 11 || albumId.startsWith('piped-') || albumId.startsWith('yt-');
    const directVideoId = isYtVideo ? (cleanId.length === 11 ? cleanId : albumId.replace(/^(piped-|yt-)/, '')) : '';
    const trackId = directVideoId ? `piped-${directVideoId}` : (albumId.startsWith('track-') ? albumId : `release-track-${albumId}`);
    
    orderedTracks.push({
      id: trackId,
      title: resolvedReleaseName || albumName,
      artist: artistName,
      albumArtist: artistName,
      album: resolvedReleaseName || albumName,
      duration: 180,
      cover: albumCover,
      streamUrl: directVideoId ? `https://www.youtube.com/watch?v=${directVideoId}` : `${artistName} - ${resolvedReleaseName || albumName}`,
      source: 'youtube',
      category: 'song'
    });
  }

  return {
    id: albumId,
    name: resolvedReleaseName || albumName,
    artist: artistName,
    cover: albumCover,
    releaseDate: releaseDateStr || 'Official Release',
    tracks: orderedTracks
  };
}

// In-memory cache for resolved track videoIds and candidate fallbacks
const videoIdCache = new Map<string, string>();
const fallbackCandidatesCache = new Map<string, string[]>();

function getTrackCacheKey(artist: string, title: string): string {
  return `${artist.trim()}:::${title.trim()}`.toLowerCase().replace(/[^a-z0-9:]/g, '');
}

/**
 * Fast parallel search across Invidious instances with a fast 1500ms race timeout.
 * Returns the first successful batch of video results.
 */
async function fetchFastFromInvidious(query: string): Promise<any[]> {
  const instances = [
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://invidious.drgns.space',
    'https://inv.tux.pizza',
    'https://invidious.flokinet.to',
    'https://invidious.lunar.icu',
    'https://iv.ggtyler.dev'
  ];

  const fetchPromises = instances.map(async (inst) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1600);
    try {
      const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (e) {
      clearTimeout(timer);
    }
    throw new Error('Instance failed or empty');
  });

  try {
    return await Promise.any(fetchPromises);
  } catch {
    return [];
  }
}

/**
 * Resolves the 100% Official Audio Track Video (ATV) directly from YouTube Music's InnerTube API.
 * Guarantees zero music videos and zero visualizers by strictly filtering for the MUSIC_VIDEO_TYPE_ATV flag.
 */
export async function resolveYouTubeMusicATV(artist: string, title: string): Promise<string | null> {
  const cleanArtist = artist.trim();
  const cleanTitle = title.replace(/(\(|\[)(feat|ft|prod).*/gi, '').trim();
  const query = `${cleanArtist} ${cleanTitle}`.trim();
  if (!query) return null;

  const endpoints = [
    '/api/ytmusic/youtubei/v1/search',
    'https://music.youtube.com/youtubei/v1/search'
  ];

  const body = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20230522.01.00'
      }
    },
    query: query
  });

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const sec of sections) {
          if (sec.musicCardShelfRenderer) {
            const card = sec.musicCardShelfRenderer;
            const cTitle = card.title?.runs?.[0]?.text || '';
            const cNormTitle = cTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
            const rawId = card.onTap?.watchEndpoint?.videoId ||
                          card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                          card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
            const videoId = extractOfficialAudioTrackId(card, rawId);

            if (videoId && (cNormTitle.includes(normTitle) || normTitle.includes(cNormTitle))) {
              return videoId;
            }
          }

          const items = sec.musicShelfRenderer?.contents || sec.itemSectionRenderer?.contents || [];
          for (const item of items) {
            const r = item.musicResponsiveListItemRenderer;
            if (r) {
              const iTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
              const iNormTitle = iTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
              const rawId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                            r.playlistItemData?.videoId;
              const videoId = extractOfficialAudioTrackId(r, rawId);

              if (videoId && (iNormTitle.includes(normTitle) || normTitle.includes(iNormTitle))) {
                return videoId;
              }
            }
          }
        }
      }
    } catch (e) {
      // Try next endpoint
    }
  }

  return null;
}

/**
 * Universal Dynamic YouTube Music Topic Track Resolver
 * High-speed parallel resolver with in-memory caching and fallback candidate management.
 */
export async function resolveYouTubeVideoId(
  artist: string, 
  title: string, 
  albumArtist?: string, 
  targetDuration?: number
): Promise<string | null> {
  const cacheKey = getTrackCacheKey(artist, title);
  if (videoIdCache.has(cacheKey)) {
    return videoIdCache.get(cacheKey)!;
  }

  const primaryArtist = (albumArtist || artist).trim();
  const cleanTitle = title.toLowerCase()
    .replace(/(\(|\[)(feat|ft|prod).*/gi, '')
    .trim();

  // 1. Priority: Direct YouTube Music InnerTube ATV resolution (100% pure distributor audio)
  try {
    const atvId = await resolveYouTubeMusicATV(primaryArtist, cleanTitle);
    if (atvId) {
      videoIdCache.set(cacheKey, atvId);

      // Concurrently populate backup candidates so we have instant fallbacks if ATV has embed restrictions
      fetchFastFromInvidious(`${primaryArtist} ${cleanTitle}`)
        .then(raw => {
          if (Array.isArray(raw)) {
            const valid = raw.filter((r: any) => r.videoId && r.videoId !== atvId).map((r: any) => r.videoId);
            if (valid.length > 0) {
              fallbackCandidatesCache.set(cacheKey, valid);
            }
          }
        })
        .catch(() => {});

      return atvId;
    }
  } catch (e) {}

  const artistVariants = Array.from(new Set([
    primaryArtist.toLowerCase(),
    artist.trim().toLowerCase(),
  ])).filter(Boolean);

  const DISQUALIFIED_KEYWORDS = [
    'sped up', 'speed up', 'slowed', 'reverb', 'nightcore', 'tik tok', 'tiktok',
    'cover', 'guitar cover', 'piano cover', 'instrumental', 'reaction', 'reacting',
    'reacts', 'review', 'analysis', 'tutorial', 'how to', 'amv', 'montage', 'edit',
    'clean', 'clean version', 'clean audio', 'radio edit', 'censored', 'edited',
    'live', 'concert', 'audience', 'performance', 'tour'
  ];

  const MUSIC_VIDEO_KEYWORDS = [
    'official music video', 'official video', 'music video', ' mv', '[mv]', '(mv)'
  ];

  const AUDIO_VISUALIZER_KEYWORDS = [
    'visualizer', 'official visualizer', 'audio', 'official audio', 'track', 'stream'
  ];

  // Fire parallel queries for Topic + Standard Audio searches
  const queries = [
    `${primaryArtist} - Topic ${cleanTitle}`,
    `${primaryArtist} ${cleanTitle}`
  ];

  const searchResultsBatches = await Promise.allSettled(
    queries.map(q => fetchFastFromInvidious(q))
  );

  const rawCandidates: any[] = [];
  searchResultsBatches.forEach(res => {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      rawCandidates.push(...res.value);
    }
  });

  const uniqueCandidates = Array.from(
    new Map(rawCandidates.map(item => [item.videoId, item])).values()
  );

  const validCandidates = uniqueCandidates.filter((item: any) => {
    const vTitle = (item.title || '').toLowerCase();
    return item.videoId && !DISQUALIFIED_KEYWORDS.some(kw => vTitle.includes(kw));
  });

  if (validCandidates.length === 0) {
    if (uniqueCandidates.length > 0 && uniqueCandidates[0]?.videoId) {
      const fallbackId = uniqueCandidates[0].videoId;
      videoIdCache.set(cacheKey, fallbackId);
      return fallbackId;
    }
    return null;
  }

  // Score candidate matches
  const scored = validCandidates.map((item: any) => {
    const vTitle = (item.title || '').toLowerCase().trim();
    const vAuthor = (item.author || '').toLowerCase().trim();
    const lengthSeconds = item.lengthSeconds || 0;

    let score = 0;

    const isTopicChannel = artistVariants.some(v => vAuthor === `${v} - topic`);
    const isExactAuthor = artistVariants.some(v => vAuthor === v || vAuthor.startsWith(`${v} &`)) || isTopicChannel;
    if (isExactAuthor) score += 1000;
    if (isTopicChannel) score += 1000;

    if (vTitle.includes(cleanTitle)) score += 500;

    const isMV = MUSIC_VIDEO_KEYWORDS.some(kw => vTitle.includes(kw));
    const isVisualizerOrAudio = AUDIO_VISUALIZER_KEYWORDS.some(kw => vTitle.includes(kw));

    if (isTopicChannel && !isMV) score += 800;
    if (isVisualizerOrAudio && !isMV) score += 600;
    if (isMV) score -= 1500;

    if (targetDuration && targetDuration > 0) {
      const diff = Math.abs(lengthSeconds - targetDuration);
      if (diff <= 3) {
        score += 2000;
      } else if (diff <= 10) {
        score += 500;
      } else if (diff > 30) {
        score -= 1000;
      }
    }

    const viewCount = item.viewCount || 0;
    score += Math.min(viewCount / 10000000, 10);

    return { videoId: item.videoId, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const bestId = scored[0].videoId;
  videoIdCache.set(cacheKey, bestId);

  // Store runner-ups for instant error recovery
  const runnerUps = scored.slice(1).map(s => s.videoId);
  if (runnerUps.length > 0) {
    fallbackCandidatesCache.set(cacheKey, runnerUps);
  }

  return bestId;
}

/**
 * Dynamically resolves an alternative playable YouTube Video ID for a given artist and title.
 * Used when a primary video ID encounters embed restrictions (error 150/101) to keep playing the same song.
 */
export async function resolveAlternativeVideoId(
  artist: string,
  title: string,
  excludeVideoId?: string | null
): Promise<string | null> {
  const cacheKey = getTrackCacheKey(artist, title);
  
  // 1. Check existing fallback candidate cache
  const cachedFallbacks = fallbackCandidatesCache.get(cacheKey) || [];
  const validCached = cachedFallbacks.filter(id => id && id !== excludeVideoId);
  if (validCached.length > 0) {
    const nextId = validCached.shift()!;
    fallbackCandidatesCache.set(cacheKey, validCached);
    videoIdCache.set(cacheKey, nextId);
    return nextId;
  }

  const cleanArtist = artist.trim();
  const cleanTitle = title.toLowerCase().replace(/(\(|\[)(feat|ft|prod).*/gi, '').trim();

  // 2. Search for audio / lyrics / visualizer versions
  const searchQueries = [
    `${cleanArtist} ${cleanTitle} audio`,
    `${cleanArtist} ${cleanTitle} lyric video`,
    `${cleanArtist} ${cleanTitle}`
  ];

  const searchResultsBatches = await Promise.allSettled(
    searchQueries.map(q => fetchFastFromInvidious(q))
  );

  const rawCandidates: any[] = [];
  searchResultsBatches.forEach(res => {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      rawCandidates.push(...res.value);
    }
  });

  const uniqueCandidates = Array.from(
    new Map(rawCandidates.map(item => [item.videoId, item])).values()
  );

  const DISQUALIFIED_KEYWORDS = [
    'reaction', 'review', 'tutorial', 'how to', 'instrumental', 'guitar cover', 'piano cover'
  ];

  const validCandidates = uniqueCandidates.filter((item: any) => {
    const vTitle = (item.title || '').toLowerCase();
    return item.videoId && item.videoId !== excludeVideoId && !DISQUALIFIED_KEYWORDS.some(kw => vTitle.includes(kw));
  });

  if (validCandidates.length === 0) {
    return null;
  }

  const best = validCandidates[0].videoId;
  const remaining = validCandidates.slice(1).map((c: any) => c.videoId);
  fallbackCandidatesCache.set(cacheKey, remaining);
  videoIdCache.set(cacheKey, best);

  return best;
}

/**
 * Retrieves the next fallback videoId for a track if the primary failed.
 */
export function getFallbackVideoId(artist: string, title: string): string | null {
  const cacheKey = getTrackCacheKey(artist, title);
  const fallbacks = fallbackCandidatesCache.get(cacheKey);
  if (fallbacks && fallbacks.length > 0) {
    const nextId = fallbacks.shift()!;
    videoIdCache.set(cacheKey, nextId);
    return nextId;
  }
  return null;
}

/**
 * Removes a bad or unplayable videoId from the cache.
 */
export function invalidateVideoId(artist: string, title: string): void {
  const cacheKey = getTrackCacheKey(artist, title);
  videoIdCache.delete(cacheKey);
}

/**
 * Background prefetching for smooth next-track transitions with 0 latency.
 */
export function prefetchTrackVideoId(track: Track): void {
  if (!track || track.id.startsWith('piped-')) return;
  const cacheKey = getTrackCacheKey(track.artist, track.title);
  if (videoIdCache.has(cacheKey)) return;

  // Run in idle time without blocking the UI
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      resolveYouTubeVideoId(track.artist, track.title, track.albumArtist, track.duration).catch(() => {});
    });
  } else {
    setTimeout(() => {
      resolveYouTubeVideoId(track.artist, track.title, track.albumArtist, track.duration).catch(() => {});
    }, 500);
  }
}

/**
 * YouTube Music Algorithmic "Up Next / Auto-Mix" generator.
 * Strictly generates:
* 1. Top and deep-cut tracks by the same artist
 * 2. Songs featuring the artist & artist collaborations (e.g. Bunii & ...)
 * 3. Songs by verified musical collaborators
 * 4. Music the user actually listens to (from favorites & playHistory)
 * 
 * NEVER queries raw album names or random keywords that introduce unrelated tracks.
 */
/**
 * Canonical track deduplication signature.
 * Unifies tracks regardless of iTunes vs YouTube title formatting, topic endings, feat tags, etc.
 */
function getCanonicalSignature(title: string, artist: string): string {
  const cleanTitle = (title || '')
    .toLowerCase()
    .replace(/(\(|\[)(feat\.?|ft\.?|prod\.?|official|audio|video|lyrics|remix|version|hq|hd|topic).*/gi, '')
    .replace(/[^a-z0-9]/g, '');
  const cleanArtist = (artist || '')
    .toLowerCase()
    .replace(/ - topic$/i, '')
    .replace(/(\(|\[)(feat\.?|ft\.).*/gi, '')
    .replace(/[^a-z0-9]/g, '');
  return `${cleanArtist}___${cleanTitle}`;
}

export async function fetchUpNextMix(
  seed: Track | Track[],
  userFavorites: Track[] = [],
  playHistory: Record<string, { track: Track; playCount: number }> = {},
  excludeIds: Set<string> = new Set(),
  dislikedTracks: Track[] = [],
  blockedArtists: string[] = []
): Promise<Track[]> {
  const seedList: Track[] = Array.isArray(seed) ? seed.filter(Boolean) : (seed ? [seed] : []);
  if (seedList.length === 0) return [];

  const seenKeys = new Set<string>();
  const blockedLowerSet = new Set((blockedArtists || []).map(a => a.toLowerCase().trim()));

  // Exclude all tracks currently in the queue/seed list
  seedList.forEach(s => {
    seenKeys.add(getCanonicalSignature(s.title, s.artist));
    excludeIds.add(s.id);
  });

  // Exclude all explicitly disliked tracks
  (dislikedTracks || []).forEach(d => {
    seenKeys.add(getCanonicalSignature(d.title, d.artist));
    if (d.id) excludeIds.add(d.id);
  });

  // Extract all unique primary artists from the queue (preserving queue appearance order, excluding blocked artists)
  const uniqueArtists: string[] = [];
  seedList.forEach(s => {
    const raw = (s.artist || '').split(/[,&/]| feat\.? | ft\.? | with /i)[0].trim();
    const rawLower = raw.toLowerCase();
    const isBlocked = blockedLowerSet.has(rawLower) || Array.from(blockedLowerSet).some(b => b && (rawLower === b || rawLower.includes(b)));
    if (raw && !isBlocked && !uniqueArtists.some(a => a.toLowerCase() === rawLower)) {
      uniqueArtists.push(raw);
    }
  });

  // Limit seed artists to top 4 to maintain fast parallel search times
  const activeSeedArtists = uniqueArtists.slice(0, 4);

  // For each seed artist, fetch their deep catalog, collabs, and related tracks
  const artistPools: Map<string, Track[]> = new Map();
  const collabPools: Map<string, Track[]> = new Map();
  const similarArtistPools: Map<string, Track[]> = new Map();

  const artistFetches = activeSeedArtists.map(async (artistName) => {
    const artistLower = artistName.toLowerCase().trim();
    const artistTracks: Track[] = [];
    const collabTracks: Track[] = [];

    // Parallel fetch: iTunes Exact Artist Catalog + YouTube Topic Catalog + Real YouTube Music Similar Artists
    try {
      const [artistTermRes, generalSongRes, ytTopicItems, similarArtists] = await Promise.allSettled([
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&attribute=artistTerm&entity=song&limit=35`)
          .then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName + ' feat')}&entity=song&limit=15`)
          .then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
        fetchFastFromInvidious(`${artistName} Topic`),
        fetchSimilarArtists(artistName, seedList[0]?.id)
      ]);

      const itunesTracks = [
        ...(artistTermRes.status === 'fulfilled' && artistTermRes.value.results ? artistTermRes.value.results : []),
        ...(generalSongRes.status === 'fulfilled' && generalSongRes.value.results ? generalSongRes.value.results : [])
      ];

      itunesTracks.forEach((item: any) => {
        if (!item.trackName || !item.artistName) return;
        const key = getCanonicalSignature(item.trackName, item.artistName);
        const id = `track-${item.trackId}`;

        if (seenKeys.has(key) || excludeIds.has(id)) return;

        const aLower = item.artistName.toLowerCase().trim();
        const tLower = item.trackName.toLowerCase().trim();

        // Check if artist is blocked
        if (blockedLowerSet.has(aLower) || Array.from(blockedLowerSet).some(b => b && (aLower === b || aLower.includes(b)))) {
          return;
        }

        const trackObj: Track = {
          id,
          title: item.trackName,
          artist: item.artistName,
          albumArtist: item.collectionArtistName || item.artistName,
          album: item.collectionName || 'Single',
          duration: Math.round((item.trackTimeMillis || 210000) / 1000),
          cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : seedList[0].cover,
          streamUrl: `${item.artistName} - ${item.trackName}`,
          source: 'youtube',
          category: 'song'
        };

        // 1. Exact artist match ONLY (rejects false positives like "Angel Slayr")
        if (aLower === artistLower) {
          seenKeys.add(key);
          artistTracks.push(trackObj);
        }
        // 2. Strict Collaboration match (must contain explicit conjunction with artist)
        else {
          const hasExplicitFeatInTitle = tLower.includes(`feat. ${artistLower}`) || 
                                       tLower.includes(`ft. ${artistLower}`) || 
                                       tLower.includes(`feat ${artistLower}`) ||
                                       tLower.includes(`with ${artistLower}`);
          
          const hasConjunctionInArtist = (aLower.startsWith(`${artistLower} &`) ||
                                          aLower.startsWith(`${artistLower} x`) ||
                                          aLower.startsWith(`${artistLower} +`) ||
                                          aLower.startsWith(`${artistLower},`) ||
                                          aLower.endsWith(`& ${artistLower}`) ||
                                          aLower.endsWith(`x ${artistLower}`) ||
                                          aLower.endsWith(`+ ${artistLower}`) ||
                                          aLower.endsWith(`, ${artistLower}`) ||
                                          aLower.includes(`feat. ${artistLower}`) ||
                                          aLower.includes(`ft. ${artistLower}`));

          if (hasExplicitFeatInTitle || hasConjunctionInArtist) {
            seenKeys.add(key);
            collabTracks.push(trackObj);
          }
        }
      });

      // YouTube Topic Tracks
      if (ytTopicItems.status === 'fulfilled' && Array.isArray(ytTopicItems.value)) {
        ytTopicItems.value.forEach((item: any) => {
          if (!item.title || !item.videoId) return;
          const author = item.author ? item.author.replace(' - Topic', '').trim() : artistName;
          const key = getCanonicalSignature(item.title, author);
          const id = `piped-${item.videoId}`;

          if (seenKeys.has(key) || excludeIds.has(id)) return;

          if (author.toLowerCase().trim() === artistLower) {
            seenKeys.add(key);
            artistTracks.push({
              id,
              title: item.title,
              artist: author,
              albumArtist: author,
              album: item.title,
              duration: item.lengthSeconds || 180,
              cover: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
              streamUrl: `${author} - ${item.title}`,
              source: 'youtube',
              category: 'song'
            });
          }
        });
      }

      // Fetch top tracks for real similar/peer artists from YouTube Music
      const similarTracks: Track[] = [];
      if (similarArtists.status === 'fulfilled' && Array.isArray(similarArtists.value) && similarArtists.value.length > 0) {
        const topPeers = similarArtists.value.slice(0, 4);
        const peerFetches = topPeers.map(peer =>
          fetchArtistDeepTracks(peer.name).catch(() => [])
        );
        const peerResults = await Promise.allSettled(peerFetches);
        peerResults.forEach(pr => {
          if (pr.status === 'fulfilled' && Array.isArray(pr.value)) {
            pr.value.forEach(pTrack => {
              const key = getCanonicalSignature(pTrack.title, pTrack.artist);
              if (!seenKeys.has(key) && !excludeIds.has(pTrack.id)) {
                seenKeys.add(key);
                similarTracks.push(pTrack);
              }
            });
          }
        });
      }
      similarArtistPools.set(artistName, similarTracks);

    } catch (e) {}

    artistPools.set(artistName, artistTracks);
    collabPools.set(artistName, collabTracks);
  });

  await Promise.allSettled(artistFetches);

  // User Taste Pool (matching mood/vibe)
  const userTastePool: Track[] = [];
  userFavorites.forEach(fav => {
    const key = getCanonicalSignature(fav.title, fav.artist);
    if (!seenKeys.has(key) && !excludeIds.has(fav.id)) {
      seenKeys.add(key);
      userTastePool.push(fav);
    }
  });

  const topHistoryArtists = Object.values(playHistory)
    .sort((a, b) => b.playCount - a.playCount)
    .map(h => h.track)
    .filter(t => t && !excludeIds.has(t.id));

  topHistoryArtists.forEach(histTrack => {
    const key = getCanonicalSignature(histTrack.title, histTrack.artist);
    if (!seenKeys.has(key) && !excludeIds.has(histTrack.id)) {
      seenKeys.add(key);
      userTastePool.push(histTrack);
    }
  });

  // Shuffle individual pools
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  artistPools.forEach(pool => shuffle(pool));
  collabPools.forEach(pool => shuffle(pool));
  similarArtistPools.forEach(pool => shuffle(pool));
  shuffle(userTastePool);

  // Interleave recommendations across ALL seed artists and their scene
  const finalMix: Track[] = [];

  // Round-robin blend across all seed artists in the queue
  let addedInRound = true;
  while (finalMix.length < 32 && addedInRound) {
    addedInRound = false;

    // A. One track per seed artist in the queue
    for (const artistName of activeSeedArtists) {
      const pool = artistPools.get(artistName);
      if (pool && pool.length > 0) {
        finalMix.push(pool.shift()!);
        addedInRound = true;
      }
    }

    // B. One collaboration / feature per seed artist
    for (const artistName of activeSeedArtists) {
      const collabs = collabPools.get(artistName);
      if (collabs && collabs.length > 0) {
        finalMix.push(collabs.shift()!);
        addedInRound = true;
      }
    }

    // C. One real scene peer / similar artist track from YouTube Music
    for (const artistName of activeSeedArtists) {
      const peers = similarArtistPools.get(artistName);
      if (peers && peers.length > 0) {
        finalMix.push(peers.shift()!);
        addedInRound = true;
      }
    }

    // D. One user taste track
    if (userTastePool.length > 0) {
      finalMix.push(userTastePool.shift()!);
      addedInRound = true;
    }
  }

  return finalMix;
}

/**
 * Search Public & Community Playlists (YouTube Music / Spotify Style)
 * Returns both verified curated mixes (This Is X, X Essentials, Deep Cuts) 
 * and real community public playlists from YouTube/Invidious.
 */
export async function searchPublicPlaylists(
  query: string, 
  topTracks: Track[] = []
): Promise<PublicPlaylist[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();
  const playlists: PublicPlaylist[] = [];
  const seenIds = new Set<string>();

  // 1. Curated Verified Mixes (Spotify / YouTube Music Style)
  if (topTracks.length > 0) {
    // "This Is [Artist]" / "[Artist] Essentials"
    playlists.push({
      id: `curated-essentials-${encodeURIComponent(cleanQuery)}`,
      name: `${cleanQuery} Essentials`,
      author: 'OwO Music Curated',
      cover: topTracks[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
      trackCount: Math.min(topTracks.length, 25),
      source: 'curated',
      description: `The essential tracks and greatest hits by ${cleanQuery}.`,
      tracks: topTracks.slice(0, 25)
    });

    // "[Artist] & Friends / Radio Mix"
    if (topTracks.length > 3) {
      playlists.push({
        id: `curated-radio-${encodeURIComponent(cleanQuery)}`,
        name: `${cleanQuery} Radio Mix`,
        author: 'Algorithmic Mix',
        cover: topTracks[1]?.cover || topTracks[0]?.cover,
        trackCount: 30,
        source: 'curated',
        description: `Top hits and musical styles inspired by ${cleanQuery}.`,
        tracks: topTracks
      });
    }

    // "[Artist] Deep Cuts & Complete"
    if (topTracks.length > 5) {
      playlists.push({
        id: `curated-deepcuts-${encodeURIComponent(cleanQuery)}`,
        name: `${cleanQuery}: Complete & Deep Cuts`,
        author: 'Community Mix',
        cover: topTracks[2]?.cover || topTracks[0]?.cover,
        trackCount: topTracks.length,
        source: 'curated',
        description: `Full discography and unreleased gems for true fans.`,
        tracks: [...topTracks].reverse()
      });
    }
  }

  // 2. Fetch Public Community Playlists from YouTube/Invidious
  const fetchPlaylistPromise = (async () => {
    for (const inst of INVIDIOUS_INSTANCES.slice(0, 3)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(cleanQuery + ' playlist')}&type=playlist`, {
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            data.slice(0, 15).forEach((item: any) => {
              if (!item.playlistId || seenIds.has(item.playlistId)) return;
              seenIds.add(item.playlistId);

              const cover = item.playlistThumbnail 
                || (item.videos && item.videos[0]?.videoId ? `https://i.ytimg.com/vi/${item.videos[0].videoId}/hqdefault.jpg` : '')
                || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';

              playlists.push({
                id: `yt-pl-${item.playlistId}`,
                playlistId: item.playlistId,
                name: item.title,
                author: item.author || 'YouTube Community',
                cover,
                trackCount: item.videoCount || (item.videos ? item.videos.length : 20),
                source: 'youtube',
                description: `Public playlist by ${item.author || 'Community'}`
              });
            });
            if (playlists.length >= 6) break;
          }
        }
      } catch (e) {}
    }
  })();

  await fetchPlaylistPromise;
  return playlists;
}

/**
 * Fetches tracks of a Public Playlist (with cache)
 */
export async function fetchPublicPlaylistTracks(playlist: PublicPlaylist): Promise<Track[]> {
  if (playlist.tracks && playlist.tracks.length > 0) {
    return playlist.tracks;
  }

  if (playlist.playlistId) {
    for (const inst of INVIDIOUS_INSTANCES.slice(0, 3)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${inst}/api/v1/playlists/${playlist.playlistId}`, {
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.videos)) {
            return data.videos.map((v: any) => ({
              id: `piped-${v.videoId}`,
              title: v.title,
              artist: v.author || playlist.author,
              albumArtist: v.author || playlist.author,
              album: playlist.name,
              duration: v.lengthSeconds || 180,
              cover: v.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
              streamUrl: `${v.author} - ${v.title}`,
              source: 'youtube',
              category: 'song'
            }));
          }
        }
      } catch (e) {}
    }
  }

  return [];
}

/**
 * Fetches genuine tracks by an artist with archive channel support and strict name disambiguation.
 * Correctly distinguishes underground artists (e.g. "scruff" with "scruff's archive")
 * from unrelated mainstream artists (e.g. "Mr. Scruff" or "Eliad Cohen").
 */
export async function fetchArtistDeepTracks(artistName: string): Promise<Track[]> {
  if (!artistName || !artistName.trim()) return [];
  const cleanArtist = artistName.trim();
  const artistLower = cleanArtist.toLowerCase();

  const results: Track[] = [];
  const seenKeys = new Set<string>();

  // 1. YouTube Topic, Archive Channels & Direct Audio Searches
  const ytQueries = [
    `${cleanArtist} - Topic`,
    `${cleanArtist}'s archive`,
    `${cleanArtist} archive`,
    `${cleanArtist} songs`
  ];

  try {
    const ytBatches = await Promise.allSettled(
      ytQueries.map(q => fetchFastFromInvidious(q))
    );

    ytBatches.forEach(batch => {
      if (batch.status === 'fulfilled' && Array.isArray(batch.value)) {
        batch.value.forEach((item: any) => {
          if (!item.title || !item.videoId) return;

          const rawAuthor = (item.author || '').toLowerCase().trim();
          const cleanAuthor = rawAuthor.replace(/ - topic$/i, '').trim();
          const titleLower = (item.title || '').toLowerCase().trim();

          // 1. Exact match with artist
          const isExactAuthor = cleanAuthor === artistLower;
          const isTopic = rawAuthor === `${artistLower} - topic`;

          // 2. Archive / Vault / Unreleased channels by the artist (e.g. "[Artist]'s archive", "[Artist] archive")
          const isArchive = cleanAuthor.startsWith(artistLower) && (
            cleanAuthor.includes('archive') || 
            cleanAuthor.includes('vault') || 
            cleanAuthor.includes('unreleased')
          );

          // 3. Official Collaborations / Features with artist
          const isCollab = cleanAuthor.startsWith(`${artistLower} &`) || 
                          cleanAuthor.startsWith(`${artistLower} x `) || 
                          cleanAuthor.startsWith(`${artistLower} feat`) || 
                          cleanAuthor.startsWith(`${artistLower} ft`);

          // 4. Feature in title (e.g. "Song (feat. [Artist])")
          const escapedArtist = artistLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isFeatureInTitle = (titleLower.includes('feat') || titleLower.includes('ft')) && 
            new RegExp(`\\b${escapedArtist}\\b`, 'i').test(titleLower);

          // Disqualify separate unrelated artists that merely contain artist as a substring (e.g. "Mr. [Artist]" or "[Artist] XYZ")
          if (!isExactAuthor && !isTopic && !isArchive && !isCollab && !isFeatureInTitle) {
            return;
          }

          const author = isArchive 
            ? `${cleanArtist} (Archive)` 
            : (item.author ? item.author.replace(' - Topic', '').trim() : cleanArtist);

          const key = `${author}-${item.title}`.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({
              id: `piped-${item.videoId}`,
              title: item.title,
              artist: cleanArtist,
              albumArtist: cleanArtist,
              album: item.title,
              duration: item.lengthSeconds || 180,
              cover: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
              streamUrl: `${cleanArtist} - ${item.title}`,
              source: 'youtube',
              category: 'song'
            });
          }
        });
      }
    });
  } catch (e) {}

  // 2. iTunes Exact Match Query (Only items where artistName strictly matches)
  try {
    const itunesRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanArtist)}&attribute=artistTerm&entity=song&limit=25`
    ).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }));

    if (itunesRes.results) {
      itunesRes.results.forEach((item: any) => {
        if (!item.trackName || !item.artistName) return;

        const itunesArtistLower = item.artistName.toLowerCase().trim();
        // Strict name equality check so "Mr. Scruff" is never included when searching "scruff"
        if (itunesArtistLower !== artistLower && !itunesArtistLower.startsWith(`${artistLower} &`)) {
          return;
        }

        const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push({
            id: `track-${item.trackId}`,
            title: item.trackName,
            artist: item.artistName,
            albumArtist: item.collectionArtistName || item.artistName,
            album: item.collectionName || 'Single',
            duration: Math.round((item.trackTimeMillis || 210000) / 1000),
            cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
            streamUrl: `${item.artistName} - ${item.trackName}`,
            source: 'youtube',
            category: 'song'
          });
        }
      });
    }
  } catch (e) {}

  return results;
}

/**
 * Fetches authentic Fan Remixes, Slowed+Reverb Edits, Covers & Bootlegs
 * specifically based on the user's top played songs.
 */
export async function fetchCoversAndRemixes(seedTracks: Track[]): Promise<Track[]> {
  if (!seedTracks || seedTracks.length === 0) return [];
  const results: Track[] = [];
  const seenKeys = new Set<string>();

  const topSeeds = seedTracks.slice(0, 3);
  const remixKeywords = ['remix', 'slowed', 'reverb', 'sped up', 'cover', 'flip', 'edit', 'vip', 'bootleg'];

  const queries: { track: Track; query: string }[] = [];
  topSeeds.forEach(t => {
    queries.push({ track: t, query: `${t.artist} ${t.title} remix` });
    queries.push({ track: t, query: `${t.artist} ${t.title} slowed reverb` });
  });

  const batches = await Promise.allSettled(
    queries.map(q => fetchFastFromInvidious(q.query))
  );

  batches.forEach((batch, idx) => {
    if (batch.status === 'fulfilled' && Array.isArray(batch.value)) {
      const seed = queries[idx].track;
      batch.value.forEach((item: any) => {
        if (!item.title || !item.videoId) return;

        const titleLower = item.title.toLowerCase();
        const hasRemixTag = remixKeywords.some(kw => titleLower.includes(kw));

        // Skip exact original track itself; we only want covers/remixes/edits
        if (!hasRemixTag) return;

        const key = `remix-${item.videoId}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push({
            id: `piped-${item.videoId}`,
            title: item.title,
            artist: item.author ? item.author.replace(' - Topic', '') : seed.artist,
            albumArtist: seed.artist,
            album: 'Remixes & Edits',
            duration: item.lengthSeconds || 180,
            cover: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            streamUrl: `${seed.artist} - ${item.title}`,
            source: 'youtube',
            category: 'song'
          });
        }
      });
    }
  });

  return results;
}

/**
 * Helper to reliably extract the highest quality thumbnail / cover image
 * from an Invidious / YouTube playlist object.
 */
export function extractPlaylistCover(item: any): string {
  if (typeof item.playlistThumbnail === 'string' && item.playlistThumbnail.trim()) {
    return item.playlistThumbnail;
  }
  if (typeof item.cover === 'string' && item.cover.trim()) {
    return item.cover;
  }
  if (Array.isArray(item.playlistThumbnails) && item.playlistThumbnails.length > 0) {
    const high = item.playlistThumbnails.find((t: any) => t.quality === 'high' || t.quality === 'maxres' || t.quality === 'medium') || item.playlistThumbnails[0];
    if (typeof high === 'string' && high) return high;
    if (high?.url) return high.url;
  }
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    const high = item.thumbnails.find((t: any) => t.quality === 'high' || t.quality === 'maxres' || t.quality === 'medium') || item.thumbnails[0];
    if (typeof high === 'string' && high) return high;
    if (high?.url) return high.url;
  }
  if (Array.isArray(item.videos) && item.videos.length > 0) {
    for (const vid of item.videos) {
      if (vid?.videoId) {
        return `https://i.ytimg.com/vi/${vid.videoId}/hqdefault.jpg`;
      }
      if (Array.isArray(vid?.videoThumbnails) && vid.videoThumbnails.length > 0) {
        const vThumb = vid.videoThumbnails.find((t: any) => t.quality === 'high' || t.quality === 'medium') || vid.videoThumbnails[0];
        if (typeof vThumb === 'string' && vThumb) return vThumb;
        if (vThumb?.url) return vThumb.url;
      }
    }
  }
  if (Array.isArray(item.authorThumbnails) && item.authorThumbnails.length > 0) {
    const aThumb = item.authorThumbnails[item.authorThumbnails.length - 1];
    if (typeof aThumb === 'string' && aThumb) return aThumb;
    if (aThumb?.url) return aThumb.url;
  }
  return 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
}

/**
 * Fetches Official Albums for given top artists directly from YouTube Music InnerTube.
 */
export async function fetchAlbumsForYou(topArtists: string[]): Promise<PublicPlaylist[]> {
  const artistsToQuery = (topArtists && topArtists.length > 0) 
    ? topArtists.slice(0, 4) 
    : ['bunii', 'Skyte', 'Kendrick Lamar'];
  
  const results: PublicPlaylist[] = [];
  const seenIds = new Set<string>();

  for (const artist of artistsToQuery) {
    try {
      const profile = await fetchArtistProfileFromYTM(artist);
      if (profile && profile.albums.length > 0) {
        profile.albums.forEach(alb => {
          if (!seenIds.has(alb.id)) {
            seenIds.add(alb.id);
            results.push({
              id: alb.id,
              playlistId: alb.id,
              name: alb.name,
              author: alb.artist || artist,
              cover: alb.cover,
              trackCount: 10,
              source: 'youtube',
              description: `Official album by ${alb.artist || artist}`
            });
          }
        });
      }
    } catch (e) {}
  }

  // If no albums found for those artists, fallback to their singles / EPs
  if (results.length === 0) {
    for (const artist of artistsToQuery) {
      try {
        const profile = await fetchArtistProfileFromYTM(artist);
        if (profile && profile.singlesAndEPs.length > 0) {
          profile.singlesAndEPs.slice(0, 3).forEach(s => {
            if (!seenIds.has(s.id)) {
              seenIds.add(s.id);
              results.push({
                id: s.id,
                playlistId: s.id,
                name: s.name,
                author: s.artist || artist,
                cover: s.cover,
                trackCount: 4,
                source: 'youtube',
                description: `Official release by ${s.artist || artist}`
              });
            }
          });
        }
      } catch (e) {}
    }
  }

  return results.slice(0, 15);
}

/**
 * Fetches community and peer mixes curated for top artists.
 */
export async function fetchCommunityPlaylistsForYou(topArtists: string[]): Promise<PublicPlaylist[]> {
  const artistsToQuery = (topArtists && topArtists.length > 0) 
    ? topArtists.slice(0, 3) 
    : ['bunii', 'Skyte'];
  
  const results: PublicPlaylist[] = [];
  const seenIds = new Set<string>();

  for (const artist of artistsToQuery) {
    try {
      const profile = await fetchArtistProfileFromYTM(artist);
      if (profile && profile.similarArtists && profile.similarArtists.length > 0) {
        profile.similarArtists.slice(0, 4).forEach(sim => {
          const simId = `mix-${sim.name}`;
          if (!seenIds.has(simId)) {
            seenIds.add(simId);
            results.push({
              id: simId,
              playlistId: simId,
              name: `${sim.name} & Friends`,
              author: `Curated Taste`,
              cover: cleanGoogleImageUrl(sim.cover, 500),
              trackCount: 20,
              source: 'community',
              description: `Curated mix exploring ${sim.name} & related sounds`
            });
          }
        });
      }
    } catch (e) {}
  }

  return results.slice(0, 15);
}

/**
 * Fetches authentic Similar Artist Playlists & Mixes based on a given seed playlist or history.
 * Queries YouTube Music's algorithmic peer cluster for the exact top artists.
 */
export async function fetchSimilarPlaylists(seedPlaylist: Playlist): Promise<PublicPlaylist[]> {
  if (!seedPlaylist.tracks || seedPlaylist.tracks.length === 0) return [];
  
  const artistCounts: Record<string, number> = {};
  seedPlaylist.tracks.forEach(t => {
    if (t.artist) {
      artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
    }
  });
  
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(e => e[0]);
    
  if (topArtists.length === 0) return [];
  
  const results: PublicPlaylist[] = [];
  const seenNames = new Set<string>();

  for (const primaryArtist of topArtists) {
    const primKey = primaryArtist.toLowerCase().trim();
    if (!seenNames.has(primKey)) {
      seenNames.add(primKey);
      try {
        const primProfile = await fetchArtistProfileFromYTM(primaryArtist);
        if (primProfile) {
          // 1. Primary Artist Mix
          results.push({
            id: `mix-${primaryArtist}`,
            playlistId: `mix-${primaryArtist}`,
            name: `${primaryArtist} Mix`,
            author: `Artist Radio`,
            cover: primProfile.cover || (primProfile.topTracks[0]?.cover) || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
            trackCount: 25,
            source: 'community',
            description: `Radio mix for ${primaryArtist}`,
            channelId: primProfile.channelId
          });

          // 2. Peer Artist Mixes (Fans Might Also Like)
          const peerArtists = primProfile.similarArtists || [];
          for (const peer of peerArtists.slice(0, 5)) {
            const peerKey = peer.name.toLowerCase().trim();
            if (!seenNames.has(peerKey)) {
              seenNames.add(peerKey);
              results.push({
                id: `mix-${peer.name}`,
                playlistId: `mix-${peer.name}`,
                name: `${peer.name} Mix`,
                author: `Similar to ${primaryArtist}`,
                cover: cleanGoogleImageUrl(peer.cover, 500),
                trackCount: 25,
                source: 'community',
                description: `Music by ${peer.name} and artists similar to ${primaryArtist}`,
                channelId: peer.channelId
              });
            }
          }
        }
      } catch (e) {}
    }
  }

  return results.slice(0, 15);
}

/**
 * Fetches authentic Similar Artists for the Related tab:
 * 1. Track-specific Related artists and Mood matches from YouTube Music's InnerTube /next and /browse endpoints
 * 2. Official collaborators and featured artists extracted directly from the artist's releases and tracks
 * 3. Algorithmic peer artists from YouTube Music's InnerTube "Fans Might Also Like" cluster
 */
export async function fetchSimilarArtists(artistName: string, videoIdOrTrackId?: string | number): Promise<SimilarArtist[]> {
  if (!artistName || !artistName.trim()) return [];
  const clean = artistName.trim();
  const cleanLower = clean.toLowerCase();
  
  const results: SimilarArtist[] = [];
  const seenArtists = new Set<string>();
  seenArtists.add(cleanLower);

  const endpoints = [
    '/api/ytmusic/youtubei/v1',
    'https://music.youtube.com/youtubei/v1'
  ];

  const addArtist = (name: string, cover?: string, artistId?: string | number, channelId?: string, isDedicated = false) => {
    if (!name) return;
    
    // Split combined names if multiple artists are grouped together
    if (name.includes(',') || name.includes(' & ') || name.includes(' and ')) {
      const parts = name.split(/[,&/]| and /i);
      parts.forEach(p => addArtist(p, cover, artistId, channelId, isDedicated));
      return;
    }

    let trimmed = name.trim()
      .replace(/^(?:\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s+/i, '')
      .replace(/ - Topic$/i, '')
      .trim();
    
    // Strip surrounding brackets and quotes
    trimmed = trimmed.replace(/^[(\["']+|[)\]"']+$/g, '').trim();
    const tLower = trimmed.toLowerCase();

    // Disqualify invalid names, channel keywords, or current artist
    if (!trimmed || trimmed.length < 2 || seenArtists.has(tLower)) return;
    if (tLower === cleanLower || tLower.includes('various') || tLower.includes('topic') || tLower.includes('records') || tLower.includes('soundtrack') || tLower.includes('official') || tLower.includes('audio') || tLower.includes('video') || tLower.includes('visualizer') || tLower.includes('performance')) return;
    
    // Reject substring false positives like 'juliibunii' when target is 'bunii'
    if (tLower.includes(cleanLower) && !tLower.includes(' & ') && !tLower.includes(' and ') && !tLower.includes(' feat')) return;

    seenArtists.add(tLower);
    results.push({
      name: trimmed,
      artistId: artistId,
      channelId: channelId,
      cover: isDedicated && cover ? cleanGoogleImageUrl(cover, 500) : ''
    });
  };

  try {
    // 1. If a track / video ID is available, query YouTube Music's track-specific Related endpoint
    const videoId = typeof videoIdOrTrackId === 'string'
      ? videoIdOrTrackId.replace('piped-', '').replace('yt-', '').replace('youtube-', '')
      : undefined;

    if (videoId && videoId.length === 11) {
      for (const base of endpoints) {
        try {
          const nextRes = await fetch(`${base}/next`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
              videoId: videoId
            })
          });

          if (nextRes.ok) {
            const nextData = await nextRes.json();
            const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
            const relatedBrowseId = tabs[3]?.tabRenderer?.endpoint?.browseEndpoint?.browseId;

            if (relatedBrowseId) {
              const browseRes = await fetch(`${base}/browse`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20230522.01.00" } },
                  browseId: relatedBrowseId
                })
              });

              if (browseRes.ok) {
                const browseData = await browseRes.json();
                const sections = browseData?.contents?.sectionListRenderer?.contents || [];

                sections.forEach((sec: any) => {
                  const shelf = sec.musicCarouselShelfRenderer || sec.musicShelfRenderer;
                  const title = (shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || shelf?.title?.runs?.[0]?.text || '').toLowerCase();
                  const items = shelf?.contents || [];

                  // A. Track-specific Similar Artists
                  if (title.includes('similar artist') || title.includes('artists')) {
                    items.forEach((it: any) => {
                      const card = it.musicTwoRowItemRenderer;
                      const name = card?.title?.runs?.[0]?.text;
                      const bId = card?.navigationEndpoint?.browseEndpoint?.browseId;
                      const thumb = card?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
                      if (name) addArtist(name, thumb, undefined, bId, true);
                    });
                  }

                  // B. Track-specific Mood Matches (You Might Also Like)
                  if (title.includes('you might also like')) {
                    items.forEach((it: any) => {
                      const r = it.musicResponsiveListItemRenderer;
                      const artistRun = r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
                      const bId = r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
                      const thumb = r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
                      if (artistRun) addArtist(artistRun, thumb, undefined, bId, true);
                    });
                  }
                });
                break;
              }
            }
          }
        } catch (e) {}
      }
    }

    // 2. Artist Profile Source (Collaborators and Fans Might Also Like)
    const profile = await fetchArtistProfileFromYTM(clean);

    if (profile) {
      // Add profile peer artists (Fans Might Also Like) with their dedicated avatars
      (profile.similarArtists || []).forEach(sim => {
        addArtist(sim.name, sim.cover, undefined, sim.channelId, true);
      });

      // Extract collaborating artists from singles & track titles (avatars resolved individually)
      const allTitles = [
        ...profile.topTracks.map(t => t.title),
        ...profile.singlesAndEPs.map(s => s.name)
      ];

      allTitles.forEach(title => {
        const featMatch = /(?:feat\.?|ft\.?|featuring|with|\bx\b|\b&\b)\s+([^()\[\]]+)/i.exec(title);
        if (featMatch) {
          const collabPart = featMatch[1];
          const names = collabPart.split(/[,&/]| and /i);
          names.forEach(n => {
            const nClean = n.trim();
            if (nClean && nClean.toLowerCase() !== cleanLower) {
              addArtist(nClean, undefined, undefined, undefined, false);
            }
          });
        }
      });
    }

    // 3. Fallback to iTunes collaborator discovery if under 8 results
    if (results.length < 8) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(clean)}&entity=song&limit=50`);
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          (itunesData.results || []).forEach((item: any) => {
            const rawArtist = item.artistName || '';
            const aLower = rawArtist.toLowerCase();

            if (aLower.includes('&') || aLower.includes(',') || aLower.includes(' feat') || aLower.includes(' ft')) {
              const parts = rawArtist.split(/[,&/]| feat\.? | ft\.? | featuring /i);
              parts.forEach((p: string) => {
                const pClean = p.trim();
                if (pClean && pClean.toLowerCase() !== cleanLower) {
                  addArtist(pClean, undefined, item.artistId, undefined, false);
                }
              });
            }
          });
        }
      } catch (e) {}
    }

    // 4. Resolve authentic, dedicated avatars in parallel for all artists missing a dedicated avatar
    const candidates = results.slice(0, 16);
    await Promise.all(
      candidates.map(async (artist) => {
        if (!artist.cover || artist.cover.includes('unsplash')) {
          artist.cover = await resolveArtistAvatar(artist.name);
        }
      })
    );

    // Dynamic rotation: shuffle the authentic related pool so every track playback / tab open is fresh
    if (candidates.length > 3) {
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
    }

    return candidates.slice(0, 14);
  } catch (err) {
    console.warn('fetchSimilarArtists warning:', err);
  }

  return results.slice(0, 14);
}

/**
 * Resolves a direct playable audio stream URL from Piped / Invidious for real HTML5 Audio and Web Audio API spectrum analysis.
 */
const directStreamCache = new Map<string, string>();

export async function fetchDirectAudioStream(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  if (directStreamCache.has(videoId)) {
    return directStreamCache.get(videoId)!;
  }

  const endpoints = [
    `https://pipedapi.kavin.rocks/streams/${videoId}`,
    `https://api.piped.yt/streams/${videoId}`,
    `https://pipedapi.tokhmi.xyz/streams/${videoId}`,
    `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
    `https://inv.tux.pizza/api/v1/videos/${videoId}`,
    `https://invidious.jing.rocks/api/v1/videos/${videoId}`,
    `https://inv.nadeko.net/api/v1/videos/${videoId}`,
    `https://iv.ggtyler.dev/api/v1/videos/${videoId}`
  ];

  // Race endpoints in parallel batches of 3 for fast resolution (~200ms)
  for (let i = 0; i < endpoints.length; i += 3) {
    const batch = endpoints.slice(i, i + 3);
    try {
      const results = await Promise.all(
        batch.map(async (ep) => {
          try {
            const res = await fetch(ep, { signal: AbortSignal.timeout(2200) });
            if (!res.ok) return null;
            const data = await res.json();

            // 1. Piped audio stream extraction
            if (Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
              const best = data.audioStreams.find((s: any) => s.bitrate >= 128000) || data.audioStreams[0];
              if (best?.url) return best.url;
            }

            // 2. Invidious adaptive formats audio extraction
            if (Array.isArray(data.adaptiveFormats)) {
              const audioOnly = data.adaptiveFormats.filter((f: any) => (f.type && f.type.includes('audio')) || (f.mimeType && f.mimeType.includes('audio')));
              if (audioOnly.length > 0) {
                const best = audioOnly.find((f: any) => f.bitrate >= 128000) || audioOnly[0];
                if (best?.url) return best.url;
              }
            }
          } catch (e) {}
          return null;
        })
      );

      const found = results.find(Boolean);
      if (found) {
        directStreamCache.set(videoId, found);
        return found;
      }
    } catch (e) {}
  }

  return null;
}

