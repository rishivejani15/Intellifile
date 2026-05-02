import React, { useEffect, useRef, useState } from 'react';
import './FileExplorer/FileExplorer.css';

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
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onVersioning,
  onClose,
}) {
  const contextMenuRef = useRef(null);
  const [showNewSubmenu, setShowNewSubmenu] = useState(false);

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

  useEffect(() => {
    if (!visible) setShowNewSubmenu(false);
  }, [visible]);

  if (!visible) return null;

  // Empty space context menu
  if (isEmptySpace) {
    return (
      <div
        ref={contextMenuRef}
        className="context-menu"
        style={{ top: position.y, left: position.x }}
      >
        <div
          className="context-menu-item has-submenu"
          onMouseEnter={() => setShowNewSubmenu(true)}
          onMouseLeave={() => setShowNewSubmenu(false)}
        >
          ✨ New ▸
          {showNewSubmenu && (
            <div className="context-submenu">
              <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>
                📁 Folder
              </div>
              <div className="context-menu-divider"></div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>
                📄 Text Document
              </div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>
                📝 Markdown File
              </div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>
                {'{ }'} JSON File
              </div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>
                🐍 Python File
              </div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>
                ⚡ JavaScript File
              </div>
              <div className="context-menu-item" onClick={() => { onCreateFile?.('New Page.html'); onClose(); }}>
                🌐 HTML File
              </div>
            </div>
          )}
        </div>
        <div className="context-menu-divider"></div>
        <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste?.(); onClose(); }}>
          📌 Paste (Ctrl+V)
        </div>
        <div className="context-menu-divider"></div>
        <div className="context-menu-item" onClick={() => { onRefresh?.(); onClose(); }}>
          🔄 Refresh (F5)
        </div>
        <div className="context-menu-divider"></div>
        <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>
          💻 Open Terminal Here
        </div>
        <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>
          📘 Open in VS Code
        </div>
        <div className="context-menu-divider"></div>
        <div className="context-menu-item" onClick={() => { onProperties?.(); onClose(); }}>
          ℹ️ Properties
        </div>
      </div>
    );
  }
if (!selectedItem) return null;

  // File/folder context menu
  return (
    <div
      ref={contextMenuRef}
      className="context-menu"
      style={{ top: position.y, left: position.x }}
    >
      <div className="context-menu-item" onClick={() => { onOpen(); onClose(); }}>
        Open
      </div>
      {selectedItem.type !== 'folder' && selectedItem.type !== 'drive' && (
        <div className="context-menu-item" onClick={() => { onOpenWith?.(); onClose(); }}>
          📂 Open With...
        </div>
      )}
      <div className="context-menu-divider"></div>

      {/* New submenu */}
      <div
        className="context-menu-item has-submenu"
        onMouseEnter={() => setShowNewSubmenu(true)}
        onMouseLeave={() => setShowNewSubmenu(false)}
      >
        ✨ New ▸
        {showNewSubmenu && (
          <div className="context-submenu">
            <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>
              📁 Folder
            </div>
            <div className="context-menu-divider"></div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>
              📄 Text Document
            </div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>
              📝 Markdown File
            </div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>
              {'{ }'} JSON File
            </div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>
              🐍 Python File
            </div>
            <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>
              ⚡ JavaScript File
            </div>
          </div>
        )}
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
      <div className="context-menu-item" onClick={() => { onCopyPath?.(); onClose(); }}>
        📎 Copy Path
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

      {selectedItem.type === 'folder' && (
        <>
          <div className="context-menu-item" onClick={() => { onPinToFavorites?.(); onClose(); }}>
            📌 Pin to Quick Access
          </div>
          <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>
            💻 Open Terminal Here
          </div>
          <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>
            📘 Open in VS Code
          </div>
          <div className="context-menu-divider"></div>
        </>
      )}

      {selectedItem.type === 'file' && (
        <>
          <div className="context-menu-item" onClick={() => { onVersioning?.(); onClose(); }}>
            🕒 Version History
          </div>
          <div className="context-menu-divider"></div>
        </>
      )}

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
