import React, { useState, useEffect } from 'react';
import { formatFileSize, getFileIcon } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

function PropertiesModal({ visible, selectedItem, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    if (visible && selectedItem) {
      setLoading(true);
      setActiveTab('general');
      ipcRenderer?.invoke('get-file-details', selectedItem.path)
        .then(result => {
          if (result?.success) {
            setDetails(result.details);
          } else {
            setDetails(null);
          }
        })
        .catch(() => setDetails(null))
        .finally(() => setLoading(false));
    } else {
      setDetails(null);
    }
  }, [visible, selectedItem]);

  if (!visible || !selectedItem) {
    return null;
  }

  const d = details || {};

  const formatFullDate = (ms) => {
    if (!ms) return '-';
    return new Date(ms).toLocaleString();
  };

  return (
    <div className="properties-modal" onClick={onClose}>
      <div className="properties-dialog enhanced" onClick={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="properties-titlebar">
          <span className="properties-title-icon">{getFileIcon(selectedItem)}</span>
          <span className="properties-title-text">{selectedItem.name} Properties</span>
          <button className="properties-close-btn" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div className="properties-tabs">
          <button
            className={`properties-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            className={`properties-tab ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Details
          </button>
        </div>

        {/* Content */}
        <div className="properties-content">
          {loading && <div className="properties-loading">Loading details...</div>}

          {!loading && activeTab === 'general' && (
            <>
              <div className="properties-icon-row">
                <span className="properties-big-icon">{getFileIcon(selectedItem)}</span>
                <div className="properties-name-edit">{selectedItem.name}</div>
              </div>
              <div className="properties-divider"></div>

              <div className="detail-row">
                <span className="detail-label">Type</span>
                <span className="detail-value">
                  {d.isDirectory ? 'File folder' : (d.ext || selectedItem.ext || 'File')}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Location</span>
                <span className="detail-value path-value">{selectedItem.path.substring(0, selectedItem.path.lastIndexOf('\\'))}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Size</span>
                <span className="detail-value">
                  {d.size != null ? `${formatFileSize(d.size)} (${d.size.toLocaleString()} bytes)` : '-'}
                </span>
              </div>
              {d.isDirectory && d.itemCount != null && (
                <div className="detail-row">
                  <span className="detail-label">Contains</span>
                  <span className="detail-value">{d.itemCount} items</span>
                </div>
              )}
              <div className="properties-divider"></div>

              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">{formatFullDate(d.created)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Modified</span>
                <span className="detail-value">{formatFullDate(d.modified)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Accessed</span>
                <span className="detail-value">{formatFullDate(d.accessed)}</span>
              </div>
              <div className="properties-divider"></div>

              <div className="detail-row">
                <span className="detail-label">Attributes</span>
                <span className="detail-value attributes">
                  <label className="attribute-checkbox">
                    <input type="checkbox" checked={!!d.isReadOnly} readOnly disabled />
                    Read-only
                  </label>
                  <label className="attribute-checkbox">
                    <input type="checkbox" checked={!!d.isHidden} readOnly disabled />
                    Hidden
                  </label>
                </span>
              </div>
            </>
          )}

          {!loading && activeTab === 'details' && (
            <>
              <div className="detail-row">
                <span className="detail-label">Name</span>
                <span className="detail-value">{selectedItem.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Full Path</span>
                <span className="detail-value path-value">{selectedItem.path}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Extension</span>
                <span className="detail-value">{d.ext || selectedItem.ext || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Size (bytes)</span>
                <span className="detail-value">{d.size != null ? d.size.toLocaleString() : '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Size (human)</span>
                <span className="detail-value">{d.size != null ? formatFileSize(d.size) : '-'}</span>
              </div>
              {d.attributes && (
                <div className="detail-row">
                  <span className="detail-label">Win Attributes</span>
                  <span className="detail-value">{d.attributes}</span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">{formatFullDate(d.created)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Modified</span>
                <span className="detail-value">{formatFullDate(d.modified)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Accessed</span>
                <span className="detail-value">{formatFullDate(d.accessed)}</span>
              </div>
            </>
          )}
        </div>

        <div className="properties-actions">
          <button className="properties-ok-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

export default PropertiesModal;
