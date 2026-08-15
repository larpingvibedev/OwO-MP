import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useNavigate } from 'react-router-dom';
import { 
  Play, 
  RotateCcw, 
  Sparkles, 
  Heart, 
  ListMusic, 
  Radio, 
  Music 
} from 'lucide-react';
import { Carousel } from '../components/Carousel';
import { SpeedDialGrid } from '../components/SpeedDialGrid';
import { AddToQueueButton } from '../components/common/AddToQueueButton';
import { TrackOptionsMenu } from '../components/common/TrackOptionsMenu';
import { isSameTrack } from '../utils/trackUtils';
import type { Track, PublicPlaylist } from '../types';
import { 
  fetchArtistDeepTracks, 
  fetchCoversAndRemixes,
  fetchAlbumsForYou,
  fetchCommunityPlaylistsForYou,
  fetchSimilarPlaylists
} from '../services/musicSearch';

const CACHE_KEYS = {
  REC_TRACKS: 'owo_dash_rec_tracks',
  REC_ARTIST: 'owo_dash_rec_artist',
  COVERS: 'owo_dash_covers_remixes',
  ALBUMS: 'owo_dash_albums',
  COMMUNITY: 'owo_dash_community',
  SIMILAR: 'owo_dash_similar',
  SEED_PL_NAME: 'owo_dash_seed_pl_name',
};

function getLocalCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return fallback;
}

function setLocalCache<T>(key: string, val: T) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {}
}

