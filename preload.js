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
  chat: (query) => {
    return ipcRenderer.invoke('chat', query);
  },
  searchStatus: () => {
    return ipcRenderer.invoke('search-status');
  },
  indexFile: (filePath) => {
    return ipcRenderer.invoke('index-file', filePath);
  },
});

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
  }
});
