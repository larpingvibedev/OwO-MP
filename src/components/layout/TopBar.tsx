import { useState, useEffect, useRef } from 'react';
import { Search, ChevronLeft, ChevronRight, Loader2, Terminal, Sparkles, Palette, X } from 'lucide-react';
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
    theme,
    rustyColor,
    setTheme,
    setRustyColor,
    downloadingTrackIds,
    closePlayerDrawer
  } = usePlayerStore();

  const activeDownloadKeys = Object.keys(downloadingTrackIds || {});
  const activeDownloadCount = activeDownloadKeys.length;
  const activeDownloadPercent = activeDownloadCount > 0 
    ? Math.round(activeDownloadKeys.reduce((acc, k) => acc + (downloadingTrackIds[k] || 0), 0) / activeDownloadCount)
    : 0;

  // Handle local query state to avoid lagging the input
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [textSuggestions, setTextSuggestions] = useState<string[]>([]);
  const [entitySuggestions, setEntitySuggestions] = useState<SuggestionEntity[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Sync when searchQuery is updated from external (e.g. clicking a recent search chip)
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalQuery(val);
    setIsDropdownOpen(true);
  };

  const handleClear = () => {
    setLocalQuery('');
    setSearchQuery('');
    setSearchResults([]);
    setArtistProfile(null);
    setTextSuggestions([]);
    setEntitySuggestions([]);
  };

  const handleToggleTheme = () => {
    setTheme(theme === 'rusty' ? 'default' : 'rusty');
  };

  const cycleRustyColor = (e: React.MouseEvent) => {
    e.stopPropagation();
    const colors: Array<'green' | 'amber' | 'cyan' | 'rust'> = ['green', 'amber', 'cyan', 'rust'];
    const nextIdx = (colors.indexOf(rustyColor) + 1) % colors.length;
    setRustyColor(colors[nextIdx]);
  };

  // Live Suggestions Fetcher (Snappy ~100ms debounce)
  useEffect(() => {
    if (!localQuery.trim()) {
      setTextSuggestions([]);
      setEntitySuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    setIsSuggestionsLoading(true);
    const controller = new AbortController();

    const sugTimer = setTimeout(async () => {
      try {
        const { textSuggestions: ts, entitySuggestions: es } = await getSearchSuggestions(localQuery, controller.signal);
        if (!controller.signal.aborted) {
          setTextSuggestions(ts);
          setEntitySuggestions(es);
          setIsSuggestionsLoading(false);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setIsSuggestionsLoading(false);
        }
      }
    }, 100);

    return () => {
      clearTimeout(sugTimer);
      controller.abort();
    };
  }, [localQuery]);

  // Full Search Submitter (Runs search on Enter or selection, keeping results persistent while typing)
  const handleSearchSubmit = async (queryToSearch?: string) => {
    const q = (queryToSearch !== undefined ? queryToSearch : localQuery).trim();
    if (!q) {
      handleClear();
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
      // 1. Run ultra-fast hybrid search (< 350ms)
      const { tracks, profileCandidate } = await searchFreeMusic(q);
      setSearchResults(tracks);

      // 2. Resolve artist profile in parallel
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

  // Sync external searchQuery changes (e.g. clicking chip in Discover)
  const lastExecutedQueryRef = useRef<string>('');
  useEffect(() => {
    if (searchQuery && searchQuery !== lastExecutedQueryRef.current) {
      lastExecutedQueryRef.current = searchQuery;
      setLocalQuery(searchQuery);
      handleSearchSubmit(searchQuery);
    }
  }, [searchQuery]);

  // Dropdown query selection
  const handleSelectQuery = (query: string) => {
    closePlayerDrawer();
    handleSearchSubmit(query);
  };

  // Dropdown entity selection (Direct play / navigate)
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
      setQueue([track], 0, `${track.title} Mix`);
      setIsPlaying(true);
      addRecentSearchedTrack(track);
    } else {
      handleSearchSubmit(entity.title);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSubmit();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  return (
    <header className="top-bar">
      <div className="nav-controls">
        <button className="nav-btn" onClick={() => navigate(-1)} title="Go back">
          <ChevronLeft size={20} />
        </button>
        <button className="nav-btn" onClick={() => navigate(1)} title="Go forward">
          <ChevronRight size={20} />
        </button>
      </div>
      
      <div 
        ref={searchContainerRef} 
        className="search-container" 
        style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
      >
        {isSearching || isSuggestionsLoading ? (
          <Loader2 size={18} className="search-icon animate-spin" style={{ color: 'var(--accent-primary)' }} />
        ) : (
          <Search size={18} className="search-icon" color="var(--text-secondary)" />
        )}
        <input 
          type="text" 
          className="search-input" 
          placeholder="Search tracks, albums, artists..." 
          value={localQuery}
          onChange={handleInputChange}
          onFocus={() => setIsDropdownOpen(true)}
          onKeyDown={handleKeyDown}
          style={{ paddingRight: (localQuery || searchQuery) ? '36px' : '16px' }}
        />
        {(localQuery || searchQuery) && (
          <button
            onClick={handleClear}
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
              cursor: 'pointer'
            }}
          >
            <X size={14} />
          </button>
        )}

        {/* YouTube Music Style Search Dropdown Overlay */}
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

      <div className="topbar-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {theme === 'rusty' && (
          <button 
            className="theme-color-btn"
            onClick={cycleRustyColor}
            title={`Current Accent: ${rustyColor.toUpperCase()} (Click to cycle)`}
            style={{
              padding: '6px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              borderRadius: '4px',
              border: '1px solid var(--accent-primary)',
              color: 'var(--accent-primary)',
              background: 'rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Palette size={14} />
            <span>[{rustyColor}]</span>
          </button>
        )}

        <button 
          className={`theme-toggle-btn ${theme === 'rusty' ? 'active-rusty' : ''}`}
          onClick={handleToggleTheme}
          title={theme === 'rusty' ? 'Switch to Modern UI' : 'Switch to Rusty TUI (Retro / Hacker)'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: theme === 'rusty' ? '0px' : '20px',
            border: '1px solid var(--border-color)',
            backgroundColor: theme === 'rusty' ? 'var(--accent-primary)' : 'var(--bg-card)',
            color: theme === 'rusty' ? '#000000' : 'var(--text-primary)',
            fontSize: '0.8rem',
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
        >
          {theme === 'rusty' ? <Terminal size={16} /> : <Sparkles size={16} color="var(--accent-primary)" />}
          <span>{theme === 'rusty' ? 'RUSTY TUI' : 'Rusty UI'}</span>
        </button>

        {/* Global Download Progress Indicator */}
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
            <span>{activeDownloadCount === 1 ? `Saving... ${activeDownloadPercent}%` : `${activeDownloadCount} songs (${activeDownloadPercent}%)`}</span>
          </div>
        )}

        <UserProfileButton onOpenDeviceModal={onOpenDeviceModal || (() => {})} />
      </div>
    </header>
  );
}
