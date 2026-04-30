import React from 'react';
import './FileExplorer/FileExplorer.css';

function ExplorerNavbar({
  breadcrumb,
  addressPath,
  historyIndex,
  history,
  viewMode,
  sortBy,
  groupBy,
  searchQuery,
  engineReady,
  indexing,
  indexedFolder,
  semanticLoading,
  onAddressSubmit,
  onBreadcrumbClick,
  onBack,
  onForward,
  onUp,
  onViewModeChange,
  onSortByChange,
  onGroupByChange,
  onCreateFolder,
  onIndexDevice,
  onSearchChange,
  onSearchKeyDown,
}) {
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
            placeholder={engineReady ? "🔍 Search (Enter for AI search)" : "🔍 Search (engine loading...)"}
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e, 'query')}
            onKeyDown={onSearchKeyDown}
          />
          {semanticLoading && <span className="search-spinner">⏳</span>}
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
        </div>

        <div className="group-controls">
          <select value={groupBy} onChange={(e) => onGroupByChange(e.target.value)} className="group-select">
            <option value="none">Group: None</option>
            <option value="type">Group: Type</option>
            <option value="date">Group: Date</option>
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
    </div>
  );
}

export default ExplorerNavbar;
