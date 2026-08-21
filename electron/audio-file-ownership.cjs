'use strict';

const path = require('path');

function sanitizeStableVideoId(videoId) {
  const value = String(videoId || '').trim();
  return /^[a-zA-Z0-9_-]{6,64}$/.test(value) ? value : '';
}

function appendVideoIdSuffix(fileName, videoId) {
  const stableId = sanitizeStableVideoId(videoId);
  if (!stableId) return fileName;
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  if (stem.endsWith(` [${stableId}]`)) return fileName;
  return `${stem} [${stableId}]${extension}`;
}

function getAudioFileNames(base, videoId) {
  const stableId = sanitizeStableVideoId(videoId);
  return ['mp3', 'm4a', 'webm'].map(ext => stableId ? `${base} [${stableId}].${ext}` : `${base}.${ext}`);
}

function hasAudioFile(existingNames, base, videoId, allowLegacy = false) {
  const normalized = new Set(existingNames.map(name => String(name).toLowerCase()));
  if (getAudioFileNames(base, videoId).some(name => normalized.has(name.toLowerCase()))) return true;
  return Boolean(allowLegacy && sanitizeStableVideoId(videoId)) &&
    getAudioFileNames(base, '').some(name => normalized.has(name.toLowerCase()));
}

function shouldDeleteLegacyAudio(existingNames, base) {
  const ownedPrefix = `${String(base).toLowerCase()} [`;
  return !existingNames.some(name => {
    const normalized = String(name).toLowerCase();
    return normalized.startsWith(ownedPrefix) && /\.(?:mp3|m4a|webm)$/i.test(normalized);
  });
}

module.exports = {
  sanitizeStableVideoId,
  appendVideoIdSuffix,
  getAudioFileNames,
  hasAudioFile,
  shouldDeleteLegacyAudio
};
