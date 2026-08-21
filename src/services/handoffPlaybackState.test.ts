import type { Track } from '../types';
import { buildHandoffPlaybackState } from './handoffPlaybackState';
import { updateCurrentQueueOccurrenceDuration } from '../store/playerStoreHelpers';

const track = (id: string): Track => ({ id, title: id, artist: 'A', duration: 100, cover: '', streamUrl: '' });

export function runHandoffPlaybackStateFixture(): Record<string, unknown> {
  const queue = [track('one'), track('two'), track('three')];
  const state = buildHandoffPlaybackState({
    track: queue[2],
    queue,
    shuffledQueue: [queue[1], queue[0], queue[2]],
    queueOccurrenceIds: ['one-occ', 'two-occ', 'three-occ'],
    shuffledQueueOccurrenceIds: ['two-occ', 'one-occ', 'three-occ'],
    queueIndex: 2,
    isShuffle: true,
    currentTime: 37,
    isPlaying: true
  });
  if (state.queue.length !== 3 || state.shuffledQueue.length !== 3 || state.queueIndex !== 2 ||
      state.currentTrack.id !== 'three' || state.currentTime !== 37 || !state.isPlaying) {
    throw new Error('Multi-track handoff queue state collapsed or changed index');
  }

  const legacyQueue = [track('A'), track('B')];
  const legacy = buildHandoffPlaybackState({
    track: legacyQueue[1],
    queue: legacyQueue,
    shuffledQueue: [legacyQueue[1], legacyQueue[0]],
    queueIndex: 0,
    isShuffle: true,
    currentTime: 0,
    isPlaying: true
  });
  const legacyUpdated = updateCurrentQueueOccurrenceDuration(legacy, 777);
  if (legacy.shuffledQueueOccurrenceIds[0] !== legacy.queueOccurrenceIds[1] ||
      legacyUpdated.queue[0].duration !== 100 || legacyUpdated.queue[1].duration !== 777) {
    throw new Error('Legacy shuffled handoff mapped duration by numeric position');
  }

  const duplicateQueue = [track('dup'), track('dup')];
  const duplicateShuffled = [{ ...duplicateQueue[0] }, { ...duplicateQueue[1] }];
  const duplicate = buildHandoffPlaybackState({
    track: duplicateShuffled[1],
    queue: duplicateQueue,
    shuffledQueue: duplicateShuffled,
    queueOccurrenceIds: ['partial'],
    shuffledQueueOccurrenceIds: ['also-partial'],
    queueIndex: 1,
    isShuffle: true,
    currentTime: 0,
    isPlaying: false
  });
  const duplicateUpdated = updateCurrentQueueOccurrenceDuration(duplicate, 888);
  if (duplicateUpdated.queue[0].duration !== 100 || duplicateUpdated.queue[1].duration !== 888 ||
      new Set(duplicate.queueOccurrenceIds).size !== 2) {
    throw new Error('Malformed duplicate handoff occurrence IDs were not regenerated and nth-mapped');
  }
  return {
    queue: state.queue.map(item => item.id),
    shuffled: state.shuffledQueue.map(item => item.id),
    queueIndex: state.queueIndex,
    currentTrack: state.currentTrack.id,
    queueOccurrenceIds: state.queueOccurrenceIds,
    shuffledQueueOccurrenceIds: state.shuffledQueueOccurrenceIds,
    legacyCanonicalDurations: legacyUpdated.queue.map(item => item.duration),
    duplicateCanonicalDurations: duplicateUpdated.queue.map(item => item.duration)
  };
}
