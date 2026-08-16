import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomPlayer } from '../player/BottomPlayer';
import { AudioPlayer } from '../AudioPlayer';
import { PlayerDrawer } from '../player/PlayerDrawer';
import { Toast } from '../common/Toast';

import { usePlayerStore } from '../../store/usePlayerStore';

interface MainLayoutProps {
  onOpenDeviceModal?: () => void;
}

export function MainLayout({ onOpenDeviceModal }: MainLayoutProps) {
  const location = useLocation();
  const { isPlayerDrawerOpen, closePlayerDrawer } = usePlayerStore();

  // Universally close the full viewer player drawer whenever any navigation occurs
  useEffect(() => {
    if (isPlayerDrawerOpen) {
      closePlayerDrawer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return (
    <div className="app-container">
      {/* Invisible HTML5 Audio Handler */}
      <AudioPlayer />

      <div className="main-wrapper">
        <Sidebar />
        
        <div className="content-area">
          <TopBar onOpenDeviceModal={onOpenDeviceModal} />
          
          <main className="main-scroll-view">
            <Outlet />
          </main>

          <PlayerDrawer onOpenDeviceModal={onOpenDeviceModal} />
        </div>
      </div>

      <Toast />
      <BottomPlayer onOpenDeviceModal={onOpenDeviceModal} />
    </div>
  );
}
