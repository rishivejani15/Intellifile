import React, { useState, useEffect, useCallback } from 'react';
import {
  MdLock, MdLockOpen, MdVpnKey, MdOutlineVisibility, MdHistory, MdFolder,
  MdSearch, MdViewModule, MdViewList, MdFilterList, MdContentCopy, MdCheck,
  MdAccessTime, MdSecurity, MdEdit, MdDelete, MdClose, MdWarningAmber,
  MdAdd
} from 'react-icons/md';
import { getFileIcon } from '../utils/fileUtils';
import FileLockModal from './FileLockModal';
import VaultFilePicker from './VaultFilePicker';
import './FileLockManager.css';

function FileLockManager() {
  const [lockedFiles, setLockedFiles] = useState({});
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'history'

  // History tab search and filter state
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [copiedIndex, setCopiedIndex] = useState(null);

  // Lock modal state
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockModalMode, setLockModalMode] = useState('lock');
  const [lockModalFile, setLockModalFile] = useState(null);

  // In-app file picker state
  const [showFilePicker, setShowFilePicker] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [filesResult, historyResult] = await Promise.all([
        window.intellifile?.fileLock?.getLockedFiles?.(),
        window.intellifile?.fileLock?.getHistory?.(),
      ]);

      if (filesResult?.success) {
        setLockedFiles(filesResult.files || {});
      }
      if (historyResult?.success) {
        setHistory(historyResult.history || []);
      }
    } catch (err) {
      console.error('[FileLockManager] Refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const handleVaultUpdated = () => refresh();
    window.addEventListener('vault-updated', handleVaultUpdated);
    return () => window.removeEventListener('vault-updated', handleVaultUpdated);
  }, [activeTab, refresh]);

  const handleLockNewFile = () => {
    setShowFilePicker(true);
  };

  const handleFilePickerSelect = (filePath) => {
    setShowFilePicker(false);
    if (!filePath) return;
    const fileName = filePath.split(/[\\/]/).pop();
    setLockModalFile({ path: filePath, name: fileName });
    setLockModalMode('lock');
    setShowLockModal(true);
  };

  const handleFilePickerCancel = () => {
    setShowFilePicker(false);
  };

  const handleUnlockFile = (fileId, entry) => {
    setLockModalFile({
      fileId,
      name: entry.originalName,
      path: entry.encryptedPath,
      size: entry.originalSize,
      originalName: entry.originalName,
    });
    setLockModalMode('unlock');
    setShowLockModal(true);
  };

  const handleAccessFile = (fileId, entry) => {
    setLockModalFile({
      fileId,
      name: entry.originalName,
      path: entry.encryptedPath,
      size: entry.originalSize,
      originalName: entry.originalName,
    });
    setLockModalMode('access');
    setShowLockModal(true);
  };

  const handleChangePassword = (fileId, entry) => {
    setLockModalFile({
      fileId,
      name: entry.originalName,
      path: entry.encryptedPath,
      size: entry.originalSize,
      originalName: entry.originalName,
    });
    setLockModalMode('changePassword');
    setShowLockModal(true);
  };

  const handleRenameLockedFile = (fileId, entry) => {
    setLockModalFile({
      fileId,
      name: entry.originalName,
      path: entry.encryptedPath,
      size: entry.originalSize,
      originalName: entry.originalName,
    });
    setLockModalMode('renameLocked');
    setShowLockModal(true);
  };

  const handleDeleteLockedFile = (fileId, entry) => {
    setLockModalFile({
      fileId,
      name: entry.originalName,
      path: entry.encryptedPath,
      size: entry.originalSize,
      originalName: entry.originalName,
    });
    setLockModalMode('deleteLocked');
    setShowLockModal(true);
  };

  const handleLockModalSuccess = () => {
    refresh();
  };

  const handleCopyPath = (path, idx) => {
    if (!path) return;
    try {
      navigator.clipboard?.writeText(path);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (e) {
      console.error('Failed to copy path:', e);
    }
  };

  const getActionBadge = (action) => {
    switch (action) {
      case 'locked':
        return {
          label: 'Locked',
          icon: <MdLock size={14} />,
          color: 'var(--c-error, #ef4444)',
          bgColor: 'var(--c-error-soft, rgba(239, 68, 68, 0.12))',
        };
      case 'unlocked':
        return {
          label: 'Unlocked',
          icon: <MdLockOpen size={14} />,
          color: 'var(--color-primary, #10b981)',
          bgColor: 'var(--c-brand-soft, rgba(16, 185, 129, 0.12))',
        };
      case 'accessed':
        return {
          label: 'Accessed',
          icon: <MdOutlineVisibility size={14} />,
          color: 'var(--c-info, #0284c7)',
          bgColor: 'rgba(2, 132, 199, 0.12)',
        };
      case 'password_changed':
        return {
          label: 'Password Changed',
          icon: <MdVpnKey size={14} />,
          color: 'var(--c-warning, #f59e0b)',
          bgColor: 'var(--c-warning-soft, rgba(245, 158, 11, 0.12))',
        };
      default:
        return {
          label: typeof action === 'string' ? action.charAt(0).toUpperCase() + action.slice(1) : 'Event',
          icon: <MdHistory size={14} />,
          color: 'var(--t-secondary)',
          bgColor: 'var(--s-elev)',
        };
    }
  };

  const historyStats = {
    total: history.length,
    currentlyLocked: Object.keys(lockedFiles).length,
    unlocked: history.filter(h => h.action === 'unlocked').length,
    accessed: history.filter(h => h.action === 'accessed').length,
  };

  const filteredHistory = history.filter((item) => {
    if (historyFilter !== 'all' && item.action !== historyFilter) return false;
    if (!historySearch) return true;
    const q = historySearch.toLowerCase();
    const fileName = item.originalPath?.split(/[\\/]/).pop() || '';
    return (
      fileName.toLowerCase().includes(q) ||
      item.originalPath?.toLowerCase().includes(q)
    );
  });

  const filteredFiles = Object.entries(lockedFiles).filter(([, entry]) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.originalName?.toLowerCase().includes(q) ||
      entry.originalPath?.toLowerCase().includes(q) ||
      entry.originalExt?.toLowerCase().includes(q)
    );
  });

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;

    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  if (loading) {
    return (
      <div className="flm-container">
        <div className="vault-loading-state">
          <div className="vault-spinner" />
          <span>Loading vault…</span>
        </div>
      </div>
    );
  }

  const lockedCount = Object.keys(lockedFiles).length;

  return (
    <div className="flm-container">
      {/* Minimalist Top Header (matching Explorer & Settings) */}
      <header className="vault-header" data-tour="vault-tools">
        <div className="vault-header-left">
          <div className="vault-icon-badge vault-icon-badge--security">
            <MdSecurity size={20} />
          </div>
          <div className="vault-title-group">
            <div className="vault-title-line">
              <h2 className="vault-title">File Vault</h2>
              <span className="vault-count-chip">
                <MdLock size={12} />
                <span>{lockedCount} {lockedCount === 1 ? 'file' : 'files'}</span>
              </span>
            </div>
            <p className="vault-subtitle">Local AES-256 encrypted file protection</p>
          </div>
        </div>

        {/* Segmented Native Tabs */}
        <div className="vault-tabs-segmented">
          <button
            className={`vault-tab-pill ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <MdFolder size={16} />
            <span>Locked Files</span>
            <span className="pill-count">{lockedCount}</span>
          </button>
          <button
            className={`vault-tab-pill ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <MdHistory size={16} />
            <span>Activity Log</span>
            <span className="pill-count">{history.length}</span>
          </button>
        </div>

        {/* Primary Header Action */}
        <div className="vault-header-actions">
          <button className="vault-btn-primary" onClick={handleLockNewFile}>
            <MdAdd size={17} />
            <span>Lock File</span>
          </button>
        </div>
      </header>

      {/* Minimalist Filter & Search Toolbar */}
      <div className="vault-toolbar">
        <div className="vault-search-wrapper">
          <MdSearch className="vault-search-icon" size={17} />
          <input
            className="vault-search-input"
            type="text"
            placeholder={activeTab === 'files' ? "Search locked files…" : "Search activity by name or path…"}
            value={activeTab === 'files' ? searchQuery : historySearch}
            onChange={(e) => activeTab === 'files' ? setSearchQuery(e.target.value) : setHistorySearch(e.target.value)}
          />
          {(activeTab === 'files' ? searchQuery : historySearch) && (
            <button
              className="vault-search-clear-btn"
              onClick={() => activeTab === 'files' ? setSearchQuery('') : setHistorySearch('')}
              title="Clear search"
            >
              <MdClose size={14} />
            </button>
          )}
        </div>

        {activeTab === 'files' ? (
          <div className="vault-view-toggle">
            <button
              className={`vault-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <MdViewModule size={18} />
            </button>
            <button
              className={`vault-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <MdViewList size={18} />
            </button>
          </div>
        ) : (
          <div className="vault-filter-dropdown">
            <MdFilterList size={16} className="filter-icon" />
            <select
              className="vault-select"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
            >
              <option value="all">All Actions</option>
              <option value="locked">Locked</option>
              <option value="unlocked">Unlocked</option>
              <option value="accessed">Accessed</option>
              <option value="password_changed">Password Changed</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Content Body */}
      <div className="vault-content-body">
        {/* ── Files Tab ──────────────────────────────────────────────── */}
        {activeTab === 'files' && (
          <>
            {filteredFiles.length === 0 ? (
              <div className="vault-empty-state">
                <div className="vault-lock-visual" aria-hidden="true">
                  <span className="vault-lock-halo" />
                  <span className="vault-lock-spark vault-lock-spark--one" />
                  <span className="vault-lock-spark vault-lock-spark--two" />
                  <span className="vault-lock-document">
                    <span className="vault-lock-document-fold" />
                    <span className="vault-lock-document-line vault-lock-document-line--one" />
                    <span className="vault-lock-document-line vault-lock-document-line--two" />
                  </span>
                  <span className="vault-padlock">
                    <span className="vault-padlock-shackle" />
                    <span className="vault-padlock-body"><MdLock size={20} /></span>
                  </span>
                </div>
                <h3 className="empty-title">
                  {searchQuery ? 'No matching files found' : 'Your vault is empty'}
                </h3>
                <p className="empty-desc">
                  {searchQuery
                    ? 'No encrypted files match your search query.'
                    : 'Encrypted files are protected locally with your password and recovery key. Click below to add files to your vault.'}
                </p>
                {!searchQuery && (
                  <button className="vault-btn-primary vault-empty-action-btn" onClick={handleLockNewFile}>
                    <MdAdd size={16} /> Lock Your First File
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              /* Grid View */
              <div className="vault-grid">
                {filteredFiles.map(([fileId, entry]) => (
                  <div key={fileId} className={`vault-card ${!entry.fileExists ? 'is-missing' : ''}`}>
                    <div className="vault-card-top">
                      <div className="vault-card-icon">
                        {getFileIcon({ ext: entry.originalExt, name: entry.originalName, type: 'file' })}
                        <span className="vault-card-lock-badge" title="Encrypted">
                          <MdLock size={10} />
                        </span>
                      </div>
                      {entry.fileExists ? (
                        <span className="vault-status-pill status-secure">
                          <MdSecurity size={11} /> Secured
                        </span>
                      ) : (
                        <span className="vault-status-pill status-missing">
                          <MdWarningAmber size={11} /> Missing
                        </span>
                      )}
                    </div>

                    <div className="vault-card-info">
                      <div className="vault-card-title" title={entry.originalName}>
                        {entry.originalName}
                      </div>
                      <div className="vault-card-meta">
                        <span>{formatFileSize(entry.originalSize)}</span>
                        <span className="meta-dot">•</span>
                        <span>{formatDate(entry.lockedAt)}</span>
                      </div>
                    </div>

                    <div className="vault-card-actions">
                      <button
                        className="vault-card-btn"
                        onClick={() => handleAccessFile(fileId, entry)}
                        disabled={!entry.fileExists}
                        title="Open file"
                      >
                        <MdOutlineVisibility size={15} />
                      </button>
                      <button
                        className="vault-card-btn"
                        onClick={() => handleUnlockFile(fileId, entry)}
                        disabled={!entry.fileExists}
                        title="Unlock file"
                      >
                        <MdLockOpen size={15} />
                      </button>
                      <button
                        className="vault-card-btn"
                        onClick={() => handleChangePassword(fileId, entry)}
                        disabled={!entry.fileExists}
                        title="Change password"
                      >
                        <MdVpnKey size={15} />
                      </button>
                      <button
                        className="vault-card-btn"
                        onClick={() => handleRenameLockedFile(fileId, entry)}
                        disabled={!entry.fileExists}
                        title="Rename file"
                      >
                        <MdEdit size={15} />
                      </button>
                      <button
                        className="vault-card-btn btn-danger"
                        onClick={() => handleDeleteLockedFile(fileId, entry)}
                        disabled={!entry.fileExists}
                        title="Delete file"
                      >
                        <MdDelete size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* List / Table View (matching File Explorer Details) */
              <div className="vault-table-container">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th className="col-name">Name</th>
                      <th className="col-path">Original Location</th>
                      <th className="col-size">Size</th>
                      <th className="col-status">Status</th>
                      <th className="col-date">Locked</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map(([fileId, entry]) => (
                      <tr key={fileId} className={`vault-table-row ${!entry.fileExists ? 'is-missing' : ''}`}>
                        <td className="col-name">
                          <div className="vault-table-file-cell">
                            <span className="vault-table-icon">
                              {getFileIcon({ ext: entry.originalExt, name: entry.originalName, type: 'file' })}
                            </span>
                            <span className="vault-table-filename" title={entry.originalName}>
                              {entry.originalName}
                            </span>
                          </div>
                        </td>
                        <td className="col-path">
                          <span className="vault-table-path-text" title={entry.originalPath}>
                            {entry.originalPath || '—'}
                          </span>
                        </td>
                        <td className="col-size">{formatFileSize(entry.originalSize)}</td>
                        <td className="col-status">
                          {entry.fileExists ? (
                            <span className="vault-status-pill status-secure">
                              <MdSecurity size={11} /> Secured
                            </span>
                          ) : (
                            <span className="vault-status-pill status-missing">
                              <MdWarningAmber size={11} /> Missing
                            </span>
                          )}
                        </td>
                        <td className="col-date">{formatDate(entry.lockedAt)}</td>
                        <td className="col-actions">
                          <div className="vault-row-actions">
                            <button
                              className="vault-row-btn"
                              onClick={() => handleAccessFile(fileId, entry)}
                              disabled={!entry.fileExists}
                              title="Open file"
                            >
                              <MdOutlineVisibility size={14} />
                            </button>
                            <button
                              className="vault-row-btn"
                              onClick={() => handleUnlockFile(fileId, entry)}
                              disabled={!entry.fileExists}
                              title="Unlock file"
                            >
                              <MdLockOpen size={14} />
                            </button>
                            <button
                              className="vault-row-btn"
                              onClick={() => handleChangePassword(fileId, entry)}
                              disabled={!entry.fileExists}
                              title="Change password"
                            >
                              <MdVpnKey size={14} />
                            </button>
                            <button
                              className="vault-row-btn"
                              onClick={() => handleRenameLockedFile(fileId, entry)}
                              disabled={!entry.fileExists}
                              title="Rename file"
                            >
                              <MdEdit size={14} />
                            </button>
                            <button
                              className="vault-row-btn btn-danger"
                              onClick={() => handleDeleteLockedFile(fileId, entry)}
                              disabled={!entry.fileExists}
                              title="Delete file"
                            >
                              <MdDelete size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── Activity History Tab ───────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="vault-history-wrapper">
            {/* Minimalist Summary Metric Strip */}
            <div className="vault-stats-strip">
              <div className="vault-stat-item">
                <span className="stat-num">{historyStats.total}</span>
                <span className="stat-lbl">Total Events</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-emerald">{historyStats.currentlyLocked}</span>
                <span className="stat-lbl">Secured Files</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-blue">{historyStats.unlocked}</span>
                <span className="stat-lbl">Unlocked</span>
              </div>
              <div className="vault-stat-item">
                <span className="stat-num color-purple">{historyStats.accessed}</span>
                <span className="stat-lbl">Accessed</span>
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="vault-empty-state">
                <div className="empty-icon-wrap">
                  <MdHistory size={36} />
                </div>
                <h3 className="empty-title">
                  {history.length === 0 ? 'No activity records yet' : 'No matching activities'}
                </h3>
                <p className="empty-desc">
                  {history.length === 0
                    ? 'Security events like lock, unlock, and password changes will be logged here.'
                    : 'Try clearing your search query or filter.'}
                </p>
                {(historySearch || historyFilter !== 'all') && (
                  <button
                    className="vault-btn-primary vault-empty-action-btn"
                    onClick={() => { setHistorySearch(''); setHistoryFilter('all'); }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="vault-timeline">
                {filteredHistory.map((item, idx) => {
                  const badge = getActionBadge(item.action);
                  const fileName = item.originalPath?.split(/[\\/]/).pop() || 'Unknown file';
                  return (
                    <div key={idx} className="vault-timeline-card">
                      <div
                        className="timeline-badge"
                        style={{ color: badge.color, backgroundColor: badge.bgColor }}
                      >
                        {badge.icon}
                        <span className="timeline-badge-text">{badge.label}</span>
                      </div>

                      <div className="timeline-info">
                        <div className="timeline-filename" title={fileName}>
                          {fileName}
                        </div>
                        <div className="timeline-filepath" title={item.originalPath}>
                          {item.originalPath}
                        </div>
                      </div>

                      <div className="timeline-meta">
                        <span className="timeline-timestamp">
                          <MdAccessTime size={13} style={{ marginRight: 4 }} />
                          {formatDate(item.timestamp)}
                        </span>
                        {item.originalPath && (
                          <button
                            className="timeline-copy-btn"
                            onClick={() => handleCopyPath(item.originalPath, idx)}
                            title="Copy path"
                          >
                            {copiedIndex === idx ? <MdCheck size={14} color="var(--color-primary)" /> : <MdContentCopy size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lock Modal */}
      <FileLockModal
        visible={showLockModal}
        mode={lockModalMode}
        file={lockModalFile}
        onClose={() => setShowLockModal(false)}
        onSuccess={handleLockModalSuccess}
      />

      {/* In-app File Picker */}
      {showFilePicker && (
        <VaultFilePicker
          onSelect={handleFilePickerSelect}
          onCancel={handleFilePickerCancel}
        />
      )}
    </div>
  );
}

export default FileLockManager;
