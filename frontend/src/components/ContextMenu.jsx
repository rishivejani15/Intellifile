// import React, { useEffect, useRef, useState } from 'react';
// import './FileExplorer/FileExplorer.css';
// import './FileExplorer/FileExplorer_NEW.css';

// function ContextMenu({
//   // DEBUG: This is the MAIN ContextMenu with submenu functionality
//   visible,
//   position,
//   selectedItem,
//   clipboard,
//   isEmptySpace,
//   currentPath,
//   onOpen,
//   onCut,
//   onCopy,
//   onPaste,
//   onRename,
//   onDelete,
//   onProperties,
//   onChatWithAI,
//   onCopyPath,
//   onOpenTerminal,
//   onOpenInVSCode,
//   onPinToFavorites,
//   isPinnedToFavorites,
//   onCreateFile,
//   onCreateFolder,
//   onRefresh,
//   onVersioning,
//   onCompress,
//   onExtract,
//   onClose,
//   canVersionItem = true,
// }) {
//   const contextMenuRef = useRef(null);
//   const [showNewSubmenu, setShowNewSubmenu] = useState(false);
//   const submenuTimeoutRef = useRef(null);
//   const [menuPosition, setMenuPosition] = useState(position);

//   useEffect(() => {
//     setMenuPosition(position);
//   }, [position]);

//   useEffect(() => {
//     if (!visible || !contextMenuRef.current) return;

//     const MARGIN = 8;
//     const menuEl = contextMenuRef.current;
//     const { innerWidth, innerHeight } = window;
//     const rect = menuEl.getBoundingClientRect();

//     let nextX = position.x;
//     let nextY = position.y;

//     if (nextX + rect.width > innerWidth - MARGIN) {
//       nextX = Math.max(MARGIN, innerWidth - rect.width - MARGIN);
//     }

//     if (nextY + rect.height > innerHeight - MARGIN) {
//       nextY = Math.max(MARGIN, innerHeight - rect.height - MARGIN);
//     }

//     if (nextX !== menuPosition.x || nextY !== menuPosition.y) {
//       setMenuPosition({ x: nextX, y: nextY });
//     }
//   }, [visible, position, menuPosition.x, menuPosition.y]);

//   const handleSubmenuMouseEnter = () => {
//     if (submenuTimeoutRef.current) {
//       clearTimeout(submenuTimeoutRef.current);
//       submenuTimeoutRef.current = null;
//     }
//   };

//   const handleSubmenuMouseLeave = () => {
//     submenuTimeoutRef.current = setTimeout(() => {
//       setShowNewSubmenu(false);
//     }, 200);
//   };

//   const handleParentMouseEnter = () => {
//     console.log('DEBUG: Parent mouse enter - setting showNewSubmenu to true');
//     if (submenuTimeoutRef.current) {
//       clearTimeout(submenuTimeoutRef.current);
//       submenuTimeoutRef.current = null;
//     }
//     setShowNewSubmenu(true);
//     console.log('DEBUG: After setState - showNewSubmenu should be true');
//   };

//   const handleParentMouseLeave = () => {
//     // ELECTRON FIX: Don't hide immediately
//     console.log('DEBUG: Parent mouse leave - NOT hiding immediately');
//     // submenuTimeoutRef.current = setTimeout(() => {
//     //   setShowNewSubmenu(false);
//     // }, 200);
//   };

//   useEffect(() => {
//     return () => {
//       if (submenuTimeoutRef.current) {
//         clearTimeout(submenuTimeoutRef.current);
//       }
//     };
//   }, []);

//   useEffect(() => {
//     if (!visible) return;

//     const handleClickOutside = (e) => {
//       if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
//         onClose();
//       }
//     };
//     document.addEventListener('mousedown', handleClickOutside);
//     return () => document.removeEventListener('mousedown', handleClickOutside);
//   }, [visible, onClose]);

