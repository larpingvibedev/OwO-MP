import type { Track } from '../types';

export interface HandoffQueuePayload {
  track: Track;
  queue: Track[];
  shuffledQueue?: Track[];
  queueOccurrenceIds?: string[];
  shuffledQueueOccurrenceIds?: string[];
  queueIndex?: number;
  isShuffle?: boolean;
  currentTime: number;
  isPlaying: boolean;
}

function handoffTrackIdentity(track: Track): string {
  return [
    track.id || '',
    track.streamUrl || '',
    track.title || '',
    track.artist || '',
    track.album || '',
    track.source || ''
  ].join('\u0000');
}

function hasCompleteUniqueOccurrenceIds(ids: string[] | undefined, expectedLength: number): ids is string[] {
  return Boolean(ids && ids.length === expectedLength &&
    ids.every(id => typeof id === 'string' && id.trim().length > 0) &&
    new Set(ids).size === ids.length);
}

function mapShuffledOccurrences(
  queue: Track[],
  shuffledQueue: Track[],
  queueOccurrenceIds: string[]
): string[] {
  const used = new Set<number>();
  return shuffledQueue.map((track, shuffledIndex) => {
    const findUnused = (matches: (candidate: Track) => boolean) => {
      for (let index = 0; index < queue.length; index++) {
        if (!used.has(index) && matches(queue[index])) return index;
      }
      return -1;
    };
    let queueIndex = findUnused(candidate => candidate === track);
    if (queueIndex < 0) {
      const identity = handoffTrackIdentity(track);
      queueIndex = findUnused(candidate => handoffTrackIdentity(candidate) === identity);
    }
    if (queueIndex < 0) {
      queueIndex = findUnused(candidate => String(candidate.id || '') === String(track.id || ''));
    }
    if (queueIndex < 0) {
      // Malformed handoffs must still receive a unique token. This occurrence
      // cannot safely be associated with a canonical entry.
      return `handoff-extra-${shuffledIndex}`;
    }
    used.add(queueIndex);
    return queueOccurrenceIds[queueIndex];
  });
}

function suppliedShuffledIdsAreConsistent(
  queue: Track[],
  shuffledQueue: Track[],
  queueOccurrenceIds: string[],
  shuffledOccurrenceIds: string[] | undefined
): shuffledOccurrenceIds is string[] {
  if (!hasCompleteUniqueOccurrenceIds(shuffledOccurrenceIds, shuffledQueue.length)) return false;
  if (shuffledOccurrenceIds.some(id => !queueOccurrenceIds.includes(id))) return false;
  return shuffledOccurrenceIds.every((id, index) => {
    const canonicalIndex = queueOccurrenceIds.indexOf(id);
    return canonicalIndex >= 0 &&
      handoffTrackIdentity(queue[canonicalIndex]) === handoffTrackIdentity(shuffledQueue[index]);
  });
}

export function buildHandoffPlaybackState(payload: HandoffQueuePayload) {
  const queue = payload.queue.length > 0 ? [...payload.queue] : [payload.track];
  const isShuffle = Boolean(payload.isShuffle);
  const shuffledQueue = isShuffle && payload.shuffledQueue?.length
    ? [...payload.shuffledQueue]
    : [...queue];
  const activeQueue = isShuffle ? shuffledQueue : queue;
  const queueOccurrenceIds = hasCompleteUniqueOccurrenceIds(payload.queueOccurrenceIds, queue.length)
    ? [...payload.queueOccurrenceIds]
    : queue.map((_, index) => `handoff-q-${index}`);
  const shuffledQueueOccurrenceIds = suppliedShuffledIdsAreConsistent(
    queue,
    shuffledQueue,
    queueOccurrenceIds,
    payload.shuffledQueueOccurrenceIds
  )
    ? [...payload.shuffledQueueOccurrenceIds]
    : mapShuffledOccurrences(queue, shuffledQueue, queueOccurrenceIds);
  const requestedIndex = Math.max(0, Math.min(activeQueue.length - 1, payload.queueIndex ?? 0));
  const requestedTrack = activeQueue[requestedIndex];
  let queueIndex = requestedIndex;
  if (!requestedTrack || requestedTrack.id !== payload.track.id) {
    const matchingIndex = activeQueue.findIndex(track => track.id === payload.track.id);
    if (matchingIndex >= 0) queueIndex = matchingIndex;
  }
  const currentTrack = activeQueue[queueIndex] || payload.track;
  return {
    queue,
    queueOccurrenceIds,
    shuffledQueue,
    shuffledQueueOccurrenceIds,
    queueIndex,
    currentTrack,
    isShuffle,
    currentTime: Math.max(0, payload.currentTime || 0),
    duration: currentTrack.duration || 0,
    isPlaying: payload.isPlaying
  };
}
