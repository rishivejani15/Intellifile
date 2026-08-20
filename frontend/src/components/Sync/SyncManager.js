import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  FiRefreshCw, FiTrash2, FiExternalLink, FiLink,
  FiCheck, FiX, FiPlus, FiSmartphone, FiMonitor, FiDownload,
  FiActivity, FiCopy, FiWifi
} from 'react-icons/fi';
import { MdFolder, MdClose, MdSearch, MdContentCopy } from 'react-icons/md';
import './SyncManager.css';
import '../FileLockManager.css';
import { showErrorToast, showToast } from '../../utils/toast';
import { getFileIcon } from '../../utils/fileUtils';
import VaultFilePicker from '../VaultFilePicker';

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatTimeAgo = (timestamp) => {
  const diff = Date.now() - timestamp;
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Status indicator configuration ──────────────────────────────────────────

const STATUS_CONFIG = {
  idle: { color: 'var(--t-muted)', label: 'Idle', dotColor: 'var(--t-muted)' },
  connecting: { color: '#f59e0b', label: 'Connecting', dotColor: '#f59e0b' },
  reconnecting: { color: '#f97316', label: 'Reconnecting', dotColor: '#f97316', pulsing: true },
  waiting: { color: '#0284c7', label: 'Waiting for Peer', dotColor: '#0284c7' },
  syncing: { color: '#8b5cf6', label: 'Syncing', dotColor: '#8b5cf6', pulsing: true },
  synced: { color: 'var(--color-primary)', label: 'Connected', dotColor: 'var(--color-primary)' },
  connected_p2p: { color: 'var(--color-primary)', label: 'Connected (P2P)', dotColor: 'var(--color-primary)' },
  connected_relay: { color: '#eab308', label: 'Connected (Relay)', dotColor: '#eab308' },
  error: { color: 'var(--c-error, #ef4444)', label: 'Error', dotColor: 'var(--c-error, #ef4444)' },
  disconnected: { color: 'var(--t-muted)', label: 'Disconnected', dotColor: 'var(--t-muted)' },
};

// ═════════════════════════════════════════════════════════════════════════════
//  SyncManager Component (Sleek Clean Tabbed Layout)
// ═════════════════════════════════════════════════════════════════════════════

const SyncManager = () => {
  // ── Local file state ─────────────────────────────────────────────────
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedLogIndex, setCopiedLogIndex] = useState(null);
  const [copiedIp, setCopiedIp] = useState(false);
  const prevFilesRef = useRef({});

  // ── Remote sync state ────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', message: 'Not connected' });
  const [syncLogs, setSyncLogs] = useState([]);
  const [pendingChanges, setPendingChanges] = useState([]);

  // ── Connection form state ────────────────────────────────────────
  const savedSettings = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('intellifile_sync') || '{}');
    } catch {
      return {};
    }
  }, []);

  const [signalingUrl, setSignalingUrl] = useState(savedSettings.signalingUrl || 'wss://intellifile-signaling.onrender.com');
  const [sessionId, setSessionId] = useState(savedSettings.sessionId || '');
  const [isInitiator, setIsInitiator] = useState(savedSettings.isInitiator ?? true);
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'devices' | 'activity'
  const [localAddress, setLocalAddress] = useState('');
  const [localAddressError, setLocalAddressError] = useState('');
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const isConnected = ['synced', 'syncing', 'waiting', 'reconnecting', 'connected_p2p', 'connected_relay'].includes(syncStatus.status);

  const qrValue = localAddress
    ? (localAddress.startsWith('http') ? localAddress : `http://${localAddress}`)
    : '';

  const loadLocalAddress = useCallback(async () => {
    try {
      if (!window.intellifile?.getLocalSyncAddress) return;
      const res = await window.intellifile.getLocalSyncAddress();
      if (res && res.success && res.address) {
        setLocalAddress(res.address);
        setLocalAddressError('');
      } else {
        setLocalAddress('');
        setLocalAddressError('Could not detect a LAN IPv4 address.');
      }
    } catch (e) {
      setLocalAddress('');
      setLocalAddressError('Failed to read LAN address.');
    }
  }, []);

  // ── Load local files ─────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    try {
      if (window.intellifile?.getSyncFiles) {
        const res = await window.intellifile.getSyncFiles();
        if (res.success) {
          const prevMap = prevFilesRef.current;
          const newNotifs = [];

          for (const file of res.items) {
            const prev = prevMap[file.name];
            if (prev) {
              if (prev.modified !== file.modified || prev.size !== file.size) {
                newNotifs.push({
                  id: Date.now() + Math.random(),
                  fileName: file.name,
                  type: 'updated',
                  message: `${file.name} was updated`,
                  time: Date.now(),
                });
              }
            } else if (Object.keys(prevMap).length > 0) {
              newNotifs.push({
                id: Date.now() + Math.random(),
                fileName: file.name,
                type: 'added',
                message: `${file.name} synced from mobile`,
                time: Date.now(),
              });
            }
          }

          const newMap = {};
          res.items.forEach(f => { newMap[f.name] = f; });
          prevFilesRef.current = newMap;

          setFiles(res.items);
          if (newNotifs.length > 0) {
            setNotifications(prev => [...newNotifs, ...prev].slice(0, 5));
          }
        }
      }
    } catch (err) {
      console.error('Error loading sync files:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load & IPC listener registration ─────────────────────────

  useEffect(() => {
    loadFiles();
    loadLocalAddress();

    const interval = setInterval(loadFiles, 2000);
    const handleNetworkChange = () => loadLocalAddress();
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);

    const cleanups = [];
    if (window.intellifile?.onSyncStatus) {
      cleanups.push(window.intellifile.onSyncStatus((status) => {
        setSyncStatus(status);
        if (status.status === 'error' && status.message) {
          showErrorToast('Sync Connection Error', status.message, 'Check your signaling server and network connection.');
        }
      }));
    }
    if (window.intellifile?.onSyncServerError) {
      cleanups.push(window.intellifile.onSyncServerError((errorMsg) => {
        showErrorToast('Sync Server Error', errorMsg, 'Please check the logs or restart the application.');
      }));
    }
    if (window.intellifile?.onSyncLog) {
      cleanups.push(window.intellifile.onSyncLog((msg) => {
        setSyncLogs(prev => [msg, ...prev].slice(0, 200));
      }));
    }
    if (window.intellifile?.onSyncFiles) {
      cleanups.push(window.intellifile.onSyncFiles(() => {
        loadFiles();
      }));
    }
    if (window.intellifile?.onSyncPending) {
      cleanups.push(window.intellifile.onSyncPending((changes) => {
        setPendingChanges(changes);
      }));
    }

    // Auto-connect if we have saved settings
    if (savedSettings.sessionId && savedSettings.signalingUrl) {
      if (window.intellifile?.syncConnect) {
        window.intellifile.syncConnect({
          signalingUrl: savedSettings.signalingUrl,
          sessionId: savedSettings.sessionId,
          isInitiator: savedSettings.isInitiator ?? true,
        }).catch(e => showErrorToast('Auto-connect failed.', e?.message || 'Could not connect to the sync server.', 'Check the signaling URL and your network connection.'));
      }
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
      cleanups.forEach(fn => fn && fn());
    };
  }, [
    loadFiles,
    loadLocalAddress,
    savedSettings.sessionId,
    savedSettings.signalingUrl,
    savedSettings.isInitiator,
  ]);

  // The guided tour opens the pairing workspace before spotlighting it.
  useEffect(() => {
    const showTourPairing = () => setActiveTab('devices');
    window.addEventListener('intellifile-tour-open-sync-pairing', showTourPairing);
    return () => window.removeEventListener('intellifile-tour-open-sync-pairing', showTourPairing);
  }, []);

  // ── Poll connected devices from server ────────────────────────────────

  useEffect(() => {
    const pollDevices = async () => {
      try {
        if (window.intellifile?.getSyncServerStatus) {
          const res = await window.intellifile.getSyncServerStatus();
          if (res && res.success && Array.isArray(res.device_ids)) {
            setConnectedDevices(res.device_ids);
            return;
          }
        }
        const host = localAddress ? (localAddress.includes(':') ? localAddress : `${localAddress}:8765`) : '127.0.0.1:8765';
        const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const res = await fetch(`http://${cleanHost}/status`);
        if (res.ok) {
          const data = await res.json();
          setConnectedDevices(data.device_ids || []);
        }
      } catch {
        // Silently fail — server might not be reachable
      }
    };
    pollDevices();
    const devicesInterval = setInterval(pollDevices, 2000);
    return () => clearInterval(devicesInterval);
  }, [localAddress]);

  // ── Auto-dismiss notifications ───────────────────────────────────────

  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(0, -1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [notifications]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleAddFiles = () => {
    setShowFilePicker(true);
  };

  const handleFilePickerSelect = async (filePath) => {
    setShowFilePicker(false);
    if (!filePath) return;
    try {
      setLoading(true);
      if (window.intellifile?.addFilesToSync) {
        const res = await window.intellifile.addFilesToSync([filePath]);
        if (res?.success && res.added > 0) {
          showToast('File added to Sync folder', { type: 'success' });
          await loadFiles();
        } else if (res?.errors?.length > 0) {
          showErrorToast('Could not add file to sync', res.errors[0]?.error || 'Failed to add file.');
        }
      } else if (window.intellifile?.selectFilesForSync) {
        const res = await window.intellifile.selectFilesForSync();
        if (res.success && res.added > 0) await loadFiles();
      }
    } catch (e) {
      showErrorToast('Could not add file.', e?.message || 'The file could not be added to the sync folder.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilePickerCancel = () => {
    setShowFilePicker(false);
  };

  const handleDeleteFile = async (fileName) => {
    if (!window.intellifile?.removeSyncFile) return;
    try {
      const res = await window.intellifile.removeSyncFile(fileName);
      if (res.success) {
        setFiles(prev => prev.filter(f => f.name !== fileName));
        if (previewFile?.name === fileName) {
          setPreviewFile(null);
          setPreviewContent('');
        }
      }
    } catch (e) {
      showErrorToast('Could not remove file.', e?.message || 'The remove operation failed.', 'Check whether the file is in use, then try again.');
    }
  };

  const handleOpenFile = (file) => {
    window.electron?.ipcRenderer?.invoke('open-file', file.path);
  };

  const loadPreview = async (file) => {
    if (!window.electron?.ipcRenderer) return;
    setPreviewLoading(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('read-file', file.path);
      setPreviewContent(result.success ? result.content : `[Could not read file: ${result.error}]`);
    } catch (e) {
      setPreviewContent(`[Error loading preview: ${e.message}]`);
    }
    setPreviewLoading(false);
  };

  const handlePreviewFile = (file) => {
    const textExts = ['.txt', '.md', '.json', '.py', '.js', '.ts', '.dart', '.html', '.css', '.xml', '.csv', '.yaml', '.yml', '.log', '.env', '.ini', '.cfg', '.sh', '.bat', '.jsx', '.tsx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (textExts.includes(ext)) {
      setPreviewFile(file);
      loadPreview(file);
    } else {
      handleOpenFile(file);
    }
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // ── Remote sync handlers ─────────────────────────────────────────────

  const handleConnect = async () => {
    if (!window.intellifile?.syncConnect) return;
    if (!signalingUrl.trim() || !sessionId.trim()) return;
    try {
      localStorage.setItem('intellifile_sync', JSON.stringify({
        signalingUrl: signalingUrl.trim(),
        sessionId: sessionId.trim(),
        isInitiator,
      }));
      await window.intellifile.syncConnect({
        signalingUrl: signalingUrl.trim(),
        sessionId: sessionId.trim(),
        isInitiator,
      });
    } catch (e) {
      showErrorToast('Connection failed.', e?.message || 'The sync session could not be created.', 'Check the signaling URL, session code, and network connection.');
    }
  };

  const handleDisconnect = async () => {
    if (window.intellifile?.syncDisconnect) {
      await window.intellifile.syncDisconnect();
    }
    localStorage.removeItem('intellifile_sync');
  };

  const handleGenerateCode = () => {
    setSessionId(generateSessionCode());
    setIsInitiator(true);
  };

  const handleApprove = async (filepath) => {
    if (window.intellifile?.syncApprove) await window.intellifile.syncApprove(filepath);
  };

  const handleReject = async (filepath) => {
    if (window.intellifile?.syncReject) await window.intellifile.syncReject(filepath);
  };

  const handleApproveAll = async () => {
    if (window.intellifile?.syncApproveAll) await window.intellifile.syncApproveAll();
  };

  const handleRejectAll = async () => {
    if (window.intellifile?.syncRejectAll) await window.intellifile.syncRejectAll();
  };

  const handleCopyLog = (text, idx) => {
    if (!text) return;
    try {
      navigator.clipboard?.writeText(text);
      setCopiedLogIndex(idx);
      setTimeout(() => setCopiedLogIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy log:', err);
    }
  };

  const handleCopyLocalIp = () => {
    if (!localAddress) return;
    try {
      navigator.clipboard?.writeText(localAddress);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    } catch (err) {
      console.error('Failed to copy IP:', err);
    }
  };

  // ── Filtered data ────────────────────────────────────────────────────

  const filteredFiles = files.filter(f => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return f.name?.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q);
  });

  const filteredLogs = syncLogs.filter(log => {
    if (!searchQuery) return true;
    return log.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const statusCfg = STATUS_CONFIG[syncStatus.status] || STATUS_CONFIG.idle;

  return (
    <div className="flm-container sync-container">
      {/* Toast Notifications */}
      {notifications.length > 0 && (
        <div className="sync-notifications">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`sync-notification ${notif.type}`}
              onClick={() => dismissNotification(notif.id)}
            >
              <span className="sync-notif-icon">
                {notif.type === 'updated' ? <FiRefreshCw size={14} /> : <FiDownload size={14} />}
              </span>
              <span className="sync-notif-text">{notif.message}</span>
              <span className="sync-notif-time">{formatTimeAgo(notif.time)}</span>
              <button
                className="sync-notif-close"
                onClick={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}
                title="Dismiss"
              >
                <MdClose size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Minimalist Top Header (matching Vault) ────────────────────── */}
      <header className="vault-header">
        <div className="vault-header-left">
          <div className="vault-icon-badge">
            <FiRefreshCw size={19} className={isConnected ? 'sync-spin-slow' : ''} />
          </div>
          <div className="vault-title-group">
            <div className="vault-title-line">
              <h2 className="vault-title">Cross-Device Sync</h2>
              <span className="vault-count-chip">
                <FiActivity size={12} />
                <span>{files.length} {files.length === 1 ? 'file' : 'files'} staged</span>
              </span>
              <span className="sync-header-status-pill">
                <span
                  className={`sync-status-dot ${statusCfg.pulsing ? 'pulsing' : ''}`}
                  style={{ background: statusCfg.dotColor }}
                />
                <span>{statusCfg.label}</span>
              </span>
            </div>
            <p className="vault-subtitle">Encrypted WebRTC peer-to-peer file synchronization</p>
          </div>
        </div>

        {/* 3 Native Tabs for Perfect Organization */}
        <div className="vault-tabs-segmented">
          <button
            className={`vault-tab-pill ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <MdFolder size={16} />
            <span>Synced Files</span>
            <span className="pill-count">{files.length}</span>
          </button>
          <button
            className={`vault-tab-pill ${activeTab === 'devices' ? 'active' : ''}`}
            onClick={() => setActiveTab('devices')}
          >
            <FiSmartphone size={16} />
            <span>Pair &amp; Devices</span>
            <span className="pill-count">{connectedDevices.length}</span>
          </button>
          <button
            className={`vault-tab-pill ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            <FiActivity size={16} />
            <span>Activity Logs</span>
            <span className="pill-count">{syncLogs.length}</span>
          </button>
        </div>

        {/* Primary Action Buttons */}
        <div className="vault-header-actions">
          {activeTab === 'files' ? (
            <button className="vault-btn-primary" onClick={handleAddFiles}>
              <FiPlus size={16} />
              <span>Add Files</span>
            </button>
          ) : activeTab === 'devices' ? (
            isConnected ? (
              <button className="vault-btn-secondary btn-danger-action" onClick={handleDisconnect}>
                <FiX size={15} />
                <span>Disconnect All</span>
              </button>
            ) : (
              <button className="vault-btn-primary" onClick={loadLocalAddress}>
                <FiRefreshCw size={15} />
                <span>Refresh LAN</span>
              </button>
            )
          ) : (
            <button className="vault-btn-secondary" onClick={() => setActiveTab('devices')}>
              <FiLink size={15} />
              <span>Pair Device</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Toolbar (on Files and Activity tabs) ───────────────────────── */}
      {activeTab !== 'devices' && (
        <div className="vault-toolbar">
          <div className="vault-search-wrapper">
            <MdSearch className="vault-search-icon" size={17} />
            <input
              className="vault-search-input"
              type="text"
              placeholder={activeTab === 'files' ? "Search staged files…" : "Search sync activity logs…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="vault-search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <MdClose size={14} />
              </button>
            )}
          </div>

          <div className="vault-toolbar-right">
            <button
              className="sync-devices-quick-btn"
              onClick={() => setActiveTab('devices')}
              title="Open Pair & Devices"
            >
              <FiSmartphone size={13} />
              <span>{connectedDevices.length} {connectedDevices.length === 1 ? 'device' : 'devices'} connected</span>
            </button>
            {pendingChanges.length > 0 && (
              <span className="summary-pending-chip">
                <FiDownload size={13} style={{ marginRight: 4 }} />
                {pendingChanges.length} pending
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Main Content Body ─────────────────────────────────────────── */}
      <div className="vault-content-body sync-content-body">
        {/* ── TAB 1: SYNCED FILES ────────────────────────────────────── */}
        {activeTab === 'files' && (
          <div className="sync-files-tab-view">
            {/* Pending Changes Banner (if mobile uploaded files) */}
            {pendingChanges.length > 0 && (
              <div className="sync-pending-banner-card vault-card">
                <div className="pending-banner-header">
                  <div className="pending-banner-title">
                    <FiDownload size={16} style={{ marginRight: 6, color: 'var(--color-primary)' }} />
                    <span>{pendingChanges.length} incoming change{pendingChanges.length !== 1 ? 's' : ''} from mobile</span>
                  </div>
                  <div className="pending-banner-actions">
                    <button className="pending-approve-all" onClick={handleApproveAll}>
                      <FiCheck size={14} /> Accept All
                    </button>
                    <button className="pending-reject-all" onClick={handleRejectAll}>
                      <FiX size={14} /> Reject All
                    </button>
                  </div>
                </div>
                <div className="pending-list">
                  {pendingChanges.map((change) => (
                    <div key={change.filepath} className="pending-item">
                      <span className="pending-filename">{change.filepath}</span>
                      <span className="pending-change-type">{change.changeType}</span>
                      <span className="pending-size">{formatBytes(change.fileSize)}</span>
                      <div className="pending-item-actions">
                        <button className="pending-approve-btn" onClick={() => handleApprove(change.filepath)} title="Accept">
                          <FiCheck size={14} />
                        </button>
                        <button className="pending-reject-btn" onClick={() => handleReject(change.filepath)} title="Reject">
                          <FiX size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading && files.length === 0 ? (
              <div className="vault-loading-state">
                <div className="vault-spinner" />
                <span>Loading sync files…</span>
              </div>
            ) : filteredFiles.length === 0 ? (
              /* Centered Empty State */
              <div className="vault-empty-state">
                <div className="sync-transfer-visual" aria-hidden="true">
                  <div className="sync-transfer-node sync-transfer-node--desktop"><FiMonitor size={24} /></div>
                  <div className="sync-transfer-track"><span className="sync-transfer-file"><MdFolder size={18} /></span></div>
                  <div className="sync-transfer-node sync-transfer-node--phone"><FiSmartphone size={24} /></div>
                </div>
                <h3 className="empty-title">
                  {searchQuery ? 'No matching staged files' : 'No files staged for sync'}
                </h3>
                <p className="empty-desc">
                  {searchQuery
                    ? 'No staged files match your search keywords.'
                    : 'Stage files here to automatically synchronize them in real time with your connected mobile devices.'}
                </p>
                {!searchQuery && (
                  <div className="empty-action-group">
                    <button className="vault-btn-primary vault-empty-action-btn" onClick={handleAddFiles}>
                      <FiPlus size={16} /> Stage Files for Sync
                    </button>
                    <button className="vault-btn-secondary vault-empty-action-btn" onClick={() => setActiveTab('devices')}>
                      <FiSmartphone size={16} /> Connect Mobile Device
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="vault-table-container">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th className="col-name">File Name</th>
                      <th className="col-size">Size</th>
                      <th className="col-status">Status</th>
                      <th className="col-date">Modified</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((file) => (
                      <tr
                        key={file.name}
                        className={`vault-table-row ${previewFile?.name === file.name ? 'selected-row' : ''}`}
                        onClick={() => handlePreviewFile(file)}
                      >
                        <td className="col-name">
                          <div className="vault-table-file-cell">
                            <span className="vault-table-icon">
                              {getFileIcon(file)}
                            </span>
                            <span className="vault-table-filename" title={file.name}>
                              {file.name}
                            </span>
                            {file.justChanged && <span className="vault-status-pill status-secure" style={{ fontSize: 10 }}>Updated</span>}
                          </div>
                        </td>
                        <td className="col-size">{formatBytes(file.size)}</td>
                        <td className="col-status">
                          {file.justChanged ? (
                            <span className="vault-status-pill status-secure">
                              <FiRefreshCw size={11} /> Just Updated
                            </span>
                          ) : file.isRecent ? (
                            <span className="vault-status-pill" style={{ background: 'rgba(2, 132, 199, 0.12)', color: 'var(--c-info, #0284c7)' }}>
                              <FiActivity size={11} /> Recent
                            </span>
                          ) : (
                            <span className="vault-status-pill status-secure">
                              <FiCheck size={11} /> Synced
                            </span>
                          )}
                        </td>
                        <td className="col-date">{formatTimeAgo(file.modified)}</td>
                        <td className="col-actions">
                          <div className="vault-row-actions">
                            <button
                              className="vault-row-btn"
                              onClick={(e) => { e.stopPropagation(); handleOpenFile(file); }}
                              title="Open file"
                            >
                              <FiExternalLink size={14} />
                            </button>
                            <button
                              className="vault-row-btn btn-danger"
                              onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.name); }}
                              title="Remove file"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Live Preview Drawer */}
            {previewFile && (
              <div className="sync-preview-drawer vault-card">
                <div className="sync-preview-header">
                  <div className="sync-preview-title">
                    <span className="preview-icon">{getFileIcon(previewFile)}</span>
                    <span className="preview-name">{previewFile.name}</span>
                    <span className="preview-size">{formatBytes(previewFile.size)}</span>
                  </div>
                  <div className="sync-preview-actions">
                    <button className="preview-action-btn" onClick={() => handleOpenFile(previewFile)}>Open</button>
                    <button className="connect-close-btn" onClick={() => { setPreviewFile(null); setPreviewContent(''); }}><MdClose size={16} /></button>
                  </div>
                </div>
                <div className="sync-preview-content">
                  {previewLoading ? (
                    <div className="preview-loading">Loading content…</div>
                  ) : (
                    <pre className="preview-text">{previewContent}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: PAIR & DEVICES ──────────────────────────────────── */}
        {activeTab === 'devices' && (
          <div className="sync-devices-tab-view">
            <div className="sync-devices-layout-grid" data-tour="sync-overview">
              {/* Left Card: High-Impact LAN Wi-Fi QR Code */}
              <div className="vault-card sync-qr-showcase-card" data-tour="sync-qr-code">
                <div className="showcase-header">
                  <div className="showcase-title-row">
                    <FiWifi className="showcase-icon" size={20} />
                    <span className="showcase-title">LAN Wi-Fi Instant Pair</span>
                  </div>
                  <span className="showcase-tag">Direct P2P</span>
                </div>

                <div className="showcase-qr-stage">
                  <div className="showcase-qr-box">
                    {localAddress ? (
                      <QRCodeCanvas value={qrValue} size={200} bgColor="#ffffff" fgColor="#09090b" includeMargin={true} level="H" />
                    ) : (
                      <div className="sync-qr-placeholder">QR unavailable</div>
                    )}
                  </div>
                </div>

                <div className="showcase-info-box">
                  <div className="showcase-ip-row">
                    <span className="ip-label">LAN Address:</span>
                    <span className={`ip-val ${!localAddress && localAddressError ? 'ip-val-error' : ''}`}>
                      {localAddress || localAddressError || 'Detecting address…'}
                    </span>
                    {localAddress && (
                      <button className="ip-copy-btn" onClick={handleCopyLocalIp} title="Copy Address">
                        {copiedIp ? <FiCheck size={13} color="var(--color-primary)" /> : <FiCopy size={13} />}
                      </button>
                    )}
                  </div>
                  <p className="showcase-instruction">
                    Open IntelliFile on your mobile device connected to the same Wi-Fi network and scan the QR code above.
                  </p>
                </div>
              </div>

              {/* Right Column: Connected Devices & Remote WebRTC */}
              <div className="sync-pairing-side-col">
                {/* Active Devices */}
                <div className="vault-card sync-paired-devices-card">
                  <div className="sync-card-header">
                    <span className="sync-card-title">
                      <FiSmartphone size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      Connected Devices
                    </span>
                    <span className="vault-count-chip">{connectedDevices.length}</span>
                  </div>

                  {connectedDevices.length > 0 ? (
                    <div className="sync-devices-list">
                      {connectedDevices.map((deviceId, idx) => (
                        <div key={deviceId} className="sync-device-item">
                          <span className="sync-device-status-dot" />
                          <div className="sync-device-details">
                            <span className="sync-device-name">Mobile Device {idx + 1}</span>
                            <span className="sync-device-id">ID: {deviceId.substring(0, 10)}…</span>
                          </div>
                          <span className="sync-device-active-badge">Active</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sync-devices-empty-state">
                      <FiSmartphone size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                      <p>No mobile devices currently paired.</p>
                      <span>Scan the QR code to connect your first phone or tablet.</span>
                    </div>
                  )}
                </div>

                {/* Remote WebRTC Pairing Option */}
                <div className="vault-card sync-remote-card">
                  <div className="sync-card-header">
                    <span className="sync-card-title">
                      <FiLink size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      Remote WebRTC Pairing
                    </span>
                    <span className={`sync-status-pill ${isConnected ? 'status-secure' : ''}`} style={{ fontSize: 10 }}>
                      {statusCfg.label}
                    </span>
                  </div>

                  <div className="connect-form-grid">
                    <div className="connect-form-group">
                      <label className="connect-label">Signaling Server URL</label>
                      <input
                        type="text"
                        className="connect-input"
                        value={signalingUrl}
                        onChange={e => setSignalingUrl(e.target.value)}
                        placeholder="wss://your-signaling-server.onrender.com"
                      />
                    </div>
                    <div className="connect-form-group">
                      <label className="connect-label">Session Code</label>
                      <div className="connect-session-row">
                        <input
                          type="text"
                          className="connect-input"
                          value={sessionId}
                          onChange={e => setSessionId(e.target.value.toUpperCase())}
                          placeholder="Enter code"
                        />
                        <button className="generate-code-btn" onClick={handleGenerateCode}>
                          Generate
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="connect-role-row">
                    <label className="connect-label">Role:</label>
                    <div className="connect-role-toggle">
                      <button
                        className={`role-btn ${isInitiator ? 'active' : ''}`}
                        onClick={() => setIsInitiator(true)}
                      >
                        <FiMonitor size={14} style={{ marginRight: 4 }} /> Host (PC)
                      </button>
                      <button
                        className={`role-btn ${!isInitiator ? 'active' : ''}`}
                        onClick={() => setIsInitiator(false)}
                      >
                        <FiSmartphone size={14} style={{ marginRight: 4 }} /> Join
                      </button>
                    </div>
                  </div>

                  <div className="connect-actions-row">
                    {isConnected ? (
                      <button className="vault-btn-secondary btn-danger-action" onClick={handleDisconnect}>
                        <FiX size={15} /> Disconnect Remote
                      </button>
                    ) : (
                      <button
                        className="vault-btn-primary"
                        onClick={handleConnect}
                        disabled={!signalingUrl.trim() || !sessionId.trim()}
                      >
                        Connect Session
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: ACTIVITY LOGS ───────────────────────────────────── */}
        {activeTab === 'activity' && (
          <div className="vault-history-wrapper">
            <div className="vault-stats-strip">
              <div className="vault-stat-item">
                <span className="stat-num">{syncLogs.length}</span>
                <span className="stat-lbl">Total Events</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-emerald">{files.length}</span>
                <span className="stat-lbl">Staged Files</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-blue">{connectedDevices.length}</span>
                <span className="stat-lbl">Connected Devices</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-purple">{pendingChanges.length}</span>
                <span className="stat-lbl">Pending Changes</span>
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="vault-empty-state">
                <div className="empty-icon-wrap">
                  <FiActivity size={36} />
                </div>
                <h3 className="empty-title">
                  {syncLogs.length === 0 ? 'No sync activity recorded' : 'No matching logs found'}
                </h3>
                <p className="empty-desc">
                  {syncLogs.length === 0
                    ? 'Connect to a mobile device or stage files to start logging sync operations in real-time.'
                    : 'Try clearing your search query to see all logs.'}
                </p>
              </div>
            ) : (
              <div className="vault-timeline">
                {filteredLogs.map((log, idx) => {
                  const isError = log.includes('Error') || log.includes('failed');
                  const isPending = log.includes('pending') || log.includes('Notified');
                  const isApproved = log.includes('Approved') || log.includes('Synced') || log.includes('confirmed');

                  const color = isError
                    ? 'var(--c-error, #ef4444)'
                    : isPending
                      ? 'var(--c-warning, #f59e0b)'
                      : isApproved
                        ? 'var(--color-primary, #10b981)'
                        : 'var(--c-info, #0284c7)';
                  const bgColor = isError
                    ? 'var(--c-error-soft, rgba(239, 68, 68, 0.12))'
                    : isPending
                      ? 'var(--c-warning-soft, rgba(245, 158, 11, 0.12))'
                      : isApproved
                        ? 'var(--c-brand-soft, rgba(16, 185, 129, 0.12))'
                        : 'rgba(2, 132, 199, 0.12)';

                  return (
                    <div key={idx} className="vault-timeline-card">
                      <div className="timeline-badge" style={{ color, backgroundColor: bgColor }}>
                        <FiActivity size={13} />
                        <span className="timeline-badge-text">
                          {isError ? 'Error' : isPending ? 'Pending' : isApproved ? 'Synced' : 'Event'}
                        </span>
                      </div>

                      <div className="timeline-info">
                        <div className="timeline-filename" title={log}>
                          {log}
                        </div>
                      </div>

                      <div className="timeline-meta">
                        <button
                          className="timeline-copy-btn"
                          onClick={() => handleCopyLog(log, idx)}
                          title="Copy log entry"
                        >
                          {copiedLogIndex === idx ? <FiCheck size={13} color="var(--color-primary)" /> : <MdContentCopy size={13} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* In-app File Picker Modal (reused VaultFilePicker) */}
      {showFilePicker && (
        <VaultFilePicker
          onSelect={handleFilePickerSelect}
          onCancel={handleFilePickerCancel}
        />
      )}
    </div>
  );
};

export default SyncManager;
