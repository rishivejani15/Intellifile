import React, { useEffect } from 'react';
import './OpenWithModal.css';
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
// Track ongoing fetch promises per extension to avoid duplicate IPC calls across multiple component instances.
const pendingRequests = {};

export default function OpenWithModal({ file, visible, onClose }) {
  const [candidates, setCandidates] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  // Track in‑flight requests and cache results per extension.
  useEffect(() => {
    if (!visible) return;
    const ext = file?.name?.split('.').pop() || '';

    // Use cached candidates if we already have them.
    if (candidatesCache[ext]) {
      setCandidates(candidatesCache[ext]);
      return;
    }

    // Skip if a request for this extension is already in flight (either via inflight set or pending promise).
    if (inflightExtensions.has(ext) || pendingRequests[ext]) return;
    inflightExtensions.add(ext);
    pendingRequests[ext] = true;
    setLoading(true);

    ipc?.invoke('open-with:get-candidates', ext)
      .then(res => {
        if (res && Array.isArray(res.candidates)) {
          setCandidates(res.candidates);
          candidatesCache[ext] = res.candidates; // cache for future opens
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        inflightExtensions.delete(ext);
        delete pendingRequests[ext];
      });
  }, [visible, file?.name]);

  if (!visible) return null;

  // Show a simple loading UI while candidates are being fetched
  if (loading) {
    return (
      <div className="open-with-modal">
        <div className="open-with-backdrop" onClick={onClose} />
        <div className="open-with-dialog">
          <p>Loading applications…</p>
        </div>
      </div>
    );
  }

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
    <div className="open-with-modal">
      <div className="open-with-backdrop" onClick={onClose} />
      <div className="open-with-dialog">
        <h3>Open {file.name} with…</h3>
        <p style={{ opacity: 0.8, marginBottom: '1rem' }}>
          Choose an application to open the file.
        </p>
        {candidates.length > 0 ? (
          <ul className="open-with-list">
            {candidates.map((c, i) => (
              <li key={i} className="app-choice" style={{ cursor: 'pointer' }} onClick={async () => {
                await ipc?.invoke('open-with:launch', { exe: c.exe, file: file.path });
                onClose();
              }}>
                {c.name || c.exe}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p>No associated applications found.</p>
            <button
              className="app-choice"
              onClick={openSettings}
              style={{ padding: '1rem', fontSize: '1rem', fontWeight: 'bold' }}
            >
              Open Default Apps Settings
            </button>
          </div>
        )}
        <div className="open-with-actions">
          <button className="browse-btn" onClick={handleBrowse}>Browse for app…</button>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
      </div>
    </div>
  );
}
