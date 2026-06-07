import React, { useState, useEffect } from 'react';
import { formatFileSize, formatDate, getFileIcon } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg'];
const TEXT_EXTS = ['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.xml', '.java', '.cpp', '.c', '.go', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log', '.csv'];
const DOCUMENT_EXTS = ['.pdf', '.docx', '.xlsx', '.pptx'];

function PreviewPanel({ selectedItem, visible, onClose }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [textPreview, setTextPreview] = useState(null);
  const [previewMessage, setPreviewMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (!selectedItem || !visible) {
      setThumbnail(null);
      setTextPreview(null);
      setPreviewMessage(null);
      setLoading(false);
      return () => { active = false; };
    }

    const ext = (selectedItem.ext || '').toLowerCase();
    setThumbnail(null);
    setTextPreview(null);
    setPreviewMessage(null);
    setLoading(false);

    // Load image thumbnail
    if (IMAGE_EXTS.includes(ext) && selectedItem.type === 'file') {
      setLoading(true);
      ipcRenderer?.invoke('get-thumbnail', selectedItem.path, { maxWidth: 720, maxHeight: 1120 })
        .then(result => {
          if (!active) return;
          if (result?.success) {
            setThumbnail(result.dataUrl);
          } else {
            setThumbnail(null);
          }
        })
        .catch(() => {
          if (active) setThumbnail(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    // Load text preview
    else if (TEXT_EXTS.includes(ext) && selectedItem.type === 'file') {
      setLoading(true);
      ipcRenderer?.invoke('read-file', selectedItem.path)
        .then(result => {
          if (!active) return;
          if (result?.success && result.content) {
            // Show first 40 lines
            const lines = result.content.split('\n').slice(0, 40);
            setTextPreview(lines.join('\n'));
          } else {
            setTextPreview(null);
          }
        })
        .catch(() => {
          if (active) setTextPreview(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    // Extract readable content from supported document formats
    else if (DOCUMENT_EXTS.includes(ext) && selectedItem.type === 'file') {
      setLoading(true);
      ipcRenderer?.invoke('get-document-preview', selectedItem.path)
        .then(result => {
          if (!active) return;
          if (result?.success && result.content) {
            setTextPreview(result.content + (result.truncated ? '\n\n... (preview truncated)' : ''));
          } else {
            setPreviewMessage(result?.error || 'No readable text was found in this document.');
          }
        })
        .catch(error => {
          if (active) setPreviewMessage(error?.message || 'Could not load document preview.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => { active = false; };
  }, [selectedItem, visible]);

  if (!visible || !selectedItem) return null;

  const ext = (selectedItem.ext || '').toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext);
  const isText = TEXT_EXTS.includes(ext);
  const isDocument = DOCUMENT_EXTS.includes(ext);

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
          <div className={`preview-text-content ${isDocument ? 'document-preview-content' : ''}`}>
            <pre>{textPreview}</pre>
          </div>
        )}

        {!loading && previewMessage && (
          <div className="preview-unavailable">{previewMessage}</div>
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
        {!loading && !thumbnail && !textPreview && !previewMessage && !isImage && !isText && !isDocument && selectedItem.type === 'file' && (
          <div className="preview-unavailable">
            Preview not available for this file type
          </div>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
