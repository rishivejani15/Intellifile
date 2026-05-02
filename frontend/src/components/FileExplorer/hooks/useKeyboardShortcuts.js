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
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'c') {
        onCopy?.();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'x') {
        onCut?.();
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'v') {
        onPaste?.();
        e.preventDefault();
      } else if (e.key === 'Delete') {
        onDelete?.();
        e.preventDefault();
      } else if (e.key === 'F2' && selectedItem) {
        onRename?.(selectedItem);
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'n') {
        onCreateFolder?.();
        e.preventDefault();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
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
      } else if (e.key === 'Escape') {
        onClearSelection?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, selectedItems, clipboard, renamingItem, currentPath, historyIndex, displayItems]);
}

export default useKeyboardShortcuts;
