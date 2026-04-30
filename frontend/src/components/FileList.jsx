import React, { useMemo } from 'react';
import { getFileIcon, formatFileSize, formatDate } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

function FileList({
  items,
  viewMode,
  groupBy,
  loading,
  renamingItem,
  renameValue,
  selectedItems,
  selectedFiles,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDropOnItem,
  onRenameValueChange,
  onRenameBlur,
  onRenameKeyDown,
}) {
  const groupedItems = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'All items', items }];
    }

    const groups = new Map();
    items.forEach(item => {
      let key = 'Other';
      if (groupBy === 'type') {
        key = item.type === 'folder' ? 'Folders' : (item.ext || 'Other');
      } else if (groupBy === 'date') {
        key = formatDate(item.modified);
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    return Array.from(groups.entries()).map(([key, groupItems]) => ({ key, items: groupItems }));
  }, [items, groupBy]);

  const isFileSelected = (item) => {
    return selectedFiles.base?.path === item.path ||
      selectedFiles.ours?.path === item.path ||
      selectedFiles.theirs?.path === item.path ||
      selectedItems.some(i => i.path === item.path);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (items.length === 0) {
    return <div className="empty-state">📁 No files found</div>;
  }

  return (
    <div className={`file-list ${viewMode}`}>
      {groupedItems.map(group => (
        <React.Fragment key={group.key}>
          {groupBy !== 'none' && (
            <div className="group-header">
              {group.key} ({group.items.length})
            </div>
          )}
          {group.items.map((item, idx) => (
            <div
              key={item.path}
              className={`file-item ${item.type} ${isFileSelected(item) ? 'selected' : ''} ${renamingItem?.path === item.path ? 'renaming' : ''}`}
              onDoubleClick={() => onItemDoubleClick(item)}
              onClick={(e) => onItemClick(item, idx, e)}
              onContextMenu={(e) => onContextMenu(e, item)}
              draggable
              onDragStart={(e) => onDragStart(e, item)}
              onDragOver={onDragOver}
              onDrop={(e) => onDropOnItem(e, item)}
            >
              <div className="file-icon">{getFileIcon(item)}</div>
              <div className="file-info">
                {renamingItem?.path === item.path ? (
                  <input
                    type="text"
                    className="file-name-input"
                    value={renameValue}
                    onChange={(e) => onRenameValueChange(e.target.value)}
                    onBlur={onRenameBlur}
                    onKeyDown={onRenameKeyDown}
                    autoFocus
                  />
                ) : (
                  <>
                    <div className="file-name">{item.name}</div>
                    {viewMode === 'details' && (
                      <div className="file-meta-details">
                        <span className="file-type">{item.type === 'folder' ? 'Folder' : item.type === 'drive' ? 'Drive' : item.ext}</span>
                        <span className="file-size">{item.type === 'drive' ? `${Math.round(item.size / (1024 ** 3))} GB` : formatFileSize(item.size)}</span>
                        <span className="file-date">{formatDate(item.modified)}</span>
                      </div>
                    )}
                    {viewMode !== 'details' && (
                      <div className="file-meta">
                        {item.type === 'folder' ? 'Folder' : item.type === 'drive' ? `${Math.round(item.size / (1024 ** 3))} GB total` : formatFileSize(item.size)}
                      </div>
                    )}
                  </>
                )}
              </div>
              {isFileSelected(item) && <div className="selected-badge">✓</div>}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export default FileList;
