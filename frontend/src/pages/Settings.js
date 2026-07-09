import React, { useEffect, useMemo, useState } from 'react';
import './Settings.css';

const DEFAULT_WATCH_FOLDERS = ['Downloads', 'Desktop'];
const ipc = window.intellifile;

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - (timestamp * 1000);
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp * 1000).toLocaleString();
};

function Settings() {
  const [autoSortEnabled, setAutoSortEnabled] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState([]);
  const [sortRoot, setSortRoot] = useState('Sorted');
  const [recentSorts, setRecentSorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const watchedSet = useMemo(() => new Set(watchedFolders), [watchedFolders]);

  const loadRecent = async () => {
    try {
      const result = await ipc?.getAutoSortRecent?.(20);
      if (result?.success) {
        setRecentSorts(result.items || []);
      }
    } catch (error) {
      console.warn('Could not load recent autosorts:', error);
    }
  };

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const enabled = await ipc?.getSetting?.('auto_sort_enabled');
        const folders = await ipc?.getSetting?.('watched_folders');
        const root = await ipc?.getSetting?.('sort_root');
        if (!mounted) return;
        setAutoSortEnabled(!!enabled?.value);
        setWatchedFolders(Array.isArray(folders?.value) ? folders.value : []);
        setSortRoot(root?.value || 'Sorted');
      } catch (error) {
        console.warn('Could not load autosort settings:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSettings();
    loadRecent();

    const unsubscribe = ipc?.onAutoSortNotification?.(() => {
      loadRecent();
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const persistSetting = async (key, value) => {
    setSaving(true);
    try {
      await ipc?.setSetting?.(key, value);
      if (key === 'auto_sort_enabled') {
        setAutoSortEnabled(!!value);
      } else if (key === 'watched_folders') {
        setWatchedFolders(Array.isArray(value) ? value : []);
      } else if (key === 'sort_root') {
        setSortRoot(String(value || 'Sorted'));
      }
      await loadRecent();
    } finally {
      setSaving(false);
    }
  };

  const toggleFolder = async (folderName) => {
    const nextFolders = watchedSet.has(folderName)
      ? watchedFolders.filter((item) => item !== folderName)
      : [...watchedFolders, folderName];
    await persistSetting('watched_folders', nextFolders);
  };

  const addCustomFolder = async () => {
    const result = await ipc?.selectFolder?.();
    if (!result?.filePaths?.length) return;
    const nextPath = result.filePaths[0];
    if (watchedSet.has(nextPath)) return;
    await persistSetting('watched_folders', [...watchedFolders, nextPath]);
  };

  const removeWatchedFolder = async (folderPath) => {
    await persistSetting('watched_folders', watchedFolders.filter((item) => item !== folderPath));
  };

  const toggleAutoSort = async () => {
    await persistSetting('auto_sort_enabled', !autoSortEnabled);
  };

  const undoRecentSort = async (row) => {
    const result = await ipc?.undoAutoSort?.(row.id);
    if (result?.success) {
      await loadRecent();
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-shell">
        <section className="settings-card settings-hero">
          <div>
            <div className="settings-eyebrow">Automation</div>
            <h2>Auto-sort new files</h2>
            <p>
              Watch Downloads, Desktop, or your own folders. Files are classified, tagged, and moved locally without leaving the machine.
            </p>
          </div>

          <label className="settings-toggle-row">
            <span>
              <strong>{autoSortEnabled ? 'Enabled' : 'Disabled'}</strong>
              <small>{saving ? 'Saving...' : 'Live watcher updates immediately'}</small>
            </span>
            <input type="checkbox" checked={autoSortEnabled} onChange={toggleAutoSort} />
          </label>
        </section>

        <section className="settings-grid">
          <div className="settings-card">
            <div className="settings-card-header">
              <div>
                <h3>Watched folders</h3>
                <p>Pick which top-level folders IntelliFile should watch.</p>
              </div>
              <button className="settings-button secondary" onClick={addCustomFolder}>Add custom folder</button>
            </div>

            <div className="settings-folder-list">
              {DEFAULT_WATCH_FOLDERS.map((folder) => (
                <label key={folder} className="settings-folder-option">
                  <input type="checkbox" checked={watchedSet.has(folder)} onChange={() => toggleFolder(folder)} />
                  <span>{folder}</span>
                </label>
              ))}
            </div>

            <div className="settings-custom-folders">
              {watchedFolders.filter((item) => !DEFAULT_WATCH_FOLDERS.includes(item)).map((folder) => (
                <button key={folder} className="settings-folder-chip" onClick={() => removeWatchedFolder(folder)}>
                  {folder}
                  <span>×</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <div>
                <h3>Sort root</h3>
                <p>Files are moved into subfolders under this destination.</p>
              </div>
            </div>

            <label className="settings-input-label">
              <span>Folder name or path</span>
              <input
                value={sortRoot}
                onChange={(event) => setSortRoot(event.target.value)}
                onBlur={() => persistSetting('sort_root', sortRoot)}
                placeholder="Sorted"
              />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Recent auto-sorts</h3>
              <p>Undo the latest file moves or review what IntelliFile changed.</p>
            </div>
            <button className="settings-button secondary" onClick={loadRecent}>Refresh</button>
          </div>

          {loading ? (
            <div className="settings-empty">Loading autosort settings...</div>
          ) : recentSorts.length === 0 ? (
            <div className="settings-empty">No auto-sort activity yet.</div>
          ) : (
            <div className="settings-recent-list">
              {recentSorts.map((row) => (
                <div key={row.id} className="settings-recent-row">
                  <div className="settings-recent-main">
                    <div className="settings-recent-title">
                      <strong>{row.filename}</strong>
                      <span>{row.category}</span>
                    </div>
                    <div className="settings-recent-meta">{formatRelativeTime(row.timestamp)}</div>
                    <div className="settings-recent-tags">
                      {(row.tags || []).map((tag) => (
                        <span key={`${row.id}-${tag}`} className="settings-tag">{tag}</span>
                      ))}
                    </div>
                  </div>

                  <button
                    className="settings-button"
                    disabled={!row.undoable}
                    onClick={() => undoRecentSort(row)}
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Settings;