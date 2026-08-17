import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MdExpandMore, MdPushPin,
  MdDesktopMac, MdDescription, MdDownload, MdImage, MdMusicNote, MdVideoLibrary,
  MdFolder, MdAccessTime, MdStar, MdPeople, MdClose
} from 'react-icons/md';
import { getFileIcon, formatFileSize } from '../utils/fileUtils';
import { getRecentFiles, trackRecentFile, removeRecentFile } from '../../../utils/recentTracker';
import './ExplorerHome.css';

const FAVORITES_KEY = 'intellifile-favorites';

const getItemTypeLabel = (item) => {
  if (item.type === 'folder') return 'Folder';
  if (item.type === 'drive') return 'Drive';
  const ext = (item.ext || '').replace(/^\./, '').toUpperCase();
  if (!ext) return 'File';
  if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(ext)) return `${ext} image`;
  if (['TXT', 'LOG', 'MD', 'JSON', 'JS', 'TS', 'JSX', 'TSX', 'PY', 'HTML', 'CSS'].includes(ext)) return `${ext} document`;
  if (ext === 'PDF') return 'PDF document';
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) return 'Archive';
  return `${ext} file`;
};

const getFolderColorIcon = (iconType, name = '') => {
  const lower = (iconType || name).toLowerCase();
  if (lower.includes('desktop')) {
    return <div className="qa-icon-wrap qa-desktop"><MdDesktopMac size={20} /></div>;
  }
  if (lower.includes('download')) {
    return <div className="qa-icon-wrap qa-downloads"><MdDownload size={20} /></div>;
  }
  if (lower.includes('document')) {
    return <div className="qa-icon-wrap qa-documents"><MdDescription size={20} /></div>;
  }
  if (lower.includes('picture') || lower.includes('photo')) {
    return <div className="qa-icon-wrap qa-pictures"><MdImage size={20} /></div>;
  }
  if (lower.includes('music')) {
    return <div className="qa-icon-wrap qa-music"><MdMusicNote size={20} /></div>;
  }
  if (lower.includes('video')) {
    return <div className="qa-icon-wrap qa-videos"><MdVideoLibrary size={20} /></div>;
  }
  return <div className="qa-icon-wrap qa-folder"><MdFolder size={20} /></div>;
};

