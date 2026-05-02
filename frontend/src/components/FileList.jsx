import React, { useMemo, useState, useEffect } from 'react';
import { getFileIcon, formatFileSize, formatDate } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico'];

function FileList({
  items,
  viewMode,
  groupBy,
  loading,
  renamingItem,
  renameValue,
  selectedItems,
  selectedFiles,
  clipboard,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onEmptySpaceContextMenu,
  onDragStart,
  onDragOver,
  onDropOnItem,
  onRenameValueChange,
  onRenameBlur,
  onRenameKeyDown,
}) {
  const [thumbnails, setThumbnails] = useState({});

  // Load thumbnails for image files in icons/list view
  useEffect(() => {
    if (viewMode !== 'icons' && viewMode !== 'list') return;

    const imageItems = items.filter(item =>
      item.type === 'file' && IMAGE_EXTS.includes((item.ext || '').toLowerCase())
    );

    // Only load thumbnails for visible images (limit to 30 for performance)
    const toLoad = imageItems.slice(0, 30).filter(item => !thumbnails[item.path]);
    if (toLoad.length === 0) return;

    let cancelled = false;
    const loadThumbnails = async () => {
      for (const item of toLoad) {
        if (cancelled) break;
        try {
          const result = await ipcRenderer?.invoke('get-thumbnail', item.path);
          if (result?.success && !cancelled) {
            setThumbnails(prev => ({ ...prev, [item.path]: result.dataUrl }));
          }
        } catch (e) {
          // Ignore thumbnail errors
        }
      }
    };
    loadThumbnails();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, viewMode]);

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
    return selectedFiles?.base?.path === item.path ||
      selectedFiles?.ours?.path === item.path ||
      selectedFiles?.theirs?.path === item.path ||
      selectedItems.some(i => i.path === item.path);
  };

  const isCutItem = (item) => {
    return clipboard?.operation === 'cut' &&
      clipboard?.items?.some(i => i.path === item.path);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <div
        className="empty-state"
        onContextMenu={(e) => {
          e.preventDefault();
          onEmptySpaceContextMenu?.(e);
        }}
      >
        📁 This folder is empty
      </div>
    );
  }

  return (
    <div
      className={`file-list ${viewMode}`}
      onContextMenu={(e) => {
        // Only fire for empty space (not on file items, they handle their own)
        if (e.target === e.currentTarget || e.target.classList.contains('file-list') || e.target.classList.contains('group-header')) {
          e.preventDefault();
          onEmptySpaceContextMenu?.(e);
        }
      }}
    >
      {groupedItems.map(group => (
        <React.Fragment key={group.key}>
          {groupBy !== 'none' && (
            <div className="group-header">
              {group.key} ({group.items.length})
            </div>
          )}
          {group.items.map((item, idx) => {
            const ext = (item.ext || '').toLowerCase();
            const hasThumb = thumbnails[item.path] && IMAGE_EXTS.includes(ext);

            return (
              <div
                key={item.path}
                className={`file-item ${item.type} ${isFileSelected(item) ? 'selected' : ''} ${renamingItem?.path === item.path ? 'renaming' : ''} ${isCutItem(item) ? 'cut-item' : ''}`}
                onDoubleClick={() => onItemDoubleClick(item)}
                onClick={(e) => onItemClick(item, idx, e)}
                onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={onDragOver}
                onDrop={(e) => onDropOnItem(e, item)}
              >
                <div className="file-icon">
                  {hasThumb ? (
                    <img src={thumbnails[item.path]} alt="" className="file-thumbnail" />
                  ) : (
                    getFileIcon(item)
                  )}
                </div>
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
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

export default FileList;
