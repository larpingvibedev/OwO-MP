import type { Track } from '../types';

/**
 * Universal Track Equality Evaluator
 * Safely compares two tracks across disparate ID formats (piped-*, yt-*, itunes-*),
 * direct video IDs, and normalized Title + Artist combinations.
 */
export function isSameTrack(a: Track | null | undefined, b: Track | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;

  // 1. Check raw cleaned IDs (stripping piped-, yt-, track- prefixes)
  const cleanIdA = a.id ? a.id.replace(/^(piped-|yt-|track-)/, '') : '';
  const cleanIdB = b.id ? b.id.replace(/^(piped-|yt-|track-)/, '') : '';
  if (cleanIdA && cleanIdB && cleanIdA === cleanIdB) return true;

  // 2. Normalized Title + Artist matching
  const titleA = a.title ? a.title.trim().toLowerCase() : '';
  const titleB = b.title ? b.title.trim().toLowerCase() : '';
  if (!titleA || !titleB) return false;

  if (titleA === titleB) {
    const artistA = a.artist ? a.artist.trim().toLowerCase().replace(/\s*-\s*topic$/i, '') : '';
    const artistB = b.artist ? b.artist.trim().toLowerCase().replace(/\s*-\s*topic$/i, '') : '';
    if (artistA === artistB) return true;
    if (artistA && artistB && (artistA.includes(artistB) || artistB.includes(artistA))) return true;
  }

  return false;
}
