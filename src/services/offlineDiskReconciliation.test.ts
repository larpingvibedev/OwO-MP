import type { OfflineRecord } from './downloadService';
import {
  isOfflineRecordPresentOnDisk,
  listConfiguredDiskAudioFiles,
  partitionOfflineRecordsByDisk,
  reconcileConfiguredOfflineRecords
} from './offlineDiskReconciliation';

export async function runOfflineDiskReconciliationFixtures(): Promise<Record<string, unknown>> {
  const customDir = 'D:\\OwO Custom';
  let listedTarget: string | undefined;
  const listed = await listConfiguredDiskAudioFiles(
    async () => customDir,
    async targetDir => {
      listedTarget = targetDir;
      return ['artist - title [abcdefghijk].mp3'];
    }
  );
  const record = {
    id: 'track',
    videoId: 'abcdefghijk',
    track: { id: 'track', title: 'Title', artist: 'Artist', duration: 1, cover: '', streamUrl: '' }
  } as OfflineRecord;
  const present = isOfflineRecordPresentOnDisk(record, listed.files);
  const missing = isOfflineRecordPresentOnDisk(record, []);
  const missingRecord = {
    ...record,
    id: 'missing-track',
    videoId: 'missing00001',
    track: { ...record.track, id: 'missing-track', title: 'Missing' }
  } as OfflineRecord;
  const partition = partitionOfflineRecordsByDisk([record, missingRecord], listed.files);
  const legacyFile = 'artist - title.mp3';
  const legacyRecordWithVideoIdKept = isOfflineRecordPresentOnDisk(record, [legacyFile]);
  const legacyCollisionRejected = isOfflineRecordPresentOnDisk(record, [
    legacyFile,
    'artist - title [different01].mp3'
  ]);
  const ambiguousLegacyPartition = partitionOfflineRecordsByDisk([record], [
    legacyFile,
    'artist - title [different01].mp3'
  ]);
  let listingFailurePreserved = false;
  try {
    await listConfiguredDiskAudioFiles(
      async () => customDir,
      async () => ({ success: false, stage: 'DISK_DIRECTORY_LIST_FAILED', error: 'access denied' })
    );
  } catch {
    listingFailurePreserved = true;
  }
  const emptySuccess = await listConfiguredDiskAudioFiles(
    async () => customDir,
    async () => ({ success: true, files: [] })
  );
  const emptyPartition = partitionOfflineRecordsByDisk([record], emptySuccess.files);
  const removedDuringFailure: string[] = [];
  try {
    await reconcileConfiguredOfflineRecords({
      records: [record],
      getConfiguredDirectory: async () => customDir,
      listFiles: async () => ({ success: false, stage: 'DISK_DIRECTORY_LIST_FAILED', error: 'disconnected' }),
      removeMissing: async item => { removedDuringFailure.push(item.id); }
    });
  } catch {}
  const removedDuringEmptySuccess: string[] = [];
  await reconcileConfiguredOfflineRecords({
    records: [record],
    getConfiguredDirectory: async () => customDir,
    listFiles: async () => ({ success: true, files: [] }),
    removeMissing: async item => { removedDuringEmptySuccess.push(item.id); }
  });
  if (listedTarget !== customDir || !present || missing ||
      partition.present[0]?.id !== record.id || partition.missing[0]?.id !== missingRecord.id ||
      !listingFailurePreserved || emptyPartition.missing[0]?.id !== record.id ||
      removedDuringFailure.length !== 0 || removedDuringEmptySuccess[0] !== record.id ||
      !legacyRecordWithVideoIdKept || legacyCollisionRejected ||
      ambiguousLegacyPartition.present[0]?.id !== record.id) {
    throw new Error(`Custom directory reconciliation failed: ${listedTarget}/${present}/${missing}`);
  }
  return {
    listedTarget,
    present,
    missing,
    keptIds: partition.present.map(item => item.id),
    removedIds: partition.missing.map(item => item.id),
    listingFailurePreserved,
    emptySuccessRemovedIds: emptyPartition.missing.map(item => item.id),
    removedDuringFailure,
    removedDuringEmptySuccess,
    legacyRecordWithVideoIdKept,
    legacyCollisionRejected,
    ambiguousLegacyBlobPreserved: ambiguousLegacyPartition.present[0]?.id === record.id
  };
}
