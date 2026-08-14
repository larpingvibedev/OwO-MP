import type { Track, ArtistProfile, Album, AlbumDetail, PublicPlaylist, Playlist, SimilarArtist } from '../types';

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
 * Relevant Music & Categorized Search Engine
 * Supports dash ("artist - song") and space-separated ("artist song") queries.
 * Queries iTunes (limit 100) + YouTube Music Topic API to match YouTube Music results.
 */
export async function searchFreeMusic(query: string): Promise<Track[]> {
  if (!query.trim()) return [];

  const rawQuery = query.trim().toLowerCase();

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

  // 1. iTunes Triple-Query Search (Song + Artist Attribute + Album, limit=100)
  try {
    const [songRes, artistRes, albumTrackRes] = await Promise.all([
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=100`).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&attribute=artistTerm&entity=song&limit=100`).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&attribute=albumTerm&entity=song&limit=100`).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }))
    ]);

    const combinediTunes = [...(songRes.results || []), ...(artistRes.results || []), ...(albumTrackRes.results || [])];

    combinediTunes.forEach((item: any) => {
      if (item.trackName && item.artistName) {
        const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!resultsMap.has(key)) {
          const highResCover = item.artworkUrl100
            ? item.artworkUrl100.replace('100x100bb', '600x600bb')
            : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';

          const durationSeconds = Math.round((item.trackTimeMillis || 210000) / 1000);

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
  } catch (err) {
    console.warn('iTunes deep search skipped:', err);
  }

  // 2. YouTube Music Topic & Direct Search
  try {
    const [topicItems, mainItems, remixItems] = await Promise.allSettled([
      fetchFastFromInvidious(`${query} Topic`),
      fetchFastFromInvidious(query),
      fetchFastFromInvidious(`${query} remix`)
    ]);

    const combinedYT = [
      ...(topicItems.status === 'fulfilled' && Array.isArray(topicItems.value) ? topicItems.value : []),
      ...(mainItems.status === 'fulfilled' && Array.isArray(mainItems.value) ? mainItems.value : []),
      ...(remixItems.status === 'fulfilled' && Array.isArray(remixItems.value) ? remixItems.value : [])
    ];

    const VIDEO_KEYWORDS = [
      'official video', 'music video', ' mv', '[mv]', '(mv)', 'visualizer', 
      'live at', 'live performance', 'concert', 'amv', 'edit', 'montage', 
      'reaction', 'review', 'vlog', 'behind the scenes'
    ];

    combinedYT.forEach((item: any) => {
      if (item.title && item.videoId) {
        const artistName = item.author ? item.author.replace(' - Topic', '') : targetArtist;
        const key = `${artistName}-${item.title}`.toLowerCase().replace(/[^a-z0-9]/g, '');

        const videoTitleLower = item.title.toLowerCase();
        const isPlaylist = videoTitleLower.includes('playlist') || videoTitleLower.includes('full album');
        const isExplicitVideo = VIDEO_KEYWORDS.some(kw => videoTitleLower.includes(kw));

        let category: 'song' | 'video' | 'artist' | 'playlist' = 'song';
        if (isPlaylist) {
          category = 'playlist';
        } else if (isExplicitVideo) {
          category = 'video';
        }

        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: `piped-${item.videoId}`,
            title: item.title,
            artist: artistName,
            albumArtist: artistName,
            album: 'Web Stream',
            duration: item.lengthSeconds || 180,
            cover: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            streamUrl: `${artistName} - ${item.title}`,
            source: 'youtube',
            category,
            channelId: item.authorId || undefined
          });
        }
      }
    });
  } catch (err) {
    console.warn('YouTube music search skipped:', err);
  }

  const allTracks = Array.from(resultsMap.values());

  // 3. Relevance Filter: Match Artist OR Title
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

  // 4. Smart Tiered Ranking:
  // Tier 1 (1000 pts): Exact primary artist studio tracks (e.g. "Bunii")
  // Tier 2 (800 pts): Collaborations & features with exact artist (e.g. "Bunii & ...", "feat. Bunii")
  // Tier 3 (650 pts): Target artist's fan-made edits, slowed+reverb, remixes, bootlegs & covers
  // Tier 4 (450 pts): Track title exact matches
  // Tier 5 (300 pts): Songs containing search query in title
  // Tier 6 (50 pts - VERY BOTTOM): Other separate artists with similar names (e.g. "JuliiBunii", "Zuki Bunii")
  return filtered.sort((a, b) => {
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
      return scoreB - scoreA; // Higher score comes first
    }

    return 0;
  });
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
  if (url.includes('googleusercontent.com')) {
    const base = url.split('=')[0];
    return `${base}=s${size}`;
  }
  return url;
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

  // 1. Search YouTube Music directly for the official Artist profile of artistQuery
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

  // 2. If search didn't find an Artist card, check if channelId was provided or query is a UC id
  if (!targetBrowseId) {
    if (channelId && (channelId.startsWith('UC') || channelId.startsWith('FEmusic_artist_'))) {
      targetBrowseId = channelId;
    } else if (artistQuery.startsWith('UC') || artistQuery.startsWith('FEmusic_artist_')) {
      targetBrowseId = artistQuery;
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
  const albums: Album[] = [];
  let singlesAndEPs: Album[] = [];
  const similarArtists: SimilarArtist[] = [];

  const contents = browseData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  let topSongsPlaylistId: string | null = null;
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
        const videoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                        r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
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
          topTracks.push({
            id: `piped-${videoId}`,
            title: trackTitle,
            artist: artistName,
            albumArtist: artistName,
            album: 'Top Track',
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
    if (title === 'albums') {
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
            const videoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
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
              exactTracks.push({
                id: `piped-${videoId}`,
                title: trackTitle,
                artist: artistName,
                albumArtist: artistName,
                album: 'Top Track',
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

  // Set avatar to top track cover if available
  if (topTracks.length > 0 && topTracks[0].cover) {
    avatar = topTracks[0].cover;
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
  fallbackArtistName: string
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
  const leftHeader = twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
  
  const albumTitle = leftHeader?.title?.runs?.[0]?.text || fallbackAlbumName;
  const albumSubtitle = leftHeader?.subtitle?.runs?.map((r: any) => r.text).join('') || 'Official Release';
  const artist = leftHeader?.straplineTextOne?.runs?.[0]?.text || fallbackArtistName;
  const cover = leftHeader?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';

  const trackItems = twoCol?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ||
                    twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[1]?.musicShelfRenderer?.contents || [];

  const tracks: Track[] = [];
  trackItems.forEach((item: any) => {
    const r = item.musicResponsiveListItemRenderer;
    if (!r) return;
    const trackTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
    const videoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                    r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const durationStr = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
    const trackArtist = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((s: any) => s.text).join('') || artist;

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
        cover: cover,
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
export async function fetchAlbumDetails(albumId: string, albumName: string, artistName: string): Promise<AlbumDetail> {
  const cleanId = albumId.replace('album-', '').replace('album-derived-', '');
  let rawTracks: any[] = [];
  let albumCover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
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
          cover: profile.cover || (profile.topTracks[0]?.cover) || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
          releaseDate: 'Curated Mix',
          tracks: profile.topTracks
        };
      }
    } catch (e) {
      console.warn('Mix fetch failed:', e);
    }
  }

  // 2. YouTube Music Browse ID (MPREb_... / MPAD... / VLOLAK...)
  if (albumId.startsWith('MPREb_') || albumId.startsWith('MPAD') || albumId.startsWith('VLOLAK') || cleanId.startsWith('MPREb_')) {
    try {
      const ytmDetail = await fetchAlbumDetailsFromYTM(cleanId, albumName, artistName);
      if (ytmDetail && ytmDetail.tracks.length > 0) {
        return ytmDetail;
      }
    } catch (e) {
      console.warn('YouTube Music album browse failed:', e);
    }
  }

  // 2. Single Release Handler
  if (albumId.startsWith('single-')) {
    const videoId = albumId.replace('single-', '');
    const singleCover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    return {
      id: albumId,
      name: albumName,
      artist: artistName,
      cover: singleCover,
      releaseDate: 'Single',
      tracks: [{
        id: `piped-${videoId}`,
        title: albumName,
        artist: artistName,
        albumArtist: artistName,
        album: albumName,
        duration: 180,
        cover: singleCover,
        streamUrl: `${artistName} - ${albumName}`,
        source: 'youtube',
        category: 'song'
      }]
    };
  }

  // 3. YouTube / Invidious Playlist Handler (Parallel Racing)
  if (isNaN(Number(cleanId))) {
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
          collectionName: data.title || albumName,
          trackTimeMillis: (v.lengthSeconds || 180) * 1000,
          trackNumber: index + 1,
          artworkUrl100: data.playlistThumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        }));
      }
    } catch (e) {
      console.warn(`Playlist fetch failed:`, e);
    }
  }

  if (!isNaN(Number(cleanId))) {
    try {
      let targetCollectionId = cleanId;
      const initialLookup = await fetch(`https://itunes.apple.com/lookup?id=${cleanId}`).then(r => r.ok ? r.json() : { results: [] });
      if (initialLookup.results && initialLookup.results.length > 0) {
        const item = initialLookup.results[0];
        if (item.wrapperType === 'track' && item.collectionId) {
          targetCollectionId = String(item.collectionId);
        }
      }

      const albumRes = await fetch(`https://itunes.apple.com/lookup?id=${targetCollectionId}&entity=song`).then(r => r.ok ? r.json() : { results: [] });
      if (albumRes.results && albumRes.results.length > 0) {
        const albumMeta = albumRes.results.find((item: any) => item.wrapperType === 'collection') || albumRes.results[0];
        if (albumMeta.artworkUrl100) {
          albumCover = albumMeta.artworkUrl100.replace('100x100bb', '600x600bb');
        }
        if (albumMeta.releaseDate) {
          releaseDateStr = albumMeta.releaseDate.substring(0, 4);
        }
        rawTracks = albumRes.results.filter((item: any) => item.wrapperType === 'track');
      }
    } catch (e) {
      console.warn('Direct album lookup failed, attempting search:', e);
    }
  }

  if (rawTracks.length === 0 && !isNaN(Number(cleanId))) {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName + ' ' + albumName)}&entity=song&limit=50`).then(r => r.ok ? r.json() : { results: [] });
      if (res.results) {
        const albumCleanKey = albumName.toLowerCase().replace(/[^a-z0-9]/g, '');
        rawTracks = res.results.filter((item: any) => {
          const itemAlbumKey = (item.collectionName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return itemAlbumKey === albumCleanKey || itemAlbumKey.includes(albumCleanKey);
        });
        if (rawTracks[0]?.artworkUrl100) {
          albumCover = rawTracks[0].artworkUrl100.replace('100x100bb', '600x600bb');
        }
        if (rawTracks[0]?.releaseDate) {
          releaseDateStr = rawTracks[0].releaseDate.substring(0, 4);
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
        album: item.collectionName || albumName,
        duration: Math.round((item.trackTimeMillis || 210000) / 1000),
        cover: item.artworkUrl100 || albumCover,
        streamUrl: `${item.artistName || artistName} - ${item.trackName}`,
        source: 'youtube',
        category: 'song'
      };
    });

  return {
    id: albumId,
    name: albumName,
    artist: artistName,
    cover: albumCover,
    releaseDate: releaseDateStr,
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
        const str = typeof data === 'string' ? data : JSON.stringify(data);

        // Extract ATV (Audio Track Video) videoId
        // Pattern 1: videoId preceding musicVideoType: MUSIC_VIDEO_TYPE_ATV
        const atvRegex = /"videoId":"([a-zA-Z0-9_-]{11})"[^}]*?"musicVideoType":"MUSIC_VIDEO_TYPE_ATV"/;
        let match = atvRegex.exec(str);
        if (match && match[1]) {
          return match[1];
        }

        // Pattern 2: musicVideoType: MUSIC_VIDEO_TYPE_ATV followed by videoId
        const reverseRegex = /"musicVideoType":"MUSIC_VIDEO_TYPE_ATV"[^}]*?"videoId":"([a-zA-Z0-9_-]{11})"/;
        match = reverseRegex.exec(str);
        if (match && match[1]) {
          return match[1];
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

  // 1. Absolute Priority: Direct YouTube Music InnerTube ATV resolution (100% pure distributor audio)
  try {
    const atvId = await resolveYouTubeMusicATV(primaryArtist, cleanTitle);
    if (atvId) {
      videoIdCache.set(cacheKey, atvId);
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
export async function fetchUpNextMix(
  seedTrack: Track,
  userFavorites: Track[] = [],
  playHistory: Record<string, { track: Track; playCount: number }> = {},
  excludeIds: Set<string> = new Set()
): Promise<Track[]> {
  if (!seedTrack) return [];

  const seenKeys = new Set<string>();
  const trackKey = (t: { artist: string; title: string }) =>
    `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9]/g, '');

  seenKeys.add(trackKey(seedTrack));

  // Extract clean primary artist name (e.g. "Bunii" from "Bunii & Crayon" or "Bunii feat. XYZ")
  const primaryArtist = (seedTrack.artist || '')
    .split(/[,&/]| feat\.? | ft\.? /i)[0]
    .trim();
  const primaryArtistLower = primaryArtist.toLowerCase();

  const artistPool: Track[] = [];
  const collabPool: Track[] = [];
  const collaboratorNames = new Set<string>();

  // 1. Fetch deep catalog by primary artist on iTunes + YouTube
  try {
    const [artistTermRes, generalSongRes, ytTopicItems] = await Promise.allSettled([
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(primaryArtist)}&attribute=artistTerm&entity=song&limit=40`)
        .then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(primaryArtist + ' feat')}&entity=song&limit=25`)
        .then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
      fetchFastFromInvidious(`${primaryArtist} Topic`)
    ]);

    const itunesTracks = [
      ...(artistTermRes.status === 'fulfilled' && artistTermRes.value.results ? artistTermRes.value.results : []),
      ...(generalSongRes.status === 'fulfilled' && generalSongRes.value.results ? generalSongRes.value.results : [])
    ];

    itunesTracks.forEach((item: any) => {
      if (!item.trackName || !item.artistName) return;
      const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = `track-${item.trackId}`;

      if (seenKeys.has(key) || excludeIds.has(id)) return;

      const aLower = item.artistName.toLowerCase().trim();
      const tLower = item.trackName.toLowerCase().trim();

      const trackObj: Track = {
        id,
        title: item.trackName,
        artist: item.artistName,
        albumArtist: item.collectionArtistName || item.artistName,
        album: item.collectionName || 'Single',
        duration: Math.round((item.trackTimeMillis || 210000) / 1000),
        cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : seedTrack.cover,
        streamUrl: `${item.artistName} - ${item.trackName}`,
        source: 'youtube',
        category: 'song'
      };

      // Exact primary artist track
      if (aLower === primaryArtistLower) {
        seenKeys.add(key);
        artistPool.push(trackObj);
      }
      // Collaboration or Feature involving primary artist
      else if (
        aLower.includes(primaryArtistLower) || 
        tLower.includes(`feat. ${primaryArtistLower}`) || 
        tLower.includes(`ft. ${primaryArtistLower}`) ||
        tLower.includes(`feat ${primaryArtistLower}`)
      ) {
        seenKeys.add(key);
        collabPool.push(trackObj);

        // Extract the collaborating artist name
        const cleanCollabArtist = item.artistName
          .replace(new RegExp(primaryArtist, 'gi'), '')
          .replace(/[&,]/g, '')
          .replace(/feat\..*$/i, '')
          .trim();
        if (cleanCollabArtist && cleanCollabArtist.length > 1) {
          collaboratorNames.add(cleanCollabArtist);
        }
      }
    });

    // YouTube Topic Tracks
    if (ytTopicItems.status === 'fulfilled' && Array.isArray(ytTopicItems.value)) {
      ytTopicItems.value.forEach((item: any) => {
        if (!item.title || !item.videoId) return;
        const author = item.author ? item.author.replace(' - Topic', '').trim() : primaryArtist;
        const key = `${author}-${item.title}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        const id = `piped-${item.videoId}`;

        if (seenKeys.has(key) || excludeIds.has(id)) return;

        const aLower = author.toLowerCase().trim();
        if (aLower === primaryArtistLower) {
          seenKeys.add(key);
          artistPool.push({
            id,
            title: item.title,
            artist: author,
            albumArtist: author,
            album: 'Web Stream',
            duration: item.lengthSeconds || 180,
            cover: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            streamUrl: `${author} - ${item.title}`,
            source: 'youtube',
            category: 'song'
          });
        }
      });
    }
  } catch (e) {}

  // 2. Fetch tracks by real collaborating artists
  const collaboratorPool: Track[] = [];
  const topCollabs = Array.from(collaboratorNames).slice(0, 3);
  if (topCollabs.length > 0) {
    try {
      const collabFetches = topCollabs.map(collabName =>
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(collabName)}&attribute=artistTerm&entity=song&limit=10`)
          .then(r => r.ok ? r.json() : { results: [] })
          .catch(() => ({ results: [] }))
      );

      const collabResults = await Promise.allSettled(collabFetches);
      collabResults.forEach(res => {
        if (res.status === 'fulfilled' && res.value.results) {
          res.value.results.forEach((item: any) => {
            if (!item.trackName || !item.artistName) return;
            const key = `${item.artistName}-${item.trackName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
            const id = `track-${item.trackId}`;
            if (!seenKeys.has(key) && !excludeIds.has(id)) {
              seenKeys.add(key);
              collaboratorPool.push({
                id,
                title: item.trackName,
                artist: item.artistName,
                albumArtist: item.collectionArtistName || item.artistName,
                album: item.collectionName || 'Single',
                duration: Math.round((item.trackTimeMillis || 210000) / 1000),
                cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : seedTrack.cover,
                streamUrl: `${item.artistName} - ${item.trackName}`,
                source: 'youtube',
                category: 'song'
              });
            }
          });
        }
      });
    } catch (e) {}
  }

  // 3. User taste pool: tracks from user's favorite tracks & most-played artists
  const userTastePool: Track[] = [];
  
  // A. User's explicitly liked favorites
  userFavorites.forEach(fav => {
    const key = trackKey(fav);
    if (!seenKeys.has(key) && !excludeIds.has(fav.id) && fav.id !== seedTrack.id) {
      seenKeys.add(key);
      userTastePool.push(fav);
    }
  });

  // B. Tracks by user's top played artists in playHistory
  const topHistoryArtists = Object.values(playHistory)
    .sort((a, b) => b.playCount - a.playCount)
    .map(h => h.track)
    .filter(t => t && t.id !== seedTrack.id);

  topHistoryArtists.forEach(histTrack => {
    const key = trackKey(histTrack);
    if (!seenKeys.has(key) && !excludeIds.has(histTrack.id)) {
      seenKeys.add(key);
      userTastePool.push(histTrack);
    }
  });

  // 4. Shuffle each sub-pool so each session gets a fresh, dynamic mix
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  shuffle(artistPool);
  shuffle(collabPool);
  shuffle(collaboratorPool);
  shuffle(userTastePool);

  // 5. Interleave in a true YouTube Music algorithmic pattern:
  // - Starts with 2-3 tracks by the same artist
  // - Followed by artist collabs & features
  // - Followed by collaborator circle tracks & user taste tracks
  const finalMix: Track[] = [];
  
  // Lead with same artist
  while (artistPool.length > 0 && finalMix.length < 3) {
    finalMix.push(artistPool.shift()!);
  }

  // Then blend: 1 Collab / Feature, 1 Same Artist, 1 User Taste / Collaborator
  while (finalMix.length < 30 && (artistPool.length > 0 || collabPool.length > 0 || collaboratorPool.length > 0 || userTastePool.length > 0)) {
    if (collabPool.length > 0) {
      finalMix.push(collabPool.shift()!);
    }
    if (artistPool.length > 0) {
      finalMix.push(artistPool.shift()!);
    }
    if (userTastePool.length > 0) {
      finalMix.push(userTastePool.shift()!);
    } else if (collaboratorPool.length > 0) {
      finalMix.push(collaboratorPool.shift()!);
    } else if (artistPool.length > 0) {
      finalMix.push(artistPool.shift()!);
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
              album: isArchive ? "Archive Uploads" : 'Web Stream',
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

  const addArtist = (name: string, cover: string, artistId?: string | number, channelId?: string) => {
    if (!name) return;
    
    // Split combined names if multiple artists are grouped together
    if (name.includes(',') || name.includes(' & ') || name.includes(' and ')) {
      const parts = name.split(/[,&/]| and /i);
      parts.forEach(p => addArtist(p, cover, artistId, channelId));
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
      cover: cleanGoogleImageUrl(cover, 500)
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
                      if (name) addArtist(name, thumb, undefined, bId);
                    });
                  }

                  // B. Track-specific Mood Matches (You Might Also Like)
                  if (title.includes('you might also like')) {
                    items.forEach((it: any) => {
                      const r = it.musicResponsiveListItemRenderer;
                      const artistRun = r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
                      const bId = r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
                      const thumb = r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
                      if (artistRun) addArtist(artistRun, thumb, undefined, bId);
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
      // Extract collaborating artists from singles & track titles
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
              addArtist(nClean, profile.cover);
            }
          });
        }
      });

      // Add profile peer artists
      (profile.similarArtists || []).forEach(sim => {
        addArtist(sim.name, sim.cover, undefined, sim.channelId);
      });
    }

    // 3. Fallback to iTunes collaborator discovery if under 6 results
    if (results.length < 6) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(clean)}&entity=song&limit=50`);
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          (itunesData.results || []).forEach((item: any) => {
            const rawArtist = item.artistName || '';
            const aLower = rawArtist.toLowerCase();
            const cover = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '300x300bb') : '';

            if (aLower.includes('&') || aLower.includes(',') || aLower.includes(' feat') || aLower.includes(' ft')) {
              const parts = rawArtist.split(/[,&/]| feat\.? | ft\.? | featuring /i);
              parts.forEach((p: string) => {
                const pClean = p.trim();
                if (pClean && pClean.toLowerCase() !== cleanLower) {
                  addArtist(pClean, cover, item.artistId);
                }
              });
            }
          });
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('fetchSimilarArtists warning:', err);
  }

  return results.slice(0, 15);
}
