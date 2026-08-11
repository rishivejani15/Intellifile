import React, { useEffect, useState } from 'react';
import { getFileIcon } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

export default function DeleteConfirmModal({ visible, items = [], onConfirm, onCancel }) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onCancel]);

  if (!visible) return null;

  const firstItem = items.length > 0 ? items[0] : null;
  const isSingle = items.length === 1;
  const names = items.map(i => (typeof i === 'string' ? i : (i.name || i.path))).join(', ');

  const handleConfirm = () => {
    if (dontAskAgain) {
      try {
        localStorage.setItem('intellifile_skip_delete_confirm', 'true');
      } catch (_) {}
    }
    onConfirm?.();
  };

  return (
    <div className="properties-modal" onClick={onCancel}>
      <div
        className="properties-dialog enhanced properties-dialog--windows"
        style={{ width: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Titlebar Header */}
        <div className="properties-titlebar">
          <span className="properties-title-icon">🗑️</span>
          <span className="properties-title-text">
            {isSingle ? 'Delete Item' : `Delete ${items.length} Items`}
          </span>
          <button className="properties-close-btn" onClick={onCancel} type="button">×</button>
        </div>

        {/* Content Body */}
        <div className="properties-content">
          <div className="properties-icon-row">
            <span className="properties-big-icon">
              {isSingle && firstItem ? getFileIcon(firstItem) : '🗑️'}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="properties-name-edit">
                {isSingle ? (firstItem?.name || 'Selected Item') : `Delete ${items.length} selected items`}
              </div>
              <div className="properties-subtitle">
                Are you sure you want to move this to the Recycle Bin?
              </div>
            </div>
          </div>

          <div className="properties-divider" />

          {/* Items Box */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'var(--s-hover)',
              border: '1px solid var(--bo-light)',
              maxHeight: '120px',
              overflowY: 'auto',
              fontSize: 'var(--text-sm)',
              color: 'var(--t-primary)',
              wordBreak: 'break-word',
              marginBottom: '1rem'
            }}
          >
            {names}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label className="attribute-checkbox" style={{ cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
              />
              <span>Don't ask me again before deleting</span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="properties-actions" style={{ gap: '8px' }}>
          <button type="button" className="properties-secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="properties-danger-btn" onClick={handleConfirm}>
            Move to Recycle Bin
          </button>
        </div>
      </div>
    </div>
  );
}
