const PREFIX = 'owo1:';

export function getAccountScopedPlaylistRowId(userId: string, logicalPlaylistId: string): string {
  return `${PREFIX}${userId.length}:${userId}${logicalPlaylistId}`;
}

export function parseAccountScopedPlaylistRowId(rowId: string): { userId: string; logicalPlaylistId: string } | null {
  if (!rowId.startsWith(PREFIX)) return null;
  const lengthEnd = rowId.indexOf(':', PREFIX.length);
  if (lengthEnd < 0) return null;
  const userLength = Number(rowId.slice(PREFIX.length, lengthEnd));
  if (!Number.isSafeInteger(userLength) || userLength < 1) return null;
  const userStart = lengthEnd + 1;
  const userId = rowId.slice(userStart, userStart + userLength);
  const logicalPlaylistId = rowId.slice(userStart + userLength);
  return userId && logicalPlaylistId ? { userId, logicalPlaylistId } : null;
}

export function getLogicalPlaylistIdForUser(rowId: string, userId: string): string | null {
  const scoped = parseAccountScopedPlaylistRowId(rowId);
  if (!scoped) return rowId;
  return scoped.userId === userId ? scoped.logicalPlaylistId : null;
}

export function normalizePlaylistRowsForUser<T extends { id: string }>(rows: T[], userId: string): Array<T & { id: string }> {
  const byLogicalId = new Map<string, { row: T; scoped: boolean }>();
  rows.forEach(row => {
    const parsed = parseAccountScopedPlaylistRowId(String(row.id));
    const logicalId = getLogicalPlaylistIdForUser(String(row.id), userId);
    if (!logicalId) return;
    const scoped = Boolean(parsed);
    const existing = byLogicalId.get(logicalId);
    if (!existing || (scoped && !existing.scoped)) {
      byLogicalId.set(logicalId, { row, scoped });
    }
  });
  return Array.from(byLogicalId, ([id, value]) => ({ ...value.row, id }));
}
