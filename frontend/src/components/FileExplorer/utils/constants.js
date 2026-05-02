// File icon mapping based on extension
export const FILE_ICONS = {
  '.py': '🐍',
  '.js': '⚡',
  '.ts': '📘',
  '.jsx': '⚛️',
  '.tsx': '⚛️',
  '.json': '{ }',
  '.txt': '📄',
  '.md': '📝',
  '.html': '🌐',
  '.css': '🎨',
  '.cpp': '⚙️',
  '.c': '⚙️',
  '.java': '☕',
  '.go': '🐹',
  '.xml': '< >',
  '.pdf': '📕',
  '.doc': '📘',
  '.docx': '📘',
  '.xls': '📊',
  '.xlsx': '📊',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.jpeg': '🖼️',
  '.gif': '🎞️',
  '.mp3': '🎵',
  '.mp4': '🎬',
  '.zip': '📦',
  '.rar': '📦',
  '.7z': '📦',
};

// Default icon for unknown file types
export const DEFAULT_FILE_ICON = '📄';

// Quick access folders
export const QUICK_ACCESS_FOLDERS = [
  { id: 'this-pc', name: 'This PC', icon: '💻' },
  { id: 'desktop', name: 'Desktop', icon: '🖥️' },
  { id: 'documents', name: 'Documents', icon: '📄' },
  { id: 'downloads', name: 'Downloads', icon: '⬇️' },
  { id: 'pictures', name: 'Pictures', icon: '🖼️' },
  { id: 'music', name: 'Music', icon: '🎵' },
  { id: 'videos', name: 'Videos', icon: '🎬' },
];

// Sort options
export const SORT_OPTIONS = [
  { value: 'name', label: 'Sort by Name' },
  { value: 'date', label: 'Sort by Date' },
  { value: 'size', label: 'Sort by Size' },
  { value: 'type', label: 'Sort by Type' },
];

// Group options
export const GROUP_OPTIONS = [
  { value: 'none', label: 'Group: None' },
  { value: 'type', label: 'Group: Type' },
  { value: 'date', label: 'Group: Date' },
];

// View modes
export const VIEW_MODES = {
  ICONS: 'icons',
  LIST: 'list',
  DETAILS: 'details',
};
