export interface OptimisticMutationOwner {
  userId: string | null;
  generation: number;
}

interface OptimisticMutationEntry {
  version: number;
  owner?: OptimisticMutationOwner;
}

export class OptimisticMutationLedger {
  private nextVersion = 1;
  private entries = new Map<string, OptimisticMutationEntry>();

  mark(key: string, owner?: OptimisticMutationOwner): number {
    const version = this.nextVersion++;
    this.entries.set(key, {
      version,
      owner: owner ? { ...owner } : undefined
    });
    return version;
  }

  isCurrent(key: string, version: number, owner?: OptimisticMutationOwner): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.version !== version) return false;
    if (!owner && !entry.owner) return true;
    return Boolean(owner && entry.owner &&
      owner.userId === entry.owner.userId && owner.generation === entry.owner.generation);
  }
}
