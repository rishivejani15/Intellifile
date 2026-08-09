import { useState, useCallback, useRef, useEffect } from 'react';
import { showErrorToast } from '../../../utils/toast';

const ipcRenderer = window.electron?.ipcRenderer;

/**
 * Hook for file operations (copy, cut, paste, delete, rename, create folder)
 */
export function useFileOperations(currentPath, onRefresh, onRenameLockedFile, onDeleteLockedFile) {
  const [clipboard, setClipboard] = useState(null); // {items, operation: 'copy'|'cut'}
  const clipboardTimerRef = useRef(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback((itemsToCopy) => {
    if (itemsToCopy.length > 0) {
      setClipboard({ items: itemsToCopy, operation: 'copy' });
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
      clipboardTimerRef.current = setTimeout(() => {
        setClipboard(null);
      }, 60000); // 60 seconds
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
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
      clipboardTimerRef.current = setTimeout(() => {
        setClipboard(null);
      }, 60000); // 60 seconds
    }
    return true;
  }, []);

  const handlePaste = useCallback(async () => {
    if (clipboard && currentPath) {
      try {
        for (const item of clipboard.items) {
          const fileName = item.path.split('\\').pop();
          const targetPath = currentPath + '\\' + fileName;

          if (clipboard.operation === 'copy') {
            await ipcRenderer?.invoke('copy-file', item.path, targetPath);
          } else if (clipboard.operation === 'cut') {
            await ipcRenderer?.invoke('move-file', item.path, targetPath);
          }
        }
        onRefresh?.();
        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
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
        } else if (result.error === 'LOCKED_FILE_REQUIRES_PASSWORD' || result.isLocked) {
          onRenameLockedFile?.(renamingItem, result.fileId, renameValue);
          return false;
        } else {
          console.error('Rename error:', result.error);
          showErrorToast('Rename failed.', result.error || 'The rename operation was rejected.', 'Close any app using the file and try again.');
        }
      } catch (err) {
        console.error('Rename error:', err);
      }
    }
    return false;
  }, [currentPath, onRefresh, onRenameLockedFile]);

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
            if (result.error === 'LOCKED_FILE_REQUIRES_PASSWORD' || result.isLocked) {
              onDeleteLockedFile?.(item, result.fileId);
              return false;
            }
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
  }, [onRefresh, onDeleteLockedFile]);

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
