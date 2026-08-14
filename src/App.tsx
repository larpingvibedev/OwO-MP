import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Discover } from './pages/Discover';
import { SyncModal } from './components/SyncModal';

import { Artist } from './pages/Artist';
import { Album } from './pages/Album';
import { Favorites } from './pages/Favorites';
import { Albums } from './pages/Albums';
import { Playlists } from './pages/Playlists';
import { Settings } from './pages/Settings';
import './App.css';

function App() {
  const [showSyncModal, setShowSyncModal] = React.useState(false);

  return (
    <>
      {showSyncModal && <SyncModal onClose={() => setShowSyncModal(false)} />}
      
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="discover" element={<Discover />} />
          <Route path="albums" element={<Albums />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="favorites" element={<Favorites />} />
          <Route path="downloads" element={<Favorites />} />
          <Route path="settings" element={<Settings />} />
          <Route path="artist/:artistName" element={<Artist />} />
          <Route path="album/:albumId" element={<Album />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
