import { openDB, type IDBPDatabase } from 'idb';
import type { Track } from '../types';
import { resolveYouTubeVideoId } from './musicSearch';

const DB_NAME = 'owo_offline_db';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_CONFIG = 'config';

export interface OfflineRecord {
  id: string;
  track: Track;
  audioBlob: Blob;
  downloadedAt: number;
  size: number;
  mimeType: string;
  videoId?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const activeBlobUrls = new Map<string, string>();
let customDirectoryHandle: any = null;

/**
 * Initializes and returns the IndexedDB database instance.
 */
export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_TRACKS)) {
          const store = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
          store.createIndex('downloadedAt', 'downloadedAt');
          store.createIndex('artist', 'track.artist');
          store.createIndex('album', 'track.album');
        }
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG);
        }
      }
    });
  }
  return dbPromise;
}

function cleanFileName(str: string): string {
  return str.replace(/[\\/:*?"<>|]/g, '').trim();
}

function getExactTrackVideoId(track?: Track): string | undefined {
  if (!track) return undefined;
  const prefixed = /^(?:piped-|yt-|youtube-)([a-zA-Z0-9_-]{11})$/.exec(track.id || '');
  if (prefixed) return prefixed[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(track.id || '')) return track.id;
  try {
    const url = new URL(track.streamUrl || '');
    const candidate = url.hostname === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v');
    return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function appendDiskVideoId(fileName: string, videoId?: string): string {
  if (!videoId || !/^[a-zA-Z0-9_-]{6,64}$/.test(videoId)) return fileName;
  const dot = fileName.lastIndexOf('.');
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot >= 0 ? fileName.slice(dot) : '';
  return `${stem} [${videoId}]${extension}`;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getProxyPort: () => Promise<number>;
      getDefaultMusicDir: () => Promise<string>;
      getDefaultDownloadDir?: () => Promise<string>;
      saveAudioToDisk: (filename: string, buffer: ArrayBuffer, targetDir?: string, videoId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      openFolder: (folderPath?: string) => Promise<void>;
      selectDirectory: () => Promise<string | null>;
      showItemInFolder: (fullPath: string) => Promise<void>;
      openYoutubeSignIn: () => Promise<boolean>;
      signOutYoutube: () => Promise<boolean>;
      getYoutubeAuthState: () => Promise<'signed_in' | 'signed_out'>;
    };
  }
}

/**
 * Resolves direct high-quality audio stream for a track.
 */
export async function resolveDirectAudioStream(track: Track): Promise<{ url: string; mimeType: string; size?: number; videoId: string } | null> {
  let videoId: string | null = null;

  // 1. Check if track already has direct youtube video ID
  if (track.id.startsWith('piped-') || track.id.startsWith('yt-')) {
    videoId = track.id.replace(/^(piped-|yt-)/, '');
  } else if (track.streamUrl && /^[a-zA-Z0-9_-]{11}$/.test(track.streamUrl)) {
    videoId = track.streamUrl;
  } else if (/^[a-zA-Z0-9_-]{11}$/.test(track.id)) {
    videoId = track.id;
  }

  // 2. Resolve via InnerTube ATV / topic search if needed
  if (!videoId) {
    videoId = await resolveYouTubeVideoId(track.artist, track.title, track.albumArtist, track.duration);
  }

  if (!videoId) {
    throw new Error(`Could not resolve audio stream for "${track.artist} - ${track.title}"`);
  }

  // If running inside Electron, stream via internal background proxy port
  let baseUrl = '';
  if (window.electronAPI?.isElectron) {
    try {
      const port = await window.electronAPI.getProxyPort();
      if (port) baseUrl = `http://127.0.0.1:${port}`;
    } catch (e) {}
  }

  // Point to our local high-performance server stream proxy
  return {
    url: `${baseUrl}/api/download-stream?videoId=${encodeURIComponent(videoId)}`,
    mimeType: 'audio/mp4',
    videoId
  };
}

/**
 * Downloads a single track to IndexedDB for seamless 100% offline playback.
 */
export async function downloadTrackOffline(
  track: Track,
  onProgress?: (percent: number) => void
): Promise<OfflineRecord> {
  const db = await getDB();
  const formatSetting = ((await db.get(STORE_CONFIG, 'download_format')) as 'mp3' | 'm4a') || 'mp3';

  // 1. If running inside Electron, use Native IPC Direct Downloader (rock-solid, zero proxy pipe abortion)
  if ((window as any).electronAPI?.downloadTrackNative) {
    const streamInfo = await resolveDirectAudioStream(track);
    const videoId = streamInfo?.videoId || track.id;
    const targetDir = await db.get(STORE_CONFIG, 'custom_directory_name');

    let removeListener: (() => void) | null = null;
    let maxSeenProgress = 5;
    if (onProgress && (window as any).electronAPI.onDownloadProgress) {
      removeListener = (window as any).electronAPI.onDownloadProgress((data: any) => {
        if (data && (data.videoId === videoId || data.videoId === track.id)) {
          const rawPct = Number.isFinite(data.percent) ? data.percent : 0;
          maxSeenProgress = Math.max(maxSeenProgress, Math.min(100, rawPct));
          onProgress(maxSeenProgress);
        }
      });
    }

    try {
      if (onProgress) onProgress(5);
      const res = await (window as any).electronAPI.downloadTrackNative({
        videoId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover: track.cover,
        format: formatSetting,
        targetDir: targetDir || undefined
      });

      if (!res || !res.success) {
        const nativeMessage = res?.error || 'Native download failed';
        const message = res?.stage && !nativeMessage.startsWith(`[${res.stage}]`)
          ? `[${res.stage}] ${nativeMessage}`
          : nativeMessage;
        const nativeError = new Error(message);
        (nativeError as Error & { stage?: string; diagnostics?: unknown }).stage = res?.stage;
        (nativeError as Error & { stage?: string; diagnostics?: unknown }).diagnostics = res?.diagnostics;
        throw nativeError;
      }

      const bufferData = res.buffer ? (res.buffer instanceof ArrayBuffer ? res.buffer : res.buffer.buffer || res.buffer) : new ArrayBuffer(0);
      const blob = new Blob([bufferData], { type: res.mimeType || (formatSetting === 'm4a' ? 'audio/mp4' : 'audio/mpeg') });
      const record: OfflineRecord = {
        id: track.id,
        track: {
          ...track,
          source: 'demo' // Local offline direct playback
        },
        audioBlob: blob,
        downloadedAt: Date.now(),
        size: res.size || blob.size,
        mimeType: blob.type,
        videoId
      };

      await db.put(STORE_TRACKS, record);
      if (onProgress) onProgress(100);
      return record;
    } finally {
      if (removeListener) removeListener();
    }
  }

  // 2. Web Fallback (Browser fetch)
  const streamInfo = await resolveDirectAudioStream(track);
  if (!streamInfo || !streamInfo.url) {
    throw new Error(`Direct audio stream not available for "${track.title}"`);
  }

  const response = await fetch(streamInfo.url);
  if (!response.ok) {
    throw new Error(`Failed to download audio content (status ${response.status})`);
  }

  const blob = await response.blob();
  if (onProgress) onProgress(100);

  const record: OfflineRecord = {
    id: track.id,
    track: {
      ...track,
      source: 'demo'
    },
    audioBlob: blob,
    downloadedAt: Date.now(),
    size: blob.size,
    mimeType: blob.type || streamInfo.mimeType,
    videoId: streamInfo.videoId
  };

  await db.put(STORE_TRACKS, record);
  return record;
}

/**
 * Retrieves the local Blob URL for offline playback.
 */
export async function getOfflineTrackBlobUrl(trackId: string): Promise<string | null> {
  if (activeBlobUrls.has(trackId)) {
    return activeBlobUrls.get(trackId)!;
  }

  const db = await getDB();
  const record = await db.get(STORE_TRACKS, trackId) as OfflineRecord | undefined;
  if (!record || !record.audioBlob) {
    return null;
  }

  const url = URL.createObjectURL(record.audioBlob);
  activeBlobUrls.set(trackId, url);
  return url;
}

/**
 * Prompts the user to select a custom folder on their PC for music downloads.
 */
export async function promptChooseCustomDirectory(): Promise<string | null> {
  // If running inside Electron, use native Windows folder picker dialog
  if (window.electronAPI?.isElectron && window.electronAPI.selectDirectory) {
    try {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        const db = await getDB();
        await db.put(STORE_CONFIG, selected, 'custom_directory_name');
        return selected;
      }
      return null;
    } catch (e) {
      console.warn('Native selectDirectory failed:', e);
    }
  }

  if (!('showDirectoryPicker' in window)) {
    return null;
  }
  try {
    // @ts-ignore
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'music'
    });
    customDirectoryHandle = dirHandle;
    const db = await getDB();
    await db.put(STORE_CONFIG, dirHandle.name, 'custom_directory_name');
    return dirHandle.name;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.warn('Directory selection cancelled or failed:', err);
    }
    return null;
  }
}

