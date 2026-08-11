import React, { useEffect } from 'react';
import { getFileIcon } from '../utils/fileUtils';
import './FileExplorer/FileExplorer.css';

const ipc = window.electron?.ipcRenderer;

async function browseForApp() {
  try {
    const result = await ipc?.invoke('open-with:browse');
    return result;
  } catch (_) {
    return { canceled: true, filePaths: [] };
  }
}

const inflightExtensions = new Set();
const candidatesCache = {};
const pendingRequests = {};

export default function OpenWithModal({ file, visible, onClose }) {
  const [candidates, setCandidates] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (!visible || !file) return;
    const ext = file?.name?.split('.').pop() || '';

    if (candidatesCache[ext]) {
      setCandidates(candidatesCache[ext]);
      return;
    }

    if (inflightExtensions.has(ext) || pendingRequests[ext]) return;
    inflightExtensions.add(ext);
    pendingRequests[ext] = true;
    setLoading(true);

    ipc?.invoke('open-with:get-candidates', ext)
      .then((res) => {
        if (res && Array.isArray(res.candidates)) {
          setCandidates(res.candidates);
          candidatesCache[ext] = res.candidates;
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        inflightExtensions.delete(ext);
        delete pendingRequests[ext];
      });
  }, [visible, file]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible || !file) return null;

  const handleBrowse = async () => {
    const result = await browseForApp();
    if (!result.canceled && result.filePaths?.[0]) {
      await ipc?.invoke('open-with:launch', { exe: result.filePaths[0], file: file.path });
      onClose();
    }
  };

  const openSettings = () => {
    if (window.electron && window.electron.shell) {
      window.electron.shell.openExternal('ms-settings:defaultapps');
    } else if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.invoke('open-default-apps-settings');
    }
    onClose();
  };

  return (
    <div className="properties-modal" onClick={onClose}>
      <div
        className="properties-dialog enhanced properties-dialog--windows"
        style={{ width: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Titlebar Header */}
        <div className="properties-titlebar">
          <span className="properties-title-icon">{getFileIcon(file)}</span>
          <span className="properties-title-text">Open "{file.name}" with…</span>
          <button className="properties-close-btn" onClick={onClose} type="button">×</button>
        </div>

        {/* Content Body */}
        <div className="properties-content">
          <div className="properties-icon-row">
            <span className="properties-big-icon">{getFileIcon(file)}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="properties-name-edit">{file.name}</div>
              <div className="properties-subtitle">Choose an application to open this file</div>
            </div>
          </div>

          <div className="properties-divider" />

          {loading ? (
            <div className="properties-loading" style={{ padding: '2rem 0', textAlign: 'center' }}>
              Loading applications…
            </div>
          ) : candidates.length > 0 ? (
            <div className="open-with-candidates-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
              {candidates.map((c, i) => (
                <div
                  key={i}
                  className="open-with-candidate-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'var(--s-hover)',
                    border: '1px solid var(--bo-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onClick={async () => {
                    await ipc?.invoke('open-with:launch', { exe: c.exe, file: file.path });
                    onClose();
                  }}
                >
                  <span style={{ fontSize: '24px' }}>💻</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: 'var(--text-sm)', color: 'var(--t-primary)' }}>
                      {c.name || c.exe}
                    </div>
                    {c.exe && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.exe}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: '600' }}>
                    Open ›
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
              <p style={{ color: 'var(--t-muted)', marginBottom: '12px' }}>No associated applications found.</p>
              <button
                type="button"
                className="properties-secondary-btn"
                onClick={openSettings}
              >
                Open Default Apps Settings
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="properties-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="properties-secondary-btn" onClick={handleBrowse}>
            📂 Browse for app…
          </button>
          <button type="button" className="properties-secondary-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
