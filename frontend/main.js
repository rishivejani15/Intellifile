const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { registerSystemRoots, getSystemRoots } = require('./system_roots');

const PROJECT_ROOT = path.join(__dirname, '..');

const DEFAULT_INDEXING_PREFS = {
  allowProtectedIndexing: false,
};

let indexingPreferences = { ...DEFAULT_INDEXING_PREFS };
let preferencesPath = null;

function loadIndexingPreferences() {
  try {
    if (!preferencesPath) {
      preferencesPath = path.join(app.getPath('userData'), 'intellifile-preferences.json');
    }
    if (!fs.existsSync(preferencesPath)) return;
    const raw = fs.readFileSync(preferencesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.allowProtectedIndexing === 'boolean') {
      indexingPreferences.allowProtectedIndexing = parsed.allowProtectedIndexing;
    }
  } catch (err) {
    console.warn('[Prefs] Failed to load preferences:', err.message || err);
  }
}

function saveIndexingPreferences() {
  try {
    if (!preferencesPath) {
      preferencesPath = path.join(app.getPath('userData'), 'intellifile-preferences.json');
    }
    fs.writeFileSync(preferencesPath, JSON.stringify(indexingPreferences, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Prefs] Failed to save preferences:', err.message || err);
  }
}

function getAllowProtectedIndexing() {
  return !!indexingPreferences.allowProtectedIndexing;
}

const venvCandidates = [
  path.join(PROJECT_ROOT,'backend', '.venv', 'Scripts', 'python.exe'),
  path.join(PROJECT_ROOT,'backend' ,'.venv', 'Scripts', 'python.exe'),
];

const PYTHON_EXECUTABLE = venvCandidates.find((p) => fs.existsSync(p))
  || (process.platform === 'win32' ? 'python' : 'python3');

if (!(venvCandidates.some((p) => fs.existsSync(p)))) {
  console.warn('[Python] No project venv found; falling back to system Python.');
}

console.log('[Python] Using executable:', PYTHON_EXECUTABLE);

const isDev = !app.isPackaged;

let logBuffer = [];
const MAX_LOG_LINES = 1000;

function appendLog(category, message, isError = false) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  const logEntry = { timestamp, category, message, isError };
  
  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-log', logEntry);
  }
}

// Override console methods to capture them
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function(...args) {
  originalConsoleLog.apply(console, args);
  if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[')) {
    const match = args[0].match(/^\[(.*?)\]/);
    if (match) {
      appendLog(match[1], args.join(' ').replace(/^\[.*?\]\s*/, ''));
    } else {
      appendLog('Main', args.join(' '));
    }
  } else {
    appendLog('Main', args.join(' '));
  }
};

console.error = function(...args) {
  originalConsoleError.apply(console, args);
  if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[')) {
    const match = args[0].match(/^\[(.*?)\]/);
    if (match) {
      appendLog(match[1], args.join(' ').replace(/^\[.*?\]\s*/, ''), true);
    } else {
      appendLog('Main', args.join(' '), true);
    }
  } else {
    appendLog('Main', args.join(' '), true);
  }
};

console.warn = function(...args) {
  originalConsoleWarn.apply(console, args);
  if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[')) {
    const match = args[0].match(/^\[(.*?)\]/);
    if (match) {
      appendLog(match[1], args.join(' ').replace(/^\[.*?\]\s*/, ''), true);
    } else {
      appendLog('Main', args.join(' '), true);
    }
  } else {
    appendLog('Main', args.join(' '), true);
  }
};

// Supported file extensions
const EDITABLE_EXTENSIONS = [
  '.py', '.js', '.java', '.cpp', '.c', '.go', '.txt', '.md', '.json', '.xml', 
  '.html', '.htm', '.css', '.scss', '.less', '.ts', '.jsx', '.tsx', '.docx', '.xlsx',
  '.csv', '.env', '.gitignore', '.yml', '.yaml', '.sql', '.sh', '.bash', '.ps1', '.bat', 
  '.log', '.ini', '.cfg', '.conf', '.toml', '.vue', '.svelte', '.h', '.hpp', '.cs', '.rs', '.rb', '.php'
];

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

function isSystemFile(filename, showHidden = false) {
  if (showHidden) return false;
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);
  // Explicitly allow important configuration files that start with a dot
  const ALLOWED_DOTFILES = ['.env', '.gitignore', '.antigravityignore', '.editorconfig'];
  if (ALLOWED_DOTFILES.includes(lower)) return false;
  return SYSTEM_FILES_TO_HIDE.includes(lower) ||
    SYSTEM_FOLDERS_TO_HIDE.includes(lower) ||
    SYSTEM_FILE_EXTENSIONS.includes(ext) || lower === 'desktop.ini' || lower === 'thumbs.db' || 
    (filename.startsWith('.') && !ALLOWED_DOTFILES.includes(lower));
}

let pyProcess;

let chatBackendProcess;

let syncServerProcess;

let pyReady = false;
let pythonReadyForIndexing = false;
let windowReadyForIndexing = false;
let pyBuffer = '';
let pendingRequests = new Map();  // requestId -> { resolve, timeout }
let requestCounter = 0;
let autoIndexRequested = false;
let indexInProgress = false;
let lastIndexMessage = '';
let lastIndexStatus = null;
let fileWatchers = new Map();
let directoryWatchers = new Map();
let fileContents = new Map();
let debounceTimers = new Map();
let directoryIndexTimers = new Map();

