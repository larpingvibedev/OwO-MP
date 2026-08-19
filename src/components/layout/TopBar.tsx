import { useState, useEffect, useRef } from 'react';
import { Search, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import { searchFreeMusic, fetchArtistProfile, getSearchSuggestions } from '../../services/musicSearch';
import { SearchDropdown } from '../search/SearchDropdown';
import { UserProfileButton } from '../auth/UserProfileButton';
import type { SuggestionEntity, Track } from '../../types';

interface TopBarProps {
  onOpenDeviceModal?: () => void;
}

export function TopBar({ onOpenDeviceModal }: TopBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    searchQuery, 
    setSearchQuery, 
    setSearchResults, 
    setArtistProfile,
    setIsSearching, 
    isSearching,
    recentSearchQueries,
    addRecentSearchQuery,
    removeRecentSearchQuery,
    addRecentSearchedTrack,
    setQueue,
    setIsPlaying,
    downloadingTrackIds,
    isPlayerDrawerOpen,
    closePlayerDrawer
  } = usePlayerStore();

  const activeDownloadKeys = Object.keys(downloadingTrackIds || {});
  const activeDownloadCount = activeDownloadKeys.length;
  const activeDownloadPercent = activeDownloadCount > 0 
    ? Math.round(activeDownloadKeys.reduce((acc, k) => acc + (downloadingTrackIds[k] || 0), 0) / activeDownloadCount)
    : 0;

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [textSuggestions, setTextSuggestions] = useState<string[]>([]);
  const [entitySuggestions, setEntitySuggestions] = useState<SuggestionEntity[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalQuery(val);
    if (!isDropdownOpen) setIsDropdownOpen(true);
  };

  const handleSearchSubmit = async (queryToSearch?: string) => {
    const q = (queryToSearch !== undefined ? queryToSearch : localQuery).trim();
    if (!q) {
      handleClearSearch();
      return;
    }

    closePlayerDrawer();
    setIsDropdownOpen(false);
    setLocalQuery(q);
    setSearchQuery(q);
    addRecentSearchQuery(q);
    setIsSearching(true);

    if (location.pathname !== '/discover') {
      navigate('/discover');
    }

    try {
      const { tracks, profileCandidate } = await searchFreeMusic(q);
      setSearchResults(tracks);

      const qClean = q.toLowerCase();
      const topResultChannelId = profileCandidate?.channelId ||
        tracks.find(t => (t.artist.toLowerCase() === qClean || t.albumArtist?.toLowerCase() === qClean) && t.channelId)?.channelId ||
        tracks[0]?.channelId;

      const profile = await fetchArtistProfile(profileCandidate?.name || q, topResultChannelId);
      setArtistProfile(profile);
    } catch (err) {
      console.warn('Search submit warning:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectQuery = (q: string) => {
    handleSearchSubmit(q);
  };

  const handleSelectEntity = (entity: SuggestionEntity) => {
    closePlayerDrawer();
    setIsDropdownOpen(false);
    addRecentSearchQuery(entity.title);

    if (entity.type === 'artist') {
      const channelParam = entity.browseId ? `?channelId=${encodeURIComponent(entity.browseId)}` : '';
      navigate(`/artist/${encodeURIComponent(entity.title)}${channelParam}`);
    } else if (entity.type === 'song') {
      const track: Track = {
        id: entity.videoId || `sug-${Date.now()}`,
        title: entity.title,
        artist: entity.artist || entity.subtitle.split('•')?.[1]?.trim() || '',
        duration: 0,
        cover: entity.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        streamUrl: entity.videoId ? `https://www.youtube.com/watch?v=${entity.videoId}` : '',
        source: 'youtube'
      };
      setQueue([track], 0, `${track.title} Mix`, true, 'finite');
      setIsPlaying(true);
      addRecentSearchedTrack(track);
    } else {
      handleSearchSubmit(entity.title);
    }
  };

  const handleClearSearch = () => {
    setLocalQuery('');
    setSearchQuery('');
    setSearchResults([]);
    setArtistProfile(null);
    setTextSuggestions([]);
    setEntitySuggestions([]);
  };

  useEffect(() => {
    if (!localQuery.trim()) {
      setTextSuggestions([]);
      setEntitySuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    setIsSuggestionsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { textSuggestions: texts, entitySuggestions: entities } = await getSearchSuggestions(localQuery);
        setTextSuggestions(texts);
        setEntitySuggestions(entities);
      } catch (err) {
        console.warn('Suggestions error:', err);
      } finally {
        setIsSuggestionsLoading(false);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [localQuery]);

  return (
    <header className="top-bar">
      <div className="nav-controls">
        <button 
          className="nav-btn" 
          onClick={() => {
            if (isPlayerDrawerOpen) {
              closePlayerDrawer();
            } else {
              navigate(-1);
            }
          }} 
          title={isPlayerDrawerOpen ? "Close Full Player" : "Go Back"}
          aria-label={isPlayerDrawerOpen ? "Close Full Player" : "Go Back"}
        >
          <ChevronLeft size={20} />
        </button>
        <button 
          className="nav-btn" 
          onClick={() => navigate(1)} 
          title="Go Forward"
          aria-label="Go Forward"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div 
        ref={searchContainerRef} 
        className="search-container" 
        style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
      >
        {isSearching || isSuggestionsLoading ? (
          <Loader2 size={18} className="search-icon animate-spin" style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        ) : (
          <Search size={18} className="search-icon" color="var(--text-secondary)" style={{ flexShrink: 0 }} />
        )}
        <input 
          type="text" 
          className="search-input" 
          placeholder="Search tracks, albums, artists..." 
          value={localQuery}
          onChange={handleSearchChange}
          onFocus={() => setIsDropdownOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSearchSubmit();
            } else if (e.key === 'Escape') {
              setIsDropdownOpen(false);
            }
          }}
          style={{ paddingRight: localQuery ? '36px' : '16px' }}
        />
        {localQuery && (
          <button
            type="button"
            onClick={handleClearSearch}
            title="Clear search"
            style={{
              position: 'absolute',
              right: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              transition: 'all 0.2s',
              cursor: 'pointer',
              border: 'none'
            }}
          >
            <X size={14} />
          </button>
        )}

        <SearchDropdown
          isOpen={isDropdownOpen}
          query={localQuery}
          recentQueries={recentSearchQueries || []}
          textSuggestions={textSuggestions}
          entitySuggestions={entitySuggestions}
          isLoading={isSuggestionsLoading}
          onSelectQuery={handleSelectQuery}
          onRemoveRecentQuery={removeRecentSearchQuery}
          onSelectEntity={handleSelectEntity}
          onClose={() => setIsDropdownOpen(false)}
        />
      </div>

      <div className="topbar-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {activeDownloadCount > 0 && (
          <div 
            onClick={() => {
              closePlayerDrawer();
              navigate('/library?tab=downloads');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '20px',
              background: 'rgba(255, 0, 127, 0.12)',
              border: '1px solid var(--accent-primary)',
              color: 'var(--accent-primary)',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 0 12px rgba(255, 0, 127, 0.25)'
            }}
            title="Active offline download in progress (Click to view Library Downloads)"
          >
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            <span>{activeDownloadCount === 1 ? `Downloading (${activeDownloadPercent}%)` : `Downloading (${activeDownloadCount} active • ${activeDownloadPercent}%)`}</span>
          </div>
        )}

        <UserProfileButton onOpenDeviceModal={onOpenDeviceModal || (() => {})} />
      </div>
    </header>
  );
}
