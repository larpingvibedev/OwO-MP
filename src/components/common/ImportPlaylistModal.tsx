import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Download, 
  X, 
  Sparkles, 
  Check, 
  AlertCircle, 
  Loader2, 
  Music, 
  Play,
  ClipboardPaste,
  Layers
} from 'lucide-react';
import { 
  fetchPlaylistMetadata, 
  resolveImportedTracks, 
  parsePlaylistUrl,
  type ParsedPlaylistMeta 
} from '../../services/playlistImportService';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Track } from '../../types';

interface ImportPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportStep = 'input' | 'preview' | 'importing' | 'complete' | 'error';

export const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { createImportedPlaylist, setQueue, setIsPlaying, showToast } = usePlayerStore();

  const [urlInput, setUrlInput] = useState('');
  const [step, setStep] = useState<ImportStep>('input');
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [meta, setMeta] = useState<ParsedPlaylistMeta | null>(null);
  const [customName, setCustomName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Progress tracking
  const [progressPct, setProgressPct] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);
  const [resolvedTracksCount, setResolvedTracksCount] = useState(0);
  const [resolvedTracksList, setResolvedTracksList] = useState<Track[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrlInput('');
      setStep('input');
      setIsLoadingMeta(false);
      setMeta(null);
      setCustomName('');
      setErrorMessage('');
      setProgressPct(0);
      setProgressMsg('');
      setCreatedPlaylistId(null);
      setResolvedTracksCount(0);
      setResolvedTracksList([]);
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const detected = parsePlaylistUrl(urlInput);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  };

  const handleFetchPreview = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoadingMeta(true);
    setErrorMessage('');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const playlistMeta = await fetchPlaylistMetadata(urlInput.trim(), controller.signal);
      setMeta(playlistMeta);
      setCustomName(playlistMeta.name);
      setStep('preview');
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMessage(err?.message || 'Failed to fetch playlist. Please check the URL.');
        setStep('error');
      }
    } finally {
      setIsLoadingMeta(false);
    }
  };

  const handleStartImport = async () => {
    if (!meta || meta.tracks.length === 0) return;

    setStep('importing');
    setProgressPct(0);
    setProgressMsg('Starting import...');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resolvedTracks = await resolveImportedTracks(
        meta.tracks,
        (completed, total, currentTrackName) => {
          const pct = Math.round((completed / total) * 100);
          setProgressPct(pct);
          setProgressMsg(`Resolving (${completed}/${total}): ${currentTrackName}`);
        },
        controller.signal
      );

      if (resolvedTracks.length === 0) {
        throw new Error('No tracks could be imported from this playlist.');
      }

      const finalName = customName.trim() || meta.name;
      const newId = createImportedPlaylist({
        name: finalName,
        cover: resolvedTracks[0]?.cover || meta.cover,
        author: meta.author ? `${meta.author} • ${meta.service === 'spotify' ? 'Spotify' : 'YouTube'}` : (meta.service === 'spotify' ? 'Imported from Spotify' : 'Imported from YouTube'),
        tracks: resolvedTracks
      });

      setCreatedPlaylistId(newId);
      setResolvedTracksCount(resolvedTracks.length);
      setResolvedTracksList(resolvedTracks);
      setStep('complete');
      showToast(`Imported "${finalName}" with ${resolvedTracks.length} tracks!`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMessage(err?.message || 'Import failed. Please try again.');
        setStep('error');
      }
    }
  };

  const handlePlayNow = () => {
    if (resolvedTracksList.length > 0) {
      const finalName = customName.trim() || meta?.name || 'Imported Playlist';
      setQueue(resolvedTracksList, 0, `${finalName} Playlist`);
      setIsPlaying(true);
      if (createdPlaylistId) {
        navigate(`/playlist/${createdPlaylistId}`);
      }
      onClose();
    }
  };

  const handleGoToPlaylist = () => {
    if (createdPlaylistId) {
      navigate(`/playlist/${createdPlaylistId}`);
      onClose();
    }
  };

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== 'importing') {
          onClose();
        }
      }}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#111318',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7), 0 0 40px rgba(37, 99, 235, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        {/* Header Bar */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)'
            }}>
              <Download size={20} color="#ffffff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                Import Playlist
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.55)' }}>
                Spotify & YouTube Music supported
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={step === 'importing'}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: step === 'importing' ? 'not-allowed' : 'pointer',
              opacity: step === 'importing' ? 0.4 : 1,
              transition: 'all 0.15s ease'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px' }}>
          
          {/* STEP 1: Input URL */}
          {step === 'input' && (
            <form onSubmit={handleFetchPreview} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: '8px'
                }}>
                  Playlist Link
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="https://open.spotify.com/playlist/... or YouTube link"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '12px 42px 12px 14px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '12px',
                      color: '#ffffff',
                      fontSize: '0.9rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.2s ease'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    title="Paste from clipboard"
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '6px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <ClipboardPaste size={16} />
                  </button>
                </div>
              </div>

              {/* Supported Platforms Indicators */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>Supported:</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    backgroundColor: detected?.service === 'spotify' ? 'rgba(29, 185, 84, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                    color: detected?.service === 'spotify' ? '#1ed760' : 'rgba(255, 255, 255, 0.6)',
                    border: detected?.service === 'spotify' ? '1px solid rgba(29, 185, 84, 0.4)' : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {detected?.service === 'spotify' && <Check size={12} />}
                    Spotify
                  </span>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    backgroundColor: detected?.service === 'youtube' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                    color: detected?.service === 'youtube' ? '#f87171' : 'rgba(255, 255, 255, 0.6)',
                    border: detected?.service === 'youtube' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {detected?.service === 'youtube' && <Check size={12} />}
                    YouTube / YT Music
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim() || isLoadingMeta}
                  style={{
                    padding: '10px 22px',
                    backgroundColor: 'var(--accent-primary)',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#000000',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: !urlInput.trim() || isLoadingMeta ? 'not-allowed' : 'pointer',
                    opacity: !urlInput.trim() || isLoadingMeta ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 14px rgba(255, 255, 255, 0.15)'
                  }}
                >
                  {isLoadingMeta ? (
                    <>
                      <Loader2 size={16} className="spin-animation" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Fetch Playlist</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: Preview & Customize */}
          {step === 'preview' && meta && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Preview Card */}
              <div style={{
                display: 'flex',
                gap: '16px',
                padding: '16px',
                borderRadius: '14px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{
                  width: '90px',
                  height: '90px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.4)'
                }}>
                  {meta.cover ? (
                    <img src={meta.cover} alt={meta.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Music size={32} color="rgba(255,255,255,0.4)" />
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: meta.service === 'spotify' ? 'rgba(29, 185, 84, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                      color: meta.service === 'spotify' ? '#1ed760' : '#f87171'
                    }}>
                      {meta.service === 'spotify' ? 'Spotify' : 'YouTube'}
                    </span>
                    {meta.author && (
                      <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        by {meta.author}
                      </span>
                    )}
                  </div>
                  <h3 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {meta.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                    {meta.tracks.length} {meta.tracks.length === 1 ? 'track' : 'tracks'} ready to import
                  </p>
                </div>
              </div>

              {/* Rename Field */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.8)', marginBottom: '6px' }}>
                  Playlist Name in Library
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  ← Back
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: '10px 18px',
                      backgroundColor: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleStartImport}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: 'var(--accent-primary)',
                      border: 'none',
                      borderRadius: '10px',
                      color: '#000000',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 14px rgba(255, 255, 255, 0.15)'
                    }}
                  >
                    <Download size={16} />
                    <span>Import {meta.tracks.length} Tracks</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Importing Progress */}
          {step === 'importing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                position: 'relative'
              }}>
                <Loader2 size={32} color="#3b82f6" className="spin-animation" />
              </div>

              <h3 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
                Importing Tracks ({progressPct}%)
              </h3>
              <p style={{
                margin: '0 0 20px',
                fontSize: '0.85rem',
                color: 'rgba(255, 255, 255, 0.6)',
                maxWidth: '380px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {progressMsg}
              </p>

              {/* Progress Bar Container */}
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '999px',
                overflow: 'hidden',
                marginBottom: '20px',
                position: 'relative'
              }}>
                <div style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6 0%, var(--accent-primary) 100%)',
                  borderRadius: '999px',
                  transition: 'width 0.2s ease-out',
                  boxShadow: '0 0 12px rgba(59, 130, 246, 0.5)'
                }} />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                  }
                  setStep('input');
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                Cancel Import
              </button>
            </div>
          )}

          {/* STEP 4: Complete */}
          {step === 'complete' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                boxShadow: '0 0 24px rgba(34, 197, 94, 0.2)'
              }}>
                <Check size={32} color="#22c55e" />
              </div>

              <h3 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
                Playlist Imported!
              </h3>
              <p style={{ margin: '0 0 24px', fontSize: '0.88rem', color: 'rgba(255, 255, 255, 0.65)' }}>
                Successfully added <strong style={{ color: '#fff' }}>{resolvedTracksCount} tracks</strong> to <strong style={{ color: 'var(--accent-primary)' }}>{customName || meta?.name}</strong>.
              </p>

              <div style={{ display: 'flex', gap: '10px', width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '11px 18px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '12px',
                    color: '#ffffff',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={handleGoToPlaylist}
                  style={{
                    padding: '11px 18px',
                    backgroundColor: 'rgba(255, 255, 255, 0.14)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: '#ffffff',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Layers size={15} />
                  <span>View Playlist</span>
                </button>
                <button
                  type="button"
                  onClick={handlePlayNow}
                  style={{
                    padding: '11px 22px',
                    backgroundColor: 'var(--accent-primary)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#000000',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 14px rgba(255, 255, 255, 0.15)'
                  }}
                >
                  <Play size={16} fill="#000" />
                  <span>Play Now</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Error */}
          {step === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <AlertCircle size={30} color="#ef4444" />
              </div>

              <h3 style={{ margin: '0 0 8px', fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                Import Failed
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)', maxWidth: '400px' }}>
                {errorMessage}
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '9px 18px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setStep('input');
                  }}
                  style={{
                    padding: '9px 20px',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
