export interface PlaylistEditSnapshot {
  id: string;
  name: string;
  description: string;
  cover: string;
}

export function createPlaylistEditSnapshot(playlist: {
  id: string;
  name: string;
  description?: string;
  cover?: string;
}): PlaylistEditSnapshot {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description || '',
    cover: playlist.cover || ''
  };
}
