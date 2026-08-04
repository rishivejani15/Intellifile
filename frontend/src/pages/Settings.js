import React, { useEffect, useMemo, useState } from 'react';
import './Settings.css';
import confirmApp from '../utils/confirm';

// Lightweight toast helper
const toast = (title, options = {}) => {
  if (window.intellifile?.showToast) return window.intellifile.showToast(title, options);
  window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: title, ...options } }));
};

const DEFAULT_WATCH_FOLDERS = ['Downloads', 'Desktop'];
const ipc = window.intellifile;

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - timestamp * 1000;
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp * 1000).toLocaleString();
};

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'file-management', label: 'File Management', icon: '🗂️' },
  { id: 'search-indexing', label: 'Search & Indexing', icon: '🔍' },
  { id: 'ai-model', label: 'AI Model', icon: '🤖' },
  { id: 'updates', label: 'Updates', icon: '🔄' },
  { id: 'privacy', label: 'Privacy', icon: '🔒' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
];

export default function Settings({ theme, onThemeChange }) {
  // State
  const [activeTab, setActiveTab] = useState('appearance');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoSortEnabled, setAutoSortEnabled] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState([]);
  const [sortRoot, setSortRoot] = useState('Sorted');
  const [recentSorts, setRecentSorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialSettings, setInitialSettings] = useState({});
  const [, setSaving] = useState(false);
  const [indexEnabled, setIndexEnabled] = useState(false);
  const [aiModelPath, setAiModelPath] = useState('');
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [autoUpdateWiFi, setAutoUpdateWiFi] = useState(false);

  // Update System States
  const [currentVersion, setCurrentVersion] = useState('1.0.2');
  const [updateStatus, setUpdateStatus] = useState('idle'); // 'idle'|'checking'|'available'|'latest'|'downloading'|'downloaded'|'error'
  const [latestVersion, setLatestVersion] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');

  // Analytics State
  const [analyticsSummary, setAnalyticsSummary] = useState({ counts: {}, recent: [] });

  // Load settings
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

      const parseBool = (obj, defaultVal = false) => {
        if (!obj || obj.value === undefined || obj.value === null) return defaultVal;
        if (typeof obj.value === 'boolean') return obj.value;
        const str = String(obj.value).trim().toLowerCase();
        if (str === 'true' || str === '1' || str === 'yes') return true;
        if (str === 'false' || str === '0' || str === 'no') return false;
        return defaultVal;
      };

      const values = {
        auto_sort_enabled: parseBool(enabled, false),
        watched_folders: Array.isArray(folders?.value) ? folders.value : [],
        sort_root: root?.value || 'Sorted',
        index_enabled: parseBool(idx, true),
        ai_model_path: model?.value || '',
        telemetry_enabled: parseBool(telemetry, false),
        auto_update_wifi: parseBool(autoWi, false),
        theme: theme || 'system',
      };

      setInitialSettings(values);
      setAutoSortEnabled(values.auto_sort_enabled);
      setWatchedFolders(values.watched_folders);
      setSortRoot(values.sort_root);
      setIndexEnabled(values.index_enabled);
      setAiModelPath(values.ai_model_path);
      setTelemetryEnabled(values.telemetry_enabled);
      setAutoUpdateWiFi(values.auto_update_wifi);
    } catch (e) {
      console.warn('Failed to load settings', e);
    } finally {
      setLoading(false);
    }
  };

  // Load recent auto-sorts
  const loadRecent = async () => {
    try {
      const result = await ipc?.getAutoSortRecent?.(20);
      if (result?.success) setRecentSorts(result.items || []);
    } catch (e) {
      console.warn('Could not load recent autosorts', e);
    }
  };

  // Persist a single setting
  const persistSetting = async (key, value) => {
    setSaving(true);
    try {
      await ipc?.setSetting?.(key, value);
      switch (key) {
        case 'auto_sort_enabled': setAutoSortEnabled(!!value); break;
        case 'watched_folders': setWatchedFolders(Array.isArray(value) ? value : []); break;
        case 'sort_root': setSortRoot(String(value)); break;
        case 'index_enabled': setIndexEnabled(!!value); break;
        case 'ai_model_path': setAiModelPath(String(value)); break;
        case 'telemetry_enabled': setTelemetryEnabled(!!value); break;
        case 'auto_update_wifi': setAutoUpdateWiFi(!!value); break;
        default: break;
      }
      setInitialSettings(prev => ({ ...prev, [key]: value }));
      await loadRecent();
    } finally {
      setSaving(false);
    }
  };

  // Dirty state
  const isDirty = useMemo(() => {
    if (!initialSettings) return false;
    if ((initialSettings.auto_sort_enabled ?? false) !== !!autoSortEnabled) return true;
    if (JSON.stringify(initialSettings.watched_folders || []) !== JSON.stringify(watchedFolders || [])) return true;
    if ((initialSettings.sort_root || '') !== (sortRoot || '')) return true;
    if ((initialSettings.index_enabled ?? false) !== !!indexEnabled) return true;
    if ((initialSettings.ai_model_path || '') !== (aiModelPath || '')) return true;
    if ((initialSettings.telemetry_enabled ?? false) !== !!telemetryEnabled) return true;
    if ((initialSettings.auto_update_wifi ?? false) !== !!autoUpdateWiFi) return true;
    if ((initialSettings.theme || 'system') !== (theme || 'system')) return true;
    return false;
  }, [initialSettings, autoSortEnabled, watchedFolders, sortRoot, indexEnabled, aiModelPath, telemetryEnabled, autoUpdateWiFi, theme]);

  const applyAllSettings = async () => {
    const toSave = [];
    if ((initialSettings.auto_sort_enabled ?? false) !== !!autoSortEnabled) toSave.push(['auto_sort_enabled', !!autoSortEnabled]);
    if (JSON.stringify(initialSettings.watched_folders || []) !== JSON.stringify(watchedFolders || [])) toSave.push(['watched_folders', watchedFolders]);
    if ((initialSettings.sort_root || '') !== (sortRoot || '')) toSave.push(['sort_root', sortRoot]);
    if ((initialSettings.index_enabled ?? false) !== !!indexEnabled) toSave.push(['index_enabled', !!indexEnabled]);
    if ((initialSettings.ai_model_path || '') !== (aiModelPath || '')) toSave.push(['ai_model_path', aiModelPath]);
    if ((initialSettings.telemetry_enabled ?? false) !== !!telemetryEnabled) toSave.push(['telemetry_enabled', !!telemetryEnabled]);
    if ((initialSettings.auto_update_wifi ?? false) !== !!autoUpdateWiFi) toSave.push(['auto_update_wifi', !!autoUpdateWiFi]);
    if ((initialSettings.theme || 'system') !== (theme || 'system')) toSave.push(['theme', theme]);

    if (toSave.length === 0) return;
    setSaving(true);
    try {
      for (const [k, v] of toSave) {
        // eslint-disable-next-line no-await-in-loop
        await persistSetting(k, v);
      }
      toast('All changes applied', { type: 'success' });
    } catch (e) {
      console.warn('Failed to apply settings', e);
      toast('Failed to apply some settings', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Folder utilities
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

  const handleBrowseModel = async () => {
    try {
      const res = await ipc?.selectFolder?.();
      if (!res?.filePaths?.length) return;
      const p = res.filePaths[0];
      setAiModelPath(p);
      await persistSetting('ai_model_path', p);
      toast('Model path updated', { type: 'success' });
    } catch (e) {
      console.warn('Model browse failed', e);
    }
  };

  const undoRecentSort = async (row) => {
    const res = await ipc?.undoAutoSort?.(row.id);
    if (res?.success) await loadRecent();
  };

  // Theme change handler — delegates to parent (App.js) and persists
  const handleThemeSelect = async (newTheme) => {
    onThemeChange(newTheme);
    try {
      await ipc?.setSetting?.('theme', newTheme);
    } catch (_) { }
  };

  // Search filter
  const matchesSection = (sectionId) => {
    if (!searchTerm || !searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const map = {
      appearance: ['theme', 'light', 'dark', 'system', 'appearance', 'mode'],
      'file-management': ['auto', 'sort', 'watched', 'folder', 'file'],
      'search-indexing': ['index', 'search', 'scan', 'indexing'],
      'ai-model': ['ai', 'model', 'llm', 'path', 'download'],
      updates: ['update', 'version', 'download', 'wifi'],
      privacy: ['privacy', 'telemetry', 'data', 'analytics'],
      about: ['about', 'version', 'help', 'reset'],
    };
    const sec = SECTIONS.find(s => s.id === sectionId);
    const tokens = [...(map[sectionId] || []), sec?.label?.toLowerCase() || ''];
    return tokens.some(t => t.includes(q) || q.includes(t));
  };

  const filteredSections = SECTIONS.filter(s => matchesSection(s.id));

  // Effects
  useEffect(() => {
    loadSettings();
    loadRecent();
    const unsub = ipc?.onAutoSortNotification?.(() => loadRecent());
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Update listeners & initial version fetch
  useEffect(() => {
    if (ipc?.getAppVersion) {
      ipc.getAppVersion().then((v) => { if (v) setCurrentVersion(v); });
    }

    const ipcRenderer = ipc?.ipcRenderer || window.electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const onChecking = () => setUpdateStatus('checking');
    const onAvail = (_, data) => {
      setLatestVersion(data?.version || 'new');
      setUpdateStatus('available');
    };
    const onNotAvail = () => setUpdateStatus('latest');
    const onProgress = (_, data) => {
      setUpdateStatus('downloading');
      setDownloadProgress(data?.percent || 0);
    };
    const onDone = (_, data) => {
      if (data?.version) setLatestVersion(data.version);
      setUpdateStatus('downloaded');
    };
    const onError = (_, data) => {
      setUpdateError(data?.message || 'Failed to check for updates');
      setUpdateStatus('error');
    };

    ipcRenderer.on('update-checking', onChecking);
    ipcRenderer.on('update-available', onAvail);
    ipcRenderer.on('update-not-available', onNotAvail);
    ipcRenderer.on('update-download-progress', onProgress);
    ipcRenderer.on('update-downloaded', onDone);
    ipcRenderer.on('update-error', onError);

    return () => {
      ipcRenderer.removeListener('update-checking', onChecking);
      ipcRenderer.removeListener('update-available', onAvail);
      ipcRenderer.removeListener('update-not-available', onNotAvail);
      ipcRenderer.removeListener('update-download-progress', onProgress);
      ipcRenderer.removeListener('update-downloaded', onDone);
      ipcRenderer.removeListener('update-error', onError);
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateError('');
    try {
      let res;
      if (typeof ipc?.checkForUpdates === 'function') {
        res = await ipc.checkForUpdates();
      } else if (window.electron?.ipcRenderer) {
        res = await window.electron.ipcRenderer.invoke('check-for-updates');
      }

      if (res) {
        if (res.updateAvailable && res.version) {
          setLatestVersion(res.version);
          setUpdateStatus('available');
        } else if (res.updateAvailable === false) {
          setUpdateStatus('latest');
        } else if (res.error) {
          if (res.error.toLowerCase().includes('no update') || res.error.includes('404')) {
            setUpdateStatus('latest');
          } else {
            setUpdateError(res.error);
            setUpdateStatus('error');
          }
        }
      }
    } catch (err) {
      setUpdateError(err.message || 'Check failed');
      setUpdateStatus('error');
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('downloading');
    setDownloadProgress(0);
    try {
      if (typeof ipc?.downloadUpdate === 'function') {
        await ipc.downloadUpdate();
      } else if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.invoke('download-update');
      }
    } catch (err) {
      setUpdateError(err.message || 'Download failed');
      setUpdateStatus('error');
    }
  };

  const handleRestartAndInstall = () => {
    if (typeof ipc?.restartAndInstallUpdate === 'function') {
      ipc.restartAndInstallUpdate();
    } else if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('update-restart');
    }
  };

  const loadAnalytics = async () => {
    try {
      const res = typeof ipc?.getAnalyticsSummary === 'function'
        ? await ipc.getAnalyticsSummary()
        : await window.electron?.ipcRenderer?.invoke?.('analytics:summary');
      if (res?.success) {
        setAnalyticsSummary(res);
      }
    } catch (_) { }
  };

  useEffect(() => {
    if (telemetryEnabled && activeTab === 'privacy') {
      loadAnalytics();
    }
  }, [telemetryEnabled, activeTab]);

  // ─── Render ───
  return (
    <div className="settings-page">
      {/* Search */}
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
          <button className="settings-search-clear" onClick={() => setSearchTerm('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <div className="settings-layout">
        {/* Sidebar Navigation */}
        <nav className="settings-nav" aria-label="Settings navigation">
          <ul className="settings-nav-list" role="tablist">
            {filteredSections.map((tab) => (
              <li
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={0}
                onClick={() => setActiveTab(tab.id)}
                onKeyPress={(e) => e.key === 'Enter' && setActiveTab(tab.id)}
              >
                <span className="nav-icon" aria-hidden="true">{tab.icon}</span>
                <span className="nav-label">{tab.label}</span>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="settings-content">

          {/* ═══ APPEARANCE ═══ */}
          {activeTab === 'appearance' && matchesSection('appearance') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon">🎨</span> Appearance
                  </div>
                  <div className="settings-panel-subtitle">Customize how IntelliFile looks</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <p>Choose a theme for the application interface.</p>
                <div className="theme-card-group">
                  {/* Light */}
                  <label className={`theme-card ${theme === 'light' ? 'active' : ''}`} onClick={() => handleThemeSelect('light')}>
                    <input type="radio" name="theme" checked={theme === 'light'} onChange={() => handleThemeSelect('light')} />
                    <div className="theme-preview theme-preview-light" />
                    <div className="theme-card-label">
                      <span>Light</span>
                      <span className="theme-card-check">{theme === 'light' ? '✓' : ''}</span>
                    </div>
                  </label>
                  {/* Dark */}
                  <label className={`theme-card ${theme === 'dark' ? 'active' : ''}`} onClick={() => handleThemeSelect('dark')}>
                    <input type="radio" name="theme" checked={theme === 'dark'} onChange={() => handleThemeSelect('dark')} />
                    <div className="theme-preview theme-preview-dark" />
                    <div className="theme-card-label">
                      <span>Dark</span>
                      <span className="theme-card-check">{theme === 'dark' ? '✓' : ''}</span>
                    </div>
                  </label>
                  {/* System */}
                  <label className={`theme-card ${theme === 'system' ? 'active' : ''}`} onClick={() => handleThemeSelect('system')}>
                    <input type="radio" name="theme" checked={theme === 'system'} onChange={() => handleThemeSelect('system')} />
                    <div className="theme-preview theme-preview-system" />
                    <div className="theme-card-label">
                      <span>System</span>
                      <span className="theme-card-check">{theme === 'system' ? '✓' : ''}</span>
                    </div>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ═══ FILE MANAGEMENT ═══ */}
          {activeTab === 'file-management' && matchesSection('file-management') && (
            <>
              {/* Auto-Sort */}
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">
                      <span className="panel-icon">🗂️</span> Auto Sorting & Tagging
                    </div>
                    <div className="settings-panel-subtitle">Automatically classify, tag, and move new files</div>
                  </div>
                </div>
                <div className="settings-panel-content">
                  <div className="settings-toggle-row" onClick={() => persistSetting('auto_sort_enabled', !autoSortEnabled)}>
                    <div className="settings-toggle-info">
                      <div className="settings-toggle-label">Auto-Sort</div>
                      <div className="settings-toggle-desc">Watch folders and move new files into categorized subfolders</div>
                    </div>
                    <label className="switch" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={autoSortEnabled} onChange={() => persistSetting('auto_sort_enabled', !autoSortEnabled)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </section>

              {/* Watched Folders + Sort Root Grid */}
              <section className="settings-grid">
                {/* Watched Folders */}
                <div className="settings-panel">
                  <div className="settings-panel-header">
                    <div>
                      <div className="settings-panel-title">Watched Folders</div>
                      <div className="settings-panel-subtitle">Pick which folders IntelliFile should watch</div>
                    </div>
                    <div className="section-actions">
                      <button className="settings-button secondary" onClick={addCustomFolder}>+ Add Folder</button>
                    </div>
                  </div>
                  <div className="settings-panel-content">
                    <div className="settings-folder-list">
                      {DEFAULT_WATCH_FOLDERS.map((folder) => (
                        <label key={folder} className="settings-folder-option">
                          <input type="checkbox" checked={watchedSet.has(folder)} onChange={() => toggleFolder(folder)} />
                          <span>{folder}</span>
                        </label>
                      ))}
                    </div>
                    {watchedFolders.filter((f) => !DEFAULT_WATCH_FOLDERS.includes(f)).length > 0 && (
                      <div className="settings-custom-folders">
                        {watchedFolders.filter((f) => !DEFAULT_WATCH_FOLDERS.includes(f)).map((folder) => (
                          <button key={folder} className="settings-folder-chip" onClick={() => removeWatchedFolder(folder)}>
                            {folder} <span aria-hidden="true">×</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sort Root */}
                <div className="settings-panel">
                  <div className="settings-panel-header">
                    <div>
                      <div className="settings-panel-title">Sort Destination</div>
                      <div className="settings-panel-subtitle">Files are moved into subfolders under this path</div>
                    </div>
                  </div>
                  <div className="settings-panel-content">
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
                </div>
              </section>

              {/* Recent Auto-Sorts */}
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">Recent Auto-Sorts</div>
                    <div className="settings-panel-subtitle">Review or undo recent file moves</div>
                  </div>
                  <div className="section-actions">
                    <button className="settings-button secondary" onClick={loadRecent}>Refresh</button>
                  </div>
                </div>
                <div className="settings-panel-content">
                  {loading ? (
                    <div className="settings-empty">Loading…</div>
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
                            {(row.tags || []).length > 0 && (
                              <div className="settings-recent-tags">
                                {row.tags.map((tag) => (
                                  <span key={`${row.id}-${tag}`} className="settings-tag">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <button className="settings-button" disabled={!row.undoable} onClick={() => undoRecentSort(row)}>
                            Undo
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ═══ SEARCH & INDEXING ═══ */}
          {activeTab === 'search-indexing' && matchesSection('search-indexing') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon">🔍</span> Search & Indexing
                  </div>
                  <div className="settings-panel-subtitle">Control how IntelliFile scans and indexes your files</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <div className="settings-toggle-row" onClick={() => persistSetting('index_enabled', !indexEnabled)}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Background Indexing</div>
                    <div className="settings-toggle-desc">Enable automatic file scanning and semantic indexing</div>
                  </div>
                  <label className="switch" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={indexEnabled} onChange={() => persistSetting('index_enabled', !indexEnabled)} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)' }}>
                  <button
                    className="settings-button destructive"
                    onClick={async () => {
                      const ok = await confirmApp('Reset index and re-scan device? Existing search index will be cleared and rebuilt immediately.', []);
                      if (ok) {
                        setSaving(true);
                        try {
                          if (typeof ipc?.resetIndex === 'function') {
                            await ipc.resetIndex();
                          } else {
                            await ipc?.invoke?.('reset-index');
                          }
                          // Also call indexDevice explicitly if available
                          if (typeof ipc?.indexDevice === 'function') {
                            ipc.indexDevice().catch(() => { });
                          }
                          toast('Index reset. Re-indexing files in background...', { type: 'success' });
                        } catch (e) {
                          toast('Failed to reset index', { type: 'error' });
                        }
                        await loadSettings();
                        setSaving(false);
                      }
                    }}
                  >
                    Reset & Re-index Device
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ═══ AI MODEL ═══ */}
          {activeTab === 'ai-model' && matchesSection('ai-model') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon">🤖</span> AI Model
                  </div>
                  <div className="settings-panel-subtitle">Configure the local language model for chat and search</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <label className="settings-input-label">
                  <span>Model path</span>
                  <div className="settings-input-row">
                    <input
                      value={aiModelPath}
                      onChange={(e) => setAiModelPath(e.target.value)}
                      onBlur={() => persistSetting('ai_model_path', aiModelPath)}
                      placeholder="C:\Models\my-model"
                    />
                    <button className="settings-button secondary" onClick={handleBrowseModel}>Browse</button>
                  </div>
                </label>

                <div style={{ marginTop: '16px' }}>
                  <button
                    className="settings-button destructive"
                    onClick={async () => {
                      const ok = await confirmApp('Delete the local AI model? You will need to re-download it.', []);
                      if (ok) {
                        setSaving(true);
                        try {
                          if (typeof ipc?.deleteAiModel === 'function') {
                            await ipc.deleteAiModel();
                          } else {
                            await ipc?.invoke?.('delete-ai-model');
                          }
                          toast('Model deleted', { type: 'success' });
                        } catch (e) {
                          toast('Failed to delete model', { type: 'error' });
                        }
                        await loadSettings();
                        setSaving(false);
                      }
                    }}
                  >
                    Delete Model
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ═══ UPDATES ═══ */}
          {activeTab === 'updates' && matchesSection('updates') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon">🔄</span> Application Updates
                  </div>
                  <div className="settings-panel-subtitle">Keep IntelliFile up to date with the latest features</div>
                </div>
                <div className="section-actions">
                  <button
                    className="settings-button primary"
                    onClick={handleCheckForUpdates}
                    disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                  >
                    {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
                  </button>
                </div>
              </div>
              <div className="settings-panel-content">
                {/* Version summary */}
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--s-hover)', borderRadius: 'var(--rd-md)' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Installed Version</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: 'var(--t-primary)' }}>
                      v{currentVersion}
                    </div>
                  </div>
                  {latestVersion && updateStatus !== 'latest' && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Latest Release</div>
                      <div style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: 'var(--color-primary)' }}>
                        v{latestVersion}
                      </div>
                    </div>
                  )}
                </div>

                {/* Status Cards */}
                {updateStatus === 'checking' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-info-soft)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                    <span className="update-status" style={{ color: 'var(--c-info)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>
                      Checking for updates…
                    </span>
                  </div>
                )}

                {updateStatus === 'latest' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-success-soft)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                    <span className="update-status" style={{ color: 'var(--c-success)' }}>
                      ✓ You are running the latest version of IntelliFile (v{currentVersion})
                    </span>
                  </div>
                )}

                {updateStatus === 'available' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-brand-soft)', border: '1px solid var(--color-primary)' }}>
                    <span className="update-status" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                      🎉 Version v{latestVersion} is available!
                    </span>
                    <button className="settings-button primary" onClick={handleDownloadUpdate}>
                      Download Update (v{latestVersion})
                    </button>
                  </div>
                )}

                {updateStatus === 'downloading' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', fontWeight: '600', color: 'var(--t-primary)' }}>
                      <span>Downloading update v{latestVersion}…</span>
                      <span>{downloadProgress}%</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--bo-light)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                )}

                {updateStatus === 'downloaded' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-success-soft)', border: '1px solid var(--c-success)' }}>
                    <span className="update-status" style={{ color: 'var(--c-success)', fontWeight: '700' }}>
                      ⚡ Update v{latestVersion || 'new'} downloaded and ready to install!
                    </span>
                    <button className="settings-button primary" onClick={handleRestartAndInstall}>
                      Install & Restart Now
                    </button>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-error-soft)', border: '1px solid var(--c-error)' }}>
                    <span className="update-status" style={{ color: 'var(--c-error)' }}>
                      ❌ {updateError || 'Could not check for updates'}
                    </span>
                    <button className="settings-button secondary" onClick={handleCheckForUpdates}>
                      Retry
                    </button>
                  </div>
                )}

                {/* Wi-Fi Auto-Download Toggle */}
                <div className="settings-toggle-row" onClick={() => persistSetting('auto_update_wifi', !autoUpdateWiFi)} style={{ marginTop: '8px' }}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Wi‑Fi Auto-Download</div>
                    <div className="settings-toggle-desc">Automatically download updates in background when connected to Wi-Fi</div>
                  </div>
                  <label className="switch" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={autoUpdateWiFi} onChange={() => persistSetting('auto_update_wifi', !autoUpdateWiFi)} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ═══ PRIVACY ═══ */}
          {activeTab === 'privacy' && matchesSection('privacy') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon">🔒</span> Privacy & Offline Diagnostics
                  </div>
                  <div className="settings-panel-subtitle">Control local usage logging and privacy settings</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <p>IntelliFile runs 100% offline. All AI processing happens locally on your machine. No data ever leaves your device.</p>
                <div className="settings-toggle-row" onClick={() => persistSetting('telemetry_enabled', !telemetryEnabled)}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Local Usage Diagnostics</div>
                    <div className="settings-toggle-desc">Record anonymous usage statistics (search count, index runs) locally in SQLite for diagnostic inspection</div>
                  </div>
                  <label className="switch" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={telemetryEnabled} onChange={() => persistSetting('telemetry_enabled', !telemetryEnabled)} />
                    <span className="slider"></span>
                  </label>
                </div>

                {telemetryEnabled && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--bo-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: '700', color: 'var(--t-primary)' }}>
                        📊 Local Analytics Summary (Stored Offline in SQLite)
                      </span>
                      <button
                        className="settings-button secondary"
                        style={{ fontSize: 'var(--text-xs)', padding: '0.25rem 0.5rem' }}
                        onClick={async () => {
                          if (typeof ipc?.clearAnalytics === 'function') {
                            await ipc.clearAnalytics();
                          } else {
                            await window.electron?.ipcRenderer?.invoke?.('analytics:clear');
                          }
                          toast('Local analytics log cleared', { type: 'info' });
                          loadAnalytics();
                        }}
                      >
                        Clear Log
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                      <div style={{ padding: '0.75rem', background: 'var(--s-hover)', borderRadius: 'var(--rd-md)', textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: '800', color: 'var(--color-primary)' }}>
                          {analyticsSummary.counts?.search_executed || 0}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginTop: '2px' }}>Searches</div>
                      </div>
                      <div style={{ padding: '0.75rem', background: 'var(--s-hover)', borderRadius: 'var(--rd-md)', textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: '800', color: 'var(--color-primary)' }}>
                          {analyticsSummary.counts?.chat_ask || 0}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginTop: '2px' }}>AI Queries</div>
                      </div>
                      <div style={{ padding: '0.75rem', background: 'var(--s-hover)', borderRadius: 'var(--rd-md)', textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: '800', color: 'var(--color-primary)' }}>
                          {analyticsSummary.counts?.autosort_executed || 0}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginTop: '2px' }}>Auto-Sorts</div>
                      </div>
                      <div style={{ padding: '0.75rem', background: 'var(--s-hover)', borderRadius: 'var(--rd-md)', textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: '800', color: 'var(--color-primary)' }}>
                          {analyticsSummary.counts?.index_run || 0}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginTop: '2px' }}>Index Runs</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ═══ ABOUT ═══ */}
          {activeTab === 'about' && matchesSection('about') && (
            <>
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">
                      <span className="panel-icon">ℹ️</span> About IntelliFile
                    </div>
                  </div>
                </div>
                <div className="settings-panel-content">
                  <div className="about-grid">
                    <div className="about-item">
                      <div className="about-label">Version</div>
                      <div className="about-value">v{currentVersion || '1.0.2'}</div>
                    </div>
                    <div className="about-item">
                      <div className="about-label">Framework</div>
                      <div className="about-value">Electron + React</div>
                    </div>
                    <div className="about-item">
                      <div className="about-label">AI Engine</div>
                      <div className="about-value">Llama.cpp + FAISS</div>
                    </div>
                    <div className="about-item">
                      <div className="about-label">Privacy</div>
                      <div className="about-value">100% Offline</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Reset All */}
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">Reset</div>
                    <div className="settings-panel-subtitle">Restore all settings to their default values</div>
                  </div>
                </div>
                <div className="settings-panel-content">
                  <button
                    className="settings-button destructive"
                    onClick={async () => {
                      const ok = await confirmApp('Reset all settings to default? This cannot be undone.', []);
                      if (ok) {
                        setSaving(true);
                        try {
                          if (typeof ipc?.resetAllSettings === 'function') {
                            await ipc.resetAllSettings();
                          } else {
                            await ipc?.invoke?.('reset-all-settings');
                          }
                          toast('Settings reset to defaults', { type: 'success' });
                        } catch (e) {
                          toast('Failed to reset settings', { type: 'error' });
                        }
                        await loadSettings();
                        setSaving(false);
                      }
                    }}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Unsaved changes bar */}
          {isDirty && (
            <div className="settings-apply-bar">
              <div className="settings-apply-text">⚠ You have unsaved changes</div>
              <div className="settings-apply-actions">
                <button className="settings-button secondary" onClick={() => { loadSettings(); }}>Discard</button>
                <button className="settings-button primary" onClick={applyAllSettings}>Apply All</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}