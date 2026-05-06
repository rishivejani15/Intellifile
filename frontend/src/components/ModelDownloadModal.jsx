import React, { useState, useEffect } from 'react';
import './ModelDownloadModal.css';

export default function ModelDownloadModal({ visible, onClose }) {
  const [logs, setLogs] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    const unsub = window.intellifile.onModelDownloadLog((line) => {
      setLogs((s) => s + line);
    });
    return () => unsub && unsub();
  }, [visible]);

  const startDownload = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await window.intellifile.downloadModel();
      if (res && res.success) {
        setDone(true);
        // mark prompt as shown so it doesn't reappear
        try { await window.intellifile.setIndexingPreferences({ modelPromptShown: true }); } catch (e) {}
        // allow main process to restart engine; close modal shortly
        setTimeout(() => {
          onClose && onClose();
        }, 1200);
      } else {
        setError(res && res.error ? res.error : 'Download failed');
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="model-modal-backdrop">
      <div className="model-modal">
        <h3>Download AI models</h3>
        <p>
          To enable semantic search and chat features, Intellifile needs to download AI model files (~100s MB). This will use your network bandwidth.
        </p>
        <div className="model-modal-actions">
          {!running && !done && (
            <button className="btn primary" onClick={startDownload}>Download now</button>
          )}
          {running && <button className="btn" disabled>Downloading…</button>}
          {done && <button className="btn" onClick={() => onClose && onClose()}>Done</button>}
          <button className="btn ghost" onClick={() => { window.intellifile.setIndexingPreferences({ modelPromptShown: true }); onClose && onClose(); }}>
            Remind me later
          </button>
        </div>

        <div className="model-modal-log">
          <pre>{logs || (error ? `Error: ${error}` : 'Logs will appear here...')}</pre>
        </div>
      </div>
    </div>
  );
}
