import type { Track } from '../types';

export function selectLocalFavoritesForUser(
  localFavorites: Track[],
  lastSyncedUserId: string | null,
  currentUserId: string,
  ownerByFavoriteId?: Record<string, string | string[]>,
  previousUserKnownIds: Iterable<string> = [],
  currentUserKnownIds: Iterable<string> = []
): Track[] {
  const previousKnown = new Set(previousUserKnownIds);
  const currentKnown = new Set(currentUserKnownIds);
  const switchedUsers = Boolean(lastSyncedUserId && lastSyncedUserId !== currentUserId);
  return localFavorites.filter(track => {
    const rawOwners = ownerByFavoriteId?.[track.id];
    const owners = new Set(Array.isArray(rawOwners) ? rawOwners : rawOwners ? [rawOwners] : []);
    const ownedByCurrent = owners.has(currentUserId) || currentKnown.has(track.id);
    if (owners.size > 0 && !ownedByCurrent) return false;
    return !switchedUsers || !previousKnown.has(track.id) || ownedByCurrent;
  });
}

export function reconcileFavoriteTracks(options: {
  localFavorites: Track[];
  cloudFavorites: Track[];
  knownIds: Iterable<string>;
  isProtected: (trackId: string) => boolean;
}): { favorites: Track[]; nextKnownIds: Set<string>; removedIds: Set<string> } {
  const cloudById = new Map(options.cloudFavorites.map(track => [track.id, track]));
  const nextKnownIds = new Set(options.knownIds);
  const removedIds = new Set<string>();

  for (const knownId of Array.from(nextKnownIds)) {
    if (cloudById.has(knownId) || options.isProtected(knownId)) continue;
    nextKnownIds.delete(knownId);
    removedIds.add(knownId);
  }
  cloudById.forEach((_track, id) => nextKnownIds.add(id));

  const merged = options.localFavorites.filter(track => !removedIds.has(track.id));
  cloudById.forEach((cloudTrack, id) => {
    if (options.isProtected(id)) return;
    const existingIndex = merged.findIndex(track => track.id === id);
    if (existingIndex >= 0) merged[existingIndex] = cloudTrack;
    else merged.push(cloudTrack);
  });

  return { favorites: merged, nextKnownIds, removedIds };
}
