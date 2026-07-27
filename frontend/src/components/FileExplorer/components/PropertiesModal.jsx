import React from 'react';
import { formatFileSize, formatDate } from '../utils/fileUtils';

function PropertiesModal({ show, item, onClose }) {
  if (!show || !item) return null;

  return (
    <div className="properties-modal" onClick={onClose}>
      <div className="properties-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="properties-header">Properties</div>
        <div className="properties-content">
          <div className="detail-row">
            <span>Name</span>
            <span>{item.name}</span>
          </div>
          <div className="detail-row">
            <span>Path</span>
            <span>{item.path}</span>
          </div>
          <div className="detail-row">
            <span>Type</span>
            <span>{item.type === 'folder' ? 'Folder' : item.ext}</span>
          </div>
          <div className="detail-row">
            <span>Size</span>
            <span>{item.type === 'folder' ? '-' : formatFileSize(item.size)}</span>
          </div>
          <div className="detail-row">
            <span>Modified</span>
            <span>{formatDate(item.modified)}</span>
          </div>
        </div>
        <div className="properties-actions">
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default PropertiesModal;
