
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const { spawn } = require("child_process");

let llmProcess = null;
let backendProcess = null;
const BACKEND_URL = "http://127.0.0.1:8001";

function startLLMServer() {
  const backendPath = path.join(__dirname, "backend");
  const modelPath = path.join(__dirname, "models", "qwen2.5-3b-instruct-q4_k_m.gguf");
  const isWindows = process.platform === "win32";

  if (!fs.existsSync(modelPath)) {
    console.error("LLM Model not found at:", modelPath);
    console.error("Please download Qwen model to models/ folder.");
    return;
  }

  let pythonExecutable = isWindows
    ? path.join(backendPath, "venv", "Scripts", "python.exe")
    : path.join(backendPath, "venv", "bin", "python");

  if (!fs.existsSync(pythonExecutable)) {
    pythonExecutable = isWindows ? "python" : "python3";
  }

  console.log(`Starting LLM Server with: ${pythonExecutable}`);
  console.log(`Model: ${modelPath}`);

  llmProcess = spawn(pythonExecutable, [
    "-m", "llama_cpp.server",
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", "8080"
  ], {
    cwd: backendPath,
    stdio: 'inherit'
  });

  llmProcess.on('error', (err) => {
    console.error("Failed to start LLM process:", err);
  });

  llmProcess.on('exit', (code, signal) => {
    console.log(`LLM process exited with code ${code}`);
  });
}

function startBackend() {
  const backendPath = path.join(__dirname, "backend");
  const isWindows = process.platform === "win32";

  let pythonExecutable = isWindows
    ? path.join(backendPath, "venv", "Scripts", "python.exe")
    : path.join(backendPath, "venv", "bin", "python");

  // ... (rest is same)
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

  // ... (error handlers same)
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
  // ...
  const checkBackend = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        await axios.get(`${BACKEND_URL}/health`); // Changed to /health
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
    filters: [{ name: "Documents", extensions: ["pdf", "docx", "txt"] }]
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
    const fs = require('fs'); // Ensure fs is available

    // Check if backend is ready first to fail fast?
    // No, duplicate logic. Just try.

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post(`${BACKEND_URL}/upload`, form, {
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
    const response = await axios.post(`${BACKEND_URL}/ask`, { query, top_k: 5 });

    const answer = response.data.answer;

    // Simulate streaming for animation effect
    const chunkSize = 4; // Characters per chunk
    const delay = 15; // ms delay between chunks

    for (let i = 0; i < answer.length; i += chunkSize) {
      const chunk = answer.slice(i, i + chunkSize);
      event.reply("ai-chat-token", chunk);

      // Non-blocking delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    event.reply("ai-chat-done", answer);

  } catch (error) {
    console.error("Backend Chat Error:", error.message);
    event.reply("ai-chat-error", error.message || "Failed to generate response.");
  }
});

app.whenReady().then(() => {
  startLLMServer();
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
  if (llmProcess) {
    console.log("Killing LLM process...");
    llmProcess.kill();
  }
});
