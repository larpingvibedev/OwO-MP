import { AlbumEditGeneration } from './albumEditGeneration';

export function runAlbumEditGenerationFixture(): { uploadCurrent: boolean; manualCurrent: boolean } {
  const guard = new AlbumEditGeneration();
  const upload = guard.advance();
  const manual = guard.advance();
  const uploadCurrent = guard.isCurrent(upload);
  const manualCurrent = guard.isCurrent(manual);
  if (uploadCurrent || !manualCurrent) throw new Error('Pending upload was not invalidated by manual cover choice');
  return { uploadCurrent, manualCurrent };
}
