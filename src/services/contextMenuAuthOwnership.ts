import { useAuthStore } from '../store/useAuthStore';

export interface ContextMenuAuthOwner {
  userId: string | null;
  generation: number;
}

export class ContextMenuAuthOwnership {
  private userId: string | null;
  private generation = 0;

  constructor(initialUserId: string | null = null) {
    this.userId = initialUserId;
  }

  transition(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation++;
  }

  capture(): ContextMenuAuthOwner {
    return { userId: this.userId, generation: this.generation };
  }

  isCurrent(owner: ContextMenuAuthOwner | null | undefined): boolean {
    return Boolean(owner) && owner!.userId === this.userId && owner!.generation === this.generation;
  }
}

const ownership = new ContextMenuAuthOwnership(useAuthStore.getState().user?.id || null);
useAuthStore.subscribe(state => ownership.transition(state.user?.id || null));

export const captureContextMenuAuthOwner = () => ownership.capture();
export const isContextMenuAuthOwnerCurrent = (owner: ContextMenuAuthOwner | null | undefined) =>
  ownership.isCurrent(owner);
