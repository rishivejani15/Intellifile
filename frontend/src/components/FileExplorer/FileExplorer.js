import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MdOutlineVisibility } from 'react-icons/md';
import { searchFiles, onIndexProgress, onIndexComplete } from '../../services/searchService';
import { hasSearchableFilters, convertFiltersToSearchPayload, getDefaultFilters } from './components/SearchFilterPopover';
import { useNavigation } from '../../hooks/useNavigation';
import { useFileExplorer } from '../../hooks/useFileExplorer';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { sortItems } from './utils/fileUtils';
import ExplorerSidebar from '../ExplorerSidebar';
import ExplorerNavbar from '../ExplorerNavbar';
import ExplorerHome from './components/ExplorerHome';
import PreviewPanel from '../PreviewPanel';
import FileList from '../FileList';
import ContextMenu from '../ContextMenu';
import PropertiesModal from '../PropertiesModal';
import SearchResults from '../SearchResults';
import TabsBar from '../TabsBar';
import OpenWithModal from '../OpenWithModal';
import DeleteConfirmModal from '../DeleteConfirmModal';
import MoveConfirmModal from '../MoveConfirmModal';
import VersionTimeline from '../Versioning/VersionTimeline';
import { smartCleanupVersions } from '../../services/versionService';
import { showErrorToast, showToast } from '../../utils/toast';
import FileLockModal from '../FileLockModal';
import { trackRecentFile } from '../../utils/recentTracker';
import { getStarredItems } from '../../utils/starPinUtils';
import './FileExplorer.css';


const ipcRenderer = window.electron?.ipcRenderer;
const VERSIONING_BLOCKED_EXTENSIONS = new Set(['.zip', '.ppt', '.pptx', '.pptm', '.pak', '.bin', '.backup']);

