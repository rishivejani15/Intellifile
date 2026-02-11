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

  // 🤖 AI Streaming
  startChat: (query, context) => ipcRenderer.send("ai-chat-start", { query, context }),
  onChatToken: (callback) => ipcRenderer.on("ai-chat-token", (_, token) => callback(token)),
  onChatDone: (callback) => ipcRenderer.on("ai-chat-done", (_, fullText) => callback(fullText)),
  onChatError: (callback) => ipcRenderer.on("ai-chat-error", (_, error) => callback(error)),
  removeAllChatListeners: () => {
    ipcRenderer.removeAllListeners("ai-chat-token");
    ipcRenderer.removeAllListeners("ai-chat-done");
    ipcRenderer.removeAllListeners("ai-chat-error");
  },
});
