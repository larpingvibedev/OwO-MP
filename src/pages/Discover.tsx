import { useState, useEffect } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useNavigate } from 'react-router-dom';
import { 
  RotateCcw, 
  ListMusic, 
  Play, 
  Plus, 
  Check, 
  Loader2, 
  Sparkles, 
  X, 
  Music, 
  Clock, 
  History, 
  Trash2, 
  Search,
  TrendingUp,
  Compass,
  Heart
} from 'lucide-react';
import type { SearchCategory, Track, PublicPlaylist } from '../types';
import { searchPublicPlaylists, fetchPublicPlaylistTracks } from '../services/musicSearch';
import { AddToQueueButton } from '../components/common/AddToQueueButton';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function Discover() {
  const { 
    searchResults, 
    searchQuery, 
    artistProfile, 
    currentTrack, 
    playHistory, 
    isSearching, 
    recentSearchQueries,
    recentSearchedTracks,
    favorites,
    toggleFavorite,
    setSearchQuery,
    addRecentSearchQuery,
    removeRecentSearchQuery,
    clearRecentSearchQueries,
    addRecentSearchedTrack,
    removeRecentSearchedTrack,
    clearRecentSearchedTracks,
    setQueue, 
    setIsPlaying 
  } = usePlayerStore();

  const [searchCategory, setSearchCategory] = useState<SearchCategory>('all');
  const [publicPlaylists, setPublicPlaylists] = useState<PublicPlaylist[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [activePlaylistDetail, setActivePlaylistDetail] = useState<{
    playlist: PublicPlaylist;
    tracks: Track[];
    isLoading: boolean;
  } | null>(null);
  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  // Fetch Public & Curated Playlists when searchQuery or searchCategory changes
  useEffect(() => {
    if (!searchQuery.trim()) return;

    let isMounted = true;
    setIsLoadingPlaylists(true);

    const topTracks = artistProfile?.topTracks || searchResults.slice(0, 20);

    searchPublicPlaylists(searchQuery, topTracks)
      .then((pls) => {
        if (isMounted) {
          setPublicPlaylists(pls);
          setIsLoadingPlaylists(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoadingPlaylists(false);
      });

    return () => {
      isMounted = false;
    };
  }, [searchQuery, artistProfile?.name]);

  // Handle clicking a recent query chip
  const handleQueryClick = (q: string) => {
    setSearchQuery(q);
    addRecentSearchQuery(q);
  };

  // Play a track and record it to recent searches
  const handlePlayTrack = (track: Track, tracksQueue: Track[] = [track], index: number = 0, contextName?: string) => {
    addRecentSearchedTrack(track);
    addRecentSearchQuery(track.artist);
    setQueue(tracksQueue, index, contextName || `${track.title} Mix`);
    setIsPlaying(true);
  };

  // =========================================================================
  // RECENT SEARCHES & DISCOVERY HUB (When Search Bar is Empty)
  // =========================================================================
  if (!searchQuery.trim()) {
    const hasRecentQueries = (recentSearchQueries || []).length > 0;
    const hasRecentTracks = (recentSearchedTracks || []).length > 0;
    const popularSuggestions = ['bunii', 'duskydemise', 'Slowed and Reverb', 'kendrick lamar', 'Hyperpop', 'phonk', 'ambient mix'];

    return (
      <div style={{ paddingBottom: '40px', maxWidth: '1400px' }}>
        {/* Header Title */}
        <div style={{ marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Compass size={28} color="var(--accent-primary)" />
          <div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>Search & Discover</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Find songs, artists, albums, or pick up where you left off.
            </p>
          </div>
        </div>

        {/* 1. Recent Text Search Queries Chips */}
        <div style={{ marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} color="var(--accent-primary)" />
              <h3 className="section-header" style={{ fontSize: '1.15rem', margin: 0 }}>
                Recent Searches
              </h3>
            </div>
            {hasRecentQueries && (
              <button
                onClick={clearRecentSearchQueries}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  transition: 'all 0.2s'
                }}
              >
                <Trash2 size={13} />
                <span>Clear Searches</span>
              </button>
            )}
          </div>

          {hasRecentQueries ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {recentSearchQueries.map((q) => (
                <div
                  key={`query-${q}`}
                  onClick={() => handleQueryClick(q)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '24px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <Search size={14} color="var(--accent-primary)" />
                  <span>{q}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecentSearchQuery(q);
                    }}
                    title="Remove from history"
                    style={{
                      padding: '2px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      marginLeft: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '16px 20px',
              borderRadius: '10px',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px dashed var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem'
            }}>
              No recent search queries yet. Try searching in the bar above or tap a suggested term below!
            </div>
          )}
        </div>

        {/* 2. Suggested Quick Search Terms */}
        <div style={{ marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <TrendingUp size={18} color="var(--accent-primary)" />
            <h3 className="section-header" style={{ fontSize: '1.15rem', margin: 0 }}>
              Trending & Suggested
            </h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {popularSuggestions.map((term) => (
              <button
                key={`sug-${term}`}
                onClick={() => handleQueryClick(term)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(52, 152, 219, 0.08)',
                  border: '1px solid rgba(52, 152, 219, 0.25)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <Sparkles size={13} color="var(--accent-primary)" />
                <span>{term}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Recently Searched / Played Songs Grid */}
        {hasRecentTracks && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <History size={18} color="var(--accent-primary)" />
                <h3 className="section-header" style={{ fontSize: '1.15rem', margin: 0 }}>
                  Recently Searched Songs
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                  ({recentSearchedTracks.length})
                </span>
              </div>
              <button
                onClick={clearRecentSearchedTracks}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  transition: 'all 0.2s'
                }}
              >
                <Trash2 size={13} />
                <span>Clear Songs</span>
              </button>
            </div>

            <div className="cards-grid">
              {recentSearchedTracks.map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <div 
                    key={`rec-track-${track.id}`} 
                    className={`album-card ${isCurrent ? 'active-playing' : ''}`}
                    onClick={() => handlePlayTrack(track, [track], 0, 'Recent Searches')}
                    style={{ position: 'relative' }}
                  >
                    <div 
                      className="album-art" 
                      style={{ overflow: 'hidden', position: 'relative', backgroundColor: 'var(--bg-main)' }}
                    >
                      <img 
                        src={track.cover} 
                        alt={track.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                        }}
                      />
                      {/* Add to Queue button (Top-Left) */}
                      <AddToQueueButton track={track} variant="card-overlay" position="top-left" />
                      
                      {/* Remove from history button (Top-Right) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentSearchedTrack(track.id);
                        }}
                        title="Remove from history"
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(0,0,0,0.72)',
                          backdropFilter: 'blur(8px)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          zIndex: 2
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="album-title">{track.title}</div>
                    <div 
                      className="album-artist"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
                      }}
                    >
                      {track.artist}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Filter playHistory for "Listen Again" (Most listened songs by this artist)
  const artistLower = artistProfile?.name.toLowerCase() || searchQuery.toLowerCase();
  const recentByArtist = Object.values(playHistory || {})
    .filter((item) => {
      const a = (item.track.artist || '').toLowerCase();
      return a.includes(artistLower) || artistLower.includes(a);
    })
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 4)
    .map((item) => item.track);

  // Open Public Playlist Detail & Load Tracks
  const handleOpenPlaylist = async (pl: PublicPlaylist) => {
    if (pl.tracks && pl.tracks.length > 0) {
      setActivePlaylistDetail({
        playlist: pl,
        tracks: pl.tracks,
        isLoading: false
      });
      return;
    }

    setActivePlaylistDetail({
      playlist: pl,
      tracks: [],
      isLoading: true
    });

    try {
      const tracks = await fetchPublicPlaylistTracks(pl);
      setActivePlaylistDetail({
        playlist: pl,
        tracks,
        isLoading: false
      });
    } catch (err) {
      setActivePlaylistDetail(prev => prev ? { ...prev, isLoading: false } : null);
    }
  };

  // Play entire Public Playlist
  const handlePlayPublicPlaylist = async (pl: PublicPlaylist, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    let tracks = pl.tracks || [];
    if (tracks.length === 0) {
      tracks = await fetchPublicPlaylistTracks(pl);
    }

    if (tracks.length > 0) {
      setQueue(tracks, 0, pl.name);
      setIsPlaying(true);
    }
  };

  // Save Public Playlist to User's Personal Playlists
  const handleSaveToLibrary = (pl: PublicPlaylist, tracks: Track[]) => {
    if (savedPlaylistIds.has(pl.id)) return;

    usePlayerStore.setState(state => ({
      playlists: [
        ...state.playlists,
        {
          id: `saved-${Date.now()}`,
          name: pl.name,
          cover: pl.cover,
          tracks: tracks.length > 0 ? tracks : (pl.tracks || [])
        }
      ]
    }));

    setSavedPlaylistIds(prev => new Set(prev).add(pl.id));
  };

  return (
    <div style={{ paddingBottom: '32px', position: 'relative' }}>
      {/* Live Search Sync Progress Bar */}
      {isSearching && (
        <div style={{
          height: '3px',
          width: '100%',
          backgroundColor: 'rgba(255,255,255,0.05)',
          overflow: 'hidden',
          marginBottom: '20px',
          borderRadius: '3px',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <div 
            className="search-progress-bar"
            style={{
              height: '100%',
              width: '35%',
              backgroundColor: 'var(--accent-primary)',
              borderRadius: '3px'
            }}
          />
        </div>
      )}

      {/* Top Section: Top Result Artist Card (Left) + Top Songs (Right) */}
      {artistProfile && searchCategory !== 'playlists' && (
        <div className="top-result-container">
          {/* Top Result Artist Card */}
          <div 
            className="top-artist-card"
            onClick={() => navigate(`/artist/${encodeURIComponent(artistProfile.name)}${artistProfile.artistId ? `?artistId=${encodeURIComponent(artistProfile.artistId)}` : (artistProfile.channelId ? `?channelId=${encodeURIComponent(artistProfile.channelId)}` : '')}`)}
          >
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '20px' }}>
              Top Result
            </span>
            
            <div 
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                overflow: 'hidden',
                marginBottom: '20px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                border: '2px solid var(--border-color)',
                backgroundColor: 'var(--bg-main)',
                flexShrink: 0
              }}
            >
              <img 
                src={artistProfile.cover} 
                alt={artistProfile.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                }}
              />
            </div>

            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '8px' }}>{artistProfile.name}</h2>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 'auto' }}>
              <span style={{ 
                fontSize: '0.75rem', 
                color: 'var(--accent-primary)', 
                fontWeight: 700, 
                backgroundColor: 'rgba(52, 152, 219, 0.15)', 
                padding: '4px 12px', 
                borderRadius: '12px',
                textTransform: 'uppercase' 
              }}>
                Artist
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Click to view full profile & albums
              </span>
            </div>
          </div>

          {/* Top Songs Quick Play (Right) */}
          <div>
            <h3 className="section-header" style={{ fontSize: '1.25rem', marginBottom: '16px' }}>
              Top Songs
            </h3>
            {artistProfile.topTracks.length > 0 ? (
              <div className="top-tracks-list">
                {artistProfile.topTracks.slice(0, 5).map((track: Track, idx: number) => {
                  const isFav = favorites.some(f => f.id === track.id);
                  return (
                    <div 
                      key={track.id}
                      className={`track-row ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                      onClick={() => handlePlayTrack(track, [track], 0, `${track.title} Mix`)}
                    >
                      <span className="track-row-index">{idx + 1}</span>
                      <div 
                        className="track-row-cover" 
                        style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', flexShrink: 0 }}
                      >
                        <img 
                          src={track.cover} 
                          alt={track.title} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                          }}
                        />
                      </div>
                      <div className="track-row-info">
                        <div className="track-row-title">{track.title}</div>
                        <div 
                          className="track-row-artist"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
                          }}
                        >
                          {track.artist}
                        </div>
                      </div>
                      <div className="track-row-album">{track.album || 'Single'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => toggleFavorite(track)}
                          title={isFav ? "Favorited" : "Favorite"}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer', 
                            color: isFav ? 'var(--accent-primary)' : 'rgba(255,255,255,0.3)',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Heart size={15} fill={isFav ? "currentColor" : "none"} />
                        </button>
                        <AddToQueueButton track={track} variant="row-btn" />
                        <span className="track-row-duration" style={{ minWidth: '38px', textAlign: 'right' }}>{formatTime(track.duration)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No top tracks found.</div>
            )}
          </div>
        </div>
      )}

      {/* Listen Again / History Shelf */}
      {recentByArtist.length > 0 && searchCategory !== 'playlists' && (
        <div style={{ marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <RotateCcw size={18} color="var(--accent-primary)" />
            <h3 className="section-header" style={{ fontSize: '1.25rem', margin: 0 }}>Listen Again</h3>
          </div>
          <div className="cards-grid">
            {recentByArtist.map((track) => (
              <div 
                key={`recent-${track.id}`}
                className={`album-card ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                onClick={() => handlePlayTrack(track, [track], 0, `${track.title} Mix`)}
              >
                <div 
                  className="album-art" 
                  style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}
                >
                  <img 
                    src={track.cover} 
                    alt={track.title} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                    }}
                  />
                  <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                </div>
                <div className="album-title">{track.title}</div>
                <div 
                  className="album-artist"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
                  }}
                >
                  {track.artist}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Filter Chips */}
      <h3 className="section-header" style={{ marginBottom: '16px' }}>
        Results for "{searchQuery}"
      </h3>
      
      <div className="filter-chips" style={{ marginBottom: '24px' }}>
        {(['all', 'songs', 'videos', 'playlists'] as SearchCategory[]).map((cat) => (
          <button
            key={cat}
            className={`filter-chip ${searchCategory === cat ? 'active' : ''}`}
            onClick={() => setSearchCategory(cat)}
          >
            {cat === 'playlists' ? 'Playlists & Mixes' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* PLAYLISTS TAB: Public & Community Playlists (YouTube Music / Spotify)     */}
      {/* ========================================================================= */}
      {searchCategory === 'playlists' ? (
        <div>
          {isLoadingPlaylists ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', padding: '40px 0', justifyContent: 'center' }}>
              <Loader2 className="animate-spin" size={24} color="var(--accent-primary)" />
              <span>Finding public & community playlists related to "{searchQuery}"...</span>
            </div>
          ) : publicPlaylists.length > 0 ? (
            <div className="cards-grid">
              {publicPlaylists.map((pl) => (
                <div 
                  key={pl.id} 
                  className="album-card"
                  onClick={() => handleOpenPlaylist(pl)}
                  style={{ position: 'relative', cursor: 'pointer' }}
                >
                  {/* Playlist Art */}
                  <div 
                    className="album-art" 
                    style={{ 
                      overflow: 'hidden',
                      position: 'relative',
                      backgroundColor: 'var(--bg-main)'
                    }}
                  >
                    <img 
                      src={pl.cover} 
                      alt={pl.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                      }}
                    />

                    {/* Source Tag Badge */}
                    <span 
                      className={`source-badge ${pl.source}`}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {pl.source === 'curated' ? <Sparkles size={11} /> : <ListMusic size={11} />}
                      {pl.source === 'curated' ? 'Curated Mix' : 'Community'}
                    </span>

                    {/* Track count pill */}
                    <span 
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        backgroundColor: 'rgba(0,0,0,0.75)',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        color: '#fff'
                      }}
                    >
                      {pl.trackCount} songs
                    </span>

                    {/* Quick Play Hover Button */}
                    <button
                      onClick={(e) => handlePlayPublicPlaylist(pl, e)}
                      title="Play entire playlist"
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        left: '8px',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--accent-primary)',
                        border: 'none',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        cursor: 'pointer'
                      }}
                    >
                      <Play size={16} fill="currentColor" style={{ marginLeft: '2px' }} />
                    </button>
                  </div>

                  <div className="album-title">{pl.name}</div>
                  <div className="album-artist">{pl.author}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>
              No public playlists found for "{searchQuery}".
            </div>
          )}
        </div>
      ) : (
        /* ========================================================================= */
        /* ALL / SONGS / VIDEOS TAB: Standard Search Results Grid                    */
        /* ========================================================================= */
        <div className="cards-grid">
          {(() => {
            const filteredResults = searchResults.filter((track) => {
              if (searchCategory === 'all') return true;
              if (searchCategory === 'songs') return track.category === 'song' || !track.category;
              if (searchCategory === 'videos') return track.category === 'video' || track.title.toLowerCase().includes('video') || track.title.toLowerCase().includes('visualizer');
              return true;
            });

            return filteredResults.map((track) => (
              <div 
                key={track.id} 
                className={`album-card ${currentTrack?.id === track.id ? 'active-playing' : ''}`}
                onClick={() => handlePlayTrack(track, [track], 0, `${track.title} Mix`)}
              >
                <div 
                  className="album-art" 
                  style={{ overflow: 'hidden', position: 'relative', backgroundColor: 'var(--bg-main)' }}
                >
                  <img 
                    src={track.cover} 
                    alt={track.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
                    }}
                  />
                  <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                </div>
                <div className="album-title">{track.title}</div>
                <div 
                  className="album-artist"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
                  }}
                >
                  {track.artist}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* PUBLIC PLAYLIST DETAIL MODAL / DRAWER                                      */}
      {/* ========================================================================= */}
      {activePlaylistDetail && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setActivePlaylistDetail(null)}
        >
          <div 
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '85vh',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              gap: '20px',
              alignItems: 'center',
              backgroundColor: 'var(--bg-secondary)',
              position: 'relative'
            }}>
              <div 
                style={{
                  width: '100px',
                  height: '100px',
                  borderRadius: '8px',
                  backgroundImage: `url(${activePlaylistDetail.playlist.cover})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  flexShrink: 0,
                  boxShadow: '0 6px 18px rgba(0,0,0,0.4)'
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent-primary)', fontWeight: 700, letterSpacing: '0.05em' }}>
                  {activePlaylistDetail.playlist.source === 'curated' ? 'Curated Playlist' : 'Public Community Playlist'}
                </div>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '4px 0 6px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activePlaylistDetail.playlist.name}
                </h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  By {activePlaylistDetail.playlist.author} • {activePlaylistDetail.tracks.length || activePlaylistDetail.playlist.trackCount} songs
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                  <button 
                    className="hero-play-btn"
                    onClick={() => {
                      if (activePlaylistDetail.tracks.length > 0) {
                        setQueue(activePlaylistDetail.tracks, 0, activePlaylistDetail.playlist.name);
                        setIsPlaying(true);
                      }
                    }}
                    disabled={activePlaylistDetail.isLoading || activePlaylistDetail.tracks.length === 0}
                    style={{ padding: '6px 16px', fontSize: '0.85rem' }}
                  >
                    <Play size={15} fill="currentColor" />
                    <span>Play All</span>
                  </button>

                  <button 
                    onClick={() => handleSaveToLibrary(activePlaylistDetail.playlist, activePlaylistDetail.tracks)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      backgroundColor: savedPlaylistIds.has(activePlaylistDetail.playlist.id) ? 'rgba(46, 204, 113, 0.15)' : 'var(--bg-card)',
                      border: `1px solid ${savedPlaylistIds.has(activePlaylistDetail.playlist.id) ? '#2ecc71' : 'var(--border-color)'}`,
                      color: savedPlaylistIds.has(activePlaylistDetail.playlist.id) ? '#2ecc71' : 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {savedPlaylistIds.has(activePlaylistDetail.playlist.id) ? <Check size={15} /> : <Plus size={15} />}
                    <span>{savedPlaylistIds.has(activePlaylistDetail.playlist.id) ? 'Saved to Library' : 'Save Playlist'}</span>
                  </button>
                </div>
              </div>

              <button 
                onClick={() => setActivePlaylistDetail(null)}
                className="secondary-btn"
                style={{ position: 'absolute', top: '16px', right: '16px', padding: '6px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Tracklist Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {activePlaylistDetail.isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', padding: '40px 0', justifyContent: 'center' }}>
                  <Loader2 className="spinning" size={20} color="var(--accent-primary)" />
                  <span>Loading playlist tracks...</span>
                </div>
              ) : activePlaylistDetail.tracks.length > 0 ? (
                <div className="top-tracks-list">
                  {activePlaylistDetail.tracks.map((track, idx) => {
                    const isCurrent = currentTrack?.id === track.id;
                    return (
                      <div 
                        key={`pl-track-${track.id}-${idx}`}
                        className={`track-row ${isCurrent ? 'active-playing' : ''}`}
                        onClick={() => {
                          setQueue(activePlaylistDetail.tracks, idx, activePlaylistDetail.playlist.name);
                          setIsPlaying(true);
                        }}
                      >
                        <span className="track-row-index">{idx + 1}</span>
                        <div 
                          className="track-row-cover"
                          style={{ backgroundImage: `url(${track.cover})` }}
                        />
                        <div className="track-row-info">
                          <div className="track-row-title">{track.title}</div>
                          <div className="track-row-artist">{track.artist}</div>
                        </div>
                        <div className="track-row-album">{track.album || activePlaylistDetail.playlist.name}</div>
                        <span className="track-row-duration">{formatTime(track.duration)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  <Music size={32} style={{ opacity: 0.4, marginBottom: '12px' }} />
                  <p>No tracks loaded for this playlist.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

