export interface SyncOwner {
  userId: string;
  generation: number;
}

export function isCurrentSyncOwner(
  owner: SyncOwner,
  currentUserId: string | null,
  currentGeneration: number
): boolean {
  return owner.userId === currentUserId && owner.generation === currentGeneration;
}

export function localUpsertPrecedesRemoteDelete(mutationKind?: string): boolean {
  return mutationKind === 'upsert';
}

export function canCompleteOwnedHandoff(
  owner: SyncOwner,
  currentUserId: string | null,
  currentGeneration: number,
  targetDeviceId: string,
  activeDeviceIds: Iterable<string>
): boolean {
  return isCurrentSyncOwner(owner, currentUserId, currentGeneration) &&
    new Set(activeDeviceIds).has(targetDeviceId);
}
