// Hook for navigation logic: history, breadcrumbs, tabs, address bar
import { useState, useCallback } from 'react';

export const useNavigation = (ipcRenderer) => {
  const [currentPath, setCurrentPath] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tabs, setTabs] = useState([{ id: 'tab-1', path: null, title: 'Documents' }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [addressPath, setAddressPath] = useState('');

  const updateBreadcrumb = useCallback((dirPath) => {
    const parts = dirPath.split('\\').filter(p => p);
    const crumbs = parts.map((part, idx) => ({
      name: part,
      path: parts.slice(0, idx + 1).join('\\') + '\\'
    }));
    setBreadcrumb(crumbs);
  }, []);

  const updateHistory = useCallback((path) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(path);
      return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const updateActiveTab = useCallback((path) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id === activeTabId) {
        const title = path.split('\\').filter(Boolean).pop() || 'Root';
        return { ...tab, path, title };
      }
      return tab;
    }));
  }, [activeTabId]);

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      return history[historyIndex - 1];
    }
    return null;
  }, [historyIndex, history]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      return history[historyIndex + 1];
    }
    return null;
  }, [historyIndex, history]);

  const handleUp = useCallback(() => {
    if (currentPath && currentPath !== 'C:\\') {
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('\\'));
      if (parentPath) return parentPath;
    }
    return null;
  }, [currentPath]);

  const preserveSelections = useCallback((oldItems, newItems) => {
    return (prevSelectedItems) => 
      prevSelectedItems.filter(pItem => newItems.some(i => i.path === pItem.path));
  }, []);

  const handleNewTab = useCallback(() => {
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, path: currentPath, title: 'New Tab' }]);
    setActiveTabId(newId);
  }, [currentPath]);

  const handleCloseTab = useCallback((tabId, onTabClose) => {
    setTabs(prev => {
      if (prev.length === 1) return prev;
      const filtered = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId) {
        const nextTab = filtered[filtered.length - 1];
        setActiveTabId(nextTab.id);
        if (nextTab.path && onTabClose) {
          onTabClose(nextTab.path);
        }
      }
      return filtered;
    });
  }, [activeTabId]);

  const handleSelectTab = useCallback((tab) => {
    setActiveTabId(tab.id);
    return tab.path;
  }, []);

  return {
    currentPath,
    setCurrentPath,
    breadcrumb,
    setBreadcrumb,
    history,
    historyIndex,
    tabs,
    activeTabId,
    addressPath,
    setAddressPath,
    updateBreadcrumb,
    updateHistory,
    updateActiveTab,
    handleBack,
    handleForward,
    handleUp,
    preserveSelections,
    handleNewTab,
    handleCloseTab,
    handleSelectTab,
  };
};
