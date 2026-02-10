import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { searchFiles, indexFolder } from '../../services/searchService';
import './FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

function FileExplorer({ onFileSelect, selectedFiles = {}, drives = [] }) {
  const [currentPath, setCurrentPath] = useState(null);
  const [items, setItems] = useState([]);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('icons'); // icons, list, details
  const [sortBy, setSortBy] = useState('name'); // name, date, size, type
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [clipboard, setClipboard] = useState(null); // {items, operation: 'copy'|'cut'}
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tabs, setTabs] = useState([{ id: 'tab-1', path: null, title: 'Documents' }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [addressPath, setAddressPath] = useState('');
  const [groupBy, setGroupBy] = useState('none'); // none, type, date
  const [showProperties, setShowProperties] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [semanticResults, setSemanticResults] = useState(null); // null = not searching, [] = no results
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexedFolder, setIndexedFolder] = useState('');
  const contextMenuRef = useRef(null);
  const inputRef = useRef(null);

  const displayItems = useMemo(() => items, [items]);

  const updateBreadcrumb = useCallback((dirPath) => {
    const parts = dirPath.split('\\').filter(p => p);
    const crumbs = parts.map((part, idx) => ({
      name: part,
      path: parts.slice(0, idx + 1).join('\\') + '\\'
    }));
    setBreadcrumb(crumbs);
  }, []);

  const loadDirectory = useCallback(async (dirPath) => {
    setLoading(true);
    setRenamingItem(null);
    setShowContextMenu(false);
    try {
      const result = await ipcRenderer?.invoke('list-directory', dirPath);
      if (!result || result.error) {
        console.error('Error loading directory:', result?.error || 'Unknown error');
        setItems([]);
      } else {
        let items = result.items || [];

        // Apply search filter
        if (searchQuery) {
          items = items.filter(item =>
            item.name.toLowerCase().includes(searchQuery.toLowerCase())
          );
        }

        // Apply sorting
        items.sort((a, b) => {
          let compareValue = 0;
          switch (sortBy) {
            case 'date':
              compareValue = a.modified - b.modified;
              break;
            case 'size':
              compareValue = a.size - b.size;
              break;
            case 'type':
              compareValue = a.ext.localeCompare(b.ext);
              break;
            default:
              compareValue = a.name.localeCompare(b.name);
          }
          return compareValue;
        });

        setItems(items);
        const actualPath = items && items.length > 0 ?
          items[0].path.substring(0, items[0].path.lastIndexOf('\\')) :
          dirPath;
        if (actualPath) {
          setCurrentPath(actualPath);
          setAddressPath(actualPath);
          updateBreadcrumb(actualPath);
          setSelectedItem(null);
          setSelectedItems([]);
          setLastSelectedIndex(null);

          // Update history
          setHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push(actualPath);
            return newHistory;
          });
          setHistoryIndex(prev => prev + 1);

          // Update active tab
          setTabs(prev => prev.map(tab => {
            if (tab.id === activeTabId) {
              const title = actualPath.split('\\').filter(Boolean).pop() || 'Root';
              return { ...tab, path: actualPath, title };
            }
            return tab;
          }));
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, [updateBreadcrumb, searchQuery, sortBy, historyIndex]);

  // Initialize with Documents folder
  useEffect(() => {
    if (!currentPath) {
      loadDirectory(null);
    }
  }, [currentPath, loadDirectory]);

  const handleAddressSubmit = (e) => {
    e.preventDefault();
    if (addressPath) {
      loadDirectory(addressPath);
    }
  };

  const handleNewTab = () => {
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, path: currentPath, title: 'New Tab' }]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (tabId) => {
    setTabs(prev => {
      if (prev.length === 1) return prev;
      const filtered = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId) {
        const nextTab = filtered[filtered.length - 1];
        setActiveTabId(nextTab.id);
        if (nextTab.path) {
          loadDirectory(nextTab.path);
        }
      }
      return filtered;
    });
  };

  const handleSelectTab = (tab) => {
    setActiveTabId(tab.id);
    if (tab.path) {
      loadDirectory(tab.path);
    }
  };

  const getPreviewTypeForExt = (ext) => {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
    const textExts = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.go'];
    if (imageExts.includes(ext)) return 'image';
    if (textExts.includes(ext)) return 'text';
    return 'none';
  };

  const openFileWithDefaultApp = async (filePath) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('open-file', filePath);
      if (!result.success) {
        console.error('Error opening file:', result.error);
      }
    } catch (err) {
      console.error('Error opening file:', err);
    }
  };

  const handleFolderClick = (item) => {
    if (item.type === 'folder' || item.type === 'drive') {
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
      if (alreadySelected) {
        newSelection = selectedItems.filter(i => i.path !== item.path);
      } else {
        newSelection = [...selectedItems, item];
      }
    } else {
      newSelection = [item];
    }

    setSelectedItems(newSelection);
    setSelectedItem(item);
    setLastSelectedIndex(idx);

    if (item.editable) {
      onFileSelect(item);
    }
  };

  const handleBreadcrumbClick = (path) => {
    loadDirectory(path.replace(/\/$/, ''));
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      loadDirectory(history[historyIndex - 1]);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      loadDirectory(history[historyIndex + 1]);
    }
  };

  const handleUp = () => {
    if (currentPath && currentPath !== 'C:\\') {
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('\\'));
      if (parentPath) {
        loadDirectory(parentPath);
      }
    }
  };

  const handleCopy = async () => {
    const itemsToCopy = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    if (itemsToCopy.length > 0) {
      setClipboard({ items: itemsToCopy, operation: 'copy' });
      setShowContextMenu(false);
    }
  };

  const handleCut = async () => {
    const itemsToCut = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);

    // Check if any items are protected
    const protectedItems = itemsToCut.filter(item => item.protected);
    if (protectedItems.length > 0) {
      alert('Cannot move system files or folders');
      return;
    }

    if (itemsToCut.length > 0) {
      setClipboard({ items: itemsToCut, operation: 'cut' });
      setShowContextMenu(false);
    }
  };

  const handlePaste = async () => {
    if (clipboard && currentPath) {
      try {
        for (const item of clipboard.items) {
          const operation = clipboard.operation === 'cut' ? 'move' : 'copy';
          const destPath = currentPath + '\\' + item.name;

          if (operation === 'copy') {
            const result = await ipcRenderer?.invoke('copy-file', item.path, destPath);
            if (!result.success) {
              console.error('Copy error:', result.error);
              alert('Error copying: ' + result.error);
            }
          } else {
            const result = await ipcRenderer?.invoke('move-file', item.path, destPath);
            if (!result.success) {
              console.error('Move error:', result.error);
              alert('Error moving: ' + result.error);
            }
          }
        }

        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
        loadDirectory(currentPath);
      } catch (err) {
        console.error('Paste error:', err);
      }
    }
  };

  const handleRename = async () => {
    if (renamingItem && renameValue && renameValue !== renamingItem.name) {
      // Check if item is protected
      if (renamingItem.protected) {
        alert('Cannot rename system files or folders');
        setRenamingItem(null);
        return;
      }

      try {
        const newPath = currentPath + '\\' + renameValue;
        const result = await ipcRenderer?.invoke('rename-file', renamingItem.path, newPath);
        if (result.success) {
          loadDirectory(currentPath);
        } else {
          console.error('Rename error:', result.error);
          alert('Error renaming: ' + result.error);
        }
      } catch (err) {
        console.error('Rename error:', err);
      }
    }
    setRenamingItem(null);
  };

  const handleDelete = async () => {
    const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);

    // Check if any items are protected
    const protectedItems = itemsToDelete.filter(item => item.protected);
    if (protectedItems.length > 0) {
      alert('Cannot delete system files or folders');
      return;
    }

    if (itemsToDelete.length > 0) {
      try {
        for (const item of itemsToDelete) {
          const result = await ipcRenderer?.invoke('delete-file', item.path);
          if (!result.success) {
            console.error('Delete error:', result.error);
            alert('Error: ' + result.error);
          }
        }
        loadDirectory(currentPath);
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
    setShowContextMenu(false);
  };

  const handleCreateFolder = async () => {
    if (currentPath) {
      try {
        const folderName = 'New Folder';
        const newPath = currentPath + '\\' + folderName;
        const result = await ipcRenderer?.invoke('create-folder', newPath);
        if (result.success) {
          loadDirectory(currentPath);
        }
      } catch (err) {
        console.error('Create folder error:', err);
      }
    }
  };

  const handleDragStart = (e, item) => {
    const itemsToDrag = selectedItems.length > 0 ? selectedItems : [item];
    e.dataTransfer.setData('application/json', JSON.stringify(itemsToDrag.map(i => i.path)));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDropOnItem = async (e, targetItem) => {
    e.preventDefault();
    if (targetItem.type !== 'folder') return;

    try {
      const data = e.dataTransfer.getData('application/json');
      const paths = JSON.parse(data || '[]');
      const isCopy = e.ctrlKey;

      for (const sourcePath of paths) {
        const name = sourcePath.split('\\').pop();
        const destPath = targetItem.path + '\\' + name;
        if (isCopy) {
          await ipcRenderer?.invoke('copy-file', sourcePath, destPath);
        } else {
          await ipcRenderer?.invoke('move-file', sourcePath, destPath);
        }
      }
      loadDirectory(currentPath);
    } catch (err) {
      console.error('Drag/drop error:', err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    setSelectedItem(item);
    setSelectedItems([item]);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'c') {
        handleCopy();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'x') {
        handleCut();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'v') {
        handlePaste();
        e.preventDefault();
      } else if (e.key === 'Delete') {
        handleDelete();
        e.preventDefault();
      } else if (e.key === 'F2' && selectedItem) {
        setRenamingItem(selectedItem);
        setRenameValue(selectedItem.name);
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'n') {
        handleCreateFolder();
        e.preventDefault();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        setSelectedItems(displayItems);
        if (displayItems.length > 0) {
          setSelectedItem(displayItems[0]);
        }
        e.preventDefault();
      } else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
        handleBack();
        e.preventDefault();
      } else if (e.altKey && e.key === 'ArrowRight') {
        handleForward();
        e.preventDefault();
      } else if (e.altKey && e.key === 'ArrowUp') {
        handleUp();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setSelectedItems([]);
        setSelectedItem(null);
        setRenamingItem(null);
        setShowContextMenu(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems]);

  const getFileIcon = (item) => {
    if (item.type === 'drive') {
      return '💾';
    }
    if (item.type === 'folder') {
      return '📁';
    }
    const ext = item.ext.toLowerCase();
    const iconMap = {
      '.py': '🐍',
      '.js': '⚡',
      '.ts': '📘',
      '.jsx': '⚛️',
      '.tsx': '⚛️',
      '.json': '{ }',
      '.txt': '📄',
      '.md': '📝',
      '.html': '🌐',
      '.css': '🎨',
      '.cpp': '⚙️',
      '.c': '⚙️',
      '.java': '☕',
      '.go': '🐹',
      '.xml': '< >',
      '.pdf': '📕',
      '.doc': '📘',
      '.docx': '📘',
      '.xls': '📊',
      '.xlsx': '📊',
      '.png': '🖼️',
      '.jpg': '🖼️',
      '.jpeg': '🖼️',
      '.gif': '🎞️',
      '.mp3': '🎵',
      '.mp4': '🎬',
      '.zip': '📦',
      '.rar': '📦',
      '.7z': '📦',
    };
    return iconMap[ext] || '📄';
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (ms) => {
    return new Date(ms).toLocaleDateString();
  };

  const groupedItems = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'All items', items: displayItems }];
    }

    const groups = new Map();
    displayItems.forEach(item => {
      let key = 'Other';
      if (groupBy === 'type') {
        key = item.type === 'folder' ? 'Folders' : (item.ext || 'Other');
      } else if (groupBy === 'date') {
        key = formatDate(item.modified);
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }, [displayItems, groupBy]);

  const isFileSelected = (item) => {
    return selectedFiles.base?.path === item.path ||
      selectedFiles.ours?.path === item.path ||
      selectedFiles.theirs?.path === item.path ||
      selectedItems.some(i => i.path === item.path);
  };

  const navigateToQuickAccess = (folderName) => {
    loadDirectory(folderName);
  };

  // Check engine readiness on mount
  useEffect(() => {
    const checkEngine = async () => {
      try {
        const status = await window.intellifile?.searchStatus();
        console.log('[FileExplorer] Engine status:', status);
        if (status && status.ready) {
          setEngineReady(true);
          console.log('[FileExplorer] ✅ Engine ready');
        } else {
          console.log('[FileExplorer] Engine not ready yet, retrying...');
          setTimeout(checkEngine, 2000);
        }
      } catch (err) {
        console.error('[FileExplorer] Engine check error:', err);
        setTimeout(checkEngine, 3000);
      }
    };
    checkEngine();
  }, []);

  async function handleSearch(query) {
    if (!query || !query.trim()) {
      setSemanticResults(null);
      return;
    }
    console.log('[FileExplorer] Running semantic search for:', query);
    setSemanticLoading(true);
    try {
      const results = await searchFiles(query);
      console.log('[FileExplorer] Search results:', results);
      setSemanticResults(results || []);
    } catch (err) {
      console.error('[FileExplorer] Semantic search error:', err);
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  }

  async function handleIndexFolder() {
    console.log('[FileExplorer] Index folder clicked, engineReady:', engineReady);
    try {
      const result = await ipcRenderer?.invoke('dialog-select-folder');
      console.log('[FileExplorer] Folder selected:', result);
      if (!result || !result.path) return;
      setIndexing(true);
      setIndexedFolder('');
      const res = await indexFolder(result.path);
      console.log('[FileExplorer] Index result:', res);
      if (res && !res.error) {
        setIndexedFolder(result.path);
      } else {
        console.error('[FileExplorer] Indexing error:', res?.error);
      }
    } catch (err) {
      console.error('[FileExplorer] Index folder error:', err);
    } finally {
      setIndexing(false);
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      console.log('[FileExplorer] Enter pressed, triggering search:', searchQuery);
      handleSearch(searchQuery);
    } else if (e.key === 'Escape') {
      setSemanticResults(null);
      setSearchQuery('');
    }
  }

  function handleSearchResultClick(filePath) {
    // Open the file with the OS default application
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('open-file', filePath);
    }
  }

  return (
    <div className="file-explorer">
      {/* Sidebar - Quick Access */}
      <div className="explorer-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-title">Quick access</div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('This PC')}
          >
            <span className="sidebar-icon">💻</span>
            <span className="sidebar-label">This PC</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Desktop')}
          >
            <span className="sidebar-icon">🖥️</span>
            <span className="sidebar-label">Desktop</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Documents')}
          >
            <span className="sidebar-icon">📄</span>
            <span className="sidebar-label">Documents</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Downloads')}
          >
            <span className="sidebar-icon">⬇️</span>
            <span className="sidebar-label">Downloads</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Pictures')}
          >
            <span className="sidebar-icon">🖼️</span>
            <span className="sidebar-label">Pictures</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Music')}
          >
            <span className="sidebar-icon">🎵</span>
            <span className="sidebar-label">Music</span>
          </div>
          <div
            className="sidebar-item"
            onClick={() => navigateToQuickAccess('Videos')}
          >
            <span className="sidebar-icon">🎬</span>
            <span className="sidebar-label">Videos</span>
          </div>

          {/* Drives Section */}
          {drives.length > 0 && (
            <>
              <div className="sidebar-title" style={{ marginTop: '20px' }}>Drives</div>
              {drives.map((drive, idx) => {
                const usedSpace = drive.size - (drive.available || 0);
                const usedPercent = drive.size > 0 ? Math.round((usedSpace / drive.size) * 100) : 0;
                const availableGB = Math.round((drive.available || 0) / (1024 ** 3));
                const totalGB = Math.round(drive.size / (1024 ** 3));

                return (
                  <div key={drive.device || idx} className="drive-item" onClick={() => loadDirectory(drive.device)}>
                    <div className="drive-header">
                      <span className="drive-icon">💾</span>
                      <div className="drive-name-info">
                        <div className="drive-name">{drive.description}</div>
                        <div className="drive-space-text">{availableGB} GB free of {totalGB} GB</div>
                      </div>
                    </div>
                    <div className="drive-progress-container">
                      <div className="drive-progress-bar">
                        <div
                          className="drive-progress-fill"
                          style={{ width: `${usedPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="explorer-main-area">
        {/* Tabs */}
        <div className="tabs-bar">
          <div className="tabs">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => handleSelectTab(tab)}
              >
                <span className="tab-title">{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    title="Close tab"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="tab-add" onClick={handleNewTab} title="New tab">+</button>
        </div>

        {/* Top Navigation Bar */}
        <div className="explorer-navbar">
          <div className="nav-row">
            <div className="nav-buttons">
              <button
                className="nav-btn back-btn"
                onClick={handleBack}
                disabled={historyIndex <= 0}
                title="Back (Alt+←)"
              >
                ◀
              </button>
              <button
                className="nav-btn forward-btn"
                onClick={handleForward}
                disabled={historyIndex >= history.length - 1}
                title="Forward (Alt+→)"
              >
                ▶
              </button>
              <button
                className="nav-btn up-btn"
                onClick={handleUp}
                disabled={!currentPath}
                title="Up (Alt+↑)"
              >
                ⬆️
              </button>
            </div>

            {/* Breadcrumb */}
            <div className="breadcrumb">
              {breadcrumb.map((crumb, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="breadcrumb-sep">›</span>}
                  <button
                    className="breadcrumb-item"
                    onClick={() => handleBreadcrumbClick(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Address Bar */}
            <form className="address-bar" onSubmit={handleAddressSubmit}>
              <input
                type="text"
                value={addressPath}
                onChange={(e) => setAddressPath(e.target.value)}
                placeholder="Type a path"
              />
            </form>
          </div>

          {/* Toolbar - View & Sort Options */}
          <div className="explorer-toolbar">
            <div className="search-box">
              <input
                type="text"
                placeholder={engineReady ? "🔍 Search (Enter for AI search)" : "🔍 Search (engine loading...)"}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) setSemanticResults(null);
                }}
                onKeyDown={handleSearchKeyDown}
              />
              {semanticLoading && <span className="search-spinner">⏳</span>}
            </div>

            <div className="view-controls">
              <button
                className={`view-btn ${viewMode === 'icons' ? 'active' : ''}`}
                onClick={() => setViewMode('icons')}
                title="Icons view"
              >
                ⊞
              </button>
              <button
                className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                ≡
              </button>
              <button
                className={`view-btn ${viewMode === 'details' ? 'active' : ''}`}
                onClick={() => setViewMode('details')}
                title="Details view"
              >
                📋
              </button>
            </div>

            <div className="sort-controls">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select">
                <option value="name">Sort by Name</option>
                <option value="date">Sort by Date</option>
                <option value="size">Sort by Size</option>
                <option value="type">Sort by Type</option>
              </select>
            </div>

            <div className="group-controls">
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="group-select">
                <option value="none">Group: None</option>
                <option value="type">Group: Type</option>
                <option value="date">Group: Date</option>
              </select>
            </div>

            <div className="action-buttons">
              <button
                className="action-btn"
                onClick={handleCreateFolder}
                title="Create folder (Ctrl+N)"
              >
                ➕ New Folder
              </button>
              <button
                className="action-btn index-btn"
                onClick={handleIndexFolder}
                disabled={indexing}
                title={indexing ? 'Indexing in progress...' : engineReady ? 'Index a folder for AI search' : 'Engine loading... click to try anyway'}
              >
                {indexing ? '⏳ Indexing…' : '🧠 Index Folder'}
              </button>
              {indexedFolder && (
                <span className="indexed-label" title={indexedFolder}>✅ Indexed</span>
              )}
            </div>
          </div>
        </div>

        {/* File List + Preview Pane */}
        <div className="explorer-content-area">
          <div className="explorer-content">
            {/* Semantic Search Results Overlay */}
            {semanticResults !== null ? (
              <div className="semantic-results">
                <div className="semantic-results-header">
                  <h3>🧠 AI Search Results</h3>
                  <button className="close-results-btn" onClick={() => {
                    setSemanticResults(null);
                    setSearchQuery('');
                  }}>✕ Close</button>
                </div>
                {semanticResults.length === 0 ? (
                  <div className="empty-state">No matching files found</div>
                ) : (
                  <div className="file-list list">
                    {semanticResults.map((result, idx) => {
                      const fileName = result.path.split('\\').pop() || result.path.split('/').pop();
                      const scorePercent = Math.round(result.score * 100);
                      return (
                        <div
                          key={result.path + idx}
                          className="file-item file search-result-item"
                          onClick={() => handleSearchResultClick(result.path)}
                          title={result.path}
                        >
                          <div className="file-icon">📄</div>
                          <div className="file-info">
                            <div className="file-name">{fileName}</div>
                            <div className="file-meta">{result.path}</div>
                          </div>
                          <div className="search-score">
                            <div className="score-bar">
                              <div className="score-fill" style={{ width: `${scorePercent}%` }}></div>
                            </div>
                            <span className="score-text">{scorePercent}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : loading ? (
              <div className="loading">Loading...</div>
            ) : items.length === 0 ? (
              <div className="empty-state">📁 No files found</div>
            ) : (
              <div className={`file-list ${viewMode}`}>
                {groupedItems.map(group => (
                  <React.Fragment key={group.key}>
                    {groupBy !== 'none' && (
                      <div className="group-header">
                        {group.key} ({group.items.length})
                      </div>
                    )}
                    {group.items.map((item) => {
                      const idx = displayItems.findIndex(i => i.path === item.path);
                      return (
                        <div
                          key={item.path}
                          className={`file-item ${item.type} ${isFileSelected(item) ? 'selected' : ''} ${renamingItem?.path === item.path ? 'renaming' : ''}`}
                          onDoubleClick={() => handleFolderClick(item)}
                          onClick={(e) => handleItemClick(item, idx, e)}
                          onContextMenu={(e) => handleContextMenu(e, item)}
                          draggable
                          onDragStart={(e) => handleDragStart(e, item)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDropOnItem(e, item)}
                        >
                          <div className="file-icon">{getFileIcon(item)}</div>
                          <div className="file-info">
                            {renamingItem?.path === item.path ? (
                              <input
                                ref={inputRef}
                                type="text"
                                className="file-name-input"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={handleRename}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRename();
                                  if (e.key === 'Escape') setRenamingItem(null);
                                }}
                                autoFocus
                              />
                            ) : (
                              <>
                                <div className="file-name">{item.name}</div>
                                {viewMode === 'details' && (
                                  <div className="file-meta-details">
                                    <span className="file-type">{item.type === 'folder' ? 'Folder' : item.type === 'drive' ? 'Drive' : item.ext}</span>
                                    <span className="file-size">{item.type === 'drive' ? `${Math.round(item.size / (1024 ** 3))} GB` : formatFileSize(item.size)}</span>
                                    <span className="file-date">{formatDate(item.modified)}</span>
                                  </div>
                                )}
                                {viewMode !== 'details' && (
                                  <div className="file-meta">
                                    {item.type === 'folder' ? 'Folder' : item.type === 'drive' ? `${Math.round(item.size / (1024 ** 3))} GB total` : formatFileSize(item.size)}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {isFileSelected(item) && <div className="selected-badge">✓</div>}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="explorer-statusbar">
          <span>{items.length} items</span>
          <span>{selectedItems.length} selected</span>
          {selectedItem && (
            <span>{selectedItem.type === 'file' ? `${formatFileSize(selectedItem.size)} · ${formatDate(selectedItem.modified)}` : 'Folder'}</span>
          )}
          {clipboard && <span>📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length} item(s)</span>}
        </div>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        >
          <div className="context-menu-item" onClick={() => openFileWithDefaultApp(selectedItem.path)}>
            Open
          </div>
          <div className="context-menu-divider"></div>
          <div
            className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
            onClick={selectedItem?.protected ? null : handleCut}
          >
            ✂️ Cut (Ctrl+X)
          </div>
          <div className="context-menu-item" onClick={handleCopy}>
            📋 Copy (Ctrl+C)
          </div>
          <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={handlePaste}>
            📌 Paste (Ctrl+V)
          </div>
          <div className="context-menu-divider"></div>
          <div
            className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
            onClick={selectedItem?.protected ? null : () => {
              setRenamingItem(selectedItem);
              setRenameValue(selectedItem.name);
              setShowContextMenu(false);
            }}
          >
            ✏️ Rename (F2)
          </div>
          <div
            className={`context-menu-item delete ${selectedItem?.protected ? 'disabled' : ''}`}
            onClick={selectedItem?.protected ? null : handleDelete}
          >
            🗑️ Delete
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => setShowProperties(true)}>
            ℹ️ Properties
          </div>
        </div>
      )}

      {/* Properties Modal */}
      {showProperties && selectedItem && (
        <div className="properties-modal" onClick={() => setShowProperties(false)}>
          <div className="properties-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="properties-header">Properties</div>
            <div className="properties-content">
              <div className="detail-row"><span>Name</span><span>{selectedItem.name}</span></div>
              <div className="detail-row"><span>Path</span><span>{selectedItem.path}</span></div>
              <div className="detail-row"><span>Type</span><span>{selectedItem.type === 'folder' ? 'Folder' : selectedItem.ext}</span></div>
              <div className="detail-row"><span>Size</span><span>{selectedItem.type === 'folder' ? '-' : formatFileSize(selectedItem.size)}</span></div>
              <div className="detail-row"><span>Modified</span><span>{formatDate(selectedItem.modified)}</span></div>
            </div>
            <div className="properties-actions">
              <button className="action-btn" onClick={() => setShowProperties(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileExplorer;
