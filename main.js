const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");

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

// 🔽 OPEN FILE + READ CONTENT
// 🔽 OPEN FILE + READ CONTENT
const pdf = require("pdf-parse");

ipcMain.handle("open-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Documents", extensions: ["txt", "md", "js", "json", "pdf"] }]
  });

  if (result.canceled) return null;

  const filePath = result.filePaths[0];
  let content = "";

  try {
    if (filePath.toLowerCase().endsWith(".pdf")) {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      content = pdfData.text;
    } else {
      content = fs.readFileSync(filePath, "utf-8");
    }
  } catch (err) {
    console.error("Error reading file:", err);
    content = "Error reading file content.";
  }

  return { filePath, content };
});

const fs = require("fs");
const os = require("os");

// 📂 Read folder contents
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

// 📁 Common system folders
ipcMain.handle("get-root-folders", () => {
  const home = os.homedir();
  return [
    { name: "Documents", path: path.join(home, "Documents") },
    { name: "Downloads", path: path.join(home, "Downloads") },
    { name: "Desktop", path: path.join(home, "Desktop") },
  ];
});

// 🤖 AI Chat Handler
// 🤖 AI Chat Handler
const { chat } = require("./llm");

// Changed to 'on' instead of 'handle' to support multiple replies (streaming)
// Changed to 'on' instead of 'handle' to support multiple replies (streaming)
ipcMain.on("ai-chat-start", async (event, { query, context }) => {
  try {
    // Note: With T5, response is extremely fast. We still use the callback hook 
    // to maintain compatibility with the frontend listener structure.
    const fullResponse = await chat(query, context, (token) => {
      // Stream tokens directly
      // Skip the "Thinking..." prefix from the frontend/llm if it is redundant, 
      // but if the LLM emits it, we send it.
      if (token !== "Thinking... ") {
        event.reply("ai-chat-token", token);
      }
    });

    // Ensure we signal done
    event.reply("ai-chat-done", fullResponse);
  } catch (error) {
    console.error(error);
    event.reply("ai-chat-error", error.message || "Failed to generate response.");
  }
});


app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
