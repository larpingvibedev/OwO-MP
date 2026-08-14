import { NavLink } from 'react-router-dom';
import { 
  Home, 
  Search, 
  Library, 
  ListMusic, 
  Settings,
  Disc3,
  Heart,
  Download
} from 'lucide-react';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Disc3 className="icon" size={28} color="var(--accent-primary)" />
        OwO Player
      </div>
      
      <nav className="sidebar-nav">
        <NavLink 
          to="/" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          end
        >
          <Home size={20} className="icon" />
          <span>Dashboard</span>
        </NavLink>
        <NavLink 
          to="/discover" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Search size={20} className="icon" />
          <span>Discover</span>
        </NavLink>
        
        <div className="nav-section-title">Your Library</div>
        <NavLink 
          to="/albums" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Library size={20} className="icon" />
          <span>Albums</span>
        </NavLink>
        <NavLink 
          to="/playlists" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <ListMusic size={20} className="icon" />
          <span>Playlists</span>
        </NavLink>
        <NavLink 
          to="/favorites" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Heart size={20} className="icon" />
          <span>Favorites</span>
        </NavLink>
        <NavLink 
          to="/downloads" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Download size={20} className="icon" />
          <span>Downloads</span>
        </NavLink>
        
        <div className="nav-section-title">System</div>
        <NavLink 
          to="/settings" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Settings size={20} className="icon" />
          <span>Settings</span>
        </NavLink>
      </nav>
    </aside>
  );
}
