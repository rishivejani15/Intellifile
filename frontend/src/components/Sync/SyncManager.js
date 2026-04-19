import React, { useState, useEffect, useRef, useCallback } from 'react';
import './SyncManager.css';

// ── Icons ───────────────────────────────────────────────────────────────────

const SyncIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
    <line x1="12" y1="22.08" x2="12" y2="12"></line>
  </svg>
);

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const OpenIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CloudIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
  </svg>
);

const LinkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
);

const DisconnectIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

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
  return new Date(timestamp).toLocaleString();
};

function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Status indicator colors ──────────────────────────────────────────────

const STATUS_CONFIG = {
  idle: { color: '#636e72', label: 'Idle', dot: '⚪', cssClass: '' },
  connecting: { color: '#f39c12', label: 'Connecting', dot: '🟡', cssClass: '' },
  reconnecting: { color: '#e17055', label: 'Reconnecting', dot: '🟠', cssClass: 'pulsing' },
  waiting: { color: '#3498db', label: 'Waiting', dot: '🔵', cssClass: '' },
  syncing: { color: '#6c5ce7', label: 'Syncing', dot: '🟣', cssClass: '' },
  synced: { color: '#00b894', label: 'Connected', dot: '🟢', cssClass: '' },
  connected_p2p: { color: '#00b894', label: 'Connected (P2P)', dot: '🟢', cssClass: '' },
  connected_relay: { color: '#fdcb6e', label: 'Connected (Relay)', dot: '🟡', cssClass: '' },
  error: { color: '#e74c3c', label: 'Error', dot: '🔴', cssClass: '' },
  disconnected: { color: '#636e72', label: 'Disconnected', dot: '⚪', cssClass: '' },
};

// ═════════════════════════════════════════════════════════════════════════════
//  SyncManager Component
// ═════════════════════════════════════════════════════════════════════════════

