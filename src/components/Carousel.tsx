import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CarouselProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  rows?: number;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actionButton?: React.ReactNode;
}

export function Carousel<T>({
  items,
  renderItem,
  rows = 1,
  title,
  subtitle,
  icon,
  actionButton
}: CarouselProps<T>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const { scrollLeft, clientWidth } = scrollContainerRef.current;
      const scrollTo = direction === 'left' 
        ? scrollLeft - clientWidth * 0.75 
        : scrollLeft + clientWidth * 0.75;
      
      scrollContainerRef.current.scrollTo({
        left: scrollTo,
        behavior: 'smooth'
      });
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="carousel-section" style={{ marginBottom: '40px', position: 'relative' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-end', 
        marginBottom: '16px',
        paddingRight: '12px'
      }}>
        <div>
          {subtitle && (
            <span style={{ 
              fontSize: '0.75rem', 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em', 
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'block',
              marginBottom: '4px'
            }}>
              {subtitle}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
            <h3 className="section-header" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              {title}
            </h3>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {actionButton}
          
          {/* Scroll Navigation Buttons (Desktop only-ish, hidden on mobile via native touch scroll) */}
          <div className="carousel-nav-buttons" style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={() => scroll('left')}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
            >
              <ChevronLeft size={16} />
            </button>
            <button 
              onClick={() => scroll('right')}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid Scroll Container */}
      <div 
        ref={scrollContainerRef}
        className="carousel-scroll-container"
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(${rows}, auto)`,
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(180px, 200px)',
          gap: '16px',
          overflowX: 'auto',
          paddingBottom: '8px',
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none' // IE/Edge
        }}
      >
        {items.map((item, index) => renderItem(item, index))}
      </div>

      {/* Hide Scrollbar for Webkit */}
      <style>{`
        .carousel-scroll-container::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
