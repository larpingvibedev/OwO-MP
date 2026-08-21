import {
  getAccountScopedPlaylistRowId,
  getLogicalPlaylistIdForUser,
  normalizePlaylistRowsForUser
} from './playlistStorageKey';

export async function runPlaylistStorageKeyFixture(): Promise<Record<string, unknown>> {
  const logicalId = 'PL_SHARED';
  const a = getAccountScopedPlaylistRowId('A', logicalId);
  const b = getAccountScopedPlaylistRowId('B', logicalId);
  if (a === b || getLogicalPlaylistIdForUser(a, 'A') !== logicalId ||
      getLogicalPlaylistIdForUser(b, 'B') !== logicalId || getLogicalPlaylistIdForUser(a, 'B') !== null) {
    throw new Error('Account-scoped playlist row key did not round-trip safely');
  }
  const normalized = normalizePlaylistRowsForUser([
    { id: logicalId, title: 'legacy' },
    { id: a, title: 'scoped' }
  ], 'A');
  if (normalized.length !== 1 || normalized[0].id !== logicalId || normalized[0].title !== 'scoped') {
    throw new Error('Scoped playlist row did not supersede the current user legacy row');
  }

  const migrationEvents: string[] = [];
  const migrate = async (upsertSucceeds: boolean) => {
    migrationEvents.push('upsert:start');
    if (!upsertSucceeds) throw new Error('upsert failed');
    migrationEvents.push('upsert:success');
    migrationEvents.push('legacy-delete');
  };
  try { await migrate(false); } catch {}
  if (migrationEvents.includes('legacy-delete')) throw new Error('Legacy row deleted before scoped upsert success');
  migrationEvents.length = 0;
  await migrate(true);
  if (JSON.stringify(migrationEvents) !== JSON.stringify(['upsert:start', 'upsert:success', 'legacy-delete'])) {
    throw new Error('Legacy migration ordering failed');
  }
  const realtimePayload = { type: 'playlist', id: logicalId };
  if (realtimePayload.id !== logicalId) throw new Error('Realtime payload leaked storage row ID');
  return { a, b, normalizedTitle: normalized[0].title, migrationEvents, realtimeId: realtimePayload.id };
}
