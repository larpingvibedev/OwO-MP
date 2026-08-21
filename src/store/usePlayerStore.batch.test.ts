import type { Track } from '../types';
import { usePlayerStore } from './usePlayerStore';

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  duration: 120,
  cover: '',
  streamUrl: `https://example.test/${id}`
});

export async function runBatchManualOverlapStoreFixture(): Promise<{
  successCount: number;
  failCount: number;
  startedByBatch: string[];
  failedOwnerRetryCount: number;
}> {
  const original = usePlayerStore.getState();
  const manual = makeTrack('manual-owner');
  const batchOnly = makeTrack('batch-only');
  const failedOwner = makeTrack('failed-owner');
  const startedByBatch: string[] = [];

  usePlayerStore.setState({
    downloadedTrackIds: {},
    downloadingTrackIds: { [manual.id]: 20 },
    downloadTrack: async track => {
      startedByBatch.push(track.id);
      usePlayerStore.setState(state => ({
        downloadedTrackIds: {
          ...state.downloadedTrackIds,
          [track.id]: { downloadedAt: Date.now(), title: track.title, artist: track.artist }
        }
      }));
      return true;
    }
  });

  const manualCompletion = setTimeout(() => {
    usePlayerStore.setState(state => {
      const downloadingTrackIds = { ...state.downloadingTrackIds };
      delete downloadingTrackIds[manual.id];
      return {
        downloadingTrackIds,
        downloadedTrackIds: {
          ...state.downloadedTrackIds,
          [manual.id]: { downloadedAt: Date.now(), title: manual.title, artist: manual.artist }
        }
      };
    });
  }, 15);

  try {
    const result = await original.downloadTrackBatch([
      manual,
      { ...manual },
      batchOnly,
      { ...batchOnly }
    ], 'Overlap fixture');
    if (
      result.successCount !== 2 ||
      result.failCount !== 0 ||
      JSON.stringify(startedByBatch) !== JSON.stringify([batchOnly.id])
    ) {
      throw new Error(
        `Batch/manual overlap mismatch: ${result.successCount}/${result.failCount}/${startedByBatch.join(',')}`
      );
    }
    usePlayerStore.setState({
      downloadedTrackIds: {},
      downloadingTrackIds: { [failedOwner.id]: 30 }
    });
    const failedOwnerCompletion = setTimeout(() => {
      usePlayerStore.setState(state => {
        const downloadingTrackIds = { ...state.downloadingTrackIds };
        delete downloadingTrackIds[failedOwner.id];
        return { downloadingTrackIds };
      });
    }, 15);
    const callsBeforeRetry = startedByBatch.length;
    const failedOwnerResult = await original.downloadTrackBatch([failedOwner], 'Failed owner fixture');
    clearTimeout(failedOwnerCompletion);
    const failedOwnerRetryCount = startedByBatch.length - callsBeforeRetry;
    if (failedOwnerResult.successCount !== 1 || failedOwnerResult.failCount !== 0 || failedOwnerRetryCount !== 1) {
      throw new Error(`Failed joined owner retry mismatch: ${JSON.stringify(failedOwnerResult)}/${failedOwnerRetryCount}`);
    }
    return { ...result, startedByBatch, failedOwnerRetryCount };
  } finally {
    clearTimeout(manualCompletion);
    usePlayerStore.setState({
      downloadedTrackIds: original.downloadedTrackIds,
      downloadingTrackIds: original.downloadingTrackIds,
      downloadTrack: original.downloadTrack,
      toastMessage: original.toastMessage
    });
  }
}