function FileExplorer({ onFileSelect, selectedFiles = {}, drives = [], onChatWithAI }) {
  // UI State: initialize from lastDirectoryCache so items are displayed on frame 0
  const [items, setItems] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('lastDirectoryCache') || '{}');
      if (cached?.items && Array.isArray(cached.items) && cached.items.length > 0) {
        return cached.items;
      }
    } catch (_) {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  // UI State with localStorage persistence (Default: Name, Ascending)
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile_sort_prefs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.viewMode) return parsed.viewMode;
      }
    } catch (_) { }
    return 'icons';
  });

  const [sortBy, setSortBy] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile_sort_prefs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sortBy) return parsed.sortBy;
      }
    } catch (_) { }
    return 'name';
  });

  const [sortDirection, setSortDirection] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile_sort_prefs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sortDirection) return parsed.sortDirection;
      }
    } catch (_) { }
    return 'asc';
  });

  const [groupBy, setGroupBy] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile_sort_prefs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.groupBy) return parsed.groupBy;
      }
    } catch (_) { }
    return 'none';
  });

  // Save sort/group/view preferences to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('intellifile_sort_prefs', JSON.stringify({
        viewMode,
        sortBy,
        sortDirection,
        groupBy
      }));
    } catch (_) { }
  }, [viewMode, sortBy, sortDirection, groupBy]);

  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilters, setSearchFilters] = useState(() => getDefaultFilters('Home'));
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const anchorIndexRef = useRef(null); // always-fresh ref; avoids stale closures in handleItemClick
  const [tempHighlightedPath, setTempHighlightedPath] = useState(null);
  const typeBufferRef = useRef('');
  const typeTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const [showProperties, setShowProperties] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemsPendingDelete, setItemsPendingDelete] = useState([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveModalData, setMoveModalData] = useState({ items: [], targetFolder: null, onConfirm: null });
  const [showPreview, setShowPreview] = useState(false);
  const [showVersioning, setShowVersioning] = useState(false);
  const [previewClosing, setPreviewClosing] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [isEmptySpaceContext, setIsEmptySpaceContext] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // File Lock modal state
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockModalMode, setLockModalMode] = useState('lock');
  const [lockModalFile, setLockModalFile] = useState(null);

  // Open with & chooser states
  const [openWithItem, setOpenWithItem] = useState(null);
  const [showOpenWith, setShowOpenWith] = useState(false);
  const [showRecentChooser, setShowRecentChooser] = useState(false);
  const [recentChooserFiles, setRecentChooserFiles] = useState([]);

  // Sidebar resizing state
  const [showSidebar, setShowSidebar] = useState(() => {
    try { return localStorage.getItem('intellifile-show-sidebar') !== 'false'; } catch { return true; }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile-sidebar-width');
      return saved ? parseInt(saved, 10) : 260;
    } catch { return 260; }
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Search & Indexing State
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const isSearchActive = semanticResults !== null && (
    Boolean(searchQuery.trim()) || hasSearchableFilters(searchFilters)
  );
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexPhase, setIndexPhase] = useState('');
  const [indexDetail, setIndexDetail] = useState('');
  const [indexPct, setIndexPct] = useState(null);
  const [indexMessage, setIndexMessage] = useState('');
  const [engineError, setEngineError] = useState('');
  const [archiveActive, setArchiveActive] = useState(false);
  const [archiveAction, setArchiveAction] = useState('');
  const [archivePct, setArchivePct] = useState(null);
  const [archiveMessage, setArchiveMessage] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [indexedFolder, setIndexedFolder] = useState('');
  // New flag – allow indexing only after the first directory load
  const [canStartIndexing, setCanStartIndexing] = useState(false);

  // File Operation Progress State (copy, move, delete)
  const [fileOpProgress, setFileOpProgress] = useState(null);

  useEffect(() => {
    if (!ipcRenderer) return undefined;

    const handleProgress = (data) => {
      if (!data) return;
      if (data.done || data.error || !data.active) {
        setFileOpProgress(data);
        setTimeout(() => setFileOpProgress(null), 3000);
      } else {
        setFileOpProgress(data);
      }
    };

    ipcRenderer.on('file-op-progress', handleProgress);
    return () => {
      ipcRenderer.off('file-op-progress', handleProgress);
    };
  }, []);

  // Use canStartIndexing to avoid unused variable lint warning.
  useEffect(() => {
    // This effect runs whenever canStartIndexing changes.
    // Future indexing logic can be added here.
  }, [canStartIndexing]);

  // Custom Hooks
  const navigation = useNavigation(ipcRenderer);
  const fileOps = useFileExplorer(ipcRenderer);

  // Load cached directory (if any) for instant UI on first launch and refresh it silently in the background
  // (Moved below loadDirectory definition to avoid accessing it before initialization)

  // Destructure navigation
  const {
    currentPath, setCurrentPath, breadcrumb,
    history, historyIndex, tabs, activeTabId, addressPath, setAddressPath,
    updateBreadcrumb, updateHistory, updateActiveTab,
    handleBack: navBack, handleForward: navForward, handleUp: navUp,
    handleNewTab, handleCloseTab, handleSelectTab
  } = navigation;

  // Destructure file operations
  const {
    clipboard, renamingItem, setRenamingItem,
    renameValue, setRenameValue,
    handleCompressZip,
    handleExtractZip
  } = fileOps;

  // eslint-disable-next-line no-unused-vars
  const inputRef = useRef(null);
  const loadRequestRef = useRef(0);
  const watchedDirectoryRef = useRef(null);
  const initialLoadRef = useRef(false);

  // Listen for starred items updates for live UI refresh
  useEffect(() => {
    const handleStarredUpdated = (e) => {
      if (currentPath === 'Starred' || String(currentPath).toLowerCase() === 'starred') {
        const updatedStarred = e.detail || getStarredItems();
        setItems(updatedStarred);
      } else {
        setItems(prevItems => [...prevItems]);
      }
    };

    window.addEventListener('starred-updated', handleStarredUpdated);
    return () => window.removeEventListener('starred-updated', handleStarredUpdated);
  }, [currentPath]);

  // Listen for pinned items updates for live UI re-sorting
  useEffect(() => {
    const handlePinnedUpdated = () => {
      setItems(prevItems => [...prevItems]);
    };

    window.addEventListener('pinned-updated', handlePinnedUpdated);
    return () => window.removeEventListener('pinned-updated', handlePinnedUpdated);
  }, []);
  const archiveMessageTimerRef = useRef(null);
  const directoryLoadInFlightRef = useRef(new Map());

  // Toast debouncing for watch events — batch rapid events into a single toast
  const watchToastTimerRef = useRef(null);
  const watchToastBatchRef = useRef({ added: new Set(), modified: new Set(), removed: new Set() });

  // Search abort ref — incremented on each search to cancel stale requests
  const searchIdRef = useRef(0);
  const searchDebounceRef = useRef(null);
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // Handle internal Reveal File event from Settings / Storage
  useEffect(() => {
    const handleRevealFile = async (e) => {
      const rawPath = e.detail?.filePath || e.detail?.path;
      if (!rawPath) return;

      let targetPath = String(rawPath).trim();
      const norm = targetPath.replace(/\\/g, '/');

      let parentDir = targetPath;
      let fileName = null;

      // Determine if target is a file or folder
      let isFile = false;
      try {
        const details = await ipcRenderer?.invoke('get-file-details', targetPath);
        if (details?.success && details.details?.type === 'file') {
          isFile = true;
        }
      } catch (_) { }

      if (!isFile) {
        const lastSep = norm.lastIndexOf('/');
        const lastDot = norm.lastIndexOf('.');
        if (lastDot > lastSep && lastSep > 0) {
          isFile = true;
        }
      }

      if (isFile) {
        const lastSep = norm.lastIndexOf('/');
        if (lastSep > 0) {
          parentDir = targetPath.substring(0, lastSep);
          fileName = targetPath.substring(lastSep + 1);
        }
      }

      // Handle drive roots like "C:" -> "C:\"
      if (/^[a-zA-Z]:$/.test(parentDir)) {
        parentDir += '\\';
      }

      console.log('[FileExplorer] Revealing target in app:', { targetPath, parentDir, fileName });

      if (loadDirectoryRef.current) {
        loadDirectoryRef.current(parentDir, { selectFile: fileName, trackHistory: true });
      }
    };

    window.addEventListener('intellifile-reveal-file', handleRevealFile);
    return () => window.removeEventListener('intellifile-reveal-file', handleRevealFile);
  }, []);

  const [activeDrives, setActiveDrives] = useState(drives || []);

  useEffect(() => {
    if (Array.isArray(drives) && drives.length > 0) {
      setActiveDrives(drives);
    }
  }, [drives]);

  // Update This PC view and active drives immediately when USB pendrives/portable devices are connected/disconnected
  useEffect(() => {
    const unsub = window.intellifile?.onDrivesChanged?.((newDrives) => {
      if (Array.isArray(newDrives)) {
        setActiveDrives(newDrives);
      }
      if (currentPath === 'This PC' && Array.isArray(newDrives)) {
        const driveItems = newDrives.map(drive => ({
          name: drive.description || drive.name || drive.label || drive.device,
          path: drive.device || drive.path,
          type: drive.isPortable || drive.type === 'portable' ? 'portable' : 'drive',
          ext: '',
          editable: false,
          size: drive.size || 0,
          available: drive.available || 0,
          isPortable: Boolean(drive.isPortable || drive.type === 'portable'),
          isRemovable: Boolean(drive.isRemovable || drive.isUSB),
          isUSB: Boolean(drive.isUSB),
          isSystem: Boolean(drive.isSystem),
          modified: Date.now()
        }));
        setItems(driveItems);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [currentPath]);

  // Sync default search filters when navigating to a new path (only if no active query)
  useEffect(() => {
    if (!searchQuery || !searchQuery.trim()) {
      setSearchFilters(getDefaultFilters(currentPath));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Stable refs for callbacks used inside the watch effect.
  // This prevents the effect from re-running (and recreating the chokidar
  // watcher) every time applyDirectoryChange/loadDirectory get new identities
  // due to selectedItem, searchQuery, etc. changing.
  const applyDirectoryChangeRef = useRef(null);
  const loadDirectoryRef = useRef(null);

  // Derived values
  const displayItems = useMemo(() => sortItems(items, sortBy, sortDirection), [items, sortBy, sortDirection]);
  const currentFolders = useMemo(() => {
    if (!items || !Array.isArray(items)) return [];
    return items.filter(i => (i.type === 'folder' || i.isDirectory) && !i.protected);
  }, [items]);
  const matchesSearch = useCallback((name) => {
    if (!searchQuery) return true;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  }, [searchQuery]);
  const getParentPath = useCallback((filePath) => {
    if (!filePath) return '';
    const idx = filePath.lastIndexOf('\\');
    if (idx <= 0) return filePath;
    return filePath.slice(0, idx);
  }, []);
  const getExtFromName = useCallback((name) => {
    const idx = name.lastIndexOf('.');
    if (idx <= 0) return '';
    return name.slice(idx).toLowerCase();
  }, []);
  const canVersionItem = useCallback((item) => {
    if (!item || item.type !== 'file') return false;
    return !VERSIONING_BLOCKED_EXTENSIONS.has((item.ext || '').toLowerCase());
  }, []);
  const addItemsToState = useCallback((itemsToAdd) => {
    if (!itemsToAdd || itemsToAdd.length === 0) return;
    setItems(prev => {
      const existing = new Set(prev.map(item => item.path));
      const filtered = itemsToAdd.filter(item => !existing.has(item.path));
      return filtered.length ? [...prev, ...filtered] : prev;
    });
  }, []);
  const removeItemsFromState = useCallback((itemsToRemove) => {
    if (!itemsToRemove || itemsToRemove.length === 0) return;
    const pathSet = new Set(itemsToRemove.map(item => item.path));
    const normPath = (p) => (p || '').toLowerCase().replace(/[\\/]+/g, '/');
    setItems(prev => prev.filter(item => !pathSet.has(item.path)));
    setSelectedItems(prev => prev.filter(item => !pathSet.has(item.path)));
    setSelectedItem(prev => (prev && pathSet.has(prev.path)) ? null : prev);
    setSemanticResults(prev => prev ? prev.filter(r => !pathSet.has(r.path) && !itemsToRemove.some(del => normPath(del.path) === normPath(r.path))) : null);
    setLastSelectedIndex(null);
  }, []);
  const updateItemPathInState = useCallback((oldPath, newPath, newName) => {
    const newExt = getExtFromName(newName);

    setItems(prev => {
      return prev.map(item => {
        if (item.path !== oldPath) return item;
        return {
          ...item,
          path: newPath,
          name: newName,
          ext: item.type === 'file' ? newExt : item.ext
        };
      });
    });

    setSelectedItems(prev => {
      return prev.map(item => {
        if (item.path !== oldPath) return item;
        return {
          ...item,
          path: newPath,
          name: newName,
          ext: item.type === 'file' ? newExt : item.ext
        };
      });
    });

    setSelectedItem(prev => {
      if (!prev || prev.path !== oldPath) return prev;
      return {
        ...prev,
        path: newPath,
        name: newName,
        ext: prev.type === 'file' ? newExt : prev.ext
      };
    });
  }, [getExtFromName]);

  const applyDirectoryChange = useCallback((change) => {
    if (!change?.directoryPath || !currentPath) return;
    const normalizedCurrent = currentPath.toLowerCase().replace(/[\\/]+$/, '');
    const normalizedDirectory = change.directoryPath.toLowerCase().replace(/[\\/]+$/, '');
    if (normalizedCurrent !== normalizedDirectory) return;

    // ── Toast notification with debounced batching ──
    // Queue the event and flush after 800ms of inactivity so that bulk
    // operations (e.g., extracting a ZIP) produce one summary toast
    // instead of dozens of individual ones.
    const batch = watchToastBatchRef.current;
    if (change.action === 'add' && change.item?.name) {
      batch.added.add(change.item.name);
    } else if (change.action === 'change' && change.item?.name) {
      batch.modified.add(change.item.name);
    } else if (change.action === 'unlink' && change.filePath) {
      const name = change.filePath.split(/[\\/]/).pop() || change.filePath;
      batch.removed.add(name);
    }

    if (watchToastTimerRef.current) {
      clearTimeout(watchToastTimerRef.current);
    }
    watchToastTimerRef.current = setTimeout(() => {
      watchToastTimerRef.current = null;
      const { added, modified, removed } = watchToastBatchRef.current;
      watchToastBatchRef.current = { added: new Set(), modified: new Set(), removed: new Set() };

      // Cancel out add+remove pairs (temp file lifecycle: created then deleted)
      for (const name of removed) {
        if (added.has(name)) {
          added.delete(name);
          removed.delete(name);
        }
      }
      // Also remove from modified if it was removed (file changed then deleted)
      for (const name of removed) {
        modified.delete(name);
      }

      const addedArr = [...added];
      const modifiedArr = [...modified];
      const removedArr = [...removed];

      const parts = [];
      if (addedArr.length === 1) {
        parts.push(`📄 New: ${addedArr[0]}`);
      } else if (addedArr.length > 1) {
        parts.push(`📄 ${addedArr.length} files added`);
      }
      if (modifiedArr.length === 1) {
        parts.push(`✏️ Modified: ${modifiedArr[0]}`);
      } else if (modifiedArr.length > 1) {
        parts.push(`✏️ ${modifiedArr.length} files modified`);
      }
      if (removedArr.length === 1) {
        parts.push(`🗑️ Removed: ${removedArr[0]}`);
      } else if (removedArr.length > 1) {
        parts.push(`🗑️ ${removedArr.length} files removed`);
      }

      if (parts.length > 0) {
        const hasRemoved = removedArr.length > 0;
        showToast(parts.join(' · '), {
          type: hasRemoved ? 'warning' : 'info',
          title: 'File Change',
          duration: 3500,
        });
      }
    }, 800);

    if (change.action === 'add' || change.action === 'change') {
      const updatedItem = change.item;
      if (!updatedItem?.path) return;

      if (change.action === 'change' && showVersioning && selectedItem?.type === 'file') {
        const normalize = (p) => (p || '').toLowerCase().replace(/\//g, '\\').replace(/[\\/]+$/, '');
        if (normalize(selectedItem.path) === normalize(updatedItem.path)) {
          window.dispatchEvent(new CustomEvent('refresh-version-timeline'));
        }
      }

      setItems(prev => {
        const existingIndex = prev.findIndex(item => item.path === updatedItem.path);
        const nextItems = [...prev];
        if (existingIndex >= 0) {
          nextItems[existingIndex] = { ...nextItems[existingIndex], ...updatedItem };
        } else if (matchesSearch(updatedItem.name || '')) {
          nextItems.push(updatedItem);
        }
        return nextItems;
      });
      return;
    }

    if (change.action === 'unlink' && change.filePath) {
      setItems(prev => prev.filter(item => item.path !== change.filePath));
      setSelectedItems(prev => prev.filter(item => item.path !== change.filePath));
      setSelectedItem(prev => (prev?.path === change.filePath ? null : prev));
      return;
    }
  }, [currentPath, matchesSearch, selectedItem, showVersioning]);

  // Load directory with filtering and sorting
  const loadDirectory = useCallback(async (dirPath, options = {}) => {
    loadDirectoryRef.current = loadDirectory;
    const { soft = false, trackHistory = true, tabId = null, selectFile = null, suppressLoading = false, skipSearchFilter = false, showHiddenOverride } = options;
    const effectiveShowHidden = showHiddenOverride !== undefined ? showHiddenOverride : showHidden;

    // Handle 'Home' special virtual path
    const isHome = !dirPath || String(dirPath).toLowerCase() === 'home';
    if (isHome) {
      const pathChanged = currentPath !== 'Home';
      setCurrentPath('Home');
      setAddressPath('Home');
      updateBreadcrumb('Home');
      setItems([]);
      setSelectedItem(null);
      setSelectedItems([]);
      setLoading(false);
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSearchQuery('');
      searchQueryRef.current = '';
      setSemanticResults(null);
      setSemanticLoading(false);
      setSearchFilters(getDefaultFilters('Home'));
      try {
        localStorage.setItem('lastDirectoryCache', JSON.stringify({ path: 'Home', items: [] }));
      } catch (_) {}
      if (trackHistory && pathChanged) {
        updateHistory('Home', tabId);
      }
      if (pathChanged) {
        updateActiveTab('Home', tabId);
      }
      return { success: true, items: [] };
    }

    // Handle 'This PC' special virtual path
    const isThisPC = dirPath === 'This PC' || String(dirPath).toLowerCase() === 'this pc';
    if (isThisPC) {
      const pathChanged = currentPath !== 'This PC';
      setCurrentPath('This PC');
      setAddressPath('This PC');
      updateBreadcrumb('This PC');
      setSelectedItem(null);
      setSelectedItems([]);
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSearchQuery('');
      searchQueryRef.current = '';
      setSemanticResults(null);
      setSemanticLoading(false);
      setSearchFilters(getDefaultFilters('This PC'));
      setLoading(true);
      
      try {
        let drivesRes = null;
        if (window.intellifile?.getDrivesInfo) {
          drivesRes = await window.intellifile.getDrivesInfo();
        } else if (ipcRenderer) {
          drivesRes = await ipcRenderer.invoke('get-drives-info');
        }
        
        const rawDrives = (drivesRes?.success && Array.isArray(drivesRes.drives)) ? drivesRes.drives : [];
        const driveItems = rawDrives.map(drive => ({
          name: drive.description || drive.name || drive.label || drive.device,
          path: drive.device || drive.path,
          type: (drive.isPortable || drive.type === 'portable') ? 'portable' : 'drive',
          ext: '',
          editable: false,
          size: drive.size || 0,
          available: drive.available || 0,
          isPortable: Boolean(drive.isPortable || drive.type === 'portable'),
          isRemovable: Boolean(drive.isRemovable || drive.isUSB),
          isUSB: Boolean(drive.isUSB),
          isSystem: Boolean(drive.isSystem),
          modified: Date.now()
        }));
        setItems(driveItems);
      } catch (err) {
        console.error('Failed to load drives:', err);
        setItems([]);
      } finally {
        setLoading(false);
      }
      
      if (trackHistory && pathChanged) {
        updateHistory('This PC', tabId);
      }
      if (pathChanged) {
        updateActiveTab('This PC', tabId);
      }
      return { success: true, items: [] };
    }

    // Handle 'Starred' special virtual path
    const isStarredPath = dirPath === 'Starred' || String(dirPath).toLowerCase() === 'starred';
    if (isStarredPath) {
      const pathChanged = currentPath !== 'Starred';
      setCurrentPath('Starred');
      setAddressPath('Starred');
      updateBreadcrumb('Starred');
      setSelectedItem(null);
      setSelectedItems([]);
      setSearchQuery('');
      setSemanticResults(null);
      setLoading(true);
      
      try {
        const starredItems = getStarredItems();
        setItems(starredItems);
      } catch (err) {
        console.error('Failed to load starred items:', err);
        setItems([]);
      } finally {
        setLoading(false);
      }
      
      if (trackHistory && pathChanged) {
        updateHistory('Starred', tabId);
      }
      if (pathChanged) {
        updateActiveTab('Starred', tabId);
      }
      return { success: true, items: [] };
    }

    const normalizedPath = (dirPath || '').replace(/[\\/]+$/, '');
    const loadKey = `${normalizedPath}::${soft ? 'soft' : 'full'}::${suppressLoading ? 'suppress' : 'show'}`;
    const inFlight = directoryLoadInFlightRef.current.get(loadKey);
    if (inFlight) {
      return inFlight;
    }

    const requestId = ++loadRequestRef.current;
    const isStale = () => requestId !== loadRequestRef.current;

    if (!soft && !suppressLoading) {
      setLoading(true);
      setRenamingItem(null);
      setShowContextMenu(false);
    }

    const requestPromise = (async () => {
      try {
        const result = await ipcRenderer?.invoke('list-directory', dirPath, { showHidden: effectiveShowHidden });
        if (isStale()) return;
        if (!result || result.error) {
          console.error('Error loading directory:', result?.error || 'Unknown error');
          setItems([]);
          if (dirPath && dirPath !== 'C:\\') {
            const parentPath = dirPath.substring(0, dirPath.lastIndexOf('\\'));
            if (parentPath && parentPath !== dirPath) {
              setTimeout(() => {
                if (!isStale()) {
                  loadDirectory(parentPath, { soft, trackHistory, tabId });
                }
              }, 100);
            }
          }
        } else {
          let loadedItems = result.items || [];

          // Apply search filter
          if (searchQuery && !skipSearchFilter) {
            loadedItems = loadedItems.filter(item =>
              item.name.toLowerCase().includes(searchQuery.toLowerCase())
            );
          }

          // Apply sorting
          loadedItems.sort((a, b) => {
            // Folders always first
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;

            let cmp = 0;
            switch (sortBy) {
              case 'date':
                cmp = a.modified - b.modified;
                break;
              case 'size':
                cmp = a.size - b.size;
                break;
              case 'type':
                cmp = a.ext.localeCompare(b.ext);
                break;
              default:
                cmp = a.name.localeCompare(b.name);
            }

            return sortDirection === 'desc' ? -cmp : cmp;
          });

          setItems(loadedItems);
          // Mark UI ready – allow indexing to start
          setCanStartIndexing(true);
          // Cache the loaded directory for instant next launch
          try {
            const cache = {
              path: dirPath,
              items: loadedItems,
              timestamp: Date.now()
            };
            localStorage.setItem('lastDirectoryCache', JSON.stringify(cache));
          } catch (_) { }
          // Asynchronously fetch folder sizes for first 3 folders only (avoid blocking UI)
          (async () => {
            try {
              const folders = loadedItems.filter(i => i.type === 'folder');
              const limit = 3; // limit to 3 to avoid UI lag
              for (let i = 0; i < Math.min(folders.length, limit); i++) {
                const folder = folders[i];
                // Add small yield to allow UI to remain responsive
                await new Promise(resolve => setImmediate(resolve));
                try {
                  const details = await ipcRenderer?.invoke('get-file-details', folder.path);
                  if (details && details.success && typeof details.details?.size === 'number') {
                    setItems(prev => prev.map(it => it.path === folder.path ? { ...it, size: details.details.size } : it));
                  }
                } catch (err) {
                  // ignore errors for individual folders
                }
              }
            } catch (e) {
              // ignore
            }
          })();
          const isThisPC = dirPath === 'This PC' || String(dirPath).toLowerCase() === 'this pc';
          const actualPath = isThisPC ? 'This PC' : (result?.path || dirPath);

          if (actualPath) {
            const pathChanged = !currentPath || actualPath !== currentPath;
            if (pathChanged) {
              setCurrentPath(actualPath);
              setAddressPath(actualPath);
              updateBreadcrumb(actualPath);
              // Clear search query and results when navigating to a new folder
              searchIdRef.current++;
              if (searchDebounceRef.current) {
                clearTimeout(searchDebounceRef.current);
                searchDebounceRef.current = null;
              }
              setSearchQuery('');
              searchQueryRef.current = '';
              setSemanticResults(null);
              setSemanticLoading(false);
              setSearchFilters(getDefaultFilters(actualPath));
              // Notify sidebar to track this folder visit for "Frequently used"
              try {
                window.dispatchEvent(new CustomEvent('intellifile-folder-visited', { detail: { path: actualPath } }));
              } catch (_) { }
            }

            let selected = null;
            if (selectFile) {
              const selectNameLower = selectFile.toLowerCase();
              const found = loadedItems.find(i =>
                i.name.toLowerCase() === selectNameLower ||
                i.path.toLowerCase() === selectNameLower
              );
              if (found) {
                selected = found;
                setSelectedItems([found]);
                setSelectedItem(found);
                setLastSelectedIndex(loadedItems.indexOf(found));
                if (onFileSelect) onFileSelect(found);

                let attempts = 0;
                const scrollInterval = setInterval(() => {
                  const els = document.querySelectorAll('.file-item.selected');
                  if (els.length > 0) {
                    els[0].scrollIntoView({ behavior: 'auto', block: 'center' });
                    clearInterval(scrollInterval);
                  }
                  if (++attempts > 20) clearInterval(scrollInterval);
                }, 50);
              }
            }

            if (!selected) {
              // Don't wipe selectedItem during a refresh when search results are
              // showing — the selected item belongs to search, not the directory list.
              if (!isSearchActive) {
                setSelectedItem(prev => (prev && loadedItems.some(i => i.path === prev.path)) ? prev : null);
                setSelectedItems(prev => prev.filter(pItem => loadedItems.some(i => i.path === pItem.path)));
                setLastSelectedIndex(null);
              }
            }

            if (trackHistory && pathChanged) {
              updateHistory(actualPath, tabId);
            }
            if (pathChanged) {
              updateActiveTab(actualPath, tabId);
            }
            // If this navigation was triggered from Explorer and no exact file was provided,
            // show a small recent-file chooser instead of guessing the newest file.
            if (pathChanged && options && options.fromExplorer && !selectFile) {
              const recentFiles = loadedItems
                .filter(i => i.type === 'file')
                .sort((a, b) => b.modified - a.modified)
                .slice(0, 6);
              setRecentChooserFiles(recentFiles);
              setShowRecentChooser(true);
            } else {
              setShowRecentChooser(false);
              setRecentChooserFiles([]);
            }
          }
        }
      } catch (error) {
        if (isStale()) return;
        console.error('Error:', error);
      } finally {
        directoryLoadInFlightRef.current.delete(loadKey);
        if (!soft && !isStale()) {
          setLoading(false);
        }
      }
    })();

    directoryLoadInFlightRef.current.set(loadKey, requestPromise);
    return requestPromise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateBreadcrumb, searchQuery, sortBy, sortDirection, showHidden, updateHistory, updateActiveTab, setCurrentPath, setAddressPath, setRenamingItem, onFileSelect, currentPath]);

  const handleShowHiddenChange = useCallback((newVal) => {
    setShowHidden(newVal);
    if (currentPath && currentPath !== 'Home' && currentPath !== 'This PC') {
      loadDirectory(currentPath, { soft: true, showHiddenOverride: newVal });
    }
  }, [currentPath, loadDirectory]);

  const isFirstHiddenMount = useRef(true);
  useEffect(() => {
    if (isFirstHiddenMount.current) {
      isFirstHiddenMount.current = false;
      return;
    }
    if (currentPath && currentPath !== 'Home' && currentPath !== 'This PC') {
      loadDirectory(currentPath, { soft: true });
    }
  }, [showHidden, currentPath, loadDirectory]);

  const handleRecentChooserSelect = (file) => {
    setShowRecentChooser(false);
    // Prefer selecting using existing logic to keep behavior consistent and performant
    loadDirectory(currentPath, { selectFile: file.name, soft: true, trackHistory: false });
  };

  // Initialize with startup path, saved path or Documents folder
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    const init = async () => {
      let startupPathData = null;
      try {
        if (window.intellifile?.getStartupPath) {
          startupPathData = await window.intellifile.getStartupPath();
        }
      } catch (e) {
        console.warn('Failed to fetch startup path:', e);
      }

      if (startupPathData && startupPathData.path) {
        loadDirectory(startupPathData.path, {
          trackHistory: true,
          selectFile: startupPathData.selectFile,
          fromExplorer: !!startupPathData.fromExplorer
        });
        return;
      }

      if (currentPath) {
        loadDirectory(currentPath, { trackHistory: false, suppressLoading: items.length > 0 });
      } else {
        loadDirectory('Home', { trackHistory: false });
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure breadcrumb is set on first load when currentPath is known but breadcrumb is empty
  useEffect(() => {
    if (currentPath && (!breadcrumb || breadcrumb.length === 0)) {
      updateBreadcrumb(currentPath);
    }
  }, [currentPath, breadcrumb, updateBreadcrumb]);

  // Listen for open-path event from main process (for second instance activations)
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleOpenPath = (data) => {
      console.log('[FileExplorer] Received open-path event:', data);
      if (window.intellifile?.showToast) {
        window.intellifile.showToast('Received open path request: ' + (data?.path || 'unknown'), { type: 'info' });
      } else {
        // Fallback if showToast isn't directly exposed
        const event = new CustomEvent('show-toast', { detail: { message: 'Open Path Triggered: ' + data?.selectFile } });
        window.dispatchEvent(event);
      }

      if (data && data.path) {
        loadDirectory(data.path, {
          trackHistory: true,
          selectFile: data.selectFile,
          fromExplorer: !!data.fromExplorer
        });
      }
    };

    ipcRenderer.on('open-path', handleOpenPath);
    return () => {
      ipcRenderer.off('open-path', handleOpenPath);
    };
  }, [loadDirectory]);


  // Keep the stable refs in sync with the latest callback versions
  useEffect(() => {
    applyDirectoryChangeRef.current = applyDirectoryChange;
  }, [applyDirectoryChange]);
  useEffect(() => {
    loadDirectoryRef.current = loadDirectory;
  }, [loadDirectory]);

  // Watch the active directory and apply incremental updates.
  useEffect(() => {
    if (!ipcRenderer || !currentPath) return undefined;

    const normalizedCurrent = currentPath.toLowerCase().replace(/[\\/]+$/, '');
    if (normalizedCurrent === 'home' || normalizedCurrent === 'this pc' || /^[a-z]:$/.test(normalizedCurrent) || normalizedCurrent.startsWith('::{') || !currentPath.includes('\\')) {
      return undefined;
    }

    const previousWatched = watchedDirectoryRef.current;

    if (previousWatched && previousWatched !== normalizedCurrent) {
      ipcRenderer.invoke('unwatch-directory', previousWatched).catch(() => { });
    }

    watchedDirectoryRef.current = normalizedCurrent;
    ipcRenderer.invoke('watch-directory', currentPath).catch(() => { });

    const handleDirectoryChanged = (event) => {
      applyDirectoryChange(event);
    };


    const handleVersionUpdated = (event) => {
      if (!event?.filePath || !currentPath) return;
      // Extract the parent directory of the changed file and compare it
      // against currentPath. Previously this compared the file path directly
      // against the directory path, which never matched.
      const fileDir = event.filePath.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '').toLowerCase();
      const normCurrent = currentPath.toLowerCase().replace(/[\\/]+$/, '');
      if (fileDir !== normCurrent) return;
      loadDirectory(currentPath, { soft: true, trackHistory: false });
    };

    ipcRenderer.on('directory-changed', handleDirectoryChanged);
    ipcRenderer.on('version-updated', handleVersionUpdated);

    return () => {
      ipcRenderer.off('directory-changed', handleDirectoryChanged);
      ipcRenderer.off('version-updated', handleVersionUpdated);
      ipcRenderer.invoke('unwatch-directory', normalizedCurrent).catch(() => { });
      // Clear any pending toast batch timer on cleanup
      if (watchToastTimerRef.current) {
        clearTimeout(watchToastTimerRef.current);
        watchToastTimerRef.current = null;
        watchToastBatchRef.current = { added: new Set(), modified: new Set(), removed: new Set() };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Event Handlers
  const handleAddressSubmit = (e) => {
    e.preventDefault();
    const cmd = (addressPath || '').trim().toLowerCase();
    // Allow quick shell commands in the address bar: 'cmd', 'powershell', 'pwsh'
    if (cmd === 'cmd' || cmd === 'powershell' || cmd === 'pwsh') {
      const shellOpt = cmd === 'cmd' ? 'cmd' : 'powershell';
      ipcRenderer?.invoke('open-terminal-here', currentPath || process.env.USERPROFILE, { shell: shellOpt });
      return;
    }
    if (addressPath) loadDirectory(addressPath, { suppressLoading: true, trackHistory: true });
  };

  // File operation handlers
  const openFileWithDefaultApp = async (filePath) => {
    try {
      trackRecentFile(filePath);
      const result = await window.electron.ipcRenderer.invoke('open-file', filePath);
      if (result.isLocked) {
        // File is locked — show unlock/access modal
        setLockModalFile({
          fileId: result.fileId,
          name: result.originalName || filePath.split(/[\\/]/).pop(),
          path: filePath,
          originalName: result.originalName,
        });
        setLockModalMode('access');
        setShowLockModal(true);
        return;
      }
      if (!result.success) console.error('Error opening file:', result.error);
    } catch (err) {
      console.error('Error opening file:', err);
    }
  };

  const handleLockFile = (item) => {
    const target = item || selectedItem;
    if (!target || target.type !== 'file') return;
    setLockModalFile({ path: target.path, name: target.name, size: target.size });
    setLockModalMode('lock');
    setShowLockModal(true);
  };

  const handleUnlockFile = (item) => {
    const target = item || selectedItem;
    if (!target) return;

    // Look up the file ID from the encrypted path
    window.intellifile?.fileLock?.getStatus?.(target.path).then((status) => {
      if (status?.isLocked && status.fileId) {
        setLockModalFile({
          fileId: status.fileId,
          name: status.entry?.originalName || target.name,
          path: target.path,
          size: status.entry?.originalSize,
          originalName: status.entry?.originalName,
        });
        setLockModalMode('unlock');
        setShowLockModal(true);
      } else {
        showErrorToast('Could not find lock information for this file.');
      }
    });
  };

  useEffect(() => {
    const handlePromptRename = (e) => {
      const { item, fileId, newName } = e.detail || {};
      if (!item) return;
      window.intellifile?.fileLock?.getStatus?.(item.path).then((status) => {
        setLockModalFile({
          fileId: fileId || status?.fileId,
          name: status?.entry?.originalName || item.name,
          path: item.path,
          size: status?.entry?.originalSize || item.size,
          originalName: status?.entry?.originalName || item.name,
          targetNewName: newName || item.name
        });
        setLockModalMode('renameLocked');
        setShowLockModal(true);
      });
    };

    const handlePromptDelete = (e) => {
      const { item, fileId } = e.detail || {};
      if (!item) return;
      window.intellifile?.fileLock?.getStatus?.(item.path).then((status) => {
        setLockModalFile({
          fileId: fileId || status?.fileId,
          name: status?.entry?.originalName || item.name,
          path: item.path,
          size: status?.entry?.originalSize || item.size,
          originalName: status?.entry?.originalName || item.name,
        });
        setLockModalMode('deleteLocked');
        setShowLockModal(true);
      });
    };

    window.addEventListener('prompt-locked-rename', handlePromptRename);
    window.addEventListener('prompt-locked-delete', handlePromptDelete);
    return () => {
      window.removeEventListener('prompt-locked-rename', handlePromptRename);
      window.removeEventListener('prompt-locked-delete', handlePromptDelete);
    };
  }, []);

  const handleLockModalSuccess = (result) => {
    // Refresh directory to reflect file changes
    if (currentPath) {
      loadDirectory(currentPath, { suppressLoading: true });
    }
    if (result?.action === 'locked') {
      showToast(`File locked: ${result.filePath?.split(/[\\/]/).pop() || 'file'}`, { type: 'success', title: 'File Locked' });
    } else if (result?.action === 'unlocked') {
      showToast(`File unlocked: ${result.restoredPath?.split(/[\\/]/).pop() || 'file'}`, { type: 'success', title: 'File Unlocked' });
    } else if (result?.action === 'renamed') {
      showToast(`Locked file renamed: ${result.newPath?.split(/[\\/]/).pop() || 'file'}`, { type: 'success', title: 'File Renamed' });
    } else if (result?.action === 'deleted') {
      showToast('Locked file permanently deleted.', { type: 'success', title: 'File Deleted' });
    }
  };

  const handleFolderClick = (item) => {
    if (!item) return;
    if (item.type === 'folder' || item.type === 'drive' || (item.type === 'portable' && item.type !== 'file')) {
      setShowPreview(false);
      loadDirectory(item.path);
    } else if (item.type === 'file') {
      trackRecentFile(item.path, item);
      openFileWithDefaultApp(item.path);
    }
  };

  const handleOpen = (item) => {
    if (!item) return;
    if (item.type === 'folder' || item.type === 'drive' || (item.type === 'portable' && item.type !== 'file')) {
      setShowPreview(false);
      loadDirectory(item.path);
    } else if (item.type === 'file') {
      trackRecentFile(item.path, item);
      openFileWithDefaultApp(item.path);
    }
  };

  const handleTabSelect = useCallback((tab) => {
    const targetPath = handleSelectTab(tab);
    // React state updates activeTabId asynchronously.  Pass the selected tab
    // explicitly so this load never writes the selected folder into the tab
    // that was active a moment ago.
    loadDirectory(targetPath, { trackHistory: false, tabId: tab.id });
  }, [handleSelectTab, loadDirectory]);

  const handleTabClose = useCallback((tabId) => {
    handleCloseTab(tabId, (nextPath, nextTabId) => {
      loadDirectory(nextPath, { trackHistory: false, tabId: nextTabId });
    });
  }, [handleCloseTab, loadDirectory]);

  const handleItemClick = (item, idx, e) => {
    if (renamingItem) return;
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (item.type === 'file') {
      trackRecentFile(item.path, item);
    }

    // Clear text selection when shift-clicking to avoid browser text highlight
    if (isShift) {
      try { window.getSelection()?.removeAllRanges(); } catch (_) { }
    }

    let newSelection = [];

    if (isShift && anchorIndexRef.current !== null) {
      // anchorIndexRef is always up-to-date (no stale closure)
      const anchor = anchorIndexRef.current;
      const start = Math.min(anchor, idx);
      const end = Math.max(anchor, idx);
      newSelection = displayItems.slice(start, end + 1);
      // Do NOT update anchor on shift-click (anchor stays at original click)
    } else if (isCtrl) {
      const alreadySelected = selectedItems.find(i => i.path === item.path);
      newSelection = alreadySelected
        ? selectedItems.filter(i => i.path !== item.path)
        : [...selectedItems, item];
      anchorIndexRef.current = idx;
      setLastSelectedIndex(idx);
    } else {
      newSelection = [item];
      anchorIndexRef.current = idx;
      setLastSelectedIndex(idx);
    }

    setSelectedItems(newSelection);
    setSelectedItem(item);
    // When searching, allow preview in all view modes.
    // When not searching, auto-open preview on single click ONLY in list and details view modes (not icons mode).
    const allowPreview = isSearchActive || viewMode === 'list' || viewMode === 'details';
    if (item.type === 'file' && allowPreview) {
      setShowPreview(true);
    } else {
      setShowPreview(false);
    }
    if (onFileSelect) onFileSelect(item);
  };

  useEffect(() => {
    // When view mode is switched to icons, close preview if active
    if (viewMode === 'icons' && !isSearchActive) {
      setShowPreview(false);
    }
  }, [viewMode, isSearchActive]);

  const handleCharacterType = useCallback((char) => {
    if (renamingItem || !displayItems || displayItems.length === 0) return;

    const lowerChar = char.toLowerCase();
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    typeBufferRef.current += lowerChar;

    typeTimerRef.current = setTimeout(() => {
      typeBufferRef.current = '';
    }, 1000);

    const query = typeBufferRef.current;
    const isRepeatedSingleChar = query.length > 0 && query.split('').every(c => c === lowerChar);

    let match = null;

    if (isRepeatedSingleChar) {
      const matchingIndices = [];
      displayItems.forEach((item, index) => {
        if ((item.name || '').toLowerCase().startsWith(lowerChar)) {
          matchingIndices.push(index);
        }
      });

      if (matchingIndices.length > 0) {
        const nextIndex = matchingIndices.find(idx => idx > lastSelectedIndex);
        const targetIndex = nextIndex !== undefined ? nextIndex : matchingIndices[0];
        match = displayItems[targetIndex];
      }
    } else {
      match = displayItems.find(item => (item.name || '').toLowerCase().startsWith(query));

      if (!match && query.length > 1) {
        match = displayItems.find(item => (item.name || '').toLowerCase().startsWith(lowerChar));
        if (match) typeBufferRef.current = lowerChar;
      }
    }

    if (match) {
      setSelectedItem(match);
      setSelectedItems([match]);
      const normPath = (p) => (p || '').toLowerCase().replace(/[\\/]+/g, '/');
      const idx = displayItems.findIndex(i => normPath(i.path) === normPath(match.path));
      if (idx !== -1) {
        anchorIndexRef.current = idx;
        setLastSelectedIndex(idx);
      }
      setTempHighlightedPath(match.path);

      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setTempHighlightedPath(null);
      }, 2000);

      setTimeout(() => {
        try {
          const escapedPath = (match.path || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const el = document.querySelector(`[data-path="${escapedPath}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (_) { }
      }, 50);
    }
  }, [renamingItem, displayItems, lastSelectedIndex]);

  const handleBreadcrumbClick = (path) => {
    // Load breadcrumb navigation in background without spinner
    loadDirectory(path.replace(/\/$/, ''), { suppressLoading: true, trackHistory: true });
  };

  const handleBack = () => {
    const prevPath = navBack();
    if (prevPath) loadDirectory(prevPath, { suppressLoading: true, trackHistory: false, tabId: activeTabId });
  };

  const handleForward = () => {
    const nextPath = navForward();
    if (nextPath) loadDirectory(nextPath, { suppressLoading: true, trackHistory: false, tabId: activeTabId });
  };

  const handleUp = () => {
    const parentPath = navUp();
    if (parentPath) loadDirectory(parentPath, { suppressLoading: true });
  };

  const handleCopy = () => {
    fileOps.handleCopy(selectedItems, selectedItem);
    setShowContextMenu(false);
  };

  const handleCut = () => {
    fileOps.handleCut(selectedItems, selectedItem);
    setShowContextMenu(false);
  };

  const handlePaste = async () => {
    if (clipboard?.operation === 'cut' && clipboard.items?.length && currentPath) {
      const itemsToAdd = clipboard.items
        .filter(item => getParentPath(item.path) !== currentPath)
        .map(item => ({
          ...item,
          path: `${currentPath}\\${item.name}`
        }));
      addItemsToState(itemsToAdd);
    }
    await fileOps.handlePaste(currentPath, () => { });
  };

  const handleRename = async () => {
    if (!renamingItem) return;

    if (renamingItem?.protected) {
      showErrorToast('Cannot rename system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      setRenamingItem(null);
      return;
    }

    if (renamingItem && renameValue && renameValue !== renamingItem.name) {
      let parentDir = currentPath;
      if (!parentDir || parentDir === 'HOME') {
        if (renamingItem.path && renamingItem.path.includes('\\')) {
          parentDir = renamingItem.path.substring(0, renamingItem.path.lastIndexOf('\\'));
        } else if (renamingItem.path && renamingItem.path.includes('/')) {
          parentDir = renamingItem.path.substring(0, renamingItem.path.lastIndexOf('/'));
        }
      }

      const ok = await fileOps.handleRename(renamingItem, renameValue);
      if (ok) {
        const newPath = parentDir ? `${parentDir}\\${renameValue}` : renameValue;
        updateItemPathInState(renamingItem.path, newPath, renameValue);
        window.dispatchEvent(new CustomEvent('recent-files-updated'));
        handleRefresh();
      }
    }
    setRenamingItem(null);
  };

  const confirmDeleteItems = async (itemsToDelete) => {
    const ok = await fileOps.handleDelete(
      itemsToDelete,
      null,
      currentPath,
      null,
      { skipConfirm: true }
    );

    if (ok) {
      const normPath = (p) => (p || '').toLowerCase().replace(/[\\/]+/g, '/');
      setItems(prev => prev.filter(item => !itemsToDelete.some(del => normPath(del.path) === normPath(item.path))));
      setSemanticResults(prev => prev ? prev.filter(r => !itemsToDelete.some(del => normPath(del.path) === normPath(r.path))) : null);
      setSelectedItems([]);
      setSelectedItem(null);
      anchorIndexRef.current = null;
      setLastSelectedIndex(null);
    } else {
      showErrorToast('Delete failed.', 'The delete operation did not complete.', 'Check whether the file is open or protected, then try again.');
    }
  };

  const handleDelete = async () => {
    const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    if (itemsToDelete.length === 0) {
      setShowContextMenu(false);
      return;
    }

    if (itemsToDelete.some(item => item.protected)) {
      showErrorToast('Cannot delete system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      setShowContextMenu(false);
      return;
    }

    setShowContextMenu(false);

    const skipModal = localStorage.getItem('intellifile_skip_delete_confirm') === 'true';
    if (skipModal) {
      await confirmDeleteItems(itemsToDelete);
    } else {
      setItemsPendingDelete(itemsToDelete);
      setShowDeleteModal(true);
    }
  };

  const handleCreateFolder = async () => {
    if (!currentPath) return;

    const folderName = 'New Folder';

    // Create the folder
    const created = await fileOps.handleCreateFolder(currentPath, () => { });

    if (created) {
      const newPath = created.path || (currentPath + '\\' + folderName);
      const actualName = newPath.split(/[\\/]/).pop() || folderName;
      // Create a new item object for rename mode
      const newItem = {
        path: newPath,
        name: actualName,
        type: 'folder',
        size: 0,
        modified: new Date().toISOString(),
        protected: false
      };

      // Immediately enter rename mode
      setRenamingItem(newItem);
      setRenameValue(folderName);

      // Focus the input field immediately
      setTimeout(() => {
        inputRef.current?.focus?.();
        inputRef.current?.select?.();
      }, 10);

      addItemsToState([newItem]);
    }
  };

  const handleCreateFile = async (fileName) => {
    if (!currentPath || !fileName) return;

    // Create the file
    const created = await fileOps.handleCreateFile(currentPath, fileName, () => { });

    if (created) {
      const newPath = created.path || (currentPath + '\\' + fileName);
      const actualName = newPath.split(/[\\/]/).pop() || fileName;
      // Create a new item object for rename mode
      const newItem = {
        path: newPath,
        name: actualName,
        type: 'file',
        size: 0,
        modified: new Date().toISOString(),
        protected: false
      };

      // Immediately enter rename mode
      setRenamingItem(newItem);
      setRenameValue(fileName);

      // Focus the input field immediately
      setTimeout(() => {
        inputRef.current?.focus?.();
        inputRef.current?.select?.();
      }, 10);

      addItemsToState([newItem]);
    }
  };

  const handleUndo = async () => {
    const success = await fileOps.handleUndo(() => {
      handleRefresh();
    });
    if (success) {
      showToast('Undo action completed.', { type: 'info', title: 'Undo' });
    }
  };

  const handleRedo = async () => {
    const success = await fileOps.handleRedo(() => {
      handleRefresh();
    });
    if (success) {
      showToast('Redo action completed.', { type: 'info', title: 'Redo' });
    }
  };

  const handleCopyPath = async () => {
    const item = selectedItem;
    if (item) {
      await ipcRenderer?.invoke('copy-to-clipboard', item.path);
    }
  };

  const getParentDirectory = useCallback((filePath) => {
    if (!filePath) return '';
    const normalized = String(filePath).replace(/[\\/]+$/, '');
    const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    return idx > 0 ? normalized.slice(0, idx) : normalized;
  }, []);

  const handleOpenTerminal = async () => {
    const targetPath = selectedItem?.type === 'folder'
      ? selectedItem.path
      : selectedItem?.path
        ? getParentDirectory(selectedItem.path)
        : currentPath;
    if (targetPath) {
      await ipcRenderer?.invoke('open-terminal-here', targetPath);
    }
  };

  const handleOpenInVSCode = async () => {
    const targetPath = selectedItem?.type === 'folder'
      ? selectedItem.path
      : selectedItem?.path
        ? getParentDirectory(selectedItem.path)
        : currentPath;
    if (targetPath) {
      await ipcRenderer?.invoke('open-in-vscode', targetPath);
    }
  };

  const handlePinToFavorites = (targetFolder) => {
    const folder = targetFolder || selectedItem || (currentPath && String(currentPath).toLowerCase() !== 'home' ? { path: currentPath, name: currentPath.split(/[\\/]/).pop(), type: 'folder' } : null);
    if (!folder || !folder.path) return;

    try {
      const raw = localStorage.getItem('intellifile-favorites');
      const favs = raw ? JSON.parse(raw) : [];
      const norm = folder.path.toLowerCase().replace(/[\\/]+$/, '');
      const existingIdx = favs.findIndex(f => (f.path || '').toLowerCase().replace(/[\\/]+$/, '') === norm);

      let updated;
      if (existingIdx >= 0) {
        updated = favs.filter((_, idx) => idx !== existingIdx);
        showToast(`Unpinned ${folder.name || 'folder'} from Quick access`, { type: 'info' });
      } else {
        const folderName = folder.name || folder.path.split(/[\\/]/).pop();
        updated = [...favs, { path: folder.path, name: folderName }];
        showToast(`Pinned ${folderName} to Quick access`, { type: 'success' });
      }

      localStorage.setItem('intellifile-favorites', JSON.stringify(updated));
      window.dispatchEvent(new StorageEvent('storage', { key: 'intellifile-favorites', newValue: JSON.stringify(updated) }));
    } catch (err) {
      console.error('Error toggling pin to favorites:', err);
    }
  };

  const isSelectedFolderPinned = (() => {
    const folder = selectedItem || (currentPath && String(currentPath).toLowerCase() !== 'home' ? { path: currentPath } : null);
    if (!folder || !folder.path) return false;
    try {
      const raw = localStorage.getItem('intellifile-favorites');
      const favs = raw ? JSON.parse(raw) : [];
      const norm = folder.path.toLowerCase().replace(/[\\/]+$/, '');
      return favs.some(f => (f.path || '').toLowerCase().replace(/[\\/]+$/, '') === norm);
    } catch {
      return false;
    }
  })();

  const handleRefresh = () => {
    // Normal refresh without closing preview
    if (currentPath) {
      loadDirectory(currentPath, { soft: true, trackHistory: false });
    }
  };

  const handleProperties = () => {
    if ((!selectedItem || isEmptySpaceContext) && currentPath) {
      const folderName = currentPath.split('\\').pop() || currentPath.split('/').pop() || currentPath;
      setSelectedItem({
        name: folderName,
        path: currentPath,
        type: 'folder'
      });
    }
    setShowProperties(true);
  };

  const handleTogglePreview = () => {
    if (!selectedItem || selectedItem.type !== 'file') return;
    if (showPreview && !showVersioning) {
      setShowPreview(false);
      setPreviewClosing(false);
    } else {
      setPreviewClosing(false);
      setShowVersioning(false);
      setShowPreview(true);
    }
  };

  // Preview close handling
  const handlePreviewCloseStart = () => {
    setPreviewClosing(true);
  };

  const handlePreviewCloseComplete = () => {
    setShowPreview(false);
    setPreviewClosing(false);
  };

  const handleVersioning = () => {
    if (selectedItem && selectedItem.type === 'file') {
      if (!canVersionItem(selectedItem)) {
        setShowPreview(false);
        setShowVersioning(true);
        return;
      }
      setShowPreview(false);
      setShowVersioning(true);
    }
  };

  // When the tour starts from Home, open a real folder so later steps can show
  // file actions. Never change a folder the person is already browsing.
  useEffect(() => {
    const handleTourStart = async () => {
      if (currentPath && currentPath !== 'Home') return;
      try {
        const rootsRes = await ipcRenderer?.invoke('get-system-roots');
        const special = rootsRes?.data?.specialFolders || [];
        const targetFolder = special.find(f => f.id === 'documents' && f.path)
          || special.find(f => f.id === 'desktop' && f.path)
          || special.find(f => f.id === 'downloads' && f.path)
          || special.find(f => f.path && !f.virtual);

        if (targetFolder?.path) {
          if (loadDirectoryRef.current) {
            loadDirectoryRef.current(targetFolder.path, { trackHistory: true });
          }
        }
      } catch (err) {
        console.error('[Tour] Error navigating away from Home for tour:', err);
      }
    };

    window.addEventListener('intellifile-tour-start', handleTourStart);
    return () => window.removeEventListener('intellifile-tour-start', handleTourStart);
  }, [currentPath]);

  // The guided tour opens a real, versionable file so users can see the
  // Version History timeline rather than only reading about it.
  useEffect(() => {
    const openTourVersionHistory = () => {
      const extensionPriority = ['.docx', '.xlsx', '.xls', '.txt', '.md', '.csv', '.rtf', '.pdf', '.js', '.py', '.json'];
      let file = displayItems
        .filter((item) => item.type === 'file' && canVersionItem(item))
        .sort((a, b) => {
          const aRank = extensionPriority.indexOf((a.ext || '').toLowerCase());
          const bRank = extensionPriority.indexOf((b.ext || '').toLowerCase());
          return (aRank === -1 ? extensionPriority.length : aRank) - (bRank === -1 ? extensionPriority.length : bRank);
        })[0];

      if (!file && displayItems.length > 0) {
        file = displayItems.find((item) => item.type === 'file');
      }

      if (!file) return;
      setSelectedItem(file);
      setSelectedItems([file]);
      setShowPreview(false);
      setShowVersioning(true);
    };
    window.addEventListener('intellifile-tour-open-version-history', openTourVersionHistory);
    return () => window.removeEventListener('intellifile-tour-open-version-history', openTourVersionHistory);
  }, [canVersionItem, displayItems]);


  const handleOpenWith = async (item) => {
    // Set the item and display the modal. Candidate fetching is done inside the modal.
    setOpenWithItem(item);
    setShowOpenWith(true);
  };

  const handleCompress = async () => {
    if (!selectedItem) return;
    await handleCompressZip?.(selectedItem);
  };

  const handleExtract = async () => {
    if (!selectedItem) return;
    await handleExtractZip?.(selectedItem);
  };

  const handleRefreshVersioningTimeline = () => {
    window.dispatchEvent(new CustomEvent('refresh-version-timeline'));
  };

  const handleSmartCleanupVersioningTimeline = async () => {
    if (!selectedItem?.path) return;

    try {
      const result = await smartCleanupVersions(selectedItem.path);
      if (!result?.success) {
        showErrorToast('Cleanup failed.', result?.error || 'Unknown error', 'Try closing the file and running cleanup again.');
        return;
      }

      const deleted = Number(result?.deleted_versions || 0);
      const maintenance = Number(result?.maintenance_count || 0);
      const freedMb = Number(result?.freed_mb || 0);

      let message = 'Cleanup complete: ';
      if (deleted > 0) {
        message += `removed ${deleted} version(s), `;
      }
      if (maintenance > 0) {
        message += `cleaned ${maintenance} cache files, `;
      }
      message += `freed ${freedMb.toFixed(2)} MB.`;

      if (deleted === 0 && maintenance === 0) {
        message = 'Cleanup complete: No cleanup needed. Recent versions may be retained by policy.';
      }

      showToast('Cleanup complete.', {
        type: 'success',
        message,
        solution: 'You can continue using the file normally.',
      });
      handleRefreshVersioningTimeline();
    } catch (err) {
      showErrorToast('Cleanup failed.', err?.message || 'Unknown error', 'Try closing the file and running cleanup again.');
    }
  };

  const handleCloseVersioning = () => {
    setShowVersioning(false);
    // Do not automatically reopen the preview panel after closing versioning
    // Users can manually reopen preview if needed
    // setShowPreview(true);
  };

  // Close versioning panel on Escape key
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && showVersioning) {
        setShowVersioning(false);
        // Do not auto-open preview when versioning is closed via Escape
        // setShowPreview(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showVersioning]);
  // eslint-disable-next-line no-unused-vars
  const isCutItem = (item) => {
    return clipboard?.operation === 'cut' &&
      clipboard?.items?.some(i => i.path === item.path);
  };

  const handleDragStart = (e, item) => {
    fileOps.handleDragStart(e, item, selectedItems);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
  };

  const handleDropOnItem = async (e, targetItem) => {
    const isCopy = e.ctrlKey;
    const skipMove = localStorage.getItem('intellifile_skip_move_confirm') === 'true';

    if (!isCopy && targetItem?.type === 'folder' && !skipMove) {
      let paths = [];
      try {
        const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        paths = JSON.parse(data || '[]');
      } catch (_) { }

      if (Array.isArray(paths) && paths.length > 0) {
        setMoveModalData({
          items: paths,
          targetFolder: targetItem,
          onConfirm: async () => {
            const draggedItems = items.filter(item => paths.includes(item.path));
            removeItemsFromState(draggedItems);
            await fileOps.handleDropOnItem(e, targetItem, currentPath, () => { });
          }
        });
        setShowMoveModal(true);
        return;
      }
    }

    if (!isCopy && targetItem?.type === 'folder') {
      try {
        const data = e.dataTransfer.getData('application/json');
        const paths = JSON.parse(data || '[]');
        if (Array.isArray(paths) && paths.length > 0) {
          const draggedItems = items.filter(item => paths.includes(item.path));
          removeItemsFromState(draggedItems);
        }
      } catch (err) {
      }
    }
    await fileOps.handleDropOnItem(e, targetItem, currentPath, () => { });
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    setSelectedItem(item);
    setSelectedItems([item]);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsEmptySpaceContext(false);
    setShowContextMenu(true);
  };

  const handleEmptySpaceContextMenu = (e) => {
    e.preventDefault();
    setSelectedItem(null);
    setSelectedItems([]);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsEmptySpaceContext(true);
    setShowContextMenu(true);
  };

  // Keyboard shortcuts hook
  useKeyboardShortcuts({
    selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems,
    lastSelectedIndex, setLastSelectedIndex,
    handleCopy, handleCut, handlePaste, handleDelete, handleRename, handleCreateFolder,
    handleBack, handleForward, handleUp, handleRefresh, handleUndo, handleRedo,
    handleOpen,
    onCharacterType: handleCharacterType,
    setSelectedItems, setSelectedItem, setRenamingItem, setRenameValue, setShowContextMenu
  });

  // Engine & Search Handlers
  useEffect(() => {
    const checkEngine = async () => {
      try {
        const status = await window.intellifile?.searchStatus();
        if (status) {
          if (status.ready) {
            setEngineReady(true);
            console.log('[FileExplorer] ✅ Engine ready');
          }
          if (typeof status.indexing === 'boolean') {
            setIndexing(status.indexing);
          }
          if (status.lastIndexMessage) {
            setIndexMessage(status.lastIndexMessage);
          }
          if (status.error) {
            setEngineError(status.error);
          } else {
            setEngineError('');
          }
          if (status.lastIndexStatus) {
            setIndexPhase(status.lastIndexStatus.phase || '');
            setIndexDetail(status.lastIndexStatus.detail || '');
            setIndexPct(typeof status.lastIndexStatus.pct === 'number' ? status.lastIndexStatus.pct : null);
          }

          if (!status.ready) {
            setTimeout(checkEngine, 2000);
          }
        } else {
          setTimeout(checkEngine, 2000);
        }
      } catch (err) {
        console.error('[FileExplorer] Engine check error:', err);
        setTimeout(checkEngine, 3000);
      }
    };
    checkEngine();
  }, []);

  useEffect(() => {
    const unsubscribeProgress = onIndexProgress((payload) => {
      if (!payload || payload.type !== 'progress') return;
      if (typeof payload.pct === 'number' && payload.pct >= 100) {
        setIndexing(false);
        setIndexPct(100);
        setIndexPhase('');
        setIndexDetail('');
        setIndexMessage('Index updated');
      } else {
        setIndexing(true);
        setIndexPhase(payload.phase || '');
        setIndexDetail(payload.detail || '');
        setIndexPct(typeof payload.pct === 'number' ? payload.pct : null);
        if (payload.detail) {
          setIndexMessage('');
        }
      }
    });

    const unsubscribeComplete = onIndexComplete((payload) => {
      setIndexing(false);
      setIndexPhase('');
      setIndexDetail('');
      setIndexPct(null);
      if (payload?.folderPath) {
        setIndexedFolder(payload.folderPath);
      }
      if (payload && payload.error) {
        setIndexMessage(`Indexing failed: ${payload.error}`);
      } else {
        const skipped = Number(payload?.data?.skipped_total || payload?.skipped_total || 0);
        if (skipped > 0) {
          setIndexMessage(`Index updated (skipped ${skipped} protected ${skipped === 1 ? 'item' : 'items'})`);
        } else {
          setIndexMessage('Index updated');
        }
      }
    });

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
    };
  }, []);

  useEffect(() => {
    if (!ipcRenderer) return undefined;

    const handleArchiveProgress = (payload) => {
      if (!payload) return;
      setArchiveActive(true);
      setArchiveAction(payload.action || 'archive');
      if (typeof payload.pct === 'number') {
        setArchivePct(payload.pct);
      }
      setArchiveMessage('');
    };

    const handleArchiveComplete = (payload) => {
      setArchiveActive(false);
      setArchiveAction(payload?.action || 'archive');
      if (typeof payload?.pct === 'number') {
        setArchivePct(payload.pct);
      }

      if (archiveMessageTimerRef.current) {
        clearTimeout(archiveMessageTimerRef.current);
        archiveMessageTimerRef.current = null;
      }

      if (payload?.success) {
        if (payload?.action === 'compress') {
          setArchiveMessage('ZIP created');
        } else if (payload?.action === 'extract') {
          setArchiveMessage('Extraction complete');
        } else {
          setArchiveMessage('Archive complete');
        }
      } else if (payload?.error) {
        setArchiveMessage(`Archive failed: ${payload.error}`);
      }

      archiveMessageTimerRef.current = setTimeout(() => {
        setArchiveMessage('');
        archiveMessageTimerRef.current = null;
      }, 4000);
    };

    ipcRenderer.on('archive-progress', handleArchiveProgress);
    ipcRenderer.on('archive-complete', handleArchiveComplete);

    return () => {
      ipcRenderer.off('archive-progress', handleArchiveProgress);
      ipcRenderer.off('archive-complete', handleArchiveComplete);
      if (archiveMessageTimerRef.current) {
        clearTimeout(archiveMessageTimerRef.current);
        archiveMessageTimerRef.current = null;
      }
    };
  }, []);

  const handleSearch = async (query, customFilters = searchFilters) => {
    const trimmed = (query || '').trim();
    const hasFilters = hasSearchableFilters(customFilters);
    if (!trimmed && !hasFilters) {
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSemanticResults(null);
      setSemanticLoading(false);
      return;
    }

    // Increment the search ID so any prior search becomes stale
    const thisSearchId = ++searchIdRef.current;
    setSemanticLoading(true);

    try {
      const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
      const payloadOptions = convertFiltersToSearchPayload(customFilters, currentPath);

      // Resolve rootFolder scope:
      // If user specified 'specific' folder, search in that folder.
      // If user selected 'entire' (or is in Home with default), search universal (rootFolder = null).
      // Otherwise, default to the folder user is present in.
      let searchRoot = null;
      if (customFilters?.folderScope === 'specific' && customFilters.specificFolder) {
        searchRoot = customFilters.specificFolder;
      } else if (customFilters?.folderScope === 'entire' || (isHome && (!customFilters?.folderScope || customFilters?.folderScope === 'entire'))) {
        searchRoot = null;
      } else {
        searchRoot = currentPath && !isHome ? currentPath : null;
      }

      const SEARCH_TIMEOUT_MS = 15000;
      const searchPromise = searchFiles(trimmed, searchRoot, {
        extensions: payloadOptions.extensions,
        dateFrom: payloadOptions.dateFrom,
        dateTo: payloadOptions.dateTo,
        folderScope: searchRoot,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('search_timeout')), SEARCH_TIMEOUT_MS)
      );

      const results = await Promise.race([searchPromise, timeoutPromise]);

      // If a newer search was fired OR query was cleared while we were awaiting, discard
      if (thisSearchId !== searchIdRef.current) return;
      if (!searchQueryRef.current.trim() && !hasSearchableFilters(customFilters)) {
        setSemanticResults(null);
        setSemanticLoading(false);
        return;
      }

      // Filter by folder if not home and searchRoot is specified (guard)
      let filteredResults = results || [];
      if (searchRoot) {
        const normalizePath = (p) => String(p || '').toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
        const normRoot = normalizePath(searchRoot);
        filteredResults = filteredResults.filter(r => {
          const rPath = normalizePath(r.path);
          return rPath === normRoot || rPath.startsWith(normRoot + '/');
        });
      }

      setSemanticResults(filteredResults);
    } catch (err) {
      // Discard stale results
      if (thisSearchId !== searchIdRef.current) return;

      if (err?.message === 'search_timeout') {
        console.warn('[FileExplorer] Search timed out — engine may be busy (indexing/rebuilding)');
        showToast('Search timed out — the engine may be busy indexing. Please try again shortly.', {
          type: 'warning',
          title: 'Search Timeout',
          duration: 4000,
        });
        setSemanticResults([]);
      } else {
        console.error('[FileExplorer] Semantic search error:', err);
        setSemanticResults([]);
      }
    } finally {
      // Only clear loading if this is still the active search
      if (thisSearchId === searchIdRef.current) {
        setSemanticLoading(false);
      }
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const hasFilters = hasSearchableFilters(searchFilters);
      if (searchQuery.trim() || hasFilters) {
        e.preventDefault();
        if (searchDebounceRef.current) {
          clearTimeout(searchDebounceRef.current);
          searchDebounceRef.current = null;
        }
        handleSearch(searchQuery, searchFilters);
      } else {
        searchIdRef.current++;
        if (searchDebounceRef.current) {
          clearTimeout(searchDebounceRef.current);
          searchDebounceRef.current = null;
        }
        setSemanticResults(null);
        setSemanticLoading(false);
      }
    } else if (e.key === 'Escape') {
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSemanticResults(null);
      setSemanticLoading(false);
      setSearchQuery('');
      searchQueryRef.current = '';
      setSearchFilters(getDefaultFilters(currentPath));
      if (currentPath) {
        loadDirectory(currentPath, { suppressLoading: true, soft: true, skipSearchFilter: true });
      }
    }
  };

  const handleSearchResultClick = (filePath) => {
    if (!filePath) return;
    const fileName = filePath.split('\\').pop() || filePath.split('/').pop() || filePath;
    const extIdx = fileName.lastIndexOf('.');
    const searchItem = {
      path: filePath,
      name: fileName,
      type: 'file',
      ext: extIdx > 0 ? fileName.slice(extIdx).toLowerCase() : '',
      size: 0,
      modified: null,
      protected: false,
    };

    setSelectedItem(searchItem);
    setSelectedItems([searchItem]);
    setShowPreview(true); // Always show preview for files in search results
  };

  const handleSearchResultDoubleClick = (filePath) => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('open-file', filePath);
    }
  };

  const handleSearchResultContextMenu = (result, event) => {
    if (!result?.path) return;
    const fileName = result.path.split('\\').pop() || result.path.split('/').pop() || result.path;
    const extIdx = fileName.lastIndexOf('.');
    const searchItem = {
      path: result.path,
      name: fileName,
      type: 'file',
      ext: extIdx > 0 ? fileName.slice(extIdx).toLowerCase() : '',
      size: 0,
      modified: null,
      protected: false,
    };

    setSelectedItem(searchItem);
    setSelectedItems([searchItem]);
    setContextMenuPos({ x: event?.clientX || 0, y: event?.clientY || 0 });
    setIsEmptySpaceContext(false);
    setShowContextMenu(true);
  };

  const handleSearchChange = (e, type) => {
    if (type === 'query') {
      const val = e.target.value;
      setSearchQuery(val);
      searchQueryRef.current = val;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }

      if (!val || !val.trim()) {
        // User hit backspace and deleted the whole query (or clicked clear)
        // Only when the whole query is deleted, remove/delete active filters!
        searchIdRef.current++;
        searchQueryRef.current = '';
        const defaultFilters = getDefaultFilters(currentPath);
        setSearchFilters(defaultFilters);
        setSemanticResults(null);
        setSemanticLoading(false);
        if (currentPath) {
          loadDirectory(currentPath, { suppressLoading: true, soft: true, skipSearchFilter: true });
        }
      } else {
        // Query is not empty (user is typing or backspaced partially): keep filters intact!
        setSemanticLoading(true);
        searchDebounceRef.current = setTimeout(() => {
          handleSearch(val, searchFilters);
        }, 250);
      }
    } else if (type === 'address') {
      setAddressPath(e.target.value);
    }
  };

  const handleFiltersChange = (newFilters) => {
    setSearchFilters(newFilters);
    if (searchQuery.trim() || hasSearchableFilters(newFilters)) {
      // Schedule search asynchronously so popover close is instant
      setTimeout(() => {
        handleSearch(searchQuery, newFilters);
      }, 0);
    } else {
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSemanticResults(null);
      setSemanticLoading(false);
    }
  };

  const handleResetFilters = (blank) => {
    const nextFilters = blank || getDefaultFilters(currentPath);
    setSearchFilters(nextFilters);
    if (searchQuery && searchQuery.trim()) {
      handleSearch(searchQuery, nextFilters);
    } else {
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSemanticResults(null);
      setSemanticLoading(false);
      if (currentPath) {
        loadDirectory(currentPath, { suppressLoading: true, soft: true, skipSearchFilter: true });
      }
    }
  };

  const handleFilterChipRemove = (chipKey) => {
    const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
    const updated = { ...searchFilters };
    if (chipKey === 'fileType') {
      updated.fileType = 'all';
      updated.customExtension = '';
    } else if (chipKey === 'date') {
      updated.datePreset = 'all';
      updated.dateFrom = '';
      updated.dateTo = '';
    } else if (chipKey === 'folderScope') {
      updated.folderScope = isHome ? 'entire' : 'current';
      updated.specificFolder = '';
    }
    setSearchFilters(updated);
    if (searchQuery.trim() || hasSearchableFilters(updated)) {
      handleSearch(searchQuery, updated);
    } else {
      searchIdRef.current++;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      setSemanticResults(null);
      setSemanticLoading(false);
      if (currentPath) {
        loadDirectory(currentPath, { suppressLoading: true, soft: true, skipSearchFilter: true });
      }
    }
  };


  const handleSidebarMouseDown = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(180, Math.min(e.clientX, 450));
      setSidebarWidth(newWidth);
      try { localStorage.setItem('intellifile-sidebar-width', String(newWidth)); } catch { }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const handleToggleSidebar = () => {
    setShowSidebar(prev => {
      const next = !prev;
      try { localStorage.setItem('intellifile-show-sidebar', String(next)); } catch { }
      return next;
    });
  };

  return (
    <div className={`file-explorer ${showVersioning || showPreview ? 'with-versioning' : ''} ${previewClosing ? 'preview-closing' : ''} ${isResizingSidebar ? 'resizing-sidebar' : ''}`}>
      <div
        className="explorer-sidebar-wrapper"
        data-tour="quick-access"
        style={{
          width: sidebarWidth,
          display: showSidebar ? 'flex' : 'none'
        }}
      >
        <ExplorerSidebar
          drives={activeDrives.length > 0 ? activeDrives : drives}
          onNavigate={loadDirectory}
          currentPath={currentPath}
          onContextMenu={handleContextMenu}
        />
      </div>
      {showSidebar && (
        <div
          className={`sidebar-resizer ${isResizingSidebar ? 'active' : ''}`}
          onMouseDown={handleSidebarMouseDown}
          title="Drag to resize Quick Access panel"
        />
      )}

      <div className="explorer-main-area">
        <div data-tour="folder-tabs">
          <TabsBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleTabSelect}
            onCloseTab={handleTabClose}
            onNewTab={handleNewTab}
          />
        </div>

        <ExplorerNavbar
          breadcrumb={breadcrumb}
          addressPath={addressPath}
          historyIndex={historyIndex}
          history={history}
          viewMode={viewMode}
          sortBy={sortBy}
          sortDirection={sortDirection}
          groupBy={groupBy}
          searchQuery={searchQuery}
          engineReady={engineReady}
          indexing={indexing}
          indexedFolder={indexedFolder}
          indexPhase={indexPhase}
          indexDetail={indexDetail}
          indexPct={indexPct}
          indexMessage={indexMessage}
          archiveActive={archiveActive}
          archiveAction={archiveAction}
          archivePct={archivePct}
          archiveMessage={archiveMessage}
          showHidden={showHidden}
          showSidebar={showSidebar}
          onToggleSidebar={handleToggleSidebar}
          onShowHiddenChange={handleShowHiddenChange}
          semanticLoading={semanticLoading}
          onAddressSubmit={handleAddressSubmit}
          onBreadcrumbClick={handleBreadcrumbClick}
          onBack={handleBack}
          onForward={handleForward}
          onUp={handleUp}
          onViewModeChange={setViewMode}
          onSortByChange={setSortBy}
          onSortDirectionChange={setSortDirection}
          onGroupByChange={setGroupBy}
          onCreateFolder={handleCreateFolder}
          onSearchChange={handleSearchChange}
          onSearchKeyDown={handleSearchKeyDown}
          searchFilters={searchFilters}
          currentPath={currentPath}
          currentFolders={currentFolders}
          onFiltersChange={handleFiltersChange}
          onResetFilters={handleResetFilters}
          onFilterChipRemove={handleFilterChipRemove}
        />

        {engineError && (
          <div className="engine-error-banner">
            ⚠️ Search engine failed to start: {engineError}
          </div>
        )}

        <div className="explorer-content-area">
          <div
            className="explorer-content"
            data-tour="file-browser"
            onContextMenu={(e) => {
              if (isSearchActive) return;
              // Let file items handle their own context menu; use empty-space menu everywhere else.
              if (e.target?.closest?.('.file-item')) return;
              e.preventDefault();
              handleEmptySpaceContextMenu(e);
            }}
          >
            <SearchResults
              visible={isSearchActive}
              results={semanticResults || []}
              loading={semanticLoading}
              onClose={() => {
                searchIdRef.current++;
                if (searchDebounceRef.current) {
                  clearTimeout(searchDebounceRef.current);
                  searchDebounceRef.current = null;
                }
                setSemanticResults(null);
                setSemanticLoading(false);
                setSearchQuery('');
                searchQueryRef.current = '';
                setSearchFilters(getDefaultFilters(currentPath));
              }}
              onResultClick={handleSearchResultClick}
              onResultDoubleClick={handleSearchResultDoubleClick}
              onResultContextMenu={handleSearchResultContextMenu}
            />

            {!isSearchActive && (
              <>
                {!currentPath || String(currentPath).toLowerCase() === 'home' ? (
                  <ExplorerHome
                    onNavigate={loadDirectory}
                    onFileSelect={onFileSelect}
                    onContextMenu={handleContextMenu}
                    selectedItem={selectedItem}
                    setSelectedItem={setSelectedItem}
                    selectedItems={selectedItems}
                    setSelectedItems={setSelectedItems}
                    searchQuery={searchQuery}
                    renamingItem={renamingItem}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    onRenameBlur={handleRename}
                    onRenameKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setRenamingItem(null);
                    }}
                    setRenamingItem={setRenamingItem}
                  />
                ) : (
                  <>
                    {showRecentChooser && recentChooserFiles.length > 0 && (
                      <div className="recent-chooser">
                        <div className="recent-chooser-title">Select the file you intended to open:</div>
                        <div className="recent-chooser-list">
                          {recentChooserFiles.map(f => (
                            <div key={f.path} className="recent-chooser-item">
                              <div className="recent-chooser-name">{f.name}</div>
                              <div className="recent-chooser-actions">
                                <button onClick={() => handleRecentChooserSelect(f)}>Select</button>
                                <button onClick={() => openFileWithDefaultApp(f.path)}>Open</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <FileList
                      items={displayItems}
                      viewMode={viewMode}
                      groupBy={groupBy}
                      loading={loading}
                      currentPath={currentPath}
                      renamingItem={renamingItem}
                      renameValue={renameValue}
                      selectedItems={selectedItems}
                      selectedFiles={selectedFiles}
                      clipboard={clipboard}
                      isCutItem={isCutItem}
                      inputRef={inputRef}
                      tempHighlightedPath={tempHighlightedPath}
                      onItemClick={handleItemClick}
                      onItemDoubleClick={handleFolderClick}
                      onContextMenu={handleContextMenu}
                      onEmptySpaceContextMenu={handleEmptySpaceContextMenu}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDropOnItem={handleDropOnItem}
                      onRenameValueChange={setRenameValue}
                      onRenameBlur={handleRename}
                      onRenameKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenamingItem(null);
                      }}
                    />
                  </>
                )}
              </>
            )}

          </div>

        </div>

        <div className="explorer-statusbar">
          <div className="statusbar-info">
            <span className="statusbar-pill">
              <span className="statusbar-pill-dot" />
              {currentPath === 'Home' || !currentPath ? 'Home' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            </span>
            {selectedItems.length > 0 && (
              <span className="statusbar-pill statusbar-pill--active">
                ✓ {selectedItems.length} selected
              </span>
            )}
            {selectedItem && selectedItem.type === 'file' && (
              <span className="statusbar-pill statusbar-pill--size">
                💾 {formatFileSize(selectedItem.size)}
              </span>
            )}
            {selectedItem && selectedItem.type === 'folder' && (
              <span className="statusbar-pill">
                📁 Folder
              </span>
            )}
            {clipboard && (
              <span className="statusbar-pill statusbar-pill--clip">
                📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length}
              </span>
            )}
            {fileOpProgress && fileOpProgress.active && (
              <span className="statusbar-pill statusbar-pill--progress">
                ⚡ {fileOpProgress.title || 'Processing…'} ({fileOpProgress.pct || 0}%)
                <span className="statusbar-progress-bar">
                  <span className="statusbar-progress-fill" style={{ width: `${fileOpProgress.pct || 0}%` }} />
                </span>
              </span>
            )}
          </div>

          {selectedItem?.type === 'file' && (
            <div className="statusbar-actions">
              <button
                type="button"
                className={`statusbar-btn preview-btn ${showPreview && !showVersioning ? 'active' : ''}`}
                onClick={handleTogglePreview}
                title={showPreview && !showVersioning ? "Close preview" : "Preview selected file"}
                aria-label={showPreview && !showVersioning ? "Close preview" : "Preview selected file"}
              >
                <MdOutlineVisibility className="statusbar-btn-icon" />
                <span>Preview</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {showVersioning && selectedItem && selectedItem.type === 'file' && (
        <div className="versioning-panel" data-tour="version-timeline">
          <div className="versioning-header">
            <h3>🕒 Version History</h3>
            <div className="header-actions">
              <button
                className="panel-refresh-btn"
                onClick={handleRefreshVersioningTimeline}
                title="Refresh history"
              >
                🔄
              </button>
              <button
                className="panel-refresh-btn"
                onClick={handleSmartCleanupVersioningTimeline}
                title="Smart cleanup history"
              >
                🧹
              </button>
              <button className="close-panel-btn" onClick={handleCloseVersioning} title="Close">
                ×
              </button>
            </div>
          </div>
          <div className="versioning-body">
            <VersionTimeline filePath={selectedItem.path} />
          </div>
        </div>
      )}

      {showPreview && !showVersioning && (
        <PreviewPanel
          selectedItem={selectedItem}
          visible={showPreview}
          onClose={handlePreviewCloseComplete}
          onClosing={handlePreviewCloseStart}
          searchQuery={searchQuery}
        />
      )}

      <ContextMenu
        visible={showContextMenu}
        position={contextMenuPos}
        selectedItem={selectedItem}
        isEmptySpace={isEmptySpaceContext}
        clipboard={clipboard}
        onOpen={() => handleOpen(selectedItem)}
        onOpenWith={() => handleOpenWith(selectedItem)}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onRename={() => {
          setRenamingItem(selectedItem);
          setRenameValue(selectedItem?.name || '');
        }}
        onDelete={handleDelete}
        onProperties={handleProperties}
        onCopyPath={handleCopyPath}
        onOpenTerminal={handleOpenTerminal}
        onOpenInVSCode={handleOpenInVSCode}
        onPinToFavorites={handlePinToFavorites}
        isPinnedToFavorites={isSelectedFolderPinned}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onRefresh={handleRefresh}
        onUndo={handleUndo}
        onVersioning={handleVersioning}
        canVersionItem={canVersionItem(selectedItem)}
        onCompress={handleCompress}
        onExtract={handleExtract}
        onLockFile={() => handleLockFile(selectedItem)}
        onUnlockFile={() => handleUnlockFile(selectedItem)}
        onChatWithAI={() => {
          setShowContextMenu(false);
          onChatWithAI?.(selectedItem);
        }}
        onClose={() => setShowContextMenu(false)}
      />
      {showOpenWith && openWithItem && (
        <OpenWithModal
          file={openWithItem}
          visible={showOpenWith}
          onClose={() => setShowOpenWith(false)}
        />
      )}

      <PropertiesModal
        visible={showProperties}
        selectedItem={selectedItem}
        onClose={() => setShowProperties(false)}
      />

      <DeleteConfirmModal
        visible={showDeleteModal}
        items={itemsPendingDelete}
        onConfirm={() => {
          setShowDeleteModal(false);
          confirmDeleteItems(itemsPendingDelete);
        }}
        onCancel={() => {
          setShowDeleteModal(false);
          setItemsPendingDelete([]);
        }}
      />

      <MoveConfirmModal
        visible={showMoveModal}
        items={moveModalData.items}
        targetFolder={moveModalData.targetFolder}
        onConfirm={() => {
          setShowMoveModal(false);
          moveModalData.onConfirm?.();
        }}
        onCancel={() => {
          setShowMoveModal(false);
        }}
      />

      <FileLockModal
        visible={showLockModal}
        mode={lockModalMode}
        file={lockModalFile}
        onClose={() => setShowLockModal(false)}
        onSuccess={handleLockModalSuccess}
      />
    </div>
  );
}

// Utility function for file size (moved here temporarily, should use fileUtils)
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default FileExplorer;
