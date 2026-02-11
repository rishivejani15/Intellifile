
const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ preload.js is running");

contextBridge.exposeInMainWorld("electronAPI", {
  sendMessage: (msg) => ipcRenderer.send("message", msg),
  onMessage: (callback) =>
    ipcRenderer.on("reply", (_, data) => callback(data)),

  // 🔽 FILE SYSTEM API

  // NOTE: openFile now triggers backend ingestion if we modify the frontend logic to pass path instead of content.
  // The backend ingestion endpoint takes `file_path`.
  // The previous implementation read content in Electron.
  // We need to clarify if the frontend expects content or just triggers ingestion.
  // For RAG, we need to ingest.

  openFile: () => ipcRenderer.invoke("open-file"),
  readFolder: (path) => ipcRenderer.invoke("read-folder", path),
  getRootFolders: () => ipcRenderer.invoke("get-root-folders"),

  // New ingest document taking file path
  ingestDocument: (filePath) => ipcRenderer.invoke("ingest-document", filePath),

  // 🤖 AI Streaming (simulated for now as backend returns full response)
  startChat: (query) => ipcRenderer.send("ai-chat-start", query),
  onChatToken: (callback) => ipcRenderer.on("ai-chat-token", (_, token) => callback(token)),
  onChatDone: (callback) => ipcRenderer.on("ai-chat-done", (_, fullText) => callback(fullText)),
  onChatError: (callback) => ipcRenderer.on("ai-chat-error", (_, error) => callback(error)),
  removeAllChatListeners: () => {
    ipcRenderer.removeAllListeners("ai-chat-token");
    ipcRenderer.removeAllListeners("ai-chat-done");
    ipcRenderer.removeAllListeners("ai-chat-error");
  },
});
