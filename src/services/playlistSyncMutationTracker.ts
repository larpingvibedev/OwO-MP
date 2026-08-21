export type PlaylistMutationKind = 'upsert' | 'delete' | 'remote-delete' | 'settled';

export interface PlaylistMutationVersion {
  version: number;
  kind: PlaylistMutationKind;
}

export class PlaylistSyncMutationTracker {
  private nextVersion = 1;
  private versions = new Map<string, PlaylistMutationVersion>();

  mark(playlistId: string, kind: PlaylistMutationKind): PlaylistMutationVersion {
    const entry = { version: this.nextVersion++, kind };
    this.versions.set(playlistId, entry);
    return entry;
  }

  snapshot(): Map<string, PlaylistMutationVersion> {
    return new Map(
      Array.from(this.versions, ([playlistId, entry]) => [playlistId, { ...entry }])
    );
  }

  get(playlistId: string): PlaylistMutationVersion | undefined {
    const entry = this.versions.get(playlistId);
    return entry ? { ...entry } : undefined;
  }

  restoreIfCurrent(
    playlistId: string,
    expectedVersion: number,
    previous: PlaylistMutationVersion | undefined
  ): boolean {
    if (this.versions.get(playlistId)?.version !== expectedVersion) return false;
    if (previous) this.versions.set(playlistId, { ...previous });
    else this.versions.delete(playlistId);
    return true;
  }

  clearKind(playlistId: string, kind: PlaylistMutationKind): void {
    if (this.versions.get(playlistId)?.kind === kind) this.versions.delete(playlistId);
  }

  clearWhere(predicate: (playlistId: string) => boolean): void {
    for (const playlistId of this.versions.keys()) {
      if (predicate(playlistId)) this.versions.delete(playlistId);
    }
  }

  settleIfCurrent(playlistId: string, expectedVersion: number): boolean {
    const current = this.versions.get(playlistId);
    if (current?.version !== expectedVersion) return false;
    this.versions.set(playlistId, { version: current.version, kind: 'settled' });
    return true;
  }

  shouldPreserveLocal(
    playlistId: string,
    syncStartVersions: Map<string, PlaylistMutationVersion>,
    pendingAtSyncStart: Set<string>,
    pendingNow: boolean
  ): boolean {
    const current = this.versions.get(playlistId);
    const atStart = syncStartVersions.get(playlistId);
    const changedSinceStart = (current?.version || 0) !== (atStart?.version || 0);
    const isDeletedLocally = current?.kind === 'delete' || current?.kind === 'remote-delete';
    return isDeletedLocally || changedSinceStart || pendingAtSyncStart.has(playlistId) || pendingNow;
  }
}
