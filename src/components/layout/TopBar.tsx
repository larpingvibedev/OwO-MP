import { useState, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Loader2, Terminal, Sparkles, Palette } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayerStore } from '../../store/usePlayerStore';
import { searchFreeMusic, fetchArtistProfile } from '../../services/musicSearch';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    searchQuery, 
    setSearchQuery, 
    setSearchResults, 
    setArtistProfile,
    setIsSearching, 
    isSearching,
    theme,
    rustyColor,
    setTheme,
    setRustyColor
  } = usePlayerStore();

  // Handle local query state to avoid lagging the input
  const [localQuery, setLocalQuery] = useState(searchQuery);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalQuery(val);
    if (val.trim() && location.pathname !== '/discover') {
      navigate('/discover');
    }
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

  useEffect(() => {
    if (!localQuery.trim()) {
      setSearchResults([]);
      setArtistProfile(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      setSearchQuery(localQuery);
      const results = await searchFreeMusic(localQuery);
      const qClean = localQuery.trim().toLowerCase();
      const topResultChannelId = results.find(t => (t.artist.toLowerCase() === qClean || t.albumArtist?.toLowerCase() === qClean) && t.channelId)?.channelId || results[0]?.channelId;
      const profile = await fetchArtistProfile(localQuery, topResultChannelId);

      setSearchResults(results);
      setArtistProfile(profile);
      setIsSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [localQuery, setSearchQuery, setSearchResults, setArtistProfile, setIsSearching]);

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
      
      <div className="search-container">
        {isSearching ? (
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
      </div>
    </header>
  );
}
