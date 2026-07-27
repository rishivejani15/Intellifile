import { useEffect } from 'react';

/**
 * Hook for keyboard shortcuts
 */
export function useKeyboardShortcuts({
  selectedItem,
  selectedItems,
  clipboard,
  renamingItem,
  currentPath,
  historyIndex,
  displayItems,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onRename,
  onCreateFolder,
  onSelectAll,
  onBack,
  onForward,
  onUp,
  onClearSelection,
  handleRefresh,
  handleUndo,
  handleRedo,
  setShowContextMenu,
}) {
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
        onCopy?.();
        e.preventDefault();
      } else if (isCtrl && key === 'x') {
        onCut?.();
        e.preventDefault();
      } else if (isCtrl && key === 'v') {
        onPaste?.();
        e.preventDefault();
      } else if (isCtrl && key === 'z' && !e.shiftKey) {
        handleUndo?.();
        e.preventDefault();
      } else if ((isCtrl && key === 'y') || (isCtrl && key === 'z' && e.shiftKey)) {
        handleRedo?.();
        e.preventDefault();
      } else if (e.key === 'Delete') {
        onDelete?.();
        e.preventDefault();
      } else if (e.key === 'F2' && selectedItem) {
        onRename?.(selectedItem);
        e.preventDefault();
      } else if (isCtrl && key === 'n') {
        onCreateFolder?.();
        e.preventDefault();
      } else if (isCtrl && key === 'a') {
        onSelectAll?.();
        e.preventDefault();
      } else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
        onBack?.();
        e.preventDefault();
      } else if (e.altKey && e.key === 'ArrowRight') {
        onForward?.();
        e.preventDefault();
      } else if (e.altKey && e.key === 'ArrowUp') {
        onUp?.();
        e.preventDefault();
      } else if (e.key === 'F5') {
        handleRefresh?.();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onClearSelection?.();
        setShowContextMenu?.(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems, onCopy, onCut, onPaste, onDelete, onRename, onCreateFolder, onSelectAll, onBack, onForward, onUp, onClearSelection, handleRefresh, handleUndo, handleRedo, setShowContextMenu]);
}

export default useKeyboardShortcuts;
