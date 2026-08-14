import { useState } from 'react';
import { Wifi, CheckCircle2, ShieldCheck, Database, Terminal, Palette, Sparkles } from 'lucide-react';
import { SyncModal } from '../components/SyncModal';
import { usePlayerStore } from '../store/usePlayerStore';

export function Settings() {
  const [showSyncModal, setShowSyncModal] = useState(false);
  const { theme, rustyColor, setTheme, setRustyColor } = usePlayerStore();

  const colorPresets: Array<{ id: 'green' | 'amber' | 'cyan' | 'rust'; label: string; hex: string }> = [
    { id: 'green', label: 'Matrix CRT Green', hex: '#00ff66' },
    { id: 'amber', label: 'Phosphor Amber', hex: '#ffb000' },
    { id: 'cyan', label: 'Cyberpunk Cyan', hex: '#00e5ff' },
    { id: 'rust', label: 'Classic Rust Orange', hex: '#ff5722' },
  ];

  return (
    <div style={{ paddingBottom: '32px', maxWidth: '800px' }}>
      {showSyncModal && <SyncModal onClose={() => setShowSyncModal(false)} />}

      <h2 className="section-header">Settings & Preferences</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Appearance & Rusty Theme Card */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
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
                fontSize: '0.9rem'
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
                fontSize: '0.9rem'
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
                      fontWeight: 600
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
        {/* Device Sync Card */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
          padding: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: '1px solid var(--border-color)'
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

        {/* Audio Engine */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
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
            <span>Active (Universal Topic Resolver Enabled)</span>
          </div>
        </div>

        {/* Local Storage Database */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
          padding: '24px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
            <Database size={20} color="var(--accent-primary)" />
            <span>Local Database Storage</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Your liked songs, custom playlists, queue state, and volume settings are automatically saved to local storage.
          </p>
          <button 
            className="secondary-btn"
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            style={{ color: '#ff4757', fontSize: '0.85rem', fontWeight: 500 }}
          >
            Clear Saved Data & Reset
          </button>
        </div>
      </div>
    </div>
  );
}
