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

// Default icon for unknown file types
export const DEFAULT_FILE_ICON = '📄';

// Quick access folders
export const QUICK_ACCESS_FOLDERS = [
  { id: 'home', name: 'Home', icon: '🏠' },
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
