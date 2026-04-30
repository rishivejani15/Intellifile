// Hook for file operations: copy, cut, paste, delete, rename, create folder
import { useState, useCallback } from 'react';

export const useFileExplorer = (ipcRenderer) => {
  const [clipboard, setClipboard] = useState(null);
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');

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
      alert('Cannot move system files or folders');
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
            const result = await ipcRenderer?.invoke('copy-file', item.path, destPath);
            if (!result.success) {
              console.error('Copy error:', result.error);
              alert('Error copying: ' + result.error);
            }
          } else {
            const result = await ipcRenderer?.invoke('move-file', item.path, destPath);
            if (!result.success) {
              console.error('Move error:', result.error);
              alert('Error moving: ' + result.error);
            }
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
  }, [clipboard, ipcRenderer]);

  const handleRename = useCallback(async (currentPath, onRenameComplete) => {
    if (renamingItem && renameValue && renameValue !== renamingItem.name) {
      if (renamingItem.protected) {
        alert('Cannot rename system files or folders');
        setRenamingItem(null);
        return false;
      }

      try {
        const newPath = currentPath + '\\' + renameValue;
        const result = await ipcRenderer?.invoke('rename-file', renamingItem.path, newPath);
        if (result.success) {
          onRenameComplete?.();
          return true;
        } else {
          console.error('Rename error:', result.error);
          alert('Error renaming: ' + result.error);
        }
      } catch (err) {
        console.error('Rename error:', err);
      }
    }
    setRenamingItem(null);
    return false;
  }, [renamingItem, renameValue, ipcRenderer]);

  const handleDelete = useCallback(async (selectedItems, selectedItem, currentPath, onDeleteComplete) => {
    const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
    const protectedItems = itemsToDelete.filter(item => item.protected);

    if (protectedItems.length > 0) {
      alert('Cannot delete system files or folders');
      return false;
    }

    if (itemsToDelete.length > 0) {
      try {
        for (const item of itemsToDelete) {
          const result = await ipcRenderer?.invoke('delete-file', item.path);
          if (!result.success) {
            console.error('Delete error:', result.error);
            alert('Error: ' + result.error);
          }
        }
        onDeleteComplete?.();
        return true;
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
    return false;
  }, [ipcRenderer]);

  const handleCreateFolder = useCallback(async (currentPath, onCreateComplete) => {
    if (currentPath) {
      try {
        const folderName = 'New Folder';
        const newPath = currentPath + '\\' + folderName;
        const result = await ipcRenderer?.invoke('create-folder', newPath);
        if (result.success) {
          onCreateComplete?.();
          return true;
        }
      } catch (err) {
        console.error('Create folder error:', err);
      }
    }
    return false;
  }, [ipcRenderer]);

  const handleDragStart = useCallback((e, item, selectedItems) => {
    const itemsToDrag = selectedItems.length > 0 ? selectedItems : [item];
    e.dataTransfer.setData('application/json', JSON.stringify(itemsToDrag.map(i => i.path)));
    e.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  const handleDropOnItem = useCallback(async (e, targetItem, currentPath, onDropComplete) => {
    e.preventDefault();
    if (targetItem.type !== 'folder') return;

    try {
      const data = e.dataTransfer.getData('application/json');
      const paths = JSON.parse(data || '[]');
      const isCopy = e.ctrlKey;

      for (const sourcePath of paths) {
        const name = sourcePath.split('\\').pop();
        const destPath = targetItem.path + '\\' + name;
        if (isCopy) {
          await ipcRenderer?.invoke('copy-file', sourcePath, destPath);
        } else {
          await ipcRenderer?.invoke('move-file', sourcePath, destPath);
        }
      }
      onDropComplete?.();
    } catch (err) {
      console.error('Drag/drop error:', err);
    }
  }, [ipcRenderer]);

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
    handleDragStart,
    handleDropOnItem,
  };
};
