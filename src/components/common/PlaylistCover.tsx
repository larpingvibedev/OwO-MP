import React, { useMemo, useState, useEffect } from 'react';
import { ListMusic } from 'lucide-react';
import type { Track } from '../../types';
import { getPlaylistCover } from '../../services/playlistCoverStorage';
import { usePlayerStore } from '../../store/usePlayerStore';

interface PlaylistCoverProps {
  playlistId?: string;
  tracks?: Track[];
  cover?: string;
  coverId?: string;
  name?: string;
  size?: number | string;
  aspectRatio?: string;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
  fallbackIconSize?: number;
}

export function PlaylistCover({
  playlistId,
  tracks = [],
  cover,
  coverId,
  name = 'Playlist',
  size = '100%',
  aspectRatio = '1 / 1',
  borderRadius = '8px',
  className = '',
  style = {},
  fallbackIconSize = 40
}: PlaylistCoverProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const storeCoverId = usePlayerStore(state => playlistId ? state.localPlaylistMetadata?.[playlistId]?.coverId : undefined);
  const effectiveCoverId = coverId ?? storeCoverId;

  useEffect(() => {
    let currentUrl: string | null = null;
    let isCancelled = false;

    if (effectiveCoverId) {
      void getPlaylistCover(effectiveCoverId).then((blob) => {
        if (!isCancelled && blob) {
          currentUrl = URL.createObjectURL(blob);
          setBlobUrl(currentUrl);
        } else if (!isCancelled) {
          setBlobUrl(null);
        }
      });
    } else {
      setBlobUrl(null);
    }

    return () => {
      isCancelled = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [effectiveCoverId]);

  const activeCover = blobUrl || cover;
  const safeTracks = useMemo(() => (Array.isArray(tracks) ? tracks.filter(Boolean) : []), [tracks]);

  // Extract up to 4 distinct valid covers from the tracks list
  const fourCovers = useMemo(() => {
    if (typeof activeCover === 'string' && activeCover.trim().length > 0 && !activeCover.includes('placeholder')) {
      return null;
    }
    if (safeTracks.length < 4) {
      return null;
    }

    const uniqueCovers: string[] = [];
    const seen = new Set<string>();

    for (const t of safeTracks) {
      if (t && typeof t.cover === 'string' && t.cover.trim() && !seen.has(t.cover)) {
        seen.add(t.cover);
        uniqueCovers.push(t.cover);
        if (uniqueCovers.length === 4) break;
      }
    }

    // If tracks have at least 4 unique covers, return the 4 covers for the 2x2 grid
    if (uniqueCovers.length === 4) {
      return uniqueCovers;
    }

    // If fewer than 4 unique but at least 4 tracks, use the first 4 available covers
    const firstFour = safeTracks
      .map(t => (t && typeof t.cover === 'string' ? t.cover.trim() : ''))
      .filter(Boolean);

    if (firstFour.length >= 4) {
      return firstFour.slice(0, 4);
    }

    return null;
  }, [safeTracks, activeCover]);

  const singleCover = (typeof activeCover === 'string' && activeCover.trim()) || (safeTracks[0] && typeof safeTracks[0].cover === 'string' && safeTracks[0].cover.trim()) || null;

  return (
    <div
      className={`playlist-cover-container ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        aspectRatio,
        borderRadius,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--bg-card, #1a1a1e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        ...style
      }}
    >
      {fourCovers ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            width: '100%',
            height: '100%'
          }}
        >
          {fourCovers.map((imgUrl, i) => (
            <img
              key={i}
              src={imgUrl}
              alt={`${name} cover ${i + 1}`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80';
              }}
            />
          ))}
        </div>
      ) : singleCover ? (
        <img
          src={singleCover}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
          }}
        >
          <ListMusic size={fallbackIconSize} color="var(--text-secondary, rgba(255,255,255,0.5))" />
        </div>
      )}
    </div>
  );
}