function sendToPython(payload, timeoutMs = 120000) {
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

function tryAutoIndex() {
  if (autoIndexRequested || indexInProgress) return;
  if (!pythonReadyForIndexing || !windowReadyForIndexing) return;
  triggerAutoIndex();
}

// Register system roots IPC handlers
try { registerSystemRoots(ipcMain); } catch (err) { console.warn('System roots handler not registered:', err); }

// System roots are now fetched on-demand via IPC handler only (no continuous polling)

app.on('will-quit', () => {
  for (const [directoryPath, watcher] of Array.from(directoryWatchers.entries())) {
    try { watcher.close(); } catch (e) { /* ignore */ }
    directoryWatchers.delete(directoryPath);
  }
});

function startWatchingFile(filePath) {
  if (!filePath) return;
  
  const normPath = filePath.toLowerCase();
  if (fileWatchers.has(normPath)) {
    console.log(`[Watcher] Already watching: ${filePath}`);
    return;
  }

  try {
    const chokidar = require('chokidar');
    console.log(`[Watcher] Starting watch: ${filePath}`);

    const watcher = chokidar.watch(filePath, {
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 }
    });

    watcher.on('change', (p) => {
      console.log(`[Watcher] Raw Change detected: ${p}`);
      const normP = p.toLowerCase().replace(/\//g, '\\');
      const extP = path.extname(p).toLowerCase();
      const isBinaryP = ['.docx', '.xlsx'].includes(extP);

      if (debounceTimers.has(normP)) {
        clearTimeout(debounceTimers.get(normP));
      }
      
      debounceTimers.set(normP, setTimeout(async () => {
        debounceTimers.delete(normP);
        console.log(`[Watcher] Processing debounced change for: ${p}`);

        try {
          if (!fs.existsSync(p)) return; // Handle rapid temp file deletions
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
          
          // Trigger immediate indexing for the modified file
          sendToPython({
            action: "index_file",
            file_path: p,
            allow_protected: getAllowProtectedIndexing(),
          }).catch(err => console.error(`[Watcher] Index trigger error:`, err));

          if (result && result.success) {
            fileContents.set(normP, currentVal);
            if (mainWindow && !mainWindow.isDestroyed()) {
              // Sync with VersionTimeline.js which expects 'version-updated' and { filePath }
              mainWindow.webContents.send('version-updated', {
                filePath: p,
                versionId: result.data?.version_id,
                summary: result.data?.summary,
                riskLevel: result.data?.risk_level
              });
            }
          }
        } catch (err) {
          console.error(`[Watcher] Update error: ${err.message}`);
        }
      }, 2500)); // 2.5-second debounce window to outlast MS Word's save process
    });

    watcher.on('unlink', (p) => {
      sendToPython({ action: 'delete_file', file_path: p }).then((res) => {
        if (res && res.error) {
          console.warn('[Watcher] Delete index failed:', res.error);
        }
      });
      stopWatchingFile(p);
    });

    fileWatchers.set(normPath, watcher);
    fileContents.set(normPath, '');
    console.log(`[Watcher] ✅ Watching: ${filePath}`);
  } catch (err) {
    console.error(`[Watcher] Error starting watch for ${filePath}:`, err);
  }
}

function stopWatchingFile(filePath) {
  if (!filePath) return;
  
  const normPath = filePath.toLowerCase();
  const watcher = fileWatchers.get(normPath);

  if (watcher) {
    watcher.close();
    fileWatchers.delete(normPath);
    fileContents.delete(normPath);
    if (debounceTimers.has(normPath)) {
      clearTimeout(debounceTimers.get(normPath));
      debounceTimers.delete(normPath);
    }
    console.log(`[Watcher] ✅ Stopped watching: ${filePath}`);
  }
}

function buildDirectoryItem(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return {
      name: path.basename(filePath),
      path: filePath,
      type: stats.isDirectory() ? 'folder' : 'file',
      ext,
      size: stats.size,
      modified: stats.mtimeMs,
      created: stats.birthtimeMs,
      accessed: stats.atimeMs,
      isDirectory: stats.isDirectory(),
    };
  } catch (err) {
    return null;
  }
}

function scheduleDirectoryReindex(directoryPath, reason) {
  if (!directoryPath) return;
  const normPath = path.resolve(directoryPath).toLowerCase();
  if (directoryIndexTimers.has(normPath)) {
    clearTimeout(directoryIndexTimers.get(normPath));
  }
  directoryIndexTimers.set(normPath, setTimeout(() => {
    directoryIndexTimers.delete(normPath);
    console.log(`[Index] Reindexing folder due to ${reason || 'change'}: ${directoryPath}`);
    sendToPython({ action: 'index', folder: directoryPath, allow_protected: getAllowProtectedIndexing() }, 1800000).then((res) => {
      if (res && res.error) {
        console.warn('[Index] Folder reindex failed:', res.error);
      }
    });
  }, 2000));
}

function broadcastDirectoryChange(directoryPath, payload) {
  const windows = require('electron').BrowserWindow.getAllWindows();
  for (const w of windows) {
    try {
      w.webContents.send('directory-changed', { directoryPath, ...payload });
    } catch (e) {
      // ignore
    }
  }
}

function startWatchingDirectory(directoryPath) {
  if (!directoryPath) return { success: false, error: 'Missing directory path.' };
  
  // Don't watch Windows system folders
  const upperPath = directoryPath.toUpperCase();
  if (upperPath.includes('\\WINDOWS') || upperPath.includes('\\PROGRAM FILES') || 
      upperPath.includes('\\PROGRAMDATA') || upperPath.includes('\\SYSTEM VOLUME INFORMATION')) {
    return { success: false, error: 'Cannot watch system folders.' };
  }
  
  const normPath = path.resolve(directoryPath).toLowerCase();
  if (directoryWatchers.has(normPath)) return { success: true };

  try {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(directoryPath, {
      ignoreInitial: true,
      depth: 0,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    });

    watcher.on('add', (filePath) => {
      const item = buildDirectoryItem(filePath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'add', item });
        if (item.type === 'file') {
          sendToPython({ action: 'index_file', file_path: filePath, allow_protected: getAllowProtectedIndexing() }).catch(() => {});
        }
      }
    });

    watcher.on('addDir', (dirPath) => {
      const item = buildDirectoryItem(dirPath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'add', item });
      }
      scheduleDirectoryReindex(directoryPath, 'dir-add');
    });

    watcher.on('change', (filePath) => {
      const item = buildDirectoryItem(filePath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'change', item });
        if (item.type === 'file') {
          sendToPython({ action: 'index_file', file_path: filePath, allow_protected: getAllowProtectedIndexing() }).catch(() => {});
        }
      }
    });

    watcher.on('unlink', (filePath) => {
      broadcastDirectoryChange(directoryPath, { action: 'unlink', filePath });
      sendToPython({ action: 'delete_file', file_path: filePath }).then((res) => {
        if (res && res.error) {
          console.warn('[Index] Delete index failed:', res.error);
        }
      });
    });

    watcher.on('unlinkDir', (dirPath) => {
      broadcastDirectoryChange(directoryPath, { action: 'unlink', filePath: dirPath });
      scheduleDirectoryReindex(directoryPath, 'dir-delete');
    });

    directoryWatchers.set(normPath, watcher);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function stopWatchingDirectory(directoryPath) {
  if (!directoryPath) return { success: true };
  const normPath = path.resolve(directoryPath).toLowerCase();
  const watcher = directoryWatchers.get(normPath);
  if (watcher) {
    try { watcher.close(); } catch (e) { /* ignore */ }
    directoryWatchers.delete(normPath);
  }
  if (directoryIndexTimers.has(normPath)) {
    clearTimeout(directoryIndexTimers.get(normPath));
    directoryIndexTimers.delete(normPath);
  }
  return { success: true };
}

