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
  fetchSimilarPlaylists,
  fetchNewReleases,
  fetchDailyDiscover,
  getDirectYouTubeId
} from '../services/musicSearch';

const CACHE_KEYS = {
  REC_TRACKS: 'owo_dash_rec_tracks_v2',
  REC_ARTIST: 'owo_dash_rec_artist_v2',
  COVERS: 'owo_dash_covers_remixes_v3',
  ALBUMS: 'owo_dash_albums_v3',
  COMMUNITY: 'owo_dash_community_v3',
  SIMILAR: 'owo_dash_similar',
  SEED_PL_NAME: 'owo_dash_seed_pl_name',
  NEW_RELEASES: 'owo_dash_new_releases_v7',
  DAILY_DISCOVER: 'owo_dash_daily_discover_v3',
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
    dislikedTracks, 
    blockedArtists, 
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
  const [newReleases, setNewReleases] = useState<PublicPlaylist[]>(() => 
    getLocalCache<PublicPlaylist[]>(CACHE_KEYS.NEW_RELEASES, [])
  );
  const [dailyDiscover, setDailyDiscover] = useState<Track[]>(() => 
    getLocalCache<Track[]>(CACHE_KEYS.DAILY_DISCOVER, [])
  );
  
  // Refs to throttle redundant background fetches
  const lastArtistFetchRef = useRef<string>('');
  const lastCoversFetchRef = useRef<string>('');
  const lastAlbumsFetchRef = useRef<string>('');
  const lastSimilarFetchRef = useRef<string>('');
  const lastNewReleasesFetchRef = useRef<string>('');
  const lastDailyDiscoverFetchRef = useRef<string>('');

  // When play history is explicitly reset, clear history-specific recommendations
  useEffect(() => {
    if (!playHistory || Object.keys(playHistory).length === 0) {
      setRecommendedTracks([]);
      setCoversAndRemixes([]);
      setRecommendedArtist('');
      setSeedPlaylistName('');
      lastArtistFetchRef.current = '';
      lastCoversFetchRef.current = '';
      lastSimilarFetchRef.current = '';
    }
  }, [playHistory]);

  // Helper to filter out not interested / blocked tracks and artists
  const isTrackBlocked = (t: Track) => {
    if (!t) return true;
    const aLower = (t.artist || '').toLowerCase().trim();
    const isArtistBlocked = (blockedArtists || []).some(b => b && (aLower === b.toLowerCase() || aLower.includes(b.toLowerCase())));
    const isDisliked = (dislikedTracks || []).some(d => isSameTrack(d, t));
    return isArtistBlocked || isDisliked;
  };

  // 1. Get Speed Dial & Quick Picks tracks (deduplicated by Title + Artist, excluding blocked items)
  const historyArray = Object.values(playHistory || {}).filter(h => h.track && !isTrackBlocked(h.track));
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
  const defaultSpeedDial = speedDialTracks.length > 0 ? speedDialTracks : favorites.filter(t => !isTrackBlocked(t)).slice(0, 9);

  // 2. Get Quick Picks (recent listening habits)
  const quickPicksTracks = Array.from(uniqueHistoryMap.values())
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 20)
    .map(h => h.track);

  // Fallback for quick picks
  const displayQuickPicks = quickPicksTracks.length > 0 ? quickPicksTracks : favorites.filter(t => !isTrackBlocked(t));

  // 3. Universal User Seed Resolution (History -> Favorites -> Playlists -> Current -> Discovery)
  const allUserTracks: Track[] = [
    ...historyArray.map(h => h.track),
    ...favorites.filter(t => !isTrackBlocked(t)),
    ...playlists.flatMap(p => p.tracks).filter(t => !isTrackBlocked(t)),
    ...(currentTrack && !isTrackBlocked(currentTrack) ? [currentTrack] : [])
  ];

  // Group user tracks by artist
  const artistTrackMap = new Map<string, Track[]>();
  historyArray.forEach(h => {
    if (!h.track?.artist) return;
    const art = h.track.artist;
    if (!artistTrackMap.has(art)) {
      artistTrackMap.set(art, []);
    }
    artistTrackMap.get(art)!.push(h.track);
  });

  const allUserArtists = Array.from(
    new Set(allUserTracks.map(t => t.artist).filter(Boolean))
  );

  const topArtists = allUserArtists.length > 0 
    ? allUserArtists.slice(0, 5) 
    : ['bunii', 'slayr', 'jaydes', 'nettspend'];

  // Top distinct covers for Supermix collage
  const collageCovers = Array.from(
    new Set(
      allUserTracks.map(t => t.cover).filter(c => c && !c.includes('default') && !c.includes('placeholder'))
    )
  ).slice(0, 4);

  const fallbackCollage = [
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80'
  ];
  const finalCollage = collageCovers.length >= 4 ? collageCovers : [...collageCovers, ...fallbackCollage].slice(0, 4);

  // 4. Get Forgotten Favorites (favorites not played in the last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const forgottenFavorites = favorites.filter(fav => {
    if (isTrackBlocked(fav)) return false;
    const historyItem = playHistory[fav.id];
    if (!historyItem) return true; // Never played but favorited!
    return historyItem.lastPlayedAt < sevenDaysAgo;
  }).slice(0, 15);

  // 5. Fetch dynamic recommendations based on multiple artists across listening history
  useEffect(() => {
    let isCancelled = false;

    const fetchMultiArtistRecs = async () => {
      // Clean and aggregate artist weights across play history (splitting collabs like "A & B")
      const artistCounts: Record<string, number> = {};
      historyArray.forEach(h => {
        const rawArtist = h.track?.artist || '';
        const split = rawArtist.split(/&|,|\bfeat\.?\b|\bft\.?\b|\bwith\b/i).map(s => s.trim()).filter(Boolean);
        split.forEach(a => {
          if (a.length > 1 && !a.toLowerCase().includes('unknown')) {
            artistCounts[a] = (artistCounts[a] || 0) + (h.playCount || 1);
          }
        });
      });

      const sorted = Object.entries(artistCounts)
        .sort((a, b) => b[1] - a[1])
        .map(e => e[0])
        .filter(a => a.toLowerCase() !== 'various artists');

      const targetArtists = (sorted.length > 0)
        ? sorted.slice(0, 4)
        : (allUserArtists.length > 0 ? allUserArtists.slice(0, 4) : ['bunii', 'DC The Don', 'slayr', 'Kid Moon']);

      const seedKey = targetArtists.join('|');
      if (lastArtistFetchRef.current === seedKey && recommendedTracks.length > 0) return;
      lastArtistFetchRef.current = seedKey;

      const artistDisplay = targetArtists.slice(0, 3).join(', ');
      setRecommendedArtist(artistDisplay);
      setLocalCache(CACHE_KEYS.REC_ARTIST, artistDisplay);

      try {
        const batches = await Promise.allSettled(
          targetArtists.map(art => fetchArtistDeepTracks(art))
        );

        const merged: Track[] = [];
        const seenIds = new Set<string>();

        // Interleave tracks across artists for a rich 20-track collection
        for (let i = 0; i < 6; i++) {
          batches.forEach(b => {
            if (b.status === 'fulfilled' && Array.isArray(b.value) && b.value[i]) {
              const t = b.value[i];
              if (!seenIds.has(t.id) && !isTrackBlocked(t)) {
                seenIds.add(t.id);
                merged.push(t);
              }
            }
          });
        }

        if (!isCancelled && merged.length > 0) {
          setRecommendedTracks(merged.slice(0, 20));
          setLocalCache(CACHE_KEYS.REC_TRACKS, merged.slice(0, 20));
        }
      } catch (err) {
        console.warn('Failed to fetch multi-artist recommendations:', err);
      }
    };

    fetchMultiArtistRecs();

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

  // 7. Fetch "Albums for you" and "From the community" (Public User Playlists)
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
  }, [playHistory, favorites, currentTrack, topArtists]);

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

  // 9. Fetch "New Releases" (Albums & Singles from Explore)
  useEffect(() => {
    let isCancelled = false;

    const fetchReleases = async () => {
      const seedKey = topArtists.join('|');
      if (lastNewReleasesFetchRef.current === seedKey && newReleases.length > 0) return;
      lastNewReleasesFetchRef.current = seedKey;

      try {
        const rels = await fetchNewReleases(topArtists);
        if (!isCancelled && rels.length > 0) {
          setNewReleases(rels);
          setLocalCache(CACHE_KEYS.NEW_RELEASES, rels);
        }
      } catch (err) {
        console.warn('Failed to fetch new releases:', err);
      }
    };

    fetchReleases();

    return () => {
      isCancelled = true;
    };
  }, [playHistory, favorites, topArtists]);

  // 10. Fetch "Your Daily Discover"
  useEffect(() => {
    let isCancelled = false;

    const fetchDiscover = async () => {
      const topHistory = [...historyArray].sort((a, b) => b.playCount - a.playCount);
      const topTracks = topHistory.map(h => h.track);
      const seedTracks = topTracks.length > 0 ? topTracks.slice(0, 5) : (displayQuickPicks.length > 0 ? displayQuickPicks.slice(0, 5) : []);
      const seedKey = seedTracks.map(t => t.id || t.title).join('|');
      if (lastDailyDiscoverFetchRef.current === seedKey && dailyDiscover.length > 0) return;
      lastDailyDiscoverFetchRef.current = seedKey;

      const playedIds = new Set(Object.keys(playHistory || {}));
      const favoriteIds = new Set(favorites.map(f => f.id || f.title));
      try {
        const tracks = await fetchDailyDiscover(seedTracks, playedIds, favoriteIds);
        if (!isCancelled && tracks.length > 0) {
          setDailyDiscover(tracks);
          setLocalCache(CACHE_KEYS.DAILY_DISCOVER, tracks);
        }
      } catch (err) {
        console.warn('Failed to fetch daily discover tracks:', err);
      }
    };

    fetchDiscover();

    return () => {
      isCancelled = true;
    };
  }, [playHistory, favorites, displayQuickPicks]);

  // Authentic YouTube Music "Mixed for You" Stations with Real Thumbnails & Collages
  const dynamicMixes = [
    {
      id: 'mix-1',
      stripeTitle: 'My Mix',
      stripeNumber: '01',
      title: 'My Mix 1',
      subtitle: [topArtists[0], topArtists[1], topArtists[2], topArtists[3]].filter(Boolean).join(', '),
      cover: artistTrackMap.get(topArtists[0])?.[0]?.cover || displayQuickPicks[0]?.cover || finalCollage[0],
      covers: undefined,
      onPlay: () => {
        const seed = artistTrackMap.get(topArtists[0])?.[0] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'My Mix 1');
          setIsPlaying(true);
          showToast('Playing My Mix 1');
        }
      }
    },
    {
      id: 'supermix',
      stripeTitle: 'My',
      stripeNumber: 'Supermix',
      title: 'My Supermix',
      subtitle: [topArtists[0], topArtists[1], topArtists[2], topArtists[3]].filter(Boolean).join(', '),
      cover: undefined,
      covers: finalCollage,
      onPlay: () => {
        if (displayQuickPicks.length > 0) {
          setQueue(displayQuickPicks, 0, 'My Supermix');
          setIsPlaying(true);
          showToast('Playing My Supermix');
        }
      }
    },
    {
      id: 'mix-2',
      stripeTitle: 'My Mix',
      stripeNumber: '02',
      title: 'My Mix 2',
      subtitle: [topArtists[1] || 'Fresh Sound', topArtists[2], topArtists[0]].filter(Boolean).join(', '),
      cover: artistTrackMap.get(topArtists[1])?.[0]?.cover || displayQuickPicks[1]?.cover || finalCollage[1],
      covers: undefined,
      onPlay: () => {
        const seed = artistTrackMap.get(topArtists[1])?.[0] || displayQuickPicks[1] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'My Mix 2');
          setIsPlaying(true);
          showToast('Playing My Mix 2');
        }
      }
    },
    {
      id: 'mix-3',
      stripeTitle: 'My Mix',
      stripeNumber: '03',
      title: 'My Mix 3',
      subtitle: [topArtists[2] || 'Alternative', topArtists[3], topArtists[1]].filter(Boolean).join(', '),
      cover: artistTrackMap.get(topArtists[2])?.[0]?.cover || dailyDiscover[0]?.cover || finalCollage[2],
      covers: undefined,
      onPlay: () => {
        const seed = artistTrackMap.get(topArtists[2])?.[0] || dailyDiscover[0] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'My Mix 3');
          setIsPlaying(true);
          showToast('Playing My Mix 3');
        }
      }
    },
    {
      id: 'mix-4',
      stripeTitle: 'My Mix',
      stripeNumber: '04',
      title: 'My Mix 4',
      subtitle: [topArtists[3] || 'Vibes', topArtists[0], topArtists[2]].filter(Boolean).join(', '),
      cover: artistTrackMap.get(topArtists[3])?.[0]?.cover || coversAndRemixes[0]?.cover || finalCollage[3],
      covers: undefined,
      onPlay: () => {
        const seed = artistTrackMap.get(topArtists[3])?.[0] || coversAndRemixes[0] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'My Mix 4');
          setIsPlaying(true);
          showToast('Playing My Mix 4');
        }
      }
    },
    {
      id: 'chill-mix',
      stripeTitle: 'Chill',
      stripeNumber: 'Mix',
      title: 'Chill Mix',
      subtitle: 'Mellow grooves & relaxing soundscapes',
      cover: coversAndRemixes[0]?.cover || displayQuickPicks[2]?.cover || finalCollage[0],
      covers: undefined,
      onPlay: () => {
        const seed = coversAndRemixes[0] || displayQuickPicks[2] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'Chill Mix');
          setIsPlaying(true);
          showToast('Playing Chill Mix');
        }
      }
    },
    {
      id: 'energy-mix',
      stripeTitle: 'Energy',
      stripeNumber: 'Mix',
      title: 'Energy Mix',
      subtitle: 'High tempo beats & hype tracks',
      cover: defaultSpeedDial[0]?.cover || displayQuickPicks[0]?.cover || finalCollage[1],
      covers: undefined,
      onPlay: () => {
        const seed = defaultSpeedDial[0] || displayQuickPicks[0];
        if (seed) {
          setQueue([seed], 0, 'Energy Mix');
          setIsPlaying(true);
          showToast('Playing Energy Mix');
        }
      }
    }
  ];

  return (
    <div style={{ paddingBottom: '120px', position: 'relative' }}>
      
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

      {/* Mixed for You Carousel (YouTube Music Style with Real Artwork & Metallic Stripes) */}
      <Carousel 
        title="Mixed for you"
        items={dynamicMixes}
        renderItem={(mix) => (
          <div 
            key={`dyn-mix-${mix.id}`}
            className="ytm-mix-card"
            onClick={mix.onPlay}
          >
            <div className="ytm-mix-art-wrapper">
              {mix.covers && mix.covers.length >= 4 ? (
                <div className="ytm-mix-collage">
                  <img src={mix.covers[0]} alt="" />
                  <img src={mix.covers[1]} alt="" />
                  <img src={mix.covers[2]} alt="" />
                  <img src={mix.covers[3]} alt="" />
                </div>
              ) : (
                <div 
                  className="ytm-mix-single-art" 
                  style={{ backgroundImage: `url(${mix.cover})` }}
                />
              )}
              <div className="ytm-mix-badge-top">
                <Play size={11} fill="white" color="white" style={{ marginLeft: '1px' }} />
              </div>
              <div className="ytm-mix-stripe">
                <span className="ytm-mix-stripe-title">{mix.stripeTitle}</span>
                <span className="ytm-mix-stripe-number">{mix.stripeNumber}</span>
              </div>
              <div className="card-play-overlay">
                <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
              </div>
            </div>
            <div className="ytm-mix-title">{mix.title}</div>
            <div className="ytm-mix-subtitle" title={mix.subtitle}>{mix.subtitle}</div>
          </div>
        )}
      />



      {/* From The Community Carousel (Real Public YouTube Playlists) */}
      {communityPlaylists.length > 0 && (
        <Carousel 
          title="From the community"
          items={communityPlaylists}
          renderItem={(item) => (
            <div 
              key={`community-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.description || (item.author ? `${item.author} • Playlist` : 'Public Playlist')}</div>
            </div>
          )}
        />
      )}

      {/* New Releases Carousel */}
      {newReleases.length > 0 && (
        <Carousel 
          title="New releases"
          items={newReleases}
          renderItem={(item) => (
            <div 
              key={`release-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.description || (item.author ? `Single • ${item.author}` : 'New Release')}</div>
            </div>
          )}
        />
      )}

      {/* Dynamic Recommendation: Your Daily Discover */}
      {dailyDiscover.filter(t => !isTrackBlocked(t)).length > 0 && (
        <Carousel 
          title="Your daily discover"
          subtitle="New music tailored to your listening taste"
          icon={<Sparkles size={20} color="var(--accent-primary)" />}
          columnWidth="220px"
          gap="16px"
          actionButton={
            <button 
              className="ytm-play-all-pill-btn"
              onClick={() => {
                const unblocked = dailyDiscover.filter(t => !isTrackBlocked(t));
                if (unblocked.length > 0) {
                  setQueue(unblocked, 0, 'Daily Discover');
                  setIsPlaying(true);
                  showToast('Playing Daily Discover');
                }
              }}
            >
              <Play size={14} fill="currentColor" />
              Play all
            </button>
          }
          items={dailyDiscover.filter(t => !isTrackBlocked(t))}
          renderItem={(track) => (
            <div 
              key={`discover-${track.id}`}
              className="daily-discover-card"
              onClick={() => {
                const unblocked = dailyDiscover.filter(t => !isTrackBlocked(t));
                setQueue([track, ...unblocked.filter(t => t.id !== track.id)], 0, 'Daily Discover');
                setIsPlaying(true);
              }}
            >
              <img 
                src={track.cover || `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`} 
                alt={track.title} 
                className="daily-discover-bg"
                loading="lazy"
                onError={(e) => {
                  const fallback = `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`;
                  if ((e.currentTarget as HTMLImageElement).src !== fallback) {
                    (e.currentTarget as HTMLImageElement).src = fallback;
                  } else {
                    (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                  }
                }}
              />
              <div className="daily-discover-gradient" />
              <div className="daily-discover-top">
                <div className="daily-discover-title">{track.title}</div>
                <div className="daily-discover-artist">{track.artist} • {track.playCountText || '1.2M plays'}</div>
              </div>
              <div className="card-play-overlay">
                <Play size={24} fill="currentColor" style={{ marginLeft: '3px' }} />
              </div>
              <div className="daily-discover-bottom">
                <div className="daily-discover-reason">{track.recommendReason || `Sounds like ${track.title}`}</div>
              </div>
            </div>
          )}
        />
      )}

      {/* Dynamic Recommendation: Based on listening history */}
      {recommendedTracks.filter(t => !isTrackBlocked(t)).length > 0 && (
        <Carousel 
          title="Recommended for you"
          subtitle={recommendedArtist ? `Featuring ${recommendedArtist}` : 'Based on your listening history'}
          icon={<Music size={20} color="var(--accent-primary)" />}
          items={recommendedTracks.filter(t => !isTrackBlocked(t))}
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
                style={{ overflow: 'hidden', backgroundColor: 'var(--bg-card)', position: 'relative' }}
              >
                <img 
                  src={track.cover || `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`} 
                  alt={track.title} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => {
                    const fallback = `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`;
                    if ((e.currentTarget as HTMLImageElement).src !== fallback) {
                      (e.currentTarget as HTMLImageElement).src = fallback;
                    } else {
                      (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                    }
                  }}
                />
                <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                <TrackOptionsMenu track={track} variant="card" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }} />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
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
      {coversAndRemixes.filter(t => !isTrackBlocked(t)).length > 0 && (
        <Carousel 
          title="Covers & Remixes"
          subtitle="Alternative versions and remixes of tracks you love"
          icon={<Sparkles size={20} color="var(--accent-primary)" />}
          items={coversAndRemixes.filter(t => !isTrackBlocked(t))}
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
                style={{ overflow: 'hidden', backgroundColor: 'var(--bg-card)', position: 'relative' }}
              >
                <img 
                  src={track.cover || `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`} 
                  alt={track.title} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => {
                    const fallback = `https://i.ytimg.com/vi/${getDirectYouTubeId(track)}/hqdefault.jpg`;
                    if ((e.currentTarget as HTMLImageElement).src !== fallback) {
                      (e.currentTarget as HTMLImageElement).src = fallback;
                    } else {
                      (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
                    }
                  }}
                />
                <AddToQueueButton track={track} variant="card-overlay" position="top-right" />
                <TrackOptionsMenu track={track} variant="card" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }} />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
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
          title="Albums for you"
          subtitle="Official releases based on your top artists"
          icon={<ListMusic size={20} color="var(--accent-primary)" />}
          items={albumsForYou}
          renderItem={(item) => (
            <div 
              key={`album-${item.id}`}
              className="album-card"
              onClick={() => navigate(`/album/${item.playlistId || item.id}?name=${encodeURIComponent(item.name || (item as any).title || '')}&artist=${encodeURIComponent(item.author || '')}&cover=${encodeURIComponent(item.cover || '')}`)}
            >
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
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
              <div className="album-art" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-main)', position: 'relative' }}>
                <img 
                  src={item.cover} 
                  alt={item.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80'; }}
                />
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
              </div>
              <div className="album-title">{item.name || (item as any).title}</div>
              <div className="album-artist">{item.author} • {item.trackCount || (item as any).videoCount || 25} tracks</div>
            </div>
          )}
        />
      )}

      {/* Forgotten Favorites Carousel */}
      {forgottenFavorites.length > 0 && (
        <Carousel 
          title="Forgotten favorites"
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
                <div className="card-play-overlay">
                  <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                </div>
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
              From your library
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
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                >
                  <ListMusic size={32} color="rgba(255,255,255,0.7)" />
                  <div className="card-play-overlay">
                    <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                  </div>
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
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                >
                  <Heart size={32} color="rgba(231, 76, 60, 0.8)" fill="rgba(231, 76, 60, 0.8)" />
                  <div className="card-play-overlay">
                    <Play size={20} fill="currentColor" style={{ marginLeft: '3px' }} />
                  </div>
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
