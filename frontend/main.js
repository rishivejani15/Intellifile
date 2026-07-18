const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeImage } = require('electron');
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const { autoUpdater } = require('electron-updater');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { registerSystemRoots, getSystemRoots } = require('./system_roots');
const { SyncEngine } = require('./sync_engine');

const PROJECT_ROOT = path.join(__dirname, '..');

// Single-instance lock and path arguments handling
let startupPathPayload = null;

function getPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  console.log('[ArgvDebug] getPathFromArgv input:', argv);

  const cleanArg = (str) => {
    if (!str) return '';
    let s = str.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.substring(1, s.length - 1).trim();
    }
    if (s.startsWith("'") && s.endsWith("'")) {
      s = s.substring(1, s.length - 1).trim();
    }
    return s;
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = cleanArg(argv[i]);
    if (!arg) continue;

    let targetPath = null;
    const lowerArg = arg.toLowerCase();

    if (lowerArg === '/select' || lowerArg === '--select') {
      if (i + 1 < argv.length) {
        targetPath = cleanArg(argv[i + 1]);
      }
    } else if (lowerArg.startsWith('/select,') || lowerArg.startsWith('--select,')) {
      const commaIndex = arg.indexOf(',');
      if (commaIndex !== -1) {
        targetPath = cleanArg(arg.substring(commaIndex + 1));
      }
    } else if (lowerArg.startsWith('/select:') || lowerArg.startsWith('--select:')) {
      const colonIndex = arg.indexOf(':');
      if (colonIndex !== -1) {
        targetPath = cleanArg(arg.substring(colonIndex + 1));
      }
    } else if (lowerArg.startsWith('/select') || lowerArg.startsWith('--select')) {
      const rest = arg.substring(7).trim();
      if (rest.startsWith(',') || rest.startsWith(':')) {
        targetPath = cleanArg(rest.substring(1));
      } else {
        targetPath = cleanArg(rest);
      }
    }

    if (targetPath) {
      try {
        if (path.isAbsolute(targetPath) && fs.existsSync(targetPath)) {
          console.log('[ArgvDebug] Found select path:', targetPath);
          return targetPath;
        }
      } catch (e) { }
      try {
        const normalized = path.normalize(targetPath);
        if (path.isAbsolute(normalized) && fs.existsSync(normalized)) {
          console.log('[ArgvDebug] Found select path (normalized):', normalized);
          return normalized;
        }
      } catch (e) { }
    }
  }

  // Fallback: search for any absolute path that exists
  for (let i = argv.length - 1; i >= 0; i--) {
    let arg = cleanArg(argv[i]);
    if (!arg) continue;
    if (arg.startsWith('-')) continue;
    if (arg === '.' || arg.endsWith('main.js') || arg.toLowerCase().endsWith('electron.exe') || arg.toLowerCase().endsWith('electron')) continue;

    try {
      if (path.isAbsolute(arg) && fs.existsSync(arg)) {
        console.log('[ArgvDebug] Fallback found absolute path:', arg);
        return arg;
      }
      // Extra: try to extract a Windows path embedded inside the argument (handles odd quoting)
      try {
        const winPathRegex = /[A-Za-z]:\\[^"\s]*/g;
        const matches = arg.match(winPathRegex);
        if (matches && matches.length) {
          for (const m of matches) {
            const candidate = m;
            if (fs.existsSync(candidate)) {
              console.log('[ArgvDebug] Extracted embedded path from arg:', candidate);
              return candidate;
            }
          }
        }
      } catch (e) { /* ignore */ }
      // Extra: handle file:// URIs
      try {
        const lower = arg.toLowerCase();
        if (lower.startsWith('file:///')) {
          let p = arg.substring('file:///'.length);
          p = decodeURIComponent(p);
          p = p.replace(/\//g, path.sep);
          if (fs.existsSync(p)) {
            console.log('[ArgvDebug] Extracted file URI path:', p);
            return p;
          }
        }
        // Handle any Windows-style or generic file: URI variants
        if (lower.startsWith('file:')) {
          let p = arg.substring('file:'.length);
          // Remove leading slashes or backslashes (file:/// or file:\\\\)
          p = p.replace(/^[/\\\\]+/, '');
          p = decodeURIComponent(p);
          p = p.replace(/[\\/]+/g, path.sep);
          if (fs.existsSync(p)) {
            console.log('[ArgvDebug] Extracted generic file URI path:', p);
            return p;
          }
        }
      } catch (e) { /* ignore */ }
    } catch (e) { }
  }

  console.log('[ArgvDebug] No path found in argv');
  return null;
}

function resolvePathToOpen(targetPath) {
  if (!targetPath) return null;
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      // SMART HEURISTIC: Guess the file if this was a Chrome 'Show in folder'
      let guessedFile = null;
      try {
        const files = fs.readdirSync(targetPath);
        let maxTime = 0;
        const now = Date.now();
        for (const f of files) {
          try {
            const fPath = path.join(targetPath, f);
            const fStats = fs.statSync(fPath);
            if (!fStats.isDirectory() && fStats.mtimeMs > maxTime) {
              maxTime = fStats.mtimeMs;
              guessedFile = f;
            }
          } catch (e) { }
        }
        if (guessedFile) {
          console.log('[Heuristic] Guessed recently downloaded file on startup:', guessedFile);
          return { path: targetPath, selectFile: guessedFile };
        }
      } catch (e) { }
      return { path: targetPath, selectFile: null };
    } else {
      return { path: path.dirname(targetPath), selectFile: path.basename(targetPath) };
    }
  } catch (e) {
    try {
      const parent = path.dirname(targetPath);
      if (fs.existsSync(parent)) {
        return { path: parent, selectFile: path.basename(targetPath) };
      }
    } catch (err) { }
    return null;
  }
}

function checkIsDefaultFileManager() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(false);
    }
    const appExe = app.getPath('exe');
    const cmd = `reg query "HKEY_CURRENT_USER\\Software\\Classes\\Folder\\shell\\open\\command" /ve`;
    const { exec } = require('child_process');
    exec(cmd, (err, stdout) => {
      if (err) {
        return resolve(false);
      }
      const isDefault = stdout.toLowerCase().includes(appExe.toLowerCase());
      if (isDefault) {
        // Silently sync and update the other registry keys to ensure they are on the latest setup with %1
        setDefaultFileManager(true).catch(() => { });
      }
      resolve(isDefault);
    });
  });
}

