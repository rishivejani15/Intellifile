import React, { useMemo, useState, useEffect } from 'react';
import { MdFolderOpen, MdPhoneAndroid, MdPushPin, MdStar } from 'react-icons/md';
import { BsWindows } from 'react-icons/bs';
import { getFileIcon, formatFileSize, formatDate } from '../utils/fileUtils';
import { isStarred, isPinned } from '../utils/starPinUtils';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico'];

const formatWindowsDriveSize = (bytes) => {
  const gb = Number(bytes || 0) / (1024 ** 3);
  if (gb >= 100) {
    return `${Math.round(gb)} GB`;
  }
  if (gb >= 10) {
    const formatted = gb.toFixed(1);
    return `${formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted} GB`;
  }
  const formatted = gb.toFixed(2);
  return `${formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted} GB`;
};

function WindowsDriveIcon({ isSystem, isRemovable, isPortable }) {
  if (isPortable) {
    return (
      <div className="win-drive-icon-container">
        <MdPhoneAndroid size={34} style={{ color: '#0078d4', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }} />
      </div>
    );
  }

  return (
    <div className="win-drive-icon-container">
      {isSystem && (
        <div className="win-drive-os-badge" title="Windows System Drive">
          <BsWindows size={10} color="#ffffff" />
        </div>
      )}
      <svg width="46" height="34" viewBox="0 0 46 34" fill="none" xmlns="http://www.w3.org/2000/svg" className="win-drive-svg">
        <defs>
          <linearGradient id="driveChassisGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4b5563" />
            <stop offset="40%" stopColor="#2e3440" />
            <stop offset="100%" stopColor="#181c24" />
          </linearGradient>
          <linearGradient id="driveTopFace" x1="0%" y1="0%" x2="100%" y2="80%">
            <stop offset="0%" stopColor="#f3f4f6" />
            <stop offset="50%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#9ca3af" />
          </linearGradient>
        </defs>
        
        {/* Chassis shadow */}
        <rect x="2" y="5" width="42" height="26" rx="4" fill="rgba(0,0,0,0.3)" />
        
        {/* Drive Chassis base */}
        <rect x="2" y="3" width="42" height="26" rx="4" fill="url(#driveChassisGrad)" stroke="#111827" strokeWidth="1" />
        
        {/* Metallic Top Plate */}
        <rect x="4" y="5" width="38" height="12" rx="2" fill="url(#driveTopFace)" opacity="0.9" />
        
        {/* Top Plate screw accents */}
        <circle cx="6.5" cy="7.5" r="0.8" fill="#6b7280" />
        <circle cx="39.5" cy="7.5" r="0.8" fill="#6b7280" />
        
        {/* Activity LED */}
        <circle cx="9" cy="20" r="2.2" fill={isRemovable ? "#10b981" : "#22c55e"} />
        <circle cx="9" cy="20" r="1" fill="#ffffff" />
      </svg>
    </div>
  );
}


