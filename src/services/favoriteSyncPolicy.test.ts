import type { Track } from '../types';
import { PlaylistMutationQueue } from './playlistMutationQueue';
import { PlaylistSyncMutationTracker } from './playlistSyncMutationTracker';
import { assertSupabaseMutationSucceeded } from './supabasePlaylistPolicy';
import { reconcileFavoriteTracks, selectLocalFavoritesForUser } from './favoriteSyncPolicy';
import { PlaylistOwnershipProvenance } from './playlistOwnershipProvenance';

const track = (id: string, title = id): Track => ({
  id,
  title,
  artist: 'Artist',
  duration: 1,
  cover: '',
  streamUrl: ''
});

export async function runFavoriteSyncPolicyFixtures(): Promise<Record<string, unknown>> {
  const convergence = reconcileFavoriteTracks({
    localFavorites: [track('remote-delete'), track('local-only')],
    cloudFavorites: [],
    knownIds: ['remote-delete'],
    isProtected: () => false
  });
  if (convergence.favorites.some(item => item.id === 'remote-delete') ||
      !convergence.favorites.some(item => item.id === 'local-only')) {
    throw new Error('Remote deletion/local-only convergence failed');
  }

  const protectedPull = reconcileFavoriteTracks({
    localFavorites: [track('during', 'local-new'), track('pending', 'pending-new')],
    cloudFavorites: [track('during', 'cloud-old'), track('pending', 'cloud-old')],
    knownIds: ['during', 'pending'],
    isProtected: id => id === 'during' || id === 'pending'
  });
  if (protectedPull.favorites.some(item => item.title === 'cloud-old')) {
    throw new Error('Delayed pull overwrote a changed or pending favorite');
  }

  const raceTracker = new PlaylistSyncMutationTracker();
  const raceQueue = new PlaylistMutationQueue();
  const delayedPullVersions = raceTracker.snapshot();
  const delayedPullPending = raceQueue.snapshotPendingPlaylistIds();
  raceTracker.mark('during', 'upsert');
  const changedDuringPull = raceTracker.shouldPreserveLocal(
    'during', delayedPullVersions, delayedPullPending, false
  );

  raceTracker.mark('pending', 'upsert');
  const pendingWork = raceQueue.enqueue('pending', async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
  });
  const pendingPullVersions = raceTracker.snapshot();
  const pendingAtPullStart = raceQueue.snapshotPendingPlaylistIds();
  await pendingWork;
  const pendingBeforePull = raceTracker.shouldPreserveLocal(
    'pending', pendingPullVersions, pendingAtPullStart, raceQueue.hasPending('pending')
  );
  if (!changedDuringPull || !pendingBeforePull) {
    throw new Error(`Favorite pull mutation guards failed: ${changedDuringPull}/${pendingBeforePull}`);
  }

  const accountSwitch = reconcileFavoriteTracks({
    localFavorites: selectLocalFavoritesForUser(
      [track('user-a')], 'A', 'B', { 'user-a': 'A' }, ['user-a']
    ),
    cloudFavorites: [track('user-b')],
    knownIds: [],
    isProtected: () => false
  });
  if (JSON.stringify(accountSwitch.favorites.map(item => item.id)) !== JSON.stringify(['user-b'])) {
    throw new Error('Account-switch favorite isolation failed');
  }
  const immediateBLocal = selectLocalFavoritesForUser(
    [track('a-owned'), track('unowned-local')],
    'A',
    'B',
    { 'a-owned': 'A' },
    ['a-owned']
  );
  if (JSON.stringify(immediateBLocal.map(item => item.id)) !== JSON.stringify(['unowned-local'])) {
    throw new Error('Immediate B scope exposed A favorites before a cloud pull');
  }
  const firstSyncLocal = selectLocalFavoritesForUser([track('local-first-sync')], null, 'A');
  if (firstSyncLocal[0]?.id !== 'local-first-sync') {
    throw new Error('First-sync local-only favorite was not preserved');
  }

  const favoriteClaims = new PlaylistOwnershipProvenance();
  favoriteClaims.beginUpsert('A', 'pending-favorite', 1, false);
  const bWhilePending = selectLocalFavoritesForUser(
    [track('pending-favorite'), track('local-b')],
    'A',
    'B',
    favoriteClaims.snapshot()
  );
  favoriteClaims.finishUpsert('A', 'pending-favorite', 1, false);
  if (JSON.stringify(bWhilePending.map(item => item.id)) !== JSON.stringify(['local-b']) ||
      favoriteClaims.getOwner('pending-favorite') !== null) {
    throw new Error('Favorite pending ownership leaked across account or failed to roll back');
  }

  favoriteClaims.beginUpsert('A', 'durable-favorite', 2, false);
  favoriteClaims.finishUpsert('A', 'durable-favorite', 2, true);
  const restartedFavoriteClaims = new PlaylistOwnershipProvenance(favoriteClaims.snapshot());
  const bAfterFavoriteRestart = selectLocalFavoritesForUser(
    [track('durable-favorite'), track('unowned-after-restart')],
    null,
    'B',
    restartedFavoriteClaims.snapshot()
  );
  if (JSON.stringify(bAfterFavoriteRestart.map(item => item.id)) !== JSON.stringify(['unowned-after-restart'])) {
    throw new Error('Durable favorite ownership did not survive restart isolation');
  }

  const sharedFavoriteForB = selectLocalFavoritesForUser(
    [track('shared-favorite')],
    'A',
    'B',
    { 'shared-favorite': ['A'] },
    ['shared-favorite'],
    ['shared-favorite']
  );
  const sharedFavoriteOwners = new PlaylistOwnershipProvenance({ 'shared-favorite': ['A', 'B'] });
  sharedFavoriteOwners.removeIfOwned('B', 'shared-favorite');
  if (sharedFavoriteForB[0]?.id !== 'shared-favorite' ||
      JSON.stringify(sharedFavoriteOwners.getOwners('shared-favorite')) !== JSON.stringify(['A'])) {
    throw new Error('Shared favorite ownership/known provenance was collapsed across users');
  }
  const overlappingFavoriteClaims = new PlaylistOwnershipProvenance();
  overlappingFavoriteClaims.beginUpsert('A', 'overlap-favorite', 10, false);
  overlappingFavoriteClaims.beginUpsert('B', 'overlap-favorite', 11, false);
  overlappingFavoriteClaims.finishUpsert('A', 'overlap-favorite', 10, true);
  overlappingFavoriteClaims.finishUpsert('B', 'overlap-favorite', 11, false);
  if (JSON.stringify(overlappingFavoriteClaims.getOwners('overlap-favorite')) !== JSON.stringify(['A'])) {
    throw new Error('Failed B favorite claim erased successful A ownership');
  }
  overlappingFavoriteClaims.beginUpsert('B', 'overlap-favorite', 12, false);
  overlappingFavoriteClaims.finishUpsert('B', 'overlap-favorite', 12, true);
  if (JSON.stringify(overlappingFavoriteClaims.getOwners('overlap-favorite')) !== JSON.stringify(['A', 'B'])) {
    throw new Error('Successful shared favorite claims collapsed to one account');
  }

  const known = new Set(['known-before']);
  let broadcasts = 0;
  const failedMutationTracker = new PlaylistSyncMutationTracker();
  const failedMutation = failedMutationTracker.mark('known-before', 'delete');
  try {
    assertSupabaseMutationSucceeded({ error: { message: 'denied' } }, 'Favorite delete');
    known.delete('known-before');
    broadcasts++;
  } catch {
    failedMutationTracker.settleIfCurrent('known-before', failedMutation.version);
  }
  if (!known.has('known-before') || broadcasts !== 0 ||
      failedMutationTracker.get('known-before')?.kind !== 'settled') {
    throw new Error('Resolved favorite mutation error advanced durable state');
  }

  const queue = new PlaylistMutationQueue();
  const tracker = new PlaylistSyncMutationTracker();
  const order: string[] = [];
  const first = tracker.mark('rapid', 'upsert');
  const add = queue.enqueue('rapid', async () => {
    order.push('add:start');
    await new Promise(resolve => setTimeout(resolve, 10));
    order.push('add:end');
    tracker.settleIfCurrent('rapid', first.version);
  });
  const second = tracker.mark('rapid', 'delete');
  const remove = queue.enqueue('rapid', async () => {
    order.push('delete:start');
    order.push('delete:end');
    tracker.settleIfCurrent('rapid', second.version);
  });
  await Promise.all([add, remove]);
  if (JSON.stringify(order) !== JSON.stringify(['add:start', 'add:end', 'delete:start', 'delete:end']) ||
      tracker.get('rapid')?.kind !== 'settled') {
    throw new Error(`Rapid favorite mutation ordering failed: ${order.join(',')}`);
  }

  return {
    remaining: convergence.favorites.map(item => item.id),
    protected: protectedPull.favorites.map(item => item.title),
    changedDuringPull,
    pendingBeforePull,
    account: accountSwitch.favorites.map(item => item.id),
    immediateBLocal: immediateBLocal.map(item => item.id),
    bWhilePending: bWhilePending.map(item => item.id),
    bAfterFavoriteRestart: bAfterFavoriteRestart.map(item => item.id),
    sharedFavoriteForB: sharedFavoriteForB.map(item => item.id),
    sharedFavoriteOwnersAfterBDelete: sharedFavoriteOwners.getOwners('shared-favorite'),
    overlappingFavoriteOwners: overlappingFavoriteClaims.getOwners('overlap-favorite'),
    resolvedErrorBroadcasts: broadcasts,
    order
  };
}
