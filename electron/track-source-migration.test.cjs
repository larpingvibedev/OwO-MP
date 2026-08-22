const test = require('node:test');
const assert = require('node:assert/strict');

// Replicate canonical helper logic from types.ts
function isLocalTrack(track) {
  if (!track) return false;
  return track.source === 'local' || Boolean(track.isLocal) || Boolean(track.id?.startsWith('local-')) || Boolean(track.filePath);
}

function isDownloadedTrack(track) {
  if (!track) return false;
  return Boolean(track.isDownloaded || track.isAppDownload);
}

function canGoToArtist(track) {
  if (!track) return false;
  if (isLocalTrack(track)) return false;
  return Boolean(track.artistId || track.channelId || (track.artist && !track.artist.toLowerCase().includes('unknown')));
}

function canDeleteFromDisk(track) {
  if (!track) return false;
  return isLocalTrack(track) && Boolean(track.filePath);
}

function canRemoveDownload(track) {
  if (!track) return false;
  return isDownloadedTrack(track) && !isLocalTrack(track);
}

function normalizeTrack(track) {
  if (!track) return track;
  const isLocal = isLocalTrack(track);
  const isDownloaded = isDownloadedTrack(track);
  return {
    ...track,
    source: isLocal ? 'local' : (track.source || 'youtube'),
    isLocal,
    isDownloaded
  };
}

test('Legacy Local Track Migration & Invariants', () => {
  // Legacy local track with only isLocal: true and filePath
  const legacyLocal = {
    id: 'local-C%3A%5CMusic%5Csong.mp3',
    title: 'Local Banger',
    artist: 'My Band',
    filePath: 'C:\\Music\\song.mp3',
    isLocal: true,
    duration: 180,
    cover: '',
    streamUrl: 'http://127.0.0.1:41721/api/local-file'
  };

  assert.equal(isLocalTrack(legacyLocal), true);
  assert.equal(isDownloadedTrack(legacyLocal), false);
  assert.equal(canDeleteFromDisk(legacyLocal), true);
  assert.equal(canRemoveDownload(legacyLocal), false);
  assert.equal(canGoToArtist(legacyLocal), false);

  const normalized = normalizeTrack(legacyLocal);
  assert.equal(normalized.source, 'local');
  assert.equal(normalized.isLocal, true);
  assert.equal(normalized.isDownloaded, false);
});

test('Downloaded Online Track Migration & Catalog Preservation', () => {
  // Downloaded YouTube track with isAppDownload: true
  const cachedYtTrack = {
    id: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    artistId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    album: 'Whenever You Need Somebody',
    albumId: 'MPREb_xyz',
    duration: 213,
    cover: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    streamUrl: 'https://rr2---sn.googlevideo.com/...',
    source: 'youtube',
    isAppDownload: true
  };

  assert.equal(isLocalTrack(cachedYtTrack), false);
  assert.equal(isDownloadedTrack(cachedYtTrack), true);
  assert.equal(canGoToArtist(cachedYtTrack), true);
  assert.equal(canRemoveDownload(cachedYtTrack), true);
  assert.equal(canDeleteFromDisk(cachedYtTrack), false);

  const normalized = normalizeTrack(cachedYtTrack);
  assert.equal(normalized.source, 'youtube');
  assert.equal(normalized.isDownloaded, true);
  assert.equal(normalized.isLocal, false);
  assert.equal(normalized.artistId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
});

test('Standard Online Streaming Track Invariants', () => {
  const onlineTrack = {
    id: 'abc12345',
    title: 'Online Song',
    artist: 'Online Artist',
    artistId: 'art-99',
    duration: 190,
    cover: 'https://...',
    streamUrl: 'https://...',
    source: 'youtube'
  };

  assert.equal(isLocalTrack(onlineTrack), false);
  assert.equal(isDownloadedTrack(onlineTrack), false);
  assert.equal(canGoToArtist(onlineTrack), true);
  assert.equal(canRemoveDownload(onlineTrack), false);
  assert.equal(canDeleteFromDisk(onlineTrack), false);
});
