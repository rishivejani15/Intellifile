import { FILE_ICONS, DEFAULT_FILE_ICON } from './constants';
import { isPinned } from '../../../utils/starPinUtils';

/**
 * Get the icon for a file based on its type
 * @param {Object} item - File/folder item
 * @returns {string} Emoji icon
 */
export const getFileIcon = (item) => {
  if (item.type === 'drive') {
    return '💾';
  }
  if (item.type === 'folder') {
    return '📁';
  }
  const extSource = item.ext || item.name || item.path || '';
  const extStr = String(extSource).toLowerCase();
  const ext = extStr.includes('.') ? extStr.slice(extStr.lastIndexOf('.')) : extStr;
  return FILE_ICONS[ext] || DEFAULT_FILE_ICON;
};

/**
 * Format file size into human readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format timestamp into readable date string
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted date
 */
export const formatDate = (timestamp) => {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Get parent path of a file/folder
 * @param {string} filePath - Path to file or folder
 * @returns {string|null} Parent path or null
 */
export const getParentPath = (filePath) => {
  if (!filePath) return null;
  const lastIndex = filePath.lastIndexOf('\\');
  if (lastIndex <= 0) return null;
  return filePath.substring(0, lastIndex);
};

/**
 * Sort items based on criteria
 * @param {Array} items - Items to sort
 * @param {string} sortBy - Sort criteria (name, date, size, type)
 * @param {string} sortDirection - Sort direction (asc, desc)
 * @returns {Array} Sorted items
 */
export const sortItems = (items, sortBy, sortDirection = 'asc') => {
  if (!items) return [];

  // This PC always lists drive roots in ascending device order, independent of
  // the generic file sort preference or a custom volume label.
  const isDriveList = items.length > 0 && items.every(item =>
    item.type === 'drive' || item.type === 'portable' || item.isPortable
  );
  if (isDriveList) {
    return [...items].sort((a, b) => String(a.device || a.path || a.name || '').localeCompare(
      String(b.device || b.path || b.name || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    ));
  }

  return [...items].sort((a, b) => {
    // 1. Pinned items float to the very top
    const aPinned = isPinned(a);
    const bPinned = isPinned(b);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // 2. Folders before files
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;

    let compareValue = 0;
    switch (sortBy) {
      case 'date':
        // Prefer created date, fallback to modified date
        const aDate = (a.created || a.modified) || 0;
        const bDate = (b.created || b.modified) || 0;
        compareValue = aDate - bDate;
        break;
      case 'size':
        compareValue = a.size - b.size;
        break;
      case 'type':
        compareValue = (a.ext || '').localeCompare(b.ext || '');
        break;
      default:
        compareValue = (a.name || '').localeCompare(b.name || '');
    }

    return sortDirection === 'desc' ? -compareValue : compareValue;
  });
};

/**
 * Group items by specified criteria
 * @param {Array} items - Items to group
 * @param {string} groupBy - Group criteria (none, type, date)
 * @returns {Array} Array of groups with key and items
 */
export const groupItems = (items, groupBy) => {
  if (!items) return [];

  if (groupBy === 'none') {
    return [{ key: 'All items', items }];
  }

  const groups = new Map();

  items.forEach(item => {
    let key = 'Other';
    if (groupBy === 'type') {
      key = item.type === 'folder' ? 'Folders' : (item.ext || 'Other');
    } else if (groupBy === 'date') {
      key = formatDate(item.modified);
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => {
      // Folders first in type grouping
      if (groupBy === 'type') {
        if (a.key === 'Folders' && b.key !== 'Folders') return -1;
        if (a.key !== 'Folders' && b.key === 'Folders') return 1;
      }
      return a.key.localeCompare(b.key);
    });
};

/**
 * Update breadcrumb from path
 * @param {string} dirPath - Current directory path
 * @returns {Array} Breadcrumb items
 */
export const updateBreadcrumb = (dirPath) => {
  if (!dirPath) return [];

  const parts = dirPath.split('\\').filter(p => p);
  return parts.map((part, idx) => ({
    name: part,
    path: parts.slice(0, idx + 1).join('\\') + '\\'
  }));
};

/**
 * Get file name from path
 * @param {string} filePath - Full file path
 * @returns {string} File name
 */
export const getFileName = (filePath) => {
  if (!filePath) return '';
  return filePath.split('\\').pop() || filePath.split('/').pop() || '';
};
