'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function isOfflineTrack(track) {
  if (!track) return false;
  return Boolean(
    track.isLocal ||
    track.isAppDownload ||
    track.id?.startsWith('local-')
  );
}

function shouldAllowOnlineContinuation(params) {
  if (!params.autoplay) return false;
  if (!params.activeQueue || params.activeQueue.length === 0) return false;

  const pf = (params.playingFrom || '').toLowerCase();
  if (
    pf.includes('local files') ||
    pf.includes('offline storage') ||
    pf.includes('offline downloads')
  ) {
    return false;
  }

  const isPurelyOffline = params.activeQueue.length > 0 && params.activeQueue.every(isOfflineTrack);
  if (isPurelyOffline) {
    return false;
  }

  if (isOfflineTrack(params.currentTrack) && params.activeQueue.every(isOfflineTrack)) {
    return false;
  }

  return true;
}

test('isOfflineTrack identifies all offline track types', () => {
  assert.equal(isOfflineTrack({ id: 'yt-123', title: 'A', isLocal: true }), true);
  assert.equal(isOfflineTrack({ id: 'yt-456', title: 'B', isAppDownload: true }), true);
  assert.equal(isOfflineTrack({ id: 'local-file-789', title: 'C' }), true);
  assert.equal(isOfflineTrack({ id: 'yt-789', title: 'D' }), false);
  assert.equal(isOfflineTrack(null), false);
});

test('shouldAllowOnlineContinuation blocks purely offline queues', () => {
  const offlineQueue = [
    { id: 'yt-1', isAppDownload: true },
    { id: 'local-2', isLocal: true }
  ];

  const allowed = shouldAllowOnlineContinuation({
    autoplay: true,
    playingFrom: 'Queue',
    currentTrack: offlineQueue[0],
    activeQueue: offlineQueue
  });

  assert.equal(allowed, false);
});

test('shouldAllowOnlineContinuation blocks explicit offline contexts', () => {
  const mixedQueue = [
    { id: 'yt-1', isAppDownload: true },
    { id: 'yt-online-2' }
  ];

  const allowed = shouldAllowOnlineContinuation({
    autoplay: true,
    playingFrom: 'Local Files & Offline Storage',
    currentTrack: mixedQueue[0],
    activeQueue: mixedQueue
  });

  assert.equal(allowed, false);
});

test('shouldAllowOnlineContinuation allows online continuation for regular mixed online queues', () => {
  const mixedQueue = [
    { id: 'yt-1', isAppDownload: true },
    { id: 'yt-online-2' }
  ];

  const allowed = shouldAllowOnlineContinuation({
    autoplay: true,
    playingFrom: 'Summer Hits Mix',
    currentTrack: mixedQueue[0],
    activeQueue: mixedQueue
  });

  assert.equal(allowed, true);
});

test('shouldAllowOnlineContinuation blocks when autoplay is disabled or queue is empty', () => {
  assert.equal(shouldAllowOnlineContinuation({
    autoplay: false,
    playingFrom: 'Mix',
    activeQueue: [{ id: 'yt-1' }]
  }), false);

  assert.equal(shouldAllowOnlineContinuation({
    autoplay: true,
    playingFrom: 'Mix',
    activeQueue: []
  }), false);
});
