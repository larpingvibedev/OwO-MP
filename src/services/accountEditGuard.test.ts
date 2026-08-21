import { AccountEditGuard } from './accountEditGuard';

export function runAccountEditGuardFixture(): Record<string, unknown> {
  const guard = new AccountEditGuard();
  const aToken = guard.open({ userId: 'A', generation: 1 });
  const aBeforeSwitch = guard.isCurrent(aToken, { userId: 'A', generation: 1 });
  const aSaveForB = guard.isCurrent(aToken, { userId: 'B', generation: 2 });
  const aSaveAfterAba = guard.isCurrent(aToken, { userId: 'A', generation: 3 });
  guard.invalidate();
  const lateFileCallback = guard.isCurrent(aToken, { userId: 'A', generation: 1 });
  const bToken = guard.open({ userId: 'B', generation: 4 });
  const samePlaylistIdB = guard.isCurrent(bToken, { userId: 'B', generation: 4 });
  if (!aBeforeSwitch || aSaveForB || aSaveAfterAba || lateFileCallback || !samePlaylistIdB) {
    throw new Error('Account-owned edit generation failed');
  }
  return { aBeforeSwitch, aSaveForB, aSaveAfterAba, lateFileCallback, samePlaylistIdB };
}
