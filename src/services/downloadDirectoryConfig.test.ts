import { resolveConfiguredDownloadDirectory } from './downloadService';
import { reconcileConfiguredOfflineRecords } from './offlineDiskReconciliation';

export async function runDownloadDirectoryConfigFixture(): Promise<Record<string, unknown>> {
  let defaultCalls = 0;
  const unset = await resolveConfiguredDownloadDirectory(undefined, async () => {
    defaultCalls++;
    return 'C:\\Default Music';
  });
  const configured = await resolveConfiguredDownloadDirectory('D:\\Custom', async () => {
    throw new Error('default should not run');
  });
  let listCalls = 0;
  let removals = 0;
  try {
    await reconcileConfiguredOfflineRecords({
      records: [],
      getConfiguredDirectory: async () => { throw new Error('config read failed'); },
      listFiles: async () => { listCalls++; return { success: true, files: [] }; },
      removeMissing: async () => { removals++; }
    });
  } catch {}
  if (unset.configured || unset.value !== 'C:\\Default Music' || defaultCalls !== 1 ||
      !configured.configured || configured.value !== 'D:\\Custom' || listCalls !== 0 || removals !== 0) {
    throw new Error('Strict download directory config handling failed');
  }
  return { unset, configured, defaultCalls, listCalls, removals };
}
