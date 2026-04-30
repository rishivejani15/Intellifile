import React, { useEffect, useRef } from 'react';
import './FileExplorer/FileExplorer.css';

function ContextMenu({
  visible,
  position,
  selectedItem,
  clipboard,
  onOpen,
  onCut,
  onCopy,
  onPaste,
  onRename,
  onDelete,
  onProperties,
  onChatWithAI,
  onClose,
}) {
  const contextMenuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onClose]);

  if (!visible || !selectedItem) {
    return null;
  }

  return (
    <div
      ref={contextMenuRef}
      className="context-menu"
      style={{ top: position.y, left: position.x }}
    >
      <div className="context-menu-item" onClick={() => { onOpen(); onClose(); }}>
        Open
      </div>
      <div className="context-menu-divider"></div>
      <div
        className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
        onClick={selectedItem?.protected ? null : () => { onCut(); onClose(); }}
      >
        ✂️ Cut (Ctrl+X)
      </div>
      <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
        📋 Copy (Ctrl+C)
      </div>
      <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste(); onClose(); }}>
        📌 Paste (Ctrl+V)
      </div>
      <div className="context-menu-divider"></div>
      <div
        className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
        onClick={selectedItem?.protected ? null : () => { onRename(); onClose(); }}
      >
        ✏️ Rename (F2)
      </div>
      <div
        className={`context-menu-item delete ${selectedItem?.protected ? 'disabled' : ''}`}
        onClick={selectedItem?.protected ? null : () => { onDelete(); onClose(); }}
      >
        🗑️ Delete
      </div>
      <div className="context-menu-divider"></div>
      <div className="context-menu-item" onClick={() => { onProperties(); onClose(); }}>
        ℹ️ Properties
      </div>
      {selectedItem && selectedItem.type !== 'folder' && selectedItem.type !== 'drive' && (
        <div className="context-menu-item" onClick={() => { onChatWithAI(); onClose(); }}>
          🤖 Chat with AI
        </div>
      )}
    </div>
  );
}

export default ContextMenu;