/**
 * Gets the custom directory name if configured.
 */
export interface ConfiguredDownloadDirectory {
  configured: boolean;
  value: string | null;
}

export async function resolveConfiguredDownloadDirectory(
  configuredValue: unknown,
  getDefaultDirectory: () => Promise<string | null>
): Promise<ConfiguredDownloadDirectory> {
  if (typeof configuredValue === 'string' && configuredValue.trim()) {
    return { configured: true, value: configuredValue };
  }
  return { configured: false, value: await getDefaultDirectory() };
}

export async function getConfiguredDownloadDirectory(): Promise<ConfiguredDownloadDirectory> {
  if (customDirectoryHandle) {
    return { configured: true, value: customDirectoryHandle.name };
  }
  const db = await getDB();
  // Do not catch this read: a failed IndexedDB/config read is not equivalent
  // to an unset directory and must abort disk reconciliation.
  const name = await db.get(STORE_CONFIG, 'custom_directory_name');
  return resolveConfiguredDownloadDirectory(name, async () => {
    if (window.electronAPI?.isElectron) {
      if (window.electronAPI.getDefaultDownloadDir) {
        return await window.electronAPI.getDefaultDownloadDir();
      }
      if (window.electronAPI.getDefaultMusicDir) {
        return await window.electronAPI.getDefaultMusicDir();
      }
    }
    return null;
  });
}

