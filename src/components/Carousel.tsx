import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CarouselProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  rows?: number;
  columnWidth?: string;
  gap?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actionButton?: React.ReactNode;
}

export function Carousel<T>({
  items,
  renderItem,
  rows = 1,
  columnWidth,
  gap = '14px',
  title,
  subtitle,
  icon,
  actionButton
}: CarouselProps<T>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollability = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  }, []);

  useEffect(() => {
    checkScrollability();
    const el = scrollContainerRef.current;
    if (el) {
      el.addEventListener('scroll', checkScrollability, { passive: true });
      window.addEventListener('resize', checkScrollability);
      return () => {
        el.removeEventListener('scroll', checkScrollability);
        window.removeEventListener('resize', checkScrollability);
      };
    }
  }, [items, checkScrollability]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const { scrollLeft, clientWidth } = scrollContainerRef.current;
      const scrollAmount = clientWidth * 0.75;
      const scrollTo = direction === 'left' 
        ? scrollLeft - scrollAmount 
        : scrollLeft + scrollAmount;
      
      scrollContainerRef.current.scrollTo({
        left: scrollTo,
        behavior: 'smooth'
      });
    }
  };

  if (!items || items.length === 0) return null;

  const defaultColWidth = rows > 1 ? 'minmax(340px, 380px)' : 'minmax(180px, 200px)';
  const effectiveColWidth = columnWidth || defaultColWidth;

  return (
    <div className="carousel-section" style={{ marginBottom: '40px', position: 'relative' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-end', 
        marginBottom: '16px',
        paddingRight: '8px'
      }}>
        <div>
          {subtitle && (
            <span style={{ 
              fontSize: '0.75rem', 
              textTransform: 'uppercase', 
              letterSpacing: '0.06em', 
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
            <h3 className="section-header" style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800 }}>
              {title}
            </h3>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {actionButton}
          
          {/* Scroll Navigation Buttons */}
          <div className="carousel-nav-buttons" style={{ display: 'flex', gap: '6px' }}>
            <button 
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              title="Scroll left"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canScrollLeft ? 'pointer' : 'default',
                opacity: canScrollLeft ? 1 : 0.35,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (canScrollLeft) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.14)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                }
              }}
              onMouseLeave={(e) => {
                if (canScrollLeft) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <button 
              onClick={() => scroll('right')}
              disabled={!canScrollRight}
              title="Scroll right"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canScrollRight ? 'pointer' : 'default',
                opacity: canScrollRight ? 1 : 0.35,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (canScrollRight) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.14)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                }
              }}
              onMouseLeave={(e) => {
                if (canScrollRight) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }
              }}
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
          gridAutoColumns: effectiveColWidth,
          gap: gap,
          overflowX: 'auto',
          paddingBottom: '8px',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
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

