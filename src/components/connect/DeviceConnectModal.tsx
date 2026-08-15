import React, { useEffect, useState } from 'react';
import { X, Laptop, Smartphone, Globe, ArrowRightLeft, Radio, CheckCircle } from 'lucide-react';
import { supabaseSync } from '../../services/supabaseSyncService';
import type { ConnectedDevice } from '../../services/supabaseSyncService';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useAuthStore } from '../../store/useAuthStore';

interface DeviceConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeviceConnectModal: React.FC<DeviceConnectModalProps> = ({ isOpen, onClose }) => {
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const { currentTrack, isPlaying } = usePlayerStore();
  const { user, setAuthModalOpen } = useAuthStore();

  useEffect(() => {
    if (!isOpen) return;
    const unsub = supabaseSync.subscribeToDevices((list) => {
      setDevices(list);
    });
    return unsub;
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTransfer = async (targetDeviceId: string) => {
    await supabaseSync.transferPlaybackToDevice(targetDeviceId);
    onClose();
  };

  const getDeviceIcon = (type: 'desktop' | 'mobile' | 'web') => {
    switch (type) {
      case 'desktop':
        return <Laptop size={22} color="var(--accent-primary)" />;
      case 'mobile':
        return <Smartphone size={22} color="#9b59b6" />;
      default:
        return <Globe size={22} color="#2ecc71" />;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.78)',
      backdropFilter: 'blur(16px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: '#141418',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '460px',
        padding: '28px',
        boxShadow: '0 30px 60px rgba(0, 0, 0, 0.7)',
        position: 'relative',
        animation: 'fadeIn 0.25s ease-out'
      }}>
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            color: 'var(--text-secondary)',
            padding: '6px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.05)'
          }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-primary), #2ecc71)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff'
          }}>
            <Radio size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Connect to a Device</h2>
          </div>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', lineHeight: 1.4 }}>
          Instantly transfer and control music playback between your Windows PC, Android, and iOS devices.
        </p>

        {/* Current Playing Song Card */}
        {currentTrack && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            marginBottom: '20px'
          }}>
            <img
              src={currentTrack.cover || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80'}
              alt={currentTrack.title}
              style={{ width: '42px', height: '42px', borderRadius: '8px', objectFit: 'cover' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentTrack.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentTrack.artist} • {isPlaying ? 'Playing' : 'Paused'}
              </div>
            </div>
          </div>
        )}

        {/* Not Logged In Warning */}
        {!user && (
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'rgba(52, 152, 219, 0.1)',
            border: '1px solid rgba(52, 152, 219, 0.25)',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '10px' }}>
              Sign in with a free account on your PC & Phone to enable instant Handoff and syncing.
            </p>
            <button
              onClick={() => {
                onClose();
                setAuthModalOpen(true);
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.85rem'
              }}
            >
              Sign In to Connect
            </button>
          </div>
        )}

        {/* Devices List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Available Devices ({devices.length})
          </div>

          {devices.map((dev) => (
            <div
              key={dev.deviceId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: '12px',
                background: dev.isCurrentDevice ? 'rgba(52, 152, 219, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                border: dev.isCurrentDevice ? '1px solid rgba(52, 152, 219, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {getDeviceIcon(dev.deviceType)}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>{dev.deviceName}</span>
                    {dev.isCurrentDevice && (
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        backgroundColor: 'var(--accent-primary)',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        THIS DEVICE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {dev.isCurrentDevice ? (isPlaying ? 'Currently Playing Here' : 'Active') : 'Online • Ready for Handoff'}
                  </div>
                </div>
              </div>

              {!dev.isCurrentDevice ? (
                <button
                  onClick={() => handleTransfer(dev.deviceId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
                >
                  <ArrowRightLeft size={14} />
                  <span>Transfer</span>
                </button>
              ) : (
                <CheckCircle size={18} color="var(--accent-primary)" />
              )}
            </div>
          ))}

          {devices.length <= 1 && user && (
            <div style={{
              padding: '16px',
              borderRadius: '12px',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              marginTop: '6px'
            }}>
              Open OwO Music on your phone or tablet and log in to see it appear here instantly!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
