import React from 'react';
import { formatFileSize, formatDate } from '../utils/fileUtils';

function StatusBar({ items, selectedItems, selectedItem, clipboard }) {
  return (
    <div className="explorer-statusbar">
      <span>{items.length} items</span>
      <span>{selectedItems.length} selected</span>
      {selectedItem && (
        <span>
          {selectedItem.type === 'file' 
            ? `${formatFileSize(selectedItem.size)} · ${formatDate(selectedItem.modified)}` 
            : 'Folder'}
        </span>
      )}
      {clipboard && (
        <span>📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length} item(s)</span>
      )}
    </div>
  );
}

export default StatusBar;
