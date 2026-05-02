import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { searchFiles, onIndexProgress, onIndexComplete } from '../../services/searchService';
import { useNavigation } from '../../hooks/useNavigation';
import { useFileExplorer } from '../../hooks/useFileExplorer';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import ExplorerSidebar from '../ExplorerSidebar';
import ExplorerNavbar from '../ExplorerNavbar';
import FileList from '../FileList';
import ContextMenu from '../ContextMenu';
import PropertiesModal from '../PropertiesModal';
import PreviewPanel from '../PreviewPanel';
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
  const [sortDirection, setSortDirection] = useState('asc');
  const [groupBy, setGroupBy] = useState('none');
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [showProperties, setShowProperties] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isEmptySpaceContext, setIsEmptySpaceContext] = useState(false);

  // Search & Indexing State
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexPhase, setIndexPhase] = useState('');
  const [indexDetail, setIndexDetail] = useState('');
  const [indexPct, setIndexPct] = useState(null);
  const [indexMessage, setIndexMessage] = useState('');

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
      const result = await ipcRenderer?.invoke('list-directory', dirPath, { showHidden });
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
  }, [updateBreadcrumb, searchQuery, sortBy, sortDirection, showHidden, updateHistory, updateActiveTab, setCurrentPath, setAddressPath, setRenamingItem]);

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

  const handleRefresh = () => {
    if (currentPath) loadDirectory(currentPath);
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

  const handleCreateFile = async (fileName) => {
    await fileOps.handleCreateFile(currentPath, fileName, () => loadDirectory(currentPath));
  };

  const handleUndo = async () => {
    await fileOps.handleUndo(() => loadDirectory(currentPath));
  };

  const handleOpenWith = async () => {
    if (selectedItem && selectedItem.type === 'file') {
      await ipcRenderer?.invoke('open-with', selectedItem.path);
    }
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
    if (selectedItem?.type === 'folder' && window.__intellifile_addFavorite) {
      window.__intellifile_addFavorite(selectedItem.path, selectedItem.name);
    }
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
    setIsEmptySpaceContext(false);
    setShowContextMenu(true);
  };

  const handleEmptySpaceContextMenu = (e) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsEmptySpaceContext(true);
    setShowContextMenu(true);
  };

  // Keyboard shortcuts hook
  useKeyboardShortcuts({
    selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems,
    handleCopy, handleCut, handlePaste, handleDelete, handleRename, handleCreateFolder,
    handleBack, handleForward, handleUp,
    handleRefresh, handleUndo,
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
      if (payload && payload.error) {
        setIndexMessage(`Indexing failed: ${payload.error}`);
      } else {
        setIndexMessage('Index updated');
      }
    });

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
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
          showHidden={showHidden}
          searchQuery={searchQuery}
          engineReady={engineReady}
          indexing={indexing}
          indexPhase={indexPhase}
          indexDetail={indexDetail}
          indexPct={indexPct}
          indexMessage={indexMessage}
          semanticLoading={semanticLoading}
          onAddressSubmit={handleAddressSubmit}
          onBreadcrumbClick={handleBreadcrumbClick}
          onBack={handleBack}
          onForward={handleForward}
          onUp={handleUp}
          onRefresh={handleRefresh}
          onViewModeChange={setViewMode}
          onSortByChange={setSortBy}
          onSortDirectionChange={setSortDirection}
          onGroupByChange={setGroupBy}
          onShowHiddenChange={setShowHidden}
          onCreateFolder={handleCreateFolder}
          onCreateFile={handleCreateFile}
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

          {/* Preview Panel */}
          {showPreview && (
            <PreviewPanel
              selectedItem={selectedItem}
              visible={showPreview}
              onClose={() => setShowPreview(false)}
            />
          )}

          <div className="explorer-statusbar">
            <span>{items.length} items</span>
            <span>{selectedItems.length} selected</span>
            {selectedItem && (
              <span>{selectedItem.type === 'file' ? `${formatFileSize(selectedItem.size)}` : 'Folder'}</span>
            )}
            {clipboard && <span>📋 {clipboard.operation === 'cut' ? 'Cut' : 'Copied'}: {clipboard.items.length} item(s)</span>}
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
      </div>

      <ContextMenu
        visible={showContextMenu}
        position={contextMenuPos}
        selectedItem={selectedItem}
        clipboard={clipboard}
        isEmptySpace={isEmptySpaceContext}
        currentPath={currentPath}
        onOpen={() => selectedItem && (selectedItem.type === 'folder' ? loadDirectory(selectedItem.path) : openFileWithDefaultApp(selectedItem.path))}
        onOpenWith={handleOpenWith}
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
        onCopyPath={handleCopyPath}
        onOpenTerminal={handleOpenTerminal}
        onOpenInVSCode={handleOpenInVSCode}
        onPinToFavorites={handlePinToFavorites}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onRefresh={handleRefresh}
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
