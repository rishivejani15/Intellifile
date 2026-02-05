const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Check if running in development mode (force true for now since React dev server is running)
const isDev = true;

// Supported file extensions
const EDITABLE_EXTENSIONS = ['.py', '.js', '.java', '.cpp', '.c', '.go', '.txt', '.md', '.json', '.xml', '.html', '.css', '.ts', '.jsx', '.tsx'];

// Windows system files and folders to hide from users
const SYSTEM_FILES_TO_HIDE = [
  'config.msi',
  'dumpstack.log',
  'dumpstack.log.tmp',
  'hiberfil.sys',
  'pagefile.sys',
  'swapfile.sys',
  'bootmgr',
  'bootsect.bak',
  'boot.ini',
  'ntldr',
  'ntdetect.com',
  'io.sys',
  'msdos.sys',
  'autoexec.bat',
  'config.sys'
];

const SYSTEM_FOLDERS_TO_HIDE = [
  'recovery',
  'system volume information',
  '$recycle.bin',
  'perflogs',
  '$windows.~bt',
  '$windows.~ws'
];

// System file extensions to hide from users
const SYSTEM_FILE_EXTENSIONS = [
  '.dll',    // Dynamic Link Libraries
  '.sys',    // System files
  '.ini',    // Configuration files
  '.tmp',    // Temporary files
  '.log',    // Log files
  '.bak',    // Backup files
  '.old',    // Old backup files
  '.cache',  // Cache files
  '.dat',    // Data files (often system)
  '.db',     // Database files (like Thumbs.db)
  '.ldf',    // SQL Log files
  '.mdf'     // SQL Database files
];

// Protected system paths that cannot be deleted, moved, or renamed
const PROTECTED_PATHS = [
  /^[A-Z]:\\Windows/i,
  /^[A-Z]:\\Program Files/i,
  /^[A-Z]:\\Program Files \(x86\)/i,
  /^[A-Z]:\\ProgramData/i,
  /^[A-Z]:\\System Volume Information/i,
  /^[A-Z]:\\Recovery/i,
  /^[A-Z]:\\Config\.Msi/i
];

function isSystemFile(filename) {
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);
  
  return SYSTEM_FILES_TO_HIDE.includes(lower) || 
         SYSTEM_FOLDERS_TO_HIDE.includes(lower) ||
         SYSTEM_FILE_EXTENSIONS.includes(ext) ||
         lower === 'desktop.ini' || 
         lower === 'thumbs.db' || 
         filename.startsWith('.');
}

function isProtectedPath(filePath) {
  return PROTECTED_PATHS.some(pattern => pattern.test(filePath));
}

// Calculate folder size recursively
function calculateFolderSize(folderPath) {
  let totalSize = 0;
  
  try {
    const items = fs.readdirSync(folderPath);
    
    for (const item of items) {
      try {
        const itemPath = path.join(folderPath, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          totalSize += calculateFolderSize(itemPath);
        } else {
          totalSize += stats.size;
        }
      } catch (err) {
        // Skip items that can't be accessed
        continue;
      }
    }
  } catch (err) {
    // If we can't read the folder, return 0
    return 0;
  }
  
  return totalSize;
}

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
      console.log('[list-directory] called with:', dirPath);
      let resolvedPath = dirPath;
      
      // Handle special folder names
      if (dirPath === 'This PC') {
        // Return list of drives for This PC view
        const drivesResult = await getDrivesInfo();
        if (drivesResult.success) {
          const driveItems = drivesResult.drives.map(drive => ({
            name: drive.description,
            path: drive.device,
            type: 'drive',
            ext: '',
            editable: false,
            size: drive.size,
            available: drive.available,
            modified: Date.now()
          }));
          return { items: driveItems, error: null };
        }
        return { items: [], error: 'Could not load drives' };
      } else if (!dirPath || dirPath === 'Documents') {
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
      } else if (dirPath && dirPath.match(/^[A-Z]:$/i)) {
        // Handle drive letters like "C:" by converting to "C:\\"
        resolvedPath = dirPath + '\\';
      }
      
      console.log('[list-directory] resolved path:', resolvedPath);
      
      if (!fs.existsSync(resolvedPath)) {
        console.warn('[list-directory] Path not found:', resolvedPath);
        return { items: [], error: 'Path not found' };
      }

      console.log('[list-directory] reading directory...');
      const fileList = fs.readdirSync(resolvedPath);
      console.log('[list-directory] found', fileList.length, 'items');

      const items = fileList
        .filter(item => !isSystemFile(item))
        .map(item => {
          try {
            const fullPath = path.join(resolvedPath, item);
            const stats = fs.statSync(fullPath);
            const ext = path.extname(item).toLowerCase();
            const isEditable = EDITABLE_EXTENSIONS.includes(ext);
            const isProtected = isProtectedPath(fullPath);
            
            // Calculate folder size
            let size = stats.size;
            if (stats.isDirectory()) {
              size = calculateFolderSize(fullPath);
            }

            return {
              name: item,
              path: fullPath,
              type: stats.isDirectory() ? 'folder' : 'file',
              ext: ext,
              editable: !stats.isDirectory() && isEditable && !isProtected,
              protected: isProtected,
              size: size,
              modified: stats.mtimeMs
            };
          } catch (err) {
            // Skip files/folders that can't be accessed due to permissions
            console.warn('[list-directory] Skipping inaccessible item:', item, err.message);
            return null;
          }
        })
        .filter(item => item !== null)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      console.log('[list-directory] returning', items.length, 'items');
      return { items, error: null };
    } catch (err) {
      console.error('[list-directory] error:', err);
      return { items: [], error: err && err.message ? err.message : String(err) };
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
      // Check if source is protected
      if (isProtectedPath(sourcePath)) {
        return { success: false, error: 'Cannot move system files or folders' };
      }
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
      // Check if source is protected
      if (isProtectedPath(oldPath)) {
        return { success: false, error: 'Cannot rename system files or folders' };
      }
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
      // Check if path is protected
      if (isProtectedPath(filePath)) {
        return { success: false, error: 'Cannot delete system files or folders' };
      }
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

  ipcMain.handle('get-drives-info', getDrivesInfo);

}

