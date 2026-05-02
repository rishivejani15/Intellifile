import React, { useState, useRef, useEffect } from 'react';
import './FileExplorer/FileExplorer.css';

function ExplorerNavbar({
  breadcrumb,
  addressPath,
  historyIndex,
  history,
  viewMode,
  sortBy,
  sortDirection,
  groupBy,
  searchQuery,
  showHidden,
  engineReady,
  indexing,
  indexPhase,
  indexDetail,
  indexPct,
  indexMessage,
  semanticLoading,
  onAddressSubmit,
  onBreadcrumbClick,
  onBack,
  onForward,
  onUp,
  onRefresh,
  onViewModeChange,
  onSortByChange,
  onSortDirectionChange,
  onGroupByChange,
  onShowHiddenChange,
  onCreateFolder,
  onCreateFile,
  onSearchChange,
  onSearchKeyDown,
}) {
  const [showNewDropdown, setShowNewDropdown] = useState(false);
  const newDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (newDropdownRef.current && !newDropdownRef.current.contains(e.target)) {
        setShowNewDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="explorer-navbar">
      <div className="nav-row">
        <div className="nav-buttons">
          <button
            className="nav-btn back-btn"
            onClick={onBack}
            disabled={historyIndex <= 0}
            title="Back (Alt+←)"
          >
            ◀
          </button>
          <button
            className="nav-btn forward-btn"
            onClick={onForward}
            disabled={historyIndex >= history.length - 1}
            title="Forward (Alt+→)"
          >
            ▶
          </button>
          <button
            className="nav-btn up-btn"
            onClick={onUp}
            title="Up (Alt+↑)"
          >
            ⬆️
          </button>
          <button
            className="nav-btn refresh-btn"
            onClick={onRefresh}
            title="Refresh (F5)"
          >
            🔄
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="breadcrumb">
          {breadcrumb.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="breadcrumb-sep">›</span>}
              <button
                className="breadcrumb-item"
                onClick={() => onBreadcrumbClick(crumb.path)}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Address Bar */}
        <form className="address-bar" onSubmit={onAddressSubmit}>
          <input
            type="text"
            value={addressPath}
            onChange={(e) => onSearchChange?.(e, 'address')}
            placeholder="Type a path"
          />
        </form>
      </div>

      {/* Toolbar */}
      <div className="explorer-toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder={engineReady ? '🔍 Search (try "bills from june 2025")' : "🔍 Search (engine loading...)"}
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e, 'query')}
            onKeyDown={onSearchKeyDown}
          />
          {semanticLoading && <span className="search-spinner">⏳</span>}
          {searchQuery && /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|\d{4}|yesterday|today|last\s+week|last\s+month|this\s+month|this\s+year)\b/i.test(searchQuery) && (
            <div className="date-filter-badge">
              📅 Date filter active
            </div>
          )}
        </div>

        <div className="view-controls">
          <button
            className={`view-btn ${viewMode === 'icons' ? 'active' : ''}`}
            onClick={() => onViewModeChange('icons')}
            title="Icons view"
          >
            ⊞
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => onViewModeChange('list')}
            title="List view"
          >
            ≡
          </button>
          <button
            className={`view-btn ${viewMode === 'details' ? 'active' : ''}`}
            onClick={() => onViewModeChange('details')}
            title="Details view"
          >
            📋
          </button>
        </div>

        <div className="sort-controls">
          <select value={sortBy} onChange={(e) => onSortByChange(e.target.value)} className="sort-select">
            <option value="name">Sort by Name</option>
            <option value="date">Sort by Date</option>
            <option value="size">Sort by Size</option>
            <option value="type">Sort by Type</option>
          </select>
          <button
            className="sort-direction-btn"
            onClick={() => onSortDirectionChange?.(sortDirection === 'asc' ? 'desc' : 'asc')}
            title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'} — Click to toggle`}
          >
            {sortDirection === 'asc' ? '▲' : '▼'}
          </button>
        </div>

        <div className="group-controls">
          <select value={groupBy} onChange={(e) => onGroupByChange(e.target.value)} className="group-select">
            <option value="none">Group: None</option>
            <option value="type">Group: Type</option>
            <option value="date">Group: Date</option>
          </select>
        </div>

        <div className="action-buttons">
          {/* New Dropdown */}
          <div className="new-dropdown-wrapper" ref={newDropdownRef}>
            <button
              className="action-btn new-btn"
              onClick={() => setShowNewDropdown(!showNewDropdown)}
              title="Create new file or folder"
            >
              ➕ New ▾
            </button>
            {showNewDropdown && (
              <div className="new-dropdown">
                <div className="new-dropdown-item" onClick={() => { onCreateFolder?.(); setShowNewDropdown(false); }}>
                  📁 Folder
                </div>
                <div className="new-dropdown-divider"></div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Text Document.txt'); setShowNewDropdown(false); }}>
                  📄 Text Document
                </div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Document.md'); setShowNewDropdown(false); }}>
                  📝 Markdown
                </div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Document.json'); setShowNewDropdown(false); }}>
                  {'{ }'} JSON
                </div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Script.py'); setShowNewDropdown(false); }}>
                  🐍 Python
                </div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Script.js'); setShowNewDropdown(false); }}>
                  ⚡ JavaScript
                </div>
                <div className="new-dropdown-item" onClick={() => { onCreateFile?.('New Page.html'); setShowNewDropdown(false); }}>
                  🌐 HTML
                </div>
              </div>
            )}
          </div>

          {/* Hidden Toggle */}
          <button
            className={`action-btn hidden-toggle ${showHidden ? 'active' : ''}`}
            onClick={() => onShowHiddenChange?.(!showHidden)}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            {showHidden ? '👁️' : '👁️‍🗨️'}
          </button>

          {(indexing || indexMessage) && (
            <div className={`index-status ${indexing ? 'running' : 'done'}`} title={indexDetail || indexMessage}>
              <span className="index-dot" />
              <span className="index-text">
                {indexing ? `Indexing${indexPhase ? ` (${indexPhase})` : ''}` : (indexMessage || 'Index updated')}
              </span>
              {indexing && typeof indexPct === 'number' && (
                <span className="index-pct">{indexPct}%</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExplorerNavbar;
