import {
  cacheResolvedTrackDuration,
  resolveExactTrackDuration
} from './trackDurationService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export async function runDurationCacheMonotonicRaceFixture(): Promise<number[]> {
  const videoId = 'cacheRace01';
  const lateFailure = deferred<number>();
  const earlySuccess = deferred<number>();
  const failureCommit = lateFailure.promise.then(value => cacheResolvedTrackDuration(videoId, value));
  const successCommit = earlySuccess.promise.then(value => cacheResolvedTrackDuration(videoId, value));

  earlySuccess.resolve(245);
  const success = await successCommit;
  lateFailure.resolve(0);
  const failure = await failureCommit;
  const cached = cacheResolvedTrackDuration(videoId, 0);

  const values = [success, failure, cached];
  if (JSON.stringify(values) !== JSON.stringify([245, 245, 245])) {
    throw new Error(`Duration cache was downgraded: ${values.join(',')}`);
  }
  return values;
}

export async function runAbortableDurationCallerRaceFixture(): Promise<number[]> {
  const videoId = 'raceCaller1';
  const firstIpc = deferred<number>();
  const secondIpc = deferred<number>();
  const originalElectronApi = (window as any).electronAPI;
  const originalFetch = globalThis.fetch;
  let ipcCall = 0;

  (window as any).electronAPI = {
    ...(originalElectronApi || {}),
    getYouTubeTrackDuration: () => (++ipcCall === 1 ? firstIpc.promise : secondIpc.promise)
  };
  globalThis.fetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;

  try {
    const firstCaller = resolveExactTrackDuration(videoId, { signal: new AbortController().signal, retryFailures: true });
    const secondCaller = resolveExactTrackDuration(videoId, { signal: new AbortController().signal, retryFailures: true });
    secondIpc.resolve(245);
    const second = await secondCaller;
    firstIpc.resolve(0);
    const first = await firstCaller;
    const cached = await resolveExactTrackDuration(videoId);
    const values = [second, first, cached];
    if (JSON.stringify(values) !== JSON.stringify([245, 245, 245])) {
      throw new Error(`Abortable caller race downgraded cache: ${values.join(',')}`);
    }
    return values;
  } finally {
    (window as any).electronAPI = originalElectronApi;
    globalThis.fetch = originalFetch;
  }
}
