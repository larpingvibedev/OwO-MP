import React, { useRef } from 'react';
import type { SuggestionEntity } from '../../types';

interface SearchDropdownProps {
  isOpen: boolean;
  query: string;
  recentQueries: string[];
  textSuggestions: string[];
  entitySuggestions: SuggestionEntity[];
  isLoading: boolean;
  onSelectQuery: (query: string) => void;
  onRemoveRecentQuery: (query: string) => void;
  onSelectEntity: (entity: SuggestionEntity) => void;
  onClose: () => void;
}

export const SearchDropdown: React.FC<SearchDropdownProps> = ({
  isOpen,
  query,
  recentQueries,
  textSuggestions,
  entitySuggestions,
  isLoading,
  onSelectQuery,
  onRemoveRecentQuery,
  onSelectEntity
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const cleanQuery = query.trim().toLowerCase();
  const isQueryEmpty = cleanQuery.length === 0;

  // Filter matching recent queries
  const matchingRecent = isQueryEmpty
    ? recentQueries
    : recentQueries.filter(q => q.toLowerCase().includes(cleanQuery));

  // Filter out text suggestions that are already in matching recent searches
  const filteredTextSuggestions = textSuggestions.filter(
    s => !matchingRecent.some(r => r.toLowerCase() === s.toLowerCase())
  );

  const hasContent =
    matchingRecent.length > 0 ||
    filteredTextSuggestions.length > 0 ||
    entitySuggestions.length > 0 ||
    isLoading;

  if (!hasContent) return null;

  return (
    <div
      ref={dropdownRef}
      className="search-dropdown-overlay"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="search-dropdown-scroll">
        {/* 1. Recent Searches Section (Clock Icon + Trash) */}
        {matchingRecent.map((item, idx) => (
          <div
            key={`recent-${idx}-${item}`}
            className="search-dropdown-item search-history-item"
            onClick={() => onSelectQuery(item)}
          >
            <div className="search-item-left">
              {/* YouTube Music Clock / History Icon */}
              <svg className="search-item-icon history-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z" />
              </svg>
              <span className="search-item-text">{item}</span>
            </div>

            <button
              className="search-item-delete-btn"
              title="Remove from history"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveRecentQuery(item);
              }}
            >
              {/* YouTube Music Trash / Delete Icon */}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>
          </div>
        ))}

        {/* 2. Text Suggestions Section (Search Magnifying Glass) */}
        {!isQueryEmpty && filteredTextSuggestions.map((item, idx) => (
          <div
            key={`sug-${idx}-${item}`}
            className="search-dropdown-item search-text-suggestion"
            onClick={() => onSelectQuery(item)}
          >
            <div className="search-item-left">
              <svg className="search-item-icon magnify-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <span className="search-item-text">{item}</span>
            </div>
          </div>
        ))}

        {/* 3. Entity Suggestions Section (Artist, Song, Playlist) */}
        {!isQueryEmpty && entitySuggestions.length > 0 && (
          <div className="search-dropdown-entities">
            {entitySuggestions.map((entity, idx) => (
              <div
                key={`entity-${idx}-${entity.title}`}
                className={`search-dropdown-item search-entity-item entity-${entity.type}`}
                onClick={() => onSelectEntity(entity)}
              >
                <div className="search-entity-thumb-wrapper">
                  <img
                    src={entity.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&q=80'}
                    alt={entity.title}
                    className={`search-entity-thumb ${entity.type === 'artist' ? 'artist-avatar' : 'track-art'}`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&q=80';
                    }}
                  />
                  {entity.type === 'song' && (
                    <div className="search-entity-play-overlay">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="search-entity-info">
                  <div className="search-entity-title">{entity.title}</div>
                  <div className="search-entity-subtitle">
                    <span className="subtitle-text">{entity.subtitle}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !isQueryEmpty && (
          <div className="search-dropdown-loading">
            <div className="search-dropdown-spinner" />
            <span>Finding suggestions...</span>
          </div>
        )}
      </div>
    </div>
  );
};
