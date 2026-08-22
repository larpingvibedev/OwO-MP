import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, AlertCircle } from 'lucide-react';
import { PlaylistCover } from '../common/PlaylistCover';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Playlist } from '../../types';

interface EditPlaylistModalProps {
  isOpen: boolean;
  playlist: Playlist | null;
  onClose: () => void;
  onSave: (updates: { name: string; description: string; coverBlob?: Blob | null; removeCover?: boolean }) => Promise<void>;
}

export const EditPlaylistModal: React.FC<EditPlaylistModalProps> = ({
  isOpen,
  playlist,
  onClose,
  onSave
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedBlob, setSelectedBlob] = useState<Blob | null>(null);
  const [isRemovingCover, setIsRemovingCover] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeCoverId = usePlayerStore(state => playlist?.id ? state.localPlaylistMetadata?.[playlist.id]?.coverId : undefined);
  const effectiveCoverId = playlist?.coverId ?? storeCoverId;

  useEffect(() => {
    if (isOpen && playlist) {
      setName(playlist.name || '');
      setDescription(playlist.description || '');
      setPreviewUrl(null);
      setSelectedBlob(null);
      setIsRemovingCover(false);
      setError(null);
    }
  }, [isOpen, playlist?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!isOpen || !playlist) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, or WebP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image file is too large. Please choose an image under 10MB.');
      return;
    }

    setError(null);
    setIsRemovingCover(false);

    // Read image and create a square center-cropped blob
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const side = Math.min(img.width, img.height);
        const maxDimension = Math.min(side, 800); // 800x800 maximum optimal dimension
        canvas.width = maxDimension;
        canvas.height = maxDimension;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, maxDimension, maxDimension);

          canvas.toBlob((blob) => {
            if (blob) {
              setSelectedBlob(blob);
              const objectUrl = URL.createObjectURL(blob);
              setPreviewUrl(objectUrl);
            }
          }, 'image/webp', 0.9);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveCover = () => {
    setIsRemovingCover(true);
    setSelectedBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Playlist name cannot be empty.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave({
        name: name.trim(),
        description: description.trim(),
        coverBlob: selectedBlob,
        removeCover: isRemovingCover
      });
      onClose();
    } catch (err) {
      console.error('Failed to update playlist:', err);
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasCustomCover = Boolean(previewUrl || effectiveCoverId || (playlist.cover && playlist.cover.trim() !== '')) && !isRemovingCover;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 2000 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '540px',
          width: '90vw',
          backgroundColor: '#16161a',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '20px',
          padding: '24px 28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.75)',
          animation: 'bulkDropdownFade 0.2s ease forwards'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
            Edit playlist details
          </h2>
          <button 
            type="button"
            onClick={onClose} 
            title="Close"
            style={{ 
              background: 'rgba(255, 255, 255, 0.06)', 
              border: 'none', 
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              color: 'rgba(255, 255, 255, 0.7)', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            backgroundColor: 'rgba(231, 76, 60, 0.15)', 
            border: '1px solid rgba(231, 76, 60, 0.35)',
            borderRadius: '10px',
            padding: '10px 14px',
            color: '#ff6b6b',
            fontSize: '0.84rem',
            marginBottom: '18px'
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'flex-start' }}>
            {/* Left Column: Custom Cover Art Preview & Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '144px', flexShrink: 0 }}>
              <div 
                style={{ 
                  position: 'relative', 
                  width: '144px', 
                  height: '144px', 
                  borderRadius: '14px', 
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}
                onClick={() => fileInputRef.current?.click()}
                title="Click to choose photo"
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : isRemovingCover ? (
                  <PlaylistCover tracks={playlist.tracks} size={144} borderRadius="14px" />
                ) : (
                  <PlaylistCover 
                    playlistId={playlist.id}
                    tracks={playlist.tracks} 
                    cover={playlist.cover} 
                    coverId={effectiveCoverId} 
                    size={144} 
                    borderRadius="14px" 
                  />
                )}

                {/* Hover Camera Overlay */}
                <div 
                  className="cover-edit-overlay"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    color: '#ffffff',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                    backdropFilter: 'blur(2px)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                >
                  <Camera size={26} />
                  <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                    {hasCustomCover ? 'Change photo' : 'Choose photo'}
                  </span>
                </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/png, image/jpeg, image/webp" 
                style={{ display: 'none' }} 
              />

              {/* Clear Artwork Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%' }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    transition: 'opacity 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                >
                  {hasCustomCover ? 'Change photo' : 'Choose photo'}
                </button>
                {hasCustomCover && (
                  <button
                    type="button"
                    onClick={handleRemoveCover}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 107, 107, 0.9)',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      transition: 'opacity 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            {/* Right Column: Name & Description Inputs */}
            <div style={{ flex: 1, minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '0.72rem', 
                  fontWeight: 700, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.05em',
                  color: 'rgba(255, 255, 255, 0.5)', 
                  marginBottom: '6px' 
                }}>
                  Name
                </label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Playlist name"
                  maxLength={100}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '0.92rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s, box-shadow 0.15s'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.boxShadow = '0 0 0 1px var(--accent-primary)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ 
                    fontSize: '0.72rem', 
                    fontWeight: 700, 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.05em',
                    color: 'rgba(255, 255, 255, 0.5)' 
                  }}>
                    Description
                  </label>
                  <span style={{ 
                    fontSize: '0.72rem', 
                    color: description.length >= 480 ? '#ff6b6b' : 'rgba(255, 255, 255, 0.4)' 
                  }}>
                    {description.length}/500
                  </span>
                </div>
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                  onKeyDown={(e) => {
                    // Prevent accidental form submission when pressing Enter in textarea
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.stopPropagation();
                    }
                  }}
                  placeholder="Add an optional description"
                  rows={4}
                  maxLength={500}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '0.86rem',
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    lineHeight: 1.45,
                    transition: 'border-color 0.15s, box-shadow 0.15s'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.boxShadow = '0 0 0 1px var(--accent-primary)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              className="settings-btn-secondary"
              style={{ 
                padding: '9px 20px', 
                borderRadius: '24px',
                fontSize: '0.88rem',
                fontWeight: 500
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-btn-primary"
              style={{ 
                padding: '9px 26px', 
                borderRadius: '24px',
                fontSize: '0.88rem',
                fontWeight: 600
              }}
              disabled={isSaving || !name.trim()}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