function startPython() {
  const appDataDir = path.join(app.getPath('userData'), 'Intellifile');
  const pythonEnv = { ...process.env };
  if (!pythonEnv.IF_INDEX_SCOPE) {
    pythonEnv.IF_INDEX_SCOPE = 'all';
  }
  pythonEnv.IF_DATA_DIR = path.join(appDataDir, 'backend', 'data');
  pythonEnv.IF_MODELS_DIR = path.join(appDataDir, 'backend', 'models');

  if (isDev) {
    const scriptPath = path.join(__dirname, "../backend/engine_server.py");
    console.log('[Python] Starting engine from:', scriptPath);
    pyProcess = spawn(PYTHON_EXECUTABLE, [scriptPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: pythonEnv,
    });
  } else {
    const exePath = path.join(process.resourcesPath, "backend-dist", "engine", "engine.exe");
    console.log('[Python] Starting frozen engine from:', exePath);
    pyProcess = spawn(exePath, [], {
      cwd: path.join(process.resourcesPath, "backend-dist"),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: pythonEnv,
    });
  }

  pyProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.log("[PY stdout]", text.trim());

    // Check for readiness signal
    if (!pyReady && text.includes('IntelliFile Python Engine Ready')) {
      pyReady = true;
      pythonReadyForIndexing = true;
      console.log('[Python] ✅ Engine is ready — pyReady = true');
      tryAutoIndex();
    }

    // Buffer stdout and resolve pending requests when we get complete JSON lines
    pyBuffer += text;
    const lines = pyBuffer.split('\n');
    // Keep last (possibly incomplete) line in buffer
    pyBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const id = parsed._id;

        // Forward progress messages to the renderer
        if (parsed.type === 'progress') {
          lastIndexStatus = parsed;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('index-progress', parsed);
          }
        }

        if (id && pendingRequests.has(id)) {
          // Only resolve on final (non-progress) messages
          if (!parsed.type || parsed.type !== 'progress') {
            const { resolve, timeout } = pendingRequests.get(id);
            clearTimeout(timeout);
            pendingRequests.delete(id);
            resolve(parsed);
          }
        }
      } catch (e) {
        // Not valid JSON, ignore
        console.log("Not a valid json");
      }
    }
  });

  pyProcess.stderr.on("data", (data) => {
    console.error("[PY stderr]", data.toString().trim());
  });

  pyProcess.on("close", (code) => {
    console.log('[Python] ❌ Process exited with code:', code);
    pyReady = false;
    // Reject all pending requests
    for (const [id, { resolve, timeout }] of pendingRequests) {
      clearTimeout(timeout);
      resolve({ error: 'Python engine crashed' });
    }
    pendingRequests.clear();
  });
}

function triggerAutoIndex() {
  if (autoIndexRequested || indexInProgress) return;
  autoIndexRequested = true;
  indexInProgress = true;
  console.log('[Index] Auto-indexing started on app launch');
  sendToPython({ action: "index", allow_protected: getAllowProtectedIndexing() }, 1800000).then((res) => {
    indexInProgress = false;
    if (res && res.error) {
      console.warn('[Index] Auto-indexing failed:', res.error);
    } else {
      console.log('[Index] Auto-indexing completed');
    }
    notifyIndexComplete(res);
  });
}
// Start the chat backend (uvicorn) when requested. Encapsulated so callers
// can start it and handle errors; avoids calling an undefined function.
function startChatBackend() {
  try {
    if (chatBackendProcess && !chatBackendProcess.killed) {
      console.log('[ChatBackend] already running');
      return;
    }

    const appDataDir = path.join(app.getPath('userData'), 'Intellifile');
    const pythonEnv = { ...process.env };
    pythonEnv.IF_DATA_DIR = path.join(appDataDir, 'backend', 'data');
    pythonEnv.IF_MODELS_DIR = path.join(appDataDir, 'backend', 'models');

    if (isDev) {
      chatBackendProcess = spawn(PYTHON_EXECUTABLE, ['-m', 'uvicorn', 'backend.chat.backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: pythonEnv
      });
    } else {
      // For now, don't start the chat backend in prod if not packaged.
      // We will need a chat.exe similar to engine.exe.
      console.log('[ChatBackend] Prod mode - skipping chat backend for now unless chat.exe exists');
      return;
    }

    chatBackendProcess.stdout.on('data', (d) => console.log('[ChatBackend stdout]', d.toString().trim()));
    chatBackendProcess.stderr.on('data', (d) => console.error('[ChatBackend stderr]', d.toString().trim()));
    chatBackendProcess.on('close', (code) => {
      console.log('[ChatBackend] exited with code:', code);
      chatBackendProcess = null;
    });
    console.log('[ChatBackend] spawn initiated');
  } catch (err) {
    console.error('[ChatBackend] failed to start:', err && err.message ? err.message : err);
    chatBackendProcess = null;
  }
}

