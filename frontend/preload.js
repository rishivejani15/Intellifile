const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
      const subscription = (event, ...args) => func(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
    removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
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
  onIndexComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('index-complete', handler);
    return () => ipcRenderer.removeListener('index-complete', handler);
  },
  chatAsk: (query) => {
    return ipcRenderer.invoke('chat-ask', query);
  },
  chatStatus: () => {
    return ipcRenderer.invoke('chat-status');
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
  saveVersion: (data) => {
    return ipcRenderer.invoke('save-version', data);
  },
  getVersions: (filePath) => {
    return ipcRenderer.invoke('get-versions', filePath);
  },
  restoreVersion: (data) => {
    return ipcRenderer.invoke('restore-version', data);
  },
  compareVersions: (data) => {
    return ipcRenderer.invoke('compare-versions', data);
  },
  chat: (query) => {
    return ipcRenderer.invoke('chat', query);
  },
  ingestFile: (filePath) => {
    return ipcRenderer.invoke('ingest-file', filePath);
  },
  clearFaiss: () => {
    return ipcRenderer.invoke('clear-faiss');
  }
});

// electronAPI (merged from root preload.js)
contextBridge.exposeInMainWorld('electronAPI', {
  getRootFolders: () => ipcRenderer.invoke('get-root-folders'),
  readFolder: (folderPath) => ipcRenderer.invoke('read-folder', folderPath),
  openFile: () => ipcRenderer.invoke('open-file'),
  ingestDocument: (filePath) => ipcRenderer.invoke('ingest-document', filePath),
  startChat: (query) => ipcRenderer.send('ai-chat-start', query),
  onChatToken: (callback) => ipcRenderer.on('ai-chat-token', (_, token) => callback(token)),
  onChatDone: (callback) => ipcRenderer.on('ai-chat-done', (_, answer) => callback(answer)),
  onChatError: (callback) => ipcRenderer.on('ai-chat-error', (_, error) => callback(error)),
  removeAllChatListeners: () => {
    ipcRenderer.removeAllListeners('ai-chat-token');
    ipcRenderer.removeAllListeners('ai-chat-done');
    ipcRenderer.removeAllListeners('ai-chat-error');
  },
  checkModelStatus: () => ipcRenderer.invoke('check-model-status'),
  downloadModel: () => ipcRenderer.invoke('download-model'),
  resetApp: () => ipcRenderer.invoke('reset-app')
});