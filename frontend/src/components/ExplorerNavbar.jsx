import React from 'react';
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
  indexedFolder,
  indexPhase,
  indexDetail,
  indexPct,
  indexMessage,
  archiveActive,
  archiveAction,
  archivePct,
  archiveMessage,
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
  // const [showNewDropdown, setShowNewDropdown] = useState(false);
  // const newDropdownRef = useRef(null);

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
            onFocus={(e) => e.target.select()}
            placeholder="Type a path"
          />
        </form>
      </div>

      {/* Toolbar */}
      <div className="explorer-toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder={engineReady ? "🔍 Search (Enter for AI search)" : "🔍 Search (engine loading...)"}
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
          {/* Hidden Toggle */}
          <button
            className={`action-btn hidden-toggle ${showHidden ? 'active' : ''}`}
            onClick={() => onShowHiddenChange?.(!showHidden)}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            {showHidden ? '👁️' : '👁️‍🗨️'}
          </button>
          <div className={`index-status ${indexing ? 'running' : (indexMessage && indexMessage.toLowerCase().includes('failed') ? 'error' : 'done')}`} title={indexDetail || indexMessage}>
            <span className="index-dot" />
            <span className="index-text">
              {indexing ? `Indexing${indexPhase ? ` (${indexPhase})` : ''}` : (indexMessage || 'Checking index...')}
            </span>
            {indexing && typeof indexPct === 'number' && (
              <span className="index-pct">{indexPct}%</span>
            )}
          </div>
          {(archiveActive || archiveMessage) && (
            <div className={`archive-status ${archiveActive ? 'running' : 'done'}`} title={archiveMessage || ''}>
              <div className="archive-row">
                <span className="archive-dot" />
                <span className="archive-text">
                  {archiveActive
                    ? (archiveAction === 'extract' ? 'Extracting' : 'Compressing')
                    : (archiveMessage || 'Archive complete')}
                </span>
                {archiveActive && typeof archivePct === 'number' && (
                  <span className="archive-pct">{archivePct}%</span>
                )}
              </div>
              {archiveActive && typeof archivePct === 'number' && (
                <div className="archive-progress-bar">
                  <div className="archive-progress-fill" style={{ width: `${archivePct}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExplorerNavbar;
