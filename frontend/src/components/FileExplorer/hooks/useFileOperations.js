import { useState, useCallback } from 'react';
import { showErrorToast } from '../../../utils/toast';

const ipcRenderer = window.electron?.ipcRenderer;

/**
 * Hook for file operations (copy, cut, paste, delete, rename, create folder)
 */
export function useFileOperations(currentPath, onRefresh) {
  const [clipboard, setClipboard] = useState(null); // {items, operation: 'copy'|'cut'}

  const handleCopy = useCallback((itemsToCopy) => {
    if (itemsToCopy.length > 0) {
      setClipboard({ items: itemsToCopy, operation: 'copy' });
    }
  }, []);

  const handleCut = useCallback((itemsToCut) => {
    // Check if any items are protected
    const protectedItems = itemsToCut.filter(item => item.protected);
    if (protectedItems.length > 0) {
      showErrorToast('Cannot move system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      return false;
    }
    if (itemsToCut.length > 0) {
      setClipboard({ items: itemsToCut, operation: 'cut' });
    }
    return true;
  }, []);

  const handlePaste = useCallback(async () => {
    if (clipboard && currentPath) {
      try {
        for (const item of clipboard.items) {
          const operation = clipboard.operation === 'cut' ? 'move' : 'copy';
          const destPath = currentPath + '\\' + item.name;

          if (operation === 'copy') {
            const result = await ipcRenderer?.invoke('copy-file', item.path, destPath);
            if (!result.success) {
              console.error('Copy error:', result.error);
              showErrorToast('Copy failed.', result.error || 'The copy operation was rejected.', 'Check file permissions or whether the destination already exists.');
            }
          } else {
            const result = await ipcRenderer?.invoke('move-file', item.path, destPath);
            if (!result.success) {
              console.error('Move error:', result.error);
              showErrorToast('Move failed.', result.error || 'The move operation was rejected.', 'Check file permissions or whether the destination already exists.');
            }
          }
        }

        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
        onRefresh?.();
      } catch (err) {
        console.error('Paste error:', err);
      }
    }
  }, [clipboard, currentPath, onRefresh]);

  const handleRename = useCallback(async (renamingItem, renameValue) => {
    if (renamingItem && renameValue && renameValue !== renamingItem.name) {
      // Check if item is protected
      if (renamingItem.protected) {
        showErrorToast('Cannot rename system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
        return false;
      }

      try {
        const newPath = currentPath + '\\' + renameValue;
        const result = await ipcRenderer?.invoke('rename-file', renamingItem.path, newPath);
        if (result.success) {
          onRefresh?.();
          return true;
        } else {
          console.error('Rename error:', result.error);
          showErrorToast('Rename failed.', result.error || 'The rename operation was rejected.', 'Close any app using the file and try again.');
        }
      } catch (err) {
        console.error('Rename error:', err);
      }
    }
    return false;
  }, [currentPath, onRefresh]);

  const handleDelete = useCallback(async (itemsToDelete) => {
    // Check if any items are protected
    const protectedItems = itemsToDelete.filter(item => item.protected);
    if (protectedItems.length > 0) {
      showErrorToast('Cannot delete system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      return false;
    }

    if (itemsToDelete.length > 0) {
      try {
        for (const item of itemsToDelete) {
          const result = await ipcRenderer?.invoke('delete-file', item.path);
          if (!result.success) {
            console.error('Delete error:', result.error);
            showErrorToast('Delete failed.', result.error || 'The delete operation was rejected.', 'Check whether the file is open or protected.');
          }
        }
        onRefresh?.();
        return true;
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
    return false;
  }, [onRefresh]);

  const handleCreateFolder = useCallback(async () => {
    if (currentPath) {
      try {
        const folderName = 'New Folder';
        const newPath = currentPath + '\\' + folderName;
        const result = await ipcRenderer?.invoke('create-folder', newPath);
        if (result.success) {
          onRefresh?.();
          return true;
        }
      } catch (err) {
        console.error('Create folder error:', err);
      }
    }
    return false;
  }, [currentPath, onRefresh]);

  return {
    clipboard,
    setClipboard,
    handleCopy,
    handleCut,
    handlePaste,
    handleRename,
    handleDelete,
    handleCreateFolder,
  };
}

export default useFileOperations;
