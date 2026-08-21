import type { Playlist } from '../types';
import { PlaylistMutationQueue } from './playlistMutationQueue';
import { PlaylistSyncMutationTracker } from './playlistSyncMutationTracker';
import { reconcileKnownSyncedPlaylistIds, selectLocalPlaylistsForUser } from './supabasePlaylistPolicy';
import {
  canCompleteOwnedHandoff,
  isCurrentSyncOwner,
  localUpsertPrecedesRemoteDelete
} from './syncOwnership';
import { PlaylistOwnershipProvenance } from './playlistOwnershipProvenance';

const playlist = (id: string, name = id): Playlist => ({ id, name, tracks: [], createdAt: 1 });
const key = (userId: string, playlistId: string) => `${userId}\u0000${playlistId}`;

export async function runPlaylistSyncOwnershipFixtures(): Promise<Record<string, unknown>> {
  const queue = new PlaylistMutationQueue();
  const events: string[] = [];
  let releaseA!: () => void;
  const aGate = new Promise<void>(resolve => { releaseA = resolve; });
  const capturedA = { userId: 'A', generation: 1 };
  let currentUser = 'A';
  let generation = 1;
  let broadcasts = 0;

  const aDelete = queue.enqueue(key('A', 'P'), async () => {
    events.push('A:start');
    await aGate;
    if (isCurrentSyncOwner(capturedA, currentUser, generation)) broadcasts++;
    events.push('A:end');
  });
  currentUser = 'B';
  generation = 2;
  const bUpsert = queue.enqueue(key('B', 'P'), async () => { events.push('B'); });
  await bUpsert;
  releaseA();
  await aDelete;
  if (broadcasts !== 0 || events.indexOf('B') > events.indexOf('A:end')) {
    throw new Error(`Cross-user same-ID ownership failed: ${events.join(',')}/${broadcasts}`);
  }
  const staleRealtimeAccepted = isCurrentSyncOwner(capturedA, currentUser, generation);
  if (staleRealtimeAccepted) throw new Error('Stale A realtime callback was accepted for B');

  const tracker = new PlaylistSyncMutationTracker();
  const bKey = key('B', 'P');
  const upsert = tracker.mark(bKey, 'upsert');
  let local = [playlist('P', 'B local')];
  if (!localUpsertPrecedesRemoteDelete(tracker.get(bKey)?.kind)) local = [];
  tracker.settleIfCurrent(bKey, upsert.version);
  const afterUpsertPull = reconcileKnownSyncedPlaylistIds({
    localIds: local.map(item => item.id),
    cloudIds: ['P'],
    knownIds: ['P'],
    isProtected: () => false
  });
  if (local.length !== 1 || afterUpsertPull.removeLocalIds.size !== 0 || tracker.get(bKey)?.kind !== 'settled') {
    throw new Error('Remote delete overrode pending local upsert');
  }

  const restartBaseline = selectLocalPlaylistsForUser({
    localPlaylists: [playlist('P', 'A cloud-owned'), playlist('local-only')],
    lastSyncedUserId: 'A',
    currentUserId: 'B',
    previousUserKnownIds: ['P']
  });
  if (JSON.stringify(restartBaseline.map(item => item.id)) !== JSON.stringify(['local-only'])) {
    throw new Error('Restart account ownership cleanup failed');
  }

  let sameUserLocal = [playlist('remote-delete')];
  const sameUserKey = key('B', 'remote-delete');
  if (!localUpsertPrecedesRemoteDelete(tracker.get(sameUserKey)?.kind)) {
    tracker.mark(sameUserKey, 'remote-delete');
    sameUserLocal = sameUserLocal.filter(item => item.id !== 'remote-delete');
  }
  if (sameUserLocal.length !== 0 || tracker.get(sameUserKey)?.kind !== 'remote-delete') {
    throw new Error('Uncontested same-user remote delete did not converge');
  }

  const orderedTracker = new PlaylistSyncMutationTracker();
  const orderedQueue = new PlaylistMutationQueue();
  const orderedEvents: string[] = [];
  const deleting = orderedTracker.mark(bKey, 'delete');
  const deleteRun = orderedQueue.enqueue(bKey, async () => {
    orderedEvents.push('delete');
    orderedTracker.settleIfCurrent(bKey, deleting.version);
  });
  const updating = orderedTracker.mark(bKey, 'upsert');
  const upsertRun = orderedQueue.enqueue(bKey, async () => {
    orderedEvents.push('upsert');
    orderedTracker.settleIfCurrent(bKey, updating.version);
  });
  await Promise.all([deleteRun, upsertRun]);
  if (JSON.stringify(orderedEvents) !== JSON.stringify(['delete', 'upsert']) ||
      orderedTracker.get(bKey)?.kind !== 'settled') {
    throw new Error(`Queued delete/upsert order failed: ${orderedEvents.join(',')}`);
  }

  const pendingOwnership = new PlaylistOwnershipProvenance();
  pendingOwnership.beginUpsert('A', 'pending-create', 1, false);
  const bDuringPending = selectLocalPlaylistsForUser({
    localPlaylists: [playlist('pending-create'), playlist('truly-local')],
    lastSyncedUserId: 'A',
    currentUserId: 'B',
    previousUserKnownIds: [],
    ownerByPlaylistId: pendingOwnership.snapshot()
  });
  pendingOwnership.assign('B', 'pending-create');
  pendingOwnership.finishUpsert('A', 'pending-create', 1, true);
  if (JSON.stringify(bDuringPending.map(item => item.id)) !== JSON.stringify(['truly-local']) ||
      JSON.stringify(pendingOwnership.getOwners('pending-create')) !== JSON.stringify(['A', 'B'])) {
    throw new Error('Pending A ownership leaked into B or a legitimate shared owner was lost');
  }

  const failedLocalOnly = new PlaylistOwnershipProvenance();
  failedLocalOnly.beginUpsert('A', 'local-failure', 1, false);
  failedLocalOnly.finishUpsert('A', 'local-failure', 1, false);
  if (failedLocalOnly.getOwner('local-failure') !== null) {
    throw new Error('Failed upsert permanently classified a local-only playlist');
  }

  const successBeforeRestart = new PlaylistOwnershipProvenance();
  successBeforeRestart.beginUpsert('A', 'success-before-restart', 1, false);
  successBeforeRestart.finishUpsert('A', 'success-before-restart', 1, true);
  const restartedOwnership = new PlaylistOwnershipProvenance(successBeforeRestart.snapshot());
  const bAfterRestart = selectLocalPlaylistsForUser({
    localPlaylists: [playlist('success-before-restart'), playlist('unknown-after-restart')],
    lastSyncedUserId: null,
    currentUserId: 'B',
    previousUserKnownIds: [],
    ownerByPlaylistId: restartedOwnership.snapshot()
  });
  if (JSON.stringify(bAfterRestart.map(item => item.id)) !== JSON.stringify(['unknown-after-restart'])) {
    throw new Error('Durable ownership did not isolate success-before-restart');
  }

  const overlappingFailure = new PlaylistOwnershipProvenance({ shared: 'A' });
  overlappingFailure.beginUpsert('A', 'shared', 1, false);
  overlappingFailure.beginUpsert('B', 'shared', 2, false);
  overlappingFailure.finishUpsert('A', 'shared', 1, true);
  overlappingFailure.finishUpsert('B', 'shared', 2, false);
  if (!overlappingFailure.hasOwner('A', 'shared') || overlappingFailure.hasOwner('B', 'shared')) {
    throw new Error('A success was lost when the overlapping newer B claim failed');
  }

  const overlappingSuccess = new PlaylistOwnershipProvenance({ shared: 'A' });
  overlappingSuccess.beginUpsert('A', 'shared', 1, false);
  overlappingSuccess.beginUpsert('B', 'shared', 2, false);
  overlappingSuccess.finishUpsert('B', 'shared', 2, true);
  overlappingSuccess.finishUpsert('A', 'shared', 1, true);
  if (!overlappingSuccess.hasOwner('A', 'shared') || !overlappingSuccess.hasOwner('B', 'shared')) {
    throw new Error('Shared A/B successful ownership was collapsed to a scalar owner');
  }

  const overlappingAllFailed = new PlaylistOwnershipProvenance({ shared: 'A' });
  overlappingAllFailed.beginUpsert('A', 'shared', 1, false);
  overlappingAllFailed.beginUpsert('B', 'shared', 2, false);
  overlappingAllFailed.finishUpsert('B', 'shared', 2, false);
  overlappingAllFailed.finishUpsert('A', 'shared', 1, false);
  if (JSON.stringify(overlappingAllFailed.getOwners('shared')) !== JSON.stringify(['A'])) {
    throw new Error('All failed claims did not restore the durable baseline owner');
  }

  const immediateBPlaylistScope = selectLocalPlaylistsForUser({
    localPlaylists: [playlist('a-owned'), playlist('unowned-local')],
    lastSyncedUserId: 'A',
    currentUserId: 'B',
    previousUserKnownIds: ['a-owned'],
    ownerByPlaylistId: { 'a-owned': 'A' }
  });
  if (JSON.stringify(immediateBPlaylistScope.map(item => item.id)) !== JSON.stringify(['unowned-local'])) {
    throw new Error('Immediate B scope exposed A playlists before a cloud pull');
  }

  const sharedKnownForB = selectLocalPlaylistsForUser({
    localPlaylists: [playlist('shared-known')],
    lastSyncedUserId: 'A',
    currentUserId: 'B',
    previousUserKnownIds: ['shared-known'],
    currentUserKnownIds: ['shared-known'],
    ownerByPlaylistId: { 'shared-known': ['A'] }
  });
  if (sharedKnownForB[0]?.id !== 'shared-known') {
    throw new Error('B known provenance did not preserve its legitimate cached shared playlist');
  }

  const deleteOneSharedOwner = new PlaylistOwnershipProvenance({ shared: ['A', 'B'] });
  deleteOneSharedOwner.removeIfOwned('B', 'shared');
  if (JSON.stringify(deleteOneSharedOwner.getOwners('shared')) !== JSON.stringify(['A'])) {
    throw new Error('Deleting B ownership removed A ownership for the same playlist ID');
  }

  const migratedScalar = new PlaylistOwnershipProvenance({ legacy: 'A' });
  if (!migratedScalar.hasOwner('A', 'legacy')) throw new Error('Scalar ownership migration failed');

  const handoffOwner = { userId: 'A', generation: 7 };
  let handoffUser: string | null = 'A';
  let handoffGeneration = 7;
  const activeDevices = new Set(['device-A']);
  const delayedSend = Promise.resolve().then(() => {
    handoffUser = 'B';
    handoffGeneration = 8;
    activeDevices.clear();
  });
  await delayedSend;
  const staleHandoffApplied = canCompleteOwnedHandoff(
    handoffOwner,
    handoffUser,
    handoffGeneration,
    'device-A',
    activeDevices
  );
  if (staleHandoffApplied) throw new Error('Delayed A handoff paused/toasted B');

  return {
    events,
    broadcasts,
    staleRealtimeAccepted,
    pendingUpsertPreserved: local[0]?.id,
    restartIds: restartBaseline.map(item => item.id),
    sameUserRemoteDeleteConverged: sameUserLocal.length === 0,
    orderedEvents,
    bDuringPending: bDuringPending.map(item => item.id),
    failedLocalOwner: failedLocalOnly.getOwner('local-failure'),
    bAfterRestart: bAfterRestart.map(item => item.id),
    overlapFailureOwners: overlappingFailure.getOwners('shared'),
    overlapSuccessOwners: overlappingSuccess.getOwners('shared'),
    overlapAllFailedOwners: overlappingAllFailed.getOwners('shared'),
    immediateBPlaylistScope: immediateBPlaylistScope.map(item => item.id),
    sharedKnownForB: sharedKnownForB.map(item => item.id),
    deleteOneSharedOwner: deleteOneSharedOwner.getOwners('shared'),
    staleHandoffApplied,
    devicesAfterSwitch: activeDevices.size
  };
}
