const STARRED_KEY = 'intellifile-starred';
const PINNED_KEY = 'intellifile-pinned';

const normalizePath = (p) => (p || '').toLowerCase().replace(/[\\/]+$/, '');

/**
 * Get all starred items from localStorage
 */
export const getStarredItems = () => {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error reading starred items:', err);
    return [];
  }
};

/**
 * Check if a path is starred
 */
export const isStarred = (itemOrPath) => {
  if (!itemOrPath) return false;
  const path = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath.path;
  if (!path) return false;
  const norm = normalizePath(path);
  const starred = getStarredItems();
  return starred.some(item => normalizePath(item.path) === norm);
};

/**
 * Toggle starred status of an item
 */
export const toggleStar = (item) => {
  if (!item || !item.path) return false;
  try {
    const starred = getStarredItems();
    const norm = normalizePath(item.path);
    const index = starred.findIndex(i => normalizePath(i.path) === norm);

    let updated;
    let isNowStarred = false;

    if (index >= 0) {
      updated = starred.filter((_, idx) => idx !== index);
      isNowStarred = false;
    } else {
      const folderPath = item.path.substring(0, item.path.lastIndexOf('\\')) || item.location || '';
      const newItem = {
        path: item.path,
        name: item.name || item.path.split(/[\\/]/).pop(),
        type: item.type || 'file',
        ext: item.ext || '',
        size: item.size || 0,
        modified: item.modified || Date.now(),
        location: folderPath,
        starredAt: Date.now(),
      };
      updated = [newItem, ...starred];
      isNowStarred = true;
    }

    localStorage.setItem(STARRED_KEY, JSON.stringify(updated));
    
    // Dispatch events for live UI updates
    window.dispatchEvent(new CustomEvent('starred-updated', { detail: updated }));
    window.dispatchEvent(new StorageEvent('storage', { key: STARRED_KEY, newValue: JSON.stringify(updated) }));

    return isNowStarred;
  } catch (err) {
    console.error('Error toggling star:', err);
    return false;
  }
};

/**
 * Get all pinned items from localStorage
 */
export const getPinnedItems = () => {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error reading pinned items:', err);
    return [];
  }
};

/**
 * Check if a path is pinned
 */
export const isPinned = (itemOrPath) => {
  if (!itemOrPath) return false;
  const path = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath.path;
  if (!path) return false;
  const norm = normalizePath(path);
  const pinned = getPinnedItems();
  return pinned.some(item => normalizePath(item.path) === norm);
};

/**
 * Toggle pinned status of an item
 */
export const togglePin = (item) => {
  if (!item || !item.path) return false;
  try {
    const pinned = getPinnedItems();
    const norm = normalizePath(item.path);
    const index = pinned.findIndex(i => normalizePath(i.path) === norm);

    let updated;
    let isNowPinned = false;

    if (index >= 0) {
      updated = pinned.filter((_, idx) => idx !== index);
      isNowPinned = false;
    } else {
      const folderPath = item.path.substring(0, item.path.lastIndexOf('\\')) || item.location || '';
      const newItem = {
        path: item.path,
        name: item.name || item.path.split(/[\\/]/).pop(),
        type: item.type || (item.ext ? 'file' : 'folder'),
        ext: item.ext || '',
        size: item.size || 0,
        modified: item.modified || Date.now(),
        location: folderPath,
        pinnedAt: Date.now(),
      };
      updated = [...pinned, newItem];
      isNowPinned = true;
    }

    localStorage.setItem(PINNED_KEY, JSON.stringify(updated));
    
    // Dispatch events for live UI updates
    window.dispatchEvent(new CustomEvent('pinned-updated', { detail: updated }));
    window.dispatchEvent(new StorageEvent('storage', { key: PINNED_KEY, newValue: JSON.stringify(updated) }));

    return isNowPinned;
  } catch (err) {
    console.error('Error toggling pin:', err);
    return false;
  }
};