// Helper: check whether a TCP port is open on localhost
function isPortOpen(port, host = '127.0.0.1', timeout = 500) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    let called = false;
    const onDone = (isOpen) => {
      if (called) return;
      called = true;
      try { socket.destroy(); } catch (e) {}
      resolve(isOpen);
    };
    socket.setTimeout(timeout);
    socket.once('error', () => onDone(false));
    socket.once('timeout', () => onDone(false));
    socket.connect(port, host, () => onDone(true));
  });
}
// ── NLP Date Parser for search queries ──────────────────
function parseDateFromQuery(rawQuery) {
  const MONTHS = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };

  let query = rawQuery;
  let dateFrom = null;
  let dateTo = null;

  // Helper: build start/end of day timestamps
  const startOfDay = (y, m, d) => new Date(y, m, d, 0, 0, 0).getTime() / 1000;
  const endOfDay = (y, m, d) => new Date(y, m, d, 23, 59, 59).getTime() / 1000;
  const endOfMonth = (y, m) => new Date(y, m + 1, 0, 23, 59, 59).getTime() / 1000;
  const startOfMonth = (y, m) => new Date(y, m, 1, 0, 0, 0).getTime() / 1000;

  const monthPattern = Object.keys(MONTHS).join('|');

  // Pattern: "between <month> <year> and <month> <year>"
  const betweenRe = new RegExp(
    `between\\s+(${monthPattern})\\s*(\\d{4})\\s*and\\s+(${monthPattern})\\s*(\\d{4})`,
    'i'
  );
  let match = query.match(betweenRe);
  if (match) {
    const m1 = MONTHS[match[1].toLowerCase()];
    const y1 = parseInt(match[2]);
    const m2 = MONTHS[match[3].toLowerCase()];
    const y2 = parseInt(match[4]);
    dateFrom = startOfMonth(y1, m1);
    dateTo = endOfMonth(y2, m2);
    query = query.replace(match[0], '').trim();
  }

  // Pattern: "from/on/dated <day>th? <month> <year>" or "<month> <day>, <year>"
  if (!dateFrom && !dateTo) {
    // "from 19th june 2025" / "on 19 june 2025" / "dated 5th march 2025"
    const fromDayRe = new RegExp(
      `(?:from|on|dated|created|of)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s+(\\d{4})`,
      'i'
    );
    match = query.match(fromDayRe);
    if (match) {
      const day = parseInt(match[1]);
      const month = MONTHS[match[2].toLowerCase()];
      const year = parseInt(match[3]);
      dateFrom = startOfDay(year, month, day);
      dateTo = endOfDay(year, month, day);
      query = query.replace(match[0], '').trim();
    }
  }

  // Pattern: "<month> <day>, <year>" (e.g., "june 19, 2025")
  if (!dateFrom && !dateTo) {
    const mDayYearRe = new RegExp(
      `(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`,
      'i'
    );
    match = query.match(mDayYearRe);
    if (match) {
      const month = MONTHS[match[1].toLowerCase()];
      const day = parseInt(match[2]);
      const year = parseInt(match[3]);
      dateFrom = startOfDay(year, month, day);
      dateTo = endOfDay(year, month, day);
      query = query.replace(match[0], '').trim();
    }
  }

  // Pattern: "before <month> <year>" or "before <day> <month> <year>"
  if (!dateFrom && !dateTo) {
    const beforeMonthRe = new RegExp(
      `before\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${monthPattern})\\s+(\\d{4})`,
      'i'
    );
    match = query.match(beforeMonthRe);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      const year = parseInt(match[3]);
      if (match[1]) {
        dateTo = endOfDay(year, month, parseInt(match[1]));
      } else {
        dateTo = endOfMonth(year, month);
      }
      query = query.replace(match[0], '').trim();
    }
  }

  // Pattern: "after <month> <year>" or "after <day> <month> <year>"
  if (!dateFrom && !dateTo) {
    const afterMonthRe = new RegExp(
      `after\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${monthPattern})\\s+(\\d{4})`,
      'i'
    );
    match = query.match(afterMonthRe);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      const year = parseInt(match[3]);
      if (match[1]) {
        dateFrom = startOfDay(year, month, parseInt(match[1]));
      } else {
        dateFrom = startOfMonth(year, month);
      }
      query = query.replace(match[0], '').trim();
    }
  }

  // Pattern: "<month> <year>" (whole month, no day) or just "<month>"
  if (!dateFrom && !dateTo) {
    const monthYearRe = new RegExp(
      `(?:from|in|during|of)?\\s*(${monthPattern})(?:\\s+(\\d{4}))?\\b`,
      'i'
    );
    match = query.match(monthYearRe);
    if (match) {
      const month = MONTHS[match[1].toLowerCase()];
      const now = new Date();
      // If year is provided, use it, otherwise default to current year
      const year = match[2] ? parseInt(match[2]) : now.getFullYear();
      
      dateFrom = startOfMonth(year, month);
      dateTo = endOfMonth(year, month);
      query = query.replace(match[0], '').trim();
    }
  }

  // Pattern: "from/in/during <year>" or just "<year>"
  if (!dateFrom && !dateTo) {
    const yearOnlyRe = new RegExp(
      `(?:from|in|during|year|of)?\\s*\\b(19\\d{2}|20\\d{2})\\b`,
      'i'
    );
    match = query.match(yearOnlyRe);
    if (match) {
      const year = parseInt(match[1]);
      dateFrom = startOfDay(year, 0, 1);
      dateTo = endOfDay(year, 11, 31);
      query = query.replace(match[0], '').trim();
    }
  }

  // Relative dates: "yesterday", "last week", "last month", "today"
  if (!dateFrom && !dateTo) {
    const now = new Date();
    if (/\byesterday\b/i.test(query)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      dateFrom = startOfDay(d.getFullYear(), d.getMonth(), d.getDate());
      dateTo = endOfDay(d.getFullYear(), d.getMonth(), d.getDate());
      query = query.replace(/\byesterday\b/i, '').trim();
    } else if (/\btoday'?s?\b/i.test(query)) {
      dateFrom = startOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\btoday'?s?\b/i, '').trim();
    } else if (/\blast\s+week\b/i.test(query)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      dateFrom = startOfDay(d.getFullYear(), d.getMonth(), d.getDate());
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\blast\s+week\b/i, '').trim();
    } else if (/\blast\s+month\b/i.test(query)) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      dateFrom = startOfDay(d.getFullYear(), d.getMonth(), d.getDate());
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\blast\s+month\b/i, '').trim();
    } else if (/\bthis\s+month\b/i.test(query)) {
      dateFrom = startOfMonth(now.getFullYear(), now.getMonth());
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\bthis\s+month\b/i, '').trim();
    } else if (/\bthis\s+year\b/i.test(query)) {
      dateFrom = startOfDay(now.getFullYear(), 0, 1);
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\bthis\s+year\b/i, '').trim();
    }
  }

  // Clean up filler words left behind
  query = query.replace(/\b(containing|with|about|files?|from|created)\b/gi, ' ').replace(/\s+/g, ' ').trim();

  return {
    cleanQuery: (!query.trim() && (dateFrom || dateTo)) ? "" : (query.trim() || rawQuery.trim()),
    dateFrom: dateFrom ? Math.floor(dateFrom) : null,
    dateTo: dateTo ? Math.floor(dateTo) : null,
  };
}

ipcMain.handle('ingest-file', async (event, filePath) => {
  return sendToPython({ action: 'chat_ingest', file_path: filePath });
});

ipcMain.handle('chat-ingest-file', async (event, filePath) => {
  return sendToPython({ action: 'chat_ingest', file_path: filePath });
});

ipcMain.handle('chat', async (event, query) => {
  return sendToPython({ action: 'chat', query: query });
});

ipcMain.handle('chat-ask', async (event, query) => {
  return sendToPython({ action: 'chat', query: query });
});

