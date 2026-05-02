import { FILE_ICONS, DEFAULT_FILE_ICON } from './constants';

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
  const ext = item.ext?.toLowerCase() || '';
  return FILE_ICONS[ext] || DEFAULT_FILE_ICON;
};

/**
 * Format file size to human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Format date to locale string
 * @param {number} ms - Timestamp in milliseconds
 * @returns {string} Formatted date
 */
export const formatDate = (ms) => {
  return new Date(ms).toLocaleDateString();
};

/**
 * Get parent path from a full path
 * @param {string} filePath - Full file path
 * @returns {string} Parent directory path
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
 * @returns {Array} Sorted items
 */
export const sortItems = (items, sortBy) => {
  if (!items) return [];
  
  return [...items].sort((a, b) => {
    let compareValue = 0;
    switch (sortBy) {
      case 'date':
        compareValue = a.modified - b.modified;
        break;
      case 'size':
        compareValue = a.size - b.size;
        break;
      case 'type':
        compareValue = (a.ext || '').localeCompare(b.ext || '');
        break;
      default:
        compareValue = a.name.localeCompare(b.name);
    }
    return compareValue;
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
