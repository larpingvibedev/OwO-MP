import { usePlayerStore } from '../store/usePlayerStore';
import { Library } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Albums() {
  const { queue } = usePlayerStore();
  const navigate = useNavigate();

  // Extract unique albums from current queue & history
  const albumsMap = new Map();
  queue.forEach(track => {
    if (track.album && !albumsMap.has(track.album)) {
      albumsMap.set(track.album, {
        id: track.album.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: track.album,
        artist: track.artist,
        cover: track.cover
      });
    }
  });

  const albums = Array.from(albumsMap.values());

  return (
    <div style={{ paddingBottom: '32px' }}>
      <h2 className="section-header">Saved Albums</h2>

      {albums.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '60px', color: 'var(--text-secondary)' }}>
          <Library size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p>No albums loaded in your current session.</p>
        </div>
      ) : (
        <div className="cards-grid">
          {albums.map((album) => (
            <div 
              key={album.id} 
              className="album-card"
              onClick={() => navigate(`/album/${album.id}?name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}`)}
            >
              <div 
                className="album-art"
                style={{ backgroundImage: `url(${album.cover})` }}
              />
              <div className="album-title">{album.name}</div>
              <div className="album-artist">{album.artist}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