ipcMain.handle('clear-faiss', async () => {
  return sendToPython({ action: 'chat_clear' });
});

ipcMain.handle("search", async (_, query) => {
  console.log('[IPC] search called, pyReady:', pyReady, 'query:', query);
  const { cleanQuery, dateFrom, dateTo } = parseDateFromQuery(query);
  console.log('[IPC] parsed date filter:', { cleanQuery, dateFrom, dateTo });
  return sendToPython({
    action: "search",
    query: cleanQuery,
    date_from: dateFrom,
    date_to: dateTo,
  });
});

ipcMain.handle("search-status", async () => {
  console.log('[IPC] search-status called, pyReady:', pyReady);
  return { 
    ready: pyReady, 
    indexing: indexInProgress,
    lastIndexMessage,
    lastIndexStatus 
  };
});

ipcMain.handle('indexing-preferences-get', async () => {
  return { ...indexingPreferences };
});

ipcMain.handle('indexing-preferences-set', async (_event, updates = {}) => {
  // Merge arbitrary preference keys and persist
  try {
    for (const k of Object.keys(updates)) {
      indexingPreferences[k] = updates[k];
    }
    saveIndexingPreferences();
  } catch (e) {
    console.warn('[Prefs] Failed to update preferences:', e && e.message ? e.message : e);
  }
  return { ...indexingPreferences };
});

ipcMain.handle("index-device", async (_event, options = {}) => {
  if (indexInProgress) {
    return { status: 'running' };
  }
  const allowProtected = typeof options.allowProtectedIndexing === 'boolean'
    ? options.allowProtectedIndexing
    : getAllowProtectedIndexing();
  indexInProgress = true;
  const result = await sendToPython({ action: "index", allow_protected: allowProtected }, 1800000);
  indexInProgress = false;
  notifyIndexComplete(result);
  return result;  // 30-min timeout for full device
});

ipcMain.handle('model-status', async () => {
  // Ask Python engine whether embedding model is loaded
  try {
    const res = await sendToPython({ action: 'model_status' }, 10000);
    return res || { loaded: false };
  } catch (e) {
    return { loaded: false, error: e && e.message ? e.message : String(e) };
  }
});

// Versioning via Python engine
ipcMain.handle('get-versions', async (_event, filePath) => {
  return sendToPython({
    action: 'get_versions',
    file_path: filePath,
  });
});

  // Download embedding/chat models (runs setup_offline.py with downloads enabled)
  ipcMain.handle('download-model', async () => {
    return new Promise((resolve) => {
      try {
        const scriptPath = path.join(__dirname, '..', 'backend', 'setup_offline.py');
        const env = { ...process.env, IF_ALLOW_MODEL_DOWNLOAD: '1' };
        // Prefer per-user models dir inside app userData
        env.IF_MODELS_DIR = path.join(app.getPath('userData'), 'models');
        const dl = spawn(PYTHON_EXECUTABLE, [scriptPath], {
          cwd: path.join(__dirname, '..'),
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        dl.stdout.on('data', (d) => {
          const s = d.toString();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model-download-log', s);
        });
        dl.stderr.on('data', (d) => {
          const s = d.toString();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model-download-log', s);
        });

        dl.on('close', (code) => {
          // If download succeeded, restart python engine and chat backend so new models load
          if (code === 0) {
            try {
              console.log('[ModelDownload] Restarting Python engine to load new models');
              if (pyProcess) {
                try { pyProcess.kill(); } catch (e) { /* ignore */ }
                pyProcess = null;
              }
              if (chatBackendProcess) {
                try { chatBackendProcess.kill(); } catch (e) { /* ignore */ }
                chatBackendProcess = null;
              }
              // Small delay to let OS release handles
              setTimeout(() => {
                startPython();
                startChatBackend();
              }, 800);
            } catch (e) {
              console.error('[ModelDownload] Failed to restart engine:', e);
            }
          }
          resolve({ success: code === 0, code });
        });
      } catch (e) {
        resolve({ success: false, error: e && e.message ? e.message : String(e) });
      }
    });
  });

ipcMain.handle('versions-list', async (_event, filePath) => {
  const result = await sendToPython({
    action: 'get_versions',
    file_path: filePath,
  });
  return result.success ? { ok: true, versions: result.data || [] } : { ok: false, versions: [], error: result.error };
});

ipcMain.handle('compare-versions', async (_event, payload) => {
  return sendToPython({
    action: 'compare_versions',
    file_path: payload.filePath || payload.file_path,
    version_a: payload.versionA || payload.version_a,
    version_b: payload.versionB || payload.version_b,
  });
});

ipcMain.handle('versions-compare', async (_event, payload) => {
  return sendToPython({
    action: 'compare_versions',
    file_path: payload.file_path,
    version_a: payload.version_a,
    version_b: payload.version_b,
  });
});

ipcMain.handle('restore-version', async (_event, payload) => {
  const result = await sendToPython({
    action: 'restore_version',
    file_path: payload.filePath || payload.file_path,
    version_id: payload.versionId || payload.version_id,
  });

  if (result && result.success && win && !win.isDestroyed()) {
    win.webContents.send('version-updated', {
      filePath: payload.filePath || payload.file_path,
      versionId: payload.versionId || payload.version_id,
      summary: 'Version restored',
      riskLevel: 'Low',
    });
  }

  return result;
});

ipcMain.handle('smart-cleanup', async (_event, filePath) => {
  return sendToPython({
    action: 'smart_cleanup',
    file_path: filePath,
  });
});

ipcMain.handle('smart-cleanup-versions', async (_event, filePath) => {
  return sendToPython({
    action: 'smart_cleanup',
    file_path: filePath,
  });
});

ipcMain.handle('versions-restore', async (_event, payload) => {
  return sendToPython({
    action: 'restore_version',
    file_path: payload.file_path,
    version_id: payload.version_id,
  });
});

ipcMain.handle('save-version', async (_event, payload) => {
  return sendToPython({
    action: 'save_version',
    file_path: payload.filePath || payload.file_path,
    old_content: payload.oldContent || payload.old_content || '',
    new_content: payload.newContent || payload.new_content || '',
  });
});

function isProtectedPath(filePath) {
  return PROTECTED_PATHS.some(pattern => pattern.test(filePath));
}

function emitArchiveProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('archive-progress', payload);
  }
}

function emitArchiveComplete(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('archive-complete', payload);
  }
}

