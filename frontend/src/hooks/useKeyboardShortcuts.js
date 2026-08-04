// Hook for keyboard shortcuts
import { useEffect } from 'react';

export const useKeyboardShortcuts = ({
  selectedItem,
  selectedItems,
  clipboard,
  renamingItem,
  currentPath,
  historyIndex,
  displayItems,
  lastSelectedIndex,
  handleCopy,
  handleCut,
  handlePaste,
  handleDelete,
  handleRename,
  handleCreateFolder,
  handleBack,
  handleForward,
  handleUp,
  handleRefresh,
  handleUndo,
  handleRedo,
  handleOpen,
  onCharacterType,
  onFileSelect,
  setSelectedItems,
  setSelectedItem,
  setLastSelectedIndex,
  setRenamingItem,
  setRenameValue,
  setShowContextMenu,
}) => {
  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false;
      if (target.isContentEditable) return true;
      const tag = (target.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handleKeyDown = (e) => {
      if (isEditableTarget(e.target)) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();

      if (isCtrl && key === 'c') {
        handleCopy();
        e.preventDefault();
      } else if (isCtrl && key === 'x') {
        handleCut();
        e.preventDefault();
      } else if (isCtrl && key === 'v') {
        handlePaste();
        e.preventDefault();
      } else if (isCtrl && key === 'z' && !e.shiftKey) {
        handleUndo?.();
        e.preventDefault();
      } else if ((isCtrl && key === 'y') || (isCtrl && key === 'z' && e.shiftKey)) {
        handleRedo?.();
        e.preventDefault();
      } else if (e.key === 'Delete') {
        handleDelete();
        e.preventDefault();
      } else if (e.key === 'F2' && selectedItem) {
        setRenamingItem(selectedItem);
        setRenameValue(selectedItem.name);
        e.preventDefault();
      } else if (isCtrl && key === 'n') {
        handleCreateFolder();
        e.preventDefault();
      } else if (isCtrl && key === 'a') {
        setSelectedItems(displayItems);
        if (displayItems.length > 0) {
          setSelectedItem(displayItems[0]);
        }
        e.preventDefault();
      } else if (e.key === 'Enter' && selectedItem && !renamingItem) {
        handleOpen?.(selectedItem);
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        if (!displayItems || displayItems.length === 0) return;
        const currentIdx = displayItems.findIndex(i => i.path === selectedItem?.path);
        let nextIdx = 0;

        if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = displayItems.length - 1;
        } else if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < 0 ? 0 : Math.min(displayItems.length - 1, currentIdx + 1);
        } else if (e.key === 'ArrowUp') {
          nextIdx = currentIdx < 0 ? 0 : Math.max(0, currentIdx - 1);
        }

        const targetItem = displayItems[nextIdx];
        if (!targetItem) return;

        if (e.shiftKey) {
          const anchor = typeof lastSelectedIndex === 'number' && lastSelectedIndex !== null ? lastSelectedIndex : (currentIdx >= 0 ? currentIdx : 0);
          const start = Math.min(anchor, nextIdx);
          const end = Math.max(anchor, nextIdx);
          const newSelection = displayItems.slice(start, end + 1);
          setSelectedItems(newSelection);
          setSelectedItem(targetItem);
          if (lastSelectedIndex === null && setLastSelectedIndex) setLastSelectedIndex(anchor);
        } else {
          setSelectedItems([targetItem]);
          setSelectedItem(targetItem);
          if (setLastSelectedIndex) setLastSelectedIndex(nextIdx);
        }

        if (onFileSelect) onFileSelect(targetItem);

        setTimeout(() => {
          const escapedPath = (targetItem.path || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const el = document.querySelector(`[data-path="${escapedPath}"]`) || document.querySelector('.file-item.selected');
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 20);

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
      } else if (e.key === 'F5') {
        handleRefresh?.();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setSelectedItems([]);
        setSelectedItem(null);
        setRenamingItem(null);
        setShowContextMenu(false);
      } else if (!isCtrl && !e.altKey && !e.metaKey && e.key && e.key.length === 1) {
        onCharacterType?.(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedItem,
    selectedItems,
    clipboard,
    renamingItem,
    currentPath,
    historyIndex,
    displayItems,
    lastSelectedIndex,
    handleCopy,
    handleCut,
    handlePaste,
    handleDelete,
    handleCreateFolder,
    handleBack,
    handleForward,
    handleUp,
    handleRefresh,
    handleUndo,
    handleRedo,
    handleOpen,
    onCharacterType,
    onFileSelect,
    setSelectedItems,
    setSelectedItem,
    setLastSelectedIndex,
    setRenamingItem,
    setRenameValue,
    setShowContextMenu,
  ]);
};
