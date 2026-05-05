const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
    once: (channel, func) => ipcRenderer.once(channel, (event, ...args) => func(...args)),
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
    return () => ipcRenderer.removeListener('index-progress', handler);
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
    return () => ipcRenderer.removeListener('chat-stream-token', handler);
  },
  onChatStreamDone: (callback) => {
    const handler = (_event, answer) => callback(answer);
    ipcRenderer.on('chat-stream-done', handler);
    return () => ipcRenderer.removeListener('chat-stream-done', handler);
  },
  onChatStreamError: (callback) => {
    const handler = (_event, err) => callback(err);
    ipcRenderer.on('chat-stream-error', handler);
    return () => ipcRenderer.removeListener('chat-stream-error', handler);
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
  getLocalSyncAddress: () => {
    return ipcRenderer.invoke('get-local-sync-address');
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
    return () => ipcRenderer.removeListener('sync-status', handler);
  },
  onSyncLog: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('sync-log', handler);
    return () => ipcRenderer.removeListener('sync-log', handler);
  },
  onSyncFiles: (callback) => {
    const handler = (_event, files) => callback(files);
    ipcRenderer.on('sync-files', handler);
    return () => ipcRenderer.removeListener('sync-files', handler);
  },
  onSyncPending: (callback) => {
    const handler = (_event, changes) => callback(changes);
    ipcRenderer.on('sync-pending', handler);
    return () => ipcRenderer.removeListener('sync-pending', handler);
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
});
