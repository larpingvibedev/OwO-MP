import { OptimisticMutationLedger } from './optimisticMutationLedger';

export function runOptimisticMutationRollbackFixture(): Record<string, unknown> {
  const ledger = new OptimisticMutationLedger();
  const playlistBefore = [{ id: 'P', name: 'Before' }];
  let playlists = playlistBefore.filter(item => item.id !== 'P');
  const deleteVersion = ledger.mark('P');
  if (ledger.isCurrent('P', deleteVersion)) playlists = playlistBefore;
  if (playlists !== playlistBefore) throw new Error('Failed playlist delete did not restore exact snapshot');

  const favoriteBefore = [{ id: 'F', title: 'Favorite' }];
  let favorites = favoriteBefore.filter(item => item.id !== 'F');
  const favoriteDelete = ledger.mark('favorite:F');
  if (ledger.isCurrent('favorite:F', favoriteDelete)) favorites = favoriteBefore;
  if (favorites !== favoriteBefore) throw new Error('Failed favorite delete did not restore exact snapshot');

  const staleDelete = ledger.mark('P');
  const newerUpsert = ledger.mark('P');
  let newerValue = [{ id: 'P', name: 'Newer' }];
  if (ledger.isCurrent('P', staleDelete)) newerValue = playlistBefore;
  if (!ledger.isCurrent('P', newerUpsert) || newerValue[0].name !== 'Newer') {
    throw new Error('Stale delete rollback overwrote a newer upsert');
  }
  return { playlistRestored: playlists[0].name, favoriteRestored: favorites[0].title, newer: newerValue[0].name };
}
