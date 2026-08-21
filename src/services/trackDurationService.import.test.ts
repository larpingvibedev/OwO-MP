import type { Track } from '../types';
import { hasMissingExactTrackDuration } from './trackDurationService';

export function runImportedPlaylistBackfillFixture(): { count: number; needsBackfill: boolean } {
  const tracks: Track[] = Array.from({ length: 175 }, (_, index) => {
    const videoId = String(index).padStart(11, '0');
    return {
      id: `piped-${videoId}`,
      title: `Track ${index}`,
      artist: 'Artist',
      duration: index < 100 ? 200 : 0,
      cover: '',
      streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
      source: 'youtube'
    };
  });
  const needsBackfill = hasMissingExactTrackDuration(tracks);
  if (!needsBackfill) throw new Error('A >100-track import did not schedule remaining exact-ID durations');
  return { count: tracks.length, needsBackfill };
}
