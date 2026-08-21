import { PlaylistMutationQueue } from './playlistMutationQueue';
import { PlaylistSyncMutationTracker } from './playlistSyncMutationTracker';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runPlaylistSyncMutationRaceFixtures(): Promise<string[]> {
  const tracker = new PlaylistSyncMutationTracker();
  const queue = new PlaylistMutationQueue();
  const results: string[] = [];

  // A sync response that started first cannot resurrect a playlist deleted
  // while its cloud query was delayed.
  const deleteSyncStart = tracker.snapshot();
  const deletePendingStart = queue.snapshotPendingPlaylistIds();
  const staleDeleteResponse = delay(25).then(() => {
    const preserve = tracker.shouldPreserveLocal(
      'deleted-after-start',
      deleteSyncStart,
      deletePendingStart,
      queue.hasPending('deleted-after-start')
    );
    results.push(`delete:${preserve}`);
  });
  tracker.mark('deleted-after-start', 'delete');
  await queue.enqueue('deleted-after-start', async () => delay(2));
  await staleDeleteResponse;

  // The same guard protects a newer local full snapshot from an older cloud
  // snapshot that arrives after the local edit.
  const updateSyncStart = tracker.snapshot();
  const updatePendingStart = queue.snapshotPendingPlaylistIds();
  const staleUpdateResponse = delay(20).then(() => {
    const preserve = tracker.shouldPreserveLocal(
      'updated-after-start',
      updateSyncStart,
      updatePendingStart,
      queue.hasPending('updated-after-start')
    );
    results.push(`update:${preserve}`);
  });
  tracker.mark('updated-after-start', 'upsert');
  await queue.enqueue('updated-after-start', async () => delay(1));
  await staleUpdateResponse;

  // A mutation already pending when sync starts is protected even if it
  // completes before the delayed response is applied.
  tracker.mark('pending-before-start', 'upsert');
  const pendingMutation = queue.enqueue('pending-before-start', async () => delay(12));
  const pendingSyncStart = tracker.snapshot();
  const pendingIdsAtStart = queue.snapshotPendingPlaylistIds();
  await pendingMutation;
  const pendingPreserved = tracker.shouldPreserveLocal(
    'pending-before-start',
    pendingSyncStart,
    pendingIdsAtStart,
    queue.hasPending('pending-before-start')
  );
  results.push(`pending:${pendingPreserved}`);

  tracker.mark('remote-delete', 'remote-delete');
  const remotePreserved = tracker.shouldPreserveLocal(
    'remote-delete',
    tracker.snapshot(),
    new Set(),
    false
  );
  results.push(`remote-delete:${remotePreserved}`);

  const expected = ['delete:true', 'update:true', 'pending:true', 'remote-delete:true'];
  if (JSON.stringify(results) !== JSON.stringify(expected)) {
    throw new Error(`Playlist sync race fixture mismatch: ${results.join(',')}`);
  }
  return results;
}
