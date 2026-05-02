const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');

const PROJECT_ROOT = path.join(__dirname, '..');

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

function isSystemFile(filename, showHidden = false) {
  if (showHidden) return false;
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);

  return SYSTEM_FILES_TO_HIDE.includes(lower) ||
    SYSTEM_FOLDERS_TO_HIDE.includes(lower) ||
    SYSTEM_FILE_EXTENSIONS.includes(ext) ||
    lower === 'desktop.ini' ||
    lower === 'thumbs.db' ||
    filename.startsWith('.');
}

let pyProcess;
let chatBackendProcess;
let pyReady = false;
let pyBuffer = '';
let pendingRequests = new Map();  // requestId -> { resolve, timeout }
let requestCounter = 0;
let autoIndexRequested = false;
let indexInProgress = false;
let fileWatchers = new Map();
let fileContents = new Map();
let debounceTimers = new Map();
const CHAT_BACKEND_URL = 'http://127.0.0.1:8000';

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

    watcher.on('unlink', (p) => stopWatchingFile(p));

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

function startPython() {
  const scriptPath = path.join(__dirname, "../backend/engine_server.py");
  console.log('[Python] Starting engine from:', scriptPath);

  const pythonEnv = { ...process.env };
  if (!pythonEnv.IF_INDEX_SCOPE) {
    pythonEnv.IF_INDEX_SCOPE = 'all';
  }

  pyProcess = spawn(PYTHON_EXECUTABLE, [scriptPath], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: pythonEnv,
  });

  pyProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.log("[PY stdout]", text.trim());

    // Check for readiness signal
    if (!pyReady && text.includes('IntelliFile Python Engine Ready')) {
      pyReady = true;
      console.log('[Python] ✅ Engine is ready — pyReady = true');
      triggerAutoIndex();
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
        if (parsed.type === 'progress' && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('index-progress', parsed);
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
  sendToPython({ action: "index" }, 1800000).then((res) => {
    indexInProgress = false;
    if (res && res.error) {
      console.warn('[Index] Auto-indexing failed:', res.error);
    } else {
      console.log('[Index] Auto-indexing completed');
    }
    notifyIndexComplete(res);
  });
}

function startChatBackend() {
  const scriptPath = path.join(__dirname, '../backend/chat/backend/main.py');
  console.log('[ChatBackend] Starting API from:', scriptPath);

  chatBackendProcess = spawn(PYTHON_EXECUTABLE, ['-m', 'uvicorn', 'backend.chat.backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  chatBackendProcess.stdout.on('data', (data) => {
    console.log('[ChatBackend stdout]', data.toString().trim());
  });

  chatBackendProcess.stderr.on('data', (data) => {
    console.error('[ChatBackend stderr]', data.toString().trim());
  });

  chatBackendProcess.on('close', (code) => {
    console.log('[ChatBackend] Process exited with code:', code);
    chatBackendProcess = null;
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

  // Pattern: "<month> <year>" (whole month, no day)
  if (!dateFrom && !dateTo) {
    const monthYearRe = new RegExp(
      `(?:from|in|during)?\\s*(${monthPattern})\\s+(\\d{4})`,
      'i'
    );
    match = query.match(monthYearRe);
    if (match) {
      const month = MONTHS[match[1].toLowerCase()];
      const year = parseInt(match[2]);
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
    } else if (/\btoday\b/i.test(query)) {
      dateFrom = startOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      dateTo = endOfDay(now.getFullYear(), now.getMonth(), now.getDate());
      query = query.replace(/\btoday\b/i, '').trim();
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
    cleanQuery: query || rawQuery,  // Fallback to original if cleaning empties it
    dateFrom: dateFrom ? Math.floor(dateFrom) : null,
    dateTo: dateTo ? Math.floor(dateTo) : null,
  };
}

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
  return { ready: pyReady };
});

ipcMain.handle("index-device", async () => {
  if (indexInProgress) {
    return { status: 'running' };
  }
  indexInProgress = true;
  const result = await sendToPython({ action: "index" }, 1800000);
  indexInProgress = false;
  notifyIndexComplete(result);
  return result;
});

ipcMain.handle('chat-ask', async (_event, query) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/ask`, { query, top_k: 5 });
    return response.data;
  } catch (err) {
    return { ok: false, answer: `Chat request failed: ${err.message || 'unknown error'}` };
  }
});

ipcMain.handle('chat-status', async () => {
  try {
    const response = await axios.get(`${CHAT_BACKEND_URL}/chat/status`, { timeout: 5000 });
    return response.data;
  } catch (err) {
    return {
      enabled: false,
      mode: 'none',
      reason: `Chat backend unavailable: ${err.message || 'unknown error'}`,
    };
  }
});

ipcMain.on('chat-stream-start', async (event, query) => {
  try {
    const response = await axios({
      method: 'post',
      url: `${CHAT_BACKEND_URL}/chat`,
      data: { query, top_k: 5 },
      responseType: 'stream'
    });

    let fullAnswer = '';
    response.data.on('data', (chunk) => {
      const token = chunk.toString();
      fullAnswer += token;
      event.reply('chat-stream-token', token);
    });

    response.data.on('end', () => {
      event.reply('chat-stream-done', fullAnswer);
    });

    response.data.on('error', () => {
      event.reply('chat-stream-error', 'Stream interrupted.');
    });
  } catch (err) {
    event.reply('chat-stream-error', err.message || 'Failed to stream chat response.');
  }
});

ipcMain.handle('chat-ingest-file', async (_event, filePath) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/chat/ingest`, { file_path: filePath });
    return response.data;
  } catch (err) {
    return { ok: false, error: `File ingest failed: ${err.message || 'unknown error'}` };
  }
});

