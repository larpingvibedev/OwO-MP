export function assertSupabaseMutationSucceeded(
  result: { error?: { message?: string } | null } | null | undefined,
  action: string
): void {
  if (result?.error) throw new Error(`${action} failed: ${result.error.message || 'Unknown Supabase error'}`);
}

export function reconcileKnownSyncedPlaylistIds(options: {
  localIds: Iterable<string>;
  cloudIds: Iterable<string>;
  knownIds: Iterable<string>;
  isProtected: (playlistId: string) => boolean;
}): { removeLocalIds: Set<string>; nextKnownIds: Set<string> } {
  const localIds = new Set(options.localIds);
  const cloudIds = new Set(options.cloudIds);
  const nextKnownIds = new Set(options.knownIds);
  const removeLocalIds = new Set<string>();

  for (const knownId of Array.from(nextKnownIds)) {
    if (cloudIds.has(knownId) || options.isProtected(knownId)) continue;
    nextKnownIds.delete(knownId);
    if (localIds.has(knownId)) removeLocalIds.add(knownId);
  }
  cloudIds.forEach(id => nextKnownIds.add(id));
  return { removeLocalIds, nextKnownIds };
}

export function selectLocalPlaylistsForUser<T extends { id: string }>(options: {
  localPlaylists: T[];
  lastSyncedUserId: string | null;
  currentUserId: string;
  previousUserKnownIds: Iterable<string>;
  currentUserKnownIds?: Iterable<string>;
  ownerByPlaylistId?: Record<string, string | string[]>;
}): T[] {
  const previousKnownIds = new Set(options.previousUserKnownIds);
  const currentKnownIds = new Set(options.currentUserKnownIds || []);
  const switchedUsers = Boolean(options.lastSyncedUserId && options.lastSyncedUserId !== options.currentUserId);
  return options.localPlaylists.filter(playlist => {
    const rawOwners = options.ownerByPlaylistId?.[playlist.id];
    const owners = new Set(Array.isArray(rawOwners) ? rawOwners : rawOwners ? [rawOwners] : []);
    const ownedByCurrent = owners.has(options.currentUserId) || currentKnownIds.has(playlist.id);
    if (owners.size > 0 && !ownedByCurrent) return false;
    return !switchedUsers || !previousKnownIds.has(playlist.id) || ownedByCurrent;
  });
}
