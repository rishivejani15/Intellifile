import { useState, useCallback } from 'react';

/**
 * Hook for selection logic
 */
export function useSelection(displayItems, onFileSelect) {
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);

  const handleItemClick = useCallback((item, idx, e, renamingItem) => {
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

    // Call onFileSelect regardless of editability so the App knows what's selected
    if (onFileSelect) {
      onFileSelect(item);
    }
  }, [displayItems, selectedItems, lastSelectedIndex, onFileSelect]);

  const clearSelection = useCallback(() => {
    setSelectedItems([]);
    setSelectedItem(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedItems(displayItems);
    if (displayItems.length > 0) {
      setSelectedItem(displayItems[0]);
    }
  }, [displayItems]);

  const preserveSelection = useCallback((items) => {
    // Preserve selection after refresh
    setSelectedItem(prev => (prev && items.some(i => i.path === prev.path)) ? prev : null);
    setSelectedItems(prev => prev.filter(pItem => items.some(i => i.path === pItem.path)));
    setLastSelectedIndex(null);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedItem(null);
    setSelectedItems([]);
    setLastSelectedIndex(null);
  }, []);

  return {
    selectedItem,
    setSelectedItem,
    selectedItems,
    setSelectedItems,
    lastSelectedIndex,
    handleItemClick,
    clearSelection,
    selectAll,
    preserveSelection,
    resetSelection,
  };
}

export default useSelection;
