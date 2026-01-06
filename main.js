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
ipcMain.handle("open-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
  });

  if (result.canceled) return null;

  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, "utf-8");

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


app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
