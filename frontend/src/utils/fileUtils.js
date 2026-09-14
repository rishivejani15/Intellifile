import React from 'react';

export const PowerPointIcon = ({ style = {} }) => (
  <span
    className="file-icon-pptx"
    title="PowerPoint Presentation"
    style={{
      position: 'relative',
      display: 'inline-block',
      lineHeight: 1.25,
      marginTop: '5px',
      ...style
    }}
  >
    📙
    <span
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#ffffff',
        fontWeight: '900',
        fontSize: '0.48em',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
        pointerEvents: 'none',
        userSelect: 'none',
        lineHeight: 1
      }}
    >
      P
    </span>
  </span>
);

// File utility functions
export const getFileIcon = (item = {}) => {
  const type = (item.type || '').toLowerCase();
  if (type === 'drive') {
    return '💾';
  }
  if (type === 'folder' || type === 'directory') {
    return '📁';
  }
  const extSource = item.ext || item.name || item.path || '';
  const ext = String(extSource).toLowerCase();
  const normalized = ext.includes('.') ? ext.slice(ext.lastIndexOf('.')) : ext;
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
    '.ppt': <PowerPointIcon />,
    '.pptx': <PowerPointIcon />,
    '.pptm': <PowerPointIcon />,
    '.pps': <PowerPointIcon />,
    '.ppsx': <PowerPointIcon />,
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
  return iconMap[normalized] || '📄';
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