//   useEffect(() => {
//     if (!visible) {
//       // ELECTRON FIX: Don't reset if we just showed the submenu
//       const wasVisible = showNewSubmenu;
//       console.log('DEBUG: Menu hidden - wasVisible:', wasVisible);
//       if (!wasVisible) {
//         console.log('DEBUG: Menu hidden - resetting showNewSubmenu to false');
//         setShowNewSubmenu(false);
//       } else {
//         console.log('DEBUG: Keeping submenu visible despite menu hide');
//       }
//     }
//   }, [visible]);

//   useEffect(() => {
//     console.log('DEBUG: showNewSubmenu state changed to:', showNewSubmenu);
//     // ELECTRON FIX: Direct DOM manipulation as fallback
//     if (showNewSubmenu) {
//       const timer = setTimeout(() => {
//         const submenu = document.querySelector('.context-submenu-new');
//         if (submenu) {
//           submenu.style.display = 'block';
//           submenu.style.visibility = 'visible';
//           submenu.style.opacity = '1';
//           console.log('ELECTRON FIX: Forced submenu visible via DOM');
//         }
//       }, 50);
//       return () => clearTimeout(timer);
//     }
//   }, [showNewSubmenu]);

//   if (!visible) return null;

//   // Empty space context menu
//   if (isEmptySpace) {
//     return (
//       <div
//         ref={contextMenuRef}
//         className="context-menu"
//         style={{ top: menuPosition.y, left: menuPosition.x }}
//       >
//         <div
//           className="context-menu-item has-submenu-new"
//           onMouseEnter={handleParentMouseEnter}
//           onMouseLeave={handleParentMouseLeave}
//         >
//           ✨ New ▸
//           {/* ELECTRON FIX: Force show submenu if state is true */}
//           {showNewSubmenu && (
//             <div
//               className="context-submenu-new debug-submenu"
//               onMouseEnter={handleSubmenuMouseEnter}
//               onMouseLeave={handleSubmenuMouseLeave}
//               style={{ display: showNewSubmenu ? 'block' : 'none' }}
//             >
//               <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>
//                 📁 Folder
//               </div>
//               <div className="context-menu-divider"></div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>
//                 📄 Text Document
//               </div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>
//                 📝 Markdown File
//               </div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>
//                 {'{ }'} JSON File
//               </div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>
//                 🐍 Python File
//               </div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>
//                 ⚡ JavaScript File
//               </div>
//               <div className="context-menu-item" onClick={() => { onCreateFile?.('New Page.html'); onClose(); }}>
//                 🌐 HTML File
//               </div>
//             </div>
//           )}
//         </div>
//         <div className="context-menu-divider"></div>
//         <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste?.(); onClose(); }}>
//           📌 Paste (Ctrl+V)
//         </div>
//         <div className="context-menu-divider"></div>
//         <div className="context-menu-item" onClick={() => { onRefresh?.(); onClose(); }}>
//           🔄 Refresh (F5)
//         </div>
//         <div className="context-menu-divider"></div>
//         <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>
//           💻 Open Terminal Here
//         </div>
//         <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>
//           📘 Open in VS Code
//         </div>
//         <div className="context-menu-divider"></div>
//         <div className="context-menu-item" onClick={() => { onProperties?.(); onClose(); }}>
//           ℹ️ Properties
//         </div>
//       </div>
//     );
//   }
// if (!selectedItem) return null;
//   const isZipFile = selectedItem?.type === 'file' && selectedItem?.ext?.toLowerCase() === '.zip';

//   // File/folder context menu
//   return (
//     <div
//       ref={contextMenuRef}
//       className="context-menu"
//       style={{ top: menuPosition.y, left: menuPosition.x }}
//     >
//       <div className="context-menu-item" onClick={() => { onOpen(); onClose(); }}>
//         Open
//       </div>
//       <div className="context-menu-divider"></div>

