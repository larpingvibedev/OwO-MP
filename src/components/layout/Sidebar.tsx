import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Home, 
  Search, 
  Library, 
  Settings, 
  Disc3, 
  Menu, 
  Plus, 
  Heart, 
  ListMusic, 
  Sparkles,
  Check
} from 'lucide-react';
import { usePlayerStore } from '../../store/usePlayerStore';

export function Sidebar() {
  const navigate = useNavigate();
  const { 
    isSidebarCollapsed, 
    toggleSidebar, 
    playlists, 
    favorites, 
    createPlaylist,
    closePlayerDrawer
  } = usePlayerStore();

  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickPlaylistName, setQuickPlaylistName] = useState('');

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPlaylistName.trim()) return;
    createPlaylist(quickPlaylistName.trim());
    setQuickPlaylistName('');
    setShowQuickCreate(false);
    closePlayerDrawer();
    navigate('/library?tab=playlists');
  };

  return (
    <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : 'expanded'}`}>
      {/* Top Header: Hamburger Toggle + Brand */}
      <div className="sidebar-header">
        <button 
          className="sidebar-hamburger-btn" 
          onClick={toggleSidebar}
          title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label="Toggle navigation"
        >
          <Menu size={22} />
        </button>

        {!isSidebarCollapsed && (
          <NavLink to="/" className="sidebar-logo" onClick={() => closePlayerDrawer()}>
            <Disc3 className="brand-disc-icon" size={24} color="var(--accent-primary)" />
            <span className="brand-text">OwO Music</span>
          </NavLink>
        )}
      </div>

      {/* Primary Navigation Icons / Links */}
      <nav className="sidebar-nav">
        <NavLink 
          to="/" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Home"
          onClick={() => closePlayerDrawer()}
          end
        >
          <Home size={22} className="icon" />
          {!isSidebarCollapsed && <span className="nav-label">Home</span>}
        </NavLink>

        <NavLink 
          to="/discover" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Discover"
          onClick={() => closePlayerDrawer()}
        >
          <Search size={22} className="icon" />
          {!isSidebarCollapsed && <span className="nav-label">Discover</span>}
        </NavLink>

        <NavLink 
          to="/library" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Library"
          onClick={() => closePlayerDrawer()}
        >
          <Library size={22} className="icon" />
          {!isSidebarCollapsed && <span className="nav-label">Library</span>}
        </NavLink>
      </nav>

      {/* Expanded Only: "+ New Playlist" & Scrollable Custom Playlists */}
      {!isSidebarCollapsed && (
        <div className="sidebar-library-section">
          <div className="sidebar-divider" />

          {/* New Playlist Action Button */}
          <button 
            className="sidebar-new-playlist-btn"
            onClick={() => setShowQuickCreate(prev => !prev)}
            title="Create a new playlist"
          >
            <Plus size={18} />
            <span>New playlist</span>
          </button>

          {/* Inline Quick Playlist Input */}
          {showQuickCreate && (
            <form onSubmit={handleCreatePlaylist} className="sidebar-quick-create-form">
              <input 
                type="text" 
                placeholder="Playlist name..."
                value={quickPlaylistName}
                onChange={(e) => setQuickPlaylistName(e.target.value)}
                autoFocus
                className="sidebar-quick-input"
              />
              <button type="submit" className="sidebar-quick-submit-btn">
                <Check size={14} />
              </button>
            </form>
          )}

          {/* Scrollable Playlist List (YouTube Music / Spotify Style) */}
          <div className="sidebar-playlists-scroll">
            {/* Auto-Playlist: Liked Music */}
            <NavLink 
              to="/library?tab=songs"
              className={({ isActive }) => `sidebar-playlist-item ${isActive ? 'active' : ''}`}
              title="Liked Music"
              onClick={() => closePlayerDrawer()}
            >
              <div className="playlist-item-icon-box liked-box">
                <Heart size={13} fill="#ffffff" color="#ffffff" />
              </div>
              <div className="playlist-item-meta">
                <span className="playlist-name">Liked Music</span>
                <span className="playlist-sub auto-tag">
                  <Sparkles size={10} color="var(--accent-primary)" /> Auto playlist • {favorites.length}
                </span>
              </div>
            </NavLink>

            {/* Custom User Playlists */}
            {playlists.map((pl) => (
              <NavLink 
                key={pl.id}
                to={`/library?tab=playlists`}
                className="sidebar-playlist-item"
                title={pl.name}
                onClick={() => closePlayerDrawer()}
              >
                <div className="playlist-item-icon-box">
                  <ListMusic size={14} color="var(--text-secondary)" />
                </div>
                <div className="playlist-item-meta">
                  <span className="playlist-name">{pl.name}</span>
                  <span className="playlist-sub">
                    Playlist • {pl.tracks.length} {pl.tracks.length === 1 ? 'song' : 'songs'}
                  </span>
                </div>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Bottom System Settings */}
      <div className="sidebar-footer">
        <NavLink 
          to="/settings" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Settings"
          onClick={() => closePlayerDrawer()}
        >
          <Settings size={22} className="icon" />
          {!isSidebarCollapsed && <span className="nav-label">Settings</span>}
        </NavLink>
      </div>
    </aside>
  );
}
