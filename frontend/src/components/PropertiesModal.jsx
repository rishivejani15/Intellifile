import React from 'react';
import { formatFileSize, formatDate } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

function PropertiesModal({ visible, selectedItem, onClose }) {
  if (!visible || !selectedItem) {
    return null;
  }

  return (
    <div className="properties-modal" onClick={onClose}>
      <div className="properties-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="properties-header">Properties</div>
        <div className="properties-content">
          <div className="detail-row"><span>Name</span><span>{selectedItem.name}</span></div>
          <div className="detail-row"><span>Path</span><span>{selectedItem.path}</span></div>
          <div className="detail-row"><span>Type</span><span>{selectedItem.type === 'folder' ? 'Folder' : selectedItem.ext}</span></div>
          <div className="detail-row"><span>Size</span><span>{selectedItem.type === 'folder' ? '-' : formatFileSize(selectedItem.size)}</span></div>
          <div className="detail-row"><span>Modified</span><span>{formatDate(selectedItem.modified)}</span></div>
        </div>
        <div className="properties-actions">
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default PropertiesModal;
