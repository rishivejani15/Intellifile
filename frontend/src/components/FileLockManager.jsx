import React, { useState, useEffect, useCallback } from 'react';
import { MdLock, MdLockOpen, MdVpnKey, MdOutlineVisibility, MdHistory, MdFolder, MdSearch, MdViewModule, MdViewList } from 'react-icons/md';
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
  }, [refresh]);

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

  const getActionLabel = (action) => {
    switch (action) {
      case 'locked': return 'Locked';
      case 'unlocked': return 'Unlocked';
      case 'password_changed': return 'Password Changed';
      case 'accessed': return 'Accessed';
      default: return typeof action === 'string' ? action.charAt(0).toUpperCase() + action.slice(1) : action;
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'locked': return 'var(--color-danger)';
      case 'unlocked': return 'var(--color-success)';
      case 'password_changed': return 'var(--color-secondary)';
      case 'accessed': return '#00a8ff';
      default: return 'var(--t-muted)';
    }
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
      <div className="flm-header">
        <div className="flm-header-left">
          <MdLock className="flm-header-icon" />
          <div>
            <h2 className="flm-header-title">File Vault</h2>
            <p className="flm-header-subtitle">
              {Object.keys(lockedFiles).length} file{Object.keys(lockedFiles).length !== 1 ? 's' : ''} secured
            </p>
          </div>
        </div>
        <div className="flm-header-actions">
          <button className="flm-btn-lock-new" onClick={handleLockNewFile}>
            <MdLock size={16} /> Lock New File
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flm-tabs">
        <button
          className={`flm-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <MdFolder style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Locked Files
        </button>
        <button
          className={`flm-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <MdHistory style={{ marginRight: '6px', verticalAlign: 'middle' }} /> History
        </button>
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
          {history.length === 0 ? (
            <div className="flm-empty">
              <MdHistory className="flm-empty-icon" />
              <h3 className="flm-empty-title">No history yet</h3>
              <p className="flm-empty-desc">Lock or unlock files to see activity here.</p>
            </div>
          ) : (
            <div className="flm-timeline">
              {history.map((item, idx) => (
                <div key={idx} className="flm-timeline-item">
                  <div
                    className="flm-timeline-dot"
                    style={{ backgroundColor: getActionColor(item.action) }}
                  />
                  <div className="flm-timeline-content">
                    <div className="flm-timeline-action">
                      {getActionLabel(item.action)}
                    </div>
                    <div className="flm-timeline-file" title={item.originalPath}>
                      {item.originalPath?.split(/[\\/]/).pop() || 'Unknown file'}
                    </div>
                    <div className="flm-timeline-path" title={item.originalPath}>
                      {item.originalPath}
                    </div>
                    <div className="flm-timeline-time">
                      {formatDate(item.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
