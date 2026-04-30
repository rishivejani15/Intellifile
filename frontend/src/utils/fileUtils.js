// File utility functions
export const getFileIcon = (item) => {
  if (item.type === 'drive') {
    return '💾';
  }
  if (item.type === 'folder') {
    return '📁';
  }
  const ext = item.ext.toLowerCase();
  const iconMap = {
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
  return iconMap[ext] || '📄';
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

export const formatDate = (ms) => {
  return new Date(ms).toLocaleDateString();
};
