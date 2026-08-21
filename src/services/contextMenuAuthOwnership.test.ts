import { ContextMenuAuthOwnership } from './contextMenuAuthOwnership';

export function runContextMenuAuthOwnershipFixture(): Record<string, unknown> {
  const ownership = new ContextMenuAuthOwnership('A');
  const aPayload = ownership.capture();
  ownership.transition('B');
  const staleARejected = !ownership.isCurrent(aPayload);
  const bPayload = ownership.capture();
  const bAccepted = ownership.isCurrent(bPayload);
  ownership.transition(null);
  ownership.transition('B');
  const staleSameUserGenerationRejected = !ownership.isCurrent(bPayload);
  if (!staleARejected || !bAccepted || !staleSameUserGenerationRejected) {
    throw new Error('Context menu auth ownership generation failed');
  }
  return { staleARejected, bAccepted, staleSameUserGenerationRejected };
}