// Separate function to get drives info (can be called internally)
async function getDrivesInfo() {
  return new Promise((resolve) => {
    try {
      // Use PowerShell to get volume labels dynamically
      const { exec } = require('child_process');
      exec('powershell -NoProfile -Command "Get-Volume | Where-Object {$_.DriveLetter} | Select-Object DriveLetter, FileSystemLabel, Size, SizeRemaining | ConvertTo-Json"', 
        { timeout: 5000 },
        (error, stdout, stderr) => {
          const drives = [];
          const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
          
          // Parse PowerShell output
          let volumeInfo = {};
          try {
            if (stdout && stdout.trim()) {
              const volumes = JSON.parse(stdout);
              const volumeArray = Array.isArray(volumes) ? volumes : [volumes];
              volumeArray.forEach(vol => {
                if (vol.DriveLetter) {
                  volumeInfo[vol.DriveLetter] = {
                    label: vol.FileSystemLabel || null,
                    size: parseInt(vol.Size) || 0,
                    available: parseInt(vol.SizeRemaining) || 0
                  };
                }
              });
              console.log('[get-drives-info] PowerShell data:', volumeInfo);
            }
          } catch (parseErr) {
            console.warn('[get-drives-info] Could not parse PowerShell output:', parseErr.message);
          }
          
          // Check each drive letter
          for (const letter of letters) {
            const drive = letter + ':';
            const drivePath = drive + '\\';
            
            // Check if drive exists
            if (!fs.existsSync(drivePath)) continue;
            
            try {
              const volInfo = volumeInfo[letter];
              let description, size, available;
              
              if (volInfo && volInfo.size > 0) {
                // Use PowerShell data
                const label = volInfo.label || 'Local Disk';
                description = volInfo.label ? `${volInfo.label} (${drive})` : `Local Disk (${drive})`;
                size = volInfo.size;
                available = volInfo.available;
              } else {
                // Fallback to fs.statfsSync
                const stats = fs.statfsSync ? fs.statfsSync(drivePath) : null;
                description = `Local Disk (${drive})`;
                size = stats ? stats.blocks * stats.bsize : 0;
                available = stats ? stats.bavail * stats.bsize : 0;
              }
              
              console.log(`[get-drives-info] Drive ${drive}: size=${size}, available=${available}`);
              
              drives.push({
                device: drive,
                description: description,
                mountpoints: [{ path: drivePath }],
                size: size,
                available: available,
                isSystem: letter === 'C',
                isRemovable: false,
                isUSB: false,
                isCard: false,
                isReadOnly: false
              });
            } catch (err) {
              console.warn(`[get-drives-info] Could not get stats for ${drive}:`, err.message);
            }
          }
          
          console.log(`[get-drives-info] Returning ${drives.length} drives`);
          resolve({ success: true, drives });
        }
      );
    } catch (err) {
      console.error('[get-drives-info] error:', err);
      resolve({ success: false, drives: [], error: err.message });
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
