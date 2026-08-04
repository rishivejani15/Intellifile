import React, { useState, useEffect, useCallback } from 'react';
import {
  MdLock, MdLockOpen, MdVpnKey, MdOutlineVisibility, MdHistory, MdFolder,
  MdSearch, MdViewModule, MdViewList, MdFilterList, MdContentCopy, MdCheck, MdAccessTime, MdSecurity
} from 'react-icons/md';
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
    // Open IntelliFile's in-app file picker instead of native OS dialog
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
          color: '#ef4444',
          bgColor: 'rgba(239, 68, 68, 0.12)',
          borderColor: 'rgba(239, 68, 68, 0.25)',
        };
      case 'unlocked':
        return {
          label: 'Unlocked',
          icon: <MdLockOpen size={14} />,
          color: '#10b981',
          bgColor: 'rgba(16, 185, 129, 0.12)',
          borderColor: 'rgba(16, 185, 129, 0.25)',
        };
      case 'accessed':
        return {
          label: 'Accessed',
          icon: <MdOutlineVisibility size={14} />,
          color: '#0284c7',
          bgColor: 'rgba(2, 132, 199, 0.12)',
          borderColor: 'rgba(2, 132, 199, 0.25)',
        };
      case 'password_changed':
        return {
          label: 'Password Changed',
          icon: <MdVpnKey size={14} />,
          color: '#f59e0b',
          bgColor: 'rgba(245, 158, 11, 0.12)',
          borderColor: 'rgba(245, 158, 11, 0.25)',
        };
      default:
        return {
          label: typeof action === 'string' ? action.charAt(0).toUpperCase() + action.slice(1) : 'Event',
          icon: <MdHistory size={14} />,
          color: 'var(--t-secondary)',
          bgColor: 'var(--s-elev)',
          borderColor: 'var(--bo-light)',
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

  const getFileIcon = (ext) => {
    const icons = {
      '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.txt': '📄', '.md': '📝',
      '.xls': '📗', '.xlsx': '📗', '.csv': '📊', '.ppt': '📙', '.pptx': '📙',
      '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.svg': '🎨',
      '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
      '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵',
      '.zip': '🗜️', '.rar': '🗜️', '.7z': '🗜️',
      '.js': '⚡', '.ts': '💎', '.py': '🐍', '.html': '🌐', '.css': '🎨',
      '.json': '📋', '.xml': '📋', '.yaml': '📋', '.yml': '📋',
      '.exe': '⚙️', '.msi': '⚙️', '.dll': '🔧',
    };
    return icons[ext?.toLowerCase()] || '📄';
  };

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
        <div className="flm-loading">
          <div className="flm-loading-spinner" />
          <span>Loading vault…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flm-container">
      {/* Header */}
      <div className="flm-header" data-tour="vault-tools">
        <div className="flm-header-left">
          <div className="flm-header-icon-wrapper">
            <MdLock className="flm-header-icon" />
          </div>
          <div>
            <div className="flm-header-eyebrow"><MdSecurity size={14} /> PRIVATE &amp; LOCAL</div>
            <h2 className="flm-header-title">File Vault</h2>
            <div className="flm-header-subtitle">
              <span className="flm-secured-badge">
                🛡️ {Object.keys(lockedFiles).length} file{Object.keys(lockedFiles).length !== 1 ? 's' : ''} secured
              </span>
              <span className="flm-header-description">Your protected files are encrypted and managed on this device.</span>
            </div>
          </div>
        </div>
        <div className="flm-header-actions">
          <div className="flm-header-stat">
            <span className="flm-header-stat-value">{history.length}</span>
            <span className="flm-header-stat-label">security events</span>
          </div>
          <button className="flm-btn-lock-new" onClick={handleLockNewFile}>
            <MdLock size={16} /> Lock New File
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flm-tabs-container">
        <div className="flm-tabs">
          <button
            className={`flm-tab ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <MdFolder className="flm-tab-icon" />
            <span>Locked Files</span>
            <span className="flm-tab-count">{Object.keys(lockedFiles).length}</span>
          </button>
          <button
            className={`flm-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <MdHistory className="flm-tab-icon" />
            <span>History</span>
            <span className="flm-tab-count">{history.length}</span>
          </button>
        </div>
      </div>

      {/* Files Tab */}
      {activeTab === 'files' && (
        <>
          {/* Toolbar */}
          {Object.keys(lockedFiles).length > 0 && (
            <div className="flm-toolbar">
              <div className="flm-search-wrapper">
                <MdSearch className="flm-search-icon" />
                <input
                  className="flm-search-input"
                  type="text"
                  placeholder="Search locked files…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="flm-search-clear" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>
              <div className="flm-view-toggle">
                <button
                  className={`flm-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                >
                  <MdViewModule />
                </button>
                <button
                  className={`flm-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                >
                  <MdViewList />
                </button>
              </div>
            </div>
          )}

          {/* Empty State */}
          {filteredFiles.length === 0 && (
            <div className="flm-empty">
              <MdLock className="flm-empty-icon" />
              <h3 className="flm-empty-title">
                {searchQuery ? 'No matching files' : 'Your vault is empty'}
              </h3>
              <p className="flm-empty-desc">
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Lock files to encrypt them and keep them secure. Right-click any file in the explorer and select "Lock File", or click the button above.'}
              </p>
              {!searchQuery && (
                <button className="flm-btn-lock-new flm-empty-btn" onClick={handleLockNewFile}>
                  <MdLock size={16} /> Lock Your First File
                </button>
              )}
            </div>
          )}

          {/* Grid View */}
          {filteredFiles.length > 0 && viewMode === 'grid' && (
            <div className="flm-grid">
              {filteredFiles.map(([fileId, entry]) => (
                <div key={fileId} className={`flm-card ${!entry.fileExists ? 'missing' : ''}`}>
                  <div className="flm-card-icon">
                    {getFileIcon(entry.originalExt)}
                    <span className="flm-card-lock-badge"><MdLock size={10} /></span>
                  </div>
                  <div className="flm-card-info">
                    <div className="flm-card-name" title={entry.originalName}>
                      {entry.originalName}
                    </div>
                    <div className="flm-card-meta">
                      {formatFileSize(entry.originalSize)} · {formatDate(entry.lockedAt)}
                    </div>
                    {!entry.fileExists && (
                      <div className="flm-card-warning">⚠️ File missing</div>
                    )}
                  </div>
                  <div className="flm-card-actions">
                    <button
                      className="flm-card-btn flm-card-btn-unlock"
                      onClick={() => handleAccessFile(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Open file"
                    >
                      <MdOutlineVisibility />
                    </button>
                    <button
                      className="flm-card-btn flm-card-btn-unlock"
                      onClick={() => handleUnlockFile(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Unlock file"
                    >
                      <MdLockOpen />
                    </button>
                    <button
                      className="flm-card-btn flm-card-btn-password"
                      onClick={() => handleChangePassword(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Change password"
                    >
                      <MdVpnKey />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* List View */}
          {filteredFiles.length > 0 && viewMode === 'list' && (
            <div className="flm-list">
              <div className="flm-list-header">
                <span className="flm-list-col flm-list-col-name">Name</span>
                <span className="flm-list-col flm-list-col-size">Size</span>
                <span className="flm-list-col flm-list-col-type">Type</span>
                <span className="flm-list-col flm-list-col-date">Locked</span>
                <span className="flm-list-col flm-list-col-actions">Actions</span>
              </div>
              {filteredFiles.map(([fileId, entry]) => (
                <div key={fileId} className={`flm-list-row ${!entry.fileExists ? 'missing' : ''}`}>
                  <span className="flm-list-col flm-list-col-name">
                    <span className="flm-list-icon">{getFileIcon(entry.originalExt)}</span>
                    <span className="flm-list-filename" title={entry.originalPath}>
                      {entry.originalName}
                    </span>
                    {!entry.fileExists && <span className="flm-list-missing-badge">Missing</span>}
                  </span>
                  <span className="flm-list-col flm-list-col-size">
                    {formatFileSize(entry.originalSize)}
                  </span>
                  <span className="flm-list-col flm-list-col-type">
                    {entry.originalExt || '—'}
                  </span>
                  <span className="flm-list-col flm-list-col-date">
                    {formatDate(entry.lockedAt)}
                  </span>
                  <span className="flm-list-col flm-list-col-actions">
                    <button
                      className="flm-card-btn flm-card-btn-unlock"
                      onClick={() => handleAccessFile(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Open"
                    >
                      <MdOutlineVisibility />
                    </button>
                    <button
                      className="flm-card-btn flm-card-btn-unlock"
                      onClick={() => handleUnlockFile(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Unlock"
                    >
                      <MdLockOpen />
                    </button>
                    <button
                      className="flm-card-btn flm-card-btn-password"
                      onClick={() => handleChangePassword(fileId, entry)}
                      disabled={!entry.fileExists}
                      title="Change password"
                    >
                      <MdVpnKey />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="flm-history">
          <div className="flm-history-wrapper">
            {/* Stats Overview Bar */}
            <div className="flm-history-stats">
              <div className="flm-stat-card">
                <div className="flm-stat-icon flm-stat-total"><MdHistory size={18} /></div>
                <div className="flm-stat-info">
                  <span className="flm-stat-value">{historyStats.total}</span>
                  <span className="flm-stat-label">Total Events</span>
                </div>
              </div>
              <div className="flm-stat-card">
                <div className="flm-stat-icon flm-stat-locked"><MdLock size={18} /></div>
                <div className="flm-stat-info">
                  <span className="flm-stat-value">{historyStats.currentlyLocked}</span>
                  <span className="flm-stat-label">Currently Secured</span>
                </div>
              </div>
              <div className="flm-stat-card">
                <div className="flm-stat-icon flm-stat-unlocked"><MdLockOpen size={18} /></div>
                <div className="flm-stat-info">
                  <span className="flm-stat-value">{historyStats.unlocked}</span>
                  <span className="flm-stat-label">Unlocked</span>
                </div>
              </div>
              <div className="flm-stat-card">
                <div className="flm-stat-icon flm-stat-accessed"><MdOutlineVisibility size={18} /></div>
                <div className="flm-stat-info">
                  <span className="flm-stat-value">{historyStats.accessed}</span>
                  <span className="flm-stat-label">Accessed</span>
                </div>
              </div>
            </div>

            {/* Toolbar for History */}
            {history.length > 0 && (
              <div className="flm-history-toolbar">
                <div className="flm-search-wrapper">
                  <MdSearch className="flm-search-icon" />
                  <input
                    className="flm-search-input"
                    type="text"
                    placeholder="Search history by file name or path…"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                  {historySearch && (
                    <button className="flm-search-clear" onClick={() => setHistorySearch('')}>✕</button>
                  )}
                </div>

                <div className="flm-history-filter-group">
                  <MdFilterList className="flm-filter-icon" />
                  <select
                    className="flm-history-select"
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
              </div>
            )}

            {/* Empty State */}
            {filteredHistory.length === 0 && (
              <div className="flm-empty">
                <MdHistory className="flm-empty-icon" />
                <h3 className="flm-empty-title">
                  {history.length === 0 ? 'No history yet' : 'No matching activities'}
                </h3>
                <p className="flm-empty-desc">
                  {history.length === 0
                    ? 'Lock or unlock files to see activity records here.'
                    : 'Try clearing your search query or filter.'}
                </p>
                {(historySearch || historyFilter !== 'all') && (
                  <button
                    className="flm-btn-lock-new flm-empty-btn"
                    onClick={() => { setHistorySearch(''); setHistoryFilter('all'); }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            )}

            {/* History Cards List */}
            {filteredHistory.length > 0 && (
              <div className="flm-history-list">
                {filteredHistory.map((item, idx) => {
                  const badge = getActionBadge(item.action);
                  const fileName = item.originalPath?.split(/[\\/]/).pop() || 'Unknown file';
                  return (
                    <div key={idx} className="flm-history-card">
                      <div
                        className="flm-history-badge"
                        style={{
                          color: badge.color,
                          backgroundColor: badge.bgColor,
                          borderColor: badge.borderColor,
                        }}
                      >
                        {badge.icon}
                        <span>{badge.label}</span>
                      </div>

                      <div className="flm-history-details">
                        <div className="flm-history-filename" title={fileName}>
                          {fileName}
                        </div>
                        <div className="flm-history-filepath" title={item.originalPath}>
                          {item.originalPath}
                        </div>
                      </div>

                      <div className="flm-history-meta">
                        <div className="flm-history-time" title={item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}>
                          <MdAccessTime size={13} style={{ marginRight: '4px' }} />
                          {formatDate(item.timestamp)}
                        </div>

                        {item.originalPath && (
                          <button
                            className="flm-history-copy-btn"
                            onClick={() => handleCopyPath(item.originalPath, idx)}
                            title="Copy file path"
                          >
                            {copiedIndex === idx ? <MdCheck size={14} color="#10b981" /> : <MdContentCopy size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

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
