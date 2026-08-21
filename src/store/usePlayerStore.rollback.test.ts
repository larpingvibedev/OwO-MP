import type { Playlist, SavedAlbum, Track } from '../types';
import { supabaseSync } from '../services/supabaseSyncService';
import { useAuthStore } from './useAuthStore';
import { usePlayerStore } from './usePlayerStore';

const track: Track = { id: 'F', title: 'Favorite', artist: 'Artist', duration: 1, cover: '', streamUrl: '' };
const playlist: Playlist = { id: 'P', name: 'Before', tracks: [], createdAt: 1 };
const albumForPlaylist = (name: string): SavedAlbum => ({
  id: 'album-P', name, artist: 'Artist', cover: '', savedAt: 1
});
const authUser = (id: string) => ({ id } as any);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

export async function runOptimisticDeleteStoreFixture(): Promise<Record<string, unknown>> {
  const originalState = usePlayerStore.getState();
  const originalAuth = useAuthStore.getState();
  const originalPlaylistDelete = supabaseSync.syncPlaylistDelete.bind(supabaseSync);
  const originalFavoriteUp = supabaseSync.syncFavoriteUp.bind(supabaseSync);
  const originalPlaylistUp = supabaseSync.syncPlaylistUp.bind(supabaseSync);
  try {
    useAuthStore.setState({ user: authUser('A') });
    (supabaseSync as any).syncPlaylistDelete = async () => ({ success: false, error: 'resolved error' });
    (supabaseSync as any).syncFavoriteUp = async () => ({ success: false, error: 'resolved error' });
    (supabaseSync as any).syncPlaylistUp = async () => ({ success: true });
    usePlayerStore.setState({ playlists: [playlist], favorites: [track], savedAlbums: [] });
    usePlayerStore.getState().deletePlaylist('P');
    usePlayerStore.getState().toggleFavorite(track);
    await flush();
    if (usePlayerStore.getState().playlists[0]?.name !== 'Before' ||
        usePlayerStore.getState().favorites[0]?.id !== 'F') {
      throw new Error('Resolved delete error did not restore affected optimistic entities');
    }

    let resolveDelete!: (result: { success: false; error: string }) => void;
    (supabaseSync as any).syncPlaylistDelete = () => new Promise(resolve => { resolveDelete = resolve; });
    const q: Playlist = { id: 'Q', name: 'Q before', tracks: [], createdAt: 2 };
    usePlayerStore.setState({ playlists: [playlist, q] });
    usePlayerStore.getState().deletePlaylist('P');
    usePlayerStore.getState().updatePlaylist('Q', { name: 'Q latest' });
    resolveDelete({ success: false, error: 'late delete failure' });
    await flush();
    if (usePlayerStore.getState().playlists.map(item => `${item.id}:${item.name}`).join(',') !==
        'P:Before,Q:Q latest') {
      throw new Error('Selective playlist rollback lost position or overwrote unrelated Q');
    }

    let resolveAccountDelete!: (result: { success: false; error: string }) => void;
    (supabaseSync as any).syncPlaylistDelete = () => new Promise(resolve => { resolveAccountDelete = resolve; });
    usePlayerStore.setState({ playlists: [playlist], savedAlbums: [albumForPlaylist('A album')] });
    usePlayerStore.getState().deletePlaylist('P');
    useAuthStore.setState({ user: authUser('B') });
    usePlayerStore.setState({
      playlists: [{ ...playlist, name: 'B playlist' }],
      savedAlbums: [albumForPlaylist('B album')]
    });
    resolveAccountDelete({ success: false, error: 'A failed after switch' });
    await flush();
    if (usePlayerStore.getState().playlists[0]?.name !== 'B playlist' ||
        usePlayerStore.getState().savedAlbums[0]?.name !== 'B album') {
      throw new Error('A playlist/album rollback mutated B-scoped state');
    }

    useAuthStore.setState({ user: authUser('A') });
    let resolveFavoriteDelete!: (result: { success: false; error: string }) => void;
    (supabaseSync as any).syncFavoriteUp = () => new Promise(resolve => { resolveFavoriteDelete = resolve; });
    usePlayerStore.setState({ favorites: [track] });
    usePlayerStore.getState().toggleFavorite(track);
    useAuthStore.setState({ user: authUser('B') });
    usePlayerStore.setState({ favorites: [{ ...track, title: 'B favorite' }] });
    resolveFavoriteDelete({ success: false, error: 'A favorite failed' });
    await flush();
    if (usePlayerStore.getState().favorites[0]?.title !== 'B favorite') {
      throw new Error('A favorite rollback mutated B-scoped favorite');
    }

    useAuthStore.setState({ user: authUser('A') });
    let resolveNewerDelete!: (result: { success: false; error: string }) => void;
    (supabaseSync as any).syncPlaylistDelete = () => new Promise(resolve => { resolveNewerDelete = resolve; });
    usePlayerStore.setState({ playlists: [playlist] });
    usePlayerStore.getState().deletePlaylist('P');
    usePlayerStore.setState({ playlists: [{ ...playlist, name: 'Newer' }] });
    usePlayerStore.getState().updatePlaylist('P', { name: 'Newest' });
    resolveNewerDelete({ success: false, error: 'stale failure' });
    await flush();
    if (usePlayerStore.getState().playlists[0]?.name !== 'Newest') {
      throw new Error('Stale delete rollback overwrote a newer playlist upsert');
    }

    let resolveAlbumDelete!: (result: { success: false; error: string }) => void;
    (supabaseSync as any).syncPlaylistDelete = () => new Promise(resolve => { resolveAlbumDelete = resolve; });
    usePlayerStore.setState({ playlists: [{ ...playlist, id: 'PL_ALBUM', name: 'Album playlist' }, q] });
    usePlayerStore.getState().toggleSaveAlbum({
      id: 'PL_ALBUM', name: 'Album playlist', artist: 'Artist', cover: '', releaseDate: 'Playlist'
    });
    usePlayerStore.getState().updatePlaylist('Q', { name: 'Q after album delete' });
    resolveAlbumDelete({ success: false, error: 'album playlist failure' });
    await flush();
    const albumRollback = usePlayerStore.getState().playlists;
    if (albumRollback[0]?.id !== 'PL_ALBUM' || albumRollback[1]?.name !== 'Q after album delete') {
      throw new Error('Save-album playlist rollback replaced unrelated playlist state');
    }

    return {
      playlistRestored: 'Before',
      favoriteRestored: 'F',
      unrelatedPlaylist: 'Q latest',
      accountPlaylist: 'B playlist',
      accountFavorite: 'B favorite',
      newerPlaylist: 'Newest',
      albumRollback: albumRollback.map(item => `${item.id}:${item.name}`)
    };
  } finally {
    (supabaseSync as any).syncPlaylistDelete = originalPlaylistDelete;
    (supabaseSync as any).syncFavoriteUp = originalFavoriteUp;
    (supabaseSync as any).syncPlaylistUp = originalPlaylistUp;
    useAuthStore.setState({
      user: originalAuth.user,
      session: originalAuth.session,
      profile: originalAuth.profile
    });
    usePlayerStore.setState({
      playlists: originalState.playlists,
      favorites: originalState.favorites,
      savedAlbums: originalState.savedAlbums,
      toastMessage: originalState.toastMessage
    });
  }
}
