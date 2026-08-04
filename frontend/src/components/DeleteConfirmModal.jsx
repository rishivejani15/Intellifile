import React, { useEffect, useState } from 'react';
import './components.css';

export default function DeleteConfirmModal({ visible, items = [], onConfirm, onCancel }) {
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

  const names = items.map(i => (typeof i === 'string' ? i : (i.name || i.path))).join(', ');

  const handleConfirm = () => {
    if (dontAskAgain) {
      try {
        localStorage.setItem('intellifile_skip_delete_confirm', 'true');
      } catch (_) {}
    }
    onConfirm();
  };

  return (
    <div className="dfm-overlay" onClick={onCancel}>
      <div className="dfm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dfm-header">
          <span className="dfm-header-icon">🗑️</span>
          <span>Move to Recycle Bin</span>
        </div>
        <div className="dfm-body">
          <p>Are you sure you want to move the following item(s) to the Recycle Bin?</p>
          <div className="dfm-items">{names}</div>
          <label className="dfm-checkbox-label">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Don't ask me again before deleting</span>
          </label>
        </div>
        <div className="dfm-actions">
          <button className="dfm-btn dfm-cancel" onClick={onCancel}>Cancel</button>
          <button className="dfm-btn dfm-confirm" onClick={handleConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