function getAvailablePath(dirPath, baseName, ext) {
  let candidate = path.join(dirPath, `${baseName}${ext}`);
  if (!fs.existsSync(candidate)) return candidate;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${baseName} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

function compressToZip(sourcePath, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    let lastPct = -1;

    output.on('close', () => resolve({ bytes: archive.pointer() }));
    output.on('error', reject);
    archive.on('error', reject);

    archive.on('progress', (data) => {
      const totalBytes = data?.fs?.totalBytes || 0;
      const processedBytes = data?.fs?.processedBytes || 0;
      const totalEntries = data?.entries?.total || 0;
      const processedEntries = data?.entries?.processed || 0;

      let pct = null;
      if (totalBytes > 0) {
        pct = Math.min(100, Math.floor((processedBytes / totalBytes) * 100));
      } else if (totalEntries > 0) {
        pct = Math.min(100, Math.floor((processedEntries / totalEntries) * 100));
      }

      if (typeof pct === 'number' && pct !== lastPct) {
        lastPct = pct;
        onProgress?.(pct, data);
      }
    });

    archive.pipe(output);

    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      archive.directory(sourcePath, path.basename(sourcePath));
    } else {
      archive.file(sourcePath, { name: path.basename(sourcePath) });
    }

    archive.finalize();
  });
}

function resolveSafeExtractPath(destDir, entryPath) {
  const normalized = path.normalize(entryPath || '').replace(/^([A-Za-z]:)?[\\/]+/, '');
  const outputPath = path.join(destDir, normalized);
  const resolvedDest = path.resolve(destDir);
  const resolvedOut = path.resolve(outputPath);
  if (resolvedOut === resolvedDest) return outputPath;
  if (!resolvedOut.startsWith(resolvedDest + path.sep)) return null;
  return outputPath;
}

async function extractZip(zipPath, destDir, onProgress) {
  const directory = await unzipper.Open.file(zipPath);
  const total = directory.files?.length || 0;
  let processed = 0;

  const bump = () => {
    processed += 1;
    if (total > 0) {
      const pct = Math.min(100, Math.floor((processed / total) * 100));
      onProgress?.(pct, { processed, total });
    }
  };

  for (const entry of directory.files || []) {
    const safePath = resolveSafeExtractPath(destDir, entry.path);
    if (!safePath) {
      bump();
      continue;
    }

    if (entry.type === 'Directory') {
      fs.mkdirSync(safePath, { recursive: true });
      bump();
      continue;
    }

    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(safePath))
        .on('finish', resolve)
        .on('error', reject);
    });
    bump();
  }
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

