// IntelliFile Settings Page Component
import React, { useEffect, useMemo, useState } from 'react';
import './Settings.css';
import confirmApp from '../utils/confirm';
import { showToast } from '../utils/toast';
import { FaPalette } from 'react-icons/fa';
import {
  FiFolder,
  FiSearch,
  FiCpu,
  FiHardDrive,
  FiRefreshCw,
  FiLock,
  FiCompass,
  FiInfo,
  FiImage,
  FiFilm,
  FiMusic,
  FiFileText,
  FiPackage,
  FiCode,
  FiGrid,
  FiLayers,
  FiDatabase,
  FiAlertTriangle,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiDownload,
  FiPower,
  FiFolderPlus,
  FiZap,
  FiTool,
  FiBarChart2,
  FiAlertCircle,
  FiCheck,
  FiLinkedin
} from 'react-icons/fi';

// Lightweight toast helper
const toast = (message, options = {}) => {
  if (window.intellifile?.showToast) return window.intellifile.showToast(message, options);
  return showToast(message, options);
};

const DEFAULT_WATCH_FOLDERS = ['Downloads', 'Desktop'];
const ipc = window.intellifile;

const openExternalLink = (url) => {
  // Use the renderer's IPC bridge rather than the optional shell preload API.
  // Some already-running windows do not expose that API, which caused the
  // previous click handler to crash.
  const invoke = window.electron?.ipcRenderer?.invoke;
  if (typeof invoke === 'function') {
    invoke('open-external-url', url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};
const TEAM_MEMBERS = [
  { name: 'Daksh Gopani', initials: 'DG', linkedin: 'https://www.linkedin.com/in/daksh-gopani-a13993251/' },
  { name: 'Rishi Vejani', initials: 'RV', linkedin: 'https://www.linkedin.com/in/rishi-vejani/' },
  { name: 'Rudra Parmar', initials: 'RP', linkedin: 'https://www.linkedin.com/in/rudra-parmar-089125245/' },
  { name: 'Samyak Chheda', initials: 'SC', linkedin: 'https://www.linkedin.com/in/samyakchheda/' },
];

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - timestamp * 1000;
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp * 1000).toLocaleString();
};

const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const SECTIONS = [
  { id: 'about', label: 'About', icon: <FiInfo /> },
  { id: 'ai-model', label: 'AI Model', icon: <FiCpu /> },
  { id: 'appearance', label: 'Appearance', icon: <FaPalette /> },
  { id: 'file-management', label: 'File Management', icon: <FiFolder /> },
  { id: 'preferences', label: 'Preferences', icon: <FiTool /> },
  { id: 'privacy', label: 'Privacy', icon: <FiLock /> },
  { id: 'search-indexing', label: 'Search & Indexing', icon: <FiSearch /> },
  { id: 'storage', label: 'Storage', icon: <FiHardDrive /> },
  { id: 'take-tour', label: 'Take a Tour', icon: <FiCompass />, isAction: true },
  { id: 'updates', label: 'Updates', icon: <FiRefreshCw /> },
];

