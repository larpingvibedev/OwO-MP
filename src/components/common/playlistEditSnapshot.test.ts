import { createPlaylistEditSnapshot } from './playlistEditSnapshot';
import type { Playlist } from '../../types';

export function runPlaylistEditSnapshotFixture() {
  const playlist = {
    id: 'pl-edit-target',
    name: 'Before',
    description: 'Description',
    cover: 'cover-a',
    tracks: [],
    createdAt: 1
  } as Playlist;
  const snapshot = createPlaylistEditSnapshot(playlist);

  // Mirrors closeContextMenu clearing its store payload: the modal-owned copy
  // must remain stable and continue to target the original ID.
  let contextPayload: Playlist | null = playlist;
  contextPayload = null;
  playlist.name = 'Mutated elsewhere';
  if (contextPayload !== null || snapshot.id !== 'pl-edit-target' || snapshot.name !== 'Before') {
    throw new Error('Playlist edit snapshot did not survive context-menu close');
  }
  return snapshot;
}
