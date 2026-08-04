import React, { useState, useEffect, useCallback } from 'react';
import { MdCloud, MdDelete, MdDesktopMac, MdDescription, MdDownload, MdFolder, MdImage, MdMusicNote, MdVideoLibrary } from 'react-icons/md';
import './FileExplorer/FileExplorer.css';
import { showErrorToast, showToast } from '../utils/toast';

const FAVORITES_KEY = 'intellifile-favorites';
const RECENT_FOLDERS_KEY = 'intellifile-recent-folders';
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
  if (lower.includes('desktop')) return <MdDesktopMac />;
  if (lower.includes('document')) return <MdDescription />;
  if (lower.includes('download')) return <MdDownload />;
  if (lower.includes('picture') || lower.includes('photo')) return <MdImage />;
  if (lower.includes('music')) return <MdMusicNote />;
  if (lower.includes('video')) return <MdVideoLibrary />;
  if (lower.includes('onedrive')) return <MdCloud />;
  if (lower.includes('recycle')) return <MdDelete />;
  return <MdFolder />;
};

function ExplorerSidebar({ drives, onNavigate, currentPath }) {
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [recentFolders, setRecentFolders] = useState(() => {
    try {
      const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [systemRoots, setSystemRoots] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    quickAccess: true,
    recentFolders: true,
    drives: true,
  });
  const [treeExpanded, setTreeExpanded] = useState({});
  const [treeChildren, setTreeChildren] = useState({});
  const [treeLoading, setTreeLoading] = useState({});
  const [allowProtectedIndexing, setAllowProtectedIndexing] = useState(false);
  const [isDefaultFileManager, setIsDefaultFileManager] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [dragOverPath, setDragOverPath] = useState(null);
  const dragTimerRef = React.useRef(null);
  const treeChildrenRef = React.useRef({});
  const treeLoadingRef = React.useRef({});

  // Save favorites to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
      console.error('Error saving favorites:', e);
    }
  }, [favorites]);

  // Save recent folders to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recentFolders));
    } catch (e) {
      console.error('Error saving recent folders:', e);
    }
  }, [recentFolders]);

  // Track folder visits from IntelliFile navigation (excluding native quick access folders, max 2 items)
  useEffect(() => {
    const systemKeywords = [
      'desktop', 'documents', 'document', 'downloads', 'download',
      'pictures', 'picture', 'photos', 'photo', 'music', 'videos',
      'video', 'onedrive', 'recycle', 'this_pc', 'this pc'
    ];

    const isSystemOrQuickAccess = (fPath, fName) => {
      if (!fPath) return true;
      const lowerP = fPath.toLowerCase().replace(/[\\]+$/, '');
      const lowerN = (fName || '').toLowerCase();
      if (/^[a-zA-Z]:\\?$/.test(lowerP)) return true;
      return systemKeywords.some(k => lowerN === k || lowerN.includes(k) || lowerP.endsWith(`\\${k}`));
    };

    const handleFolderVisited = (e) => {
      const folderPath = e.detail?.path;
      if (!folderPath) return;

      const normTarget = normalizePath(folderPath);
      const folderName = getNodeName(folderPath) || folderPath;

      if (isSystemOrQuickAccess(folderPath, folderName)) return;

      setRecentFolders((prev) => {
        const filteredPrev = prev.filter((f) => !isSystemOrQuickAccess(f.path, f.name));
        const existingIdx = filteredPrev.findIndex((f) => normalizePath(f.path) === normTarget);
        let updated;
        if (existingIdx >= 0) {
          const item = filteredPrev[existingIdx];
          const updatedItem = {
            ...item,
            name: folderName,
            count: (item.count || 1) + 1,
            lastVisited: Date.now(),
          };
          updated = [...filteredPrev];
          updated[existingIdx] = updatedItem;
        } else {
          updated = [
            ...filteredPrev,
            {
              path: folderPath,
              name: folderName,
              count: 1,
              lastVisited: Date.now(),
            },
          ];
        }

        updated.sort((a, b) => (b.lastVisited - a.lastVisited) || (b.count - a.count));
        return updated.slice(0, 2);
      });
    };

    window.addEventListener('intellifile-folder-visited', handleFolderVisited);
    return () => window.removeEventListener('intellifile-folder-visited', handleFolderVisited);
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

  useEffect(() => {
    let mounted = true;
    const checkDefaultStatus = async () => {
      try {
        if (window.intellifile?.checkIsDefaultFileManager) {
          const res = await window.intellifile.checkIsDefaultFileManager();
          if (mounted) setIsDefaultFileManager(res);
        }
      } catch (e) {
        console.warn('Failed to check default file manager status:', e);
      }
    };
    checkDefaultStatus();
    return () => { mounted = false; };
  }, []);

  const updateIsDefaultFileManager = useCallback(async (nextValue) => {
    // Optimistically update UI
    setIsDefaultFileManager(nextValue);
    setIsSettingDefault(true);
    showToast(
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
          // Revert UI state on failure silently
          setIsDefaultFileManager(!nextValue);
        } else if (result && result.success) {
          // Show final success toast overriding the optimistic one
          showToast(
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
      }
    } catch (e) {
      // Revert UI state on unexpected error
      setIsDefaultFileManager(!nextValue);
      console.warn('Failed to update default file manager preference:', e);
    } finally {
      setIsSettingDefault(false);
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
    if (treeChildrenRef.current[key]) return treeChildrenRef.current[key];
    if (treeLoadingRef.current[key]) return [];

    setTreeLoading(prev => {
      const next = { ...prev, [key]: true };
      treeLoadingRef.current = next;
      return next;
    });
    try {
      const result = await ipcRenderer.invoke('list-directory', dirPath, { showHidden: false });
      const entries = Array.isArray(result?.items) ? result.items : [];
      if (!Array.isArray(entries)) {
        const nextChildren = { ...treeChildrenRef.current, [key]: [] };
        treeChildrenRef.current = nextChildren;
        setTreeChildren(nextChildren);
        return [];
      }

      const folders = entries
        .filter((item) => item && item.path && (item.type === 'folder' || item.type === 'directory' || item.isDirectory === true))
        .map((item) => ({ path: item.path, name: item.name || getNodeName(item.path), isRoot: false }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const nextChildren = { ...treeChildrenRef.current, [key]: folders };
      treeChildrenRef.current = nextChildren;
      setTreeChildren(nextChildren);
      return folders;
    } catch (error) {
      showErrorToast('Could not load folder tree.', error?.message || 'The directory could not be expanded.', 'Try refreshing or opening the folder again.');
      const nextChildren = { ...treeChildrenRef.current, [key]: [] };
      treeChildrenRef.current = nextChildren;
      setTreeChildren(nextChildren);
      return [];
    } finally {
      setTreeLoading(prev => {
        const next = { ...prev, [key]: false };
        treeLoadingRef.current = next;
        return next;
      });
    }
  }, []);

  const toggleTreeNode = useCallback(async (nodePath) => {
    const key = normalizePath(nodePath);
    const shouldExpand = !treeExpanded[key];
    setTreeExpanded(prev => ({ ...prev, [key]: shouldExpand }));
    if (shouldExpand && !treeChildrenRef.current[key]) {
      await loadTreeChildren(nodePath);
    }
  }, [loadTreeChildren, treeExpanded]);

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
    // Only include folders that are NOT special folders (those are shown in Quick Access)
    // This prevents duplication between Quick Access and Native folders sections
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
            {systemRoots?.specialFolders?.filter(f => f.id !== 'this_pc').map((folder) => (
              <div key={folder.id} className={`sidebar-item ${isActive(folder.path) ? 'active' : ''}`} onClick={() => navigateToQuickAccess(folder.path)}>
                <span className="sidebar-icon">{getFolderIcon(folder.name)}</span>
                <span className="sidebar-label">{folder.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Recent Folders */}
      {recentFolders.length > 0 && (
        <div className="sidebar-section">
          <div
            className="sidebar-title collapsible"
            onClick={() => toggleSection('recentFolders')}
          >
            <span className="collapse-icon">{expandedSections.recentFolders ? '▾' : '▸'}</span>
            Recent Folders
          </div>
          {expandedSections.recentFolders && (
            <>
              {recentFolders.map((rf) => (
                <div
                  key={rf.path}
                  className={`sidebar-item ${isActive(rf.path) ? 'active' : ''}`}
                  onClick={() => onNavigate(rf.path)}
                  title={`${rf.path} (${rf.count || 1} visits)`}
                >
                  <span className="sidebar-icon">{getFolderIcon(rf.name)}</span>
                  <span className="sidebar-label">{rf.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

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
        
        {window.electron && (
          <div style={{ marginBottom: '12px' }}>
            <label className="sidebar-toggle">
              <input
                type="checkbox"
                checked={isDefaultFileManager}
                disabled={isSettingDefault}
                onChange={(e) => updateIsDefaultFileManager(e.target.checked)}
              />
              <span className="sidebar-toggle-text">Set IntelliFile as default</span>
            </label>
            <div className="sidebar-help">Replaces Windows Explorer as default handler for opening folders and explorer shortcuts.</div>
          </div>
        )}

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
