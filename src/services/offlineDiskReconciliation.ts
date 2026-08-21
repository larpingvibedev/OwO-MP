import type { OfflineRecord } from './downloadService';

export type DiskAudioFileListing = string[] | {
  success: boolean;
  files?: string[];
  error?: string;
  stage?: string;
  targetDir?: string;
};

export class DiskAudioListingError extends Error {
  stage: string;
  targetDir?: string;

  constructor(message: string, stage = 'DISK_DIRECTORY_LIST_FAILED', targetDir?: string) {
    super(message);
    this.name = 'DiskAudioListingError';
    this.stage = stage;
    this.targetDir = targetDir;
  }
}

export async function listConfiguredDiskAudioFiles(
  getConfiguredDirectory: () => Promise<string | null>,
  listFiles: (targetDir?: string) => Promise<DiskAudioFileListing>
): Promise<{ targetDir: string | null; files: string[] }> {
  const targetDir = await getConfiguredDirectory();
  const result = await listFiles(targetDir || undefined);
  // Older preload builds returned a bare string array. A non-empty legacy
  // result is still usable, but bare [] is ambiguous (empty directory vs an
  // old swallowed readdir failure) and therefore must fail safe.
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new DiskAudioListingError(
        'Legacy disk listing returned an ambiguous empty result',
        'DISK_DIRECTORY_LIST_AMBIGUOUS',
        targetDir || undefined
      );
    }
    return { targetDir, files: result };
  }
  if (!result?.success) {
    throw new DiskAudioListingError(
      result?.error || 'Could not list the configured audio directory',
      result?.stage,
      result?.targetDir || targetDir || undefined
    );
  }
  if (!Array.isArray(result.files)) {
    throw new DiskAudioListingError('Disk listing returned an invalid file list', 'DISK_DIRECTORY_LIST_INVALID', targetDir || undefined);
  }
  return { targetDir, files: result.files };
}

export type OfflineDiskPresence = 'exact' | 'legacy' | 'ambiguous-legacy' | 'missing';

export function getOfflineRecordDiskPresence(record: OfflineRecord, diskFiles: string[]): OfflineDiskPresence {
  const cleanArtist = (record.track?.artist || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
  const cleanTitle = (record.track?.title || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
  const stableVideoId = String(record.videoId || '').toLowerCase();
  const names = new Set(diskFiles.map(file => file.toLowerCase()));
  if (stableVideoId) {
    const stem = `${cleanArtist} - ${cleanTitle} [${stableVideoId}]`;
    if (['mp3', 'm4a', 'webm'].some(ext => names.has(`${stem}.${ext}`))) return 'exact';
    const legacyStem = `${cleanArtist} - ${cleanTitle}`;
    const exactLegacyExists = ['mp3', 'm4a', 'webm'].some(ext => names.has(`${legacyStem}.${ext}`));
    if (!exactLegacyExists) return 'missing';
    // An unsuffixed pre-upgrade file is safe only while no suffixed sibling
    // claims the same artist/title. Never guess that a legacy file belongs to
    // this record when a newer exact-ID sibling demonstrates a collision.
    const suffixedPrefix = `${legacyStem} [`;
    const hasOwnedSibling = Array.from(names).some(name =>
      name.startsWith(suffixedPrefix) && /\.(?:mp3|m4a|webm)$/i.test(name)
    );
    return hasOwnedSibling ? 'ambiguous-legacy' : 'legacy';
  }
  const stem = `${cleanArtist} - ${cleanTitle}`;
  return ['mp3', 'm4a', 'webm'].some(ext => names.has(`${stem}.${ext}`)) ? 'legacy' : 'missing';
}

export function isOfflineRecordPresentOnDisk(record: OfflineRecord, diskFiles: string[]): boolean {
  const presence = getOfflineRecordDiskPresence(record, diskFiles);
  return presence === 'exact' || presence === 'legacy';
}

export function partitionOfflineRecordsByDisk(
  records: OfflineRecord[],
  diskFiles: string[]
): { present: OfflineRecord[]; missing: OfflineRecord[] } {
  const present: OfflineRecord[] = [];
  const missing: OfflineRecord[] = [];
  records.forEach(record => {
    const presence = getOfflineRecordDiskPresence(record, diskFiles);
    // Ambiguous legacy ownership is not attributed to this video, but the
    // IndexedDB blob is preserved because disk absence is not proven.
    (presence === 'missing' ? missing : present).push(record);
  });
  return { present, missing };
}

export async function reconcileConfiguredOfflineRecords(options: {
  records: OfflineRecord[];
  getConfiguredDirectory: () => Promise<string | null>;
  listFiles: (targetDir?: string) => Promise<DiskAudioFileListing>;
  removeMissing: (record: OfflineRecord) => Promise<void>;
}): Promise<{ targetDir: string | null; present: OfflineRecord[]; missing: OfflineRecord[] }> {
  // Listing must complete successfully before any destructive callback runs.
  const listing = await listConfiguredDiskAudioFiles(
    options.getConfiguredDirectory,
    options.listFiles
  );
  const partition = partitionOfflineRecordsByDisk(options.records, listing.files);
  for (const missingRecord of partition.missing) await options.removeMissing(missingRecord);
  return { targetDir: listing.targetDir, ...partition };
}
