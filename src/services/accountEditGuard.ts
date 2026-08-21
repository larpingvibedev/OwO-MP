export interface AccountEditToken {
  userId: string | null;
  generation: number;
  authGeneration: number;
}

export interface AccountEditAuthContext {
  userId: string | null;
  generation: number;
}

function normalizeAuthContext(context: AccountEditAuthContext | string | null): AccountEditAuthContext {
  return typeof context === 'object' && context !== null
    ? context
    : { userId: context, generation: 0 };
}

export class AccountEditGuard {
  private generation = 0;
  private userId: string | null = null;
  private authGeneration = 0;
  private active = false;

  open(authContext: AccountEditAuthContext | string | null): AccountEditToken {
    const normalized = normalizeAuthContext(authContext);
    this.generation++;
    this.userId = normalized.userId;
    this.authGeneration = normalized.generation;
    this.active = true;
    return this.capture();
  }

  capture(): AccountEditToken {
    return {
      userId: this.userId,
      generation: this.generation,
      authGeneration: this.authGeneration
    };
  }

  invalidate(): void {
    this.generation++;
    this.userId = null;
    this.authGeneration = 0;
    this.active = false;
  }

  isOwnedBy(currentAuthContext: AccountEditAuthContext | string | null): boolean {
    const current = normalizeAuthContext(currentAuthContext);
    return this.active && this.userId === current.userId &&
      this.authGeneration === current.generation;
  }

  isCurrent(token: AccountEditToken, currentAuthContext: AccountEditAuthContext | string | null): boolean {
    const current = normalizeAuthContext(currentAuthContext);
    return this.active && token.generation === this.generation &&
      token.userId === this.userId && token.authGeneration === this.authGeneration &&
      this.userId === current.userId && this.authGeneration === current.generation;
  }
}
