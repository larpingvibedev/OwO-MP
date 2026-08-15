import React, { useState, useRef, useEffect } from 'react';
import { User, LogOut, Radio, Sparkles, CheckCircle2, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { supabaseSync } from '../../services/supabaseSyncService';

interface UserProfileButtonProps {
  onOpenDeviceModal: () => void;
}

export const UserProfileButton: React.FC<UserProfileButtonProps> = ({ onOpenDeviceModal }) => {
  const { user, profile, setAuthModalOpen, setEditProfileOpen, signOut } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!user) {
    return (
      <button
        onClick={() => setAuthModalOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderRadius: '20px',
          backgroundColor: 'var(--accent-primary)',
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.85rem',
          border: 'none',
          cursor: 'pointer',
          transition: 'transform 0.15s, opacity 0.15s',
          boxShadow: '0 2px 8px rgba(52, 152, 219, 0.3)'
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      >
        <Sparkles size={14} />
        <span>Sign In to Sync</span>
      </button>
    );
  }

  const username = profile?.username || user.email?.split('@')[0] || 'Listener';
  const initial = username.charAt(0).toUpperCase();
  const avatarUrl = profile?.avatar_url;

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px 4px 4px',
          borderRadius: '24px',
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#fff',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, var(--accent-primary), #9b59b6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '0.8rem',
          color: '#fff',
          flexShrink: 0
        }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            initial
          )}
        </div>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {username}
        </span>
        <ChevronDown size={14} color="var(--text-secondary)" />
      </button>

      {/* Profile & Sync Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '240px',
          background: '#18181c',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          padding: '8px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          zIndex: 500,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {/* User Info Header */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, var(--accent-primary), #9b59b6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.85rem',
                color: '#fff',
                flexShrink: 0
              }}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  initial
                )}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {username}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '0.7rem', color: '#2ecc71', fontWeight: 600 }}>
              <CheckCircle2 size={12} />
              <span>Cloud Sync Active</span>
            </div>
          </div>

          {/* Menu Items */}
          <button
            onClick={() => {
              setIsOpen(false);
              setEditProfileOpen(true);
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 500,
              transition: 'all 0.15s',
              textAlign: 'left',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <User size={16} color="var(--accent-primary)" />
            <span>Edit Profile & Avatar</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenDeviceModal();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 500,
              transition: 'all 0.15s',
              textAlign: 'left',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Radio size={16} color="#2ecc71" />
            <span>Devices & Handoff</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              supabaseSync.syncDown();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 500,
              transition: 'all 0.15s',
              textAlign: 'left',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Sparkles size={16} color="#9b59b6" />
            <span>Sync Library Now</span>
          </button>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '6px 0' }} />

          <button
            onClick={() => {
              setIsOpen(false);
              signOut();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              color: '#e74c3c',
              fontSize: '0.85rem',
              fontWeight: 500,
              transition: 'all 0.15s',
              textAlign: 'left',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
};