//       {/* New submenu */}
//       <div
//         className="context-menu-item has-submenu-new"
//         onMouseEnter={handleParentMouseEnter}
//         onMouseLeave={handleParentMouseLeave}
//       >
//         ✨ New ▸
//         {showNewSubmenu && (
//           <div
//             className="context-submenu-new"
//             onMouseEnter={handleSubmenuMouseEnter}
//             onMouseLeave={handleSubmenuMouseLeave}
//           >
//             <div className="context-menu-item" onClick={() => { onCreateFolder?.(); onClose(); }}>
//               📁 Folder
//             </div>
//             <div className="context-menu-divider"></div>
//             <div className="context-menu-item" onClick={() => { onCreateFile?.('New Text Document.txt'); onClose(); }}>
//               📄 Text Document
//             </div>
//             <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.md'); onClose(); }}>
//               📝 Markdown File
//             </div>
//             <div className="context-menu-item" onClick={() => { onCreateFile?.('New Document.json'); onClose(); }}>
//               {'{ }'} JSON File
//             </div>
//             <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.py'); onClose(); }}>
//               🐍 Python File
//             </div>
//             <div className="context-menu-item" onClick={() => { onCreateFile?.('New Script.js'); onClose(); }}>
//               ⚡ JavaScript File
//             </div>
//           </div>
//         )}
//       </div>
//       <div className="context-menu-divider"></div>
//       <div
//         className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
//         onClick={selectedItem?.protected ? null : () => { onCut(); onClose(); }}
//       >
//         ✂️ Cut (Ctrl+X)
//       </div>
//       <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
//         📋 Copy (Ctrl+C)
//       </div>
//       <div className="context-menu-item" onClick={() => { onCopyPath?.(); onClose(); }}>
//         📎 Copy Path
//       </div>
//       <div className={`context-menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => { onPaste(); onClose(); }}>
//         📌 Paste (Ctrl+V)
//       </div>
//       <div className="context-menu-divider"></div>
//       {selectedItem?.type !== 'drive' && (
//         <div className="context-menu-item" onClick={() => { onCompress?.(); onClose(); }}>
//           🗜️ Compress to ZIP
//         </div>
//       )}
//       {isZipFile && (
//         <div className="context-menu-item" onClick={() => { onExtract?.(); onClose(); }}>
//           📂 Extract...
//         </div>
//       )}
//       {(selectedItem?.type !== 'drive' || isZipFile) && (
//         <div className="context-menu-divider"></div>
//       )}
//       <div
//         className={`context-menu-item ${selectedItem?.protected ? 'disabled' : ''}`}
//         onClick={selectedItem?.protected ? null : () => { onRename(); onClose(); }}
//       >
//         ✏️ Rename (F2)
//       </div>
//       <div
//         className={`context-menu-item delete ${selectedItem?.protected ? 'disabled' : ''}`}
//         onClick={selectedItem?.protected ? null : () => { onDelete(); onClose(); }}
//       >
//         🗑️ Delete
//       </div>
//       <div className="context-menu-divider"></div>

//       {selectedItem.type === 'folder' && (
//         <>
//           {canVersionItem ? (
//             <div className="context-menu-item" onClick={() => { onVersioning?.(selectedItem); onClose(); }}>
//               🕘 Versioning
//             </div>
//           ) : (
//             <div className="context-menu-item disabled" onClick={() => { onClose(); }}>
//               🕘 Versioning not available
//             </div>
//           )}
//           <div className="context-menu-item" onClick={() => { onOpenTerminal?.(); onClose(); }}>
//             💻 Open Terminal Here
//           </div>
//           <div className="context-menu-item" onClick={() => { onOpenInVSCode?.(); onClose(); }}>
//             📘 Open in VS Code
//           </div>
//           <div className="context-menu-divider"></div>
//         </>
//       )}

//       {selectedItem.type === 'file' && (
//         <>
//           <div className="context-menu-item" onClick={() => { onVersioning?.(); onClose(); }}>
//             🕒 Version History
//           </div>
//           <div className="context-menu-divider"></div>
//         </>
//       )}

//       <div className="context-menu-item" onClick={() => { onProperties(); onClose(); }}>
//         ℹ️ Properties
//       </div>
//       {onChatWithAI && selectedItem && selectedItem.type !== 'folder' && selectedItem.type !== 'drive' && (
//         <div className="context-menu-item" onClick={() => { onChatWithAI(); onClose(); }}>
//           🤖 Chat with AI
//         </div>
//       )}
//     </div>
//   );
// }

// export default ContextMenu;
