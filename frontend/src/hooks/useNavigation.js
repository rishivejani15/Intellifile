// Hook for navigation logic: history, breadcrumbs, tabs, address bar
import { useEffect, useCallback, useState } from 'react';

const NAV_STATE_KEY = 'intellifile-navigation-state';

const readSavedNavigationState = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(NAV_STATE_KEY) || '{}') || {};
  } catch (error) {
    return {};
  }
};

export const useNavigation = (ipcRenderer) => {
  const savedState = readSavedNavigationState();
  const [currentPath, setCurrentPath] = useState(savedState.currentPath || null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [tabs, setTabs] = useState(savedState.tabs || [{ id: 'tab-1', path: savedState.currentPath || null, title: 'Documents', history: savedState.currentPath ? [savedState.currentPath] : [], historyIndex: savedState.currentPath ? 0 : -1 }]);
  const [activeTabId, setActiveTabId] = useState(savedState.activeTabId || 'tab-1');
  const [addressPath, setAddressPath] = useState(savedState.addressPath || '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
        currentPath,
        tabs,
        activeTabId,
        addressPath,
      }));
    } catch (error) {
      // ignore storage failures
    }
  }, [currentPath, tabs, activeTabId, addressPath]);

  const updateBreadcrumb = useCallback((dirPath) => {
    const parts = dirPath.split('\\').filter(p => p);
    const crumbs = parts.map((part, idx) => ({
      name: part,
      path: parts.slice(0, idx + 1).join('\\') + '\\'
    }));
    setBreadcrumb(crumbs);
  }, []);

  const updateHistory = useCallback((path, tabId) => {
    const targetId = tabId || activeTabId;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== targetId) return tab;
      const baseHistory = Array.isArray(tab.history) ? tab.history : [];
      const baseIndex = typeof tab.historyIndex === 'number' ? tab.historyIndex : -1;
      const newHistory = baseHistory.slice(0, baseIndex + 1);
      newHistory.push(path);
      return { ...tab, history: newHistory, historyIndex: baseIndex + 1 };
    }));
  }, [activeTabId]);

  const updateActiveTab = useCallback((path, tabId) => {
    const targetId = tabId || activeTabId;
    setTabs(prev => prev.map(tab => {
      if (tab.id === targetId) {
        const title = path.split('\\').filter(Boolean).pop() || 'Root';
        return { ...tab, path, title };
      }
      return tab;
    }));
  }, [activeTabId]);

  const handleBack = useCallback(() => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (!activeTab || activeTab.historyIndex <= 0) return null;
    const newIndex = activeTab.historyIndex - 1;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      return { ...tab, historyIndex: newIndex };
    }));
    return activeTab.history[newIndex] || null;
  }, [tabs, activeTabId]);

  const handleForward = useCallback(() => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return null;
    const newIndex = activeTab.historyIndex + 1;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      return { ...tab, historyIndex: newIndex };
    }));
    return activeTab.history[newIndex] || null;
  }, [tabs, activeTabId]);

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
    setTabs(prev => {
      const history = currentPath ? [currentPath] : [];
      const historyIndex = currentPath ? 0 : -1;
      return [...prev, { id: newId, path: currentPath, title: 'New Tab', history, historyIndex }];
    });
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

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const history = activeTab?.history || [];
  const historyIndex = typeof activeTab?.historyIndex === 'number' ? activeTab.historyIndex : -1;

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
