import React, { useRef } from 'react';
import { BsDeviceHddFill, BsUsbDriveFill } from 'react-icons/bs';
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

  const isDrive = item.type === 'drive';
  const isRemovable = Boolean(item.isRemovable || item.isUSB);

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
      <div className="file-icon">
        {isDrive ? (
          isRemovable ? (
            <BsUsbDriveFill size={viewMode === 'details' ? 18 : 36} className="drive-icon-svg usb-drive" />
          ) : (
            <BsDeviceHddFill size={viewMode === 'details' ? 18 : 36} className="drive-icon-svg hdd-drive" />
          )
        ) : (
          getFileIcon(item)
        )}
      </div>
      <div className={`file-info ${isDrive ? 'drive-file-info' : ''}`}>
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
        ) : isDrive ? (
          <>
            <div className="file-name drive-name-title" title={item.name}>{item.name}</div>
            {viewMode === 'details' ? (
              <div className="file-meta-details">
                <span className="file-type">{isRemovable ? 'USB Drive' : 'Local Disk'}</span>
                <span className="file-size">{`${Math.round((item.available ?? item.free ?? 0) / (1024 ** 3))} GB free of ${Math.round((item.size || 0) / (1024 ** 3))} GB`}</span>
                <span className="file-date">--</span>
              </div>
            ) : (
              <div className="drive-card-body">
                <div className="drive-storage-bar">
                  <div
                    className={`drive-storage-fill ${
                      item.size > 0 && ((item.size - (item.available ?? item.free ?? 0)) / item.size) > 0.9
                        ? 'critical'
                        : item.size > 0 && ((item.size - (item.available ?? item.free ?? 0)) / item.size) > 0.75
                        ? 'warning'
                        : ''
                    }`}
                    style={{
                      width: `${item.size > 0 ? Math.min(100, Math.round(((item.size - (item.available ?? item.free ?? 0)) / item.size) * 100)) : 0}%`
                    }}
                  />
                </div>
                <div className="drive-storage-text">
                  {`${Math.round((item.available ?? item.free ?? 0) / (1024 ** 3))} GB free of ${Math.round((item.size || 0) / (1024 ** 3))} GB`}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="file-name">{item.name}</div>
            {viewMode === 'details' && (
              <div className="file-meta-details">
                <span className="file-type">
                  {item.type === 'folder' ? 'Folder' : item.ext}
                </span>
                <span className="file-size">
                  {formatFileSize(item.size)}
                </span>
                <span className="file-date">{formatDate(item.modified)}</span>
              </div>
            )}
            {viewMode !== 'details' && (
              <div className="file-meta">
                {item.type === 'folder' 
                  ? 'Folder' 
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
