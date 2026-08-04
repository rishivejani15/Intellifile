import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import '../components.css';

export default function RollbackConfirmModal({ visible, versionId, onConfirm, onCancel }) {
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

  const shortVersion = versionId ? versionId.substring(0, 16) : '';

  return ReactDOM.createPortal(
    <div className="dfm-overlay" onClick={onCancel}>
      <div className="dfm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dfm-header">
          <span className="dfm-header-icon">🔄</span>
          <span>Confirm Version Rollback</span>
        </div>
        <div className="dfm-body">
          <p>Are you sure you want to rollback this file to version <strong>{shortVersion}</strong>?</p>
          <p style={{ fontSize: '12px', color: 'var(--t-muted)', marginTop: '6px' }}>
            Current changes will be automatically backed up before restoring this state.
          </p>
        </div>
        <div className="dfm-actions">
          <button className="dfm-btn dfm-cancel" onClick={onCancel}>Cancel</button>
          <button className="dfm-btn dfm-confirm" onClick={onConfirm}>Rollback</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
