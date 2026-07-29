import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './FileExplorer/FileExplorer.css';
import './FileExplorer/FileExplorer_NEW.css';

function ContextMenu({
  visible,
  position,
  selectedItem,
  clipboard,
  isEmptySpace,
  currentPath,
  onOpen,
  onOpenWith,
  onCut,
  onCopy,
  onPaste,
  onRename,
  onDelete,
  onProperties,
  onChatWithAI,
  onCopyPath,
  onOpenTerminal,
  onOpenInVSCode,
  onPinToFavorites,
  isPinnedToFavorites,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onVersioning,
  onCompress,
  onExtract,
  onClose,
  canVersionItem = true,
}) {
  const contextMenuRef = useRef(null);
  const [showNewSubmenu, setShowNewSubmenu] = useState(false);
  const submenuTimeoutRef = useRef(null);
  const [submenuStyle, setSubmenuStyle] = useState({});
  const [menuPosition, setMenuPosition] = useState(position);

  useEffect(() => {
    setMenuPosition(position);
  }, [position]);

  // Position adjustment to keep menu inside viewport
  useEffect(() => {
    if (!visible || !contextMenuRef.current) return;
    const MARGIN = 8;
    const rect = contextMenuRef.current.getBoundingClientRect();
    let nextX = position.x;
    let nextY = position.y;

    if (nextX + rect.width > window.innerWidth - MARGIN) {
      nextX = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
    } else if (nextX < MARGIN) {
      nextX = MARGIN;
    }

    const spaceBelow = window.innerHeight - MARGIN - position.y;
    if (rect.height > spaceBelow) {
      const aboveY = position.y - rect.height - MARGIN;
      nextY = Math.max(MARGIN, aboveY);
    } else {
      nextY = Math.max(MARGIN, Math.min(position.y, window.innerHeight - rect.height - MARGIN));
    }

    setMenuPosition({ x: nextX, y: nextY });
  }, [visible, position]);

  // Click‑outside handling, respecting an open submenu
  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e) => {
      if (showNewSubmenu) {
        const submenu = document.querySelector('.context-submenu-new');
        if (submenu && submenu.contains(e.target)) return;
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onClose, showNewSubmenu]);

  // Reset submenu when the menu hides
  useEffect(() => {
    if (!visible) setShowNewSubmenu(false);
  }, [visible]);

  // Hover handlers for the "New" parent item – compute submenu placement
  const handleParentMouseEnter = (e) => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
    setShowNewSubmenu(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const menuRect = contextMenuRef.current?.getBoundingClientRect();
    const MARGIN = 8;
    const { innerWidth, innerHeight } = window;
    let left = rect.right + 8 + scrollX;
    const submenuWidth = menuRect ? menuRect.width : 200;
    if (left + submenuWidth > innerWidth - MARGIN) {
      left = Math.max(MARGIN, rect.left - submenuWidth - 8 + scrollX);
    }
    let top = rect.top + scrollY;
    const submenuHeight = rect.height * 6; // approximate height for 6 items
    if (top + submenuHeight > innerHeight - MARGIN) {
      top = Math.max(MARGIN, innerHeight - submenuHeight - MARGIN);
    }
    if (top < MARGIN) top = MARGIN;
    setSubmenuStyle({
      left: `${left}px`,
      top: `${top}px`,
      width: menuRect ? `${menuRect.width}px` : 'auto',
    });
  };

  const handleParentMouseLeave = () => {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    submenuTimeoutRef.current = setTimeout(() => {
      setShowNewSubmenu(false);
      setSubmenuStyle({});
      submenuTimeoutRef.current = null;
    }, 200);
  };

  const handleSubmenuMouseEnter = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
    setShowNewSubmenu(true);
  };

  if (!visible) return null;

  // Empty‑space menu
  if (isEmptySpace) {
    return (
      <>
        <div ref={contextMenuRef} className="context-menu" style={{ top: menuPosition.y, left: menuPosition.x }}>
          <div className="context-menu-item has-submenu-new" onMouseEnter={handleParentMouseEnter} onMouseLeave={handleParentMouseLeave}>✨ New ▸</div>
          <div className="context-menu-divider"></div>
          <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste?.(); onClose(); }}>📌 Paste (Ctrl+V)</div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => { onRefresh?.(); onClose(); }}>🔄 Refresh (F5)</div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>💻 Open Terminal Here</div>
          <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>📘 Open in VS Code</div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => { onProperties?.(); onClose(); }}>ℹ️ Properties</div>
        </div>
        {showNewSubmenu && createPortal(
          <div className="context-submenu-new visible" style={submenuStyle} onMouseEnter={handleSubmenuMouseEnter} onMouseLeave={handleParentMouseLeave}>
            <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>📁 Folder</div>
            <div className="context-menu-divider"></div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>📄 Text Document</div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>📝 Markdown File</div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>{'{ }'} JSON File</div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>🐍 Python File</div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>⚡ JavaScript File</div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Page.html'); onClose(); }}>🌐 HTML File</div>
          </div>
          , document.body
        )}
      </>
    );
  }

  if (!selectedItem) return null;
  const isZipFile = selectedItem?.type === 'file' && selectedItem?.ext?.toLowerCase() === '.zip';

  // File / folder menu
  return (
    <>
      <div ref={contextMenuRef} className="context-menu" style={{ top: menuPosition.y, left: menuPosition.x }}>
        <div className="context-menu-item" onClick={() => { onOpen(); onClose(); }}>Open</div>
        {selectedItem?.type === 'file' && (
          <div className="context-menu-item" onClick={() => { onOpenWith?.(); onClose(); }}>📂 Open with…</div>
        )}
        <div className="context-menu-divider"></div>
        <div className="context-menu-item has-submenu-new" onMouseEnter={handleParentMouseEnter} onMouseLeave={handleParentMouseLeave}>✨ New ▸</div>
        <div className="context-menu-divider"></div>
        <div className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`} onClick={selectedItem?.protected ? null : () => { onCut(); onClose(); }}>✂️ Cut (Ctrl+X)</div>
        <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>📋 Copy (Ctrl+C)</div>
        <div className="context-menu-item" onClick={() => { onCopyPath?.(); onClose(); }}>📎 Copy Path</div>
        <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste(); onClose(); }}>📌 Paste (Ctrl+V)</div>
        <div className="context-menu-divider"></div>
        {selectedItem?.type !== 'drive' && (
          <div className="context-menu-item" onClick={() => { onCompress?.(); onClose(); }}>🗜️ Compress to ZIP</div>
        )}
        {isZipFile && (
          <div className="context-menu-item" onClick={() => { onExtract?.(); onClose(); }}>📂 Extract...</div>
        )}
        {(selectedItem?.type !== 'drive' || isZipFile) && <div className="context-menu-divider"></div>}
        <div className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`} onClick={selectedItem?.protected ? null : () => { onRename(); onClose(); }}>✏️ Rename (F2)</div>
        <div className={`context-menu-item delete ${selectedItem?.protected ? 'disabled' : ''}`} onClick={selectedItem?.protected ? null : () => { onDelete(); onClose(); }}>🗑️ Delete</div>
        <div className="context-menu-divider"></div>
        {selectedItem.type === 'folder' && (
          <>
            {canVersionItem ? (
              <div className="context-menu-item" onClick={() => { onVersioning?.(selectedItem); onClose(); }}>🕘 Versioning</div>
            ) : (
              <div className="context-menu-item disabled" onClick={() => { onClose(); }}>🕘 Versioning not available</div>
            )}
            <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>💻 Open Terminal Here</div>
            <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>📘 Open in VS Code</div>
            <div className="context-menu-divider"></div>
          </>
        )}
        {selectedItem.type === 'file' && (
          <>
            <div className="context-menu-item" onClick={() => { onVersioning?.(); onClose(); }}>🕒 Version History</div>
            <div className="context-menu-divider"></div>
          </>
        )}
        <div className="context-menu-item" onClick={() => { onProperties(); onClose(); }}>ℹ️ Properties</div>
        {onChatWithAI && selectedItem && selectedItem.type !== 'folder' && selectedItem.type !== 'drive' && (
          <div className="context-menu-item" onClick={() => { onChatWithAI(); onClose(); }}>🤖 Chat with AI</div>
        )}
      </div>
      {showNewSubmenu && createPortal(
        <div className="context-submenu-new visible" style={submenuStyle} onMouseEnter={handleSubmenuMouseEnter} onMouseLeave={handleParentMouseLeave}>
          <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>📁 Folder</div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>📄 Text Document</div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>📝 Markdown File</div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>{'{ }'} JSON File</div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>🐍 Python File</div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>⚡ JavaScript File</div>
          <div className="context-menu-item" onClick={() => { onCreateFile?.('New Page.html'); onClose(); }}>🌐 HTML File</div>
        </div>,
        document.body
      )}
    </>
  );
}

export default ContextMenu;