export async function getCustomDirectoryName(): Promise<string | null> {
  return (await getConfiguredDownloadDirectory()).value;
}

/**
 * Clears custom directory setting.
 */
export async function clearCustomDirectory(): Promise<void> {
  customDirectoryHandle = null;
  const db = await getDB();
  await db.delete(STORE_CONFIG, 'custom_directory_name');
}

/**
 * Saves a track directly to the user's hard drive as an audio file (.m4a / .mp3).
 * Uses custom directory handle if chosen, or triggers browser file download.
 */
export async function exportTrackToDisk(track: Track, existingBlob?: Blob): Promise<{ success: boolean; path: string }> {
  let blob = existingBlob;
  let storedRecord: OfflineRecord | undefined;
  if (!blob) {
    const db = await getDB();
    storedRecord = await db.get(STORE_TRACKS, track.id) as OfflineRecord | undefined;
    if (storedRecord?.audioBlob) {
      blob = storedRecord.audioBlob;
    } else {
      const downloaded = await downloadTrackOffline(track);
      blob = downloaded.audioBlob;
      storedRecord = downloaded;
    }
  }

  const formatSetting = (await (await getDB()).get(STORE_CONFIG, 'download_format')) || 'mp3';
  const cleanArtist = cleanFileName(track.artist || 'Unknown Artist');
  const cleanTitle = cleanFileName(track.title || 'Unknown Track');
  const ext = formatSetting === 'm4a' ? 'm4a' : 'mp3';
  let videoId = storedRecord?.videoId || getExactTrackVideoId(track);
  if (!videoId) {
    try { videoId = (await resolveDirectAudioStream(track))?.videoId; } catch {}
  }
  const fileName = appendDiskVideoId(`${cleanArtist} - ${cleanTitle}.${ext}`, videoId);

  // 0. If running inside Electron, use native disk saving directly into chosen folder
  if (window.electronAPI?.isElectron) {
    try {
      const db = await getDB();
      const targetDir = await db.get(STORE_CONFIG, 'custom_directory_name');
      const buffer = await blob.arrayBuffer();
      const res = await window.electronAPI.saveAudioToDisk(fileName, buffer, targetDir || undefined, videoId);
      if (res.success) {
        return { success: true, path: res.filePath || fileName };
      }
    } catch (e) {
      console.warn('Failed writing via Electron API:', e);
    }
  }

  // 1. If user selected a custom directory via File System Access API
  if (customDirectoryHandle) {
    try {
      // @ts-ignore
      const fileHandle = await customDirectoryHandle.getFileHandle(fileName, { create: true });
      // @ts-ignore
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { success: true, path: `${customDirectoryHandle.name}/${fileName}` };
    } catch (e) {
      console.warn('Failed writing to directory handle, falling back to download:', e);
    }
  }

  // 2. Standard browser download trigger (saved to Downloads folder)
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

  return { success: true, path: `Downloads/${fileName}` };
}

