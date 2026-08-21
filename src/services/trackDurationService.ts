import type { Track } from '../types';

const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_TRACKS = 100;
const DEFAULT_CONCURRENCY = 4;
const ELECTRON_DURATION_TIMEOUT_MS = 5000;

const INVIDIOUS_INSTANCES = [
  'https://invidious.flokinet.to',
  'https://yewtu.be',
  'https://inv.tux.pizza'
];

const durationCache = new Map<string, { duration: number; cachedAt: number }>();
const durationRequests = new Map<string, Promise<number>>();

function normalizeDuration(value: unknown): number {
  const duration = Math.round(Number(value));
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function cacheResolvedTrackDuration(
  videoId: string,
  value: unknown,
  cachedAt = Date.now()
): number {
  const duration = normalizeDuration(value);
  const current = durationCache.get(videoId);

  if (duration > 0) {
    durationCache.set(videoId, { duration, cachedAt });
    return duration;
  }

  // Concurrent abortable callers intentionally do not share a request. A slow
  // failure must never erase a successful result that another caller committed
  // first and that is still inside the 24-hour success TTL.
  if (
    current &&
    current.duration > 0 &&
    cachedAt - current.cachedAt < SUCCESS_CACHE_TTL_MS
  ) {
    return current.duration;
  }

  durationCache.set(videoId, { duration: 0, cachedAt });
  return 0;
}

export function createDurationAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Operation cancelled', 'AbortError');
  }
  const error = new Error('Operation cancelled');
  error.name = 'AbortError';
  return error;
}

export function throwIfDurationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createDurationAbortError();
}

function combineWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function waitForElectronDuration(value: Promise<unknown>, signal?: AbortSignal): Promise<number> {
  throwIfDurationAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => reject(createDurationAbortError()));
    const timer = setTimeout(() => finish(() => resolve(0)), ELECTRON_DURATION_TIMEOUT_MS);
    signal?.addEventListener('abort', handleAbort, { once: true });

    Promise.resolve(value).then(
      result => finish(() => resolve(normalizeDuration(result))),
      error => finish(() => reject(error))
    );
  });
}

export function extractExactYouTubeVideoId(track: Track): string | null {
  const streamUrl = typeof track.streamUrl === 'string' ? track.streamUrl.trim() : '';
  if (streamUrl) {
    try {
      const parsed = new URL(streamUrl);
      const host = parsed.hostname.toLowerCase();
      if (host === 'youtu.be') {
        const candidate = parsed.pathname.split('/').filter(Boolean)[0] || '';
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
      }
      if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        const candidate = parsed.searchParams.get('v') || '';
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    } catch {
      // Non-URL stream identifiers (for example Spotify search text) are not exact IDs.
    }
  }

  const id = String(track.id || '').trim();
  const prefixed = /^(?:piped|youtube|yt)-([a-zA-Z0-9_-]{11})$/.exec(id);
  if (prefixed) return prefixed[1];
  if ((track.source === 'youtube' || track.source === 'piped') && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return id;
  }
  return null;
}

export function hasMissingExactTrackDuration(tracks: Track[]): boolean {
  return tracks.some(track =>
    (!Number.isFinite(track.duration) || track.duration <= 0) &&
    Boolean(extractExactYouTubeVideoId(track))
  );
}

async function fetchDurationFromInvidious(videoId: string, signal?: AbortSignal): Promise<number> {
  throwIfDurationAborted(signal);
  const requests = INVIDIOUS_INSTANCES.map(async instance => {
    const response = await fetch(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, {
      headers: { Accept: 'application/json' },
      signal: combineWithTimeout(signal, 3500)
    });
    throwIfDurationAborted(signal);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    throwIfDurationAborted(signal);
    const duration = normalizeDuration(data?.lengthSeconds);
    if (!duration) throw new Error('Duration missing');
    return duration;
  });

  try {
    const duration = await Promise.any(requests);
    throwIfDurationAborted(signal);
    return duration;
  } catch {
    throwIfDurationAborted(signal);
    return 0;
  }
}

async function requestExactTrackDuration(videoId: string, signal?: AbortSignal): Promise<number> {
  throwIfDurationAborted(signal);
  let duration = 0;
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.getYouTubeTrackDuration) {
    try {
      duration = await waitForElectronDuration(electronAPI.getYouTubeTrackDuration(videoId), signal);
    } catch {
      throwIfDurationAborted(signal);
      duration = 0;
    }
  }

  throwIfDurationAborted(signal);
  if (!duration) duration = await fetchDurationFromInvidious(videoId, signal);
  throwIfDurationAborted(signal);
  return duration;
}

export async function resolveExactTrackDuration(
  videoId: string,
  options: { signal?: AbortSignal; retryFailures?: boolean } = {}
): Promise<number> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return 0;
  const { signal, retryFailures = false } = options;
  throwIfDurationAborted(signal);

  const cached = durationCache.get(videoId);
  if (cached) {
    const ttl = cached.duration > 0 ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    if (Date.now() - cached.cachedAt < ttl && !(retryFailures && cached.duration <= 0)) {
      return cached.duration;
    }
    durationCache.delete(videoId);
  }

  // Abortable callers get their own network request so their signal can cancel
  // Invidious work without aborting an unrelated caller sharing this video ID.
  if (signal) {
    const duration = await requestExactTrackDuration(videoId, signal);
    throwIfDurationAborted(signal);
    return cacheResolvedTrackDuration(videoId, duration);
  }

  const inFlight = durationRequests.get(videoId);
  if (inFlight) return inFlight;

  const request = requestExactTrackDuration(videoId).then(duration => {
    return cacheResolvedTrackDuration(videoId, duration);
  }).finally(() => {
    durationRequests.delete(videoId);
  });

  durationRequests.set(videoId, request);
  return request;
}

export async function enrichTrackDurations(
  tracks: Track[],
  options: {
    maxTracks?: number;
    concurrency?: number;
    signal?: AbortSignal;
    retryFailures?: boolean;
  } = {}
): Promise<Track[]> {
  throwIfDurationAborted(options.signal);
  const result = [...tracks];
  const maxTracks = Math.max(0, Math.floor(options.maxTracks ?? DEFAULT_MAX_TRACKS));
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)));
  const candidates = tracks
    .map((track, index) => ({ track, index, videoId: extractExactYouTubeVideoId(track) }))
    .filter(item => (!Number.isFinite(item.track.duration) || item.track.duration <= 0) && Boolean(item.videoId))
    .slice(0, maxTracks);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      throwIfDurationAborted(options.signal);
      const candidate = candidates[cursor++];
      if (!candidate?.videoId) continue;
      const duration = await resolveExactTrackDuration(candidate.videoId, {
        signal: options.signal,
        retryFailures: options.retryFailures
      });
      throwIfDurationAborted(options.signal);
      if (duration > 0) {
        result[candidate.index] = { ...candidate.track, duration };
      }
    }
  });

  await Promise.all(workers);
  throwIfDurationAborted(options.signal);
  return result;
}
