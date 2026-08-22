import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check } from 'lucide-react';
import { cleanGoogleImageUrl } from '../../services/musicSearch';
import type { Track } from '../../types';

interface SortableTrackRowProps {
  track: Track;
  index: number;
  itemId: string;
  isCurrent: boolean;
  isPlaying: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  canReorder: boolean;
  onPlay: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  displayCover?: string;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const SortableTrackRow: React.FC<SortableTrackRowProps> = ({
  track,
  index,
  itemId,
  isCurrent,
  isPlaying,
  isSelected,
  selectionMode,
  canReorder,
  onPlay,
  onSelect,
  onContextMenu,
  displayCover
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: itemId,
    disabled: !canReorder || selectionMode
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    padding: '8px 14px',
    borderRadius: '8px',
    cursor: 'pointer',
    userSelect: 'none',
    position: 'relative'
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // If Ctrl/Cmd, Shift, or in Selection Mode, route to selection
    if (e.ctrlKey || e.metaKey || e.shiftKey || selectionMode) {
      e.stopPropagation();
      onSelect(e);
      return;
    }
    onPlay();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`track-row ${isCurrent ? 'active-playing' : ''} ${isSelected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      onClick={handleRowClick}
      onContextMenu={onContextMenu}
    >
      {/* Drag Grip Handle (Strictly separate drag handle surface) */}
      {canReorder && !selectionMode && (
        <div
          className="track-drag-grip"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{ marginRight: '6px' }}
        >
          <GripVertical size={16} />
        </div>
      )}

      {/* Index / Selection Checkbox / Playing Equalizer Slot */}
      <div 
        style={{ width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(e);
        }}
      >
        {selectionMode || isSelected ? (
          <div className={`track-selection-checkbox ${isSelected ? 'selected' : ''}`}>
            {isSelected && <Check size={12} strokeWidth={3} />}
          </div>
        ) : isCurrent && isPlaying ? (
          <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '14px' }}>
            <span className="equalizer-bar" style={{ width: '3px', height: '100%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate' }} />
            <span className="equalizer-bar" style={{ width: '3px', height: '60%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate 0.2s' }} />
            <span className="equalizer-bar" style={{ width: '3px', height: '80%', backgroundColor: 'var(--accent-primary)', animation: 'equalize 0.8s ease-in-out infinite alternate 0.4s' }} />
          </div>
        ) : (
          <span className="track-row-index" style={{ fontSize: '0.88rem', color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
            {index + 1}
          </span>
        )}
      </div>

      {/* Thumbnail */}
      <div
        className="track-row-cover"
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-main)',
          marginLeft: '10px',
          marginRight: '14px',
          flexShrink: 0
        }}
      >
        <img
          src={cleanGoogleImageUrl(track.cover || displayCover, 500)}
          alt={track.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = displayCover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
          }}
        />
      </div>

      {/* Title & Artist */}
      <div className="track-row-info" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="track-row-title"
          style={{
            fontWeight: 600,
            fontSize: '0.92rem',
            color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {track.title}
        </div>
        <div
          className="track-row-artist"
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {track.artist}
        </div>
      </div>

      {/* Album */}
      <div
        className="track-row-album"
        style={{
          flex: 1,
          color: 'var(--text-secondary)',
          fontSize: '0.84rem',
          paddingRight: '16px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'none'
        }}
      >
        {track.album || ''}
      </div>

      {/* Duration */}
      <div
        style={{
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          marginLeft: '12px',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {formatTime(track.duration || 0)}
      </div>
    </div>
  );
};
