import React, { useEffect, useState } from 'react';
import './components.css';

export default function GlobalConfirmModal() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    window.__app_confirm_available = true;

    const handleShowConfirm = (e) => {
      const detail = e.detail || {};
      const {
        message = '',
        items = [],
        title,
        icon,
        confirmText,
        cancelText,
        danger,
        callback
      } = detail;

      const isDelete = message.toLowerCase().includes('recycle bin') || message.toLowerCase().includes('delete') || message.toLowerCase().includes('trash') || danger;

      setConfig({
        message,
        items,
        title: title || (isDelete ? 'Move to Recycle Bin' : 'Confirmation'),
        icon: icon || (isDelete ? '🗑️' : '⚠️'),
        confirmText: confirmText || (isDelete ? 'Delete' : 'Confirm'),
        cancelText: cancelText || 'Cancel',
        isDelete,
        callback
      });
    };

    window.addEventListener('app-show-confirm', handleShowConfirm);
    return () => {
      window.__app_confirm_available = false;
      window.removeEventListener('app-show-confirm', handleShowConfirm);
    };
  }, []);

  const handleCancel = () => {
    const cb = config?.callback;
    setConfig(null);
    if (cb) cb(false);
  };

  const handleConfirm = () => {
    const cb = config?.callback;
    setConfig(null);
    if (cb) cb(true);
  };

  useEffect(() => {
    if (!config) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config]);

  if (!config) return null;

  const itemNames = (config.items || []).map(i => (typeof i === 'string' ? i : (i.name || i.path || '')));

  return (
    <div className="dfm-overlay" onClick={handleCancel}>
      <div className="dfm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dfm-header">
          <span className="dfm-header-icon">{config.icon}</span>
          <span>{config.title}</span>
        </div>
        <div className="dfm-body">
          <p>{config.message}</p>
          {itemNames.length > 0 && (
            <div className="dfm-items">
              {itemNames.map((name, index) => (
                <div className="dfm-item" key={`${name}-${index}`}>{name}</div>
              ))}
            </div>
          )}
        </div>
        <div className="dfm-actions">
          <button className="dfm-btn dfm-cancel" onClick={handleCancel}>{config.cancelText}</button>
          <button
            className={`dfm-btn dfm-confirm ${config.isDelete ? 'dfm-danger' : ''}`}
            onClick={handleConfirm}
          >
            {config.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
