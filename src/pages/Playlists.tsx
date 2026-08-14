import { useState } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { ListMusic, Plus } from 'lucide-react';

export function Playlists() {
  const { playlists, setQueue, setIsPlaying } = usePlayerStore();
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;

    usePlayerStore.setState(state => ({
      playlists: [
        ...state.playlists,
        {
          id: `p-${Date.now()}`,
          name: newPlaylistName.trim(),
          tracks: []
        }
      ]
    }));

    setNewPlaylistName('');
    setShowCreate(false);
  };

  return (
    <div style={{ paddingBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 className="section-header" style={{ marginBottom: '4px' }}>Your Playlists</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{playlists.length} Playlists</p>
        </div>

        <button 
          className="hero-play-btn" 
          onClick={() => setShowCreate(!showCreate)}
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        >
          <Plus size={18} />
          <span>Create Playlist</span>
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreatePlaylist} style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
          <input 
            type="text" 
            placeholder="Playlist name..."
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: '20px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-card)',
              color: '#fff',
              outline: 'none',
              width: '300px'
            }}
          />
          <button type="submit" className="hero-play-btn">Save</button>
        </form>
      )}

      {playlists.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '60px', color: 'var(--text-secondary)' }}>
          <ListMusic size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p>No custom playlists created yet.</p>
        </div>
      ) : (
        <div className="cards-grid">
          {playlists.map((pl) => (
            <div 
              key={pl.id} 
              className="album-card"
              onClick={() => {
                if (pl.tracks.length > 0) {
                  setQueue(pl.tracks, 0);
                  setIsPlaying(true);
                }
              }}
            >
              <div 
                className="album-art"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--bg-card-hover)',
                  backgroundImage: pl.tracks[0]?.cover ? `url(${pl.tracks[0].cover})` : 'none',
                  backgroundSize: 'cover'
                }}
              >
                {!pl.tracks[0]?.cover && <ListMusic size={36} color="var(--text-secondary)" />}
              </div>
              <div className="album-title">{pl.name}</div>
              <div className="album-artist">{pl.tracks.length} tracks</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
