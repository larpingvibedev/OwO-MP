import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Track } from '../../types';

interface AddToQueueButtonProps {
  track: Track;
  variant?: 'card-overlay' | 'row-btn' | 'icon';
  position?: 'top-right' | 'top-left';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function AddToQueueButton({
  track,
  variant = 'card-overlay',
  position = 'top-right',
  className = '',
  style,
  title = 'Add to queue'
}: AddToQueueButtonProps) {
  const { addToQueue } = usePlayerStore();
  const [isAdded, setIsAdded] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    addToQueue(track);
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1800);
  };

  if (variant === 'card-overlay') {
    const positionStyle: React.CSSProperties = position === 'top-left'
      ? { left: '8px', right: 'auto' }
      : { right: '8px', left: 'auto' };

    return (
      <button
        type="button"
        className={`card-queue-btn ${isAdded ? 'added' : ''} ${className}`}
        onClick={handleClick}
        title={isAdded ? 'Added to queue!' : title}
        style={{ ...positionStyle, ...style }}
      >
        {isAdded ? <Check size={14} strokeWidth={2.5} /> : <Plus size={15} strokeWidth={2.5} />}
      </button>
    );
  }

  if (variant === 'row-btn') {
    return (
      <button
        type="button"
        className={`row-queue-btn ${className}`}
        onClick={handleClick}
        title={isAdded ? 'Added to queue!' : title}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: isAdded ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.4)',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.2s, transform 0.15s',
          ...style
        }}
        onMouseEnter={(e) => {
          if (!isAdded) e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.transform = 'scale(1.15)';
        }}
        onMouseLeave={(e) => {
          if (!isAdded) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        {isAdded ? <Check size={15} strokeWidth={2.5} /> : <Plus size={15} strokeWidth={2.5} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`icon-queue-btn ${className}`}
      onClick={handleClick}
      title={isAdded ? 'Added to queue!' : title}
      style={{
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid var(--border-color)',
        borderRadius: '50%',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: isAdded ? 'var(--accent-primary)' : 'var(--text-primary)',
        transition: 'all 0.2s',
        ...style
      }}
    >
      {isAdded ? <Check size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
    </button>
  );
}
