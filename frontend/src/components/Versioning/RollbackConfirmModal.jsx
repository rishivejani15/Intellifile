import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  MdRestore,
  MdClose,
  MdOutlineDescription,
  MdShield,
  MdAccessTime,
} from 'react-icons/md';
import './RollbackConfirmModal.css';

export default function RollbackConfirmModal({
  visible,
  versionId,
  fileName,
  versionDate,
  intent,
  isBaseline,
  onConfirm,
  onCancel,
}) {
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
  const displayIntent = isBaseline ? 'Original Version' : (intent || 'Update');

  let intentModifier = '';
  if (isBaseline) {
    intentModifier = 'intent-baseline';
  } else if (intent) {
    const i = intent.toLowerCase();
    if (i.includes('deletion')) intentModifier = 'intent-deletion';
    else if (i.includes('addition')) intentModifier = 'intent-addition';
  }

  return ReactDOM.createPortal(
    <div className="rollback-modal-overlay" onClick={onCancel}>
      <div className="rollback-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="rollback-modal-header">
          <div className="rollback-modal-header-left">
            <div className="rollback-modal-icon-badge">
              <MdRestore />
            </div>
            <div className="rollback-modal-title-group">
              <h3>Confirm Version Rollback</h3>
              <p>Restore previous file state</p>
            </div>
          </div>
          <button
            className="rollback-modal-close-btn"
            onClick={onCancel}
            title="Close"
            aria-label="Close"
          >
            <MdClose />
          </button>
        </div>

        <div className="rollback-modal-body">
          <div className="rollback-target-card">
            {fileName && (
              <div className="rollback-file-row">
                <MdOutlineDescription className="rollback-file-icon" />
                <span className="rollback-file-name" title={fileName}>
                  {fileName}
                </span>
              </div>
            )}

            <div className="rollback-meta-grid">
              {shortVersion && (
                <span className="rollback-version-pill" title={`Version ID: ${versionId}`}>
                  #{shortVersion}
                </span>
              )}
              {versionDate && (
                <span className="rollback-date-pill">
                  <MdAccessTime style={{ fontSize: '13px' }} />
                  {versionDate}
                </span>
              )}
              {displayIntent && (
                <span className={`rollback-intent-badge ${intentModifier}`}>
                  {displayIntent}
                </span>
              )}
            </div>
          </div>

          <div className="rollback-safety-box">
            <MdShield className="rollback-safety-icon" />
            <div className="rollback-safety-text">
              <strong>Current changes are safe.</strong> An automatic snapshot of your current file state will be created before rolling back, so nothing is lost.
            </div>
          </div>
        </div>

        <div className="rollback-modal-footer">
          <button className="rollback-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="rollback-btn-confirm" onClick={onConfirm}>
            <MdRestore style={{ fontSize: '16px' }} />
            Rollback to Version
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
