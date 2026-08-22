import {
  assertSupabaseMutationSucceeded,
  preserveLocalPlaylistMetadata,
  reconcileKnownSyncedPlaylistIds
} from './supabasePlaylistPolicy';
import { PlaylistSyncMutationTracker } from './playlistSyncMutationTracker';

export function runSupabaseResolvedErrorAndProvenanceFixtures(): Record<string, unknown> {
  let resolvedErrorCaught = false;
  try {
    assertSupabaseMutationSucceeded({ error: { message: 'permission denied' } }, 'Playlist delete');
  } catch (error) {
    resolvedErrorCaught = (error as Error).message.includes('permission denied');
  }
  if (!resolvedErrorCaught) throw new Error('Resolved Supabase error was treated as success');

  // A failed delete must relinquish only its own tombstone. If a newer local
  // mutation already owns the ID, restoreIfCurrent must leave it untouched.
  const tracker = new PlaylistSyncMutationTracker();
  const previous = tracker.mark('failed-delete', 'upsert');
  const failedDelete = tracker.mark('failed-delete', 'delete');
  tracker.restoreIfCurrent('failed-delete', failedDelete.version, previous);
  if (tracker.get('failed-delete')?.kind !== 'upsert') {
    throw new Error('Failed delete tombstone did not roll back to prior ownership');
  }
  const supersededDelete = tracker.mark('failed-delete', 'delete');
  tracker.mark('failed-delete', 'upsert');
  tracker.restoreIfCurrent('failed-delete', supersededDelete.version, previous);
  if (tracker.get('failed-delete')?.kind !== 'upsert') {
    throw new Error('Failed delete rollback overwrote a newer mutation');
  }

  const reconciliation = reconcileKnownSyncedPlaylistIds({
    localIds: ['offline-remote-delete', 'local-only', 'pending-upsert'],
    cloudIds: [],
    knownIds: ['offline-remote-delete', 'pending-upsert'],
    isProtected: id => id === 'pending-upsert'
  });
  if (
    !reconciliation.removeLocalIds.has('offline-remote-delete') ||
    reconciliation.removeLocalIds.has('local-only') ||
    reconciliation.removeLocalIds.has('pending-upsert') ||
    reconciliation.nextKnownIds.has('offline-remote-delete') ||
    !reconciliation.nextKnownIds.has('pending-upsert')
  ) {
    throw new Error('Known-synced provenance reconciliation failed');
  }

  // Verify preserveLocalPlaylistMetadata
  const cloudPl = { id: 'p1', name: 'Cloud Title', cover: 'https://example.com/cover.jpg', tracks: [] };
  const localWithCover = { id: 'p1', name: 'Old Title', cover: '', coverId: 'cov_local_123', tracks: [] };
  const preserved = preserveLocalPlaylistMetadata(cloudPl, localWithCover);
  if (preserved.coverId !== 'cov_local_123' || preserved.name !== 'Cloud Title') {
    throw new Error('preserveLocalPlaylistMetadata failed to retain local coverId');
  }

  const localWithoutCover = { id: 'p1', name: 'Old Title', cover: '', tracks: [] };
  const preservedNoCover = preserveLocalPlaylistMetadata(cloudPl, localWithoutCover);
  if (preservedNoCover.coverId !== undefined) {
    throw new Error('preserveLocalPlaylistMetadata erroneously set coverId');
  }

  return {
    resolvedErrorCaught,
    failedDeleteRolledBack: true,
    removed: Array.from(reconciliation.removeLocalIds),
    preservedKnown: Array.from(reconciliation.nextKnownIds)
  };
}

