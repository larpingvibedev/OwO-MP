import { CoalescedPullRunner } from './coalescedPullRunner';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

export async function runCoalescedPullRunnerFixtures(): Promise<Record<string, unknown>> {
  let userId: string | null = 'A';
  const runner = new CoalescedPullRunner();
  const favoritesGate = deferred<void>();
  const applied: string[] = [];
  let runs = 0;
  let overlap = 0;
  let maxOverlap = 0;

  const pull = async (context: { userId: string; isCurrent: () => boolean }) => {
    runs++;
    overlap++;
    maxOverlap = Math.max(maxOverlap, overlap);
    try {
      if (runs === 1) await favoritesGate.promise;
      if (context.isCurrent()) applied.push(`${context.userId}:${runs}`);
    } finally {
      overlap--;
    }
  };

  const first = runner.request(() => userId, pull);
  const remoteDuringFavorites = runner.request(() => userId, pull);
  runner.request(() => userId, pull);
  favoritesGate.resolve();
  await Promise.all([first, remoteDuringFavorites]);
  if (runs !== 2 || maxOverlap !== 1 || applied.at(-1) !== 'A:2') {
    throw new Error(`Coalesced rerun mismatch: ${runs}/${maxOverlap}/${applied.join(',')}`);
  }

  const switchRunner = new CoalescedPullRunner();
  const accountGate = deferred<void>();
  const accountApplied: string[] = [];
  let accountRuns = 0;
  const accountPull = async (context: { userId: string; isCurrent: () => boolean }) => {
    accountRuns++;
    if (accountRuns === 1) await accountGate.promise;
    if (context.isCurrent()) accountApplied.push(context.userId);
  };
  userId = 'A';
  const a = switchRunner.request(() => userId, accountPull);
  userId = 'B';
  const b = switchRunner.request(() => userId, accountPull);
  accountGate.resolve();
  await Promise.all([a, b]);
  if (JSON.stringify(accountApplied) !== JSON.stringify(['B']) || accountRuns !== 2) {
    throw new Error(`Account switch applied stale pull: ${accountApplied.join(',')}/${accountRuns}`);
  }

  const abaRunner = new CoalescedPullRunner();
  const abaGate = deferred<void>();
  let abaIdentity = { userId: 'A' as string | null, authGeneration: 1 };
  const abaApplied: string[] = [];
  let abaRuns = 0;
  const abaPull = async (context: { userId: string; authGeneration: number; isCurrent: () => boolean }) => {
    abaRuns++;
    if (abaRuns === 1) await abaGate.promise;
    if (context.isCurrent()) abaApplied.push(`${context.userId}:${context.authGeneration}`);
  };
  const originalA = abaRunner.request(() => abaIdentity, abaPull);
  abaIdentity = { userId: 'B', authGeneration: 2 };
  abaRunner.request(() => abaIdentity, abaPull);
  abaIdentity = { userId: 'A', authGeneration: 3 };
  const freshA = abaRunner.request(() => abaIdentity, abaPull);
  abaGate.resolve();
  await Promise.all([originalA, freshA]);
  if (JSON.stringify(abaApplied) !== JSON.stringify(['A:3']) || abaRuns !== 2) {
    throw new Error(`Auth ABA pull applied stale A: ${abaApplied.join(',')}/${abaRuns}`);
  }

  // Force the settle window: request a rerun from a microtask attached to the
  // first drain completion, before its ownership finalizer releases `active`.
  const settleRunner = new CoalescedPullRunner();
  let settleRuns = 0;
  let settleRequest!: Promise<void>;
  const settlePull = async () => { settleRuns++; };
  const settleFirst = settleRunner.request(() => 'S', settlePull);
  queueMicrotask(() => {
    settleRequest = settleRunner.request(() => 'S', settlePull);
  });
  await settleFirst;
  await settleRequest;
  if (settleRuns !== 2) throw new Error(`Settle-window rerun was lost: ${settleRuns}`);

  return { runs, maxOverlap, applied, accountRuns, accountApplied, abaRuns, abaApplied, settleRuns };
}