// Backward-compatible channel for ChatSidebar.jsx
ipcMain.handle('ingest-file', async (_event, filePath) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/chat/ingest`, { file_path: filePath });
    return response.data;
  } catch (err) {
    return { ok: false, error: `File ingest failed: ${err.message || 'unknown error'}` };
  }
});

ipcMain.handle('versions-list', async (_event, filePath) => {
  try {
    const response = await axios.get(`${CHAT_BACKEND_URL}/versions`, {
      params: { file_path: filePath }
    });
    return response.data;
  } catch (err) {
    return { ok: false, versions: [], error: err.message || 'Failed to load versions.' };
  }
});

// Backward-compatible channel for versionService.js
ipcMain.handle('get-versions', async (_event, filePath) => {
  try {
    const response = await axios.get(`${CHAT_BACKEND_URL}/versions`, {
      params: { file_path: filePath }
    });
    return { success: true, data: response.data?.versions || [] };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to load versions.', data: [] };
  }
});

ipcMain.handle('versions-compare', async (_event, payload) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/versions/compare`, payload);
    return response.data;
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to compare versions.' };
  }
});

// Backward-compatible channel for versionService.js and VersionTimeline.js
ipcMain.handle('compare-versions', async (_event, payload) => {
  try {
    const body = {
      file_path: payload.filePath || payload.file_path,
      version_a: payload.versionA || payload.version_a,
      version_b: payload.versionB || payload.version_b,
    };
    const response = await axios.post(`${CHAT_BACKEND_URL}/versions/compare`, body);
    return { success: true, data: response.data };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to compare versions.' };
  }
});

ipcMain.handle('versions-restore', async (_event, payload) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/versions/restore`, payload);
    return response.data;
  } catch (err) {
    return { success: false, error: err.message || 'Failed to restore version.' };
  }
});

// Backward-compatible channel for versionService.js
ipcMain.handle('restore-version', async (_event, payload) => {
  try {
    const body = {
      file_path: payload.filePath || payload.file_path,
      version_id: payload.versionId || payload.version_id,
    };
    const response = await axios.post(`${CHAT_BACKEND_URL}/versions/restore`, body);
    return response.data;
  } catch (err) {
    return { success: false, error: err.message || 'Failed to restore version.' };
  }
});

// Save snapshot without rollback by ingesting path-based file.
ipcMain.handle('save-version', async (_event, payload) => {
  try {
    const filePath = payload.filePath || payload.file_path;
    const response = await axios.post(`${CHAT_BACKEND_URL}/upload_path`, { file_path: filePath });
    return { success: true, data: response.data };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to save version.' };
  }
});

// Legacy chat call expected by ChatSidebar.jsx
ipcMain.handle('chat', async (_event, query) => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/ask`, { query, top_k: 5 });
    return response.data?.answer || '';
  } catch (err) {
    return `Chat request failed: ${err.message || 'unknown error'}`;
  }
});

// Legacy clear request from ChatSidebar.jsx; keep as no-op for compatibility.
ipcMain.handle('clear-faiss', async () => {
  try {
    const response = await axios.post(`${CHAT_BACKEND_URL}/chat/reset`);
    return { success: true, ...(response.data || {}) };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to clear chat store.' };
  }
});



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

function notifyIndexComplete(payload) {
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
