import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { searchFiles, onIndexProgress, onIndexComplete } from '../../services/searchService';
import { useNavigation } from '../../hooks/useNavigation';
import { useFileExplorer } from '../../hooks/useFileExplorer';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { sortItems } from './utils/fileUtils';
import ExplorerSidebar from '../ExplorerSidebar';
import ExplorerNavbar from '../ExplorerNavbar';
import PreviewPanel from '../PreviewPanel';
import FileList from '../FileList';
import ContextMenu from '../ContextMenu';
import PropertiesModal from '../PropertiesModal';
import SearchResults from '../SearchResults';
import TabsBar from '../TabsBar';
import VersionTimeline from '../Versioning/VersionTimeline';
import { smartCleanupVersions } from '../../services/versionService';
import './FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

function FileExplorer({ onFileSelect, selectedFiles = {}, drives = [], onChatWithAI }) {
  // UI State
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('icons');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [groupBy, setGroupBy] = useState('none');
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [showProperties, setShowProperties] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showVersioning, setShowVersioning] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [isEmptySpaceContext, setIsEmptySpaceContext] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  
  // Search & Indexing State
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexPhase, setIndexPhase] = useState('');
  const [indexDetail, setIndexDetail] = useState('');
  const [indexPct, setIndexPct] = useState(null);
  const [indexMessage, setIndexMessage] = useState('');
  const [archiveActive, setArchiveActive] = useState(false);
  const [archiveAction, setArchiveAction] = useState('');
  const [archivePct, setArchivePct] = useState(null);
  const [archiveMessage, setArchiveMessage] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [indexedFolder, setIndexedFolder] = useState('');

  // Custom Hooks
  const navigation = useNavigation(ipcRenderer);
  const fileOps = useFileExplorer(ipcRenderer);
  
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
  const archiveMessageTimerRef = useRef(null);

  // Derived values
  const displayItems = useMemo(() => sortItems(items, sortBy, sortDirection), [items, sortBy, sortDirection]);
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
  const addItemsToState = useCallback((itemsToAdd) => {
    if (!itemsToAdd || itemsToAdd.length === 0) return;
    setItems(prev => {
      const existing = new Set(prev.map(item => item.path));
      const filtered = itemsToAdd.filter(item => !existing.has(item.path) && matchesSearch(item.name));
      return filtered.length ? [...prev, ...filtered] : prev;
    });
  }, [matchesSearch]);
  const removeItemsFromState = useCallback((itemsToRemove) => {
    if (!itemsToRemove || itemsToRemove.length === 0) return;
    const pathSet = new Set(itemsToRemove.map(item => item.path));
    setItems(prev => prev.filter(item => !pathSet.has(item.path)));
    setSelectedItems(prev => prev.filter(item => !pathSet.has(item.path)));
    setSelectedItem(prev => (prev && pathSet.has(prev.path)) ? null : prev);
    setLastSelectedIndex(null);
  }, []);
  const updateItemPathInState = useCallback((oldPath, newPath, newName) => {
    const newExt = getExtFromName(newName);
    const removeFromView = !matchesSearch(newName);

    setItems(prev => {
      let next = prev.map(item => {
        if (item.path !== oldPath) return item;
        return {
          ...item,
          path: newPath,
          name: newName,
          ext: item.type === 'file' ? newExt : item.ext
        };
      });
      if (removeFromView) {
        next = next.filter(item => item.path !== newPath);
      }
      return next;
    });

    setSelectedItems(prev => {
      let next = prev.map(item => {
        if (item.path !== oldPath) return item;
        return {
          ...item,
          path: newPath,
          name: newName,
          ext: item.type === 'file' ? newExt : item.ext
        };
      });
      if (removeFromView) {
        next = next.filter(item => item.path !== newPath);
      }
      return next;
    });

    setSelectedItem(prev => {
      if (!prev || prev.path !== oldPath) return prev;
      if (removeFromView) return null;
      return {
        ...prev,
        path: newPath,
        name: newName,
        ext: prev.type === 'file' ? newExt : prev.ext
      };
    });

    if (removeFromView) {
      setLastSelectedIndex(null);
    }
  }, [getExtFromName, matchesSearch]);

  const applyDirectoryChange = useCallback((change) => {
    if (!change?.directoryPath || !currentPath) return;
    const normalizedCurrent = currentPath.toLowerCase().replace(/[\\/]+$/, '');
    const normalizedDirectory = change.directoryPath.toLowerCase().replace(/[\\/]+$/, '');
    if (normalizedCurrent !== normalizedDirectory) return;

    if (change.action === 'add' || change.action === 'change') {
      const updatedItem = change.item;
      if (!updatedItem?.path) return;
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
  }, [currentPath, matchesSearch]);

  // Load directory with filtering and sorting
  const loadDirectory = useCallback(async (dirPath, options = {}) => {
    const { soft = false, trackHistory = true, tabId = null } = options;
    const requestId = ++loadRequestRef.current;
    const isStale = () => requestId !== loadRequestRef.current;

    if (!soft) {
      setLoading(true);
      setRenamingItem(null);
      setShowContextMenu(false);
    }
    try {
      const result = await ipcRenderer?.invoke('list-directory', dirPath, { showHidden });
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
        if (searchQuery) {
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
        const actualPath = loadedItems && loadedItems.length > 0 ?
          loadedItems[0].path.substring(0, loadedItems[0].path.lastIndexOf('\\')) :
          dirPath;
        
        if (actualPath) {
          const pathChanged = !currentPath || actualPath !== currentPath;
          if (pathChanged) {
            setCurrentPath(actualPath);
            setAddressPath(actualPath);
            updateBreadcrumb(actualPath);
          }
          setSelectedItem(prev => (prev && loadedItems.some(i => i.path === prev.path)) ? prev : null);
          setSelectedItems(prev => prev.filter(pItem => loadedItems.some(i => i.path === pItem.path)));
          setLastSelectedIndex(null);
          if (trackHistory && pathChanged) {
            updateHistory(actualPath, tabId);
          }
          if (pathChanged) {
            updateActiveTab(actualPath, tabId);
          }
        }
      }
    } catch (error) {
      if (isStale()) return;
      console.error('Error:', error);
    } finally {
      if (!soft && !isStale()) {
        setLoading(false);
      }
    }
  }, [updateBreadcrumb, searchQuery, sortBy, sortDirection, showHidden, updateHistory, updateActiveTab, setCurrentPath, setAddressPath, setRenamingItem, currentPath]);

  // Initialize with saved path or Documents folder
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (currentPath) {
      loadDirectory(currentPath, { trackHistory: false });
    } else {
      loadDirectory(null);
    }
  }, [currentPath, loadDirectory]);

  // Watch the active directory and apply incremental updates
  useEffect(() => {
    if (!ipcRenderer || !currentPath) return undefined;

    const normalizedCurrent = currentPath.toLowerCase().replace(/[\\/]+$/, '');
    const previousWatched = watchedDirectoryRef.current;

    if (previousWatched && previousWatched !== normalizedCurrent) {
      ipcRenderer.invoke('unwatch-directory', previousWatched).catch(() => {});
    }

    watchedDirectoryRef.current = normalizedCurrent;
    ipcRenderer.invoke('watch-directory', currentPath).catch(() => {});

    const handleDirectoryChanged = (event) => {
      applyDirectoryChange(event);
    };

    const handleVersionUpdated = (event) => {
      if (!event?.filePath || !currentPath) return;
      if (event.filePath.toLowerCase().replace(/[\\/]+$/, '') !== currentPath.toLowerCase().replace(/[\\/]+$/, '')) return;
      loadDirectory(currentPath, { soft: true, trackHistory: false });
    };

    ipcRenderer.on('directory-changed', handleDirectoryChanged);
    ipcRenderer.on('version-updated', handleVersionUpdated);

    return () => {
      ipcRenderer.off('directory-changed', handleDirectoryChanged);
      ipcRenderer.off('version-updated', handleVersionUpdated);
      ipcRenderer.invoke('unwatch-directory', normalizedCurrent).catch(() => {});
    };
  }, [currentPath, applyDirectoryChange, loadDirectory]);

  // Event Handlers
  const handleAddressSubmit = (e) => {
    e.preventDefault();
    if (addressPath) loadDirectory(addressPath);
  };

  // File operation handlers
  const openFileWithDefaultApp = async (filePath) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('open-file', filePath);
      if (!result.success) console.error('Error opening file:', result.error);
    } catch (err) {
      console.error('Error opening file:', err);
    }
  };

  const handleFolderClick = (item) => {
    if (item.type === 'folder' || item.type === 'drive') {
      setShowPreview(false);
      loadDirectory(item.path);
    } else if (item.type === 'file') {
      openFileWithDefaultApp(item.path);
    }
  };

  const handleItemClick = (item, idx, e) => {
    if (renamingItem) return;
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    let newSelection = [];

    if (isShift && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, idx);
      const end = Math.max(lastSelectedIndex, idx);
      newSelection = displayItems.slice(start, end + 1);
    } else if (isCtrl) {
      const alreadySelected = selectedItems.find(i => i.path === item.path);
      newSelection = alreadySelected
        ? selectedItems.filter(i => i.path !== item.path)
        : [...selectedItems, item];
    } else {
      newSelection = [item];
    }

    setSelectedItems(newSelection);
    setSelectedItem(item);
    setShowPreview(true);
    setLastSelectedIndex(idx);
    if (onFileSelect) onFileSelect(item);
  };

  useEffect(() => {
    if (selectedItem) {
      setShowPreview(true);
    } else {
      setShowPreview(false);
    }
  }, [selectedItem]);

  const handleBreadcrumbClick = (path) => {
    loadDirectory(path.replace(/\/$/, ''));
  };

  const handleBack = () => {
    const prevPath = navBack();
    if (prevPath) loadDirectory(prevPath, { trackHistory: false, tabId: activeTabId });
  };

  const handleForward = () => {
    const nextPath = navForward();
    if (nextPath) loadDirectory(nextPath, { trackHistory: false, tabId: activeTabId });
  };

  const handleUp = () => {
    const parentPath = navUp();
    if (parentPath) loadDirectory(parentPath);
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
      await fileOps.handlePaste(currentPath, () => {});
  };

  const handleRename = async () => {
    if (renamingItem?.protected) {
      alert('Cannot rename system files or folders');
      setRenamingItem(null);
      return;
    }

    if (renamingItem && renameValue && renameValue !== renamingItem.name && currentPath) {
      const newPath = `${currentPath}\\${renameValue}`;
      updateItemPathInState(renamingItem.path, newPath, renameValue);
    }

    await fileOps.handleRename(currentPath, () => {});
  };

  const handleDelete = async () => {
    const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    if (itemsToDelete.length === 0) {
      setShowContextMenu(false);
      return;
    }

    if (itemsToDelete.some(item => item.protected)) {
      alert('Cannot delete system files or folders');
      setShowContextMenu(false);
      return;
    }

    const names = itemsToDelete.map(i => i.name).join(', ');
    const msg = itemsToDelete.length === 1
      ? `Are you sure you want to move "${names}" to the Recycle Bin?`
      : `Are you sure you want to move ${itemsToDelete.length} items to the Recycle Bin?\n\n${names}`;

    if (!window.confirm(msg)) {
      setShowContextMenu(false);
      return;
    }

    setShowContextMenu(false);

    // Call backend delete operation first
    const ok = await fileOps.handleDelete(
      itemsToDelete,
      null,
      currentPath,
      null,
      { skipConfirm: true }
    );

    if (ok) {
      // Delete succeeded - remove from UI immediately
      setItems(prev => prev.filter(item => !itemsToDelete.some(del => del.path === item.path)));
      setSelectedItems([]);
      setSelectedItem(null);
      setLastSelectedIndex(null);
    } else {
      alert('Failed to delete items. Please try again.');
    }
  };

  const handleCreateFolder = async () => {
    if (!currentPath) return;
    
    const folderName = 'New Folder';
    const newPath = currentPath + '\\' + folderName;
    
    // Create the folder
    const created = await fileOps.handleCreateFolder(currentPath, () => {});
    
    if (created) {
      // Create a new item object for rename mode
      const newItem = {
        path: newPath,
        name: folderName,
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
    
    const newPath = currentPath + '\\' + fileName;
    
    // Create the file
    const created = await fileOps.handleCreateFile(currentPath, fileName, () => {});
    
    if (created) {
      // Create a new item object for rename mode
      const newItem = {
        path: newPath,
        name: fileName,
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
    await fileOps.handleUndo(() => {});
  };

  const handleCopyPath = async () => {
    const item = selectedItem;
    if (item) {
      await ipcRenderer?.invoke('copy-to-clipboard', item.path);
    }
  };

  const handleOpenTerminal = async () => {
    const targetPath = selectedItem?.type === 'folder' ? selectedItem.path : currentPath;
    if (targetPath) {
      await ipcRenderer?.invoke('open-terminal-here', targetPath);
    }
  };

  const handleOpenInVSCode = async () => {
    const targetPath = selectedItem?.type === 'folder' ? selectedItem.path : currentPath;
    if (targetPath) {
      await ipcRenderer?.invoke('open-in-vscode', targetPath);
    }
  };

  const handlePinToFavorites = () => {
    if (selectedItem?.type !== 'folder') return;

    const isPinned = window.__intellifile_isFavorite?.(selectedItem.path);
    if (isPinned && window.__intellifile_removeFavorite) {
      window.__intellifile_removeFavorite(selectedItem.path);
      return;
    }

    if (!isPinned && window.__intellifile_addFavorite) {
      window.__intellifile_addFavorite(selectedItem.path, selectedItem.name);
    }
  };

  const isSelectedFolderPinned = selectedItem?.type === 'folder' &&
    !!window.__intellifile_isFavorite?.(selectedItem.path);

  const handleRefresh = () => {
    if (currentPath) loadDirectory(currentPath, { soft: true, trackHistory: false });
  };

  const handleVersioning = () => {
    if (selectedItem && selectedItem.type === 'file') {
      setShowPreview(false);
      setShowVersioning(true);
    }
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
        alert('Cleanup failed: ' + (result?.error || 'Unknown error'));
        return;
      }

      const deleted = Number(result?.deleted_versions || 0);
      const freedMb = Number(result?.freed_mb || 0);
      if (deleted > 0) {
        alert(`Cleanup complete: removed ${deleted} version(s), freed ${freedMb.toFixed(2)} MB.`);
      } else {
        alert('Cleanup complete: 0 versions removed. Recent versions may be retained by policy.');
      }

      handleRefreshVersioningTimeline();
    } catch (err) {
      alert('Cleanup failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleCloseVersioning = () => {
    setShowVersioning(false);
    setShowPreview(true);
  };

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
    await fileOps.handleDropOnItem(e, targetItem, currentPath, () => {});
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
    handleCopy, handleCut, handlePaste, handleDelete, handleRename, handleCreateFolder,
    handleBack, handleForward, handleUp,
    setSelectedItems, setSelectedItem, setRenamingItem, setRenameValue, setShowContextMenu
  });

  // Engine & Search Handlers
  useEffect(() => {
    const checkEngine = async () => {
      try {
        const status = await window.intellifile?.searchStatus();
        if (status && status.ready) {
          setEngineReady(true);
          console.log('[FileExplorer] ✅ Engine ready');
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
      setIndexing(true);
      setIndexPhase(payload.phase || '');
      setIndexDetail(payload.detail || '');
      setIndexPct(typeof payload.pct === 'number' ? payload.pct : null);
      if (payload.detail) {
        setIndexMessage('');
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
        const skipped = Number(payload?.skipped_total || 0);
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

  const handleSearch = async (query) => {
    if (!query || !query.trim()) {
      setSemanticResults(null);
      return;
    }
    setSemanticLoading(true);
    try {
      const results = await searchFiles(query);
      setSemanticResults(results || []);
    } catch (err) {
      console.error('[FileExplorer] Semantic search error:', err);
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      handleSearch(searchQuery);
    } else if (e.key === 'Escape') {
      setSemanticResults(null);
      setSearchQuery('');
    }
  };

  const handleSearchResultClick = (filePath) => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('open-file', filePath);
    }
  };

  const handleSearchChange = (e, type) => {
    if (type === 'query') {
      setSearchQuery(e.target.value);
      if (!e.target.value) setSemanticResults(null);
    } else if (type === 'address') {
      setAddressPath(e.target.value);
    }
  };

  // Tab handlers
  const handleTabSelect = (tab) => {
    handleSelectTab(tab);
    if (tab.path) loadDirectory(tab.path, { tabId: tab.id });
  };

  const handleTabClose = (tabId) => {
    handleCloseTab(tabId);
  };

  return (
    <div className={`file-explorer ${showVersioning || showPreview ? 'with-versioning' : ''}`}>
      <ExplorerSidebar drives={drives} onNavigate={loadDirectory} currentPath={currentPath} />

      <div className="explorer-main-area">
        <TabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleTabSelect}
          onCloseTab={handleTabClose}
          onNewTab={handleNewTab}
        />

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
          onShowHiddenChange={setShowHidden}
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
        />

        <div className="explorer-content-area">
          <div className="explorer-content">
            <SearchResults
              visible={semanticResults !== null}
              results={semanticResults || []}
              loading={semanticLoading}
              onClose={() => {
                setSemanticResults(null);
                setSearchQuery('');
              }}
              onResultClick={handleSearchResultClick}
            />

            {semanticResults === null && (
              <FileList
                items={items}
                viewMode={viewMode}
                groupBy={groupBy}
                loading={loading}
                renamingItem={renamingItem}
                renameValue={renameValue}
                selectedItems={selectedItems}
                selectedFiles={selectedFiles}
                clipboard={clipboard}
                isCutItem={isCutItem}
                inputRef={inputRef}
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
            )}

          </div>
        </div>

        <div className="explorer-statusbar">
          <div className="statusbar-info">
            <span>{items.length} items </span>
            <span>{selectedItems.length} selected</span>
            {selectedItem && (
              <span>{selectedItem.type === 'file' ? `${formatFileSize(selectedItem.size)}` : 'Folder'}</span>
            )}
            {clipboard && <span>📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length} item(s)</span>}
          </div>

          <div className="statusbar-actions">
            <button
              className={`statusbar-btn ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(!showPreview)}
              title="Toggle preview panel"
            >
              👁️ Preview
            </button>
          </div>
        </div>
      </div>

      {showVersioning && selectedItem && selectedItem.type === 'file' && (
        <div className="versioning-panel">
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
          onClose={() => setShowPreview(false)}
        />
      )}

      <ContextMenu
        visible={showContextMenu}
        position={contextMenuPos}
        selectedItem={selectedItem}
        isEmptySpace={isEmptySpaceContext}
        clipboard={clipboard}
        onOpen={() => selectedItem && openFileWithDefaultApp(selectedItem.path)}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onRename={() => {
          setRenamingItem(selectedItem);
          setRenameValue(selectedItem?.name || '');
        }}
        onDelete={handleDelete}
        onProperties={() => setShowProperties(true)}
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
        onCompress={handleCompress}
        onExtract={handleExtract}
        onChatWithAI={() => {
          setShowContextMenu(false);
          onChatWithAI(selectedItem);
        }}
        onClose={() => setShowContextMenu(false)}
      />

      <PropertiesModal
        visible={showProperties}
        selectedItem={selectedItem}
        onClose={() => setShowProperties(false)}
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
