import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Discover } from './pages/Discover';
import { SyncModal } from './components/SyncModal';

import { Artist } from './pages/Artist';
import { Album } from './pages/Album';
import { Library } from './pages/Library';
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
          <Route path="library" element={<Library />} />
          <Route path="albums" element={<Library />} />
          <Route path="playlists" element={<Library />} />
          <Route path="favorites" element={<Library />} />
          <Route path="downloads" element={<Library />} />
          <Route path="settings" element={<Settings />} />
          <Route path="artist/:artistName" element={<Artist />} />
          <Route path="album/:albumId" element={<Album />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
