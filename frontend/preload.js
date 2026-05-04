const { contextBridge, ipcRenderer, shell } = require('electron');

// Store handler wrappers so they can be properly removed
const listeners = new Map();

function getOrCreateHandlerList(channel) {
  if (!listeners.has(channel)) {
    listeners.set(channel, []);
  }
  return listeners.get(channel);
}

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
      const wrappedFunc = (event, ...args) => func(...args);
      getOrCreateHandlerList(channel).push({ func, wrapped: wrappedFunc });
      ipcRenderer.on(channel, wrappedFunc);
    },
    once: (channel, func) => ipcRenderer.once(channel, (event, ...args) => func(...args)),
    off: (channel, func) => {
      const handlers = getOrCreateHandlerList(channel);
      const index = handlers.findIndex(h => h.func === func);
      if (index !== -1) {
        const { wrapped } = handlers[index];
        ipcRenderer.off(channel, wrapped);
        handlers.splice(index, 1);
      }
    },
    removeListener: (channel, func) => {
      const handlers = getOrCreateHandlerList(channel);
      const index = handlers.findIndex(h => h.func === func);
      if (index !== -1) {
        const { wrapped } = handlers[index];
        ipcRenderer.removeListener(channel, wrapped);
        handlers.splice(index, 1);
      }
    },
  },
  shell: {
    openPath: (path) => shell.openPath(path)
  }
});

// intellifile api
contextBridge.exposeInMainWorld('intellifile', {
  search: (query) => {
    return ipcRenderer.invoke('search', query);
  },
  searchStatus: () => {
    return ipcRenderer.invoke('search-status');
  },
  indexDevice: () => {
    return ipcRenderer.invoke('index-device');
  },
  onIndexProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('index-progress', handler);
    return () => ipcRenderer.off('index-progress', handler);
  },
  onIndexComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('index-complete', handler);
    return () => ipcRenderer.off('index-complete', handler);
  },
  chatAsk: (query) => {
    return ipcRenderer.invoke('chat-ask', query);
  },
  startChatStream: (query) => {
    return ipcRenderer.send('chat-stream-start', query);
  },
  onChatStreamToken: (callback) => {
    const handler = (_event, token) => callback(token);
    ipcRenderer.on('chat-stream-token', handler);
    return () => ipcRenderer.off('chat-stream-token', handler);
  },
  onChatStreamDone: (callback) => {
    const handler = (_event, answer) => callback(answer);
    ipcRenderer.on('chat-stream-done', handler);
    return () => ipcRenderer.off('chat-stream-done', handler);
  },
  onChatStreamError: (callback) => {
    const handler = (_event, err) => callback(err);
    ipcRenderer.on('chat-stream-error', handler);
    return () => ipcRenderer.off('chat-stream-error', handler);
  },
  ingestFileForChat: (filePath) => {
    return ipcRenderer.invoke('chat-ingest-file', filePath);
  },
  listVersions: (filePath) => {
    return ipcRenderer.invoke('versions-list', filePath);
  },
  compareVersions: (payload) => {
    return ipcRenderer.invoke('versions-compare', payload);
  },
  restoreVersion: (payload) => {
    return ipcRenderer.invoke('versions-restore', payload);
  },
  // Sync — local file management
  getSyncFiles: () => {
    return ipcRenderer.invoke('get-sync-files');
  },
  selectFilesForSync: () => {
    return ipcRenderer.invoke('select-files-for-sync');
  },
  removeSyncFile: (fileName) => {
    return ipcRenderer.invoke('remove-sync-file', fileName);
  },

  // Sync — remote engine (signaling + WebRTC relay)
  syncConnect: (opts) => {
    return ipcRenderer.invoke('sync-connect', opts);
  },
  syncDisconnect: () => {
    return ipcRenderer.invoke('sync-disconnect');
  },
  syncApprove: (filepath) => {
    return ipcRenderer.invoke('sync-approve', filepath);
  },
  syncReject: (filepath) => {
    return ipcRenderer.invoke('sync-reject', filepath);
  },
  syncApproveAll: () => {
    return ipcRenderer.invoke('sync-approve-all');
  },
  syncRejectAll: () => {
    return ipcRenderer.invoke('sync-reject-all');
  },
  syncGetPending: () => {
    return ipcRenderer.invoke('sync-get-pending');
  },
  onSyncStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync-status', handler);
    return () => ipcRenderer.off('sync-status', handler);
  },
  onSyncLog: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('sync-log', handler);
    return () => ipcRenderer.off('sync-log', handler);
  },
  onSyncFiles: (callback) => {
    const handler = (_event, files) => callback(files);
    ipcRenderer.on('sync-files', handler);
    return () => ipcRenderer.off('sync-files', handler);
  },
  onSyncPending: (callback) => {
    const handler = (_event, changes) => callback(changes);
    ipcRenderer.on('sync-pending', handler);
    return () => ipcRenderer.off('sync-pending', handler);
  },

  // Compatibility aliases for existing UI components.
  ingestFile: (filePath) => {
    return ipcRenderer.invoke('ingest-file', filePath);
  },
  chat: (query) => {
    return ipcRenderer.invoke('chat', query);
  },
  clearFaiss: () => {
    return ipcRenderer.invoke('clear-faiss');
  },
  resetIndexStore: () => {
    return ipcRenderer.invoke('reset-index-store');
  },

  // ── New File Explorer APIs ──
  createFile: (filePath) => {
    return ipcRenderer.invoke('create-file', filePath);
  },
  openWith: (filePath) => {
    return ipcRenderer.invoke('open-with', filePath);
  },
  getFileDetails: (filePath) => {
    return ipcRenderer.invoke('get-file-details', filePath);
  },
  openTerminalHere: (dirPath) => {
    return ipcRenderer.invoke('open-terminal-here', dirPath);
  },
  openInVSCode: (targetPath) => {
    return ipcRenderer.invoke('open-in-vscode', targetPath);
  },
  copyToClipboard: (text) => {
    return ipcRenderer.invoke('copy-to-clipboard', text);
  },
  getThumbnail: (filePath) => {
    return ipcRenderer.invoke('get-thumbnail', filePath);
  },
});