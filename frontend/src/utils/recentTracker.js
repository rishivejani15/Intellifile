const RECENT_FILES_KEY = 'intellifile-recent-files';

export const trackRecentFile = (filePath, extra = {}) => {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const norm = filePath.toLowerCase().replace(/[\\/]+$/, '');

    const name = extra.name || filePath.split(/[\\/]/).pop();
    const parentPath = extra.parentPath || filePath.substring(0, Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')));
    const ext = extra.ext || (name.includes('.') ? name.substring(name.lastIndexOf('.')).toLowerCase() : '');

    const newItem = {
      name,
      path: filePath,
      location: extra.location || parentPath || 'Local Storage',
      parentPath,
      type: extra.type || 'file',
      size: extra.size || 0,
      modified: extra.modified || Date.now(),
      accessed: Date.now(),
      ext,
      activity: extra.activity || 'Opened recently',
    };

    const filtered = existing.filter(item => (item.path || '').toLowerCase().replace(/[\\/]+$/, '') !== norm);
    const updated = [newItem, ...filtered].slice(0, 50);

    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('recent-files-updated', { detail: newItem }));
  } catch (err) {
    console.warn('Error tracking recent file:', err);
  }
};

export const getRecentFiles = () => {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const removeRecentFile = (filePath) => {
  if (!filePath) return;
  try {
    const norm = filePath.toLowerCase().replace(/[\\/]+$/, '');
    const current = getRecentFiles();
    const updated = current.filter(f => (f.path || '').toLowerCase().replace(/[\\/]+$/, '') !== norm);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('recent-files-updated', { detail: { removed: filePath } }));
  } catch (err) {
    console.warn('Error removing recent file:', err);
  }
};
