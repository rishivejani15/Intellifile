import React from 'react';
import {
  MdOutlineAutoAwesome,
  MdOutlineTextFields,
  MdOutlineDriveFileRenameOutline,
  MdOutlineDocumentScanner,
  MdCalendarToday,
  MdFolder
} from 'react-icons/md';
import FileItem from './FileItem';
import { groupItems } from '../utils/fileUtils';

const RETRIEVAL_METHODS = {
  semantic: {
    label: 'Semantic',
    icon: <MdOutlineAutoAwesome className="method-badge-icon" />,
    className: 'method-badge-semantic',
    tooltip: 'Retrieved via AI semantic similarity search'
  },
  keyword: {
    label: 'Keyword',
    icon: <MdOutlineTextFields className="method-badge-icon" />,
    className: 'method-badge-keyword',
    tooltip: 'Retrieved via exact keyword matching'
  },
  filename: {
    label: 'File Name',
    icon: <MdOutlineDriveFileRenameOutline className="method-badge-icon" />,
    className: 'method-badge-filename',
    tooltip: 'Retrieved via file name match'
  },
  ocr: {
    label: 'OCR',
    icon: <MdOutlineDocumentScanner className="method-badge-icon" />,
    className: 'method-badge-ocr',
    tooltip: 'Retrieved via OCR text recognized in image/scan'
  },
  date: {
    label: 'Date',
    icon: <MdCalendarToday className="method-badge-icon" />,
    className: 'method-badge-date',
    tooltip: 'Retrieved via creation date match'
  },
  folder: {
    label: 'Folder',
    icon: <MdFolder className="method-badge-icon" />,
    className: 'method-badge-default',
    tooltip: 'Retrieved by exact folder name'
  },
  fuzzy: {
    label: 'Fuzzy',
    icon: <MdOutlineDriveFileRenameOutline className="method-badge-icon" />,
    className: 'method-badge-filename',
    tooltip: 'Retrieved by a close file-name spelling match'
  }
};

function getResultMethods(result) {
  if (Array.isArray(result.methods) && result.methods.length > 0) {
    return result.methods;
  }
  if (typeof result.methods === 'string' && result.methods.trim()) {
    return [result.methods.trim()];
  }
  const path = (result.path || '').toLowerCase();
  const isImage = /\.(png|jpe?g|bmp|webp|tiff)$/i.test(path);
  if (isImage) {
    return ['ocr', 'semantic'];
  }
  return ['semantic'];
}

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
          <div className="semantic-results-body">
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