export default function Settings({ theme, onThemeChange, onStartTour, initialTab }) {
  const [loading, setLoading] = useState(true);
  const [initialSettings, setInitialSettings] = useState({});
  const [, setSaving] = useState(false);

  const [autoSortEnabled, setAutoSortEnabled] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState([]);
  const [sortRoot, setSortRoot] = useState('Sorted');
  const [recentSorts, setRecentSorts] = useState([]);
  const [indexEnabled, setIndexEnabled] = useState(false);
  const [aiModelPath, setAiModelPath] = useState('');
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [autoUpdateWiFi, setAutoUpdateWiFi] = useState(false);
  const [autoModelUpgrade, setAutoModelUpgrade] = useState(true);

  const [isDefaultFileManager, setIsDefaultFileManager] = useState(false);
  const [allowProtectedIndexing, setAllowProtectedIndexing] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState(initialTab || 'about');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    let mounted = true;
    const checkDefaultStatus = async () => {
      try {
        if (window.intellifile?.checkIsDefaultFileManager) {
          const res = await window.intellifile.checkIsDefaultFileManager();
          if (mounted) setIsDefaultFileManager(!!res);
        }
      } catch (e) {
        console.warn('Failed to check default file manager status:', e);
      }
    };
    checkDefaultStatus();
    return () => { mounted = false; };
  }, []);

  const updateIsDefaultFileManager = async (nextValue) => {
    setIsDefaultFileManager(nextValue);
    setIsSettingDefault(true);
    toast(
      nextValue ? '⏳ Setting as default...' : '⏳ Removing default...',
      {
        type: 'info',
        title: 'In Progress',
        message: 'Applying changes in the background, please wait...',
        duration: 3000
      }
    );
    try {
      if (window.intellifile?.setDefaultFileManager) {
        const result = await window.intellifile.setDefaultFileManager(nextValue);
        if (result && !result.success) {
          setIsDefaultFileManager(!nextValue);
          toast(result.error || 'Failed to set as default file manager', { type: 'error' });
        } else if (result && result.success) {
          toast(
            nextValue ? 'Default file manager enabled.' : 'Default file manager disabled.',
            {
              type: 'success',
              message: nextValue 
                ? 'IntelliFile is now set as the default handler for folders and File Explorer shortcuts.' 
                : 'IntelliFile has been unregistered as the default file manager.',
              solution: 'You can test it by opening folders or using Win+E.'
            }
          );
        }
      } else {
        await persistSetting('is_default_file_manager', nextValue);
      }
    } catch (e) {
      setIsDefaultFileManager(!nextValue);
      console.warn('Failed to update default file manager preference:', e);
      toast(e.message || 'Failed to update default preference', { type: 'error' });
    } finally {
      setIsSettingDefault(false);
    }
  };

  const updateAllowProtectedIndexing = async (val) => {
    setAllowProtectedIndexing(val);
    await persistSetting('allow_protected_indexing', val);
  };

  // Update System States
  const [currentVersion, setCurrentVersion] = useState('1.0.2');
  const [updateStatus, setUpdateStatus] = useState('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');

  // Analytics State
  const [analyticsSummary, setAnalyticsSummary] = useState({ counts: {}, recent: [] });

  // Storage Analysis State
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageSummary, setStorageSummary] = useState(null);
  const [largestFiles, setLargestFiles] = useState([]);
  const [folderBreakdown, setFolderBreakdown] = useState([]);
  const [cleaningCache, setCleaningCache] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);

  const loadStorageSummary = async (forceRefresh = false) => {
    setStorageLoading(true);
    try {
      const getStorageFn = window.electron?.getStorageSummary || ipc?.getStorageSummary;
      if (getStorageFn) {
        const res = await getStorageFn(forceRefresh);
        if (res) setStorageSummary(res);
      }
      loadDiagnosticData();
    } catch (err) {
      console.warn('[Settings] Failed to load storage summary:', err);
    } finally {
      setStorageLoading(false);
    }
  };

  const loadDiagnosticData = async () => {
    try {
      const getLargestFn = window.electron?.getLargestFiles || ipc?.getLargestFiles;
      if (getLargestFn) {
        const files = await getLargestFn();
        if (files) setLargestFiles(files);
      }

      const getFoldersFn = window.electron?.getFolderBreakdown || ipc?.getFolderBreakdown;
      if (getFoldersFn) {
        const folders = await getFoldersFn();
        if (folders) setFolderBreakdown(folders);
      }
    } catch (e) {
      console.warn('[Settings] Failed to load diagnostic data:', e);
    }
  };

  const handleShowInFolder = (filePath, e) => {
    if (e) e.preventDefault();
    window.dispatchEvent(new CustomEvent('intellifile-reveal-file', { detail: { filePath } }));
  };

  const handleDeleteStorageFile = async (fileObj) => {
    const msg = `Are you sure you want to move "${fileObj.name}" (${formatBytes(fileObj.size)}) to your Recycle Bin?`;
    const ok = await confirmApp(msg);
    if (!ok) return;

    try {
      const delFn = window.electron?.deleteStorageFile || ipc?.deleteStorageFile;
      if (delFn) {
        const res = await delFn(fileObj.path);
        if (res?.success) {
          toast(`Moved "${fileObj.name}" to Recycle Bin`, { type: 'success' });
          setLargestFiles(prev => prev.filter(f => f.path !== fileObj.path));
          loadStorageSummary(true);
        } else {
          toast(res?.error || 'Failed to delete file', { type: 'error' });
        }
      }
    } catch (e) {
      toast(e.message || 'Failed to delete file', { type: 'error' });
    }
  };

  const handleCleanCache = async () => {
    setCleaningCache(true);
    setCleanResult(null);
    try {
      const cleanFn = window.electron?.cleanTempCache || ipc?.cleanTempCache;
      if (cleanFn) {
        const res = await cleanFn();
        const bytes = res?.bytesCleaned || 0;
        const count = res?.filesCount || 0;
        const resultObj = {
          success: res?.success,
          bytesCleaned: bytes,
          filesCount: count,
          timestamp: Date.now()
        };
        setCleanResult(resultObj);
        if (res?.success) {
          toast(bytes > 0 ? `Cleaned ${formatBytes(bytes)} (${count} files)!` : 'Temporary cache clean!', { type: 'success' });
          loadStorageSummary(true);
        } else {
          toast('No temporary cache files to clean', { type: 'info' });
        }
      }
    } catch (e) {
      toast(e.message || 'Failed to clean cache', { type: 'error' });
    } finally {
      setCleaningCache(false);
    }
  };

  // Indexing Operations State
  const [rescanLoading, setRescanLoading] = useState(false);
  const [reembedLoading, setReembedLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState(null);

  useEffect(() => {
    if (!window.intellifile?.onIndexProgress) return undefined;
    const unsub = window.intellifile.onIndexProgress((data) => {
      if (!data) return;
      setIndexingProgress(data);
      if (data.phase === 'done' || data.phase === 'error') {
        setTimeout(() => setIndexingProgress(null), 3000);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const indexingBusy = rescanLoading || reembedLoading || resetLoading || (indexingProgress && indexingProgress.phase !== 'done' && indexingProgress.phase !== 'error');

  const handleRescanSystem = async () => {
    setRescanLoading(true);
    try {
      toast('Starting system scan for indexing…', { type: 'info' });
      await (ipc?.indexDevice ? ipc.indexDevice() : window.electron?.ipcRenderer?.invoke?.('index-device'));
      toast('System re-scan completed.', { type: 'success' });
    } catch (e) {
      toast('System re-scan failed.', { type: 'error' });
    } finally {
      setRescanLoading(false);
    }
  };

  const handleRecreateEmbeddings = async () => {
    setReembedLoading(true);
    try {
      toast('Re-creating AI embeddings for extracted files…', { type: 'info' });
      const res = await (ipc?.recreateEmbeddings ? ipc.recreateEmbeddings() : window.electron?.ipcRenderer?.invoke?.('index:recreate-embeddings'));
      if (res?.success) {
        toast(res.message || 'Embeddings re-created successfully.', { type: 'success' });
      } else {
        toast(res?.error || 'Failed to re-create embeddings.', { type: 'error' });
      }
    } catch (e) {
      toast('Re-creating embeddings failed.', { type: 'error' });
    } finally {
      setReembedLoading(false);
    }
  };

  const handleResetIndexing = async () => {
    const ok = window.confirm('Are you sure you want to reset the vector database and search index? All current index data will be purged and rebuilt.');
    if (!ok) return;
    setResetLoading(true);
    try {
      toast('Resetting vector database and index…', { type: 'info' });
      const res = await (ipc?.resetIndexAll ? ipc.resetIndexAll() : window.electron?.ipcRenderer?.invoke?.('index:reset-all'));
      if (res?.success) {
        toast('Vector DB and index reset. Starting fresh scan…', { type: 'success' });
        handleRescanSystem();
      } else {
        toast(res?.error || 'Failed to reset index.', { type: 'error' });
      }
    } catch (e) {
      toast('Reset index failed.', { type: 'error' });
    } finally {
      setResetLoading(false);
    }
  };

  // Load settings
  const loadSettings = async () => {
    try {
      const [enabled, folders, root, idx, model, telemetry, autoWi, autoModel, dbTheme] = await Promise.all([
        ipc?.getSetting?.('auto_sort_enabled'),
        ipc?.getSetting?.('watched_folders'),
        ipc?.getSetting?.('sort_root'),
        ipc?.getSetting?.('index_enabled'),
        ipc?.getSetting?.('ai_model_path'),
        ipc?.getSetting?.('telemetry_enabled'),
        ipc?.getSetting?.('auto_update_wifi'),
        ipc?.getSetting?.('auto_model_upgrade'),
        ipc?.getSetting?.('theme'),
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
        auto_model_upgrade: parseBool(autoModel, true),
        theme: dbTheme?.value || theme || 'system',
      };

      setInitialSettings(values);
      setAutoSortEnabled(values.auto_sort_enabled);
      setWatchedFolders(values.watched_folders);
      setSortRoot(values.sort_root);
      setIndexEnabled(values.index_enabled);
      setAiModelPath(values.ai_model_path);
      setTelemetryEnabled(values.telemetry_enabled);
      setAutoUpdateWiFi(values.auto_update_wifi);
      setAutoModelUpgrade(values.auto_model_upgrade);
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
        case 'auto_model_upgrade': setAutoModelUpgrade(!!value); break;
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
      preferences: ['preferences', 'default', 'protected', 'permission'],
      'search-indexing': ['index', 'search', 'scan', 'indexing'],
      'ai-model': ['ai', 'model', 'llm', 'path', 'download'],
      updates: ['update', 'version', 'download', 'wifi'],
      privacy: ['privacy', 'telemetry', 'data', 'analytics'],
      'take-tour': ['tour', 'guided tour', 'guide', 'tutorial', 'onboarding', 'take a tour'],
      about: ['about', 'version', 'help', 'reset'],
    };
    const sec = SECTIONS.find(s => s.id === sectionId);
    const tokens = [...(map[sectionId] || []), sec?.label?.toLowerCase() || ''];
    return tokens.some(t => t.includes(q) || q.includes(t));
  };

  const filteredSections = SECTIONS.filter(s => matchesSection(s.id));

  useEffect(() => {
    loadSettings();
    loadRecent();
    const unsub = ipc?.onAutoSortNotification?.(() => loadRecent());
    return () => { if (typeof unsub === 'function') unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update listeners & initial version fetch
  useEffect(() => {
    if (ipc?.getAppVersion) {
      ipc.getAppVersion().then((v) => { if (v) setCurrentVersion(v); });
    }

    const getStateFn = window.electron?.getUpdateState || ipc?.getUpdateState;
    if (getStateFn) {
      getStateFn().then((state) => {
        if (state) {
          if (state.version) setLatestVersion(state.version);
          if (state.status && state.status !== 'idle') {
            setUpdateStatus(state.status);
          }
          if (typeof state.progress === 'number' && state.progress > 0) {
            setDownloadProgress(state.progress);
          }
        }
      });
    }

    const ipcRenderer = ipc?.ipcRenderer || window.electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const parsePayload = (a, b) => {
      if (a && typeof a === 'object' && ('percent' in a || 'version' in a || 'message' in a || 'status' in a)) return a;
      if (b && typeof b === 'object' && ('percent' in b || 'version' in b || 'message' in b || 'status' in b)) return b;
      return a || b || {};
    };

    const onChecking = () => {
      setUpdateStatus((prev) => (prev === 'available' || prev === 'downloading' || prev === 'downloaded' ? prev : 'checking'));
    };
    const onAvail = (a, b) => {
      const data = parsePayload(a, b);
      const ver = data?.version || (typeof a === 'string' ? a : typeof b === 'string' ? b : '');
      if (ver) setLatestVersion(ver);
      setUpdateStatus('available');
    };
    const onNotAvail = () => {
      setUpdateStatus((prev) => (prev === 'available' || prev === 'downloading' || prev === 'downloaded' ? prev : 'latest'));
    };
    const onProgress = (a, b) => {
      const data = parsePayload(a, b);
      const pct = typeof data?.percent === 'number' ? data.percent : (typeof a === 'number' ? a : 0);
      setUpdateStatus('downloading');
      setDownloadProgress(pct);
    };
    const onDone = (a, b) => {
      const data = parsePayload(a, b);
      const ver = data?.version || (typeof a === 'string' ? a : typeof b === 'string' ? b : '');
      if (ver) setLatestVersion(ver);
      setUpdateStatus('downloaded');
    };
    const onError = (a, b) => {
      const data = parsePayload(a, b);
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
    // If state is already available or downloaded, display it directly
    const getStateFn = window.electron?.getUpdateState || ipc?.getUpdateState;
    if (getStateFn) {
      try {
        const state = await getStateFn();
        if (state?.status === 'available' || state?.status === 'downloaded') {
          if (state.version) setLatestVersion(state.version);
          setUpdateStatus(state.status);
          if (state.status === 'downloaded') setDownloadProgress(100);
          return;
        }
      } catch (_e) {}
    }

    setUpdateStatus('checking');
    setUpdateError('');
    try {
      let res;
      const checkPromise = (typeof ipc?.checkForUpdates === 'function')
        ? ipc.checkForUpdates()
        : (window.electron?.ipcRenderer ? window.electron.ipcRenderer.invoke('check-for-updates') : Promise.resolve(null));

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 4000));
      res = await Promise.race([checkPromise, timeoutPromise]);

      if (res?.timeout) {
        const state = getStateFn ? await getStateFn() : null;
        if (state?.status && state.status !== 'idle') {
          if (state.version) setLatestVersion(state.version);
          setUpdateStatus(state.status);
          return;
        }
      }

      if (res) {
        const ver = res.version || res.latestVersion;
        if (ver) setLatestVersion(ver);

        if (res.downloaded || res.status === 'downloaded') {
          setUpdateStatus('downloaded');
          setDownloadProgress(100);
        } else if (res.updateAvailable || res.status === 'available') {
          setUpdateStatus('available');
        } else if (res.updateAvailable === false || res.status === 'latest') {
          setUpdateStatus('latest');
        } else if (res.error) {
          if (res.error.toLowerCase().includes('no update') || res.error.includes('404')) {
            setUpdateStatus('latest');
          } else {
            setUpdateError(res.error);
            setUpdateStatus('error');
          }
        } else {
          setUpdateStatus('latest');
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
      let res;
      if (typeof ipc?.downloadUpdate === 'function') {
        res = await ipc.downloadUpdate();
      } else if (window.electron?.ipcRenderer) {
        res = await window.electron.ipcRenderer.invoke('download-update');
      }
      if (res?.downloaded || res?.status === 'downloaded') {
        if (res.version) setLatestVersion(res.version);
        setUpdateStatus('downloaded');
        setDownloadProgress(100);
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
    } catch (e) {
      console.warn('Failed to load analytics', e);
    }
  };

  useEffect(() => {
    if (telemetryEnabled && activeTab === 'privacy') {
      loadAnalytics();
    }
  }, [telemetryEnabled, activeTab]);

  useEffect(() => {
    if (activeTab === 'storage' && !storageSummary) {
      loadStorageSummary();
    }
  }, [activeTab, storageSummary]);



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
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''} ${tab.isAction ? 'nav-action-item' : ''}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={0}
                onClick={() => {
                  if (tab.id === 'take-tour') {
                    onStartTour?.();
                  } else {
                    setActiveTab(tab.id);
                  }
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    if (tab.id === 'take-tour') {
                      onStartTour?.();
                    } else {
                      setActiveTab(tab.id);
                    }
                  }
                }}
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
                    <span className="panel-icon"><FaPalette /></span> Appearance
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
                      <span className="theme-card-check">{theme === 'light' ? <FiCheck /> : ''}</span>
                    </div>
                  </label>
                  {/* Dark */}
                  <label className={`theme-card ${theme === 'dark' ? 'active' : ''}`} onClick={() => handleThemeSelect('dark')}>
                    <input type="radio" name="theme" checked={theme === 'dark'} onChange={() => handleThemeSelect('dark')} />
                    <div className="theme-preview theme-preview-dark" />
                    <div className="theme-card-label">
                      <span>Dark</span>
                      <span className="theme-card-check">{theme === 'dark' ? <FiCheck /> : ''}</span>
                    </div>
                  </label>
                  {/* System */}
                  <label className={`theme-card ${theme === 'system' ? 'active' : ''}`} onClick={() => handleThemeSelect('system')}>
                    <input type="radio" name="theme" checked={theme === 'system'} onChange={() => handleThemeSelect('system')} />
                    <div className="theme-preview theme-preview-system" />
                    <div className="theme-card-label">
                      <span>System</span>
                      <span className="theme-card-check">{theme === 'system' ? <FiCheck /> : ''}</span>
                    </div>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ═══ FILE MANAGEMENT ═══ */}
          {activeTab === 'file-management' && matchesSection('file-management') && (
            <>
              <div className="settings-tour-auto-sort" data-tour="auto-sort-settings">
              {/* Auto Sort Toggle */}
              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">
                      <span className="panel-icon"><FiFolder /></span> Automatic File Sorting
                    </div>
                    <div className="settings-panel-subtitle">Automatically categorize new files added to watched folders</div>
                  </div>
                </div>
                <div className="settings-panel-content">
                  <div className={`setting-card-row ${autoSortEnabled ? 'is-active' : ''}`} onClick={() => persistSetting('auto_sort_enabled', !autoSortEnabled)}>
                    <div className="settings-toggle-info">
                      <div className="settings-toggle-label">Enable Auto-Sort</div>
                      <div className="settings-toggle-desc">Automatically organize files into smart folders based on type and content</div>
                    </div>
                    <label className="switch" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={autoSortEnabled} onChange={() => persistSetting('auto_sort_enabled', !autoSortEnabled)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </section>

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

              </div>

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
                    <div className="recent-sorts-list">
                      {recentSorts.map((row) => (
                        <div key={row.id} className="recent-sort-item">
                          <div className="recent-sort-details">
                            <div className="recent-sort-file" title={row.source_path}>
                              {row.source_path ? row.source_path.split(/[/\\]/).pop() : 'File'}
                            </div>
                            <div className="recent-sort-meta">
                              <span className="recent-sort-category">{row.category || 'General'}</span>
                              <span className="recent-sort-time">{formatRelativeTime(row.timestamp)}</span>
                            </div>
                            <div className="recent-sort-paths" title={`${row.source_path} → ${row.destination_path}`}>
                              {row.source_path} → {row.destination_path}
                            </div>
                          </div>
                          <div className="recent-sort-actions">
                            <button
                              className="settings-button secondary small"
                              onClick={() => undoRecentSort(row)}
                              title="Move file back to original location"
                            >
                              Undo
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ═══ PREFERENCES ═══ */}
          {(activeTab === 'preferences' || searchTerm) && matchesSection('preferences') && (
            <section className="settings-panel preferences-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon"><FiTool /></span> Preferences
                  </div>
                  <div className="settings-panel-subtitle">Choose how IntelliFile works with Windows and protected files</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <div className={`setting-card-row ${isDefaultFileManager ? 'is-active' : ''}`} onClick={() => !isSettingDefault && updateIsDefaultFileManager(!isDefaultFileManager)}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Set IntelliFile as default</div>
                    <div className="settings-toggle-desc">Use IntelliFile when opening folders and File Explorer shortcuts</div>
                  </div>
                  <label className="switch" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={isDefaultFileManager} disabled={isSettingDefault} onChange={(event) => updateIsDefaultFileManager(event.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className={`setting-card-row ${allowProtectedIndexing ? 'is-active' : ''}`} onClick={() => updateAllowProtectedIndexing(!allowProtectedIndexing)}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Allow protected indexing</div>
                    <div className="settings-toggle-desc">Include files that require permission or a password when indexing</div>
                  </div>
                  <label className="switch" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={allowProtectedIndexing} onChange={(event) => updateAllowProtectedIndexing(event.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ═══ SEARCH & INDEXING ═══ */}
          {activeTab === 'search-indexing' && matchesSection('search-indexing') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon"><FiSearch /></span> Search & Indexing
                  </div>
                  <div className="settings-panel-subtitle">Control background file indexing for fast semantic search</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <div className={`setting-card-row ${indexEnabled ? 'is-active' : ''}`} onClick={() => persistSetting('index_enabled', !indexEnabled)}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Automatic Background Indexing</div>
                    <div className="settings-toggle-desc">Automatically index new & modified files in watched folders to enable semantic search</div>
                  </div>
                  <label className="switch" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={indexEnabled} onChange={() => persistSetting('index_enabled', !indexEnabled)} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="settings-operations-container">
                  <div className="settings-sub-heading">
                    <FiTool /> Indexing Operations
                  </div>

                  {/* Option 1: Re-scan System */}
                  <div className="operation-card-row op-success">
                    <div>
                      <div className="settings-toggle-label">1. Re-scan System Files & Folders</div>
                      <div className="settings-toggle-desc">Scan system for new & modified files for indexing</div>
                    </div>
                    <button
                      className="settings-button primary"
                      disabled={indexingBusy}
                      onClick={handleRescanSystem}
                    >
                      {rescanLoading ? 'Scanning…' : 'Re-scan System'}
                    </button>
                  </div>

                  {/* Option 2: Re-create Embeddings */}
                  <div className="operation-card-row op-success">
                    <div>
                      <div className="settings-toggle-label">2. Re-create Embeddings</div>
                      <div className="settings-toggle-desc">Re-generate vector embeddings for already extracted files. Run this after a search-engine update to apply improved embedding preprocessing.</div>
                    </div>
                    <button
                      className="settings-button secondary"
                      disabled={indexingBusy}
                      onClick={handleRecreateEmbeddings}
                    >
                      {reembedLoading ? 'Re-creating…' : 'Re-create Embeddings'}
                    </button>
                  </div>

                  {/* Option 3: Reset Indexing & Embeddings */}
                  <div className="operation-card-row op-danger">
                    <div>
                      <div className="settings-toggle-label op-danger-title">3. Reset Indexing & Embeddings</div>
                      <div className="settings-toggle-desc">Purge previous vector DB & index, building the whole vector DB again from scratch</div>
                    </div>
                    <button
                      className="settings-button danger-outline"
                      disabled={indexingBusy}
                      onClick={handleResetIndexing}
                    >
                      {resetLoading ? 'Resetting…' : 'Reset Index & Vector DB'}
                    </button>
                  </div>

                  {/* Live Indexing Progress Indicator Bar */}
                  {indexingProgress && (
                    <div style={{ marginTop: '0.5rem', padding: '0.85rem 1rem', background: 'var(--c-brand-soft, rgba(37, 99, 235, 0.08))', borderRadius: 'var(--rd-md)', border: '1px solid var(--color-primary)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.45rem', fontSize: 'var(--text-xs)', fontWeight: '700', color: 'var(--color-primary)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FiZap /> {indexingProgress.phase ? String(indexingProgress.phase).toUpperCase() : 'INDEXING'}: {indexingProgress.detail || 'Processing indexing task…'}</span>
                        <span>{indexingProgress.pct ?? 0}%</span>
                      </div>
                      <div style={{ height: '8px', background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${indexingProgress.pct ?? 0}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease-in-out' }} />
                      </div>
                    </div>
                  )}
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
                    <span className="panel-icon"><FiCpu /></span> AI Model Settings
                  </div>
                  <div className="settings-panel-subtitle">Configure local LLM & embedding model parameters</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <label className="settings-input-label">
                  <span>Local AI Model Path</span>
                  <div className="settings-input-with-button">
                    <input
                      value={aiModelPath}
                      onChange={(e) => setAiModelPath(e.target.value)}
                      onBlur={() => persistSetting('ai_model_path', aiModelPath)}
                      placeholder="Default built-in model"
                    />
                    <button className="settings-button secondary" onClick={handleBrowseModel}>Browse</button>
                  </div>
                </label>

                {/* Auto Model Upgrade Toggle */}
                <div className={`setting-card-row ${autoModelUpgrade ? 'is-active' : ''}`} onClick={() => persistSetting('auto_model_upgrade', !autoModelUpgrade)} style={{ marginTop: '1rem' }}>
                  <div className="settings-toggle-info">
                    <div className="settings-toggle-label">Automatically Upgrade Search Models</div>
                    <div className="settings-toggle-desc">Background dual-database migration keeps searches active while building new vector embeddings</div>
                  </div>
                  <label className="switch" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={autoModelUpgrade} onChange={() => persistSetting('auto_model_upgrade', !autoModelUpgrade)} />
                    <span className="slider"></span>
                  </label>
                </div>

                {/* Model Download & Manage Button */}
                <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--bo-light)', display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: '600', color: 'var(--t-primary)' }}>Download / Change AI Model</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginTop: '2px' }}>Download GGUF model files (Llama 3, Mistral, Qwen) for enhanced local search and chat</div>
                  </div>
                  <button
                    className="settings-button primary"
                    onClick={() => {
                      toast('Model manager coming in next update', { type: 'info' });
                    }}
                  >
                    Manage Models
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
                    <span className="panel-icon"><FiRefreshCw /></span> Application Updates
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
                      <FiRefreshCw className="spin" style={{ fontSize: '1.1rem' }} />
                      Checking for updates…
                    </span>
                  </div>
                )}

                {updateStatus === 'latest' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-success-soft)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                    <span className="update-status" style={{ color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiCheckCircle style={{ fontSize: '1.1rem' }} /> You are running the latest version of IntelliFile (v{currentVersion})
                    </span>
                  </div>
                )}

                {updateStatus === 'available' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-brand-soft)', border: '1px solid var(--color-primary)' }}>
                    <span className="update-status" style={{ color: 'var(--color-primary)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiDownload style={{ fontSize: '1.1rem' }} /> Version v{latestVersion} is available!
                    </span>
                    <button className="settings-button primary" onClick={handleDownloadUpdate} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <FiDownload /> Download Update (v{latestVersion})
                    </button>
                  </div>
                )}

                {updateStatus === 'downloading' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', fontWeight: '600', color: 'var(--t-primary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FiDownload className="spin" /> Downloading update v{latestVersion}…</span>
                      <span>{downloadProgress}%</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--bo-light)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                )}

                {updateStatus === 'downloaded' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-success-soft)', border: '1px solid var(--c-success)' }}>
                    <span className="update-status" style={{ color: 'var(--c-success)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiZap style={{ fontSize: '1.1rem' }} /> Update v{latestVersion || 'new'} downloaded and ready to install!
                    </span>
                    <button className="settings-button primary" onClick={handleRestartAndInstall} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <FiPower /> Install & Restart Now
                    </button>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-error-soft)', border: '1px solid var(--c-error)' }}>
                    <span className="update-status" style={{ color: 'var(--c-error)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiXCircle style={{ fontSize: '1.1rem' }} /> {updateError || 'Could not check for updates'}
                    </span>
                    <button className="settings-button secondary" onClick={handleCheckForUpdates} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <FiRefreshCw /> Retry
                    </button>
                  </div>
                )}

                {/* Wi-Fi Auto-Download Toggle */}
                <div className={`setting-card-row ${autoUpdateWiFi ? 'is-active' : ''}`} onClick={() => persistSetting('auto_update_wifi', !autoUpdateWiFi)} style={{ marginTop: '8px' }}>
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

          {/* ═══ STORAGE ═══ */}
          {activeTab === 'storage' && matchesSection('storage') && (
            <section className="settings-panel" data-tour="storage-settings">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon"><FiHardDrive /></span> Storage & Disk Usage
                  </div>
                  <div className="settings-panel-subtitle">Analyze drive capacity, top space hogs, and clean temporary cache</div>
                </div>
                <div className="section-actions">
                  <button
                    className="settings-button secondary"
                    onClick={() => loadStorageSummary(true)}
                    disabled={storageLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <FiRefreshCw className={storageLoading ? 'spin' : ''} /> Refresh Storage
                  </button>
                </div>
              </div>

              <div className="settings-panel-content">
                {!storageSummary && storageLoading && (
                  <div className="update-status-container" style={{ marginBottom: '16px', background: 'var(--c-info-soft)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                    <span className="update-status" style={{ color: 'var(--c-info)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiRefreshCw className="spin" />
                      Calculating live disk storage capacity and scanning user folders...
                    </span>
                  </div>
                )}

                {(() => {
                  if (!storageSummary && storageLoading) return null;

                  const total = storageSummary?.totalBytes || 0;
                  const used = storageSummary?.usedBytes || 0;
                  const free = storageSummary?.freeBytes || 0;
                  const usedPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
                  const freePct = 100 - usedPct;

                  const breakdown = storageSummary?.breakdown || {
                    images: { bytes: 0, count: 0 },
                    videos: { bytes: 0, count: 0 },
                    audio: { bytes: 0, count: 0 },
                    documents: { bytes: 0, count: 0 },
                    archives: { bytes: 0, count: 0 },
                    developer: { bytes: 0, count: 0 },
                    software: { bytes: 0, count: 0 },
                    system: { bytes: 0, count: 0 },
                    intellifile: { bytes: 0, count: 0 },
                    others: { bytes: 0, count: 0 }
                  };

                  const categories = [
                    { key: 'images', label: 'Images', icon: <FiImage />, color: '#f97316', data: breakdown.images },
                    { key: 'videos', label: 'Videos', icon: <FiFilm />, color: '#8b5cf6', data: breakdown.videos },
                    { key: 'audio', label: 'Audio', icon: <FiMusic />, color: '#10b981', data: breakdown.audio },
                    { key: 'documents', label: 'Documents', icon: <FiFileText />, color: '#3b82f6', data: breakdown.documents },
                    { key: 'archives', label: 'Archives & Zip', icon: <FiPackage />, color: '#f59e0b', data: breakdown.archives },
                    { key: 'developer', label: 'Code & Dev Projects', icon: <FiCode />, color: '#ec4899', data: breakdown.developer },
                    { key: 'software', label: 'Installed Software & Apps', icon: <FiGrid />, color: '#06b6d4', data: breakdown.software },
                    { key: 'system', label: 'Windows OS & Drivers', icon: <FiLayers />, color: '#6366f1', data: breakdown.system },
                    { key: 'intellifile', label: 'IntelliFile AI Data', icon: <FiDatabase />, color: 'var(--color-primary)', data: breakdown.intellifile },
                    { key: 'others', label: 'Other Caches & Data', icon: <FiFolder />, color: '#64748b', data: breakdown.others }
                  ];

                  return (
                    <>
                      {/* Top Capacity Bar Card */}
                      <div className="storage-overview-card">
                        <div className="storage-overview-header">
                          <div>
                            <div className="storage-capacity-title">System Drive Storage</div>
                            <div className="storage-capacity-subtitle">
                              <strong>{formatBytes(used)}</strong> used of <strong>{formatBytes(total)}</strong> ({formatBytes(free)} free, {freePct}% available)
                            </div>
                          </div>
                          <div className="storage-capacity-badge">
                            {usedPct}% Used
                          </div>
                        </div>

                        {/* Mobile-Style Multi-Color Stacked Bar */}
                        <div className="storage-stacked-bar">
                          {categories.map((cat) => {
                            const catBytes = cat.data?.bytes || 0;
                            if (catBytes <= 0) return null;
                            const pct = total > 0 ? (catBytes / total) * 100 : 0;
                            return (
                              <div
                                key={cat.key}
                                className="storage-bar-segment"
                                style={{ width: `${Math.max(0.5, pct)}%`, minWidth: '6px', background: cat.color }}
                                title={`${cat.label}: ${formatBytes(catBytes)} (${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%)`}
                              />
                            );
                          })}
                        </div>

                        {/* Legend */}
                        <div className="storage-legend">
                          {categories.map((cat) => (
                            <div key={cat.key} className="storage-legend-item">
                              <span className="storage-dot" style={{ background: cat.color }} />
                              <span className="storage-legend-label">{cat.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Category Breakdown Grid */}
                      <div className="storage-grid">
                        {categories.map((cat) => {
                          const catBytes = cat.data?.bytes || 0;
                          const catCount = cat.data?.count || 0;
                          const pctOfUsed = used > 0 ? ((catBytes / used) * 100).toFixed(1) : 0;

                          return (
                            <div key={cat.key} className="storage-card">
                              <div className="storage-card-header">
                                <div className="storage-card-icon" style={{ background: `${cat.color}20`, color: cat.color }}>
                                  {cat.icon}
                                </div>
                                <div className="storage-card-info">
                                  <div className="storage-card-name">{cat.label}</div>
                                  <div className="storage-card-count">{catCount > 0 ? `${catCount.toLocaleString()} files` : 'System Data'}</div>
                                </div>
                                <div className="storage-card-size">
                                  {formatBytes(catBytes)}
                                </div>
                              </div>
                              <div className="storage-card-progress-track">
                                <div className="storage-card-progress-fill" style={{ width: `${Math.min(100, Math.max(1, pctOfUsed))}%`, background: cat.color }} />
                              </div>
                              <div className="storage-card-meta">
                                <span>{pctOfUsed}% of used space</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* IntelliFile App Storage Footprint Section */}
                      <div className="storage-maintenance-card" style={{ marginTop: '1.25rem' }}>
                        <div className="storage-maintenance-header">
                          <div className="settings-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FiDatabase style={{ color: 'var(--color-primary)' }} /> IntelliFile Offline AI Data & Search Index
                          </div>
                          <div className="settings-toggle-desc">
                            Local SQLite Database, FAISS vector embeddings, search index, and cached AI model weights stored offline.
                          </div>
                        </div>

                        <div className="storage-maintenance-stats">
                          <div className="storage-m-item">
                            <span className="storage-m-val">{formatBytes(breakdown.intellifile?.bytes || 0)}</span>
                            <span className="storage-m-lbl">Total Local Footprint</span>
                          </div>
                          <div className="storage-m-item">
                            <span className="storage-m-val">100% Offline</span>
                            <span className="storage-m-lbl">Privacy & Security</span>
                          </div>
                        </div>
                      </div>

                      {/* Top Storage Hogs Scanner Card */}
                      <div className="storage-hogs-card" style={{ marginTop: '1.25rem' }}>
                        <div className="storage-hogs-header">
                          <div>
                            <div className="storage-capacity-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <FiAlertTriangle style={{ color: '#ef4444' }} /> Top 10 Storage Hogs
                            </div>
                            <div className="storage-capacity-subtitle">
                              Largest multi-gigabyte files detected across your watched folders
                            </div>
                          </div>
                        </div>

                        {largestFiles.length === 0 ? (
                          <div className="storage-hogs-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <FiCheckCircle style={{ color: 'var(--c-success)' }} /> No large space hogs detected!
                          </div>
                        ) : (
                          <div className="storage-hogs-list">
                            {largestFiles.map((file, idx) => (
                              <div key={file.path || idx} className="storage-hog-item">
                                <div className="storage-hog-badge">#{idx + 1}</div>
                                <div className="storage-hog-info">
                                  <div className="storage-hog-name" title={file.path}>{file.name}</div>
                                  <div className="storage-hog-path">{file.folder} • {file.path}</div>
                                </div>
                                <div className="storage-hog-size">{formatBytes(file.size)}</div>
                                <div className="storage-hog-actions">
                                  <button
                                    className="settings-button secondary text-only"
                                    onClick={(e) => handleShowInFolder(file.path, e)}
                                    title="Open in IntelliFile Explorer"
                                    style={{ padding: '4px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    <FiFolder /> Reveal
                                  </button>
                                  <button
                                    className="settings-button danger text-only"
                                    onClick={() => handleDeleteStorageFile(file)}
                                    title="Move file to Trash"
                                    style={{ padding: '4px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    <FiTrash2 /> Trash
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Folder-Level Storage Breakdown */}
                      {folderBreakdown.length > 0 && (
                        <div className="storage-hogs-card" style={{ marginTop: '1.25rem' }}>
                          <div className="storage-hogs-header">
                            <div>
                              <div className="storage-capacity-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FiFolderPlus style={{ color: 'var(--color-primary)' }} /> Folder Storage Map
                              </div>
                              <div className="storage-capacity-subtitle">
                                Drive usage ranked by system user directory
                              </div>
                            </div>
                          </div>

                          <div className="storage-folder-list">
                            {folderBreakdown.map((f) => {
                              const fPct = used > 0 ? ((f.bytes / used) * 100).toFixed(1) : 0;
                              return (
                                <div key={f.path} className="storage-folder-item" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <div className="storage-folder-icon" style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center' }}>
                                    <FiFolder />
                                  </div>
                                  <div className="storage-folder-info" style={{ flex: 1 }}>
                                    <div className="storage-folder-name">{f.name}</div>
                                    <div className="storage-folder-count">{f.count.toLocaleString()} files</div>
                                  </div>
                                  <div className="storage-folder-bar-track" style={{ flex: 1 }}>
                                    <div className="storage-folder-bar-fill" style={{ width: `${Math.min(100, Math.max(1, fPct))}%` }} />
                                  </div>
                                  <div className="storage-folder-size" style={{ minWidth: '90px', textAlign: 'right' }}>
                                    <strong>{formatBytes(f.bytes)}</strong>
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--t-muted)', marginLeft: '4px' }}>({fPct}%)</span>
                                  </div>
                                  <button
                                    className="settings-button secondary text-only"
                                    onClick={(e) => handleShowInFolder(f.path, e)}
                                    title="Open Folder in IntelliFile Explorer"
                                    style={{ padding: '4px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                                  >
                                    <FiFolder /> Open
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Smart Space Recovery & Cache Cleaner Section */}
                      <div className="storage-maintenance-card" style={{ marginTop: '1.25rem' }}>
                        <div className="storage-maintenance-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div className="settings-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <FiZap style={{ color: '#f59e0b' }} /> Smart Space Recovery & Temp Cleaner
                            </div>
                            <div className="settings-toggle-desc">
                              Safely clean temporary system logs, thumbnail caches, and leftover installation files.
                            </div>
                          </div>
                          <button
                            className="settings-button primary"
                            onClick={handleCleanCache}
                            disabled={cleaningCache}
                            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          >
                            <FiTrash2 /> {cleaningCache ? 'Cleaning…' : 'Clean Temp Files'}
                          </button>
                        </div>

                        {cleanResult && (
                          <div className="storage-clean-banner">
                            <FiCheckCircle className="storage-clean-icon" style={{ color: 'var(--c-success)' }} />
                            <span className="storage-clean-text">
                              Space Recovery Complete: Freed <strong>{formatBytes(cleanResult.bytesCleaned)}</strong> across {cleanResult.filesCount || 0} temporary items!
                            </span>
                            <button
                              type="button"
                              className="storage-clean-dismiss"
                              onClick={() => setCleanResult(null)}
                              title="Dismiss notification"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </section>
          )}

          {/* ═══ PRIVACY ═══ */}
          {activeTab === 'privacy' && matchesSection('privacy') && (
            <section className="settings-panel">
              <div className="settings-panel-header">
                <div>
                  <div className="settings-panel-title">
                    <span className="panel-icon"><FiLock /></span> Privacy & Offline Diagnostics
                  </div>
                  <div className="settings-panel-subtitle">Control local usage logging and privacy settings</div>
                </div>
              </div>
              <div className="settings-panel-content">
                <p>IntelliFile runs 100% offline. All AI processing happens locally on your machine. No data ever leaves your device.</p>
                <div className={`setting-card-row ${telemetryEnabled ? 'is-active' : ''}`} onClick={() => persistSetting('telemetry_enabled', !telemetryEnabled)}>
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
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: '700', color: 'var(--t-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FiBarChart2 /> Local Analytics Summary (Stored Offline in SQLite)
                      </span>
                      <button
                        className="settings-button secondary"
                        style={{ fontSize: 'var(--text-xs)', padding: '0.25rem 0.5rem' }}
                        onClick={async () => {
                          if (typeof ipc?.clearAnalytics === 'function') {
                            await ipc.clearAnalytics();
                          } else {
                            await window.electron?.ipcRenderer?.invoke?.('analytics:summary');
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

              <section className="settings-panel about-story-panel">
                <div className="settings-panel-content">
                  <div className="about-hero">
                    <div className="about-hero-mark" aria-hidden="true"><FiFolder /></div>
                    <div>
                      <p className="about-eyebrow">OUR STORY</p>
                      <h3>Files should make life easier, not harder.</h3>
                      <p>
                        IntelliFile began with a problem we all experience: finding, organizing, and understanding the growing number of files we rely on every day. We set out to build more than a traditional file explorer—one that can understand your work and help manage it intelligently.
                      </p>
                    </div>
                  </div>

                  <div className="about-mission">
                    <h3>Intelligence, with your data in your control.</h3>
                    <p>
                      From natural-language search and automatic organization to meaningful versions, folder questions, reminders, and device sync, every feature has one purpose: helping your files work for you while keeping control in your hands.
                    </p>
                  </div>

                  <div className="about-team-heading">
                    <div>
                      <h3>Meet the team</h3>
                      <p>Four developers building for simplicity, intelligence, privacy, and real-world usability.</p>
                    </div>
                  </div>
                  <div className="about-team-grid">
                    {TEAM_MEMBERS.map((member) => (
                      <a
                        className="team-member-card"
                        key={member.name}
                        href={member.linkedin}
                        onClick={(event) => {
                          // Avoid Electron opening a new in-app window; let the
                          // operating system hand the profile to the default browser.
                          event.preventDefault();
                          openExternalLink(member.linkedin);
                        }}
                        aria-label={`Open ${member.name}'s LinkedIn profile in your browser`}
                      >
                        <div className="team-member-avatar" aria-hidden="true">{member.initials}</div>
                        <div className="team-member-details">
                          <h4>{member.name}</h4>
                          <span>IntelliFile Team</span>
                        </div>
                        <span className="team-link-placeholder">
                          <FiLinkedin aria-hidden="true" /> LinkedIn
                        </span>
                      </a>
                    ))}
                  </div>

                  <p className="about-closing">
                    IntelliFile is our attempt to make digital files feel less like clutter and more like something you can rely on.
                  </p>
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-header">
                  <div>
                    <div className="settings-panel-title">
                      <span className="panel-icon"><FiInfo /></span> About IntelliFile
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
              <div className="settings-apply-text" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FiAlertCircle /> You have unsaved changes</div>
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
