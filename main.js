const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PythonShell } = require('python-shell');
const axios = require("axios");
const { spawn } = require('child_process');

const BACKEND_URL = "http://127.0.0.1:8000";

const isWindows = process.platform === "win32";
const pythonPath = isWindows
  ? path.join(__dirname, "backend", "venv", "Scripts", "python.exe")
  : path.join(__dirname, "backend", "venv", "bin", "python");

console.log("DEBUG: Python path set to:", pythonPath);

let backendProcess = null;

function startBackend() {
  const scriptPath = path.join(__dirname, "backend", "main.py");
  console.log("Starting backend server from:", scriptPath);

  backendProcess = spawn(pythonPath, ['-u', scriptPath], {
    env: { ...process.env }
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL("http://localhost:5173");
  mainWindow.webContents.openDevTools(); // Open dev tools for debugging
}

app.on("will-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

ipcMain.handle("chat", async (event, query) => {
  try {
    const results = await PythonShell.run('backend/llm.py', { args: ['chat', query], pythonPath });
    const answer = results[0] || "";
    return answer;
  } catch (err) {
    console.error("Chat error:", err);
    throw err;
  }
});

ipcMain.handle("search-status", async () => {
  // For simplicity, return ready
  return { status: "ready" };
});

ipcMain.handle("index-file", async (_, filePath) => {
  try {
    await PythonShell.run('backend/llm.py', { args: ['ingest_file', filePath], pythonPath });
    return { success: true };
  } catch (err) {
    console.error("Index error:", err);
    throw err;
  }
});

// Keep the original for compatibility
// Duplicate handler removed to prevent double execution and enforce use of backend server
// See Axios handler below for active implementation


ipcMain.handle("get-root-folders", async () => {
  const homeDir = os.homedir();
  return [
    { name: "Home", path: homeDir },
    { name: "Documents", path: path.join(homeDir, "Documents") },
    { name: "Downloads", path: path.join(homeDir, "Downloads") },
    { name: "Desktop", path: path.join(homeDir, "Desktop") },
  ];
});

ipcMain.handle("read-folder", async (event, folderPath) => {
  try {
    const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
    return items.map((item) => ({
      name: item.name,
      path: path.join(folderPath, item.name),
      isDirectory: item.isDirectory(),
    }));
  } catch (err) {
    console.error("Error reading folder:", err);
    return [];
  }
});

ipcMain.handle("open-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Documents", extensions: ["pdf", "docx", "txt", "md"] }],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return { filePath: filePaths[0] };
});

// Keep the original for compatibility
ipcMain.handle("ingest-document", async (_, filePath) => {
  console.log("DEBUG: Ingesting document:", filePath);
  try {
    console.log("Ingesting document with Python:", filePath);

    await PythonShell.run('backend/llm.py', { args: ['ingest_file', filePath], pythonPath });

    console.log("DEBUG: Ingest successful");

    // Refresh backend index
    try {
      await axios.post(`${BACKEND_URL}/refresh_index`);
      console.log("DEBUG: Index refreshed on backend");
    } catch (e) {
      console.error("Failed to refresh index:", e.message);
    }

    return { success: true };
  } catch (err) {
    console.error("Python Ingest Error:", err.message);
    throw err;
  }
});

// Keep the original for compatibility
ipcMain.on("ai-chat-start", async (event, query) => {
  console.log("DEBUG: Chat started with query:", query);
  try {
    console.log("Chatting with backend (streaming):", query);

    const response = await axios({
      method: 'post',
      url: `${BACKEND_URL}/chat`,
      data: { query },
      responseType: 'stream'
    });

    let fullAnswer = "";

    response.data.on('data', (chunk) => {
      const token = chunk.toString();
      fullAnswer += token;
      event.reply("ai-chat-token", token);
    });

    response.data.on('end', () => {
      console.log("DEBUG: Chat streaming finished.");
      event.reply("ai-chat-done", fullAnswer);
    });

    response.data.on('error', (err) => {
      console.error("Stream error:", err);
      event.reply("ai-chat-error", "Stream interrupted.");
    });

  } catch (error) {
    console.error("Backend Chat Error:", error.message);
    event.reply("ai-chat-error", error.message || "Failed to generate response.");
  }
});

ipcMain.handle("check-model-status", async () => {
  try {
    const response = await axios.get(`${BACKEND_URL}/health`);
    return response.data;
  } catch (err) {
    console.error("Health check failed:", err.message);
    return { status: "error", embedding_model: "offline" };
  }
});

ipcMain.handle("download-model", async () => {
  try {
    const response = await axios.post(`${BACKEND_URL}/download_model`);
    return response.data;
  } catch (err) {
    console.error("Download model error:", err.message);
    throw err;
  }
});

ipcMain.handle("reset-app", async () => {
  try {
    const response = await axios.post(`${BACKEND_URL}/reset`);
    return response.data;
  } catch (err) {
    console.error("Reset app error:", err.message);
    throw err;
  }
});

app.whenReady().then(() => {
  startBackend();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
