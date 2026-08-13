import React, { useState } from 'react';
import { Wifi, Smartphone, Laptop, Check, Copy } from 'lucide-react';
import { syncManager } from '../services/syncService';

interface SyncModalProps {
  onClose: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({ onClose }) => {
  const [roomCode, setRoomCode] = useState('MY-NUCLEAR-CAR');
  const [isConnected, setIsConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConnect = () => {
    if (!roomCode.trim()) return;
    syncManager.joinRoom(roomCode, () => {
      setIsConnected(true);
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(12px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '16px',
        width: '440px',
        padding: '32px',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Wifi className="icon" size={28} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Device Sync (Spotify Connect Style)</h2>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.5 }}>
          Enter the same Sync Room Code on your Windows PC and your Android Phone to sync music playback, progress, and playlists in real time.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Sync Room Code
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              style={{
                flex: 1,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '10px 16px',
                color: 'white',
                fontWeight: 600,
                letterSpacing: '1px'
              }}
            />
            <button 
              onClick={handleCopy}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '0 12px',
                color: 'var(--text-secondary)'
              }}
            >
              {copied ? <Check size={18} color="var(--accent-primary)" /> : <Copy size={18} />}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <Laptop size={16} /> Windows PC
          </div>
          <span style={{ color: 'var(--text-muted)' }}>⇄</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <Smartphone size={16} /> Android / Car
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
              fontWeight: 500
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleConnect}
            style={{
              background: isConnected ? 'linear-gradient(135deg, #2b9348, #55a630)' : 'var(--accent-gradient)',
              padding: '10px 24px',
              borderRadius: '8px',
              color: 'white',
              fontWeight: 600,
              boxShadow: '0 4px 12px var(--accent-glow)'
            }}
          >
            {isConnected ? 'Sync Active!' : 'Connect Devices'}
          </button>
        </div>
      </div>
    </div>
  );
};
