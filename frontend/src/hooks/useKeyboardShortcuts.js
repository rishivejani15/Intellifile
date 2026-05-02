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
  setSelectedItems,
  setSelectedItem,
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
      if (e.ctrlKey && e.key === 'c') {
        handleCopy();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'x') {
        handleCut();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'v') {
        handlePaste();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'z') {
        handleUndo?.();
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
      } else if (e.key === 'F5') {
        handleRefresh?.();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems]);
};
