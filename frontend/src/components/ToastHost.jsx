import React, { useEffect, useState } from 'react';
import { TOAST_EVENT } from '../utils/toast';
import './ToastHost.css';

function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (event) => {
      const toast = event?.detail;
      if (!toast) return;
      const id = `${Date.now()}-${Math.random()}`;
      const nextToast = { ...toast, id };
      setToasts(prev => [nextToast, ...prev].slice(0, 4));

      window.setTimeout(() => {
        setToasts(prev => prev.filter(item => item.id !== id));
      }, toast.duration || 4500);
    };

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast-item ${toast.type || 'error'}`}>
          <div className="toast-head">
            <span className="toast-title">{toast.title || 'Error'}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(item => item.id !== toast.id))}>×</button>
          </div>
          {toast.message && <div className="toast-message">{toast.message}</div>}
          {toast.reason && <div className="toast-meta"><strong>Reason:</strong> {toast.reason}</div>}
          {toast.solution && <div className="toast-meta"><strong>Fix:</strong> {toast.solution}</div>}
        </div>
      ))}
    </div>
  );
}

export default ToastHost;
