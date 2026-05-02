import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { searchFiles, indexDevice } from '../../services/searchService';
import { updateBreadcrumb, sortItems, getParentPath } from './utils/fileUtils';
import { useFileOperations, useNavigation, useSelection, useKeyboardShortcuts } from './hooks';
import { Sidebar, Toolbar, TabsBar, Breadcrumb, FileList, ContextMenu, StatusBar } from './components';
import VersionTimeline from '../Versioning/VersionTimeline';
import { smartCleanupVersions } from '../../services/versionService';
import './FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

function FileExplorer({ onFileSelect, selectedFiles = {}, drives = [], onChatWithAI, onVersioning, versioningFile, onCloseVersioning }) {
  // Core state
  const [currentPath, setCurrentPath] = useState(null);
  const [items, setItems] = useState([]);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('icons');
  const [sortBy, setSortBy] = useState('name');
  const [groupBy, setGroupBy] = useState('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexedFolder, setIndexedFolder] = useState('');

  // Tab state
  const [tabs, setTabs] = useState([{ id: 'tab-1', path: null, title: 'Documents' }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [addressPath, setAddressPath] = useState('');

  // Rename state
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // History state
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Context menu state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const inputRef = useRef(null);

  // Derived values
  const displayItems = useMemo(() => sortItems(items, sortBy), [items, sortBy]);

  // Refresh callback for file operations
  const handleRefresh = useCallback(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath]);




  // Initialize hooks that define preserveSelection before loadDirectory
  const {
    selectedItem,
    setSelectedItem,
    selectedItems,
    setSelectedItems,
    handleItemClick,
    clearSelection,
    selectAll,
    preserveSelection,
    resetSelection,
  } = useSelection(displayItems, onFileSelect);

  // Load directory function (now after useSelection)
  const loadDirectory = useCallback(async (dirPath) => {
    setLoading(true);
    setRenamingItem(null);
    setShowContextMenu(false);
    try {
      const result = await ipcRenderer?.invoke('list-directory', dirPath);
      if (!result || result.error) {
        console.error('Error loading directory:', result?.error || 'Unknown error');
        setItems([]);
        // Auto-navigate to parent folder if current folder is completely missing/deleted
        if (dirPath && dirPath !== 'C:\\') {
          const parentPath = getParentPath(dirPath);
          if (parentPath && parentPath !== dirPath) {
            setTimeout(() => { loadDirectory(parentPath) }, 100);
          }
        }
      } else {
        let dirItems = result.items || [];
        // Apply search filter
        if (searchQuery) {
          dirItems = dirItems.filter(item =>
            item.name.toLowerCase().includes(searchQuery.toLowerCase())
          );
        }
        setItems(dirItems);
        const actualPath = dirItems.length > 0
          ? dirItems[0].path.substring(0, dirItems[0].path.lastIndexOf('\\'))
          : dirPath;
        if (actualPath) {
          setCurrentPath(actualPath);
          setAddressPath(actualPath);
          setBreadcrumb(updateBreadcrumb(actualPath));
          // Preserve selections
          preserveSelection(dirItems);
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
  }, [searchQuery, sortBy, historyIndex, activeTabId, preserveSelection]);



  // Initialize hooks
  const {
    clipboard,
    handleCopy,
    handleCut,
    handlePaste,
    handleRename: fileOpRename,
    handleDelete,
    handleCreateFolder,
  } = useFileOperations(currentPath, handleRefresh);

  const navigation = useNavigation(history, historyIndex, loadDirectory);

  // Initialize with Documents folder
  useEffect(() => {
    if (!currentPath) {
      loadDirectory(null);
    }
  }, [currentPath, loadDirectory]);

  // Refresh directory when window gains focus
  useEffect(() => {
    const handleFocus = () => {
      if (currentPath) {
        loadDirectory(currentPath);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentPath, loadDirectory]);

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

  // Keyboard shortcuts
  useKeyboardShortcuts({
    selectedItem,
    selectedItems,
    clipboard,
    renamingItem,
    currentPath,
    historyIndex,
    displayItems,
    onCopy: () => handleCopy(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : [])),
    onCut: () => handleCut(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : [])),
    onPaste: handlePaste,
    onDelete: () => handleDelete(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : [])),
    onRename: (item) => {
      setRenamingItem(item);
      setRenameValue(item.name);
    },
    onCreateFolder: handleCreateFolder,
    onSelectAll: selectAll,
    onBack: navigation.handleBack,
    onForward: navigation.handleForward,
    onUp: () => navigation.handleUp(currentPath),
    onClearSelection: () => {
      clearSelection();
      setRenamingItem(null);
      setShowContextMenu(false);
    },
  });

  // File operation handlers
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

  const handleRename = async (item) => {
    await fileOpRename(renamingItem, renameValue);
    setRenamingItem(null);
  };

  const handleRenameCancel = () => {
    setRenamingItem(null);
    setRenameValue('');
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    setSelectedItem(item);
    setSelectedItems([item]);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
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

  // Search handlers
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

  async function handleIndexDevice() {
    console.log('[FileExplorer] Index device clicked, engineReady:', engineReady);
    try {
      setIndexing(true);
      setIndexedFolder('');
      const res = await indexDevice();
      console.log('[FileExplorer] Index result:', res);
      if (res && !res.error) {
        setIndexedFolder('Device Root');
      } else {
        console.error('[FileExplorer] Indexing error:', res?.error);
      }
    } catch (err) {
      console.error('[FileExplorer] Index device error:', err);
    } finally {
      setIndexing(false);
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      handleSearch(searchQuery);
    } else if (e.key === 'Escape') {
      setSemanticResults(null);
      setSearchQuery('');
    }
  }

  function handleSearchResultClick(filePath) {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('open-file', filePath);
    }
  }

  // Tab handlers
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

  return (
    <div className={`file-explorer ${versioningFile && versioningFile.path ? 'with-versioning' : ''}`}>
      <Sidebar drives={drives} onNavigate={loadDirectory} />

      <div className="explorer-main-area">
        <TabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
        />

        <div className="explorer-navbar">
          <div className="nav-row">
            <div className="nav-buttons">
              <button
                className="nav-btn back-btn"
                onClick={navigation.handleBack}
                disabled={!navigation.canGoBack}
                title="Back (Alt+←)"
              >
                ◀
              </button>
              <button
                className="nav-btn forward-btn"
                onClick={navigation.handleForward}
                disabled={!navigation.canGoForward}
                title="Forward (Alt+→)"
              >
                ▶
              </button>
              <button
                className="nav-btn up-btn"
                onClick={() => navigation.handleUp(currentPath)}
                disabled={!navigation.canGoUp(currentPath)}
                title="Up (Alt+↑)"
              >
                ⬆️
              </button>
            </div>

            <Breadcrumb breadcrumb={breadcrumb} onNavigate={navigation.handleBreadcrumbClick} />

            <form className="address-bar" onSubmit={(e) => navigation.handleAddressSubmit(e, addressPath)}>
              <input
                type="text"
                value={addressPath}
                onChange={(e) => setAddressPath(e.target.value)}
                placeholder="Type a path"
              />
            </form>
          </div>

          <Toolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchKeyDown={handleSearchKeyDown}
            semanticLoading={semanticLoading}
            engineReady={engineReady}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortBy={sortBy}
            onSortChange={setSortBy}
            groupBy={groupBy}
            onGroupChange={setGroupBy}
            onCreateFolder={handleCreateFolder}
            onIndexDevice={handleIndexDevice}
            indexing={indexing}
            indexedFolder={indexedFolder}
          />
        </div>

        <div className="explorer-content-area">
          <div className="explorer-content">
            <FileList
              items={items}
              viewMode={viewMode}
              groupBy={groupBy}
              loading={loading}
              semanticResults={semanticResults}
              selectedItem={selectedItem}
              selectedItems={selectedItems}
              renamingItem={renamingItem}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRename={handleRename}
              onRenameCancel={handleRenameCancel}
              selectedFiles={selectedFiles}
              onItemClick={(item, idx, e) => handleItemClick(item, idx, e, renamingItem)}
              onItemDoubleClick={handleFolderClick}
              onContextMenu={handleContextMenu}
              onDropOnItem={handleDropOnItem}
              onDragOver={handleDragOver}
              onSearchResultClick={handleSearchResultClick}
              onCloseSearch={() => { setSemanticResults(null); setSearchQuery(''); }}
            />
          </div>
        </div>

        <StatusBar
          items={items}
          selectedItems={selectedItems}
          selectedItem={selectedItem}
          clipboard={clipboard}
        />
      </div>

      {versioningFile && versioningFile.path && (
        <aside className="versioning-panel">
          <header className="panel-header">
            <div className="header-title-group">
              <h3>Version History</h3>
            </div>
            <div className="header-actions">
              <button 
                className="panel-refresh-btn" 
                onClick={() => {
                  // This is a hacky way to trigger a refresh if we don't want to pass a prop
                  // But the key prop will handle initial load perfectly
                  const event = new CustomEvent('refresh-version-timeline');
                  window.dispatchEvent(event);
                }}
                title="Refresh history"
              >
                🔄
              </button>
              <button
                className="panel-refresh-btn"
                onClick={async () => {
                  if (!versioningFile?.path) return;
                  try {
                    const result = await smartCleanupVersions(versioningFile.path);
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

                    const event = new CustomEvent('refresh-version-timeline');
                    window.dispatchEvent(event);
                  } catch (err) {
                    alert('Cleanup failed: ' + (err?.message || 'Unknown error'));
                  }
                }}
                title="Smart cleanup history"
              >
                🧹
              </button>
              <button className="close-panel-btn" onClick={onCloseVersioning} title="Close">
                ×
              </button>
            </div>
          </header>
          <div className="panel-content">
            <VersionTimeline 
              key={versioningFile.path} 
              filePath={versioningFile.path} 
            />
          </div>
        </aside>
      )}

      <ContextMenu
        show={showContextMenu}
        position={contextMenuPos}
        selectedItem={selectedItem}
        onClose={() => setShowContextMenu(false)}
        onOpen={() => openFileWithDefaultApp(selectedItem?.path)}
        onCut={() => handleCut(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []))}
        onCopy={() => handleCopy(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []))}
        onPaste={handlePaste}
        onRename={() => { setRenamingItem(selectedItem); setRenameValue(selectedItem?.name); }}
        onDelete={() => handleDelete(selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []))}
        onVersioning={onVersioning}
        onChatWithAI={onChatWithAI}
        hasClipboard={!!clipboard}
      />
    </div>
  );
}

export default FileExplorer;
