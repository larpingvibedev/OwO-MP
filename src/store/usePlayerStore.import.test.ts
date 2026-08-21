import type { Track } from '../types';
import { usePlayerStore, type PlaylistDurationBackfillResult } from './usePlayerStore';

export async function runImportedPlaylistStoreTriggerFixture(): Promise<{ id: string; callCount: number; trackCount: number }> {
  const original = usePlayerStore.getState();
  const calls: string[] = [];
  const tracks: Track[] = Array.from({ length: 150 }, (_, index) => {
    const videoId = String(index).padStart(11, '0');
    return {
      id: `piped-${videoId}`,
      title: `Imported ${index}`,
      artist: 'Artist',
      duration: index < 100 ? 180 : 0,
      cover: '',
      streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
      source: 'youtube'
    };
  });
  const result: PlaylistDurationBackfillResult = { attempted: 0, resolved: 0, remaining: 0, exhausted: false };

  usePlayerStore.setState({
    playlists: [],
    enrichPlaylistDurations: async playlistId => {
      calls.push(playlistId);
      return result;
    }
  });
  try {
    const id = usePlayerStore.getState().createImportedPlaylist({ name: 'Large import', tracks });
    await Promise.resolve();
    if (calls.length !== 1 || calls[0] !== id) {
      throw new Error(`Imported playlist backfill trigger mismatch: ${calls.join(',')}`);
    }
    return { id, callCount: calls.length, trackCount: tracks.length };
  } finally {
    usePlayerStore.setState({
      playlists: original.playlists,
      enrichPlaylistDurations: original.enrichPlaylistDurations,
      toastMessage: original.toastMessage
    });
  }
}
