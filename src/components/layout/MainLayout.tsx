import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomPlayer } from '../player/BottomPlayer';
import { AudioPlayer } from '../AudioPlayer';
import { PlayerDrawer } from '../player/PlayerDrawer';
import { Toast } from '../common/Toast';

import { usePlayerStore } from '../../store/usePlayerStore';

export function MainLayout() {
  const location = useLocation();
  const { theme, rustyColor, isPlayerDrawerOpen, closePlayerDrawer } = usePlayerStore();
  const themeClass = theme === 'rusty' ? `theme-rusty rusty-${rustyColor}` : 'theme-default';

  // Universally close the full viewer player drawer whenever any navigation occurs
  useEffect(() => {
    if (isPlayerDrawerOpen) {
      closePlayerDrawer();
    }
  }, [location.pathname, location.search]);

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

          <PlayerDrawer />
        </div>
      </div>

      <Toast />
      <BottomPlayer />
    </div>
  );
}
