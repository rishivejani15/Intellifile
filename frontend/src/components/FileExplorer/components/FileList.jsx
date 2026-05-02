import React from 'react';
import FileItem from './FileItem';
import { groupItems } from '../utils/fileUtils';

function FileList({
  items,
  viewMode,
  groupBy,
  loading,
  semanticResults,
  searchQuery,
  selectedItem,
  selectedItems,
  renamingItem,
  renameValue,
  onRenameChange,
  onRename,
  onRenameCancel,
  selectedFiles,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onDropOnItem,
  onDragOver,
  onSearchResultClick,
  onCloseSearch,
}) {
  const displayItems = items;
  const groupedItems = groupItems(displayItems, groupBy);

  // Semantic search results overlay
  if (semanticResults !== null) {
    return (
      <div className="semantic-results">
        <div className="semantic-results-header">
          <h3>🧠 AI Search Results</h3>
          <button className="close-results-btn" onClick={onCloseSearch}>✕ Close</button>
        </div>
        {semanticResults.length === 0 ? (
          <div className="empty-state">No matching files found</div>
        ) : (
          <div className="file-list list">
            {semanticResults.map((result, idx) => {
              const fileName = result.path.split('\\').pop() || result.path.split('/').pop();
              const scorePercent = Math.round(result.score * 100);
              return (
                <div
                  key={result.path + idx}
                  className="file-item file search-result-item"
                  onClick={() => onSearchResultClick(result.path)}
                  title={result.path}
                >
                  <div className="file-icon">📄</div>
                  <div className="file-info">
                    <div className="file-name">{fileName}</div>
                    <div className="file-meta">{result.path}</div>
                  </div>
                  <div className="search-score">
                    <div className="score-bar">
                      <div className="score-fill" style={{ width: `${scorePercent}%` }} />
                    </div>
                    <span className="score-text">{scorePercent}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Loading state
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  // Empty state
  if (!displayItems || displayItems.length === 0) {
    return <div className="empty-state">📁 No files found</div>;
  }

  // File list
  return (
    <div className={`file-list ${viewMode}`}>
      {groupedItems.map(group => (
        <React.Fragment key={group.key}>
          {groupBy !== 'none' && (
            <div className="group-header">
              {group.key} ({group.items.length})
            </div>
          )}
          {group.items.map((item) => {
            const idx = displayItems.findIndex(i => i.path === item.path);
            const isSelected = selectedItems.some(i => i.path === item.path);
            
            return (
              <FileItem
                key={item.path}
                item={item}
                idx={idx}
                viewMode={viewMode}
                isSelected={isSelected}
                renamingItem={renamingItem}
                renameValue={renameValue}
                onRenameChange={onRenameChange}
                onRenameSubmit={() => onRename(item)}
                onRenameCancel={onRenameCancel}
                selectedFiles={selectedFiles}
                displayItems={displayItems}
                onClick={onItemClick}
                onDoubleClick={onItemDoubleClick}
                onContextMenu={onContextMenu}
                onDragOver={onDragOver}
                onDrop={onDropOnItem}
              />
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

export default FileList;
