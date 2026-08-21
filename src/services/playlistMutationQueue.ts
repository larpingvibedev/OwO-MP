export class PlaylistMutationQueue {
  private tails = new Map<string, Promise<void>>();

  enqueue<T>(playlistId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(playlistId) || Promise.resolve();
    const run = previous.then(mutation, mutation);
    const settled = run.then(() => undefined, () => undefined);
    this.tails.set(playlistId, settled);

    return run.finally(() => {
      if (this.tails.get(playlistId) === settled) {
        this.tails.delete(playlistId);
      }
    });
  }

  pendingPlaylistCount(): number {
    return this.tails.size;
  }

  hasPending(playlistId: string): boolean {
    return this.tails.has(playlistId);
  }

  snapshotPendingPlaylistIds(): Set<string> {
    return new Set(this.tails.keys());
  }
}
