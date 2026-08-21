import { PlaylistMutationQueue } from './playlistMutationQueue';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runPlaylistMutationQueueOrderingTest(): Promise<string[]> {
  const queue = new PlaylistMutationQueue();
  const events: string[] = [];

  const oldSnapshot = queue.enqueue('playlist-a', async () => {
    events.push('old:start');
    await delay(35);
    events.push('old:finish');
  });
  const newSnapshot = queue.enqueue('playlist-a', async () => {
    events.push('new:start');
    await delay(1);
    events.push('new:finish');
  });
  const deleteMutation = queue.enqueue('playlist-a', async () => {
    events.push('delete:start');
    events.push('delete:finish');
  });
  const differentPlaylist = queue.enqueue('playlist-b', async () => {
    events.push('other:start');
    events.push('other:finish');
  });

  await Promise.all([oldSnapshot, newSnapshot, deleteMutation, differentPlaylist]);

  const playlistAEvents = events.filter(event => !event.startsWith('other:'));
  const expected = [
    'old:start',
    'old:finish',
    'new:start',
    'new:finish',
    'delete:start',
    'delete:finish'
  ];
  if (JSON.stringify(playlistAEvents) !== JSON.stringify(expected)) {
    throw new Error(`Playlist mutation order mismatch: ${playlistAEvents.join(', ')}`);
  }
  if (queue.pendingPlaylistCount() !== 0) {
    throw new Error('Playlist mutation queue did not clean its settled tails');
  }
  return events;
}
