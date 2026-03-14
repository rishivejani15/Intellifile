const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const chokidar = require('chokidar');

// Check if running in development mode
const isDev = true;

// Supported file extensions
const EDITABLE_EXTENSIONS = ['.py', '.js', '.java', '.cpp', '.c', '.go', '.txt', '.md', '.json', '.xml', '.html', '.css', '.ts', '.jsx', '.tsx', '.docx', '.xlsx'];

// Windows system files and folders to hide from users
const SYSTEM_FILES_TO_HIDE = [
  'config.msi', 'dumpstack.log', 'dumpstack.log.tmp', 'hiberfil.sys', 'pagefile.sys', 'swapfile.sys',
  'bootmgr', 'bootsect.bak', 'boot.ini', 'ntldr', 'ntdetect.com', 'io.sys', 'msdos.sys',
  'autoexec.bat', 'config.sys'
];

const SYSTEM_FOLDERS_TO_HIDE = ['recovery', 'system volume information', '$recycle.bin', 'perflogs', '$windows.~bt', '$windows.~ws'];

const SYSTEM_FILE_EXTENSIONS = ['.dll', '.sys', '.ini', '.tmp', '.log', '.bak', '.old', '.cache', '.dat', '.db', '.ldf', '.mdf'];

const PROTECTED_PATHS = [
  /^[A-Z]:\\Windows/i, /^[A-Z]:\\Program Files/i, /^[A-Z]:\\Program Files \(x86\)/i,
  /^[A-Z]:\\ProgramData/i, /^[A-Z]:\\System Volume Information/i, /^[A-Z]:\\Recovery/i, /^[A-Z]:\\Config\.Msi/i
];

function isSystemFile(filename) {
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);
  return SYSTEM_FILES_TO_HIDE.includes(lower) || SYSTEM_FOLDERS_TO_HIDE.includes(lower) ||
    SYSTEM_FILE_EXTENSIONS.includes(ext) || lower === 'desktop.ini' || lower === 'thumbs.db' || filename.startsWith('.');
}

let pyProcess;
let pyReady = false;
let pyBuffer = '';
let pendingRequests = new Map();
let requestCounter = 0;
let fileWatchers = new Map();
let fileContents = new Map();
let win = null;

function sendToPython(payload, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!pyProcess || !pyReady) {
      return resolve({ error: 'Search engine is not ready yet.' });
    }
    const id = ++requestCounter;
    payload._id = id;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve({ error: 'Request timed out' });
    }, timeoutMs);
    pendingRequests.set(id, { resolve, timeout: timer });
    pyProcess.stdin.write(JSON.stringify(payload) + '\n');
  });
}

function startPython() {
  const scriptPath = path.join(__dirname, "../backend/engine_server.py");
  const pythonPath = path.join(__dirname, "../venv/Scripts/python.exe");
  pyProcess = spawn(pythonPath, [scriptPath], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  pyProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.log("[PY stdout]", text.trim());
    if (!pyReady && text.includes('IntelliFile Python Engine Ready')) {
      pyReady = true;
      console.log('[Python] ✅ Engine is ready');
    }
    pyBuffer += text;
    const lines = pyBuffer.split('\n');
    pyBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const id = parsed._id;
        if (id && pendingRequests.has(id)) {
          const { resolve, timeout } = pendingRequests.get(id);
          clearTimeout(timeout);
          pendingRequests.delete(id);
          resolve(parsed);
        }
      } catch (e) { }
    }
  });

  pyProcess.stderr.on("data", (data) => console.error("[PY stderr]", data.toString().trim()));

  pyProcess.on("close", (code) => {
    console.log('[Python] ❌ Process exited with code:', code);
    pyReady = false;
    for (const [id, { resolve, timeout }] of pendingRequests) {
      clearTimeout(timeout);
      resolve({ error: 'Python engine crashed' });
    }
    pendingRequests.clear();
  });
}

// function startPython() {
//   const scriptPath = path.join(__dirname, "../backend/engine_server.py");
//   console.log('[Python] Starting engine from:', scriptPath);

//   pyProcess = spawn("python", [scriptPath], {
//     cwd: path.join(__dirname, '..'),
//     stdio: ['pipe', 'pipe', 'pipe']
//   });