/**
 * Checks if a track is downloaded offline.
 */
export async function isTrackDownloaded(trackId: string): Promise<boolean> {
  const db = await getDB();
  const count = await db.count(STORE_TRACKS, trackId);
  return count > 0;
}

/**
 * Returns all downloaded offline records.
 */
export async function getAllOfflineRecords(): Promise<OfflineRecord[]> {
  const db = await getDB();
  const records = await db.getAll(STORE_TRACKS) as OfflineRecord[];
  return records.sort((a, b) => b.downloadedAt - a.downloadedAt);
}

/**
 * Deletes a downloaded track from offline storage and disk.
 */
export async function removeOfflineTrack(trackId: string, trackInfo?: { title?: string; artist?: string }): Promise<void> {
  if (activeBlobUrls.has(trackId)) {
    URL.revokeObjectURL(activeBlobUrls.get(trackId)!);
    activeBlobUrls.delete(trackId);
  }

  const db = await getDB();
  const record = (await db.get(STORE_TRACKS, trackId)) as OfflineRecord | undefined;
  await db.delete(STORE_TRACKS, trackId);

  // If running in Electron, also delete the audio file from the disk music folder
  if ((window as any).electronAPI?.deleteAudioFromDisk) {
    try {
      const targetDir = await db.get(STORE_CONFIG, 'custom_directory_name');
      const title = trackInfo?.title || record?.track?.title;
      const artist = trackInfo?.artist || record?.track?.artist;
      const videoId = record?.videoId || getExactTrackVideoId(record?.track);
      if (title) {
        await (window as any).electronAPI.deleteAudioFromDisk({
          title,
          artist,
          videoId,
          legacyFallback: !record?.videoId,
          targetDir: targetDir || undefined
        });
      }
    } catch (e) {}
  }
}

/**
 * Clears all downloaded offline music from IndexedDB and disk storage.
 */
export async function clearAllOfflineStorage(): Promise<void> {
  const records = await getAllOfflineRecords();

  for (const url of activeBlobUrls.values()) {
    URL.revokeObjectURL(url);
  }
  activeBlobUrls.clear();

  const db = await getDB();
  await db.clear(STORE_TRACKS);

  // If running in Electron, also delete the audio files from the disk music folder
  if ((window as any).electronAPI?.deleteAudioFromDisk) {
    try {
      const targetDir = await db.get(STORE_CONFIG, 'custom_directory_name');
      for (const r of records) {
        const title = r.track?.title;
        const artist = r.track?.artist;
        const videoId = r.videoId || getExactTrackVideoId(r.track);
        if (title) {
          await (window as any).electronAPI.deleteAudioFromDisk({
            title,
            artist,
            videoId,
            legacyFallback: !r.videoId,
            targetDir: targetDir || undefined
          });
        }
      }
    } catch (e) {
      console.warn('Failed to clear disk audio files:', e);
    }
  }
}

/**
 * Calculates total storage used by offline downloads in bytes.
 */
export async function getOfflineStorageUsage(): Promise<{ totalBytes: number; count: number }> {
  const records = await getAllOfflineRecords();
  const totalBytes = records.reduce((acc, r) => acc + (r.size || r.audioBlob?.size || 0), 0);
  return { totalBytes, count: records.length };
}

/**
 * Gets the user's preferred offline export format ('mp3' or 'm4a').
 */
export async function getPreferredDownloadFormat(): Promise<'mp3' | 'm4a'> {
  try {
    const db = await getDB();
    const fmt = await db.get(STORE_CONFIG, 'download_format');
    return fmt === 'm4a' ? 'm4a' : 'mp3';
  } catch {
    return 'mp3';
  }
}

/**
 * Saves the user's preferred offline export format ('mp3' or 'm4a').
 */
export async function setPreferredDownloadFormat(fmt: 'mp3' | 'm4a'): Promise<void> {
  const db = await getDB();
  await db.put(STORE_CONFIG, fmt, 'download_format');
}
