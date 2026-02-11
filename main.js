
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const { spawn } = require("child_process");

// We no longer need llm.js in the main process, but we might keep it if we want to fallback?
// No, user wants backend connection.
// const { chat, ingestDocument } = require("./llm"); // REMOVED

let backendProcess = null;
const BACKEND_URL = "http://127.0.0.1:8000";

function startBackend() {
  const backendPath = path.join(__dirname, "backend");
  // Check if we are in dev or prod logic usually, but here we assume python is in path or venv
  // For robustness as requested: "paths are relative to the script location"

  // Ideally, valid python executable is required.
  // We will try to use the venv created in the backend folder instructions
  const isWindows = process.platform === "win32";
  const pythonExecutable = isWindows
    ? path.join(backendPath, "venv", "Scripts", "python.exe")
    : path.join(backendPath, "venv", "bin", "python");

  if (!fs.existsSync(pythonExecutable)) {
    console.error("Python venv not found. Please follow backend setup instructions.");
    // Fallback to system python?
    // pythonExecutable = "python";
  }

  console.log(`Starting backend with: ${pythonExecutable}`);

  backendProcess = spawn(pythonExecutable, ["main.py"], {
    cwd: backendPath,
    stdio: 'pipe' // Capture output
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend]: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error]: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL("http://localhost:5173");
}

ipcMain.on("message", (event, msg) => {
  console.log("From React:", msg);
  event.reply("reply", "Hello from Electron 👋");
});

// 🔽 OPEN FILE + READ CONTENT (Keeping this as file reading is still done in Electron usually, 
// unless we want to send path to backend. The backend `ingest` endpoint takes a file path!
// So we should probably send the path to the backend, BUT the frontend might want to preview it.
// The current `open-file` reads the content and returns it to frontend.
// The new `ingest-document` should probably send the path to the backend.

ipcMain.handle("open-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Documents", extensions: ["pdf"] }] // Focused on PDF for now as per backend support
  });

  if (result.canceled) return null;

  const filePath = result.filePaths[0];

  // Return just the path and let the frontend call ingest with it?
  // Or read it for preview?
  // Original code read content. 
  // Let's keep reading content for preview if needed, BUT for RAG we need to send path to backend.

  return { filePath, content: "Preview not implemented for new backend setup in open-file (use ingest)" };
});


// 📂 Read folder contents - Keeping as is
ipcMain.handle("read-folder", async (_, folderPath) => {
  const items = fs.readdirSync(folderPath, { withFileTypes: true });

  return items.map((item) => {
    const fullPath = path.join(folderPath, item.name);
    const stats = fs.statSync(fullPath);

    return {
      name: item.name,
      path: fullPath,
      isDirectory: item.isDirectory(),
      size: stats.size,
      modified: stats.mtime,
    };
  });
});

// 📁 Common system folders - Keeping as is
ipcMain.handle("get-root-folders", () => {
  const home = os.homedir();
  return [
    { name: "Documents", path: path.join(home, "Documents") },
    { name: "Downloads", path: path.join(home, "Downloads") },
    { name: "Desktop", path: path.join(home, "Desktop") },
  ];
});

// 🚀 Ingest Document calling Backend
ipcMain.handle("ingest-document", async (_, filePath) => {
  try {
    // Note: The previous logic passed 'content'. The new backend expects 'file_path'.
    // The frontend must now pass the filePath instead of content.
    // I will update this assuming the frontend calls this.

    console.log("Sending ingest request to backend for:", filePath);
    const response = await axios.post(`${BACKEND_URL}/ingest`, { file_path: filePath });
    return response.data;
  } catch (err) {
    console.error("Backend Ingest Error:", err.message);
    throw err;
  }
});

// 🤖 AI Chat Handler calling Backend
ipcMain.on("ai-chat-start", async (event, query) => {
  try {
    // Notify streaming start (though backend is not streaming yet in basic implementation, call is sync)
    // If backend supports streaming, we would pipe it. 
    // The current main.py returns full response.

    // event.reply("ai-chat-token", "Thinking... "); // Don't send this as a token

    const response = await axios.post(`${BACKEND_URL}/chat`, { query });

    // Send the full response as a token so the UI updates
    event.reply("ai-chat-token", response.data.response);

    // Send done signal
    event.reply("ai-chat-done", response.data.response);

    // If we wanted to simulate streaming or if backend supported it, we'd do that here.

  } catch (error) {
    console.error("Backend Chat Error:", error.message);
    event.reply("ai-chat-error", error.message || "Failed to generate response.");
  }
});


app.whenReady().then(() => {
  startBackend();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) {
    console.log("Killing backend process...");
    backendProcess.kill();
  }
  if (process.platform !== "darwin") app.quit();
});

// Ensure backend is killed on exit
app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
