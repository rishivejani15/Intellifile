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
  indexFile: (filePath) => {
    return ipcRenderer.invoke('index-file', filePath);
  },
  indexFolder: (folder) => {
    return ipcRenderer.invoke('index-folder', folder);
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