const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Check if running in development mode (force true for now since React dev server is running)
const isDev = true;

// Supported file extensions
const EDITABLE_EXTENSIONS = ['.py', '.js', '.java', '.cpp', '.c', '.go', '.txt', '.md', '.json', '.xml', '.html', '.css', '.ts', '.jsx', '.tsx'];

let mainWindow;
let ipcHandlersRegistered = false;

// Always-available handler for opening files with the OS default app
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    const result = await shell.openPath(filePath);
    if (result) {
      return { success: false, error: result };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('open-file', (event, filePath) => {
  shell.openPath(filePath).catch(err => {
    console.error('Error opening file:', err);
  });
});

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  // IPC Handlers for file operations
  ipcMain.handle('list-directory', async (event, dirPath) => {
    try {
      let resolvedPath = dirPath;
      
      // Handle special folder names
      if (!dirPath || dirPath === 'Documents') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Documents');
      } else if (dirPath === 'Desktop') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Desktop');
      } else if (dirPath === 'Downloads') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Downloads');
      } else if (dirPath === 'Pictures') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Pictures');
      } else if (dirPath === 'Music') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Music');
      } else if (dirPath === 'Videos') {
        resolvedPath = path.join(process.env.USERPROFILE, 'Videos');
      }
      
      if (!fs.existsSync(resolvedPath)) {
        return { items: [], error: 'Path not found' };
      }

      const items = fs.readdirSync(resolvedPath)
        .filter(item => {
          // Filter out Windows system files
          const lowerName = item.toLowerCase();
          return lowerName !== 'desktop.ini' && 
                 lowerName !== 'thumbs.db' && 
                 !item.startsWith('.');
        })
        .map(item => {
          const fullPath = path.join(resolvedPath, item);
          const stats = fs.statSync(fullPath);
          const ext = path.extname(item).toLowerCase();
          const isEditable = EDITABLE_EXTENSIONS.includes(ext);

          return {
            name: item,
            path: fullPath,
            type: stats.isDirectory() ? 'folder' : 'file',
            ext: ext,
            editable: !stats.isDirectory() && isEditable,
            size: stats.size,
            modified: stats.mtimeMs
          };
        }).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return { items, error: null };
    } catch (err) {
      return { items: [], error: err.message };
    }
  });

  ipcMain.handle('get-files-to-merge', async () => {
    const docsPath = path.join(process.env.USERPROFILE, 'Documents');
    const files = [];
    try {
      const items = fs.readdirSync(docsPath);
      items.forEach(item => {
        const ext = path.extname(item).toLowerCase();
        if (EDITABLE_EXTENSIONS.includes(ext)) {
          files.push({
            name: item,
            path: path.join(docsPath, item),
            ext: ext,
            editable: true
          });
        }
      });
    } catch (err) {
      console.error('Error reading documents:', err);
    }
    return files;
  });

  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, success: true };
    } catch (err) {
      return { content: null, success: false, error: err.message };
    }
  });

  ipcMain.handle('read-file-base64', async (event, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return { data: buffer.toString('base64'), success: true };
    } catch (err) {
      return { data: null, success: false, error: err.message };
    }
  });

  ipcMain.handle('save-file', async (event, filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('copy-file', async (event, sourcePath, destPath) => {
    try {
      // Check if destination exists
      if (fs.existsSync(destPath)) {
        // Modify destination name if file exists
        const dir = path.dirname(destPath);
        const ext = path.extname(destPath);
        const name = path.basename(destPath, ext);
        let counter = 1;
        let newDest = destPath;
        while (fs.existsSync(newDest)) {
          newDest = path.join(dir, `${name} (${counter})${ext}`);
          counter++;
        }
        destPath = newDest;
      }

      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        // Copy directory recursively
        const copyDir = (src, dst) => {
          if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
          fs.readdirSync(src).forEach(file => {
            const srcFile = path.join(src, file);
            const dstFile = path.join(dst, file);
            if (fs.statSync(srcFile).isDirectory()) {
              copyDir(srcFile, dstFile);
            } else {
              fs.copyFileSync(srcFile, dstFile);
            }
          });
        };
        copyDir(sourcePath, destPath);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('move-file', async (event, sourcePath, destPath) => {
    try {
      if (fs.existsSync(destPath)) {
        const dir = path.dirname(destPath);
        const ext = path.extname(destPath);
        const name = path.basename(destPath, ext);
        let counter = 1;
        let newDest = destPath;
        while (fs.existsSync(newDest)) {
          newDest = path.join(dir, `${name} (${counter})${ext}`);
          counter++;
        }
        destPath = newDest;
      }
      fs.renameSync(sourcePath, destPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('rename-file', async (event, oldPath, newPath) => {
    try {
      if (oldPath === newPath) {
        return { success: true };
      }
      if (fs.existsSync(newPath)) {
        return { success: false, error: 'File already exists' };
      }
      fs.renameSync(oldPath, newPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      // Move to Recycle Bin using Windows API
      const { exec } = require('child_process');
      const stats = fs.statSync(filePath);
      const escapedPath = filePath.replace(/'/g, "''");
      if (stats.isDirectory()) {
        exec(
          `powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escapedPath}','OnlyErrorDialogs','SendToRecycleBin')"`,
          (err) => { if (err) console.error('Error deleting folder:', err); }
        );
      } else {
        exec(
          `powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedPath}','OnlyErrorDialogs','SendToRecycleBin')"`,
          (err) => { if (err) console.error('Error deleting file:', err); }
        );
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('create-folder', async (event, folderPath) => {
    try {
      if (fs.existsSync(folderPath)) {
        const dir = path.dirname(folderPath);
        const name = path.basename(folderPath);
        let counter = 1;
        let newPath = folderPath;
        while (fs.existsSync(newPath)) {
          newPath = path.join(dir, `${name} (${counter})`);
          counter++;
        }
        folderPath = newPath;
      }
      fs.mkdirSync(folderPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../build/index.html')}`;
  
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => (mainWindow = null));

}

app.on('ready', () => {
  registerIpcHandlers();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