//   pyProcess.stdout.on("data", (data) => {
//     const text = data.toString();
//     console.log("[PY stdout]", text.trim());

//     // Check for readiness signal
//     if (!pyReady && text.includes('IntelliFile Python Engine Ready')) {
//       pyReady = true;
//       console.log('[Python] ✅ Engine is ready — pyReady = true');
//     }

//     // Buffer stdout and resolve pending requests when we get complete JSON lines
//     pyBuffer += text;
//     const lines = pyBuffer.split('\n');
//     // Keep last (possibly incomplete) line in buffer
//     pyBuffer = lines.pop();
//     for (const line of lines) {
//       const trimmed = line.trim();
//       if (!trimmed) continue;
//       try {
//         const parsed = JSON.parse(trimmed);
//         const id = parsed._id;
//         if (id && pendingRequests.has(id)) {
//           const { resolve, timeout } = pendingRequests.get(id);
//           clearTimeout(timeout);
//           pendingRequests.delete(id);
//           resolve(parsed);
//         }
//       } catch (e) {
//         // Not valid JSON, ignore
//         console.log("Not a valid json");
//       }
//     }
//   });

//   pyProcess.stderr.on("data", (data) => {
//     console.error("[PY stderr]", data.toString().trim());
//   });

//   pyProcess.on("close", (code) => {
//     console.log('[Python] ❌ Process exited with code:', code);
//     pyReady = false;
//     // Reject all pending requests
//     for (const [id, { resolve, timeout }] of pendingRequests) {
//       clearTimeout(timeout);
//       resolve({ error: 'Python engine crashed' });
//     }
//     pendingRequests.clear();
//   });
// }

function startWatchingFile(filePath) {
  const normPath = filePath.toLowerCase().replace(/\//g, '\\');
  const ext = path.extname(filePath).toLowerCase();
  if (!EDITABLE_EXTENSIONS.includes(ext) || fileWatchers.has(normPath)) return;

  console.log(`[Watcher] Starting watch on: ${filePath}`);

  try {
    const isBinary = ['.docx', '.xlsx'].includes(ext);
    if (!isBinary) {
      fileContents.set(normPath, fs.readFileSync(filePath, 'utf-8'));
    } else {
      fileContents.set(normPath, fs.statSync(filePath).mtimeMs.toString());
    }
  } catch (e) {
    fileContents.set(normPath, '');
  }

  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 }
  });

  watcher.on('change', async (p) => {
    console.log(`[Watcher] Change: ${p}`);
    const normP = p.toLowerCase().replace(/\//g, '\\');
    const extP = path.extname(p).toLowerCase();
    const isBinaryP = ['.docx', '.xlsx'].includes(extP);

    try {
      let currentVal = isBinaryP ? fs.statSync(p).mtimeMs.toString() : fs.readFileSync(p, 'utf-8');
      let lastVal = fileContents.get(normP) || '';

      if (!isBinaryP && currentVal.trim() === lastVal.trim()) return;
      if (isBinaryP && currentVal === lastVal) return;

      console.log(`[Watcher] Change verified. Triggering version save...`);
      // For binary files, pass path as "content" to let engine parse it
      const result = await sendToPython({
        action: "save_version",
        file_path: p,
        old_content: isBinaryP ? p : lastVal,
        new_content: isBinaryP ? p : currentVal
      });

      if (result && result.success) {
        fileContents.set(normP, currentVal);
        if (win) {
          // Sync with VersionTimeline.js which expects 'version-updated' and { filePath }
          win.webContents.send('version-updated', {
            filePath: p,
            versionId: result.data.version_id,
            summary: result.data.summary,
            riskLevel: result.data.risk_level
          });
        }
      }
    } catch (err) {
      console.error(`[Watcher] Update error: ${err.message}`);
    }
  });

  watcher.on('unlink', (p) => stopWatchingFile(p));
  fileWatchers.set(normPath, watcher);
}