function FileList({
  items,
  viewMode,
  groupBy,
  loading,
  currentPath = '',
  renamingItem,
  renameValue,
  selectedItems,
  selectedFiles,
  clipboard,
  isCutItem,
  inputRef,
  tempHighlightedPath,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onEmptySpaceContextMenu,
  onEmptySpaceClick,
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

  const isStarredPath = currentPath === 'Starred' || String(currentPath).toLowerCase() === 'starred';

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
    if (!item || !item.path) return false;
    const itemPath = item.path.toLowerCase();
    return (selectedFiles?.base?.path || '').toLowerCase() === itemPath ||
      (selectedFiles?.ours?.path || '').toLowerCase() === itemPath ||
      (selectedFiles?.theirs?.path || '').toLowerCase() === itemPath ||
      selectedItems.some(i => (i.path || '').toLowerCase() === itemPath);
  };

  if (loading) {
    return (
      <div className="file-list-loading">
        <div className="loading-spinner"></div>
        <span>Loading folder contents...</span>
      </div>
    );
  }

  const isDrivesView = items.length > 0 && items.every(i => (i.type === 'drive' || i.type === 'portable') && i.type !== 'file' && i.type !== 'folder');
  if (!items || items.length === 0) {
    if (isStarredPath) {
      return (
        <div className="file-list-empty starred-empty-container">
          <div className="starred-empty-glow-wrapper">
            <div className="starred-empty-star-badge">
              <MdStar size={44} className="starred-empty-star-icon" />
            </div>
          </div>
          <h3 className="starred-empty-title">No starred files yet</h3>
          <p className="starred-empty-subtitle">
            Star important files and folders for instant, one-click access right here.
          </p>
          <div className="starred-empty-hint-pill">
            <span className="starred-hint-icon">💡</span>
            <span>Right-click any file or folder and click <strong>⭐ Star document</strong></span>
          </div>
        </div>
      );
    }

    return (
      <div className="file-list-empty">
        <div className="general-empty-icon-wrapper">
          <MdFolderOpen size={42} className="empty-icon" />
        </div>
        <h3 className="general-empty-title">This folder is empty</h3>
        <p className="general-empty-subtitle">Items added to this directory will appear here</p>
      </div>
    );
  }

  // Drive layout view mode rendering (This PC view)
  const isDriveList = items.length > 0 && items.every(item => item.type === 'drive' || item.type === 'portable' || item.isPortable);

  if (isDriveList) {
    return (
      <div className="file-list drive-grid-container">
        <div className="drive-grid-header">
          Devices and drives ({items.length})
        </div>
        <div className="drive-grid-content win-drives-list">
          {items.map((item, idx) => {
            const isTempHighlighted = tempHighlightedPath === item.path;
            const isSystem = item.isSystem || item.path?.toUpperCase().startsWith('C:') || item.device?.toUpperCase() === 'C:';
            const isRemovable = Boolean(item.isRemovable || item.isUSB);
            const isPortable = Boolean(item.isPortable || item.type === 'portable');
            const available = item.available ?? item.free ?? 0;
            const size = item.size || 0;
            const used = Math.max(0, size - available);
            const usedPercent = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
            const isCritical = size > 0 && (used / size) > 0.9;
            const isWarning = size > 0 && (used / size) > 0.75;
            const itemStarred = isStarred(item);
            const itemPinned = isPinned(item);

            return (
              <div
                key={item.path || item.name}
                data-path={item.path}
                className={`file-item drive ${isFileSelected(item) ? 'selected' : ''} ${isTempHighlighted ? 'temp-highlighted' : ''} ${itemPinned ? 'is-pinned-item' : ''} ${itemStarred ? 'is-starred-item' : ''}`}
                onDoubleClick={() => onItemDoubleClick(item)}
                onClick={(e) => {
                  e.stopPropagation();
                  onItemClick(item, idx, e);
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  onContextMenu(e, item);
                }}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={onDragOver}
                onDrop={(e) => onDropOnItem(e, item)}
              >
                <WindowsDriveIcon isSystem={isSystem} isRemovable={isRemovable} isPortable={isPortable} />
                <div className="file-info drive-file-info">
                  <div className="drive-name-title" title={item.name}>{item.name}</div>
                  {isPortable && size === 0 ? (
                    <div className="drive-storage-text" style={{ marginTop: '4px' }}>
                      Portable Media Device
                    </div>
                  ) : (
                    <>
                      <div className="drive-storage-bar">
                        <div
                          className={`drive-storage-fill ${isCritical ? 'critical' : isWarning ? 'warning' : ''}`}
                          style={{ width: `${usedPercent}%` }}
                        />
                      </div>
                      <div className="drive-storage-text">
                        {`${formatWindowsDriveSize(available)} free of ${formatWindowsDriveSize(size)}`}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`file-list ${viewMode} ${isStarredPath ? 'starred-file-list' : ''}`}
      role="presentation"
      onClick={(e) => {
        const onFileItem = !!e.target?.closest?.('.file-item');
        if (!onFileItem) {
          onEmptySpaceClick?.(e);
        }
      }}
      onContextMenu={(e) => {
        // Fire for any non-file-item area so right-click works in scrolled blank space too.
        const onFileItem = !!e.target?.closest?.('.file-item');
        if (!onFileItem) {
          e.preventDefault();
          onEmptySpaceContextMenu?.(e);
        }
      }}
    >
      {isStarredPath && (
        <div className="starred-grid-header">
          <MdStar size={16} className="starred-header-icon" />
          <span>Starred Items ({items.length})</span>
        </div>
      )}
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
            const isTempHighlighted = tempHighlightedPath === item.path;
            const globalIdx = items.findIndex(i => i.path === item.path);
            const itemIndex = globalIdx !== -1 ? globalIdx : idx;
            const isSystem = item.isSystem || item.path?.toUpperCase().startsWith('C:') || item.device?.toUpperCase() === 'C:';
            const isRemovable = Boolean(item.isRemovable || item.isUSB);
            const available = item.available ?? item.free ?? 0;
            const size = item.size || 0;
            const used = Math.max(0, size - available);
            const usedPercent = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
            const isCritical = size > 0 && (used / size) > 0.9;
            const isWarning = size > 0 && (used / size) > 0.75;
            const itemStarred = isStarred(item);
            const itemPinned = isPinned(item);

            return (
              <div
                key={item.path}
                data-path={item.path}
                className={`file-item ${item.type} ${isFileSelected(item) ? 'selected' : ''} ${isTempHighlighted ? 'temp-highlighted' : ''} ${renamingItem?.path === item.path ? 'renaming' : ''} ${isCutItem(item) ? 'cut-item' : ''} ${itemPinned ? 'is-pinned-item' : ''} ${itemStarred ? 'is-starred-item' : ''}`}
                onDoubleClick={() => onItemDoubleClick(item)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) {
                    try { window.getSelection()?.removeAllRanges(); } catch (_) { }
                  }
                  onItemClick(item, itemIndex, e);
                }}
                onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={onDragOver}
                onDrop={(e) => onDropOnItem(e, item)}
              >
                <div className="file-icon">
                  {item.type === 'drive' ? (
                    <WindowsDriveIcon isSystem={isSystem} isRemovable={isRemovable} />
                  ) : hasThumb ? (
                    <img src={thumbnails[item.path]} alt="" className="file-thumbnail" />
                  ) : (
                    getFileIcon(item)
                  )}
                  {itemPinned && (
                    <span className="file-pin-badge" title="Pinned to top">
                      <MdPushPin size={12} />
                    </span>
                  )}
                  {itemStarred && (
                    <span className="file-star-badge" title="Starred document">
                      <MdStar size={11} />
                    </span>
                  )}
                </div>
                <div className={`file-info ${item.type === 'drive' ? 'drive-file-info' : ''}`}>
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
                  ) : item.type === 'drive' ? (
                    <>
                      <div className="file-name drive-name-title" title={item.name}>{item.name}</div>
                      {viewMode === 'details' ? (
                        <div className="file-meta-details">
                          <span className="file-type">{isRemovable ? 'USB Drive' : 'Local Disk'}</span>
                          <span className="file-size">{`${formatWindowsDriveSize(available)} free of ${formatWindowsDriveSize(size)}`}</span>
                          <span className="file-date">--</span>
                        </div>
                      ) : (
                        <div className="drive-card-body">
                          <div className="drive-storage-bar">
                            <div
                              className={`drive-storage-fill ${isCritical ? 'critical' : isWarning ? 'warning' : ''}`}
                              style={{ width: `${usedPercent}%` }}
                            />
                          </div>
                          <div className="drive-storage-text">
                            {`${formatWindowsDriveSize(available)} free of ${formatWindowsDriveSize(size)}`}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="file-name" title={item.name}>{item.name}</div>
                      {viewMode === 'details' && (
                        <div className="file-meta-details">
                          <span className="file-type">{item.type === 'folder' ? 'Folder' : item.ext}</span>
                          <span className="file-size">{formatFileSize(item.size)}</span>
                          <span className="file-date">{formatDate(item.modified)}</span>
                        </div>
                      )}
                      {viewMode !== 'details' && (
                        <div className="file-meta">
                          {item.type === 'folder' ? 'Folder' : formatFileSize(item.size)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

export default FileList;
