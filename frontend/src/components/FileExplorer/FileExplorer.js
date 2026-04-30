import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { searchFiles, indexDevice } from '../../services/searchService';
import { useNavigation } from '../../hooks/useNavigation';
import { useFileExplorer } from '../../hooks/useFileExplorer';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import ExplorerSidebar from '../ExplorerSidebar';
import ExplorerNavbar from '../ExplorerNavbar';
import FileList from '../FileList';
import ContextMenu from '../ContextMenu';
import PropertiesModal from '../PropertiesModal';
import SearchResults from '../SearchResults';
import TabsBar from '../TabsBar';
import './FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

function FileExplorer({ onFileSelect, selectedFiles = {}, drives = [], onChatWithAI }) {
  // UI State
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('icons');
  const [sortBy, setSortBy] = useState('name');
  const [groupBy, setGroupBy] = useState('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [showProperties, setShowProperties] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  
  // Search & Indexing State
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
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
    renameValue, setRenameValue
  } = fileOps;

  const displayItems = useMemo(() => items, [items]);

  // Load directory with filtering and sorting
  const loadDirectory = useCallback(async (dirPath) => {
    setLoading(true);
    setRenamingItem(null);
    setShowContextMenu(false);
    try {
      const result = await ipcRenderer?.invoke('list-directory', dirPath);
      if (!result || result.error) {
        console.error('Error loading directory:', result?.error || 'Unknown error');
        setItems([]);
        if (dirPath && dirPath !== 'C:\\') {
          const parentPath = dirPath.substring(0, dirPath.lastIndexOf('\\'));
          if (parentPath && parentPath !== dirPath) {
            setTimeout(() => loadDirectory(parentPath), 100);
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
          return cmp;
        });

        setItems(loadedItems);
        const actualPath = loadedItems && loadedItems.length > 0 ?
          loadedItems[0].path.substring(0, loadedItems[0].path.lastIndexOf('\\')) :
          dirPath;
        
        if (actualPath) {
          setCurrentPath(actualPath);
          setAddressPath(actualPath);
          updateBreadcrumb(actualPath);
          setSelectedItem(prev => (prev && loadedItems.some(i => i.path === prev.path)) ? prev : null);
          setSelectedItems(prev => prev.filter(pItem => loadedItems.some(i => i.path === pItem.path)));
          setLastSelectedIndex(null);
          updateHistory(actualPath);
          updateActiveTab(actualPath);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, [updateBreadcrumb, searchQuery, sortBy, updateHistory, updateActiveTab, setCurrentPath, setAddressPath, setRenamingItem]);

  // Initialize with Documents folder
  useEffect(() => {
    if (!currentPath) {
      loadDirectory(null);
    }
  }, [currentPath, loadDirectory]);

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => {
      if (currentPath) loadDirectory(currentPath);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentPath, loadDirectory]);

  // Event Handlers
  const handleAddressSubmit = (e) => {
    e.preventDefault();
    if (addressPath) loadDirectory(addressPath);
  };

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
    setLastSelectedIndex(idx);
    if (onFileSelect) onFileSelect(item);
  };

  const handleBreadcrumbClick = (path) => {
    loadDirectory(path.replace(/\/$/, ''));
  };

  const handleBack = () => {
    const prevPath = navBack();
    if (prevPath) loadDirectory(prevPath);
  };

  const handleForward = () => {
    const nextPath = navForward();
    if (nextPath) loadDirectory(nextPath);
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
    await fileOps.handlePaste(currentPath, () => loadDirectory(currentPath));
  };

  const handleRename = async () => {
    const result = await fileOps.handleRename(currentPath, () => loadDirectory(currentPath));
    if (result) loadDirectory(currentPath);
  };

  const handleDelete = async () => {
    await fileOps.handleDelete(selectedItems, selectedItem, currentPath, () => loadDirectory(currentPath));
    setShowContextMenu(false);
    loadDirectory(currentPath);
  };

  const handleCreateFolder = async () => {
    await fileOps.handleCreateFolder(currentPath, () => loadDirectory(currentPath));
  };

  const handleDragStart = (e, item) => {
    fileOps.handleDragStart(e, item, selectedItems);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
  };

  const handleDropOnItem = async (e, targetItem) => {
    await fileOps.handleDropOnItem(e, targetItem, currentPath, () => loadDirectory(currentPath));
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    setSelectedItem(item);
    setSelectedItems([item]);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
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

  const handleIndexDevice = async () => {
    try {
      setIndexing(true);
      setIndexedFolder('');
      const res = await indexDevice();
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
    const path = handleSelectTab(tab);
    if (path) loadDirectory(path);
  };

  const handleTabClose = (tabId) => {
    handleCloseTab(tabId, (path) => {
      if (path) loadDirectory(path);
    });
  };

  return (
    <div className="file-explorer">
      <ExplorerSidebar drives={drives} onNavigate={loadDirectory} />

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
          groupBy={groupBy}
          searchQuery={searchQuery}
          engineReady={engineReady}
          indexing={indexing}
          indexedFolder={indexedFolder}
          semanticLoading={semanticLoading}
          onAddressSubmit={handleAddressSubmit}
          onBreadcrumbClick={handleBreadcrumbClick}
          onBack={handleBack}
          onForward={handleForward}
          onUp={handleUp}
          onViewModeChange={setViewMode}
          onSortByChange={setSortBy}
          onGroupByChange={setGroupBy}
          onCreateFolder={handleCreateFolder}
          onIndexDevice={handleIndexDevice}
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
                onItemClick={handleItemClick}
                onItemDoubleClick={handleFolderClick}
                onContextMenu={handleContextMenu}
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

          <div className="explorer-statusbar">
            <span>{items.length} items</span>
            <span>{selectedItems.length} selected</span>
            {selectedItem && (
              <span>{selectedItem.type === 'file' ? `${formatFileSize(selectedItem.size)}` : 'Folder'}</span>
            )}
            {clipboard && <span>📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length} item(s)</span>}
          </div>
        </div>
      </div>

      <ContextMenu
        visible={showContextMenu}
        position={contextMenuPos}
        selectedItem={selectedItem}
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
