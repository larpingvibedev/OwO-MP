import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Plus, 
  Heart, 
  ListMusic, 
  Disc3, 
  User, 
  ArrowUpDown, 
  Play, 
  Trash2, 
  Music2, 
  Sparkles,
  Check,
  Shuffle
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Playlist, LibraryFilterType, SavedAlbum, FollowedArtist } from '../types';

interface UnifiedLibraryItem {
  id: string;
  type: 'liked_music' | 'playlist' | 'album' | 'artist';
  title: string;
  subtitle: string;
  cover: string;
  isRound?: boolean;
  savedAt: number;
  lastPlayedAt: number;
  data: any;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Library() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') as LibraryFilterType) || 'all';

  const { 
    playlists, 
    favorites, 
    savedAlbums,
    followedArtists,
    setQueue, 
    setIsPlaying, 
    toggleFavorite,
    createPlaylist, 
    deletePlaylist, 
    showToast 
  } = usePlayerStore();

  const [activeFilter, setActiveFilter] = useState<LibraryFilterType>(tabParam);
  const [sortBy, setSortBy] = useState<'recent' | 'added' | 'alpha'>('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  // Sync tab with URL search parameter
  const handleFilterChange = (filter: LibraryFilterType) => {
    setActiveFilter(filter);
    setSearchParams(filter === 'all' ? {} : { tab: filter });
  };

  // 1. Sort Playlists
  const sortedPlaylists = useMemo(() => {
    const list = [...playlists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [playlists, sortBy]);

  // 2. Sort Saved Albums
  const sortedAlbums = useMemo(() => {
    const list = [...savedAlbums];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.lastPlayedAt || b.savedAt || 0) - (a.lastPlayedAt || a.savedAt || 0));
  }, [savedAlbums, sortBy]);

  // 3. Sort Followed Artists
  const sortedArtists = useMemo(() => {
    const list = [...followedArtists];
    if (sortBy === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortBy === 'added') {
      return list.sort((a, b) => (b.followedAt || 0) - (a.followedAt || 0));
    }
    // recent
    return list.sort((a, b) => (b.lastPlayedAt || b.followedAt || 0) - (a.lastPlayedAt || a.followedAt || 0));
  }, [followedArtists, sortBy]);

  // 4. Unified Grid Items for "All" Tab
  const unifiedItems = useMemo(() => {
    const items: UnifiedLibraryItem[] = [];

    // Liked music card
    if (favorites.length > 0) {
      items.push({
        id: 'liked-music-item',
        type: 'liked_music',
        title: 'Liked Music',
        subtitle: `Auto playlist • ${favorites.length} tracks`,
        cover: favorites[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        savedAt: Date.now(),
        lastPlayedAt: Date.now() + 1000,
        data: favorites
      });
    }

    // Playlists
    playlists.forEach(pl => {
      items.push({
        id: pl.id,
        type: 'playlist',
        title: pl.name,
        subtitle: `Playlist • ${pl.tracks.length} ${pl.tracks.length === 1 ? 'track' : 'tracks'}`,
        cover: pl.tracks[0]?.cover || '',
        savedAt: pl.createdAt || 0,
        lastPlayedAt: pl.createdAt || 0,
        data: pl
      });
    });

    // Saved Albums
    savedAlbums.forEach(alb => {
      items.push({
        id: alb.id,
        type: 'album',
        title: alb.name,
        subtitle: `Album • ${alb.artist}`,
        cover: alb.cover,
        savedAt: alb.savedAt || 0,
        lastPlayedAt: alb.lastPlayedAt || alb.savedAt || 0,
        data: alb
      });
    });

    // Followed Artists
    followedArtists.forEach(art => {
      items.push({
        id: art.name,
        type: 'artist',
        title: art.name,
        subtitle: 'Artist • Following',
        cover: art.cover,
        isRound: true,
        savedAt: art.followedAt || 0,
        lastPlayedAt: art.lastPlayedAt || art.followedAt || 0,
        data: art
      });
    });

    // Sort all combined items according to active sort rule
    if (sortBy === 'alpha') {
      return items.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sortBy === 'added') {
      return items.sort((a, b) => b.savedAt - a.savedAt);
    }
    // recent
    return items.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }, [favorites, playlists, savedAlbums, followedArtists, sortBy]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    createPlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setShowCreateModal(false);
  };

  const handlePlayLikedMusic = () => {
    if (favorites.length === 0) {
      showToast('No liked songs yet! Like songs with the heart button to populate.');
      return;
    }
    setQueue(favorites, 0, 'Liked Music');
    setIsPlaying(true);
  };

  const handlePlayPlaylist = (pl: Playlist) => {
    if (pl.tracks.length === 0) {
      showToast(`"${pl.name}" has no songs yet.`);
      return;
    }
    setQueue(pl.tracks, 0, `${pl.name} Playlist`);
    setIsPlaying(true);
  };

  // Filter chips configuration matching YouTube Music
  const filterChips: { id: LibraryFilterType; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: unifiedItems.length },
    { id: 'playlists', label: 'Playlists', count: playlists.length + (favorites.length > 0 ? 1 : 0) },
    { id: 'songs', label: 'Liked Songs', count: favorites.length },
    { id: 'albums', label: 'Albums', count: savedAlbums.length },
    { id: 'artists', label: 'Artists', count: followedArtists.length },
    { id: 'downloads', label: 'Offline / Cache', count: 0 }
  ];

  return (
    <div className="library-page-container">
      {/* Top Header & Filter Chips */}
      <div className="library-header">
        <div className="library-title-row">
          <div>
            <h1 className="library-heading">Your Library</h1>
            <p className="library-subheading">
              {playlists.length} playlists • {favorites.length} liked tracks • {savedAlbums.length} saved albums • {followedArtists.length} artists
            </p>
          </div>

          <button 
            className="new-playlist-primary-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={18} />
            <span>New playlist</span>
          </button>
        </div>

        {/* YouTube Music Style Filter Chips */}
        <div className="library-filter-chips-row">
          <div className="filter-chips-scroll">
            {filterChips.map(chip => (
              <button
                key={chip.id}
                className={`filter-chip ${activeFilter === chip.id ? 'active' : ''}`}
                onClick={() => handleFilterChange(chip.id)}
              >
                <span>{chip.label}</span>
                {chip.count !== undefined && chip.count > 0 && (
                  <span className="chip-counter">{chip.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Sorters: Recent activity, Recently added, Alphabetical */}
          <div className="library-sort-wrapper">
            <button 
              className="library-sort-btn"
              onClick={() => {
                const nextSort = sortBy === 'recent' ? 'added' : (sortBy === 'added' ? 'alpha' : 'recent');
                setSortBy(nextSort);
              }}
              title="Click to toggle sort order"
            >
              <ArrowUpDown size={15} />
              <span>
                {sortBy === 'recent' && 'Recent activity'}
                {sortBy === 'added' && 'Recently added'}
                {sortBy === 'alpha' && 'Alphabetical'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW: All Saved Items (Unified Grid) */}
      {activeFilter === 'all' && (
        <div className="library-grid">
          {unifiedItems.map(item => {
            if (item.type === 'liked_music') {
              return (
                <div 
                  key={item.id}
                  className="library-card liked-music-hero-card"
                  onClick={handlePlayLikedMusic}
                >
                  <div className="liked-music-art">
                    <Heart size={36} fill="#ffffff" color="#ffffff" className="heart-icon-glow" />
                    <div className="card-play-hover-btn">
                      <Play size={22} fill="#000" color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title">Liked Music</div>
                    <div className="card-subtitle auto-playlist-tag">
                      <Sparkles size={12} color="var(--accent-primary)" />
                      <span>{item.subtitle}</span>
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === 'playlist') {
              const pl = item.data as Playlist;
              return (
                <div 
                  key={item.id} 
                  className="library-card playlist-card"
                  onClick={() => setSelectedPlaylist(pl)}
                >
                  <div 
                    className="card-cover-wrapper"
                    style={{
                      backgroundImage: item.cover ? `url(${item.cover})` : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  >
                    {!item.cover && (
                      <div className="empty-cover-placeholder">
                        <ListMusic size={36} color="var(--text-secondary)" />
                      </div>
                    )}
                    <div 
                      className="card-play-hover-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayPlaylist(pl);
                      }}
                      title="Play Playlist"
                    >
                      <Play size={20} fill="#000" color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title" title={item.title}>{item.title}</div>
                    <div className="card-subtitle">{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            if (item.type === 'album') {
              const alb = item.data as SavedAlbum;
              return (
                <div 
                  key={item.id} 
                  className="library-card album-card"
                  onClick={() => navigate(`/album/${alb.id}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover)}`)}
                >
                  <div 
                    className="card-cover-wrapper"
                    style={{
                      backgroundImage: `url(${alb.cover})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  >
                    <div className="card-play-hover-btn" title="View Album">
                      <Disc3 size={20} color="#000" />
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-title" title={alb.name}>{alb.name}</div>
                    <div className="card-subtitle" title={alb.artist}>{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            if (item.type === 'artist') {
              const art = item.data as FollowedArtist;
              return (
                <div 
                  key={item.id} 
                  className="library-card artist-round-card"
                  onClick={() => navigate(`/artist/${encodeURIComponent(art.name)}${art.channelId ? `?channelId=${encodeURIComponent(art.channelId)}` : ''}`)}
                >
                  <div 
                    className="card-avatar-wrapper"
                    style={{
                      backgroundImage: `url(${art.cover})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  >
                    <div className="card-play-hover-btn" title="Go to Artist">
                      <User size={20} color="#000" />
                    </div>
                  </div>
                  <div className="card-meta text-center">
                    <div className="card-title" title={art.name}>{art.name}</div>
                    <div className="card-subtitle">{item.subtitle}</div>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* VIEW: Playlists Tab */}
      {activeFilter === 'playlists' && (
        <div className="library-grid">
          {/* Liked Music Card */}
          {favorites.length > 0 && (
            <div 
              className="library-card liked-music-hero-card"
              onClick={handlePlayLikedMusic}
            >
              <div className="liked-music-art">
                <Heart size={36} fill="#ffffff" color="#ffffff" className="heart-icon-glow" />
                <div className="card-play-hover-btn">
                  <Play size={22} fill="#000" color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title">Liked Music</div>
                <div className="card-subtitle auto-playlist-tag">
                  <Sparkles size={12} color="var(--accent-primary)" />
                  <span>Auto playlist • {favorites.length} tracks</span>
                </div>
              </div>
            </div>
          )}

          {/* Sorted User Playlists */}
          {sortedPlaylists.map(pl => {
            const firstCover = pl.tracks[0]?.cover;
            return (
              <div 
                key={pl.id} 
                className="library-card playlist-card"
                onClick={() => setSelectedPlaylist(pl)}
              >
                <div 
                  className="card-cover-wrapper"
                  style={{
                    backgroundImage: firstCover ? `url(${firstCover})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  {!firstCover && (
                    <div className="empty-cover-placeholder">
                      <ListMusic size={36} color="var(--text-secondary)" />
                    </div>
                  )}
                  <div 
                    className="card-play-hover-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayPlaylist(pl);
                    }}
                    title="Play Playlist"
                  >
                    <Play size={20} fill="#000" color="#000" />
                  </div>
                </div>
                <div className="card-meta">
                  <div className="card-title" title={pl.name}>{pl.name}</div>
                  <div className="card-subtitle">
                    Playlist • {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW: Liked Songs Tab (Table view) */}
      {activeFilter === 'songs' && (
        <div className="liked-songs-view-container">
          <div className="liked-songs-header-card">
            <div className="liked-songs-badge-cover">
              <Heart size={44} fill="#fff" color="#fff" />
            </div>
            <div className="liked-songs-info">
              <span className="liked-badge-tag">Auto Playlist</span>
              <h2 className="liked-songs-title">Liked Songs</h2>
              <p className="liked-songs-count">{favorites.length} songs in collection</p>
              <div className="liked-songs-actions-row">
                <button className="modal-play-all-btn" onClick={handlePlayLikedMusic}>
                  <Play size={16} fill="#000" color="#000" />
                  <span>Play All</span>
                </button>
                <button 
                  className="hero-shuffle-btn"
                  onClick={() => {
                    if (favorites.length > 0) {
                      const shuffled = [...favorites].sort(() => Math.random() - 0.5);
                      setQueue(shuffled, 0, 'Liked Songs (Shuffle)');
                      setIsPlaying(true);
                    }
                  }}
                >
                  <Shuffle size={16} />
                  <span>Shuffle</span>
                </button>
              </div>
            </div>
          </div>

          {favorites.length === 0 ? (
            <div className="library-empty-view">
              <Heart size={48} className="empty-icon-pulse" />
              <h3 className="empty-title">No Liked Songs yet</h3>
              <p className="empty-desc">Click the heart icon on any track to add it to your Liked Music.</p>
            </div>
          ) : (
            <div className="liked-tracks-table">
              {favorites.map((track, idx) => (
                <div 
                  key={`${track.id}-${idx}`}
                  className="liked-track-row"
                  onClick={() => {
                    setQueue(favorites, idx, 'Liked Music');
                    setIsPlaying(true);
                  }}
                >
                  <span className="track-idx-num">{idx + 1}</span>
                  <img src={track.cover} alt={track.title} className="track-row-thumb" />
                  <div className="track-row-details">
                    <span className="track-row-name">{track.title}</span>
                    <span className="track-row-artist">{track.artist}</span>
                  </div>
                  <span className="track-row-album">{track.album || 'Single'}</span>
                  <button 
                    className="track-row-heart-btn active"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(track);
                    }}
                    title="Remove from Liked Songs"
                  >
                    <Heart size={16} fill="var(--accent-primary)" color="var(--accent-primary)" />
                  </button>
                  <span className="track-row-dur">{formatDuration(track.duration)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: Saved Albums Tab */}
      {activeFilter === 'albums' && (
        <div className="library-grid">
          {sortedAlbums.map(alb => (
            <div 
              key={alb.id} 
              className="library-card album-card"
              onClick={() => navigate(`/album/${alb.id}?name=${encodeURIComponent(alb.name)}&artist=${encodeURIComponent(alb.artist)}&cover=${encodeURIComponent(alb.cover)}`)}
            >
              <div 
                className="card-cover-wrapper"
                style={{
                  backgroundImage: `url(${alb.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="card-play-hover-btn" title="View Album">
                  <Disc3 size={20} color="#000" />
                </div>
              </div>
              <div className="card-meta">
                <div className="card-title" title={alb.name}>{alb.name}</div>
                <div className="card-subtitle" title={alb.artist}>Album • {alb.artist}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW: Followed Artists Tab */}
      {activeFilter === 'artists' && (
        <div className="library-grid">
          {sortedArtists.map(art => (
            <div 
              key={art.name} 
              className="library-card artist-round-card"
              onClick={() => navigate(`/artist/${encodeURIComponent(art.name)}${art.channelId ? `?channelId=${encodeURIComponent(art.channelId)}` : ''}`)}
            >
              <div 
                className="card-avatar-wrapper"
                style={{
                  backgroundImage: `url(${art.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="card-play-hover-btn" title="Go to Artist">
                  <User size={20} color="#000" />
                </div>
              </div>
              <div className="card-meta text-center">
                <div className="card-title" title={art.name}>{art.name}</div>
                <div className="card-subtitle">Artist • Following</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State when no items exist for the active filter */}
      {((activeFilter === 'all' && unifiedItems.length === 0) ||
        (activeFilter === 'playlists' && playlists.length === 0 && favorites.length === 0) ||
        (activeFilter === 'albums' && savedAlbums.length === 0) ||
        (activeFilter === 'artists' && followedArtists.length === 0) ||
        (activeFilter === 'downloads')) && (
        <div className="library-empty-view">
          <Music2 size={54} className="empty-icon-pulse" />
          <h3 className="empty-title">Your Library is empty</h3>
          <p className="empty-desc">
            {activeFilter === 'all' && 'Like songs, create playlists, save albums, and follow artists to build your personalized library.'}
            {activeFilter === 'playlists' && 'Create custom playlists or like songs to organize your collection.'}
            {activeFilter === 'albums' && 'Save official Albums or EPs using the bookmark icon on album pages.'}
            {activeFilter === 'artists' && 'Click "Follow" on any artist page to add them to your roster.'}
            {activeFilter === 'downloads' && 'Offline cached songs will appear here for local playback.'}
          </p>
        </div>
      )}

      {/* Playlist Details / Tracklist Modal */}
      {selectedPlaylist && (
        <div className="playlist-detail-modal-backdrop" onClick={() => setSelectedPlaylist(null)}>
          <div className="playlist-detail-modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-title-group">
                <h2 className="modal-title">{selectedPlaylist.name}</h2>
                <span className="modal-subtitle">{selectedPlaylist.tracks.length} tracks</span>
              </div>
              
              <div className="modal-actions-group">
                <button 
                  className="modal-play-all-btn"
                  onClick={() => {
                    handlePlayPlaylist(selectedPlaylist);
                    setSelectedPlaylist(null);
                  }}
                >
                  <Play size={16} fill="#000" color="#000" />
                  <span>Play All</span>
                </button>
                <button 
                  className="modal-delete-btn"
                  onClick={() => {
                    deletePlaylist(selectedPlaylist.id);
                    setSelectedPlaylist(null);
                  }}
                  title="Delete playlist"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {selectedPlaylist.tracks.length === 0 ? (
              <div className="modal-empty-tracks">
                <ListMusic size={40} style={{ opacity: 0.4, marginBottom: '12px' }} />
                <p>This playlist is empty. Add songs using the 3-dot menu on any track.</p>
              </div>
            ) : (
              <div className="modal-tracklist-scroll">
                {selectedPlaylist.tracks.map((track, idx) => (
                  <div 
                    key={`${track.id}-${idx}`} 
                    className="modal-track-row"
                    onClick={() => {
                      setQueue(selectedPlaylist.tracks, idx, `${selectedPlaylist.name} Playlist`);
                      setIsPlaying(true);
                      setSelectedPlaylist(null);
                    }}
                  >
                    <span className="track-idx">{idx + 1}</span>
                    <img src={track.cover} alt={track.title} className="track-thumb" />
                    <div className="track-info-col">
                      <span className="track-name">{track.title}</span>
                      <span className="track-artist">{track.artist}</span>
                    </div>
                    <span className="track-dur">
                      {formatDuration(track.duration)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-footer">
              <button className="modal-close-btn" onClick={() => setSelectedPlaylist(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Playlist Creation Dialog */}
      {showCreateModal && (
        <div className="playlist-detail-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="playlist-detail-modal-dialog" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" style={{ marginBottom: '16px' }}>Create New Playlist</h2>
            <form onSubmit={handleCreateSubmit}>
              <input 
                type="text" 
                placeholder="Playlist name..."
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
                autoFocus
                className="new-playlist-input"
              />
              <div className="modal-footer" style={{ marginTop: '20px' }}>
                <button type="button" className="modal-close-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="modal-play-all-btn">
                  <Check size={16} color="#000" />
                  <span>Create</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
