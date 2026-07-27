import { useCallback } from 'react';
import { getParentPath } from '../utils/fileUtils';

/**
 * Hook for navigation (back, forward, up, navigate to path)
 */
export function useNavigation(history, historyIndex, loadDirectory) {
  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      loadDirectory(history[historyIndex - 1]);
    }
  }, [historyIndex, history, loadDirectory]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      loadDirectory(history[historyIndex + 1]);
    }
  }, [historyIndex, history, loadDirectory]);

  const handleUp = useCallback((currentPath) => {
    if (currentPath && currentPath !== 'C:\\') {
      const parentPath = getParentPath(currentPath);
      if (parentPath) {
        loadDirectory(parentPath);
      }
    }
  }, [loadDirectory]);

  const handleBreadcrumbClick = useCallback((path) => {
    loadDirectory(path.replace(/\/$/, ''));
  }, [loadDirectory]);

  const handleAddressSubmit = useCallback((e, addressPath) => {
    e.preventDefault();
    if (addressPath) {
      loadDirectory(addressPath);
    }
  }, [loadDirectory]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const canGoUp = (currentPath) => currentPath && currentPath !== 'C:\\';

  return {
    handleBack,
    handleForward,
    handleUp,
    handleBreadcrumbClick,
    handleAddressSubmit,
    canGoBack,
    canGoForward,
    canGoUp,
  };
}

export default useNavigation;
