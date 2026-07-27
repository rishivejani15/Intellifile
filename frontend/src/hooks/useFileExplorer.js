// Hook for file operations: copy, cut, paste, delete, rename, create folder, create file, undo
import { useState, useCallback, useRef } from 'react';
import { showErrorToast } from '../utils/toast';

export const useFileExplorer = (ipcRenderer) => {
  const [clipboard, setClipboard] = useState(null);
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const pushUndo = useCallback((action) => {
    undoStack.current.push(action);
    if (undoStack.current.length > 30) undoStack.current.shift();
    // Any new action invalidates redo history.
    redoStack.current = [];
  }, []);
  
  const handleCopy = useCallback((selectedItems, selectedItem) => {
    const itemsToCopy = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    if (itemsToCopy.length > 0) {
      setClipboard({ items: itemsToCopy, operation: 'copy' });
      return true;
    }
    return false;
  }, []);

  const handleCut = useCallback((selectedItems, selectedItem) => {
    const itemsToCut = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    const protectedItems = itemsToCut.filter(item => item.protected);
    
    if (protectedItems.length > 0) {
      showErrorToast('Cannot move system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      return false;
    }

    if (itemsToCut.length > 0) {
      setClipboard({ items: itemsToCut, operation: 'cut' });
      return true;
    }
    return false;
  }, []);

  const handlePaste = useCallback(async (currentPath, onPasteComplete) => {
    if (clipboard && currentPath) {
      try {
        for (const item of clipboard.items) {
          const operation = clipboard.operation === 'cut' ? 'move' : 'copy';
          const destPath = currentPath + '\\' + item.name;

          if (operation === 'copy') {
        // If this was a move (cut) and all moves succeeded, clear the staged clipboard
        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
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
            }else {
              pushUndo({ type: 'move', from: item.path, to: destPath });}
          }
        }

        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
        onPasteComplete?.();
      } catch (err) {
        console.error('Paste error:', err);
      }
    }
  }, [clipboard, ipcRenderer, pushUndo]);

  const handleRename = useCallback(async (currentPath, onRenameComplete) => {
    if (renamingItem && renameValue && renameValue !== renamingItem.name) {
      if (renamingItem.protected) {
        showErrorToast('Cannot rename system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
        setRenamingItem(null);
        return false;
      }

      try {
        const newPath = currentPath + '\\' + renameValue;
        const result = await ipcRenderer?.invoke('rename-file', renamingItem.path, newPath);
        if (result.success) {
           pushUndo({ type: 'rename', from: newPath, to: renamingItem.path, oldName: renamingItem.name });
          onRenameComplete?.();
          return true;
        } else {
          console.error('Rename error:', result.error);
          showErrorToast('Rename failed.', result.error || 'The rename operation was rejected.', 'Close any app using the file and try again.');
        }
      } catch (err) {
        console.error('Rename error:', err);
      }
    }
    setRenamingItem(null);
    return false;
  },  [renamingItem, renameValue, ipcRenderer, pushUndo]);

  const handleDelete = useCallback(async (selectedItems, selectedItem, currentPath, onDeleteComplete, options = {}) => {
    const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    const protectedItems = itemsToDelete.filter(item => item.protected);
    const { skipConfirm = false } = options || {};

    if (protectedItems.length > 0) {
      showErrorToast('Cannot delete system files.', 'The selected item is protected by the operating system.', 'Choose a non-system file or folder.');
      return false;
    }

    if (itemsToDelete.length > 0) {
      if (!skipConfirm) {
        // Confirmation dialog
        const names = itemsToDelete.map(i => i.name).join(', ');
        const msg = itemsToDelete.length === 1
          ? `Are you sure you want to move "${names}" to the Recycle Bin?`
          : `Are you sure you want to move ${itemsToDelete.length} items to the Recycle Bin?\n\n${names}`;

        if (!window.confirm(msg)) return false;
      }
      try {
        const deletedActions = [];
        for (const item of itemsToDelete) {
          const result = await ipcRenderer?.invoke('delete-file', item.path);
          if (!result.success) {
            console.error('Delete error:', result.error);
            showErrorToast('Delete failed.', result.error || 'The delete operation was rejected.', 'Check whether the file is open or protected.');
          } else {
            deletedActions.push({ type: 'delete', path: item.path, itemType: item.type, name: item.name });
          }
        }
        deletedActions.forEach((action) => pushUndo(action));
        onDeleteComplete?.();
        return true;
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
    return false;
  }, [ipcRenderer, pushUndo]);

  const handleCreateFile = useCallback(async (currentPath, fileName, onCreateComplete) => {
    if (currentPath && fileName) {
      try {
        const newPath = currentPath + '\\' + fileName;
        const result = await ipcRenderer?.invoke('create-file', newPath);
        if (result.success) {
          pushUndo({ type: 'create', path: result.path || newPath, itemType: 'file' });
          onCreateComplete?.();
          return result;
        } else {
          showErrorToast('Create file failed.', result.error || 'The file could not be created.', 'Check write permissions in the target folder.');
        }
      } catch (err) {
        console.error('Create file error:', err);
      }
    }
    return false;
  }, [ipcRenderer, pushUndo]);

  const handleUndo = useCallback(async (onUndoComplete) => {
    if (undoStack.current.length === 0) return false;
    const action = undoStack.current.pop();

    try {
      if (action.type === 'rename') {
        await ipcRenderer?.invoke('rename-file', action.from, action.to);
      } else if (action.type === 'move') {
        await ipcRenderer?.invoke('move-file', action.to, action.from);
      } else if (action.type === 'create') {
        await ipcRenderer?.invoke('delete-file', action.path);
      } else if (action.type === 'delete') {
        await ipcRenderer?.invoke('restore-deleted-file', action.path);
      }
      redoStack.current.push(action);
      if (redoStack.current.length > 30) redoStack.current.shift();
      onUndoComplete?.();
      return true;
    } catch (err) {
      console.error('Undo error:', err);
      return false;
    }
  }, [ipcRenderer]);

  const handleRedo = useCallback(async (onRedoComplete) => {
    if (redoStack.current.length === 0) return false;
    const action = redoStack.current.pop();

    try {
      if (action.type === 'rename') {
        await ipcRenderer?.invoke('rename-file', action.to, action.from);
      } else if (action.type === 'move') {
        await ipcRenderer?.invoke('move-file', action.from, action.to);
      } else if (action.type === 'create') {
        if (action.itemType === 'folder') {
          await ipcRenderer?.invoke('create-folder', action.path);
        } else {
          await ipcRenderer?.invoke('create-file', action.path);
        }
      } else if (action.type === 'delete') {
        await ipcRenderer?.invoke('delete-file', action.path);
      }
      undoStack.current.push(action);
      if (undoStack.current.length > 30) undoStack.current.shift();
      onRedoComplete?.();
      return true;
    } catch (err) {
      console.error('Redo error:', err);
      return false;
    }
  }, [ipcRenderer]);

  const handleCreateFolder = useCallback(async (currentPath, onCreateComplete) => {
    if (currentPath) {
      try {
        const folderName = 'New Folder';
        const newPath = currentPath + '\\' + folderName;
        const result = await ipcRenderer?.invoke('create-folder', newPath);
        if (result.success) {
          pushUndo({ type: 'create', path: result.path || newPath, itemType: 'folder' });
          onCreateComplete?.();
          return result;
        }
      } catch (err) {
        console.error('Create folder error:', err);
      }
    }
    return false;
  }, [ipcRenderer, pushUndo]);

  const handleCompressZip = useCallback(async (selectedItem) => {
    if (!selectedItem?.path) return false;
    try {
      const result = await ipcRenderer?.invoke('compress-zip', selectedItem.path);
      if (!result?.success) {
        if (!result?.canceled) {
          showErrorToast('Compression failed.', result?.error || 'The archive could not be created.', 'Check disk space and write permissions.');
        }
        return false;
      }
      return true;
    } catch (err) {
      showErrorToast('Compression failed.', err?.message || 'Unknown error', 'Check disk space and write permissions.');
      return false;
    }
  }, [ipcRenderer]);

  const handleExtractZip = useCallback(async (selectedItem) => {
    if (!selectedItem?.path) return false;
    try {
      const result = await ipcRenderer?.invoke('extract-zip', selectedItem.path);
      if (!result?.success) {
        if (!result?.canceled) {
          showErrorToast('Extraction failed.', result?.error || 'The archive could not be extracted.', 'Try a different destination folder or verify the ZIP file.');
        }
        return false;
      }
      return true;
    } catch (err) {
      showErrorToast('Extraction failed.', err?.message || 'Unknown error', 'Try a different destination folder or verify the ZIP file.');
      return false;
    }
  }, [ipcRenderer]);

  const handleDragStart = useCallback((e, item, selectedItems) => {
    const itemsToDrag = selectedItems.length > 0 ? selectedItems : [item];
    const payload = JSON.stringify(itemsToDrag.map(i => i.path));
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  const handleDropOnItem = useCallback(async (e, targetItem, currentPath, onDropComplete) => {
    e.preventDefault();
    if (targetItem.type !== 'folder') return;

    try {
      const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      const paths = JSON.parse(data || '[]');
      const isCopy = e.ctrlKey;

      for (const sourcePath of paths) {
        const name = sourcePath.split('\\').pop();
        const destPath = targetItem.path + '\\' + name;
        if (isCopy) {
          await ipcRenderer?.invoke('copy-file', sourcePath, destPath);
        } else {
          const result = await ipcRenderer?.invoke('move-file', sourcePath, destPath);
          if (result?.success) {
            pushUndo({ type: 'move', from: sourcePath, to: destPath });
          }
        }
      }
      onDropComplete?.();
    } catch (err) {
      console.error('Drag/drop error:', err);
    }
  },  [ipcRenderer, pushUndo]);

  return {
    clipboard,
    setClipboard,
    renamingItem,
    setRenamingItem,
    renameValue,
    setRenameValue,
    handleCopy,
    handleCut,
    handlePaste,
    handleRename,
    handleDelete,
    handleCreateFolder,
    handleCreateFile,
    handleUndo,
    handleRedo,
    handleDragStart,
    handleDropOnItem,
    handleCompressZip,
    handleExtractZip,
  };
};
