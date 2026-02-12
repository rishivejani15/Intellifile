
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const { spawn } = require("child_process");

let backendProcess = null;
const BACKEND_URL = "http://127.0.0.1:8001";

function startBackend() {
  const backendPath = path.join(__dirname, "backend");
  const isWindows = process.platform === "win32";

  let pythonExecutable = isWindows
    ? path.join(backendPath, "venv", "Scripts", "python.exe")
    : path.join(backendPath, "venv", "bin", "python");

  if (!fs.existsSync(pythonExecutable)) {
    console.warn("Venv Python not found at:", pythonExecutable);
    console.log("Falling back to system python...");
    pythonExecutable = isWindows ? "python" : "python3";
  }

  console.log(`Starting backend with: ${pythonExecutable}`);

  backendProcess = spawn(pythonExecutable, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"], {
    cwd: backendPath,
    stdio: 'inherit'
  });

  backendProcess.on('error', (err) => {
    console.error("Failed to start backend process:", err);
  });

  backendProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`Backend process exited with code ${code} and signal ${signal}`);
    } else {
      console.log("Backend process exited gracefully");
    }
  });

  // Verify backend is up
  const checkBackend = async () => {
    for (let i = 0; i < 60; i++) { // Wait up to 60 seconds
      try {
        await axios.get(`${BACKEND_URL}/docs`);
        console.log("Backend is ready and responding!");
        return;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.error("Backend failed to respond after 60 seconds.");
  };
  checkBackend();
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
}

ipcMain.on("message", (event, msg) => {
  console.log("From React:", msg);
  event.reply("reply", "Hello from Electron 👋");
});

ipcMain.handle("open-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Documents", extensions: ["pdf"] }]
  });

  if (result.canceled) return null;
  return { filePath: result.filePaths[0], content: "" };
});

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
    console.log("Sending ingest request to backend for:", filePath);

    const FormData = require('form-data');

    // Check if backend is ready first to fail fast?
    // No, duplicate logic. Just try.

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post(`${BACKEND_URL}/ingest_pdf`, form, {
      headers: {
        ...form.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    return response.data;
  } catch (err) {
    console.error("Backend Ingest Error:", err.message);
    if (err.response) {
      console.error("Data:", err.response.data);
    }
    throw err;
  }
});

// 🤖 AI Chat Handler calling Backend
ipcMain.on("ai-chat-start", async (event, query) => {
  try {
    // Call RAG Answer Endpoint
    console.log("Asking backend:", query);
    const response = await axios.post(`${BACKEND_URL}/answer`, { query, k: 5 });

    const answer = response.data.answer;

    // Send the full response
    event.reply("ai-chat-token", answer);
    event.reply("ai-chat-done", answer);

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
  if (process.platform !== "darwin") app.quit();
});

app.on('will-quit', () => {
  if (backendProcess) {
    console.log("Killing backend process...");
    backendProcess.kill();
  }
});