export function Dashboard() {
  const { 
    playHistory, 
    favorites, 
    playlists, 
    currentTrack, 
    setQueue, 
    setIsPlaying,
    toggleFavorite,
    showToast
  } = usePlayerStore();
  
  const navigate = useNavigate();
  
  // Local state for recommendation carousels initialized instantly from local cache
  const [recommendedTracks, setRecommendedTracks] = useState<Track[]>(() => 
    getLocalCache<Track[]>(CACHE_KEYS.REC_TRACKS, [])
  );
  const [recommendedArtist, setRecommendedArtist] = useState<string>(() => 
    getLocalCache<string>(CACHE_KEYS.REC_ARTIST, '')
  );
  const [coversAndRemixes, setCoversAndRemixes] = useState<Track[]>(() => 
    getLocalCache<Track[]>(CACHE_KEYS.COVERS, [])
  );
  
  const [albumsForYou, setAlbumsForYou] = useState<PublicPlaylist[]>(() => 
    getLocalCache<PublicPlaylist[]>(CACHE_KEYS.ALBUMS, [])
  );
  const [communityPlaylists, setCommunityPlaylists] = useState<PublicPlaylist[]>(() => 
    getLocalCache<PublicPlaylist[]>(CACHE_KEYS.COMMUNITY, [])
  );
  const [similarPlaylists, setSimilarPlaylists] = useState<PublicPlaylist[]>(() => 
    getLocalCache<PublicPlaylist[]>(CACHE_KEYS.SIMILAR, [])
  );
  const [seedPlaylistName, setSeedPlaylistName] = useState<string>(() => 
    getLocalCache<string>(CACHE_KEYS.SEED_PL_NAME, '')
  );
  
  // Refs to throttle redundant background fetches
  const lastArtistFetchRef = useRef<string>('');
  const lastCoversFetchRef = useRef<string>('');
  const lastAlbumsFetchRef = useRef<string>('');
  const lastSimilarFetchRef = useRef<string>('');

  // When play history is cleared (Clean Slate), immediately clear all local carousel states
  useEffect(() => {
    if (!playHistory || Object.keys(playHistory).length === 0) {
      setRecommendedTracks([]);
      setCoversAndRemixes([]);
      setAlbumsForYou([]);
      setCommunityPlaylists([]);
      setSimilarPlaylists([]);
      setRecommendedArtist('');
      setSeedPlaylistName('');
      lastArtistFetchRef.current = '';
      lastCoversFetchRef.current = '';
      lastAlbumsFetchRef.current = '';
      lastSimilarFetchRef.current = '';
    }
  }, [playHistory]);


  // 1. Get Speed Dial & Quick Picks tracks (deduplicated by Title + Artist)
  const historyArray = Object.values(playHistory || {});
  const uniqueHistoryMap = new Map<string, { track: Track; playCount: number; lastPlayedAt: number }>();
  historyArray.forEach(h => {
    if (!h.track?.title || !h.track?.artist) return;
    const key = `${h.track.title.toLowerCase().trim()}___${h.track.artist.toLowerCase().trim().replace(/\s*-\s*topic$/i, '')}`;
    const existing = uniqueHistoryMap.get(key);
    if (!existing) {
      uniqueHistoryMap.set(key, h);
    } else {
      uniqueHistoryMap.set(key, {
        track: (h.track.album && !existing.track.album) ? h.track : existing.track,
        playCount: existing.playCount + h.playCount,
        lastPlayedAt: Math.max(existing.lastPlayedAt, h.lastPlayedAt)
      });
    }
  });

  const speedDialTracks = Array.from(uniqueHistoryMap.values())
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 9)
    .map(h => h.track);

  // Fallback speed dial if empty
  const defaultSpeedDial = speedDialTracks.length > 0 ? speedDialTracks : favorites.slice(0, 9);

  // 2. Get Quick Picks (recent listening habits)
  const quickPicksTracks = Array.from(uniqueHistoryMap.values())
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 20)
    .map(h => h.track);

  // Fallback for quick picks
  const displayQuickPicks = quickPicksTracks.length > 0 ? quickPicksTracks : favorites;

  // 3. Universal User Seed Resolution (History -> Favorites -> Playlists -> Current -> Discovery)
  const allUserTracks: Track[] = [
    ...historyArray.map(h => h.track),
    ...favorites,
    ...playlists.flatMap(p => p.tracks),
    ...(currentTrack ? [currentTrack] : [])
  ];

  const allUserArtists = Array.from(
    new Set(allUserTracks.map(t => t.artist).filter(Boolean))
  );

  const topArtists = allUserArtists.length > 0 
    ? allUserArtists.slice(0, 3) 
    : ['Trending Music', 'Top Hits'];

  // 4. Get Forgotten Favorites (favorites not played in the last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const forgottenFavorites = favorites.filter(fav => {
    const historyItem = playHistory[fav.id];
    if (!historyItem) return true; // Never played but favorited!
    return historyItem.lastPlayedAt < sevenDaysAgo;
  }).slice(0, 15);

  // 5. Fetch dynamic "Similar to Recent Artist" recommendations
  useEffect(() => {
    let isCancelled = false;

    const fetchArtistRecs = async () => {
      const sortedHistory = [...historyArray].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
      const targetArtist = sortedHistory[0]?.track.artist || allUserArtists[0] || 'Trending Artist';
      
      if (lastArtistFetchRef.current === targetArtist && recommendedTracks.length > 0) return;
      lastArtistFetchRef.current = targetArtist;

      setRecommendedArtist(targetArtist);
      setLocalCache(CACHE_KEYS.REC_ARTIST, targetArtist);

      try {
        const tracks = await fetchArtistDeepTracks(targetArtist);
        if (!isCancelled && tracks.length > 0) {
          setRecommendedTracks(tracks);
          setLocalCache(CACHE_KEYS.REC_TRACKS, tracks);
        }
      } catch (err) {
        console.warn('Failed to fetch artist deep recommendations:', err);
      }
    };

    fetchArtistRecs();

    return () => {
      isCancelled = true;
    };
  }, [playHistory, favorites, currentTrack]);

  // 6. Fetch dynamic "Covers and Remixes" strictly based on user's top played tracks
  useEffect(() => {
    let isCancelled = false;

    const fetchCovers = async () => {
      const topHistory = [...historyArray].sort((a, b) => b.playCount - a.playCount);
      const topTracks = topHistory.map(h => h.track);
      const seedsToUse = topTracks.length > 0 ? topTracks : allUserTracks.slice(0, 3);
      
      const seedKey = seedsToUse.map(s => s.id || s.title).join('|');
      if (lastCoversFetchRef.current === seedKey && coversAndRemixes.length > 0) return;
      lastCoversFetchRef.current = seedKey;

      try {
        const tracks = await fetchCoversAndRemixes(seedsToUse);
        if (!isCancelled && tracks.length > 0) {
          setCoversAndRemixes(tracks);
          setLocalCache(CACHE_KEYS.COVERS, tracks);
        }
      } catch (err) {
        console.warn('Failed to fetch authentic covers/remixes:', err);
      }
    };

    fetchCovers();

    return () => {
      isCancelled = true;
    };
  }, [playHistory, favorites, currentTrack]);

  // 7. Fetch "Albums for you" and "From the community"
  useEffect(() => {
    let isCancelled = false;
    
    const fetchPlaylistsAndAlbums = async () => {
      const seedKey = topArtists.join('|');
      if (lastAlbumsFetchRef.current === seedKey && albumsForYou.length > 0 && communityPlaylists.length > 0) return;
      lastAlbumsFetchRef.current = seedKey;

      try {
        const [albums, community] = await Promise.all([
          fetchAlbumsForYou(topArtists),
          fetchCommunityPlaylistsForYou(topArtists)
        ]);
        
        if (!isCancelled) {
          if (albums.length > 0) {
            setAlbumsForYou(albums);
            setLocalCache(CACHE_KEYS.ALBUMS, albums);
          }
          if (community.length > 0) {
            setCommunityPlaylists(community);
            setLocalCache(CACHE_KEYS.COMMUNITY, community);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch albums or community playlists:', err);
      }
    };

    fetchPlaylistsAndAlbums();

    return () => {
      isCancelled = true;
    };
  }, [playHistory, favorites, currentTrack]);

  // 8. Fetch "Similar to [Playlist Name]"
  useEffect(() => {
    let isCancelled = false;
    
    const fetchSimilar = async () => {
      const personalPlaylists = playlists.filter(p => p.tracks.length > 0);
      const seedPlaylist = personalPlaylists.length > 0 
        ? personalPlaylists.sort((a, b) => b.tracks.length - a.tracks.length)[0]
        : (allUserTracks.length > 0 ? { id: 'def-pl', name: topArtists[0] || 'Your Taste', tracks: allUserTracks.slice(0, 5) } : null);

      if (!seedPlaylist || seedPlaylist.tracks.length === 0) return;

      const seedName = seedPlaylist.name;
      const seedKey = `${seedName}|${seedPlaylist.tracks.length}|${topArtists.join('-')}`;
      if (lastSimilarFetchRef.current === seedKey && similarPlaylists.length > 0) return;
      lastSimilarFetchRef.current = seedKey;

      setSeedPlaylistName(seedName);
      setLocalCache(CACHE_KEYS.SEED_PL_NAME, seedName);

      try {
        const similar = await fetchSimilarPlaylists(seedPlaylist);
        if (!isCancelled && similar.length > 0) {
          setSimilarPlaylists(similar);
          setLocalCache(CACHE_KEYS.SIMILAR, similar);
        }
      } catch (err) {
        console.warn('Failed to fetch similar playlists:', err);
      }
    };

    fetchSimilar();

    return () => {
      isCancelled = true;
    };
  }, [playlists, favorites, playHistory, topArtists]);

  return (
    <div style={{ paddingBottom: '100px', position: 'relative' }}>
      
      {/* Header Info */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 4px 0' }}>
            Listen Now
          </h2>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Welcome back to OwO Music Player. Handpicked favorites and smart recommendations.
          </span>
        </div>
      </div>

      {/* Speed Dial Section (Auto-generated grid of top played) */}
      {/* Speed Dial Section (Auto-generated grid of top played) */}
      {defaultSpeedDial.length > 0 ? (
        <SpeedDialGrid 
          tracks={defaultSpeedDial} 
          currentTrack={currentTrack}
          onTrackClick={(track) => {
            setQueue([track], 0, `${track.title} Mix`);
            setIsPlaying(true);
          }}
          onArtistClick={(artistName) => {
            navigate(`/artist/${encodeURIComponent(artistName)}`);
          }}
        />
      ) : (
        <div style={{ color: 'var(--text-secondary)', marginBottom: '40px', padding: '24px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          Your dashboard is empty. Search and play some tracks to populate your Speed Dial!
        </div>
      )}

      {/* Quick Picks Carousel (4 Rows, YouTube Music High-Density Compact Layout) */}
      {displayQuickPicks.length > 0 && (
        <Carousel 
          title="Quick picks"
          subtitle="Start radio or pick a favorite track"
          icon={<Radio size={20} color="var(--accent-primary)" />}
          items={displayQuickPicks}
          rows={4}
          columnWidth="minmax(340px, 380px)"
          gap="6px"
          actionButton={
            <button 
              onClick={() => {
                setQueue(displayQuickPicks, 0, 'Quick Picks');
                setIsPlaying(true);
              }}
              className="play-all-pill-btn"
              title="Play all tracks in Quick Picks"
            >
              <Play size={13} fill="currentColor" />
              <span>Play all</span>
            </button>
          }
          renderItem={(track) => {
            const isPlayingThis = isSameTrack(currentTrack, track);
            const isFav = favorites.some(f => f.id === track.id);
            
            return (
              <div 
                key={`quick-pick-${track.id}`}
                className={`quick-pick-row ${isPlayingThis ? 'playing' : ''}`}
                onClick={() => {
                  setQueue([track], 0, `${track.title} Mix`);
                  setIsPlaying(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  backgroundColor: isPlayingThis ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                  position: 'relative'
                }}
              >
                {/* Image Cover with Hover Play Icon */}
                <div 
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '6px',
                    backgroundImage: `url(${track.cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    position: 'relative',
                    flexShrink: 0,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    overflow: 'hidden'
                  }}
                >
                  <div 
                    className="quick-pick-play-overlay"
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      display: isPlayingThis ? 'flex' : 'none',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Play size={16} fill="white" color="white" />
                  </div>
                </div>

                {/* Track Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div 
                    style={{ 
                      fontWeight: 600, 
                      fontSize: '0.88rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: isPlayingThis ? 'var(--accent-primary)' : 'var(--text-primary)',
                      lineHeight: '1.2'
                    }}
                  >
                    {track.title}
                  </div>
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/artist/${encodeURIComponent(track.artist)}${track.artistId ? `?artistId=${encodeURIComponent(track.artistId)}` : (track.channelId ? `?channelId=${encodeURIComponent(track.channelId)}` : '')}`);
                    }}
                    style={{ 
                      fontSize: '0.78rem', 
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: '3px',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                  >
                    {track.artist}
                  </div>
                </div>

                {/* Right Actions: Favorite Heart + 3-Dots Menu */}
                <div 
                  className="quick-pick-actions"
                  style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      toggleFavorite(track);
                      showToast(isFav ? 'Removed from Liked Songs' : 'Added to Liked Songs');
                    }}
                    title={isFav ? 'Remove from liked songs' : 'Like'}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isFav ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      padding: '6px',
                      cursor: 'pointer',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isFav ? 1 : 0,
                      transition: 'opacity 0.15s ease, color 0.15s ease'
                    }}
                    className="quick-pick-heart-btn"
                  >
                    <Heart size={16} fill={isFav ? 'var(--accent-primary)' : 'none'} />
                  </button>

                  <TrackOptionsMenu track={track} variant="row" className="quick-pick-menu-btn" />
                </div>
              </div>
            );
          }}
        />
      )}

      {/* Dynamic Recommendation: Similar to [Recent Artist] */}
      {recommendedTracks.length > 0 && (
        <Carousel 
          title={`More by ${recommendedArtist}`}
          subtitle="Based on your recent listening history"
          icon={<Music size={20} color="var(--accent-primary)" />}
          items={recommendedTracks}
          renderItem={(track) => (
            <div 
              key={`rec-${track.id}`}
              className="album-card"
              onClick={() => {
                setQueue([track], 0, `${track.title} Mix`);
                setIsPlaying(true);
              }}
            >
              <div 
                className="album-art" 
                style={{ backgroundImage: `url(${track.cover})`, position: 'relative' }}
              >
                <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                <TrackOptionsMenu track={track} variant="card" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }} />
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
          )}
        />
      )}

      {/* Dynamic Recommendation: Covers and Remixes */}
      {coversAndRemixes.length > 0 && (
        <Carousel 
          title="Covers & Remixes"
          subtitle="Alternative versions of tracks you love"
          icon={<Sparkles size={20} color="var(--accent-primary)" />}
          items={coversAndRemixes}
          renderItem={(track) => (
            <div 
              key={`cover-${track.id}`}
              className="album-card"
              onClick={() => {
                setQueue([track], 0, `${track.title} Mix`);
                setIsPlaying(true);
              }}
            >
              <div 
                className="album-art" 
                style={{ backgroundImage: `url(${track.cover})`, position: 'relative' }}
              >
                <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                <TrackOptionsMenu track={track} variant="card" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }} />
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
          )}
        />
      )}

      {/* Albums For You Carousel */}
      {albumsForYou.length > 0 && (
        <Carousel 
          title="Albums for You"
          subtitle="Official releases based on your top artists"
          icon={<ListMusic size={20} color="var(--accent-primary)" />}
          items={albumsForYou}
          renderItem={(item) => (
            <div 
              key={`album-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.author} • {item.trackCount || (item as any).videoCount || 10} tracks</div>
            </div>
          )}
        />
      )}

      {/* Similar Playlists & Mixes Carousel */}
      {similarPlaylists.length > 0 && (
        <Carousel 
          title={`Similar to ${seedPlaylistName ? `"${seedPlaylistName}"` : 'Your Taste'}`}
          subtitle="Playlists & mixes exploring similar artists"
          icon={<ListMusic size={20} color="var(--accent-primary)" />}
          items={similarPlaylists}
          renderItem={(item) => (
            <div 
              key={`similar-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.author} • {item.trackCount || (item as any).videoCount || 25} tracks</div>
            </div>
          )}
        />
      )}

      {/* From The Community Carousel */}
      {communityPlaylists.length > 0 && (
        <Carousel 
          title="From the Community"
          subtitle="Curated mixes matching your taste"
          icon={<ListMusic size={20} color="var(--accent-primary)" />}
          items={communityPlaylists}
          renderItem={(item) => (
            <div 
              key={`community-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.author} • {item.trackCount || (item as any).videoCount || 15} tracks</div>
            </div>
          )}
        />
      )}

      {/* Forgotten Favorites Carousel */}
      {forgottenFavorites.length > 0 && (
        <Carousel 
          title="Forgotten Favorites"
          subtitle="Rediscover tracks you haven't played in a while"
          icon={<RotateCcw size={20} color="var(--accent-primary)" />}
          items={forgottenFavorites}
          renderItem={(track) => (
            <div 
              key={`forgotten-${track.id}`}
              className="album-card"
              onClick={() => {
                setQueue([track], 0, `${track.title} Mix`);
                setIsPlaying(true);
              }}
            >
              <div 
                className="album-art" 
                style={{ backgroundImage: `url(${track.cover})`, position: 'relative' }}
              >
                <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                <TrackOptionsMenu track={track} variant="card" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }} />
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
          )}
        />
      )}

      {/* From Your Library */}
      {(playlists.length > 0 || favorites.length > 0) && (
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <ListMusic size={20} color="var(--accent-primary)" />
            <h3 className="section-header" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              From Your Library
            </h3>
          </div>

          <div className="cards-grid">
            {/* Playlist Cards */}
            {playlists.slice(0, 4).map((pl) => (
              <div 
                key={`lib-pl-${pl.id}`}
                className="album-card"
                onClick={() => navigate('/library?tab=playlists')}
              >
                <div 
                  className="album-art" 
                  style={{ 
                    backgroundImage: `url(${pl.tracks[0]?.cover || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80'})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <ListMusic size={32} color="rgba(255,255,255,0.7)" />
                </div>
                <div className="album-title">{pl.name}</div>
                <div className="album-artist">{pl.tracks.length} tracks</div>
              </div>
            ))}

            {/* Favorite Playlist Card */}
            {favorites.length > 0 && (
              <div 
                className="album-card"
                onClick={() => navigate('/library?tab=songs')}
              >
                <div 
                  className="album-art" 
                  style={{ 
                    backgroundImage: `url(${favorites[0].cover})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Heart size={32} color="rgba(231, 76, 60, 0.8)" fill="rgba(231, 76, 60, 0.8)" />
                </div>
                <div className="album-title">Liked Songs</div>
                <div className="album-artist">{favorites.length} songs</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
