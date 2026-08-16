import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Discover } from './pages/Discover';
import { Artist } from './pages/Artist';
import { Album } from './pages/Album';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { AuthModal } from './components/auth/AuthModal';
import { EditProfileModal } from './components/auth/EditProfileModal';
import { DeviceConnectModal } from './components/connect/DeviceConnectModal';
import { useAuthStore } from './store/useAuthStore';
import { usePlayerStore } from './store/usePlayerStore';
import { supabaseSync } from './services/supabaseSyncService';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { GlobalContextMenu } from './components/common/GlobalContextMenu';
import './App.css';

function App() {
  const { initAuth, user } = useAuthStore();
  const syncOfflineTracks = usePlayerStore(s => s.syncOfflineTracks);
  const [showDeviceModal, setShowDeviceModal] = useState(false);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (user) {
      supabaseSync.startSync();
    } else {
      supabaseSync.stopSync();
    }
  }, [user]);

  // Expose global openDeviceModal handler and live disk file sync
  useEffect(() => {
    (window as any).__openDeviceModal = () => setShowDeviceModal(true);

    if ((window as any).electronAPI?.onDiskFolderChanged) {
      const cleanup = (window as any).electronAPI.onDiskFolderChanged(() => {
        syncOfflineTracks();
      });
      return cleanup;
    }
  }, [syncOfflineTracks]);

  return (
    <ErrorBoundary>
      <AuthModal />
      <EditProfileModal />
      <DeviceConnectModal isOpen={showDeviceModal} onClose={() => setShowDeviceModal(false)} />
      <GlobalContextMenu />
      
      <Routes>
        <Route path="/" element={<MainLayout onOpenDeviceModal={() => setShowDeviceModal(true)} />}>
          <Route index element={<Dashboard />} />
          <Route path="discover" element={<Discover />} />
          <Route path="library" element={<Library />} />
          <Route path="albums" element={<Library />} />
          <Route path="playlists" element={<Library />} />
          <Route path="favorites" element={<Library />} />
          <Route path="downloads" element={<Library />} />
          <Route path="settings" element={<Settings />} />
          <Route path="artist/:artistName" element={<Artist />} />
          <Route path="album/:albumId" element={<Album />} />
          <Route path="playlist/:albumId" element={<Album />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
