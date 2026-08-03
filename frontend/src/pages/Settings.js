import React, { useEffect, useMemo, useState } from 'react';
import './Settings.css';

const DEFAULT_WATCH_FOLDERS = ['Downloads', 'Desktop'];
const ipc = window.intellifile;

// Utility to format timestamps relative to now
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - timestamp * 1000;
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp * 1000).toLocaleString();
};

export default function Settings() {
  // ==== State ==== //
  const [activeTab, setActiveTab] = useState('general');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoSortEnabled, setAutoSortEnabled] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState([]);
  const [sortRoot, setSortRoot] = useState('Sorted');
  const [recentSorts, setRecentSorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);
  const [indexEnabled, setIndexEnabled] = useState(false);
  const [aiModelPath, setAiModelPath] = useState('');
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [autoUpdateWiFi, setAutoUpdateWiFi] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('intellifile-theme') ?? 'system');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');

  // ==== Theme handling ==== //
  const applyTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('intellifile-theme', newTheme);
    const doc = document.documentElement;
    if (newTheme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const set = () => doc.setAttribute('data-theme', mql.matches ? 'dark' : 'light');
      set();
      mql.addEventListener('change', set);
    } else {
      doc.setAttribute('data-theme', newTheme);
    }
  };

  // ==== Load settings ==== //
  const loadSettings = async () => {
    try {
      const [enabled, folders, root, idx, model, telemetry, autoWi] = await Promise.all([
        ipc?.getSetting?.('auto_sort_enabled'),
        ipc?.getSetting?.('watched_folders'),
        ipc?.getSetting?.('sort_root'),
        ipc?.getSetting?.('index_enabled'),
        ipc?.getSetting?.('ai_model_path'),
        ipc?.getSetting?.('telemetry_enabled'),
        ipc?.getSetting?.('auto_update_wifi'),
      ]);
      setAutoSortEnabled(!!enabled?.value);
      setWatchedFolders(Array.isArray(folders?.value) ? folders.value : []);
      setSortRoot(root?.value || 'Sorted');
      setIndexEnabled(!!idx?.value);
      setAiModelPath(model?.value || '');
      setTelemetryEnabled(!!telemetry?.value);
      setAutoUpdateWiFi(!!autoWi?.value);
    } catch (e) {
      console.warn('Failed to load settings', e);
    } finally {
      setLoading(false);
    }
  };

  // ==== Load recent autosorts ==== //
  const loadRecent = async () => {
    try {
      const result = await ipc?.getAutoSortRecent?.(20);
      if (result?.success) setRecentSorts(result.items || []);
    } catch (e) {
      console.warn('Could not load recent autosorts', e);
    }
  };

  // ==== Persist a single setting ==== //
  const persistSetting = async (key, value) => {
    setSaving(true);
    try {
      await ipc?.setSetting?.(key, value);
      switch (key) {
        case 'auto_sort_enabled':
          setAutoSortEnabled(!!value);
          break;
        case 'watched_folders':
          setWatchedFolders(Array.isArray(value) ? value : []);
          break;
        case 'sort_root':
          setSortRoot(String(value));
          break;
        case 'index_enabled':
          setIndexEnabled(!!value);
          break;
        case 'ai_model_path':
          setAiModelPath(String(value));
          break;
        case 'telemetry_enabled':
          setTelemetryEnabled(!!value);
          break;
        case 'auto_update_wifi':
          setAutoUpdateWiFi(!!value);
          break;
        default:
          break;
      }
      await loadRecent();
    } finally {
      setSaving(false);
    }
  };

  // ==== Folder utilities ==== //
  const watchedSet = useMemo(() => new Set(watchedFolders), [watchedFolders]);
  const toggleFolder = async (folder) => {
    const next = watchedSet.has(folder)
      ? watchedFolders.filter((f) => f !== folder)
      : [...watchedFolders, folder];
    await persistSetting('watched_folders', next);
  };

  const addCustomFolder = async () => {
    const result = await ipc?.selectFolder?.();
    if (!result?.filePaths?.length) return;
    const path = result.filePaths[0];
    if (watchedSet.has(path)) return;
    await persistSetting('watched_folders', [...watchedFolders, path]);
  };

  const removeWatchedFolder = async (path) => {
    await persistSetting('watched_folders', watchedFolders.filter((f) => f !== path));
  };

  const toggleAutoSort = async () => {
    await persistSetting('auto_sort_enabled', !autoSortEnabled);
  };

  const undoRecentSort = async (row) => {
    const res = await ipc?.undoAutoSort?.(row.id);
    if (res?.success) await loadRecent();
  };

  // ==== Effect hooks ==== //
  useEffect(() => {
    loadSettings();
    loadRecent();
    const unsub = ipc?.onAutoSortNotification?.(() => loadRecent());
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // ==== App update listeners ==== //
  useEffect(() => {
    if (!ipc?.ipcRenderer) return;
    const { ipcRenderer } = ipc;
    const onAvail = (_, data) => {
      setUpdateVersion(data?.version || '');
      setUpdateAvailable(true);
    };
    const onDone = () => setUpdateDownloaded(true);
    ipcRenderer.on('update-available', onAvail);
    ipcRenderer.on('update-downloaded', onDone);
    return () => {
      ipcRenderer.removeListener('update-available', onAvail);
      ipcRenderer.removeListener('update-downloaded', onDone);
    };
  }, []);

  // ==== Render ==== //
  return (
    <div className="settings-page">
      {/* Search bar */}
      <div className="settings-search-bar">
        <input
          type="text"
          placeholder="Search settings…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="settings-search-input"
          aria-label="Search settings"
        />
        {searchTerm && (
          <button
            className="settings-search-clear"
            onClick={() => setSearchTerm('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="settings-layout">
        {/* Navigation (vertical sidebar) */}
        <nav className="settings-nav" aria-label="Settings navigation">
          <ul className="settings-nav-list" role="tablist">
            {['general', 'appearance', 'file-management', 'about'].map((tab) => (
              <li
                key={tab}
                className={`settings-nav-item ${activeTab === tab ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === tab}
                tabIndex={0}
                onClick={() => setActiveTab(tab)}
                onKeyPress={(e) => e.key === 'Enter' && setActiveTab(tab)}
                aria-current={activeTab === tab ? 'page' : undefined}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </li>
            ))}
          </ul>
        </nav>

        {/* Main content */}
        <div className="settings-content">
          {/* General */}
          {activeTab === 'general' && (
            <section className="settings-panel">
              <div className="settings-panel-header">Reset Settings</div>
              <div className="settings-panel-content">
                <button
                  className="settings-button destructive"
                  onClick={async () => {
                    if (window.confirm('Reset all settings to default? This cannot be undone.')) {
                      setSaving(true);
                      await ipc?.invoke?.('reset-all-settings');
                      await loadSettings();
                      setSaving(false);
                    }
                  }}
                >
                  Reset to Defaults
                </button>
              </div>
            </section>
          )}

          {/* Appearance */}
          {activeTab === 'appearance' && (
            <section className="settings-panel">
              <div className="settings-panel-header">Theme</div>
              <div className="settings-panel-content">
                <div className="theme-radio-group" role="radiogroup" aria-label="Theme selection">
                  {['light', 'dark', 'system'].map((t) => (
                    <label key={t} className="theme-radio-card">
                      <input
                        type="radio"
                        name="theme"
                        checked={theme === t}
                        onChange={() => applyTheme(t)}
                      />
                      <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* File Management */}
          {activeTab === 'file-management' && (
            <>
              {/* Updates */}
              <section className="settings-panel">
                <div className="settings-panel-header">Application Updates</div>
                <div className="settings-panel-content">
                  {updateAvailable && !updateDownloaded && (
                    <div className="update-status-container" style={{ marginBottom: '1rem' }}>
                      <span className="update-status">Update v{updateVersion} available</span>
                      <button
                        className="settings-button secondary"
                        onClick={() => {
                          if (window.electron?.ipcRenderer) {
                            window.electron.ipcRenderer.send('check-for-updates');
                          }
                        }}
                      >
                        Check Now
                      </button>
                    </div>
                  )}
                  {updateDownloaded && (
                    <button
                      className="settings-button primary"
                      onClick={() => {
                        if (window.electron?.ipcRenderer) {
                          window.electron.ipcRenderer.send('update-restart');
                        }
                      }}
                    >
                      Install Update
                    </button>
                  )}
                  <label className="settings-toggle-row" style={{ marginTop: '1rem' }}>
                    <span>
                      <strong>{autoUpdateWiFi ? 'Wi‑Fi Auto‑Download Enabled' : 'Wi‑Fi Auto‑Download Disabled'}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={autoUpdateWiFi}
                      onChange={() => persistSetting('auto_update_wifi', !autoUpdateWiFi)}
                    />
                  </label>
                </div>
              </section>

              {/* Auto‑sort */}
              <section className="settings-panel">
                <div className="settings-panel-header">Auto Sorting & Tagging</div>
                <div className="settings-panel-content">
                  <p>Watch Downloads, Desktop, or custom folders. Files are classified, tagged, and moved locally.</p>
                  <label className="settings-toggle-row">
                    <span>
                      <strong>{autoSortEnabled ? 'Enabled' : 'Disabled'}</strong>
                    </span>
                    <input type="checkbox" checked={autoSortEnabled} onChange={toggleAutoSort} />
                  </label>
                </div>
              </section>

              {/* Indexing */}
              <section className="settings-panel">
                <div className="settings-panel-header">Indexing</div>
                <div className="settings-panel-content">
                  <p>Enable background file‑indexing service.</p>
                  <label className="settings-toggle-row">
                    <span>
                      <strong>{indexEnabled ? 'Enabled' : 'Disabled'}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={indexEnabled}
                      onChange={() => persistSetting('index_enabled', !indexEnabled)}
                    />
                  </label>
                  <button
                    className="settings-button destructive"
                    style={{ marginTop: '0.75rem' }}
                    onClick={async () => {
                      if (window.confirm('Reset the entire index? This cannot be undone.')) {
                        setSaving(true);
                        await ipc?.invoke?.('reset-index');
                        await loadSettings();
                        setSaving(false);
                      }
                    }}
                  >
                    Reset Index
                  </button>
                </div>
              </section>

              {/* AI Model */}
              <section className="settings-panel">
                <div className="settings-panel-header">AI Model</div>
                <div className="settings-panel-content">
                  <label className="settings-input-label">
                    <span>Model path</span>
                    <input
                      value={aiModelPath}
                      onChange={(e) => setAiModelPath(e.target.value)}
                      onBlur={() => persistSetting('ai_model_path', aiModelPath)}
                      placeholder="C:\\Models\\my-model"
                    />
                  </label>
                  <button
                    className="settings-button destructive"
                    style={{ marginTop: '0.75rem' }}
                    onClick={async () => {
                      if (window.confirm('Delete the local AI model? You will need to re‑download it.')) {
                        setSaving(true);
                        await ipc?.invoke?.('delete-ai-model');
                        await loadSettings();
                        setSaving(false);
                      }
                    }}
                  >
                    Delete Model
                  </button>
                </div>
              </section>

              {/* Privacy */}
              <section className="settings-panel">
                <div className="settings-panel-header">Privacy</div>
                <div className="settings-panel-content">
                  <p>Help improve IntelliFile by sending anonymous usage data.</p>
                  <label className="settings-toggle-row">
                    <span>
                      <strong>{telemetryEnabled ? 'Enabled' : 'Disabled'}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={telemetryEnabled}
                      onChange={() => persistSetting('telemetry_enabled', !telemetryEnabled)}
                    />
                  </label>
                </div>
              </section>

              {/* Watched folders & Sort root grid */}
              <section className="settings-grid">
                {/* Watched folders */}
                <div className="settings-panel">
                  <div className="settings-panel-header">
                    <div>
                      <h3>Watched folders</h3>
                      <p>Pick which top‑level folders IntelliFile should watch.</p>
                    </div>
                    <button className="settings-button secondary" onClick={addCustomFolder}>Add custom folder</button>
                  </div>
                  <div className="settings-folder-list">
                    {DEFAULT_WATCH_FOLDERS.map((folder) => (
                      <label key={folder} className="settings-folder-option">
                        <input
                          type="checkbox"
                          checked={watchedSet.has(folder)}
                          onChange={() => toggleFolder(folder)}
                        />
                        <span>{folder}</span>
                      </label>
                    ))}
                  </div>
                  <div className="settings-custom-folders">
                    {watchedFolders
                      .filter((f) => !DEFAULT_WATCH_FOLDERS.includes(f))
                      .map((folder) => (
                        <button
                          key={folder}
                          className="settings-folder-chip"
                          onClick={() => removeWatchedFolder(folder)}
                        >
                          {folder}
                          <span aria-hidden="true">×</span>
                        </button>
                      ))}
                  </div>
                </div>

                {/* Sort root */}
                <div className="settings-panel">
                  <div className="settings-panel-header">
                    <div>
                      <h3>Sort root</h3>
                      <p>Files are moved into subfolders under this destination.</p>
                    </div>
                  </div>
                  <label className="settings-input-label">
                    <span>Folder name or path</span>
                    <input
                      value={sortRoot}
                      onChange={(e) => setSortRoot(e.target.value)}
                      onBlur={() => persistSetting('sort_root', sortRoot)}
                      placeholder="Sorted"
                    />
                  </label>
                </div>
              </section>

              {/* Recent auto‑sorts */}
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <h3>Recent auto‑sorts</h3>
                  <p>Undo the latest file moves or review what IntelliFile changed.</p>
                  <button className="settings-button secondary" onClick={loadRecent}>Refresh</button>
                </div>
                {loading ? (
                  <div className="settings-empty">Loading autosort settings…</div>
                ) : recentSorts.length === 0 ? (
                  <div className="settings-empty">No auto‑sort activity yet.</div>
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
            </>
          )}

          {/* About */}
          {activeTab === 'about' && (
            <section className="settings-panel">
              <div className="settings-panel-header">About IntelliFile</div>
              <div className="settings-panel-content">
                <p>Version: {updateVersion || 'unknown'}</p>
                <p>For more information, visit the help center.</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* End of Settings component */