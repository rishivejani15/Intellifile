const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ preload.js is running");

contextBridge.exposeInMainWorld("electronAPI", {
  sendMessage: (msg) => ipcRenderer.send("message", msg),
  onMessage: (callback) =>
    ipcRenderer.on("reply", (_, data) => callback(data)),

  // 🔽 FILE SYSTEM API
  openFile: () => ipcRenderer.invoke("open-file"),
  readFolder: (path) => ipcRenderer.invoke("read-folder", path),
  getRootFolders: () => ipcRenderer.invoke("get-root-folders"),
});
