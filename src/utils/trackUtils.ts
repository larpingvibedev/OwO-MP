import type { Track } from '../types';

/**
 * Universal Track Equality Evaluator
 * Safely compares two tracks across disparate ID formats (piped-*, yt-*, itunes-*),
 * direct video IDs, and normalized Title + Artist combinations.
 */
export function isSameTrack(a: Track | null | undefined, b: Track | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;

  // 1. Check raw cleaned IDs (stripping piped-, yt-, track-, album-track-, release-track- prefixes)
  const cleanIdA = a.id ? a.id.replace(/^(piped-|yt-|track-|album-track-|release-track-)/, '') : '';
  const cleanIdB = b.id ? b.id.replace(/^(piped-|yt-|track-|album-track-|release-track-)/, '') : '';
  if (cleanIdA && cleanIdB && cleanIdA === cleanIdB) return true;

  // 2. Check streamUrl or ID for identical 11-char YouTube video IDs
  const ytVideoIdRegex = /(?:v=|\/vi\/|\/embed\/|\/watch\?v=|\.be\/|^)([a-zA-Z0-9_-]{11})(?:[&?]|$)/;
  const ytMatchA = (a.streamUrl || '').match(ytVideoIdRegex) || (a.id || '').match(ytVideoIdRegex);
  const ytMatchB = (b.streamUrl || '').match(ytVideoIdRegex) || (b.id || '').match(ytVideoIdRegex);
  if (ytMatchA && ytMatchB && ytMatchA[1] === ytMatchB[1]) return true;

  // 3. Clean Title matching
  const cleanTitle = (t?: string) => (t || '')
    .toLowerCase()
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*\([^)]*(?:official|audio|video|prod|remaster|explicit|version|og)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|audio|video|prod|remaster|explicit|version|og)[^\]]*\]/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  const titleA = cleanTitle(a.title);
  const titleB = cleanTitle(b.title);

  if (!titleA || !titleB) return false;

  if (titleA === titleB || titleA.includes(titleB) || titleB.includes(titleA)) {
    const cleanArtist = (art?: string) => (art || '').toLowerCase().replace(/\s*-\s*topic$/i, '').trim();
    const artistA = cleanArtist(a.artist || a.albumArtist);
    const artistB = cleanArtist(b.artist || b.albumArtist);

    if (!artistA || !artistB) return true;
    if (artistA === artistB) return true;
    if (artistA.includes(artistB) || artistB.includes(artistA)) return true;

    // Check individual collaborative artists
    const splitArtists = (str: string) => str.split(/[,&+/]|\bfeat\.?\b|\bft\.?\b|\bwith\b/i).map(s => s.trim()).filter(Boolean);
    const listA = splitArtists(artistA);
    const listB = splitArtists(artistB);
    if (listA.some(x => listB.some(y => x === y || x.includes(y) || y.includes(x)))) {
      return true;
    }
  }

  return false;
}
