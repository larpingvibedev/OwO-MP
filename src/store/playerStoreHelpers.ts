import type { Track } from '../types';

function detailedTrackIdentity(track: Track): string {
  return [track.id, track.streamUrl || '', track.title || '', track.artist || '', track.album || '', track.source || ''].join('\u0000');
}

export function getDownloadTrackIdentity(track: Track): string {
  const id = String(track.id || '').trim();
  return id || detailedTrackIdentity(track);
}

export function dedupeDownloadTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter(track => {
    if (!track) return false;
    const identity = getDownloadTrackIdentity(track);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function findMatchingOccurrenceIndex(source: Track[], sourceIndex: number, other: Track[]): number {
  const target = source[sourceIndex];
  if (!target) return -1;

  const referenceIndex = other.findIndex(track => track === target);
  if (referenceIndex >= 0) return referenceIndex;

  const findNthMatch = (identityFor: (track: Track) => string): number => {
    const identity = identityFor(target);
    let occurrence = 0;
    for (let index = 0; index <= sourceIndex; index++) {
      if (identityFor(source[index]) === identity) occurrence++;
    }
    for (let index = 0; index < other.length; index++) {
      if (identityFor(other[index]) !== identity) continue;
      occurrence--;
      if (occurrence === 0) return index;
    }
    return -1;
  };

  const detailedMatch = findNthMatch(detailedTrackIdentity);
  if (detailedMatch >= 0) return detailedMatch;
  // Persisted queue/shuffle arrays may deserialize to separate objects or carry
  // duration updates in only one representation. Fall back to the nth stable
  // track ID occurrence without collapsing duplicate occurrences.
  const idMatch = findNthMatch(track => String(track.id || ''));
  if (idMatch >= 0) return idMatch;
  return -1;
}

export interface QueueDurationUpdateInput {
  queue: Track[];
  shuffledQueue: Track[];
  isShuffle: boolean;
  queueIndex: number;
  currentTrack: Track | null;
  queueOccurrenceIds?: string[];
  shuffledQueueOccurrenceIds?: string[];
}

export function updateCurrentQueueOccurrenceDuration(
  input: QueueDurationUpdateInput,
  duration: number
): QueueDurationUpdateInput {
  if (!input.currentTrack) return input;
  const active = input.isShuffle ? input.shuffledQueue : input.queue;
  const other = input.isShuffle ? input.queue : input.shuffledQueue;
  const activeIndex = input.queueIndex;
  if (activeIndex < 0 || activeIndex >= active.length) {
    return { ...input, currentTrack: { ...input.currentTrack, duration } };
  }

  const activeIds = input.isShuffle ? input.shuffledQueueOccurrenceIds : input.queueOccurrenceIds;
  const otherIds = input.isShuffle ? input.queueOccurrenceIds : input.shuffledQueueOccurrenceIds;
  const activeOccurrenceId = activeIds?.[activeIndex];
  const mappedByOccurrence = activeOccurrenceId && otherIds
    ? otherIds.indexOf(activeOccurrenceId)
    : -1;
  const otherIndex = mappedByOccurrence >= 0
    ? mappedByOccurrence
    : findMatchingOccurrenceIndex(active, activeIndex, other);
  const nextCurrent = { ...input.currentTrack, duration };
  const nextActive = active.map((track, index) =>
    index === activeIndex ? { ...track, duration } : track
  );
  const nextOther = otherIndex >= 0
    ? other.map((track, index) => index === otherIndex ? { ...track, duration } : track)
    : other;

  return {
    ...input,
    currentTrack: nextCurrent,
    queue: input.isShuffle ? nextOther : nextActive,
    shuffledQueue: input.isShuffle ? nextActive : nextOther
  };
}

export interface QueueRemovalInput {
  queue: Track[];
  shuffledQueue: Track[];
  isShuffle: boolean;
  queueIndex: number;
  currentTrack: Track | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playNonce: number;
}

export interface QueueRemovalResult extends QueueRemovalInput {
  removed: boolean;
  currentChanged: boolean;
}

export function removeQueueOccurrence(input: QueueRemovalInput, activeIndex: number): QueueRemovalResult {
  const active = input.isShuffle ? input.shuffledQueue : input.queue;
  const other = input.isShuffle ? input.queue : input.shuffledQueue;
  if (activeIndex < 0 || activeIndex >= active.length) {
    return { ...input, removed: false, currentChanged: false };
  }

  const otherIndex = findMatchingOccurrenceIndex(active, activeIndex, other);
  const nextActive = active.filter((_, index) => index !== activeIndex);
  const nextOther = otherIndex >= 0 ? other.filter((_, index) => index !== otherIndex) : [...other];
  const removedCurrent = activeIndex === input.queueIndex;

  let nextIndex = input.queueIndex;
  if (nextActive.length === 0) {
    nextIndex = 0;
  } else if (activeIndex < input.queueIndex) {
    nextIndex = Math.max(0, input.queueIndex - 1);
  } else if (removedCurrent) {
    nextIndex = Math.min(activeIndex, nextActive.length - 1);
  } else {
    nextIndex = Math.min(input.queueIndex, nextActive.length - 1);
  }

  const nextCurrentTrack = nextActive[nextIndex] || null;
  return {
    ...input,
    queue: input.isShuffle ? nextOther : nextActive,
    shuffledQueue: input.isShuffle ? nextActive : nextOther,
    queueIndex: nextIndex,
    currentTrack: nextCurrentTrack,
    currentTime: removedCurrent ? 0 : input.currentTime,
    duration: removedCurrent ? (nextCurrentTrack?.duration || 0) : input.duration,
    isPlaying: nextCurrentTrack ? input.isPlaying : false,
    playNonce: removedCurrent && nextCurrentTrack ? input.playNonce + 1 : input.playNonce,
    removed: true,
    currentChanged: removedCurrent
  };
}

export type DownloadOwnerWaitResult = 'success' | 'failed' | 'timeout';

export async function waitForDownloadOwnerCompletion(options: {
  isDownloaded: () => boolean;
  isDownloading: () => boolean;
  getOwnerPromise: () => Promise<boolean> | undefined;
  timeoutMs: number;
  pollMs?: number;
}): Promise<DownloadOwnerWaitResult> {
  const deadline = Date.now() + Math.max(1, options.timeoutMs);
  const pollMs = Math.max(5, options.pollMs || 100);

  while (Date.now() < deadline) {
    if (options.isDownloaded()) return 'success';
    const remaining = Math.max(1, deadline - Date.now());
    const owner = options.getOwnerPromise();
    if (owner) {
      const ownerResult = await new Promise<{ type: 'owner' | 'timeout'; value: boolean }>(resolve => {
        let settled = false;
        const finish = (result: { type: 'owner' | 'timeout'; value: boolean }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => finish({ type: 'timeout', value: false }), remaining);
        owner.then(
          value => finish({ type: 'owner', value }),
          () => finish({ type: 'owner', value: false })
        );
      });
      if (ownerResult.type === 'timeout') return options.isDownloaded() ? 'success' : 'timeout';
      if (options.isDownloaded() || ownerResult.value) return 'success';
      if (!options.isDownloading()) return 'failed';
    } else if (!options.isDownloading()) {
      return options.isDownloaded() ? 'success' : 'failed';
    }

    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  return options.isDownloaded() ? 'success' : 'timeout';
}
