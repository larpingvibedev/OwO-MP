export interface PullRunContext {
  userId: string;
  generation: number;
  authGeneration: number;
  isCurrent: () => boolean;
}

export interface PullAuthIdentity {
  userId: string | null;
  authGeneration: number;
}

/** Runs at most one pull at a time while guaranteeing one coalesced rerun. */
export class CoalescedPullRunner {
  private requested = false;
  private active: Promise<void> | null = null;
  private idlePromise: Promise<void> | null = null;
  private resolveIdle: (() => void) | null = null;
  private rejectIdle: ((error: unknown) => void) | null = null;
  private getCurrentIdentity: (() => string | null | PullAuthIdentity) | null = null;
  private pull: ((context: PullRunContext) => Promise<void>) | null = null;
  private generation = 0;

  request(
    getCurrentIdentity: () => string | null | PullAuthIdentity,
    pull: (context: PullRunContext) => Promise<void>
  ): Promise<void> {
    this.requested = true;
    this.getCurrentIdentity = getCurrentIdentity;
    this.pull = pull;
    if (!this.idlePromise) {
      this.idlePromise = new Promise<void>((resolve, reject) => {
        this.resolveIdle = resolve;
        this.rejectIdle = reject;
      });
    }
    if (!this.active) {
      this.startDrain();
    }
    return this.idlePromise;
  }

  private startDrain(): void {
    const getCurrentIdentity = this.getCurrentIdentity!;
    const pull = this.pull!;
    const run = this.drain(getCurrentIdentity, pull);
    this.active = run;
    void run.then(
      () => this.finishDrain(run),
      error => this.finishDrain(run, error)
    );
  }

  private finishDrain(run: Promise<void>, error?: unknown): void {
    if (this.active !== run) return;
    this.active = null;

    // A request can arrive after drain's final while-condition but before this
    // completion callback. It must own a fresh drain, not a settled promise.
    if (this.requested && !error) {
      this.startDrain();
      return;
    }

    const resolve = this.resolveIdle;
    const reject = this.rejectIdle;
    this.idlePromise = null;
    this.resolveIdle = null;
    this.rejectIdle = null;
    if (error) reject?.(error);
    else resolve?.();
  }

  private async drain(
    getCurrentIdentity: () => string | null | PullAuthIdentity,
    pull: (context: PullRunContext) => Promise<void>
  ): Promise<void> {
    while (this.requested) {
      this.requested = false;
      const normalize = (value: string | null | PullAuthIdentity): PullAuthIdentity =>
        typeof value === 'string' || value === null
          ? { userId: value, authGeneration: 0 }
          : value;
      const identity = normalize(getCurrentIdentity());
      const userId = identity.userId;
      if (!userId) continue;
      const generation = ++this.generation;
      const isCurrent = () => {
        const current = normalize(getCurrentIdentity());
        return current.userId === userId && current.authGeneration === identity.authGeneration &&
          this.generation === generation;
      };
      await pull({ userId, generation, authGeneration: identity.authGeneration, isCurrent });

      // An account transition while the request was in flight always queues
      // the current account, even if the auth observer has not called again yet.
      const currentIdentity = normalize(getCurrentIdentity());
      if (currentIdentity.userId &&
          (currentIdentity.userId !== userId || currentIdentity.authGeneration !== identity.authGeneration)) {
        this.requested = true;
      }
    }
  }
}
