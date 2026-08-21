'use strict';

function deriveDirectStreamIdentity(audioInfo, totalLength) {
  try {
    const url = new URL(audioInfo?.url || '');
    const client = String(audioInfo?.clientName || url.searchParams.get('c') || '').trim().toLowerCase();
    const itag = String(url.searchParams.get('itag') || audioInfo?.itag || '').trim();
    const streamId = String(url.searchParams.get('id') || audioInfo?.streamId || '').trim();
    const mimeValue = String(url.searchParams.get('mime') || audioInfo?.mimeType || '').trim().toLowerCase();
    const codecFromMime = /codecs?\s*=\s*["']?([^;"']+)/i.exec(mimeValue)?.[1]?.trim() || '';
    const codec = String(url.searchParams.get('codecs') || audioInfo?.codec || codecFromMime).trim().toLowerCase();
    const total = Number(totalLength || url.searchParams.get('clen') || audioInfo?.totalSize || 0);
    const placeholders = new Set(['', 'unknown', 'n-a', 'n/a', 'na', 'none', 'null', 'undefined', '0']);
    const mimeMatch = /^audio\/([a-z0-9.+-]+)(?:\s*;|$)/i.exec(mimeValue);
    const mimeSubtype = mimeMatch?.[1]?.toLowerCase() || '';
    if (placeholders.has(client) || placeholders.has(itag.toLowerCase()) ||
        placeholders.has(streamId.toLowerCase()) || placeholders.has(mimeValue) ||
        placeholders.has(codec) || !/^\d+$/.test(itag) || Number(itag) <= 0 ||
        !mimeMatch || placeholders.has(mimeSubtype) ||
        !Number.isSafeInteger(total) || total <= 0) {
      return null;
    }
    return JSON.stringify([client, itag, streamId, mimeValue, codec, total]);
  } catch {
    return null;
  }
}

function decideDirectStreamRefresh(currentIdentity, refreshedIdentity, downloadedBytes, restartCount) {
  if (!downloadedBytes || !currentIdentity || refreshedIdentity === currentIdentity) return 'continue';
  return refreshedIdentity && restartCount < 1 ? 'restart' : 'fail';
}

module.exports = { deriveDirectStreamIdentity, decideDirectStreamRefresh };
