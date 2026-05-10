import React, { useState, useEffect, useCallback } from 'react';
import './FileExplorer/FileExplorer.css';
import { showErrorToast } from '../utils/toast';

const FAVORITES_KEY = 'intellifile-favorites';
const ipcRenderer = window.electron?.ipcRenderer;

const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\').replace(/[\\]+$/, '');
const getNodeName = (p) => {
  if (!p) return '';
  const clean = p.replace(/[\\]+$/, '');
  const idx = clean.lastIndexOf('\\');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
};
const isPathWithin = (candidate, target) => {
  const a = normalizePath(candidate);
  const b = normalizePath(target);
  return b === a || b.startsWith(`${a}\\`);
};

const getFolderIcon = (name = '') => {
  const lower = String(name).toLowerCase();
  if (lower.includes('desktop')) return '🖥️';
  if (lower.includes('document')) return '📄';
  if (lower.includes('download')) return '⬇️';
  if (lower.includes('picture') || lower.includes('photo')) return '🖼️';
  if (lower.includes('music')) return '🎵';
  if (lower.includes('video')) return '🎬';
  if (lower.includes('onedrive')) return '☁️';
  if (lower.includes('recycle')) return '🗑️';
  return '📁';
};

function ExplorerSidebar({ drives, onNavigate, currentPath }) {
  const [favorites, setFavorites] = useState([]);
  const [systemRoots, setSystemRoots] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    quickAccess: true,
    drives: true,
  });
  const [treeExpanded, setTreeExpanded] = useState({});
  const [treeChildren, setTreeChildren] = useState({});
  const [treeLoading, setTreeLoading] = useState({});
  const [allowProtectedIndexing, setAllowProtectedIndexing] = useState(false);
  const [dragOverPath, setDragOverPath] = useState(null);
  const dragTimerRef = React.useRef(null);

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading favorites:', e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadPrefs = async () => {
      try {
        const prefs = await window.intellifile?.getIndexingPreferences?.();
        if (!mounted) return;
        if (prefs && typeof prefs.allowProtectedIndexing === 'boolean') {
          setAllowProtectedIndexing(prefs.allowProtectedIndexing);
        }
      } catch (e) {
        console.warn('Failed to load indexing preferences:', e);
      }
    };
    loadPrefs();
    return () => { mounted = false; };
  }, []);

  const updateAllowProtectedIndexing = useCallback(async (nextValue) => {
    setAllowProtectedIndexing(nextValue);
    try {
      await window.intellifile?.setIndexingPreferences?.({ allowProtectedIndexing: nextValue });
    } catch (e) {
      console.warn('Failed to save indexing preference:', e);
    }
  }, []);

  // Save favorites to localStorage
  const saveFavorites = (newFavorites) => {
    setFavorites(newFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
  };

  const addFavorite = useCallback((folderPath, folderName) => {
    if (favorites.some(f => f.path === folderPath)) return;
    const newFavorites = [...favorites, { path: folderPath, name: folderName || folderPath.split('\\').pop() }];
    saveFavorites(newFavorites);
  }, [favorites]);

  const removeFavorite = useCallback((folderPath) => {
    const newFavorites = favorites.filter(f => f.path !== folderPath);
    saveFavorites(newFavorites);
  }, [favorites]);

  const toggleSection = useCallback((section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const loadTreeChildren = useCallback(async (dirPath) => {
    const key = normalizePath(dirPath);
    if (!dirPath || !ipcRenderer) return [];
    if (treeChildren[key]) return treeChildren[key];

    setTreeLoading(prev => ({ ...prev, [key]: true }));
    try {
      const result = await ipcRenderer.invoke('list-directory', dirPath, { showHidden: false });
      const entries = Array.isArray(result?.items) ? result.items : [];
      if (!Array.isArray(entries)) {
        setTreeChildren(prev => ({ ...prev, [key]: [] }));
        return [];
      }

      const folders = entries
        .filter((item) => item && item.path && (item.type === 'folder' || item.type === 'directory' || item.isDirectory === true))
        .map((item) => ({ path: item.path, name: item.name || getNodeName(item.path), isRoot: false }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setTreeChildren(prev => ({ ...prev, [key]: folders }));
      return folders;
    } catch (error) {
      showErrorToast('Could not load folder tree.', error?.message || 'The directory could not be expanded.', 'Try refreshing or opening the folder again.');
      setTreeChildren(prev => ({ ...prev, [key]: [] }));
      return [];
    } finally {
      setTreeLoading(prev => ({ ...prev, [key]: false }));
    }
  }, [treeChildren]);

  const toggleTreeNode = useCallback(async (nodePath) => {
    const key = normalizePath(nodePath);
    const shouldExpand = !treeExpanded[key];
    setTreeExpanded(prev => ({ ...prev, [key]: shouldExpand }));
    if (shouldExpand && !treeChildren[key]) {
      await loadTreeChildren(nodePath);
    }
  }, [loadTreeChildren, treeChildren, treeExpanded]);

  useEffect(() => {
    let cancelled = false;

    const expandCurrentPath = async () => {
      if (!currentPath) return;
      const candidateRoots = [
        ...((drives || []).map((d) => ({ path: d.device || '' })).filter((d) => d.path)),
        ...(favorites.map((f) => ({ path: f.path || '' })).filter((f) => f.path)),
      ];
      const matchingRoots = candidateRoots.filter((r) => isPathWithin(r.path, currentPath));
      const root = matchingRoots.sort((a, b) => b.path.length - a.path.length)[0];
      if (!root) return;

      const rootKey = normalizePath(root.path);
      // Don't auto-expand drive roots, only their children
      const isRootADrive = drives && drives.some(d => normalizePath(d.device) === rootKey);
      
      let cursor = root.path;
      let cursorKey = normalizePath(cursor);
      if (!treeChildren[cursorKey]) {
        await loadTreeChildren(cursor);
      }

      const cleanCurrent = currentPath.replace(/[\\]+$/, '');
      const remainder = cleanCurrent.slice(root.path.replace(/[\\]+$/, '').length).replace(/^\\+/, '');
      const parts = remainder ? remainder.split('\\').filter(Boolean) : [];

      for (const part of parts) {
        if (cancelled) return;
        const children = treeChildren[cursorKey] || await loadTreeChildren(cursor);
        const next = children.find((c) => normalizePath(c.name) === normalizePath(part));
        if (!next) break;
        const nextKey = normalizePath(next.path);
        setTreeExpanded(prev => ({ ...prev, [nextKey]: true }));
        cursor = next.path;
        cursorKey = nextKey;
      }
      
      // Only auto-expand drive root if it's a favorite (favorites should always show tree)
      if (isRootADrive) return;
      setTreeExpanded(prev => ({ ...prev, [rootKey]: true }));
    };

    expandCurrentPath();
    return () => { cancelled = true; };
  }, [currentPath, loadTreeChildren, treeChildren, drives, favorites]);

  // Expose addFavorite through window for ContextMenu to use
  useEffect(() => {
    window.__intellifile_addFavorite = addFavorite;
    window.__intellifile_removeFavorite = removeFavorite;
    window.__intellifile_isFavorite = (folderPath) => {
      const target = normalizePath(folderPath);
      return favorites.some((f) => normalizePath(f.path) === target);
    };
    return () => {
      delete window.__intellifile_addFavorite;
      delete window.__intellifile_removeFavorite;
      delete window.__intellifile_isFavorite;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites]);

  // Load native system roots (This PC, special folders, removable drives)
  useEffect(() => {
    let mounted = true;
    const loadRoots = async () => {
      try {
        if (!ipcRenderer) return;
        const res = await ipcRenderer.invoke('get-system-roots');
        if (!mounted) return;
        if (res && res.success && res.data) setSystemRoots(res.data);
      } catch (err) {
        // ignore
      }
    };
    loadRoots();
    // subscribe to hotplug/changes
    const onChanged = (_e, data) => { if (mounted && data) setSystemRoots(data); };
    try { ipcRenderer && ipcRenderer.on && ipcRenderer.on('system-roots-changed', onChanged); } catch (e) {}

    return () => {
      mounted = false;
      try { ipcRenderer && ipcRenderer.off && ipcRenderer.off('system-roots-changed', onChanged); } catch (e) {}
    };
  }, []);
  
  const navigateToQuickAccess = (folderName) => {
    onNavigate(folderName);
  };

  const handleSidebarDragOver = (e, folderPath) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverPath !== folderPath) {
      setDragOverPath(folderPath);
      // Clear any existing timer
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
      // Auto-navigate after 600ms hover
      dragTimerRef.current = setTimeout(() => {
        onNavigate(folderPath);
      }, 600);
    }
  };

  const handleSidebarDragLeave = (e) => {
    e.stopPropagation();
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    setDragOverPath(null);
  };

  const handleSidebarDrop = (e, folderPath) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    setDragOverPath(null);
    onNavigate(folderPath);
  };

  const dynamicFolders = [
    ...(systemRoots?.specialFolders || []),
  ].filter((item) => item && item.id !== 'this_pc');

  const isActive = (path) => {
    if (!currentPath) return false;
    const norm = (p) => (p || '').toLowerCase().replace(/[\\/]+$/, '');
    return norm(currentPath) === norm(path);
  };

  const renderTreeNode = (node, depth = 0) => {
    const nodeKey = normalizePath(node.path);
    const isExpanded = !!treeExpanded[nodeKey];
    const children = treeChildren[nodeKey] || [];
    const isLoading = !!treeLoading[nodeKey];
    const isCurrent = isActive(node.path);
    const isAncestor = !isCurrent && isPathWithin(node.path, currentPath);

    return (
      <div key={node.path} className="tree-node">
        <div
          className={`tree-row ${isCurrent ? 'active' : ''} ${isAncestor ? 'ancestor' : ''} ${dragOverPath === node.path ? 'drag-over' : ''}`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
          onClick={() => onNavigate(node.path)}
          onDragOver={(e) => handleSidebarDragOver(e, node.path)}
          onDragLeave={handleSidebarDragLeave}
          onDrop={(e) => handleSidebarDrop(e, node.path)}
          title={node.path}
        >
          <button
            className="tree-expander"
            onClick={(e) => {
              e.stopPropagation();
              toggleTreeNode(node.path);
            }}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
          <span className="tree-icon">{node.icon || (node.isRoot ? '💾' : '📁')}</span>
          <span className="tree-label">{node.name || getNodeName(node.path)}</span>
          {node.removable && (
            <button
              className="sidebar-unpin"
              onClick={(e) => {
                e.stopPropagation();
                node.onRemove?.(node.path);
              }}
              title="Unpin"
            >
              ×
            </button>
          )}
        </div>

        {isExpanded && (
          <div className="tree-children">
            {isLoading && <div className="tree-loading" style={{ paddingLeft: `${30 + depth * 18}px` }}>Loading...</div>}
            {!isLoading && children.length === 0 && <div className="tree-empty" style={{ paddingLeft: `${30 + depth * 18}px` }}>No folders</div>}
            {!isLoading && children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderDriveCard = (drive) => {
    const driveDevice = drive.device || drive.path || drive.id || '';
    const driveLabel = drive.description || drive.name || drive.label || drive.volumeName || driveDevice;
    const driveSize = Number(drive.size || drive.total || drive.totalSize || 0);
    const driveAvailable = Number(drive.available ?? drive.free ?? drive.freeSpace ?? drive.free_bytes ?? 0);

    const driveKey = normalizePath(driveDevice);
    const isExpanded = !!treeExpanded[driveKey];
    const children = treeChildren[driveKey] || [];
    const isLoading = !!treeLoading[driveKey];
    const isCurrent = isActive(driveDevice);

    const usedSpace = driveSize - driveAvailable;
    const usedPercent = driveSize > 0 ? Math.round((usedSpace / driveSize) * 100) : 0;
    const availableGB = Math.round(driveAvailable / (1024 ** 3));
    const totalGB = Math.round(driveSize / (1024 ** 3));

    return (
      <div key={driveDevice || driveLabel} className={`drive-card-wrapper`}>
        <div
          className={`drive-card ${isCurrent ? 'active' : ''} ${dragOverPath === driveDevice ? 'drag-over' : ''}`}
          onClick={() => onNavigate(driveDevice)}
          onDragOver={(e) => handleSidebarDragOver(e, driveDevice)}
          onDragLeave={handleSidebarDragLeave}
          onDrop={(e) => handleSidebarDrop(e, driveDevice)}
        >
          <div className="drive-header">
            <button
              className="tree-expander"
              onClick={(e) => {
                e.stopPropagation();
                toggleTreeNode(driveDevice);
              }}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
            <span className="drive-icon">💾</span>
            <div className="drive-info">
              <div className="drive-name">{driveLabel}</div>
              <div className="drive-space">{availableGB} GB free of {totalGB} GB</div>
            </div>
          </div>
          <div className="drive-progress-bar">
            <div
              className={`drive-progress-fill ${usedPercent > 90 ? 'critical' : usedPercent > 75 ? 'warning' : ''}`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </div>

        {isExpanded && (
          <div className="drive-tree-children">
            {isLoading && <div className="tree-loading" style={{ paddingLeft: '30px' }}>Loading...</div>}
            {!isLoading && children.length === 0 && <div className="tree-empty" style={{ paddingLeft: '30px' }}>No folders</div>}
            {!isLoading && children.map((child) => renderTreeNode({ ...child, isRoot: false }, 0))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="explorer-sidebar">
      {/* Favorites / Pinned */}
      {favorites.length > 0 && (
        <div className="sidebar-section">
          <div
            className="sidebar-title collapsible"
            onClick={() => toggleSection('favorites')}
          >
            <span className="collapse-icon">{expandedSections.favorites ? '▾' : '▸'}</span>
            ⭐ Favorites
          </div>
          {expandedSections.favorites && (
            <div className="sidebar-tree">
              {favorites.map((fav) => renderTreeNode({
                path: fav.path,
                name: fav.name,
                isRoot: true,
                icon: '📌',
                removable: true,
                onRemove: removeFavorite,
              }, 0))}
            </div>
          )}
        </div>
)}
      {/* Quick Access */}
      <div className="sidebar-section">
        <div
          className="sidebar-title collapsible"
          onClick={() => toggleSection('quickAccess')}
        >
          <span className="collapse-icon">{expandedSections.quickAccess ? '▾' : '▸'}</span>
          Quick access
        </div>
        {expandedSections.quickAccess && (
          <>
            <div className={`sidebar-item ${isActive('This PC') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('This PC')}>
              <span className="sidebar-icon">💻</span>
              <span className="sidebar-label">This PC</span>
            </div>
          </>
        )}
      </div>

      {/* Native folders */}
      {dynamicFolders.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-title">
            Native folders
          </div>
          <div className="sidebar-tree">
            {dynamicFolders.map((folder) => (
              <div
                key={folder.id}
                className={`sidebar-item ${isActive(folder.path) ? 'active' : ''} ${dragOverPath === folder.path ? 'drag-over' : ''}`}
                onClick={() => folder.path && onNavigate(folder.path)}
                onDragOver={(e) => handleSidebarDragOver(e, folder.path)}
                onDragLeave={handleSidebarDragLeave}
                onDrop={(e) => handleSidebarDrop(e, folder.path)}
                title={folder.path || folder.name}
              >
                <span className="sidebar-icon">{getFolderIcon(folder.name)}</span>
                <span className="sidebar-label">{folder.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

              {/* Drives */}
      {drives.length > 0 && (
        <div className="sidebar-section">
          <div
            className="sidebar-title collapsible"
            onClick={() => toggleSection('drives')}
          >
            <span className="collapse-icon">{expandedSections.drives ? '▾' : '▸'}</span>
            Drives
          </div>
          {expandedSections.drives && (
            <div className="sidebar-drives">
              {drives.filter(d => d && (d.device || d.path || d.id)).map((drive) => {
                // Normalize to object shape expected by renderDriveCard
                const drv = {
                  device: drive.device || drive.id || drive.path || drive.DeviceID || drive.Device || '',
                  description: drive.description || drive.name || drive.label || drive.VolumeName || drive.volumeName || drive.device || drive.path || '',
                  size: drive.size || drive.Size || 0,
                  available: drive.available ?? drive.free ?? drive.Free ?? drive.freeSpace ?? drive.free_space ?? 0
                };
                return renderDriveCard(drv);
              })}
            </div>
          )}
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-title">Preferences</div>
        <label className="sidebar-toggle">
          <input
            type="checkbox"
            checked={allowProtectedIndexing}
            onChange={(e) => updateAllowProtectedIndexing(e.target.checked)}
          />
          <span className="sidebar-toggle-text">Allow protected indexing</span>
        </label>
        <div className="sidebar-help">Includes files that require permission or a password.</div>
      </div>
    </div>
  );
}

export default ExplorerSidebar;