function setDefaultFileManager(enable) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ success: false, error: 'Platform not supported' });
    }
    const appExe = app.getPath('exe');
    const { exec } = require('child_process');

    if (enable) {
      // Build base command parts WITHOUT %1 — each registry entry adds %1 as needed
      const exeBase = isDev
        ? `"${appExe}" "${__dirname}"`
        : `"${appExe}"`;

      const script = `
$exeBase = '${exeBase}'

# Folder class – double-click a folder opens in IntelliFile
$p1 = 'HKCU:\\Software\\Classes\\Folder\\shell\\open\\command'
if (!(Test-Path $p1)) { New-Item -Path $p1 -Force | Out-Null }
Set-ItemProperty -Path $p1 -Name '(Default)' -Value "$exeBase ""%1"""
Set-ItemProperty -Path $p1 -Name 'DelegateExecute' -Value ''

$p2 = 'HKCU:\\Software\\Classes\\Folder\\shell\\explore\\command'
if (!(Test-Path $p2)) { New-Item -Path $p2 -Force | Out-Null }
Set-ItemProperty -Path $p2 -Name '(Default)' -Value "$exeBase ""%1"""
Set-ItemProperty -Path $p2 -Name 'DelegateExecute' -Value ''

# Directory class – handles Chrome "Show in folder" and similar
$dOpen = 'HKCU:\\Software\\Classes\\Directory\\shell\\open\\command'
if (!(Test-Path $dOpen)) { New-Item -Path $dOpen -Force | Out-Null }
Set-ItemProperty -Path $dOpen -Name '(Default)' -Value "$exeBase ""%1"""
Set-ItemProperty -Path $dOpen -Name 'DelegateExecute' -Value ''

$dExplore = 'HKCU:\\Software\\Classes\\Directory\\shell\\explore\\command'
if (!(Test-Path $dExplore)) { New-Item -Path $dExplore -Force | Out-Null }
Set-ItemProperty -Path $dExplore -Name '(Default)' -Value "$exeBase ""%1"""
Set-ItemProperty -Path $dExplore -Name 'DelegateExecute' -Value ''

# CLSID entry for "Open new window" taskbar context menu
$p3 = 'HKCU:\\Software\\Classes\\CLSID\\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}\\shell\\opennewwindow\\command'
if (!(Test-Path $p3)) { New-Item -Path $p3 -Force | Out-Null }
Set-ItemProperty -Path $p3 -Name '(Default)' -Value "$exeBase ""%1"""
Set-ItemProperty -Path $p3 -Name 'DelegateExecute' -Value ''
`;

      const buffer = Buffer.from(script, 'utf16le');
      const base64 = buffer.toString('base64');
      const fullCmd = `powershell -NoProfile -EncodedCommand ${base64}`;

      exec(fullCmd, (err) => {
        if (err) {
          console.error('[DefaultFileManager] Failed to write registry:', err);
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    } else {
      const disableScript = `
Remove-Item -Path 'HKCU:\\Software\\Classes\\Folder\\shell\\open' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\\Software\\Classes\\Folder\\shell\\explore' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\shell\\open' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\shell\\explore' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\\Software\\Classes\\CLSID\\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}' -Recurse -Force -ErrorAction SilentlyContinue
`;

      const buffer = Buffer.from(disableScript, 'utf16le');
      const base64 = buffer.toString('base64');
      const fullCmd = `powershell -NoProfile -EncodedCommand ${base64}`;

      exec(fullCmd, (err) => {
        if (err) {
          console.error('[DefaultFileManager] Failed to clean registry:', err);
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    }
  });
}

const rawStartupPath = getPathFromArgv(process.argv);
console.log('[ArgvDebug] Startup argv:', process.argv);
console.log('[ArgvDebug] Startup rawStartupPath:', rawStartupPath);
if (rawStartupPath) {
  const resolved = resolvePathToOpen(rawStartupPath);
  startupPathPayload = resolved;
  console.log('[ArgvDebug] Startup payload resolved:', startupPathPayload);
}
app.on('second-instance', (event, commandLine) => {
  console.log('[ArgvDebug] second-instance triggered, commandLine:', commandLine);

  // DEBUG HACK: write the commandLine to a file so we can see what Windows actually passed
  require('fs').appendFileSync(require('path').join(__dirname, 'second-instance-debug.txt'), new Date().toISOString() + ': ' + JSON.stringify(commandLine) + '\n');

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    // Force window to foreground on Windows
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);

    const rawPath = getPathFromArgv(commandLine);
    console.log('[ArgvDebug] second-instance rawPath parsed:', rawPath);
    if (rawPath) {
      let payload = null;
      try {
        const stats = fs.statSync(rawPath);
        if (stats.isDirectory()) {
          // SMART HEURISTIC for Chrome 'Show in folder' fallback:
          // Because Windows strips the file name, we only get the folder path.
          // We can guess the file by finding the most recently modified file (within the last 2 minutes).
          let guessedFile = null;
          try {
            const files = fs.readdirSync(rawPath);
            let maxTime = 0;
            const now = Date.now();
            for (const f of files) {
              try {
                const fPath = require('path').join(rawPath, f);
                const fStats = fs.statSync(fPath);
                if (!fStats.isDirectory() && fStats.mtimeMs > maxTime) {
                  maxTime = fStats.mtimeMs;
                  guessedFile = f;
                }
              } catch (e) { } // ignore locked files
            }
            // Only auto-select the guessed file if it was modified recently
            const GUESS_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
            if (guessedFile && (Date.now() - maxTime) <= GUESS_WINDOW_MS) {
              console.log('[Heuristic] Guessed recently downloaded file:', guessedFile, 'ageMs=', Date.now() - maxTime);
              payload = { path: rawPath, selectFile: guessedFile };
            } else {
              console.log('[Heuristic] Not confident to auto-select file (guessedFile=', guessedFile, 'ageMs=', guessedFile ? (Date.now() - maxTime) : 'N/A', ') - showing recent chooser');
              payload = { path: rawPath, selectFile: null };
            }
          } catch (e) {
            payload = { path: rawPath, selectFile: null };
          }
        } else {
          payload = { path: path.dirname(rawPath), selectFile: path.basename(rawPath) };
        }
      } catch (e) {
        payload = { path: rawPath, selectFile: null };
      }
      console.log('[ArgvDebug] second-instance payload resolved:', payload);
      if (payload) {
        payload.fromExplorer = true;
        mainWindow.webContents.send('open-path', payload);
      }
    }
  }
});


const DEFAULT_INDEXING_PREFS = {
  allowProtectedIndexing: false,
  offlineSetupCompleted: false,
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

function getOfflineSetupMarkerPath() {
  return path.join(app.getPath('userData'), 'offline-setup.done');
}

function markOfflineSetupComplete() {
  try {
    fs.writeFileSync(getOfflineSetupMarkerPath(), 'ok', 'utf-8');
  } catch (err) {
    console.warn('[Setup] Failed to write offline setup marker:', err.message || err);
  }
}

function hasOfflineSetupCompleted() {
  try {
    return fs.existsSync(getOfflineSetupMarkerPath()) || !!indexingPreferences.offlineSetupCompleted;
  } catch (err) {
    return !!indexingPreferences.offlineSetupCompleted;
  }
}

function getLogFilePath() {
  return path.join(app.getPath('userData'), 'intellifile.log');
}

function persistLogEntry(logEntry) {
  try {
    const line = `[${logEntry.timestamp}] [${logEntry.category}]${logEntry.isError ? ' [ERROR]' : ''} ${logEntry.message}\n`;
    fs.appendFileSync(getLogFilePath(), line, 'utf-8');
  } catch (err) {
    originalConsoleWarn('[Logs] Failed to write log file:', err.message || err);
  }
}

const venvCandidates = [
  path.join(PROJECT_ROOT, 'backend', '.venv', 'Scripts', 'python.exe'),
  path.join(PROJECT_ROOT, 'backend', '.venv', 'Scripts', 'python.exe'),
];

const PYTHON_EXECUTABLE = venvCandidates.find((p) => fs.existsSync(p))
  || (process.platform === 'win32' ? 'python' : 'python3');

if (!(venvCandidates.some((p) => fs.existsSync(p)))) {
  console.warn('[Python] No project venv found; falling back to system Python.');
}

console.log('[Python] Using executable:', PYTHON_EXECUTABLE);

const isDev = !app.isPackaged;
const CHAT_ENABLED = false;

// Auto-updater configuration
let updateAvailable = false;
let updateDownloaded = false;
const UPDATE_CHECK_STATE_FILE = 'github-update-check.json';
const GITHUB_OWNER = 'rishivejani15';
const GITHUB_REPO = 'Intellifile';

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getUpdateCheckStatePath() {
  return path.join(app.getPath('userData'), UPDATE_CHECK_STATE_FILE);
}

function getLastUpdateCheckDate() {
  try {
    const statePath = getUpdateCheckStatePath();
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.lastCheckedDate === 'string' ? parsed.lastCheckedDate : null;
  } catch (err) {
    console.warn('[Updater] Failed to read last check state:', err.message || err);
    return null;
  }
}

function markUpdateCheckCompleted() {
  try {
    const statePath = getUpdateCheckStatePath();
    const payload = {
      lastCheckedDate: getLocalDateKey(),
      lastCheckedAt: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Updater] Failed to persist last check state:', err.message || err);
  }
}

function hasCheckedForUpdatesToday() {
  return getLastUpdateCheckDate() === getLocalDateKey();
}

function normalizeReleaseTag(tag) {
  return String(tag || '').trim().replace(/^v/i, '');
}

function compareVersionStrings(a, b) {
  const parse = (value) => {
    const match = normalizeReleaseTag(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      prerelease: match[4] || '',
    };
  };

  const left = parse(a);
  const right = parse(b);
  if (!left || !right) {
    return String(normalizeReleaseTag(a)).localeCompare(String(normalizeReleaseTag(b)));
  }

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function fetchGitHubReleases() {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/releases?per_page=10`,
      method: 'GET',
      headers: {
        'User-Agent': 'IntelliFile-Updater',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API request failed with status ${res.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('GitHub API request timed out')));
    req.end();
  });
}

async function checkGitHubUpdatesOncePerDay({ force = false } = {}) {
  if (isDev) {
    return { success: true, skipped: true, reason: 'development-mode' };
  }

  if (!force && hasCheckedForUpdatesToday()) {
    return { success: true, skipped: true, reason: 'already-checked-today' };
  }

  try {
    const releases = await fetchGitHubReleases();
    const currentVersion = normalizeReleaseTag(app.getVersion());
    const candidates = Array.isArray(releases) ? releases.filter((release) => release && !release.draft) : [];
    const latestRelease = candidates[0] || null;

    markUpdateCheckCompleted();

    if (!latestRelease) {
      return { success: true, skipped: true, reason: 'no-releases-found' };
    }

    const latestVersion = normalizeReleaseTag(latestRelease.tag_name || latestRelease.name || '');
    const comparison = compareVersionStrings(latestVersion, currentVersion);
    const updateAvailable = comparison > 0;

    return {
      success: true,
      updateAvailable,
      updateInfo: updateAvailable ? {
        version: latestVersion,
        tag: latestRelease.tag_name || latestVersion,
        name: latestRelease.name || latestVersion,
        prerelease: !!latestRelease.prerelease,
        url: latestRelease.html_url || null,
      } : null,
    };
  } catch (err) {
    markUpdateCheckCompleted();
    return { success: true, skipped: true, reason: err.message || 'github-check-failed' };
  }
}

function initializeUpdater() {
  if (isDev) {
    console.log('[Updater] Disabled in development mode');
    return;
  }

  try {
    autoUpdater.allowPrerelease = true;
    autoUpdater.autoDownload = false;

    autoUpdater.on('update-available', (info) => {
      updateAvailable = true;
      console.log('[Updater] Update available:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', { version: info.version });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      updateDownloaded = true;
      console.log('[Updater] Update downloaded:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', { version: info.version });
      }
    });

    autoUpdater.on('error', (err) => {
      console.warn('[Updater] Ignoring update error:', err.message || err);
    });

    checkGitHubUpdatesOncePerDay().then((result) => {
      if (result && result.skipped) {
        console.log('[Updater] Skipped daily GitHub version check:', result.reason);
      } else if (result && result.success) {
        if (result.updateAvailable && result.updateInfo) {
          updateAvailable = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', { version: result.updateInfo.version });
          }
          console.log('[Updater] New GitHub release found:', result.updateInfo.version);
        } else {
          console.log('[Updater] GitHub release check completed; no update found');
        }
      }
    });
  } catch (err) {
    console.warn('[Updater] Initialization failed:', err.message || err);
  }
}

let logBuffer = [];
const MAX_LOG_LINES = 1000;

function appendLog(category, message, isError = false) {
  const timestamp = new Date().toLocaleString();
  const logEntry = { timestamp, category, message, isError };

  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }

  persistLogEntry(logEntry);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-log', logEntry);
  }
}

// Override console methods to capture them
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function (...args) {
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

console.error = function (...args) {
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

console.warn = function (...args) {
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
let syncEngine;
const SYNC_PORT = 8765;

let pyReady = false;
let pythonReadyForIndexing = false;
let windowReadyForIndexing = false;
let pyEngineError = null;
let pyBuffer = '';
let pendingRequests = new Map();  // requestId -> { resolve, timeout }
let documentPreviewCache = new Map();
let documentPreviewInFlight = new Map();
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

// Tracks files recently deleted through the UI so the watcher can suppress
// the spurious unlink→re-add storm that chokidar's polling causes on Windows.
const _recentlyDeletedPaths = new Set();

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
  if (!pyModelLoaded) {
    console.log('[Index] Skipping auto-index: embedding model is not loaded yet');
    return;
  }
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

// Transient/temp file patterns that should never trigger UI events or indexing.
// These are created by browsers, OS, and editors during normal file operations.
const _TRANSIENT_PATTERNS = [
  /\.crdownload$/i,          // Chrome partial download
  /\.tmp$/i,                 // Generic temp
  /\.partial$/i,             // Firefox partial download
  /^~\$/,                    // Office lock files (~$doc.docx)
  /^~.*/,                    // Generic temp prefix
  /^desktop\.ini$/i,         // Windows folder config
  /^thumbs\.db$/i,           // Windows thumbnail cache
  /^\._/,                    // macOS resource forks
  /\.ds_store$/i,            // macOS folder metadata
  /\.download$/i,            // Download temp
  /\.aria2$/i,               // aria2 download temp
  /:Zone\.Identifier$/i,     // Windows ADS zone identifier
  /\.lnk$/i,                 // Windows shortcuts (spurious events)
];

function _isTransientFile(filePath) {
  const basename = path.basename(filePath);
  return _TRANSIENT_PATTERNS.some(re => re.test(basename));
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
      usePolling: true, // Use polling for Windows file system stability
      interval: 300,    // Check every 300ms
      binaryInterval: 300,
      ignorePermissionErrors: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    });

    watcher.on('add', (filePath) => {
      // Skip transient/temp files and recently-deleted paths
      if (_isTransientFile(filePath)) return;
      if (_recentlyDeletedPaths.has(filePath.toLowerCase())) return;
      const item = buildDirectoryItem(filePath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'add', item });
        appendLog('FileWatch', `File added: ${path.basename(filePath)}`);
        if (item.type === 'file') {
          sendToPython({ action: 'index_file', file_path: filePath, allow_protected: getAllowProtectedIndexing() }).catch(() => { });
        }
      }
    });

    watcher.on('addDir', (dirPath) => {
      if (_isTransientFile(dirPath)) return;
      if (_recentlyDeletedPaths.has(dirPath.toLowerCase())) return;
      const item = buildDirectoryItem(dirPath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'add', item });
      }
      scheduleDirectoryReindex(directoryPath, 'dir-add');
    });

    watcher.on('change', (filePath) => {
      if (_isTransientFile(filePath)) return;
      if (_recentlyDeletedPaths.has(filePath.toLowerCase())) return;
      const item = buildDirectoryItem(filePath);
      if (item) {
        broadcastDirectoryChange(directoryPath, { action: 'change', item });
        appendLog('FileWatch', `File modified: ${path.basename(filePath)}`);
        if (item.type === 'file') {
          sendToPython({ action: 'index_file', file_path: filePath, allow_protected: getAllowProtectedIndexing() }).catch(() => { });
        }
      }
    });

    watcher.on('unlink', (filePath) => {
      if (_isTransientFile(filePath)) return;
      broadcastDirectoryChange(directoryPath, { action: 'unlink', filePath });
      appendLog('FileWatch', `File deleted: ${path.basename(filePath)}`);
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
    console.error(`[Watcher] Error starting directory watch for ${directoryPath}:`, err.message || err);
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
  const appDataDir = app.getPath('userData');
  const pythonEnv = { ...process.env };
  if (!pythonEnv.IF_INDEX_SCOPE) {
    pythonEnv.IF_INDEX_SCOPE = 'all';
  }
  pythonEnv.IF_DATA_DIR = path.join(appDataDir, 'backend', 'data');
  pythonEnv.IF_MODELS_DIR = path.join(appDataDir, 'backend', 'models');

  pyEngineError = null;
  if (isDev) {
    const scriptPath = path.join(__dirname, "../backend/engine_server.py");
    console.log('[Python] Starting engine from:', scriptPath);
    pyProcess = spawn(PYTHON_EXECUTABLE, [scriptPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: pythonEnv,
    });
  } else {
    const exeName = process.platform === 'win32' ? 'engine.exe' : 'engine';
    const exePath = path.join(process.resourcesPath, 'backend-dist', 'engine', exeName);
    console.log('[Python] Starting frozen engine from:', exePath);
    if (!fs.existsSync(exePath)) {
      pyEngineError = `Frozen engine executable not found at ${exePath}. Please rebuild using build.ps1 or reinstall the packaged app.`;
      console.error('[Python] Missing frozen engine executable:', exePath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine-error', pyEngineError);
      }
      return;
    }
    pyProcess = spawn(exePath, [], {
      cwd: path.join(process.resourcesPath, 'backend-dist'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: pythonEnv,
    });
  }

  pyProcess.on('error', (err) => {
    pyEngineError = err && err.message ? err.message : String(err);
    pyReady = false;
    pythonReadyForIndexing = false;
    console.error('[Python] Engine spawn failed:', pyEngineError);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-error', pyEngineError);
    }
  });

  // Increase max listeners to prevent memory leak warnings during indexing
  if (pyProcess) {
    pyProcess.setMaxListeners(100);
    pyProcess.stdout?.setMaxListeners(100);
    pyProcess.stderr?.setMaxListeners(100);
  }

  pyProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.debug('[PY stdout]', text.trim());

    // Buffer stdout and resolve pending requests when we get complete JSON lines
    pyBuffer += text;
    const lines = pyBuffer.split(/\r?\n/);
    // Keep last (possibly incomplete) line in buffer
    pyBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for readiness signal on each full line
      if (!pyReady && trimmed.includes('IntelliFile Python Engine Ready')) {
        pyReady = true;
        pyModelLoaded = false;
        pythonReadyForIndexing = false;
        console.log('[Python] ✅ Engine is ready — pyReady = true');
        sendToPython({ action: 'model_status' }, 10000).then((res) => {
          if (res && res.loaded) {
            pyModelLoaded = true;
            pythonReadyForIndexing = true;
            console.log('[Python] ✅ Embedding model is loaded — ready for indexing');
            tryAutoIndex();
          } else {
            pyModelLoaded = false;
            pythonReadyForIndexing = false;
            const modelError = res?.error || 'Embedding model not available';
            console.warn('[Python] Embedding model unavailable:', modelError);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('model-status', { loaded: false, error: modelError });
            }
          }
        }).catch((err) => {
          pyModelLoaded = false;
          pythonReadyForIndexing = false;
          const errMsg = err && err.message ? err.message : String(err);
          console.warn('[Python] Model status check failed:', errMsg);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-status', { loaded: false, error: errMsg });
          }
        });
      }

      let jsonText = null;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        jsonText = trimmed;
      } else {
        const firstBrace = Math.min(
          trimmed.indexOf('{') !== -1 ? trimmed.indexOf('{') : Infinity,
          trimmed.indexOf('[') !== -1 ? trimmed.indexOf('[') : Infinity
        );
        const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
        if (firstBrace !== Infinity && lastBrace > firstBrace) {
          jsonText = trimmed.slice(firstBrace, lastBrace + 1);
        }
      }

      if (!jsonText) {
        console.debug('[PY stdout ignored non-json]', trimmed);
        continue;
      }

      try {
        const parsed = JSON.parse(jsonText);
        const id = parsed._id;

        if (parsed.event === 'autosort:notification' && parsed.payload) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('autosort:notification', parsed.payload);
          }
        }

        // Forward progress messages to the renderer
        if (parsed.type === 'progress') {
          lastIndexStatus = parsed;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('index-progress', parsed);
          }
          // Log indexing progress so it appears in the Logs panel
          const phase = parsed.phase || 'indexing';
          const detail = parsed.detail || '';
          const pct = typeof parsed.pct === 'number' ? ` (${parsed.pct}%)` : '';
          appendLog('Indexing', `${phase}: ${detail}${pct}`);
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
        console.debug('[PY stdout JSON parse failed]', jsonText, e && e.message ? e.message : e);
      }
    }
  });

  pyProcess.stderr.on("data", (data) => {
    console.error("[PY stderr]", data.toString().trim());
  });

  pyProcess.on("close", (code) => {
    console.log('[Python] ❌ Process exited with code:', code);
    pyReady = false;
    pyModelLoaded = false;
    // Reject all pending requests
    for (const [id, { resolve, timeout }] of pendingRequests) {
      clearTimeout(timeout);
      resolve({ error: 'Python engine crashed' });
    }
    pendingRequests.clear();
    autoIndexRequested = false;
    indexInProgress = false;
    pythonReadyForIndexing = false;
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

    const appDataDir = app.getPath('userData');
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
      try { socket.destroy(); } catch (e) { }
      resolve(isOpen);
    };
    socket.setTimeout(timeout);
    socket.once('error', () => onDone(false));
    socket.once('timeout', () => onDone(false));
    socket.connect(port, host, () => onDone(true));
  });
}

function getLocalIpv4() {
  const nets = require('os').networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = typeof net.family === 'string' ? net.family : String(net.family);
      if (family !== 'IPv4' || net.internal) continue;
      if (net.address && !net.address.startsWith('169.254.')) {
        candidates.push({ name, address: net.address });
      }
    }
  }

  const privateRanges = [
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
  ];

  for (const range of privateRanges) {
    const match = candidates.find((candidate) => range.test(candidate.address));
    if (match) return { address: match.address, candidates };
  }

  return { address: candidates[0]?.address || null, candidates };
}

function checkInternetConnectivity(timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const dns = require('dns');
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        resolve(value);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);
      dns.lookup('huggingface.co', (err) => {
        clearTimeout(timer);
        finish(!err);
      });
    } catch (err) {
      resolve(false);
    }
  });
}

let syncServerRetries = 0;
const MAX_SYNC_SERVER_RETRIES = 3;

function checkSyncServerHealth() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.request({
      hostname: '127.0.0.1',
      port: SYNC_PORT,
      path: '/status',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.status === 'running') {
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      });
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

function handleSyncServerFailure(message) {
  if (syncServerRetries < MAX_SYNC_SERVER_RETRIES) {
    syncServerRetries++;
    const delay = Math.pow(2, syncServerRetries) * 500; // 1000ms, 2000ms, 4000ms
    console.log(`[SyncServer] Attempt ${syncServerRetries} failed. Retrying in ${delay}ms...`);
    appendLog('SyncServer', `Attempt ${syncServerRetries} failed. Retrying in ${delay}ms...`);
    
    setTimeout(() => {
      startSyncServer();
    }, delay);
  } else {
    console.error(`[SyncServer] All ${MAX_SYNC_SERVER_RETRIES} retries exhausted. Failed to start sync server.`);
    appendLog('SyncServer', `All ${MAX_SYNC_SERVER_RETRIES} retries exhausted. Sync server startup failed.`, true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-server-error', `Sync server failed: ${message}`);
    }
  }
}

function attemptStartSyncServer() {
  let spawnCmd;
  let spawnArgs;
  let spawnCwd;

  if (isDev) {
    const scriptPath = path.join(__dirname, '..', 'sync', 'server.py');
    console.log('[SyncServer] Starting sync server in dev mode from:', scriptPath);
    spawnCmd = PYTHON_EXECUTABLE;
    spawnArgs = [scriptPath];
    spawnCwd = path.join(__dirname, '..');
  } else {
    const exeName = process.platform === 'win32' ? 'server.exe' : 'server';
    const exePath = path.join(process.resourcesPath, 'sync', 'server', exeName);
    console.log('[SyncServer] Starting frozen sync server from:', exePath);

    if (!fs.existsSync(exePath)) {
      const errorMsg = `Sync server executable not found at ${exePath}. (binary missing/corrupt)`;
      console.error('[SyncServer] ❌ ' + errorMsg);
      appendLog('SyncServer', `Error: ${errorMsg}`, true);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-server-error', errorMsg);
      }
      return; // Binary missing/corrupt -> fail immediately without retry
    }

    spawnCmd = exePath;
    spawnArgs = [];
    spawnCwd = path.join(process.resourcesPath, 'sync');
  }

  console.log(`[SyncServer] Spawning command: "${spawnCmd}" with args:`, spawnArgs, `Cwd: "${spawnCwd}"`);
  appendLog('SyncServer', `Spawning command: ${spawnCmd}`);

  let spawnedCompleted = false;
  let healthCheckTimer = null;

  try {
    syncServerProcess = spawn(spawnCmd, spawnArgs, {
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    syncServerProcess.on('error', (err) => {
      if (spawnedCompleted) return;
      spawnedCompleted = true;
      if (healthCheckTimer) clearInterval(healthCheckTimer);

      const errorMsg = err && err.message ? err.message : String(err);
      console.error('[SyncServer] Process spawn error:', errorMsg);
      appendLog('SyncServer', `Process spawn error: ${errorMsg}`, true);
      
      syncServerProcess = null;
      handleSyncServerFailure(`Sync server binary crashed/failed to spawn: ${errorMsg}`);
    });

    syncServerProcess.stdout.on('data', (d) => {
      console.log('[SyncServer stdout]', d.toString().trim());
    });

    syncServerProcess.stderr.on('data', (d) => {
      console.error('[SyncServer stderr]', d.toString().trim());
    });

    syncServerProcess.on('close', (code) => {
      if (healthCheckTimer) clearInterval(healthCheckTimer);
      syncServerProcess = null;

      if (spawnedCompleted) return;
      spawnedCompleted = true;

      console.log('[SyncServer] Process closed with code:', code);
      appendLog('SyncServer', `Process closed with code: ${code}`);

      const errorMsg = `Sync server exited unexpectedly with code ${code}.`;
      handleSyncServerFailure(errorMsg);
    });

    // Start polling health check /status
    let healthCheckAttempts = 0;
    const maxHealthCheckAttempts = 10; // 10 attempts * 500ms = 5 seconds
    
    healthCheckTimer = setInterval(() => {
      if (spawnedCompleted) {
        clearInterval(healthCheckTimer);
        return;
      }

      checkSyncServerHealth().then((isHealthy) => {
        if (spawnedCompleted) {
          clearInterval(healthCheckTimer);
          return;
        }

        if (isHealthy) {
          clearInterval(healthCheckTimer);
          spawnedCompleted = true;
          console.log('[SyncServer] ✅ Sync server is healthy and running.');
          appendLog('SyncServer', '✅ Sync server is healthy and running.');
          syncServerRetries = 0; // reset retries
        } else {
          healthCheckAttempts++;
          if (healthCheckAttempts >= maxHealthCheckAttempts) {
            clearInterval(healthCheckTimer);
            spawnedCompleted = true;
            console.warn('[SyncServer] Health check timed out after 5 seconds.');
            appendLog('SyncServer', 'Health check timed out.', true);
            
            if (syncServerProcess && !syncServerProcess.killed) {
              syncServerProcess.kill();
            }
            syncServerProcess = null;
            handleSyncServerFailure('Sync server failed to respond to health checks.');
          }
        }
      });
    }, 500);

  } catch (err) {
    if (healthCheckTimer) clearInterval(healthCheckTimer);
    const errorMsg = err && err.message ? err.message : String(err);
    console.error('[SyncServer] failed to spawn process:', errorMsg);
    appendLog('SyncServer', `Exception starting: ${errorMsg}`, true);
    syncServerProcess = null;
    handleSyncServerFailure(`Spawn exception: ${errorMsg}`);
  }
}

function startSyncServer() {
  try {
    if (syncServerProcess && !syncServerProcess.killed) {
      console.log('[SyncServer] already running');
      return Promise.resolve();
    }

    return isPortOpen(SYNC_PORT, '127.0.0.1', 300).then((portOpen) => {
      if (portOpen) {
        console.log(`[SyncServer] port ${SYNC_PORT} already in use; assuming server is running`);
        return;
      }

      attemptStartSyncServer();
    });
  } catch (err) {
    const errorMsg = err && err.message ? err.message : String(err);
    console.error('[SyncServer] Exception in startSyncServer:', errorMsg);
    appendLog('SyncServer', `Exception in startSyncServer: ${errorMsg}`, true);
    handleSyncServerFailure(`Initialization error: ${errorMsg}`);
  }
}

function tryCreateSyncLink(srcPath, destPath) {
  try {
    fs.linkSync(srcPath, destPath);
    return { ok: true, mode: 'hardlink' };
  } catch (err) {
    try {
      fs.symlinkSync(srcPath, destPath, 'file');
      return { ok: true, mode: 'symlink' };
    } catch (err2) {
      try {
        fs.copyFileSync(srcPath, destPath);
        return { ok: true, mode: 'copy' };
      } catch (err3) {
        const message = err3 && err3.message ? err3.message : String(err3);
        return { ok: false, error: message };
      }
    }
  }
}

function walkSyncFiles(dirPath, results = []) {
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        walkSyncFiles(fullPath, results);
      } else {
        results.push({
          name: path.relative(path.join(__dirname, '..', 'sync', 'intellifil_files'), fullPath).replace(/\\/g, '/'),
          path: fullPath,
          size: stats.size,
          modified: stats.mtimeMs,
        });
      }
    } catch (err) {
      console.warn('[Sync] Failed to inspect file:', fullPath, err && err.message ? err.message : err);
    }
  }

  return results;
}

function ensureSyncEngine() {
  if (syncEngine) return syncEngine;

  const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
  syncEngine = new SyncEngine(syncDir);

  syncEngine.on('status', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-status', data);
    }
  });

  syncEngine.on('log', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-log', msg);
    }
  });

  syncEngine.on('files', (files) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-files', files);
    }
  });

  syncEngine.on('pending', (changes) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-pending', changes);
    }
  });

  return syncEngine;
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
    // Handle second-instance events from Windows (Explorer / browser)

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

  // Pattern: standalone "<day> <month> <year>" without prefix keyword
  // e.g., "28 june 2026", "28th june 2026", "3rd march 2025"
  if (!dateFrom && !dateTo) {
    const standaloneDayMonthYearRe = new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s+(\\d{4})\\b`,
      'i'
    );
    match = query.match(standaloneDayMonthYearRe);
    if (match) {
      const day = parseInt(match[1]);
      const month = MONTHS[match[2].toLowerCase()];
      const year = parseInt(match[3]);
      if (day >= 1 && day <= 31) {
        dateFrom = startOfDay(year, month, day);
        dateTo = endOfDay(year, month, day);
        query = query.replace(match[0], '').trim();
      }
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

  // Pattern: numeric dates — YYYY-MM-DD (ISO), DD/MM/YYYY, MM-DD-YYYY
  if (!dateFrom && !dateTo) {
    // ISO format: 2026-06-28
    const isoRe = /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
    match = query.match(isoRe);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1;  // JS months are 0-indexed
      const day = parseInt(match[3]);
      dateFrom = startOfDay(year, month, day);
      dateTo = endOfDay(year, month, day);
      query = query.replace(match[0], '').trim();
    }
  }

  if (!dateFrom && !dateTo) {
    // DD/MM/YYYY or DD-MM-YYYY
    const dMyRe = /\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](\d{4})\b/;
    match = query.match(dMyRe);
    if (match) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]) - 1;
      const year = parseInt(match[3]);
      if (day >= 1 && day <= 31 && year >= 1900 && year <= 2099) {
        dateFrom = startOfDay(year, month, day);
        dateTo = endOfDay(year, month, day);
        query = query.replace(match[0], '').trim();
      }
    }
  }

  // Pattern: "<month> <day>" or "<day> <month>" without year (defaults to current year)
  // e.g., "june 28", "28 june", "june 28th", "28th june"
  if (!dateFrom && !dateTo) {
    // month-day: "june 28" / "june 28th"
    const monthDayRe = new RegExp(
      `(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
      'i'
    );
    match = query.match(monthDayRe);
    if (match) {
      const month = MONTHS[match[1].toLowerCase()];
      const day = parseInt(match[2]);
      if (day >= 1 && day <= 31) {
        const year = new Date().getFullYear();
        dateFrom = startOfDay(year, month, day);
        dateTo = endOfDay(year, month, day);
        query = query.replace(match[0], '').trim();
      }
    }
  }

  if (!dateFrom && !dateTo) {
    // day-month: "28 june" / "28th june"
    const dayMonthRe = new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b`,
      'i'
    );
    match = query.match(dayMonthRe);
    if (match) {
      const day = parseInt(match[1]);
      const month = MONTHS[match[2].toLowerCase()];
      if (day >= 1 && day <= 31) {
        const year = new Date().getFullYear();
        dateFrom = startOfDay(year, month, day);
        dateTo = endOfDay(year, month, day);
        query = query.replace(match[0], '').trim();
      }
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
  query = query.replace(/\b(containing|with|about|files?|from|created|on|dated|in|during|of)\b/gi, ' ').replace(/\s+/g, ' ').trim();

  return {
    cleanQuery: (!query.trim() && (dateFrom || dateTo)) ? "" : (query.trim() || rawQuery.trim()),
    dateFrom: dateFrom ? Math.floor(dateFrom) : null,
    dateTo: dateTo ? Math.floor(dateTo) : null,
  };
}

ipcMain.handle('ingest-file', async (event, filePath) => {
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return sendToPython({ action: 'chat_ingest', file_path: filePath });
});

ipcMain.handle('chat-ingest-file', async (event, filePath) => {
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return sendToPython({ action: 'chat_ingest', file_path: filePath });
});

ipcMain.handle('chat', async (event, query) => {
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return sendToPython({ action: 'chat', query: query });
});

ipcMain.handle('chat-ask', async (event, query) => {
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return sendToPython({ action: 'chat', query: query });
});

ipcMain.handle('clear-faiss', async () => {
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return sendToPython({ action: 'chat_clear' });
});

ipcMain.handle("search", async (_, payload) => {
  if (pyEngineError) {
    throw new Error(pyEngineError);
  }
  const query = typeof payload === 'string' ? payload : payload?.query || '';
  const rootFolder = typeof payload === 'object' && payload ? payload.rootFolder || payload.rootPath || null : null;
  console.log('[IPC] search called, pyReady:', pyReady, 'query:', query, 'rootFolder:', rootFolder);
  const { cleanQuery, dateFrom, dateTo } = parseDateFromQuery(query);
  console.log('[IPC] parsed date filter:', { cleanQuery, dateFrom, dateTo });
  return sendToPython({
    action: "search",
    query: cleanQuery,
    date_from: dateFrom,
    date_to: dateTo,
    root_folder: rootFolder,
  });
});

ipcMain.handle("search-status", async () => {
  console.log('[IPC] search-status called, pyReady:', pyReady, 'pyModelLoaded:', pyModelLoaded, 'pyEngineError:', pyEngineError);
  return {
    ready: pyReady,
    modelLoaded: pyModelLoaded,
    indexing: indexInProgress,
    lastIndexMessage,
    lastIndexStatus,
    error: pyEngineError
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

ipcMain.handle('settings:get', async (_event, key) => {
  return sendToPython({ action: 'settings_get', key });
});

ipcMain.handle('settings:set', async (_event, payload = {}) => {
  const key = payload?.key;
  const value = payload?.value;
  const result = await sendToPython({ action: 'settings_update', key, value });

  if (key === 'auto_sort_enabled' || key === 'watched_folders') {
    let enabled = false;
    if (key === 'auto_sort_enabled') {
      enabled = typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
    } else {
      const current = await sendToPython({ action: 'settings_get', key: 'auto_sort_enabled' });
      enabled = !!current?.value && String(current.value).toLowerCase() === 'true';
    }

    if (enabled) {
      await sendToPython({ action: 'watcher_start' });
    } else {
      await sendToPython({ action: 'watcher_stop' });
    }
  }

  return result;
});

ipcMain.handle('autosort:recent', async (_event, limit = 20) => {
  return sendToPython({ action: 'autosort_recent', limit });
});

ipcMain.handle('autosort:undo', async (_event, logId) => {
  return sendToPython({ action: 'autosort_undo', log_id: logId });
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a watched folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return { canceled: result.canceled, filePaths: result.filePaths || [] };
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
  if (!CHAT_ENABLED) return { success: false, error: 'Chat is disabled by policy.' };
  return new Promise((resolve) => {
    try {
      const appDataDir = app.getPath('userData');
      const env = { ...process.env, IF_ALLOW_MODEL_DOWNLOAD: '1' };
      // Prefer per-user models dir inside app userData
      env.IF_MODELS_DIR = path.join(appDataDir, 'backend', 'models');
      const exePath = isDev
        ? PYTHON_EXECUTABLE
        : path.join(process.resourcesPath, 'backend-dist', 'engine', 'engine.exe');
      const args = isDev
        ? [path.join(__dirname, "../backend/setup_offline.py"), "--appdata-dir", appDataDir, "--json"]
        : ["--offline-setup", "--appdata-dir", appDataDir, "--json"];
      const dl = spawn(exePath, args, {
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
  const result = await sendToPython({
    action: 'save_version',
    file_path: payload.filePath || payload.file_path,
    old_content: payload.oldContent || payload.old_content || '',
    new_content: payload.newContent || payload.new_content || '',
  });

  if (result && result.success && win && !win.isDestroyed()) {
    win.webContents.send('version-updated', {
      filePath: payload.filePath || payload.file_path,
      versionId: result.data?.version_id,
      summary: result.data?.summary,
      riskLevel: result.data?.risk_level,
    });
  }

  return result;
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

// Calculate folder size recursively (non-blocking with depth limit)
function calculateFolderSize(folderPath, depth = 0, maxDepth = 2) {
  let totalSize = 0;

  // Don't recurse too deep to avoid hanging on large directory trees
  if (depth > maxDepth) return 0;

  try {
    const items = fs.readdirSync(folderPath);

    for (const item of items) {
      try {
        const itemPath = path.join(folderPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          totalSize += calculateFolderSize(itemPath, depth + 1, maxDepth);
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
    appendLog('Indexing', `Indexing failed: ${payload.error}`, true);
  } else if (skipped > 0) {
    lastIndexMessage = `Index updated (skipped ${skipped} protected ${skipped === 1 ? 'item' : 'items'})`;
    appendLog('Indexing', lastIndexMessage);
  } else {
    lastIndexMessage = 'Index updated';
    appendLog('Indexing', 'Indexing completed successfully');
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

  ipcMain.handle('get-startup-path', () => {
    const payload = startupPathPayload;
    startupPathPayload = null; // Clear so subsequent calls get null
    return payload;
  });

  ipcMain.handle('check-is-default-file-manager', async () => {
    return checkIsDefaultFileManager();
  });

  ipcMain.handle('set-default-file-manager', async (_event, enable) => {
    return setDefaultFileManager(enable);
  });

  // ── Offline Setup & Logs IPC ──
  ipcMain.handle('get-logs', () => {
    return logBuffer;
  });

  ipcMain.handle('clear-logs', () => {
    logBuffer = [];
    try {
      fs.writeFileSync(getLogFilePath(), '', 'utf-8');
    } catch (err) {
      console.warn('[Logs] Failed to clear log file:', err.message || err);
    }
    return true;
  });

  ipcMain.handle('offline-setup-status', async () => {
    const appDataDir = app.getPath('userData');
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

    const modelsExist = hasEmbeddingModel;
    const setupCompleted = hasOfflineSetupCompleted();

    if (modelsExist && !setupCompleted) {
      markOfflineSetupComplete();
    }

    // Only show setup dialog if models don't exist AND setup hasn't been completed before
    const needed = !modelsExist && !setupCompleted;

    return { needed, hasChatModel, hasEmbeddingModel, setupCompleted };
  });

  let setupProcess = null;
  ipcMain.handle('offline-setup-run', async (event) => {
    if (setupProcess) return { success: false, error: 'Setup already running' };

    const hasInternet = await checkInternetConnectivity();
    if (!hasInternet) {
      return {
        success: false,
        error: 'Internet connection is required to download the AI models. Please turn on Wi-Fi or connect to the internet and try again.',
      };
    }

    return new Promise((resolve) => {
      const appDataDir = app.getPath('userData');
      let exePath;
      if (isDev) {
        exePath = PYTHON_EXECUTABLE;
      } else {
        exePath = path.join(process.resourcesPath, "backend-dist", "engine", "engine.exe");
      }

      const args = isDev
        ? [path.join(__dirname, "../backend/setup_offline.py"), "--appdata-dir", appDataDir, "--json"]
        : ["--offline-setup", "--appdata-dir", appDataDir, "--json"];

      // Determine whether chat model will be skipped (we force skip in spawn env)
      const skipChat = true; // currently we pass IF_SKIP_CHAT_MODEL=1 for installs

      setupProcess = spawn(exePath, args, {
        cwd: isDev ? path.join(__dirname, '..') : path.join(process.resourcesPath, "backend-dist"),
        env: { ...process.env, IF_SKIP_CHAT_MODEL: '1' }
      });

      // Immediately notify renderer that the setup has started and provide initial step/total
      try {
        const initialTotal = skipChat ? 2 : 3;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('offline-setup-progress', {
            type: 'step', step: 1, total: initialTotal, name: 'Initializing...', status: 'processing', pct: 0
          });
        }
      } catch (e) {
        console.warn('[Setup] Failed to send initial progress:', e.message || e);
      }

      // collect stderr to return a useful error message if the process fails
      let stderrBuffer = '';

      setupProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            // If the backend reports totals that include the chat model but we are skipping it,
            // adjust the total so the UI shows the correct step count.
            if (parsed && parsed.type === 'step' && parsed.total && skipChat && parsed.total > 2) {
              parsed.total = Math.max(2, parsed.total - 1);
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('offline-setup-progress', parsed);
            }
          } catch (e) {
            console.log('[Setup Output]', line.trim());
          }
        }
      });

      setupProcess.stderr.on('data', (data) => {
        const s = data.toString();
        stderrBuffer += s;
        const lines = s.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
        let matchedProgress = false;

        for (const line of lines) {
          const fetchMatch = line.match(/Fetching\s+(\d+)\s+files:\s+(\d+(?:\.\d+)?)%\|.*?\|\s*(\d+)\/(\d+)/i);
          if (fetchMatch) {
            matchedProgress = true;
            const pct = Number(fetchMatch[2]);
            const processed = Number(fetchMatch[3]);
            const total = Number(fetchMatch[4]);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('offline-setup-progress', {
                type: 'progress',
                name: 'Embedding Model',
                status: 'downloading',
                pct,
                downloaded_files: processed,
                total_files: total,
              });
            }
            continue;
          }
        }

        if (!matchedProgress) {
          console.error('[Setup Error]', s.trim());
        } else {
          console.log('[Setup Progress]', s.trim());
        }
      });

      setupProcess.on('close', (code) => {
        setupProcess = null;
        if (code === 0) {
          console.log('[Setup] Setup completed successfully. Marking setup as completed and restarting Python engine...');
          // Mark setup as completed so we don't show the dialog again
          indexingPreferences.offlineSetupCompleted = true;
          saveIndexingPreferences();
          markOfflineSetupComplete();
          if (pyProcess) {
            pyProcess.kill(); // The 'close' listener in startPython will handle cleanup
          }
          // Give it a tiny delay to ensure the port/locks are released
          setTimeout(() => {
            startPython();
            resolve({ success: true });
          }, 1000);
        } else {
          const errMsg = stderrBuffer.trim() || `Setup process exited with code ${code}`;
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('offline-setup-progress', { type: 'error', message: errMsg });
            }
          } catch (e) { }
          resolve({ success: false, error: errMsg });
        }
      });
    });
  });

  ipcMain.handle('reset-offline-setup', async () => {
    try {
      const appDataDir = app.getPath('userData');
      const modelsDir = path.join(appDataDir, 'backend', 'models');
      const setupMarkerPath = getOfflineSetupMarkerPath();

      if (fs.existsSync(modelsDir)) {
        fs.rmSync(modelsDir, { recursive: true, force: true });
      }

      if (fs.existsSync(setupMarkerPath)) {
        fs.rmSync(setupMarkerPath, { force: true });
      }

      indexingPreferences.offlineSetupCompleted = false;
      saveIndexingPreferences();

      return { success: true };
    } catch (err) {
      console.error('[Setup] Failed to reset offline setup:', err.message || err);
      return { success: false, error: err.message || 'Failed to reset offline setup.' };
    }
  });

  ipcMain.handle('check-network-connectivity', async () => {
    try {
      const online = await checkInternetConnectivity();
      return { success: true, online };
    } catch (err) {
      return { success: false, online: false, error: err.message || 'Unable to verify network connectivity.' };
    }
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

      const filteredList = fileList.filter(item => !isSystemFile(item, showHidden));
      const items = [];
      const CHUNK_SIZE = 100;

      // Process items in batches to prevent UV thread pool starvation
      for (let i = 0; i < filteredList.length; i += CHUNK_SIZE) {
        const chunk = filteredList.slice(i, i + CHUNK_SIZE);
        const chunkPromises = chunk.map(async item => {
          try {
            const fullPath = path.join(resolvedPath, item);
            const stats = await fs.promises.stat(fullPath);
            const ext = path.extname(item).toLowerCase();
            const isEditable = EDITABLE_EXTENSIONS.includes(ext);
            const isProtected = isProtectedPath(fullPath);

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
            return null;
          }
        });

        const chunkResults = await Promise.all(chunkPromises);
        items.push(...chunkResults.filter(Boolean));
      }

      items.sort((a, b) => {
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

  ipcMain.handle('get-document-preview', async (event, filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg'].includes(ext)) {
        return { success: false, error: 'Unsupported document type' };
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return { success: false, error: 'Preview target is not a file' };
      }
      if (stats.size > 100 * 1024 * 1024) {
        return { success: false, error: 'Document is too large to preview safely' };
      }
      const cacheKey = `${path.resolve(filePath)}:${stats.size}:${stats.mtimeMs}`;
      if (documentPreviewCache.has(cacheKey)) {
        return documentPreviewCache.get(cacheKey);
      }
      if (documentPreviewInFlight.has(cacheKey)) {
        return await documentPreviewInFlight.get(cacheKey);
      }
      const previewRequest = sendToPython({ action: 'document_preview', file_path: filePath }, 30000);
      documentPreviewInFlight.set(cacheKey, previewRequest);
      let result;
      try {
        result = await previewRequest;
      } finally {
        documentPreviewInFlight.delete(cacheKey);
      }
      if (result?.error) {
        return { success: false, error: result.error };
      }
      documentPreviewCache.set(cacheKey, result);
      if (documentPreviewCache.size > 20) {
        documentPreviewCache.delete(documentPreviewCache.keys().next().value);
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-local-sync-address', async () => {
    const { address, candidates } = getLocalIpv4();
    return {
      success: !!address,
      ip: address,
      port: SYNC_PORT,
      address: address ? `${address}:${SYNC_PORT}` : null,
      candidates,
    };
  });

  // ── Sync: local file staging for cross-device sync
  ipcMain.handle('get-sync-files', async () => {
    try {
      const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
      if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
      const items = walkSyncFiles(syncDir).sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
      const errors = [];
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
        const linkResult = tryCreateSyncLink(src, dest);
        if (!linkResult.ok) {
          errors.push({ file: src, error: linkResult.error });
          continue;
        }
        added++;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-files', walkSyncFiles(syncDir));
      }

      return { success: errors.length === 0, added, errors };
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
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync-files', walkSyncFiles(syncDir));
      return { success: true };
    } catch (err) {
      console.error('[Sync] remove-sync-file error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-connect', async (_event, opts) => {
    try {
      const engine = ensureSyncEngine();
      const signalingUrl = opts?.signalingUrl;
      const sessionId = opts?.sessionId;
      const isInitiator = !!opts?.isInitiator;

      if (!signalingUrl || !sessionId) {
        return { success: false, error: 'signalingUrl and sessionId are required' };
      }

      await engine.connect(signalingUrl, sessionId, isInitiator);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-files', engine.getFiles());
        mainWindow.webContents.send('sync-pending', engine.getPendingChanges());
      }

      return { success: true };
    } catch (err) {
      console.error('[Sync] sync-connect error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-disconnect', async () => {
    try {
      if (syncEngine) syncEngine.disconnect();
      return { success: true };
    } catch (err) {
      console.error('[Sync] sync-disconnect error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-approve', async (_event, filepath) => {
    try {
      const engine = ensureSyncEngine();
      engine.approvePendingChange(filepath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-reject', async (_event, filepath) => {
    try {
      const engine = ensureSyncEngine();
      engine.rejectPendingChange(filepath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-approve-all', async () => {
    try {
      const engine = ensureSyncEngine();
      engine.approveAllPending();
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-reject-all', async () => {
    try {
      const engine = ensureSyncEngine();
      engine.rejectAllPending();
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('sync-get-pending', async () => {
    try {
      const engine = ensureSyncEngine();
      return { success: true, pending: engine.getPendingChanges() };
    } catch (err) {
      return { success: false, pending: [], error: err && err.message ? err.message : String(err) };
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
      // Move to Recycle Bin using Windows API.
      // IMPORTANT: We must AWAIT completion so chokidar sees a clean state
      // transition instead of catching the directory mid-operation (which
      // causes it to fire unlink/add for ALL files in the directory).
      const { exec } = require('child_process');
      const stats = fs.statSync(filePath);
      const escapedPath = filePath.replace(/'/g, "''");

      // Track this path so the watcher can suppress spurious events
      _recentlyDeletedPaths.add(filePath.toLowerCase());
      setTimeout(() => _recentlyDeletedPaths.delete(filePath.toLowerCase()), 5000);

      const psCommand = stats.isDirectory()
        ? `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escapedPath}','OnlyErrorDialogs','SendToRecycleBin')`
        : `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedPath}','OnlyErrorDialogs','SendToRecycleBin')`;

      return await new Promise((resolve) => {
        exec(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 15000 }, (err) => {
          if (err) {
            console.error('Error deleting:', err.message || err);
            resolve({ success: false, error: err.message || 'Delete failed' });
          } else {
            resolve({ success: true });
          }
        });
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('restore-deleted-file', async (event, originalPath) => {
    try {
      const escapedPath = String(originalPath || '').replace(/'/g, "''");
      const command = [
        '$shell = New-Object -ComObject Shell.Application',
        '$recycle = $shell.Namespace(10)',
        '$item = $recycle.Items() | Where-Object { $_.ExtendedProperty(\'System.Recycle.DeletedFrom\') -eq \'${escapedPath}\' } | Select-Object -First 1',
        'if ($item) { $item.InvokeVerb(\'RESTORE\'); exit 0 } else { exit 1 }'
      ].join('; ');

      return await new Promise((resolve) => {
        const { exec } = require('child_process');
        exec(`powershell -NoProfile -Command "${command}"`, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
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
      return { success: true, path: folderPath };
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
  // Accepts optional { shell: 'cmd'|'powershell' } on Windows to open specific shells
  ipcMain.handle('open-terminal-here', async (event, dirPath, options = {}) => {
    try {
      const { exec } = require('child_process');
      const shellChoice = options?.shell || null;
      if (process.platform === 'win32') {
        // Prefer explicit cmd if requested
        if (shellChoice && String(shellChoice).toLowerCase() === 'cmd') {
          // Use start to open a new cmd.exe and change directory
          const safePath = String(dirPath).replace(/"/g, '"');
          exec(`start cmd.exe /K "cd /d \"${safePath}\""`);
        } else if (shellChoice && String(shellChoice).toLowerCase().includes('powershell')) {
          const safePath = String(dirPath).replace(/'/g, "''");
          exec(`start powershell -NoExit -Command "Set-Location '${safePath}'"`);
        } else {
          const safePath = String(dirPath).replace(/'/g, "''");
          exec(`start powershell -NoExit -Command "Set-Location '${safePath}'"`);
        }
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
  ipcMain.handle('get-thumbnail', async (event, filePath, options = {}) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg'];
      if (!imageExts.includes(ext)) {
        return { success: false, error: 'Not an image file' };
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size > 50 * 1024 * 1024) {
        return { success: false, error: 'Image is too large to preview safely' };
      }
      // Read image and resize for thumbnail
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { success: false, error: 'Could not load image' };
      }
      const { width, height } = image.getSize();
      const maxWidth = Math.min(2048, Math.max(64, Number.isFinite(options.maxWidth) ? options.maxWidth : 120));
      const maxHeight = Math.min(2048, Math.max(64, Number.isFinite(options.maxHeight) ? options.maxHeight : 120));
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const thumbnail = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good'
      });
      const dataUrl = thumbnail.toDataURL();
      return { success: true, dataUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Update handlers
  ipcMain.handle('check-for-updates', async () => {
    const result = await checkGitHubUpdatesOncePerDay({ force: true });
    return result;
  });

  ipcMain.on('update-restart', () => {
    console.log('[update-restart] User confirmed restart for update');
    autoUpdater.quitAndInstall();
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
    show: false,
    backgroundColor: '#111827',
    icon: path.join(__dirname, 'public', 'intellifile_logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set win for version watching
  win = mainWindow;

  // Remove the default menu bar (Files, Windows, Exit)
  Menu.setApplicationMenu(null);

  const prodIndexPath = path.join(__dirname, 'build', 'index.html');
  const startUrl = isDev
    ? 'http://localhost:3000'
    : pathToFileURL(prodIndexPath).href;

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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[UI] Failed to load window:', errorCode, errorDescription, validatedURL);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const errorHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>IntelliFile - Load Error</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #222; background: #f8fafc; }
      code { background: #f3f3f3; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h2>IntelliFile failed to load</h2>
    <p>The app window could not load its UI.</p>
    <p>Please rebuild the frontend and relaunch the app.</p>
  </body>
</html>`;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
    }
  });

  // Trigger auto-indexing once window is ready and Python is ready
  // Add a small delay to allow UI to render before heavy indexing starts
  mainWindow.webContents.on('did-finish-load', () => {
    windowReadyForIndexing = true;
    console.log('[Window] Ready for indexing — will start in 500ms');
    // Defer auto-index to give UI time to render
    setTimeout(() => {
      tryAutoIndex();
    }, 500);
  });

  // Increase max event listeners to prevent memory leak warnings during indexing
  mainWindow.webContents.setMaxListeners(100);

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
  initializeUpdater();
  startPython();
  startSyncServer();
  ensureSyncEngine();
  if (CHAT_ENABLED) startChatBackend();
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

  if (syncEngine) {
    try {
      syncEngine.disconnect();
    } catch (err) {
      console.warn('[SyncEngine] disconnect error:', err && err.message ? err.message : err);
    }
  }

  if (syncServerProcess) {
    console.log('[SyncServer] Killing sync server process');
    try {
      syncServerProcess.kill();
    } catch (err) {
      console.warn('[SyncServer] kill error:', err && err.message ? err.message : err);
    }
    syncServerProcess = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