const SyncManager = () => {
  // ── Local file state ─────────────────────────────────────────────────
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const prevFilesRef = useRef({});

  // ── Remote sync state ────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', message: 'Not connected' });
  const [syncLogs, setSyncLogs] = useState([]);
  const [pendingChanges, setPendingChanges] = useState([]);

  // ── Connection form state ────────────────────────────────────────
  const savedSettings = JSON.parse(localStorage.getItem('intellifile_sync') || '{}');
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [signalingUrl, setSignalingUrl] = useState(savedSettings.signalingUrl || 'wss://intellifile-signaling.onrender.com');
  const [sessionId, setSessionId] = useState(savedSettings.sessionId || '');
  const [isInitiator, setIsInitiator] = useState(savedSettings.isInitiator ?? true);
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'activity'

  const isConnected = ['synced', 'syncing', 'waiting', 'reconnecting', 'connected_p2p', 'connected_relay'].includes(syncStatus.status);

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
          for (const file of res.items) newMap[file.name] = { modified: file.modified, size: file.size };
          prevFilesRef.current = newMap;

          if (newNotifs.length > 0) {
            setNotifications(prev => [...newNotifs, ...prev].slice(0, 10));
          }

          const now = Date.now();
          setFiles(res.items.map(f => ({
            ...f,
            isRecent: (now - f.modified) < 60000,
            justChanged: newNotifs.some(n => n.fileName === f.name),
          })));

          if (previewFile && newNotifs.some(n => n.fileName === previewFile.name)) {
            loadPreview(previewFile);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load sync files', e);
    } finally {
      setLoading(false);
    }
  }, [previewFile]);

  // ── Subscribe to engine events ───────────────────────────────────────

  useEffect(() => {
    loadFiles();
    const interval = setInterval(loadFiles, 2000);

    const cleanups = [];

    if (window.intellifile?.onSyncStatus) {
      cleanups.push(window.intellifile.onSyncStatus((data) => {
        setSyncStatus(data);
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
        }).catch(e => console.error('Auto-connect failed:', e));
      }
    }

    return () => {
      clearInterval(interval);
      cleanups.forEach(fn => fn && fn());
    };
  }, [loadFiles]); // note: savedSettings is read outside so we just auto-connect on initial load.

  // ── Auto-dismiss notifications ───────────────────────────────────────

  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(0, -1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [notifications]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleAddFiles = async () => {
    if (!window.intellifile?.selectFilesForSync) return;
    try {
      setLoading(true);
      const res = await window.intellifile.selectFilesForSync();
      if (res.success && res.added > 0) await loadFiles();
    } catch (e) {
      console.error('Error adding files:', e);
    } finally {
      setLoading(false);
    }
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
      console.error('Error removing file:', e);
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
      // Persist settings so we can auto-reconnect next time
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
      setShowConnectPanel(false);
    } catch (e) {
      console.error('Connection failed:', e);
    }
  };

  const handleDisconnect = async () => {
    if (window.intellifile?.syncDisconnect) {
      await window.intellifile.syncDisconnect();
    }
    // Clear saved settings on manual disconnect
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

  // ── Render ───────────────────────────────────────────────────────────

  const statusCfg = STATUS_CONFIG[syncStatus.status] || STATUS_CONFIG.idle;

  return (
    <div className="sync-container">
      {/* Notification toasts */}
      <div className="sync-notifications">
        {notifications.map(notif => (
          <div
            key={notif.id}
            className={`sync-notification ${notif.type}`}
            onClick={() => dismissNotification(notif.id)}
          >
            <span className="sync-notif-icon">
              {notif.type === 'updated' ? '🔄' : '📥'}
            </span>
            <span className="sync-notif-text">{notif.message}</span>
            <span className="sync-notif-time">{formatTimeAgo(notif.time)}</span>
            <button className="sync-notif-close" onClick={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}>×</button>
          </div>
        ))}
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sync-header">
        <div className="sync-header-left">
          <h2><SyncIcon /> Cross-Device Sync</h2>
          <p>Securely synchronize files between PC and mobile via WebRTC P2P.</p>
        </div>
        <div className="sync-header-actions">
          <button className="add-files-btn" onClick={handleAddFiles}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Files
          </button>
          {isConnected ? (
            <button className="disconnect-btn" onClick={handleDisconnect}>
              <DisconnectIcon /> Disconnect
            </button>
          ) : (
            <button className="connect-btn" onClick={() => setShowConnectPanel(p => !p)}>
              <LinkIcon /> Connect
            </button>
          )}
        </div>
      </div>

      {/* ── Connection Status Bar ──────────────────────────────────────── */}
      <div className="sync-status-bar" style={{ borderLeftColor: statusCfg.color }}>
        <span className={`sync-status-dot ${statusCfg.cssClass || ''}`} style={{ background: statusCfg.color }}></span>
        <span className="sync-status-label">{statusCfg.label}</span>
        <span className="sync-status-message">{syncStatus.message}</span>
        {pendingChanges.length > 0 && (
          <span className="sync-pending-badge">{pendingChanges.length} pending</span>
        )}
      </div>

      {/* ── Connect Panel ──────────────────────────────────────────────── */}
      {showConnectPanel && (
        <div className="sync-connect-panel">
          <div className="connect-panel-header">
            <h3>Remote Sync Connection</h3>
            <button className="connect-close-btn" onClick={() => setShowConnectPanel(false)}>×</button>
          </div>
          <div className="connect-panel-body">
            <div className="connect-form-group">
              <label>Signaling Server URL</label>
              <input
                type="text"
                value={signalingUrl}
                onChange={e => setSignalingUrl(e.target.value)}
                placeholder="wss://your-signaling-server.onrender.com"
              />
            </div>
            <div className="connect-form-group">
              <label>Session Code</label>
              <div className="connect-session-row">
                <input
                  type="text"
                  value={sessionId}
                  onChange={e => setSessionId(e.target.value.toUpperCase())}
                  placeholder="Enter or generate code"
                />
                <button className="generate-code-btn" onClick={handleGenerateCode}>
                  Generate
                </button>
              </div>
            </div>
            <div className="connect-form-group">
              <label>Role</label>
              <div className="connect-role-toggle">
                <button
                  className={`role-btn ${isInitiator ? 'active' : ''}`}
                  onClick={() => setIsInitiator(true)}
                >
                  🖥️ Host (PC)
                </button>
                <button
                  className={`role-btn ${!isInitiator ? 'active' : ''}`}
                  onClick={() => setIsInitiator(false)}
                >
                  📱 Join
                </button>
              </div>
            </div>
            <button className="connect-go-btn" onClick={handleConnect} disabled={!signalingUrl.trim() || !sessionId.trim()}>
              Connect
            </button>
            <p className="connect-hint">
              Deploy signaling server once, use forever. Your files never touch it.<br /><br />
              <strong>Setup:</strong> Deploy <code>backend/signaling_server.py</code> to Render/Railway (free tier).<br />
              Paste the URL above (e.g. <code>wss://intellifile-signal.onrender.com</code>).<br />
              Enter the same session code on your mobile app and tap "Join".<br /><br />
              <em>Privacy: The signaling server only sees session codes and WebRTC negotiation (~1 KB). Zero file data.</em>
            </p>
          </div>
        </div>
      )}

      {/* ── Pending Changes Banner ─────────────────────────────────────── */}
      {pendingChanges.length > 0 && (
        <div className="sync-pending-banner">
          <div className="pending-banner-header">
            <span>📥 {pendingChanges.length} incoming change{pendingChanges.length !== 1 ? 's' : ''} from mobile</span>
            <div className="pending-banner-actions">
              <button className="pending-approve-all" onClick={handleApproveAll}>
                <CheckIcon /> Accept All
              </button>
              <button className="pending-reject-all" onClick={handleRejectAll}>
                <XIcon /> Reject All
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
                  <button className="pending-approve" onClick={() => handleApprove(change.filepath)} title="Accept">
                    <CheckIcon />
                  </button>
                  <button className="pending-reject" onClick={() => handleReject(change.filepath)} title="Reject">
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="sync-tab-bar">
        <button className={`sync-tab ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
          Files ({files.length})
        </button>
        <button className={`sync-tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
          Activity ({syncLogs.length})
        </button>
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────── */}
      <div className="sync-body">
        {activeTab === 'files' && (
          <div className={`sync-list-container ${previewFile ? 'with-preview' : ''}`}>
            {loading && files.length === 0 ? (
              <div className="sync-empty-state"><p>Loading synchronized files...</p></div>
            ) : files.length === 0 ? (
              <div className="sync-empty-state">
                <CloudIcon />
                <h3>No files yet</h3>
                <p>Click "Add Files" to stage files for sync, or connect to your mobile app to receive files.</p>
              </div>
            ) : (
              <table className="sync-table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Modified</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr
                      key={file.name}
                      className={`${file.justChanged ? 'just-changed' : ''} ${previewFile?.name === file.name ? 'selected-row' : ''}`}
                      onClick={() => handlePreviewFile(file)}
                    >
                      <td>
                        <div className="sync-file-name">
                          <span className="sync-icon">📄</span>
                          {file.name}
                          {file.justChanged && <span className="changed-badge">Changed</span>}
                        </div>
                      </td>
                      <td style={{ color: '#888' }}>{formatBytes(file.size)}</td>
                      <td>
                        <span className={`status-badge ${file.justChanged ? 'changed' : file.isRecent ? 'recent' : 'synced'}`}>
                          {file.justChanged ? '🔄 Just Updated' : file.isRecent ? '📡 Recent' : '✅ Synced'}
                        </span>
                      </td>
                      <td style={{ color: '#888' }}>{formatTimeAgo(file.modified)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="action-buttons">
                          <button className="action-btn open-btn" onClick={(e) => { e.stopPropagation(); handleOpenFile(file); }} title="Open file">
                            <OpenIcon />
                          </button>
                          <button className="action-btn delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.name); }} title="Remove from Sync">
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="sync-log-container">
            {syncLogs.length === 0 ? (
              <div className="sync-empty-state"><p>No sync activity yet. Connect to a mobile device to start syncing.</p></div>
            ) : (
              <div className="sync-log-list">
                {syncLogs.map((log, i) => {
                  const isError = log.includes('Error') || log.includes('⚠');
                  const isPending = log.includes('pending') || log.includes('Notified');
                  const isApproved = log.includes('Approved') || log.includes('Synced') || log.includes('confirmed');
                  let cls = 'log-normal';
                  if (isError) cls = 'log-error';
                  else if (isPending) cls = 'log-pending';
                  else if (isApproved) cls = 'log-approved';

                  return (
                    <div key={i} className={`sync-log-entry ${cls}`}>{log}</div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Live preview panel */}
        {previewFile && activeTab === 'files' && (
          <div className="sync-preview-panel">
            <div className="sync-preview-header">
              <div className="sync-preview-title">
                <span className="preview-icon">📄</span>
                <span className="preview-name">{previewFile.name}</span>
                <span className="preview-size">{formatBytes(previewFile.size)}</span>
              </div>
              <div className="sync-preview-actions">
                <button className="preview-action-btn" onClick={() => handleOpenFile(previewFile)} title="Open with default app">Open</button>
                <button className="preview-close-btn" onClick={() => { setPreviewFile(null); setPreviewContent(''); }}>×</button>
              </div>
            </div>
            <div className="sync-preview-content">
              {previewLoading ? (
                <div className="preview-loading">Loading content...</div>
              ) : (
                <pre className="preview-text">{previewContent}</pre>
              )}
            </div>
            <div className="sync-preview-footer">
              <span>Last modified: {formatTimeAgo(previewFile.modified)}</span>
              <span className="preview-auto-refresh">Auto-refreshing</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncManager;
