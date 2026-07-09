import React, { useCallback, useEffect, useRef, useState } from 'react';
import './AutoSortToastHost.css';
import { showErrorToast } from '../utils/toast';

const ipcRenderer = window.electron?.ipcRenderer;
const DEFAULT_DURATION = 7000;

function AutoSortToastHost() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const remainingRef = useRef(new Map());

  const clearToastTimer = useCallback((id) => {
    const entry = timersRef.current.get(id);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    timersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback((id) => {
    clearToastTimer(id);
    remainingRef.current.delete(id);
    setToasts(prev => prev.filter(item => item.id !== id));
  }, [clearToastTimer]);

  const scheduleToast = useCallback((id, duration) => {
    clearToastTimer(id);
    const timer = window.setTimeout(() => dismissToast(id), duration);
    timersRef.current.set(id, { timer, expiresAt: Date.now() + duration });
  }, [clearToastTimer, dismissToast]);

  const pauseToast = useCallback((id) => {
    const entry = timersRef.current.get(id);
    if (!entry) return;
    clearToastTimer(id);
    remainingRef.current.set(id, Math.max(1000, entry.expiresAt - Date.now()));
  }, [clearToastTimer]);

  const resumeToast = useCallback((id) => {
    const remaining = remainingRef.current.get(id);
    if (!remaining) return;
    remainingRef.current.delete(id);
    scheduleToast(id, remaining);
  }, [scheduleToast]);

  useEffect(() => {
    if (!ipcRenderer?.on) return undefined;
    const timers = timersRef.current;
    const remaining = remainingRef.current;

    const handleNotification = (payload) => {
      if (!payload) return;
      const id = `${Date.now()}-${Math.random()}`;
      const nextToast = { ...payload, id };
      setToasts(prev => [nextToast, ...prev].slice(0, 4));
      scheduleToast(id, DEFAULT_DURATION);
    };

    const removeListener = window.intellifile?.onAutoSortNotification?.(handleNotification)
      || (() => ipcRenderer.off('autosort:notification', handleNotification));

    return () => {
      removeListener();
      for (const { timer } of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      remaining.clear();
    };
  }, [scheduleToast]);

  const handleUndo = async (toast) => {
    try {
      const result = await window.intellifile?.undoAutoSort?.(toast.logId);
      if (result?.success) {
        dismissToast(toast.id);
      } else {
        showErrorToast('Undo failed.', 'The file could not be restored.', 'Check whether the file was moved or deleted after the autosort finished.');
      }
    } catch (error) {
      showErrorToast('Undo failed.', error?.message || 'The file could not be restored.', 'Check whether the file was moved or deleted after the autosort finished.');
    }
  };

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="autosort-toast-host" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="autosort-toast"
          onMouseEnter={() => pauseToast(toast.id)}
          onMouseLeave={() => resumeToast(toast.id)}
        >
          <div className="autosort-toast-topline">
            <div>
              <div className="autosort-toast-title">Auto-sorted</div>
              <div className="autosort-toast-filename">{toast.filename}</div>
            </div>
            <button className="autosort-toast-close" onClick={() => dismissToast(toast.id)}>×</button>
          </div>

          <div className="autosort-toast-path">→ {toast.newPath}</div>

          <div className="autosort-toast-category">{toast.category}</div>

          <div className="autosort-toast-tags">
            {(toast.tags || []).map((tag) => (
              <span key={`${toast.id}-${tag}`} className="autosort-toast-tag">{tag}</span>
            ))}
          </div>

          <div className="autosort-toast-actions">
            <button className="autosort-toast-undo" onClick={() => handleUndo(toast)}>
              Undo
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default AutoSortToastHost;