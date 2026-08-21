import type { Track } from '../types';
import {
  dedupeDownloadTracks,
  removeQueueOccurrence,
  updateCurrentQueueOccurrenceDuration,
  waitForDownloadOwnerCompletion
} from './playerStoreHelpers';

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  duration: 100,
  cover: '',
  streamUrl: `https://example.test/${id}/${title}`
});

export async function runPlayerStoreHelperFixtures(): Promise<Record<string, unknown>> {
  const a = track('a', 'A');
  const duplicateOne = track('dup', 'Duplicate');
  const b = track('b', 'B');
  const duplicateTwo = track('dup', 'Duplicate');
  const canonical = [a, duplicateOne, b, duplicateTwo];
  const shuffled = [duplicateTwo, a, duplicateOne, b];

  const upcomingRemoval = removeQueueOccurrence({
    queue: canonical,
    shuffledQueue: shuffled,
    isShuffle: true,
    queueIndex: 1,
    currentTrack: a,
    currentTime: 42,
    duration: 100,
    isPlaying: true,
    playNonce: 3
  }, 2);
  if (upcomingRemoval.queue.includes(duplicateOne) || upcomingRemoval.shuffledQueue.includes(duplicateOne)) {
    throw new Error('Shuffled upcoming removal did not remove the same duplicate occurrence');
  }
  if (upcomingRemoval.currentTrack !== a || upcomingRemoval.queueIndex !== 1 || upcomingRemoval.currentTime !== 42) {
    throw new Error('Upcoming removal disturbed current playback');
  }

  const currentRemoval = removeQueueOccurrence({
    queue: canonical,
    shuffledQueue: shuffled,
    isShuffle: true,
    queueIndex: 1,
    currentTrack: a,
    currentTime: 42,
    duration: 100,
    isPlaying: true,
    playNonce: 3
  }, 1);
  if (currentRemoval.currentTrack !== duplicateOne || currentRemoval.queueIndex !== 1 || currentRemoval.currentTime !== 0 || currentRemoval.playNonce !== 4) {
    throw new Error('Current shuffled removal did not advance playback correctly');
  }

  const c = track('c', 'C');
  const canonicalDuration = updateCurrentQueueOccurrenceDuration({
    queue: [a, b, c],
    shuffledQueue: [c, { ...a }, { ...b }],
    isShuffle: false,
    queueIndex: 0,
    currentTrack: { ...a }
  }, 222);
  if (canonicalDuration.queue[0].duration !== 222 || canonicalDuration.shuffledQueue[1].duration !== 222 ||
      canonicalDuration.queue[1].duration === 222 || canonicalDuration.shuffledQueue[0].duration === 222) {
    throw new Error('Canonical duration update used a numeric index instead of the logical occurrence');
  }

  const shuffledDuration = updateCurrentQueueOccurrenceDuration({
    queue: [{ ...a }, { ...b }, { ...c }],
    shuffledQueue: [{ ...c }, { ...a }, { ...b }],
    isShuffle: true,
    queueIndex: 1,
    currentTrack: { ...a }
  }, 333);
  if (shuffledDuration.shuffledQueue[1].duration !== 333 || shuffledDuration.queue[0].duration !== 333 ||
      shuffledDuration.queue[1].duration === 333 || shuffledDuration.shuffledQueue[0].duration === 333) {
    throw new Error('Shuffled duration update lost or overwrote a different logical occurrence');
  }

  const refDuplicateDuration = updateCurrentQueueOccurrenceDuration({
    queue: [duplicateOne, b, duplicateTwo],
    shuffledQueue: [duplicateTwo, b, duplicateOne],
    isShuffle: true,
    queueIndex: 0,
    currentTrack: duplicateTwo
  }, 444);
  if (refDuplicateDuration.queue[2].duration !== 444 || refDuplicateDuration.queue[0].duration === 444) {
    throw new Error('Reference-identical duplicate occurrence duration mapped to its sibling');
  }

  const firstSerialized = track('same', 'First serialized');
  const secondSerialized = track('same', 'Second serialized');
  const deserializedDuration = updateCurrentQueueOccurrenceDuration({
    queue: [{ ...firstSerialized }, { ...secondSerialized }],
    shuffledQueue: [{ ...secondSerialized }, { ...firstSerialized }],
    isShuffle: true,
    queueIndex: 0,
    currentTrack: { ...secondSerialized }
  }, 555);
  if (deserializedDuration.queue[1].duration !== 555 || deserializedDuration.queue[0].duration === 555) {
    throw new Error('Deserialized duplicate-ID duration ignored detailed occurrence identity');
  }
  const identical = track('identical', 'Identical');
  const serializedIdenticalDuration = updateCurrentQueueOccurrenceDuration({
    queue: [{ ...identical }, { ...identical }],
    shuffledQueue: [{ ...identical }, { ...identical }],
    queueOccurrenceIds: ['occ-first', 'occ-second'],
    shuffledQueueOccurrenceIds: ['occ-second', 'occ-first'],
    isShuffle: true,
    queueIndex: 0,
    currentTrack: { ...identical }
  }, 666);
  if (serializedIdenticalDuration.queue[1].duration !== 666 || serializedIdenticalDuration.queue[0].duration === 666) {
    throw new Error('Stable queue occurrence IDs did not disambiguate serialized identical duplicates');
  }

  const deduped = dedupeDownloadTracks([a, a, track('a', 'Different object'), b]);
  if (deduped.length !== 2) throw new Error(`Batch dedupe returned ${deduped.length} tracks`);

  let downloaded = false;
  let downloading = true;
  const owner = new Promise<boolean>(resolve => setTimeout(() => {
    downloaded = true;
    downloading = false;
    resolve(true);
  }, 15));
  const overlapResult = await waitForDownloadOwnerCompletion({
    isDownloaded: () => downloaded,
    isDownloading: () => downloading,
    getOwnerPromise: () => owner,
    timeoutMs: 100,
    pollMs: 5
  });
  const timeoutResult = await waitForDownloadOwnerCompletion({
    isDownloaded: () => false,
    isDownloading: () => true,
    getOwnerPromise: () => undefined,
    timeoutMs: 20,
    pollMs: 5
  });
  if (overlapResult !== 'success' || timeoutResult !== 'timeout') {
    throw new Error(`Owner wait mismatch: ${overlapResult}/${timeoutResult}`);
  }

  return {
    upcomingQueueIndex: upcomingRemoval.queueIndex,
    currentTrackAfterRemoval: currentRemoval.currentTrack?.id,
    canonicalDurationIds: canonicalDuration.queue.map(item => `${item.id}:${item.duration}`),
    shuffledDurationIds: shuffledDuration.shuffledQueue.map(item => `${item.id}:${item.duration}`),
    referenceDuplicateDurations: refDuplicateDuration.queue.map(item => item.duration),
    deserializedDuplicateDurations: deserializedDuration.queue.map(item => item.duration),
    serializedIdenticalDurations: serializedIdenticalDuration.queue.map(item => item.duration),
    deduped: deduped.map(item => item.id),
    overlapResult,
    timeoutResult
  };
}
