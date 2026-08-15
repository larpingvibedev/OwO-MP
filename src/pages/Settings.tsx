import { useState } from 'react';
import { 
  Wifi, 
  CheckCircle2, 
  ShieldCheck, 
  Database, 
  Terminal, 
  Palette, 
  Sparkles,
  History,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Check
} from 'lucide-react';
import { SyncModal } from '../components/SyncModal';
import { usePlayerStore } from '../store/usePlayerStore';

export function Settings() {
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [searchesCleared, setSearchesCleared] = useState(false);

  const { 
    theme, 
    rustyColor, 
    setTheme, 
    setRustyColor,
    clearListeningHistoryAndPreferences,
    clearRecentSearchQueries,
    clearRecentSearchedTracks,
    showToast,
    playHistory,
    recentSearchQueries
  } = usePlayerStore();

  const historyCount = Object.keys(playHistory || {}).length;
  const searchCount = (recentSearchQueries || []).length;

  const colorPresets: Array<{ id: 'green' | 'amber' | 'cyan' | 'rust'; label: string; hex: string }> = [
    { id: 'green', label: 'Matrix CRT Green', hex: '#00ff66' },
    { id: 'amber', label: 'Phosphor Amber', hex: '#ffb000' },
    { id: 'cyan', label: 'Cyberpunk Cyan', hex: '#00e5ff' },
    { id: 'rust', label: 'Classic Rust Orange', hex: '#ff5722' },
  ];

  const handleClearHistory = () => {
    clearListeningHistoryAndPreferences();
    setHistoryCleared(true);
    showToast('Listening history & recommendations cleared (Clean Slate)');
    setTimeout(() => setHistoryCleared(false), 3000);
  };

  const handleClearSearches = () => {
    clearRecentSearchQueries();
    clearRecentSearchedTracks();
    setSearchesCleared(true);
    showToast('Search history cleared');
    setTimeout(() => setSearchesCleared(false), 3000);
  };

  const handleFactoryReset = () => {
    try {
      localStorage.clear();
      window.location.href = '/';
    } catch (e) {
      window.location.reload();
    }
  };

  return (
    <div style={{ paddingBottom: '48px', maxWidth: '820px' }}>
      {showSyncModal && <SyncModal onClose={() => setShowSyncModal(false)} />}

      {/* Confirmation Modal for Factory Reset */}
      {showConfirmReset && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid rgba(255, 71, 87, 0.4)',
            borderRadius: '12px',
            padding: '28px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ff4757', marginBottom: '12px' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Factory Reset Everything?</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: '1.5', marginBottom: '24px' }}>
              This will permanently delete all your <strong>custom playlists</strong>, <strong>liked songs</strong>, <strong>saved albums</strong>, <strong>history</strong>, and <strong>preferences</strong>. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="secondary-btn"
                onClick={() => setShowConfirmReset(false)}
                style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                style={{
                  backgroundColor: '#ff4757',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
              >
                Erase Everything & Reset
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="section-header">Settings & Preferences</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* ========================================================================= */}
        {/* 1. CLEAN SLATE & LISTENING HISTORY                                        */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.15rem' }}>
              <History size={22} color="var(--accent-primary)" />
              <span>Listening History & Recommendation Privacy</span>
            </div>
            <span style={{ 
              fontSize: '0.75rem', 
              padding: '3px 10px', 
              borderRadius: '12px', 
              backgroundColor: 'rgba(52, 152, 219, 0.12)', 
              color: 'var(--accent-primary)',
              fontWeight: 600
            }}>
              Clean Slate Tools
            </span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.45' }}>
            Wipe your listening habits, speed dial cards, quick picks, and algorithmic taste profiles to start fresh with a clean slate. Your personal created playlists and liked songs will remain untouched.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Primary Clean Slate Button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  Clear Listening History & Reset Recommendations
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Resets Speed Dial, Quick Picks, and all Dashboard recommendation carousels ({historyCount} recorded songs).
                </div>
              </div>

              <button
                onClick={handleClearHistory}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 18px',
                  borderRadius: '20px',
                  backgroundColor: historyCleared ? 'rgba(46, 204, 113, 0.2)' : 'rgba(52, 152, 219, 0.15)',
                  border: `1px solid ${historyCleared ? '#2ecc71' : 'var(--accent-primary)'}`,
                  color: historyCleared ? '#2ecc71' : 'var(--accent-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {historyCleared ? <Check size={16} /> : <RotateCcw size={16} />}
                <span>{historyCleared ? 'Clean Slate Activated!' : 'Clear History & Recommendations'}</span>
              </button>
            </div>

            {/* Clear Search History Button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Clear Search History & Queries
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Removes recent search queries and clicked search items ({searchCount} recent searches).
                </div>
              </div>

              <button
                onClick={handleClearSearches}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '16px',
                  backgroundColor: searchesCleared ? 'rgba(46, 204, 113, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${searchesCleared ? '#2ecc71' : 'var(--border-color)'}`,
                  color: searchesCleared ? '#2ecc71' : 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {searchesCleared ? <Check size={14} /> : <Trash2 size={14} />}
                <span>{searchesCleared ? 'Cleared' : 'Clear Searches'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. APPEARANCE & THEME MODE                                                */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <Palette size={20} color="var(--accent-primary)" />
            <span>Interface Mode & Theme</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Switch between the modern player design and the retro, hacker-style "Rusty" TUI inspired by terminal music players.
          </p>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setTheme('default')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                borderRadius: '6px',
                border: `2px solid ${theme === 'default' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                backgroundColor: theme === 'default' ? 'rgba(52, 152, 219, 0.15)' : 'var(--bg-main)',
                color: theme === 'default' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <Sparkles size={18} color="var(--accent-primary)" />
              <span>Modern Sleek (Default)</span>
            </button>

            <button
              onClick={() => setTheme('rusty')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                borderRadius: '6px',
                border: `2px solid ${theme === 'rusty' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                backgroundColor: theme === 'rusty' ? 'rgba(0, 255, 102, 0.15)' : 'var(--bg-main)',
                color: theme === 'rusty' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <Terminal size={18} color="var(--accent-primary)" />
              <span>Rusty TUI (Retro / Hacker)</span>
            </button>
          </div>

          {theme === 'rusty' && (
            <div style={{
              paddingTop: '16px',
              borderTop: '1px dashed var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Terminal Phosphor Accent Color:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {colorPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setRustyColor(preset.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 14px',
                      borderRadius: '4px',
                      border: `1px solid ${rustyColor === preset.id ? preset.hex : 'var(--border-color)'}`,
                      backgroundColor: rustyColor === preset.id ? 'rgba(0,0,0,0.6)' : 'var(--bg-main)',
                      color: rustyColor === preset.id ? preset.hex : 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: preset.hex,
                      boxShadow: `0 0 6px ${preset.hex}`
                    }} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 3. MULTI-DEVICE SYNC                                                      */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: '1px solid var(--border-color)',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
              <Wifi size={20} color="var(--accent-primary)" />
              <span>Multi-Device Sync</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Connect your PC and Mobile phone to control playback remotely (Spotify Connect Style).
            </p>
          </div>
          <button className="hero-play-btn" onClick={() => setShowSyncModal(true)}>
            Open Sync Modal
          </button>
        </div>

        {/* ========================================================================= */}
        {/* 4. AUDIO ENGINE INTEGRATION                                               */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <ShieldCheck size={20} color="var(--accent-secondary)" />
            <span>Official Audio Stream Resolver</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Always stream 100% official YouTube Music studio topic releases, filtering out music videos and fan visualizers.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
            <CheckCircle2 size={16} />
            <span>Active (Universal Studio Topic Resolver Enabled)</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. DATABASE STORAGE & FACTORY RESET                                       */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <Database size={20} color="var(--accent-primary)" />
            <span>Local Database Storage & Reset</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Your liked songs, custom playlists, queue state, and volume settings are saved to browser local storage.
          </p>
          <button 
            className="secondary-btn"
            onClick={() => setShowConfirmReset(true)}
            style={{ 
              color: '#ff4757', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              borderColor: 'rgba(255, 71, 87, 0.3)'
            }}
          >
            <Trash2 size={15} />
            <span>Factory Reset All Data</span>
          </button>
        </div>
      </div>
    </div>
  );
}
