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
  }
});