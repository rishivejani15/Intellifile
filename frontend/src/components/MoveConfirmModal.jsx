import React, { useEffect, useState } from 'react';
import './components.css';

export default function MoveConfirmModal({ visible, items = [], targetFolder = '', onConfirm, onCancel }) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Close the modal when ESC is pressed
  useEffect(() => {
    if (!visible) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onCancel]);

  if (!visible) return null;

  const itemNames = items.map(i => {
    if (typeof i === 'string') {
      const parts = i.split(/[\\/]/);
      return parts[parts.length - 1] || i;
    }
    return i.name || i.path || 'item';
  }).join(', ');

  const targetName = typeof targetFolder === 'string'
    ? (targetFolder.split(/[\\/]/).pop() || targetFolder)
    : (targetFolder?.name || targetFolder?.path || 'folder');

  const handleConfirm = () => {
    if (dontAskAgain) {
      try {
        localStorage.setItem('intellifile_skip_move_confirm', 'true');
      } catch (_) {}
    }
    onConfirm();
  };

  return (
    <div className="dfm-overlay" onClick={onCancel}>
      <div className="dfm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dfm-header">
          <span className="dfm-header-icon">📁</span>
          <span>Move Item(s)</span>
        </div>
        <div className="dfm-body">
          <p>Are you sure you want to move the following item(s) into <strong>"{targetName}"</strong>?</p>
          <div className="dfm-items">{itemNames}</div>
          <label className="dfm-checkbox-label">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Don't ask me again before moving</span>
          </label>
        </div>
        <div className="dfm-actions">
          <button className="dfm-btn dfm-cancel" onClick={onCancel}>Cancel</button>
          <button className="dfm-btn dfm-confirm" onClick={handleConfirm}>Move</button>
        </div>
      </div>
    </div>
  );
}
