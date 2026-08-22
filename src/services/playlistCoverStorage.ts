import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'owo_playlist_media';
const DB_VERSION = 1;
const STORE_COVERS = 'playlist_covers';

export interface StoredPlaylistCoverV1 {
  version: 1;
  buffer: ArrayBuffer;
  type: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_COVERS)) {
          db.createObjectStore(STORE_COVERS);
        }
      }
    });
  }
  return dbPromise;
}

function isBlobLike(val: any): val is Blob {
  if (!val) return false;
  if (typeof Blob !== 'undefined' && val instanceof Blob) return true;
  return (
    typeof val === 'object' &&
    typeof val.size === 'number' &&
    typeof val.type === 'string' &&
    (typeof val.slice === 'function' || typeof val.arrayBuffer === 'function')
  );
}

/**
 * Saves a playlist cover image into IndexedDB as a versioned ArrayBuffer record.
 */
export async function savePlaylistCover(coverId: string, blob: Blob): Promise<string> {
  if (!coverId) throw new Error('coverId is required to save playlist cover');
  try {
    const db = await getDB();
    const arrayBuf = await blob.arrayBuffer();
    const record: StoredPlaylistCoverV1 = {
      version: 1,
      buffer: arrayBuf,
      type: blob.type || 'image/webp'
    };
    await db.put(STORE_COVERS, record, coverId);
    console.info(`[PlaylistCoverStorage] Successfully saved cover "${coverId}" (${record.type}, ${record.buffer.byteLength} bytes)`);
    return coverId;
  } catch (err) {
    console.error(`[PlaylistCoverStorage] Failed to save playlist cover "${coverId}":`, err);
    throw err;
  }
}

/**
 * Retrieves a playlist cover Blob from IndexedDB.
 * Handles v1 ArrayBuffer records, raw ArrayBuffers, and legacy Blobs with auto-migration.
 */
export async function getPlaylistCover(coverId: string): Promise<Blob | null> {
  if (!coverId) return null;
  try {
    const db = await getDB();
    const stored = await db.get(STORE_COVERS, coverId);
    if (!stored) {
      console.warn(`[PlaylistCoverStorage] No cover record found for "${coverId}"`);
      return null;
    }

    // 1. Version 1 ArrayBuffer Record
    if (typeof stored === 'object' && stored !== null && stored.version === 1) {
      const { buffer, type } = stored as StoredPlaylistCoverV1;
      const isBufferValid = buffer instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(buffer));
      const byteLength = buffer ? (buffer.byteLength ?? (buffer as any).length ?? 0) : 0;
      if (isBufferValid && byteLength > 0 && typeof type === 'string' && type.length > 0) {
        return new Blob([buffer], { type });
      }
      console.warn(`[PlaylistCoverStorage] Malformed v1 cover record for "${coverId}":`, stored);
      return null;
    }

    // 2. Raw ArrayBuffer fallback
    if (stored instanceof ArrayBuffer && stored.byteLength > 0) {
      const v1Record: StoredPlaylistCoverV1 = {
        version: 1,
        buffer: stored,
        type: 'image/webp'
      };
      void db.put(STORE_COVERS, v1Record, coverId);
      console.info(`[PlaylistCoverStorage] Migrated raw ArrayBuffer to v1 record for "${coverId}"`);
      return new Blob([stored], { type: 'image/webp' });
    }

    // 3. Legacy Blob / Blob-like object migration
    if (isBlobLike(stored)) {
      try {
        const buffer = await stored.arrayBuffer();
        if (buffer && buffer.byteLength > 0) {
          const v1Record: StoredPlaylistCoverV1 = {
            version: 1,
            buffer,
            type: stored.type || 'image/webp'
          };
          // Self-heal / rewrite to v1 record
          void db.put(STORE_COVERS, v1Record, coverId);
          console.info(`[PlaylistCoverStorage] Migrated legacy blob to v1 record for "${coverId}" (${v1Record.buffer.byteLength} bytes)`);
          return new Blob([buffer], { type: v1Record.type });
        }
      } catch (migrationErr) {
        console.warn(`[PlaylistCoverStorage] Failed to read legacy blob buffer for "${coverId}":`, migrationErr);
        return stored;
      }
    }

    console.warn(`[PlaylistCoverStorage] Unrecognized or invalid cover record format for "${coverId}":`, stored);
    return null;
  } catch (err) {
    console.warn(`[PlaylistCoverStorage] Failed to retrieve playlist cover for "${coverId}":`, err);
    return null;
  }
}

/**
 * Deletes an unreferenced playlist cover from IndexedDB to avoid storage leaks.
 */
export async function deletePlaylistCover(coverId: string): Promise<void> {
  if (!coverId) return;
  try {
    const db = await getDB();
    await db.delete(STORE_COVERS, coverId);
    console.info(`[PlaylistCoverStorage] Deleted cover record "${coverId}"`);
  } catch (err) {
    console.warn(`[PlaylistCoverStorage] Failed to delete playlist cover for "${coverId}":`, err);
  }
}