function notifyIndexComplete(payload) {
  lastIndexStatus = null;
  const skipped = Number(payload?.data?.skipped_total || payload?.skipped_total || 0);
  if (payload && payload.error) {
    lastIndexMessage = `Indexing failed: ${payload.error}`;
  } else if (skipped > 0) {
    lastIndexMessage = `Index updated (skipped ${skipped} protected ${skipped === 1 ? 'item' : 'items'})`;
  } else {
    lastIndexMessage = 'Index updated';
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('index-complete', payload || {});
  }
}

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

  // ── Offline Setup & Logs IPC ──
  ipcMain.handle('get-logs', () => {
    return logBuffer;
  });

  ipcMain.handle('clear-logs', () => {
    logBuffer = [];
    return true;
  });

  ipcMain.handle('offline-setup-status', async () => {
    const appDataDir = path.join(app.getPath('userData'), 'Intellifile');
    const modelsDir = path.join(appDataDir, 'backend', 'models');
    // Check if models exist (at least one gguf and the sentence transformer folder)
    let hasChatModel = false;
    let hasEmbeddingModel = false;
    try {
      if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        hasChatModel = files.some(f => f.endsWith('.gguf'));
        hasEmbeddingModel = fs.existsSync(path.join(modelsDir, 'onnx-export')) || files.some(f => f.startsWith('models--BAAI'));
      }
    } catch (e) {
      console.warn('[Setup] Error checking models:', e.message);
    }
    const needed = !hasChatModel || !hasEmbeddingModel;
    return { needed, hasChatModel, hasEmbeddingModel };
  });

  let setupProcess = null;
  ipcMain.handle('offline-setup-run', async (event) => {
    if (setupProcess) return { success: false, error: 'Setup already running' };
    
    return new Promise((resolve) => {
      const appDataDir = path.join(app.getPath('userData'), 'Intellifile');
      let exePath;
      if (isDev) {
        exePath = PYTHON_EXECUTABLE;
      } else {
        exePath = path.join(process.resourcesPath, "backend-dist", "setup", "setup_offline.exe");
      }

      const args = isDev 
        ? [path.join(__dirname, "../backend/setup_offline.py"), "--appdata-dir", appDataDir, "--json"]
        : ["--appdata-dir", appDataDir, "--json"];

      setupProcess = spawn(exePath, args, {
        cwd: isDev ? path.join(__dirname, '..') : path.join(process.resourcesPath, "backend-dist")
      });

      setupProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('offline-setup-progress', parsed);
            }
          } catch (e) {
            console.log('[Setup Output]', line.trim());
          }
        }
      });

      setupProcess.stderr.on('data', (data) => {
        console.error('[Setup Error]', data.toString().trim());
      });

      setupProcess.on('close', (code) => {
        setupProcess = null;
        resolve({ success: code === 0 });
      });
    });
  });

  // IPC Handlers for file operations
  ipcMain.handle('list-directory', async (event, dirPath, options = {}) => {
    const showHidden = options?.showHidden || false;
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

      // Use async exists check
      try {
        await fs.promises.access(resolvedPath);
      } catch {
        console.warn('[list-directory] Path not found:', resolvedPath);
        return { items: [], error: 'Path not found' };
      }

      console.log('[list-directory] reading directory...');
      const fileList = await fs.promises.readdir(resolvedPath);
      console.log('[list-directory] found', fileList.length, 'items');

      // Process items in parallel using Promise.all for better performance
      const itemPromises = fileList
        .filter(item => !isSystemFile(item, showHidden))
        .map(async item => {
          try {
            const fullPath = path.join(resolvedPath, item);
            const stats = await fs.promises.stat(fullPath);
            const ext = path.extname(item).toLowerCase();
            const isEditable = EDITABLE_EXTENSIONS.includes(ext);
            const isProtected = isProtectedPath(fullPath);

            // Don't calculate folder size - it's too slow and blocks the UI
            // Just use 0 for directories, actual size for files
            const size = stats.isDirectory() ? 0 : stats.size;

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
        });

      const items = (await Promise.all(itemPromises))
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
       const stats = fs.statSync(filePath);
      // Limit to 50KB for preview
      if (stats.size > 50 * 1024) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(50 * 1024);
        fs.readSync(fd, buffer, 0, 50 * 1024, 0);
        fs.closeSync(fd);
        return { success: true, content: buffer.toString('utf-8') + '\n... (truncated)' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { content: null, success: false, error: err.message };
    }
  });

  // ── Sync: local file staging for cross-device sync
  ipcMain.handle('get-sync-files', async () => {
    try {
      const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
      if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
      const items = fs.readdirSync(syncDir).map(name => {
        try {
          const full = path.join(syncDir, name);
          const st = fs.statSync(full);
          return { name, path: full, size: st.size, modified: st.mtimeMs };
        } catch (e) { return null; }
      }).filter(Boolean);
      return { success: true, items };
    } catch (err) {
      console.error('[Sync] get-sync-files error:', err && err.message ? err.message : err);
      return { success: false, items: [], error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('select-files-for-sync', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections']
      });
      if (canceled || !filePaths || filePaths.length === 0) return { success: false, added: 0 };
      const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
      if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
      let added = 0;
      for (const src of filePaths) {
        const name = path.basename(src);
        let dest = path.join(syncDir, name);
        if (fs.existsSync(dest)) {
          const ext = path.extname(name);
          const base = path.basename(name, ext);
          let i = 1;
          while (fs.existsSync(dest)) {
            dest = path.join(syncDir, `${base} (${i})${ext}`);
            i++;
          }
        }
        fs.copyFileSync(src, dest);
        added++;
      }
      // notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync-files');
      return { success: true, added };
    } catch (err) {
      console.error('[Sync] select-files-for-sync error:', err && err.message ? err.message : err);
      return { success: false, added: 0, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('remove-sync-file', async (_event, fileName) => {
    try {
      const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
      const target = path.join(syncDir, fileName);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync-files');
      return { success: true };
    } catch (err) {
      console.error('[Sync] remove-sync-file error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
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


  // ── New File Creation ──
  ipcMain.handle('create-file', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const name = path.basename(filePath, ext);
        let counter = 1;
        let newPath = filePath;
        while (fs.existsSync(newPath)) {
          newPath = path.join(dir, `${name} (${counter})${ext}`);
          counter++;
        }
        filePath = newPath;
      }
      fs.writeFileSync(filePath, '', 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('compress-zip', async (_event, sourcePath) => {
    try {
      if (!sourcePath) return { success: false, error: 'Missing source path' };
      if (isProtectedPath(sourcePath)) {
        return { success: false, error: 'Cannot compress system files or folders' };
      }
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: 'Source path not found' };
      }

      const stats = fs.statSync(sourcePath);
      const dirPath = path.dirname(sourcePath);
      const baseName = stats.isDirectory()
        ? path.basename(sourcePath)
        : path.basename(sourcePath, path.extname(sourcePath));
      const destPath = getAvailablePath(dirPath, baseName, '.zip');

      emitArchiveProgress({ action: 'compress', path: sourcePath, pct: 0 });
      await compressToZip(sourcePath, destPath, (pct) => {
        emitArchiveProgress({ action: 'compress', path: sourcePath, pct });
      });
      emitArchiveComplete({ action: 'compress', success: true, path: sourcePath, outputPath: destPath, pct: 100 });
      return { success: true, path: destPath };
    } catch (err) {
      emitArchiveComplete({ action: 'compress', success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extract-zip', async (_event, zipPath) => {
    try {
      if (!zipPath) return { success: false, error: 'Missing zip path' };
      if (!fs.existsSync(zipPath)) {
        return { success: false, error: 'Zip file not found' };
      }
      if (path.extname(zipPath).toLowerCase() !== '.zip') {
        return { success: false, error: 'Only .zip files are supported' };
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        defaultPath: path.dirname(zipPath),
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const destDir = result.filePaths[0];
      fs.mkdirSync(destDir, { recursive: true });
      emitArchiveProgress({ action: 'extract', path: zipPath, pct: 0 });
      await extractZip(zipPath, destDir, (pct) => {
        emitArchiveProgress({ action: 'extract', path: zipPath, pct });
      });
      emitArchiveComplete({ action: 'extract', success: true, path: zipPath, destination: destDir, pct: 100 });
      return { success: true, destination: destDir };
    } catch (err) {
      emitArchiveComplete({ action: 'extract', success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ── Open With (native dialog) ──
  ipcMain.handle('open-with', async (event, filePath) => {
    try {
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`rundll32 shell32.dll,OpenAs_RunDLL "${filePath}"`);
        return { success: true };
      } else {
        await shell.openPath(filePath);
        return { success: true };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Get File Details (extended metadata) ──
  ipcMain.handle('get-file-details', async (event, filePath) => {
    try {
      const stats = fs.statSync(filePath);
      const details = {
        name: path.basename(filePath),
        path: filePath,
        ext: path.extname(filePath).toLowerCase(),
        size: stats.size,
        isDirectory: stats.isDirectory(),
        created: stats.birthtimeMs,
        modified: stats.mtimeMs,
        accessed: stats.atimeMs,
        isReadOnly: false,
        isHidden: false,
        itemCount: 0
      };

      // Check attributes on Windows
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const escapedPath = filePath.replace(/'/g, "''");
          const output = execSync(
            `powershell -NoProfile -Command "(Get-Item -LiteralPath '${escapedPath}' -Force).Attributes"`,
            { timeout: 3000, encoding: 'utf-8' }
          ).trim();
          details.isReadOnly = output.includes('ReadOnly');
          details.isHidden = output.includes('Hidden');
          details.attributes = output;
        } catch (e) {
          // Non-critical, ignore
        }
      }

      // Get item count for directories
      if (stats.isDirectory()) {
        try {
          const children = fs.readdirSync(filePath);
          details.itemCount = children.length;
          // Calculate folder size asynchronously-safe
          details.size = calculateFolderSize(filePath);
        } catch (e) {
          details.itemCount = 0;
        }
      }

      return { success: true, details };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-file-attributes', async (_event, payload) => {
    const filePath = payload?.filePath || payload?.path;
    const readOnly = !!payload?.readOnly;
    const hidden = !!payload?.hidden;

    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        const quotedPath = `"${String(filePath).replace(/"/g, '\\"')}"`;
        const commands = [
          `attrib ${readOnly ? '+r' : '-r'} ${quotedPath}`,
          `attrib ${hidden ? '+h' : '-h'} ${quotedPath}`,
        ];
        commands.forEach((command) => execSync(command, { encoding: 'utf8', shell: true }));
      } else {
        const { execSync } = require('child_process');
        const stats = fs.statSync(filePath);
        const mode = stats.mode;
        if (readOnly) {
          fs.chmodSync(filePath, mode & ~0o222);
        } else {
          fs.chmodSync(filePath, mode | 0o200);
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-file-security', async (_event, filePath) => {
    try {
      const result = {
        success: true,
        security: {
          owner: null,
          group: null,
          access: [],
          isFolder: false,
        },
      };

      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const escapedPath = String(filePath).replace(/'/g, "''");
          const output = execSync(
            `powershell -NoProfile -Command "$acl = Get-Acl -LiteralPath '${escapedPath}'; $acl | Select-Object Owner,Group,@{Name='Access';Expression={@($acl.Access | Select-Object IdentityReference,FileSystemRights,AccessControlType,IsInherited,InheritanceFlags,PropagationFlags)}} | ConvertTo-Json -Depth 4"`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();

          if (output) {
            const parsed = JSON.parse(output);
            const access = parsed?.Access ? (Array.isArray(parsed.Access) ? parsed.Access : [parsed.Access]) : [];
            result.security = {
              owner: parsed?.Owner || null,
              group: parsed?.Group || null,
              access,
              isFolder: fs.existsSync(filePath) ? fs.statSync(filePath).isDirectory() : false,
            };
          }
        } catch (_error) {
          // best effort only
        }
      }

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-file-sharing-info', async (_event, filePath) => {
    try {
      const sharing = {
        success: true,
        info: {
          isNetworkPath: /^\\\\/.test(String(filePath)),
          shares: [],
          sharedName: null,
          sharedPath: null,
        },
      };

      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const output = execSync(
            `powershell -NoProfile -Command "@(Get-CimInstance Win32_Share -ErrorAction SilentlyContinue | Select-Object Name,Path,Description,Type) | ConvertTo-Json -Depth 3"`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();

          if (output) {
            const parsed = JSON.parse(output);
            const shares = Array.isArray(parsed) ? parsed : [parsed];
            const normalized = path.resolve(filePath).toLowerCase();
            const matchingShares = shares.filter((share) => {
              if (!share?.Path) return false;
              const sharePath = path.resolve(share.Path).toLowerCase();
              return normalized === sharePath || normalized.startsWith(`${sharePath}${path.sep}`);
            });
            sharing.info.shares = matchingShares;
            if (matchingShares.length > 0) {
              sharing.info.sharedName = matchingShares[0].Name || null;
              sharing.info.sharedPath = matchingShares[0].Path || null;
            }
          }
        } catch (_error) {
          // best effort only
        }
      }

      return sharing;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-native-properties', async (_event, filePath) => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Native properties dialog is only supported on Windows.' };
      }

      const { exec } = require('child_process');
      const escapedPath = String(filePath).replace(/'/g, "''");
      exec(
        `powershell -NoProfile -Command "$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace((Split-Path -LiteralPath '${escapedPath}' -Parent)); if ($folder) { $item = $folder.ParseName((Split-Path -LiteralPath '${escapedPath}' -Leaf)); if ($item) { $item.InvokeVerb('properties') } }"`
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('watch-directory', async (_event, directoryPath) => {
    return startWatchingDirectory(directoryPath);
  });

  ipcMain.handle('unwatch-directory', async (_event, directoryPath) => {
    return stopWatchingDirectory(directoryPath);
  });

  // ── Open Terminal Here ──
  ipcMain.handle('open-terminal-here', async (event, dirPath) => {
    try {
      const { exec } = require('child_process');
      if (process.platform === 'win32') {
        exec(`start powershell -NoExit -Command "Set-Location '${dirPath.replace(/'/g, "''")}'"`);
      } else if (process.platform === 'darwin') {
        exec(`open -a Terminal "${dirPath}"`);
      } else {
        exec(`x-terminal-emulator --working-directory="${dirPath}"`);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Open in VS Code ──
  ipcMain.handle('open-in-vscode', async (event, targetPath) => {
    try {
      const { exec } = require('child_process');
      exec(`code "${targetPath}"`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Copy Path to Clipboard ──
  ipcMain.handle('copy-to-clipboard', async (event, text) => {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Image Thumbnail ──
  ipcMain.handle('get-thumbnail', async (event, filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg'];
      if (!imageExts.includes(ext)) {
        return { success: false, error: 'Not an image file' };
      }
      // Read image and resize for thumbnail
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { success: false, error: 'Could not load image' };
      }
      const thumbnail = image.resize({ width: 120, height: 120, quality: 'good' });
      const dataUrl = thumbnail.toDataURL();
      return { success: true, dataUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
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
                name: description,
                label: volInfo && volInfo.label ? volInfo.label : null,
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

  // Set win for version watching
  win = mainWindow;

  const prodIndexPath = path.join(__dirname, 'build', 'index.html');
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${prodIndexPath}`;

  if (!isDev && !fs.existsSync(prodIndexPath)) {
    console.error('[UI] build/index.html not found at:', prodIndexPath);
    const missingHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>IntelliFile - UI Missing</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
      code { background: #f3f3f3; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h2>UI build not found</h2>
    <p>The production UI files are missing.</p>
    <p>Run <code>npm run build</code> inside the <code>frontend</code> folder, then relaunch the app.</p>
  </body>
</html>`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(missingHtml)}`);
  } else {
    mainWindow.loadURL(startUrl);
  }

  // Trigger auto-indexing once window is ready and Python is ready
  mainWindow.webContents.on('did-finish-load', () => {
    windowReadyForIndexing = true;
    console.log('[Window] Ready for indexing');
    tryAutoIndex();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    win = null;
  });

}

app.on('ready', () => {
  loadIndexingPreferences();
  registerIpcHandlers();
  startPython();
  startChatBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Stop all file watchers
  for (const [filePath, watcher] of fileWatchers) {
    watcher.close();
  }
  fileWatchers.clear();
  fileContents.clear();
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  for (const timer of directoryIndexTimers.values()) {
    clearTimeout(timer);
  }
  directoryIndexTimers.clear();

  if (pyProcess) {
    console.log('[Python] Killing engine process');
    pyProcess.kill();
    pyProcess = null;
  }

  if (chatBackendProcess) {
    console.log('[ChatBackend] Killing API process');
    chatBackendProcess.kill();
    chatBackendProcess = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
