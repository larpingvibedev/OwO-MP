export type PersistedOwnershipSnapshot = Record<string, string | string[]>;
export type OwnershipSnapshot = Record<string, string[]>;

interface UserClaim {
  baselineOwned: boolean;
  attempts: Map<number, { state: 'pending' | 'success' | 'failure' }>;
}

export class PlaylistOwnershipProvenance {
  private owners = new Map<string, Set<string>>();
  private claims = new Map<string, Map<string, UserClaim>>();

  constructor(initial: PersistedOwnershipSnapshot = {}) {
    Object.entries(initial).forEach(([itemId, rawOwners]) => {
      const ownerList = Array.isArray(rawOwners) ? rawOwners : [rawOwners];
      const validOwners = ownerList.filter(owner => typeof owner === 'string' && owner.trim());
      if (validOwners.length > 0) this.owners.set(itemId, new Set(validOwners));
    });
  }

  private setOwned(userId: string, itemId: string, owned: boolean): void {
    const owners = this.owners.get(itemId) || new Set<string>();
    if (owned) owners.add(userId);
    else owners.delete(userId);
    if (owners.size > 0) this.owners.set(itemId, owners);
    else this.owners.delete(itemId);
  }

  beginUpsert(userId: string, itemId: string, version: number, wasKnownForUser: boolean): void {
    let itemClaims = this.claims.get(itemId);
    if (!itemClaims) {
      itemClaims = new Map();
      this.claims.set(itemId, itemClaims);
    }
    let claim = itemClaims.get(userId);
    if (!claim) {
      claim = {
        baselineOwned: this.hasOwner(userId, itemId) || wasKnownForUser,
        attempts: new Map()
      };
      itemClaims.set(userId, claim);
    }
    claim.attempts.set(version, { state: 'pending' });
    this.setOwned(userId, itemId, true);
  }

  finishUpsert(userId: string, itemId: string, version: number, success: boolean): void {
    const itemClaims = this.claims.get(itemId);
    const claim = itemClaims?.get(userId);
    const attempt = claim?.attempts.get(version);
    if (!itemClaims || !claim || !attempt) return;
    attempt.state = success ? 'success' : 'failure';

    const candidates = Array.from(claim.attempts.values()).filter(item => item.state !== 'failure');
    const hasPending = candidates.some(item => item.state === 'pending');
    this.setOwned(userId, itemId, candidates.length > 0 || claim.baselineOwned);

    if (!hasPending) {
      const hasSuccess = Array.from(claim.attempts.values()).some(item => item.state === 'success');
      this.setOwned(userId, itemId, hasSuccess || claim.baselineOwned);
      itemClaims.delete(userId);
      if (itemClaims.size === 0) this.claims.delete(itemId);
    }
  }

  hasPendingUpsert(userId: string, itemId: string): boolean {
    return Array.from(this.claims.get(itemId)?.get(userId)?.attempts.values() || [])
      .some(attempt => attempt.state === 'pending');
  }

  assign(userId: string, itemId: string): void {
    // A cloud row is authoritative for this user only. Another account may
    // legitimately own the same ID and retains its independent ownership.
    const itemClaims = this.claims.get(itemId);
    itemClaims?.delete(userId);
    if (itemClaims?.size === 0) this.claims.delete(itemId);
    this.setOwned(userId, itemId, true);
  }

  removeIfOwned(userId: string, itemId: string): void {
    this.setOwned(userId, itemId, false);
  }

  hasOwner(userId: string, itemId: string): boolean {
    return this.owners.get(itemId)?.has(userId) || false;
  }

  getOwners(itemId: string): string[] {
    return Array.from(this.owners.get(itemId) || []).sort();
  }

  /** Backward-compatible diagnostic for older fixtures/callers. */
  getOwner(itemId: string): string | null {
    return this.getOwners(itemId)[0] || null;
  }

  snapshot(): OwnershipSnapshot {
    return Object.fromEntries(
      Array.from(this.owners.entries(), ([itemId, owners]) => [itemId, Array.from(owners).sort()])
    );
  }
}
