import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MdFolder, MdFolderOpen, MdInsertDriveFile, MdArrowBack,
  MdClose, MdLock, MdHome, MdStorage, MdCheck,
  MdDesktopMac, MdDownload, MdDescription, MdImage, MdMusicNote,
  MdVideoLibrary, MdChevronRight,
  MdVisibility, MdErrorOutline
} from 'react-icons/md';
import { getFileIcon } from './utils/fileUtils';
import PreviewPanel from './PreviewPanel';
import './VaultFilePicker.css';

const ipcRenderer = window.electron?.ipcRenderer;

const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\').replace(/[\\]+$/, '');

const getFolderIcon = (name = '') => {
  const lower = String(name).toLowerCase();
  if (lower.includes('desktop')) return <MdDesktopMac />;
  if (lower.includes('document')) return <MdDescription />;
  if (lower.includes('download')) return <MdDownload />;
  if (lower.includes('picture') || lower.includes('photo')) return <MdImage />;
  if (lower.includes('music')) return <MdMusicNote />;
  if (lower.includes('video')) return <MdVideoLibrary />;
  return <MdFolder />;
};

function Breadcrumb({ pathStr, onNavigate }) {
  if (!pathStr) return null;
  const cleanPath = pathStr.replace(/[\\]+$/, '');
  const parts = cleanPath.split('\\').filter(Boolean);

  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    const segPath = parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '');
    segments.push({ label: parts[i], path: segPath });
  }

  return (
    <div className="vfp-breadcrumb">
      <button className="vfp-bread-home-btn" onClick={() => onNavigate(null)} title="Home">
        <MdHome size={14} />
      </button>
      {segments.map((seg, idx) => (
        <React.Fragment key={idx}>
          <MdChevronRight size={13} className="vfp-bread-sep" />
          <button
            className={`vfp-bread-seg ${idx === segments.length - 1 ? 'active' : ''}`}
            onClick={() => onNavigate(seg.path)}
          >
            {seg.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function VaultFilePicker({ onSelect, onCancel }) {
  const [currentPath, setCurrentPath] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [drives, setDrives] = useState([]);
  const [quickAccess, setQuickAccess] = useState([]);
  const [navHistory, setNavHistory] = useState([]);
  const listRef = useRef(null);

  useEffect(() => {
    const loadRoots = async () => {
      try {
        const res = await ipcRenderer?.invoke('get-system-roots');
        if (res?.success && res?.data) {
          // specialFolders is an array of { id, name, path } — filter out virtual ones with no path
          const specials = (res.data.specialFolders || []).filter(
            (f) => f.path && !f.virtual && !['this_pc', 'recycle'].includes(f.id)
          );
          setQuickAccess(specials.map((f) => ({ name: f.name, path: f.path })));
        }
      } catch (e) {
        console.error('[VaultFilePicker] get-system-roots error:', e);
      }
      try {
        const result = await ipcRenderer?.invoke('get-drives-info');
        // response: { success: true, drives: [{ id, path, name, type, size, free }] }
        if (result?.success && Array.isArray(result.drives)) {
          setDrives(result.drives);
        }
      } catch (e) {
        console.error('[VaultFilePicker] get-drives-info error:', e);
      }
    };
    loadRoots();
  }, []);

  const loadDirectory = useCallback(async (dirPath) => {
    if (!dirPath) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await ipcRenderer?.invoke('list-directory', dirPath, { showHidden: false });
      if (result?.error) { setError(result.error); setItems([]); }
      else { setItems(result?.items || []); }
    } catch (e) {
      setError(e.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
      if (listRef.current) listRef.current.scrollTop = 0;
    }
  }, []);

  useEffect(() => { loadDirectory(currentPath); }, [currentPath, loadDirectory]);

  const navigateTo = (path) => {
    if (path === currentPath) return;
    setNavHistory((h) => [...h, currentPath]);
    setCurrentPath(path);
    setSelectedFile(null);
    setShowPreview(false);
  };

  const navigateBack = () => {
    if (navHistory.length === 0) return;
    const prev = navHistory[navHistory.length - 1];
    setNavHistory((h) => h.slice(0, -1));
    setCurrentPath(prev);
    setSelectedFile(null);
    setShowPreview(false);
  };

  const handleItemClick = (item) => {
    if (item.type === 'folder') navigateTo(item.path);
    else setSelectedFile(item);
  };

  const handleItemDoubleClick = (item) => {
    if (item.type === 'folder') navigateTo(item.path);
    else onSelect(item.path);
  };

  const handleConfirm = () => {
    if (selectedFile) onSelect(selectedFile.path);
  };

  const isHome = currentPath === null;

  return (
    <div className="vfp-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`vfp-modal ${showPreview ? 'vfp-modal-with-preview' : ''}`} role="dialog" aria-modal="true" aria-label="Select a file to lock">
        {/* Header */}
        <div className="vfp-header">
          <div className="vfp-header-left">
            <MdLock className="vfp-header-icon" />
            <div>
              <h3 className="vfp-header-title">Select File to Lock</h3>
              <p className="vfp-header-subtitle">Browse your files using IntelliFile</p>
            </div>
          </div>
          <button className="vfp-close-btn" onClick={onCancel} title="Close">
            <MdClose size={18} />
          </button>
        </div>

        {/* Navbar */}
        <div className="vfp-navbar">
          <button className="vfp-nav-btn" onClick={navigateBack} disabled={navHistory.length === 0} title="Back">
            <MdArrowBack size={16} />
          </button>
          <div className="vfp-breadcrumb-wrap">
            {isHome ? (
              <span className="vfp-bread-home-label"><MdHome size={13} style={{ marginRight: 4 }} />Home</span>
            ) : (
              <Breadcrumb pathStr={currentPath} onNavigate={(p) => {
                if (p === null) { setNavHistory((h) => [...h, currentPath]); setCurrentPath(null); setSelectedFile(null); setShowPreview(false); }
                else navigateTo(p);
              }} />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="vfp-body">
          {/* Sidebar */}
          <div className="vfp-sidebar">
            {quickAccess.length > 0 && (
              <div className="vfp-sidebar-section">
                <div className="vfp-sidebar-title">Quick Access</div>
                {quickAccess.map((qa) => (
                  <button
                    key={qa.path}
                    className={`vfp-sidebar-item ${normalizePath(currentPath) === normalizePath(qa.path) ? 'active' : ''}`}
                    onClick={() => navigateTo(qa.path)}
                  >
                    <span className="vfp-sidebar-icon">{getFolderIcon(qa.name)}</span>
                    <span>{qa.name}</span>
                  </button>
                ))}
              </div>
            )}
            {drives.length > 0 && (
              <div className="vfp-sidebar-section">
                <div className="vfp-sidebar-title">Drives</div>
                {drives.map((d) => (
                  <button
                    key={d.path || d.id}
                    className={`vfp-sidebar-item ${normalizePath(currentPath) === normalizePath(d.path) ? 'active' : ''}`}
                    onClick={() => navigateTo(d.path)}
                  >
                    <span className="vfp-sidebar-icon"><MdStorage /></span>
                    <span>{d.name || d.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* File List */}
          <div className="vfp-list-wrap">
            <div className="vfp-list" ref={listRef}>
              {loading && (
                <div className="vfp-status-msg">
                  <div className="vfp-spinner" />
                  <span>Loading…</span>
                </div>
              )}
              {!loading && error && (
                <div className="vfp-status-msg vfp-error">
                  <MdErrorOutline size={16} style={{ marginRight: 6 }} />
                  {error}
                </div>
              )}
              {!loading && !error && isHome && (
                <div className="vfp-home">
                  {quickAccess.length > 0 && (
                    <>
                      <div className="vfp-list-section-title">Quick Access</div>
                      <div className="vfp-home-grid">
                        {quickAccess.map((qa) => (
                          <button key={qa.path} className="vfp-home-tile" onClick={() => navigateTo(qa.path)}>
                            <span className="vfp-home-tile-icon">{getFolderIcon(qa.name)}</span>
                            <span className="vfp-home-tile-name">{qa.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {drives.length > 0 && (
                    <>
                      <div className="vfp-list-section-title">Drives</div>
                      <div className="vfp-home-grid">
                        {drives.map((d) => (
                          <button key={d.path || d.id} className="vfp-home-tile vfp-drive-tile" onClick={() => navigateTo(d.path)}>
                            <span className="vfp-home-tile-icon"><MdStorage /></span>
                            <span className="vfp-home-tile-name">{d.id || d.name || d.path}</span>
                            {d.name && d.name !== d.id && <span className="vfp-drive-label">{d.name}</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {!loading && !error && !isHome && (
                items.length === 0
                  ? <div className="vfp-status-msg">This folder is empty.</div>
                  : items.map((item) => {
                    const isSelected = selectedFile && normalizePath(selectedFile.path) === normalizePath(item.path);
                    return (
                      <div
                        key={item.path}
                        className={`vfp-item ${item.type === 'folder' ? 'vfp-folder' : 'vfp-file'} ${isSelected ? 'vfp-item-selected' : ''}`}
                        onClick={() => handleItemClick(item)}
                        onDoubleClick={() => handleItemDoubleClick(item)}
                        role="row"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleItemDoubleClick(item);
                          if (e.key === ' ' && item.type === 'file') { e.preventDefault(); setSelectedFile(item); }
                        }}
                      >
                        {item.type === 'file' && (
                          <span
                            className={`vfp-file-selector ${isSelected ? 'selected' : ''}`}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Select ${item.name}`}
                          >
                            {isSelected && <MdCheck size={14} />}
                          </span>
                        )}
                        <span className="vfp-item-icon">
                          {item.type === 'folder'
                            ? (isSelected ? <MdFolderOpen /> : <MdFolder />)
                            : getFileIcon(item)}
                        </span>
                        <span className="vfp-item-name" title={item.name}>{item.name}</span>
                        {item.type === 'folder' && <MdChevronRight size={14} className="vfp-item-arrow" />}
                      </div>
                    );
                  })
              )}
            </div>

            {/* Footer / Selection bar */}
            <div className="vfp-selection-bar">
              <div className="vfp-selection-label">
                {selectedFile ? (
                  <>
                    <MdInsertDriveFile size={14} />
                    <span className="vfp-selected-name" title={selectedFile.path}>{selectedFile.name}</span>
                  </>
                ) : (
                  <span className="vfp-no-selection">No file selected — click a file or double-click to lock</span>
                )}
              </div>
              <div className="vfp-actions">
                <button className="vfp-btn-cancel" onClick={onCancel}>Cancel</button>
                <button
                  className="vfp-btn-preview"
                  onClick={() => setShowPreview(true)}
                  disabled={!selectedFile}
                  title="Preview the selected file"
                >
                  <MdVisibility size={15} /> Preview
                </button>
                <button className="vfp-btn-select" onClick={handleConfirm} disabled={!selectedFile}>
                  <MdLock size={14} /> Select &amp; Lock
                </button>
              </div>
            </div>
          </div>

          {showPreview && selectedFile && (
            <PreviewPanel
              selectedItem={selectedFile}
              visible={showPreview}
              onClose={() => setShowPreview(false)}
              searchQuery=""
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default VaultFilePicker;