export default function ExplorerHome({
  onNavigate,
  onFileSelect,
  onContextMenu,
  selectedItem,
  setSelectedItem,
  selectedItems,
  setSelectedItems,
  searchQuery = '',
}) {
  const [quickAccessItems, setQuickAccessItems] = useState([]);
  const [recentItems, setRecentItems] = useState([]);
  const [sharedItems, setSharedItems] = useState([]);
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState('recent'); // 'recent' | 'favorites' | 'shared'
  const [isQuickAccessOpen, setIsQuickAccessOpen] = useState(true);
  const [isActivityOpen, setIsActivityOpen] = useState(true);

  // Load Quick Access Folders, Recent Folders, and Dynamic Recent Items
  const loadHomeData = useCallback(async () => {
    try {
      // 1. Load standard quick access items
      let qaFolders = [];
      try {
        if (window.electron?.getQuickAccessItems) {
          const res = await window.electron.getQuickAccessItems();
          if (res && res.success && Array.isArray(res.items) && res.items.length > 0) {
            qaFolders = res.items;
          }
        } else if (window.electron?.ipcRenderer) {
          const res = await window.electron.ipcRenderer.invoke('get-quick-access-items');
          if (res && res.success && Array.isArray(res.items) && res.items.length > 0) {
            qaFolders = res.items;
          }
        }
      } catch (_) {}

      // Fallback to get-system-roots if quick access handler is not yet ready
      if (qaFolders.length === 0) {
        try {
          const rootsRes = await window.electron?.ipcRenderer?.invoke('get-system-roots');
          if (rootsRes?.success && Array.isArray(rootsRes.data?.specialFolders)) {
            qaFolders = rootsRes.data.specialFolders
              .filter(f => f.id !== 'this_pc' && f.path)
              .map(f => ({
                id: f.id,
                name: f.name,
                path: f.path,
                subtitle: 'Stored locally',
                iconType: f.id,
                pinned: true,
              }));
          }
        } catch (_) {}
      }

      // Default standard fallback folders
      if (qaFolders.length === 0) {
        qaFolders = [
          { id: 'desktop', name: 'Desktop', path: 'Desktop', subtitle: 'Stored locally', iconType: 'desktop', pinned: true },
          { id: 'downloads', name: 'Downloads', path: 'Downloads', subtitle: 'Stored locally', iconType: 'downloads', pinned: true },
          { id: 'documents', name: 'Documents', path: 'Documents', subtitle: 'Stored locally', iconType: 'documents', pinned: true },
          { id: 'pictures', name: 'Pictures', path: 'Pictures', subtitle: 'Stored locally', iconType: 'pictures', pinned: true },
          { id: 'music', name: 'Music', path: 'Music', subtitle: 'Stored locally', iconType: 'music', pinned: true },
          { id: 'videos', name: 'Videos', path: 'Videos', subtitle: 'Stored locally', iconType: 'videos', pinned: true },
        ];
      }

      // 2. Load user custom pinned favorites
      const storedFavs = (() => {
        try {
          const raw = localStorage.getItem(FAVORITES_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();
      setFavorites(storedFavs);

      const customPinned = storedFavs
        .filter(f => f.path && !qaFolders.some(q => q.path?.toLowerCase() === f.path?.toLowerCase()))
        .map(f => {
          const parts = f.path.split('\\').filter(Boolean);
          const parentName = parts.length > 1 ? parts[parts.length - 2] : 'Favorites';
          return {
            id: `fav-${f.path}`,
            name: f.name || parts[parts.length - 1] || 'Folder',
            path: f.path,
            subtitle: parentName,
            iconType: 'folder',
            pinned: true,
          };
        });

      // 3. Load recent folders (from sidebar tracking: intellifile-recent-folders)
      const storedRecentFolders = (() => {
        try {
          const raw = localStorage.getItem('intellifile-recent-folders');
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();

      const recentFolderCards = storedRecentFolders
        .filter(rf => rf.path &&
          !qaFolders.some(q => q.path?.toLowerCase() === rf.path?.toLowerCase()) &&
          !customPinned.some(cp => cp.path?.toLowerCase() === rf.path?.toLowerCase())
        )
        .map(rf => {
          const parts = rf.path.split('\\').filter(Boolean);
          const parentName = parts.length > 1 ? parts[parts.length - 2] : 'Recent';
          return {
            id: `recent-folder-${rf.path}`,
            name: rf.name || parts[parts.length - 1] || 'Folder',
            path: rf.path,
            subtitle: parentName,
            iconType: 'folder',
            pinned: false,
            isRecent: true,
          };
        });

      // 4. Load dynamic recent items from both App Tracking & Windows shortcuts
      const appRecentFiles = getRecentFiles();

      let winRecent = [];
      try {
        if (window.electron?.getRecentItems) {
          const res = await window.electron.getRecentItems(50);
          if (res && res.success && Array.isArray(res.items)) {
            winRecent = res.items;
          }
        } else if (window.electron?.ipcRenderer) {
          const res = await window.electron.ipcRenderer.invoke('get-recent-items', 50);
          if (res && res.success && Array.isArray(res.items)) {
            winRecent = res.items;
          }
        }
      } catch (_) {}

      // Combine app recent files and Windows recent files dynamically
      const fileMap = new Map();

      // First add Windows recent items
      for (const item of winRecent) {
        if (!item || !item.path) continue;
        const norm = item.path.toLowerCase().replace(/[\\/]+$/, '');
        fileMap.set(norm, { ...item });
      }

      // Overwrite/add with app recent files (which have the freshest in-app timestamps and accurate metadata)
      for (const item of appRecentFiles) {
        if (!item || !item.path) continue;
        const norm = item.path.toLowerCase().replace(/[\\/]+$/, '');
        const existing = fileMap.get(norm);
        fileMap.set(norm, {
          ...(existing || {}),
          ...item,
          accessed: Math.max(item.accessed || 0, existing?.accessed || 0, Date.now()),
        });
      }

      const combinedRecent = Array.from(fileMap.values());
      // Sort recent items by accessed time descending
      combinedRecent.sort((a, b) => (b.accessed || b.modified || 0) - (a.accessed || a.modified || 0));
      setRecentItems(combinedRecent);

      // Extract recent folders from Windows shortcuts up to MAX_RECENT_FOLDERS cap
      const winFolders = winRecent
        .filter(item => item.type === 'folder' && item.path)
        .filter(wf =>
          !qaFolders.some(q => q.path?.toLowerCase() === wf.path?.toLowerCase()) &&
          !customPinned.some(cp => cp.path?.toLowerCase() === wf.path?.toLowerCase()) &&
          !recentFolderCards.some(rf => rf.path?.toLowerCase() === wf.path?.toLowerCase())
        )
        .map(wf => ({
          id: `win-recent-${wf.path}`,
          name: wf.name,
          path: wf.path,
          subtitle: wf.location || 'Recent folder',
          iconType: 'folder',
          pinned: false,
          isRecent: true,
        }));

      // Cap the total number of recent folders in Quick Access
      const allRecentFolders = [...recentFolderCards, ...winFolders];

      // Set combined Quick Access items capped at 9 for a 3x3 layout
      const combinedQA = [...qaFolders, ...customPinned, ...allRecentFolders].slice(0, 9);
      setQuickAccessItems(combinedQA);

      // 5. Load cross-device sync shared items
      if (window.intellifile?.getSyncFiles) {
        try {
          const syncRes = await window.intellifile.getSyncFiles();
          if (syncRes && syncRes.success && Array.isArray(syncRes.items)) {
            setSharedItems(syncRes.items.map(f => ({
              name: f.name,
              path: f.path,
              location: 'Cross-Device Sync',
              parentPath: f.path ? f.path.substring(0, f.path.lastIndexOf('\\')) : '',
              type: 'file',
              size: f.size,
              modified: f.modified,
              accessed: f.modified,
              activity: 'Synced',
            })));
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('[ExplorerHome] Error loading home data:', err);
    }
  }, []);

  useEffect(() => {
    loadHomeData();

    // Listen for storage events (e.g. favorites or recent folders updated)
    const handleStorage = (e) => {
      if (e.key === FAVORITES_KEY || e.key === 'intellifile-recent-folders' || e.key === 'intellifile-recent-files') {
        loadHomeData();
      }
    };

    // Listen for dynamic real-time file open / update events
    const handleRecentUpdated = () => {
      loadHomeData();
    };

    // Listen for window focus to refresh recent items immediately
    const handleFocus = () => {
      loadHomeData();
    };

    // Listen for IPC message from Electron main process
    const removeIpcListener = window.electron?.ipcRenderer?.on?.('recent-files-updated', () => {
      loadHomeData();
    });

    window.addEventListener('storage', handleStorage);
    window.addEventListener('recent-files-updated', handleRecentUpdated);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('recent-files-updated', handleRecentUpdated);
      window.removeEventListener('focus', handleFocus);
      if (typeof removeIpcListener === 'function') removeIpcListener();
    };
  }, [loadHomeData]);

  // Handle opening an item
  const handleOpenItem = (item) => {
    if (item.type === 'folder' || !item.ext) {
      onNavigate(item.path);
    } else {
      trackRecentFile(item.path, item);
      if (onFileSelect) {
        onFileSelect(item);
      }
      window.electron?.ipcRenderer?.invoke('open-file', item.path);
    }
  };

  // Handle clicking an item
  const handleItemClick = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setSelectedItems([item]);
  };

  // Filter items based on current search query if present
  const filterList = useCallback((list) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(item =>
      item.name?.toLowerCase().includes(q) ||
      item.location?.toLowerCase().includes(q) ||
      item.path?.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const displayedRecent = useMemo(() => filterList(recentItems), [recentItems, filterList]);
  const displayedFavorites = useMemo(() => filterList(favorites.map(f => ({
    name: f.name || f.path.split('\\').pop(),
    path: f.path,
    location: f.path.split('\\').slice(0, -1).pop() || 'Favorites',
    type: 'folder',
    accessed: Date.now(),
  }))), [favorites, filterList]);
  const displayedShared = useMemo(() => filterList(sharedItems), [sharedItems, filterList]);

  const activeTableItems = activeTab === 'recent'
    ? displayedRecent
    : activeTab === 'favorites'
      ? displayedFavorites
      : displayedShared;

  return (
    <div className="explorer-home-container" onClick={() => { setSelectedItem(null); setSelectedItems([]); }}>
      {/* ── SECTION 1: QUICK ACCESS ──────────────────────────────────── */}
      <section className="home-section home-quick-access-section">
        <div
          className="home-section-header"
          onClick={() => setIsQuickAccessOpen(prev => !prev)}
        >
          <span className={`home-chevron ${isQuickAccessOpen ? 'open' : ''}`}>
            <MdExpandMore size={18} />
          </span>
          <h2 className="home-section-title">Quick access</h2>
        </div>

        {isQuickAccessOpen && (
          <div className="quick-access-grid">
            {quickAccessItems.map((qa) => {
              const isSelected = selectedItem?.path === qa.path;
              return (
                <div
                  key={qa.id || qa.path}
                  className={`quick-access-card ${isSelected ? 'selected' : ''}`}
                  onClick={(e) => handleItemClick(e, { ...qa, type: 'folder' })}
                  onDoubleClick={() => onNavigate(qa.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedItem({ ...qa, type: 'folder' });
                    setSelectedItems([{ ...qa, type: 'folder' }]);
                    if (onContextMenu) {
                      onContextMenu(e, { ...qa, type: 'folder' });
                    }
                  }}
                  title={qa.path}
                >
                  <div className="qa-card-icon">
                    {getFolderColorIcon(qa.iconType, qa.name)}
                  </div>
                  <div className="qa-card-content">
                    <span className="qa-card-title">{qa.name}</span>
                    <span className="qa-card-subtitle">{qa.subtitle || 'Folder'}</span>
                  </div>
                  {qa.pinned && (
                    <span className="qa-pin-badge" title="Pinned to Quick access">
                      <MdPushPin size={13} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── SECTION 2: RECENT / FAVORITES / SHARED (DETAILED VIEW) ───── */}
      <section className="home-section home-activity-section">
        <div className="home-activity-header-row">
          <div
            className="home-section-header-compact"
            onClick={() => setIsActivityOpen(prev => !prev)}
          >
            <span className={`home-chevron ${isActivityOpen ? 'open' : ''}`}>
              <MdExpandMore size={18} />
            </span>
          </div>

          {/* Segmented Filter Tab Pills */}
          <div className="home-filter-pills">
            <button
              className={`home-pill-btn ${activeTab === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveTab('recent')}
            >
              <MdAccessTime size={15} style={{ marginRight: 5 }} />
              <span>Recent</span>
            </button>
            <button
              className={`home-pill-btn ${activeTab === 'favorites' ? 'active' : ''}`}
              onClick={() => setActiveTab('favorites')}
            >
              <MdStar size={15} style={{ marginRight: 5 }} />
              <span>Favorites</span>
            </button>
            <button
              className={`home-pill-btn ${activeTab === 'shared' ? 'active' : ''}`}
              onClick={() => setActiveTab('shared')}
            >
              <MdPeople size={15} style={{ marginRight: 5 }} />
              <span>Shared</span>
            </button>
          </div>
        </div>

        {isActivityOpen && (
          <div className="home-details-container">
            {activeTableItems.length === 0 ? (
              <div className="home-empty-state">
                <div className="home-empty-icon">
                  {activeTab === 'recent' ? <MdAccessTime size={32} /> : activeTab === 'favorites' ? <MdStar size={32} /> : <MdPeople size={32} />}
                </div>
                <h3 className="home-empty-title">
                  {activeTab === 'recent'
                    ? (searchQuery ? 'No matching recent files' : 'No recent files found')
                    : activeTab === 'favorites'
                      ? 'No favorites added yet'
                      : 'No shared files found'}
                </h3>
                <p className="home-empty-desc">
                  {activeTab === 'recent'
                    ? 'Files and folders you open will automatically appear here for quick access.'
                    : activeTab === 'favorites'
                      ? 'Right-click any file or folder and select "Add to Favorites" to pin it here.'
                      : 'Stage files in Cross-Device Sync to access them across all your connected devices.'}
                </p>
              </div>
            ) : (
              <>
                {/* Details View Column Headers */}
                <div className="home-details-header">
                  <span className="hd-col hd-icon" />
                  <span className="hd-col hd-name">Name</span>
                  <span className="hd-col hd-location">Location</span>
                  <span className="hd-col hd-type">Type</span>
                  <span className="hd-col hd-size">Size</span>
                  <span className="hd-col hd-action" />
                </div>

                {/* Details View Items List */}
                <div className="file-list details home-file-list">
                  {activeTableItems.map((item, idx) => {
                    const isSelected = selectedItem?.path === item.path;
                    return (
                      <div
                        key={item.path || idx}
                        className={`file-item ${item.type || 'file'} ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => handleItemClick(e, item)}
                        onDoubleClick={() => handleOpenItem(item)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedItem(item);
                          setSelectedItems([item]);
                          if (onContextMenu) {
                            onContextMenu(e, item);
                          }
                        }}
                      >
                        <div className="file-icon">
                          {item.type === 'folder' ? (
                            <MdFolder size={18} style={{ color: '#f59e0b' }} />
                          ) : (
                            getFileIcon(item)
                          )}
                        </div>

                        <div className="file-name" title={item.name}>
                          {item.name}
                        </div>

                        <div className="file-location" title={item.location || item.parentPath}>
                          {item.location || item.parentPath || 'Local Storage'}
                        </div>
                        <div className="file-type">
                          {getItemTypeLabel(item)}
                        </div>
                        <div className="file-size">
                          {item.type === 'folder' ? '--' : formatFileSize(item.size || 0)}
                        </div>

                        <div className="file-item-action">
                          {activeTab === 'recent' && (
                            <button
                              className="home-item-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRecentFile(item.path);
                                try { window.electron?.removeRecentItem?.(item.path); } catch (_) {}
                                setRecentItems(prev => prev.filter(r => r.path !== item.path));
                              }}
                              title="Remove from recent"
                            >
                              <MdClose size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
