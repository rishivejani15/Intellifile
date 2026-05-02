import React from 'react';
import { SORT_OPTIONS, GROUP_OPTIONS, VIEW_MODES } from '../utils/constants';

function Toolbar({
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  semanticLoading,
  engineReady,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  groupBy,
  onGroupChange,
  onCreateFolder,
  onIndexDevice,
  indexing,
  indexedFolder,
}) {
  return (
    <div className="explorer-toolbar">
      <div className="search-box">
        <input
          type="text"
          placeholder={engineReady ? "🔍 Search (Enter for AI search)" : "🔍 Search (engine loading...)"}
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            if (!e.target.value) {
              // Clear semantic results when search is cleared
            }
          }}
          onKeyDown={onSearchKeyDown}
        />
        {semanticLoading && <span className="search-spinner">⏳</span>}
      </div>

      <div className="view-controls">
        <button
          className={`view-btn ${viewMode === VIEW_MODES.ICONS ? 'active' : ''}`}
          onClick={() => onViewModeChange(VIEW_MODES.ICONS)}
          title="Icons view"
        >
          ⊞
        </button>
        <button
          className={`view-btn ${viewMode === VIEW_MODES.LIST ? 'active' : ''}`}
          onClick={() => onViewModeChange(VIEW_MODES.LIST)}
          title="List view"
        >
          ≡
        </button>
        <button
          className={`view-btn ${viewMode === VIEW_MODES.DETAILS ? 'active' : ''}`}
          onClick={() => onViewModeChange(VIEW_MODES.DETAILS)}
          title="Details view"
        >
          📋
        </button>
      </div>

      <div className="sort-controls">
        <select 
          value={sortBy} 
          onChange={(e) => onSortChange(e.target.value)} 
          className="sort-select"
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="group-controls">
        <select 
          value={groupBy} 
          onChange={(e) => onGroupChange(e.target.value)} 
          className="group-select"
        >
          {GROUP_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="action-buttons">
        <button
          className="action-btn"
          onClick={onCreateFolder}
          title="Create folder (Ctrl+N)"
        >
          ➕ New Folder
        </button>
        <button
          className="action-btn index-btn"
          onClick={onIndexDevice}
          disabled={indexing}
          title={indexing ? 'Indexing in progress...' : engineReady ? 'Index your device for AI search' : 'Engine loading... click to try anyway'}
        >
          {indexing ? '⏳ Indexing…' : '🧠 Index Device'}
        </button>
        {indexedFolder && (
          <span className="indexed-label" title={indexedFolder}>✅ Indexed</span>
        )}
      </div>
    </div>
  );
}

export default Toolbar;
