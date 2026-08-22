'use strict';

const { DiscordPresenceService } = require('./discordPresence.cjs');

async function testDiscordPresence() {
  const service = new DiscordPresenceService();

  // Test 1: Sanitization
  if (service.sanitizeString('  song title.mp3  ') !== 'song title') {
    throw new Error('sanitizeString failed to strip mp3 extension or trim');
  }
  if (service.sanitizeString('very long title '.repeat(20), 50).length > 50) {
    throw new Error('sanitizeString exceeded maxLen');
  }
  if (service.sanitizeString('', 50, 'Fallback') !== 'Fallback') {
    throw new Error('sanitizeString fallback failed');
  }

  // Test 2: Artwork URL sanitization
  if (service.sanitizeArtworkUrl('file:///C:/Users/gamer/Music/song.mp3') !== 'owo-logo') {
    throw new Error('sanitizeArtworkUrl failed to reject file:// URL');
  }
  if (service.sanitizeArtworkUrl('blob:http://localhost/1234') !== 'owo-logo') {
    throw new Error('sanitizeArtworkUrl failed to reject blob: URL');
  }
  if (service.sanitizeArtworkUrl('C:\\Music\\cover.jpg') !== 'owo-logo') {
    throw new Error('sanitizeArtworkUrl failed to reject Windows path');
  }
  if (service.sanitizeArtworkUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg') !== 'https://i.ytimg.com/vi/abc/hqdefault.jpg') {
    throw new Error('sanitizeArtworkUrl rejected valid https URL');
  }

  // Test 3: Caching snapshot & Disabled state
  service.setEnabled(false);
  service.updateActivity({
    title: 'Test Song',
    artist: 'Test Artist',
    duration: 200,
    currentTime: 10,
    isPlaying: true
  });

  if (!service.cachedActivity || service.cachedActivity.title !== 'Test Song') {
    throw new Error('Failed to cache activity when disabled');
  }

  service.setEnabled(true);
  if (!service.enabled) {
    throw new Error('setEnabled(true) failed');
  }

  // Test 4: Rapid track skips and pause transitions
  service.updateActivity({
    title: 'Track 1',
    artist: 'Artist 1',
    duration: 180,
    currentTime: 0,
    isPlaying: true
  });

  service.updateActivity({
    title: 'Track 2',
    artist: 'Artist 2',
    duration: 240,
    currentTime: 15,
    isPlaying: true
  });

  service.updateActivity({
    title: 'Track 2',
    artist: 'Artist 2',
    duration: 240,
    currentTime: 15,
    isPlaying: false // Paused
  });

  if (service.cachedActivity.isPlaying !== false) {
    throw new Error('Failed to capture paused playback state');
  }

  // Test 5: Idempotent cleanup
  service.cleanup();
  if (!service.isDestroyed || service.state !== 'DISCONNECTED') {
    throw new Error('cleanup failed');
  }
  // Multiple cleanups should not throw
  service.cleanup();

  console.log('DiscordPresenceService unit tests passed successfully!');
  process.exit(0);
}

testDiscordPresence().catch((err) => {
  console.error('DiscordPresence test failed:', err);
  process.exit(1);
});
