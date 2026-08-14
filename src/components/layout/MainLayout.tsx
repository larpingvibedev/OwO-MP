import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomPlayer } from '../player/BottomPlayer';
import { AudioPlayer } from '../AudioPlayer';
import { PlayerDrawer } from '../player/PlayerDrawer';

import { usePlayerStore } from '../../store/usePlayerStore';

export function MainLayout() {
  const { theme, rustyColor } = usePlayerStore();
  const themeClass = theme === 'rusty' ? `theme-rusty rusty-${rustyColor}` : 'theme-default';

  return (
    <div className={`app-container ${themeClass}`}>
      {/* Invisible HTML5 Audio Handler */}
      <AudioPlayer />

      <div className="main-wrapper">
        <Sidebar />
        
        <div className="content-area">
          <TopBar />
          
          <main className="main-scroll-view">
            <Outlet />
          </main>
        </div>

        <PlayerDrawer />
      </div>

      <BottomPlayer />
    </div>
  );
}
