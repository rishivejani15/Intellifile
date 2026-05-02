import React, { useRef } from 'react';
import { getFileIcon, formatFileSize, formatDate } from '../utils/fileUtils';

function FileItem({
  item,
  idx,
  viewMode,
  isSelected,
  renamingItem,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  selectedFiles,
  displayItems,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
}) {
  const inputRef = useRef(null);
  const isRenaming = renamingItem?.path === item.path;
  const isFileSelected = 
    selectedFiles?.base?.path === item.path ||
    selectedFiles?.ours?.path === item.path ||
    selectedFiles?.theirs?.path === item.path ||
    isSelected;

  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify(
      displayItems.filter(i => isSelected).map(i => i.path)
    ));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  return (
    <div
      className={`file-item ${item.type} ${isFileSelected ? 'selected' : ''} ${isRenaming ? 'renaming' : ''}`}
      onDoubleClick={() => onDoubleClick(item)}
      onClick={(e) => onClick(item, idx, e)}
      onContextMenu={(e) => onContextMenu(e, item)}
      draggable
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, item)}
    >
      <div className="file-icon">{getFileIcon(item)}</div>
      <div className="file-info">
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            className="file-name-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            autoFocus
          />
        ) : (
          <>
            <div className="file-name">{item.name}</div>
            {viewMode === 'details' && (
              <div className="file-meta-details">
                <span className="file-type">
                  {item.type === 'folder' ? 'Folder' : item.type === 'drive' ? 'Drive' : item.ext}
                </span>
                <span className="file-size">
                  {item.type === 'drive' 
                    ? `${Math.round(item.size / (1024 ** 3))} GB` 
                    : formatFileSize(item.size)}
                </span>
                <span className="file-date">{formatDate(item.modified)}</span>
              </div>
            )}
            {viewMode !== 'details' && (
              <div className="file-meta">
                {item.type === 'folder' 
                  ? 'Folder' 
                  : item.type === 'drive' 
                    ? `${Math.round(item.size / (1024 ** 3))} GB total` 
                    : formatFileSize(item.size)}
              </div>
            )}
          </>
        )}
      </div>
      {isFileSelected && <div className="selected-badge">✓</div>}
    </div>
  );
}

export default FileItem;
