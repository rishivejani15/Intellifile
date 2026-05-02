import React, { useState, useEffect } from 'react';
import { formatFileSize, formatDate, getFileIcon } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg'];
const TEXT_EXTS = ['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.xml', '.java', '.cpp', '.c', '.go', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log', '.csv'];

function PreviewPanel({ selectedItem, visible, onClose }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedItem || !visible) {
      setThumbnail(null);
      setTextPreview(null);
      return;
    }

    const ext = (selectedItem.ext || '').toLowerCase();

    // Load image thumbnail
    if (IMAGE_EXTS.includes(ext) && selectedItem.type === 'file') {
      setLoading(true);
      setTextPreview(null);
      ipcRenderer?.invoke('get-thumbnail', selectedItem.path)
        .then(result => {
          if (result?.success) {
            setThumbnail(result.dataUrl);
          } else {
            setThumbnail(null);
          }
        })
        .catch(() => setThumbnail(null))
        .finally(() => setLoading(false));
    }
    // Load text preview
    else if (TEXT_EXTS.includes(ext) && selectedItem.type === 'file') {
      setLoading(true);
      setThumbnail(null);
      ipcRenderer?.invoke('read-file', selectedItem.path)
        .then(result => {
          if (result?.success && result.content) {
            // Show first 40 lines
            const lines = result.content.split('\n').slice(0, 40);
            setTextPreview(lines.join('\n'));
          } else {
            setTextPreview(null);
          }
        })
        .catch(() => setTextPreview(null))
        .finally(() => setLoading(false));
    } else {
      setThumbnail(null);
      setTextPreview(null);
    }
  }, [selectedItem, visible]);

  if (!visible || !selectedItem) return null;

  const ext = (selectedItem.ext || '').toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext);
  const isText = TEXT_EXTS.includes(ext);

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <span className="preview-title">Preview</span>
        <button className="preview-close" onClick={onClose} title="Close preview">×</button>
      </div>

      <div className="preview-body">
        {/* File icon / thumbnail */}
        <div className="preview-icon-area">
          {loading && <div className="preview-loading">Loading...</div>}
          {!loading && thumbnail && (
            <img src={thumbnail} alt={selectedItem.name} className="preview-thumbnail" />
          )}
          {!loading && !thumbnail && (
            <div className="preview-file-icon">{getFileIcon(selectedItem)}</div>
          )}
        </div>

        {/* File name */}
        <div className="preview-filename">{selectedItem.name}</div>

        {/* Text preview */}
        {!loading && textPreview && (
          <div className="preview-text-content">
            <pre>{textPreview}</pre>
          </div>
        )}

        {/* Metadata */}
        <div className="preview-meta">
          <div className="preview-meta-row">
            <span className="preview-meta-label">Type</span>
            <span className="preview-meta-value">
              {selectedItem.type === 'folder' ? 'Folder' : (ext || 'File')}
            </span>
          </div>
          {selectedItem.type !== 'folder' && (
            <div className="preview-meta-row">
              <span className="preview-meta-label">Size</span>
              <span className="preview-meta-value">{formatFileSize(selectedItem.size)}</span>
            </div>
          )}
          <div className="preview-meta-row">
            <span className="preview-meta-label">Modified</span>
            <span className="preview-meta-value">{formatDate(selectedItem.modified)}</span>
          </div>
        </div>

        {/* Preview not available message */}
        {!loading && !thumbnail && !textPreview && !isImage && !isText && selectedItem.type === 'file' && (
          <div className="preview-unavailable">
            Preview not available for this file type
          </div>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