function stopWatchingFile(filePath) {
  const normPath = filePath.toLowerCase().replace(/\//g, '\\');
  if (fileWatchers.has(normPath)) {
    fileWatchers.get(normPath).close();
    fileWatchers.delete(normPath);
    console.log(`[Watcher] Stopped: ${normPath}`);
  }
}

function isProtectedPath(filePath) {
  return PROTECTED_PATHS.some(pattern => pattern.test(filePath));
}

function registerIpcHandlers() {
  ipcMain.handle('list-directory', async (_, dirPath) => {
    try {
      let resolvedPath = dirPath;
      if (dirPath === 'This PC') {
        const dInfo = await getDrivesInfo();
        const items = dInfo.drives.map(d => ({
          name: d.description, path: d.device, type: 'drive', size: d.size, modified: Date.now()
        }));
        return { items, error: null };
      }

      if (!dirPath || ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos'].includes(dirPath)) {
        resolvedPath = path.join(process.env.USERPROFILE, dirPath || 'Documents');
      } else if (dirPath.match(/^[A-Z]:$/i)) {
        resolvedPath = dirPath + '\\';
      }

      const fileList = await fs.promises.readdir(resolvedPath);
      const items = (await Promise.all(fileList.filter(f => !isSystemFile(f)).map(async f => {
        try {
          const fp = path.join(resolvedPath, f);
          const s = await fs.promises.stat(fp);
          const e = path.extname(f).toLowerCase();
          const p = isProtectedPath(fp);
          return {
            name: f, path: fp, type: s.isDirectory() ? 'folder' : 'file',
            ext: e, editable: !s.isDirectory() && EDITABLE_EXTENSIONS.includes(e) && !p,
            protected: p, size: s.isDirectory() ? 0 : s.size, modified: s.mtimeMs
          };
        } catch { return null; }
      }))).filter(i => i !== null).sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));

      return { items, error: null };
    } catch (e) { return { items: [], error: e.message }; }
  });

  ipcMain.handle('open-file', async (_, p) => {
    try {
      startWatchingFile(p);
      const res = await shell.openPath(p);
      return res ? { success: false, error: res } : { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('read-file', async (_, p) => {
    try { return { content: fs.readFileSync(p, 'utf-8'), success: true }; }
    catch (e) { return { content: null, success: false, error: e.message }; }
  });

  ipcMain.handle('save-file', async (_, p, c) => {
    try {
      const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : "";
      fs.writeFileSync(p, c, 'utf-8');
      await sendToPython({ action: "save_version", file_path: p, old_content: old, new_content: c });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('delete-file', async (_, p) => {
    try {
      if (isProtectedPath(p)) return { success: false, error: 'Protected path' };
      const { exec } = require('child_process');
      const esc = p.replace(/'/g, "''");
      const cmd = fs.statSync(p).isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
      exec(`powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${cmd}('${esc}','OnlyErrorDialogs','SendToRecycleBin')"`);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle("get-versions", async (_, p) => sendToPython({ action: "get_versions", file_path: p }));
  ipcMain.handle("compare-versions", async (_, { filePath, versionA, versionB }) => sendToPython({ action: "compare_versions", file_path: filePath, version_a: versionA, version_b: versionB }));

  ipcMain.handle("restore-version", async (_, { filePath, versionId }) => {
    const res = await sendToPython({ action: "restore_version", file_path: filePath, version_id: versionId });
    if (res.success) {
      setTimeout(() => {
        try {
          const norm = filePath.toLowerCase().replace(/\//g, '\\');
          const ext = path.extname(filePath).toLowerCase();
          if (!['.docx', '.xlsx'].includes(ext)) {
            fileContents.set(norm, fs.readFileSync(filePath, 'utf-8'));
          } else {
            fileContents.set(norm, fs.statSync(filePath).mtimeMs.toString());
          }
        } catch { }
      }, 300);
    }
    return res;
  });

  ipcMain.handle("search-status", async () => {
    return { ready: pyReady };
  });

  ipcMain.handle("search", async (_, query) => {
    return sendToPython({ action: "search", query });
  });

  ipcMain.handle("index-folder", async (_, folder) => {
    return sendToPython({ action: "index", folder }, 300000);
  });

  ipcMain.handle('get-files-to-merge', async () => {
    const docsPath = path.join(process.env.USERPROFILE, 'Documents');
    const files = [];
    try {
      const items = fs.readdirSync(docsPath);
      items.forEach(item => {
        const ext = path.extname(item).toLowerCase();
        if (EDITABLE_EXTENSIONS.includes(ext)) {
          files.push({ name: item, path: path.join(docsPath, item), ext: ext, editable: true });
        }
      });
    } catch (err) { console.error('Error reading documents:', err); }
    return files;
  });

  ipcMain.handle('read-file-base64', async (_, p) => {
    try { return { data: fs.readFileSync(p).toString('base64'), success: true }; }
    catch (e) { return { data: null, success: false, error: e.message }; }
  });

  ipcMain.handle('copy-file', async (_, src, dst) => {
    try {
      if (fs.existsSync(dst)) {
        const dir = path.dirname(dst);
        const ext = path.extname(dst);
        const name = path.basename(dst, ext);
        let counter = 1;
        let ndst = dst;
        while (fs.existsSync(ndst)) { ndst = path.join(dir, `${name} (${counter})${ext}`); counter++; }
        dst = ndst;
      }
      const s = fs.statSync(src);
      if (s.isDirectory()) {
        const cpDir = (s, d) => {
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
          fs.readdirSync(s).forEach(f => {
            const sf = path.join(s, f); const df = path.join(d, f);
            if (fs.statSync(sf).isDirectory()) cpDir(sf, df); else fs.copyFileSync(sf, df);
          });
        };
        cpDir(src, dst);
      } else fs.copyFileSync(src, dst);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('move-file', async (_, src, dst) => {
    try {
      if (isProtectedPath(src)) return { success: false, error: 'Protected' };
      if (fs.existsSync(dst)) {
        const dir = path.dirname(dst);
        const ext = path.extname(dst);
        const name = path.basename(dst, ext);
        let counter = 1;
        let ndst = dst;
        while (fs.existsSync(ndst)) { ndst = path.join(dir, `${name} (${counter})${ext}`); counter++; }
        dst = ndst;
      }
      fs.renameSync(src, dst);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('rename-file', async (_, oldp, newp) => {
    try {
      if (isProtectedPath(oldp)) return { success: false, error: 'Protected' };
      if (oldp === newp) return { success: true };
      if (fs.existsSync(newp)) return { success: false, error: 'Exists' };
      fs.renameSync(oldp, newp);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('create-folder', async (_, p) => {
    try {
      if (fs.existsSync(p)) {
        const dir = path.dirname(p); const name = path.basename(p);
        let counter = 1; let np = p;
        while (fs.existsSync(np)) { np = path.join(dir, `${name} (${counter})`); counter++; }
        p = np;
      }
      fs.mkdirSync(p, { recursive: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('dialog-select-folder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Select Folder' });
    if (res.canceled || res.filePaths.length === 0) return null;
    return { path: res.filePaths[0] };
  });

  ipcMain.handle('get-drives-info', getDrivesInfo);
}

async function getDrivesInfo() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('powershell -NoProfile -Command "Get-Volume | Where-Object {$_.DriveLetter} | Select-Object DriveLetter, FileSystemLabel, Size, SizeRemaining | ConvertTo-Json"', (err, stdout) => {
      const drives = [];
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      let volInfo = {};
      try {
        if (stdout) {
          const vols = JSON.parse(stdout);
          (Array.isArray(vols) ? vols : [vols]).forEach(v => {
            if (v.DriveLetter) volInfo[v.DriveLetter] = { label: v.FileSystemLabel, size: v.Size, avail: v.SizeRemaining };
          });
        }
      } catch { }
      for (const l of letters) {
        const dp = l + ':\\';
        if (fs.existsSync(dp)) {
          const vi = volInfo[l];
          const label = vi && vi.label ? `${vi.label} (${l}:)` : `Local Disk (${l}:)`;
          drives.push({
            device: l + ':', description: label, size: vi ? parseInt(vi.size) : 0, available: vi ? parseInt(vi.avail) : 0
          });
        }
      }
      resolve({ success: true, drives });
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadURL(isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`);
  if (isDev) win.webContents.openDevTools();
  win.on('closed', () => (win = null));
}

app.on('ready', () => { registerIpcHandlers(); startPython(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (pyProcess) { pyProcess.kill(); pyProcess = null; } });
