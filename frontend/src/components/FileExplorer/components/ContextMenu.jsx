import React, { useEffect, useRef } from 'react';

function ContextMenu({
  show,
  position,
  selectedItem,
  onClose,
  onOpen,
  onCut,
  onCopy,
  onPaste,
  onRename,
  onDelete,
  onVersioning,
  onChatWithAI,
  hasClipboard,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (show) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show, onClose]);

  if (!show || !selectedItem) return null;

  const isProtected = selectedItem?.protected;
  const isFolder = selectedItem?.type === 'folder' || selectedItem?.type === 'drive';

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: position.y, left: position.x }}
    >
      <div className="context-menu-item" onClick={() => { onOpen(); onClose(); }}>
        Open
      </div>
      <div className="context-menu-divider"></div>
      <div
        className={`context-menu-item ${isProtected ? 'disabled' : ''}`}
        onClick={() => { if (!isProtected) { onCut(); onClose(); } }}
      >
        ✂️ Cut (Ctrl+X)
      </div>
      <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
        📋 Copy (Ctrl+C)
      </div>
      <div className={`context-menu-item ${!hasClipboard ? 'disabled' : ''}`} onClick={() => { if (hasClipboard) { onPaste(); onClose(); } }}>
        📌 Paste (Ctrl+V)
      </div>
      <div className="context-menu-divider"></div>
      <div
        className={`context-menu-item ${isProtected ? 'disabled' : ''}`}
        onClick={() => { if (!isProtected) { onRename(); onClose(); } }}
      >
        ✏️ Rename (F2)
      </div>
      <div
        className={`context-menu-item delete ${isProtected ? 'disabled' : ''}`}
        onClick={() => { if (!isProtected) { onDelete(); onClose(); } }}
      >
        🗑️ Delete
      </div>
      <div className="context-menu-divider"></div>
      <div className="context-menu-item" onClick={() => { onVersioning?.(selectedItem); onClose(); }}>
        🕘 Versioning
      </div>
      {!isFolder && selectedItem && (
        <div className="context-menu-item" onClick={() => { onChatWithAI?.(selectedItem); onClose(); }}>
          🤖 Chat with AI
        </div>
      )}
    </div>
  );
}

export default ContextMenu;
