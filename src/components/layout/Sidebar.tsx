import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Home, 
  Search, 
  Library, 
  Settings, 
  Menu, 
  Plus, 
  Heart, 
  Sparkles, 
  Check,
  Download,
  Folder
} from 'lucide-react';
import { usePlayerStore } from '../../store/usePlayerStore';

import { PlaylistCover } from '../common/PlaylistCover';
import { useContextMenuStore } from '../../store/useContextMenuStore';
import { ImportPlaylistModal } from '../common/ImportPlaylistModal';
import appLogo from '../../assets/app_logo.png';

export function Sidebar() {
  const navigate = useNavigate();
  const { openPlaylistContextMenu } = useContextMenuStore();
  const { 
    isSidebarCollapsed, 
    toggleSidebar, 
    playlists, 
    localPlaylistMetadata,
    favorites, 
    createPlaylist,
    closePlayerDrawer
  } = usePlayerStore();

  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [quickPlaylistName, setQuickPlaylistName] = useState('');

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPlaylistName.trim()) return;
    const newId = createPlaylist(quickPlaylistName.trim());
    setQuickPlaylistName('');
    setShowQuickCreate(false);
    closePlayerDrawer();
    navigate(`/playlist/${newId}`);
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
          <NavLink 
            to="/" 
            className="sidebar-logo" 
            onClick={() => closePlayerDrawer()} 
          >
            <img 
              src={appLogo} 
              alt="OwO" 
              className="brand-logo-img"
            />
            <span className="brand-text">
              Music
            </span>
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

        <NavLink 
          to="/local-files" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Local Files"
          onClick={() => closePlayerDrawer()}
        >
          <Folder size={22} className="icon" />
          {!isSidebarCollapsed && <span className="nav-label">Local Files</span>}
        </NavLink>
      </nav>

      {/* Expanded Only: "+ New Playlist" & Scrollable Custom Playlists */}
      {!isSidebarCollapsed && (
        <div className="sidebar-library-section">
          <div className="sidebar-divider" />

          {/* Clean Single New Playlist Pill Button */}
          <button 
            className="sidebar-new-playlist-btn"
            onClick={() => setShowQuickCreate(prev => !prev)}
            title="Create a new playlist"
          >
            <Plus size={18} />
            <span>New playlist</span>
          </button>

          {/* Inline Quick Playlist Drawer / Form */}
          {showQuickCreate && (
            <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <form onSubmit={handleCreatePlaylist} className="sidebar-quick-create-form" style={{ margin: 0 }}>
                <input 
                  type="text" 
                  placeholder="Playlist name..."
                  value={quickPlaylistName}
                  onChange={(e) => setQuickPlaylistName(e.target.value)}
                  autoFocus
                  className="sidebar-quick-input"
                />
                <button 
                  type="submit" 
                  className={`sidebar-quick-submit-btn ${quickPlaylistName.trim() ? 'is-visible' : ''}`}
                  disabled={!quickPlaylistName.trim()}
                  title="Create Playlist"
                >
                  <Check size={13} strokeWidth={2.5} />
                </button>
              </form>

              {/* Seamless Import Option */}
              <button
                type="button"
                onClick={() => {
                  setShowQuickCreate(false);
                  setShowImportModal(true);
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px dashed rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                }}
              >
                <Download size={13} color="var(--accent-primary)" />
                <span>Or import from Spotify / YouTube</span>
              </button>
            </div>
          )}

          {/* Scrollable Playlist List (YouTube Music / Spotify Style) */}
          <div className="sidebar-playlists-scroll">
            {/* Auto-Playlist: Liked Music */}
            <NavLink 
              to="/playlist/liked"
              className={({ isActive }) => `sidebar-playlist-item ${isActive ? 'active' : ''}`}
              title="Liked Music"
              onClick={() => closePlayerDrawer()}
              onContextMenu={(e) => openPlaylistContextMenu(e, {
                id: 'liked',
                name: 'Liked Music',
                tracks: favorites
              })}
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
            {playlists.map((pl) => {
              const count = Array.isArray(pl?.tracks) ? pl.tracks.length : 0;
              return (
                <NavLink 
                  key={pl.id}
                  to={`/playlist/${pl.id}`}
                  className={({ isActive }) => `sidebar-playlist-item ${isActive ? 'active' : ''}`}
                  title={pl.name}
                  onClick={() => closePlayerDrawer()}
                  onContextMenu={(e) => openPlaylistContextMenu(e, pl)}
                >
                  <div className="playlist-item-icon-box" style={{ padding: 0, overflow: 'hidden' }}>
                    <PlaylistCover 
                      playlistId={pl.id}
                      tracks={pl.tracks} 
                      cover={pl.cover} 
                      coverId={localPlaylistMetadata?.[pl.id]?.coverId ?? pl.coverId}
                      name={pl.name} 
                      size={36} 
                      borderRadius={4} 
                      fallbackIconSize={14} 
                    />
                  </div>
                  <div className="playlist-item-meta">
                    <span className="playlist-name">{pl.name || 'Playlist'}</span>
                    <span className="playlist-sub">
                      Playlist • {count} {count === 1 ? 'song' : 'songs'}
                    </span>
                  </div>
                </NavLink>
              );
            })}
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

      {/* Import Playlist Modal */}
      <ImportPlaylistModal 
        isOpen={showImportModal} 
        onClose={() => setShowImportModal(false)} 
      />
    </aside>
  );
}
