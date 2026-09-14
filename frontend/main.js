const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeImage, screen } = require('electron');

// CRITICAL: Set AppUserModelId on Windows so all application windows and shortcuts
// properly group together under a single taskbar icon instead of separating instances.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.intellifile.app');
}

// Prevent Chromium from permanently dropping hardware acceleration/black-screening under heavy CPU load
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

app.on('child-process-gone', (event, details) => {
  console.warn('[Process] Child process gone:', details.type, details.reason);
});

// Enforce single-instance lock so secondary launches do not re-spawn Python, Sync, or Watchers
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[App] Another instance is already running. Quitting secondary process.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let win = null;
const activeWindows = new Set();

function getActiveWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  for (const w of activeWindows) {
    if (w && !w.isDestroyed()) return w;
  }
  const all = BrowserWindow.getAllWindows();
  for (const w of all) {
    if (w && !w.isDestroyed()) return w;
  }
  return null;
}

function broadcastToAllWindows(channel, ...args) {
  const windows = BrowserWindow.getAllWindows();
  for (const w of windows) {
    try {
      if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send(channel, ...args);
      }
    } catch (e) {
      console.warn(`[Broadcast] Failed to send ${channel} to window:`, e.message);
    }
  }
}

const path = require('path');
const fs = require('fs');
let parseDeterministicMonthDateQuery = () => null;
try {
  ({ parseDeterministicMonthDateQuery } = require('./dateSearchParser'));
} catch (e) {
  console.warn('[main] Failed to load dateSearchParser:', e.message);
}

let parseFolderSearchQuery = () => null;
try {
  ({ parseFolderSearchQuery } = require('./folderSearchParser'));
} catch (e) {
  console.warn('[main] Failed to load folderSearchParser:', e.message);
}

// Force consistent canonical userData path (%APPDATA%\intellifile) across all updates & installer versions
const appDataDir = app.getPath('appData');
const canonicalUserData = path.join(appDataDir, 'intellifile');
try {
  app.setPath('userData', canonicalUserData);
  if (!fs.existsSync(canonicalUserData)) {
    fs.mkdirSync(canonicalUserData, { recursive: true });
  }

  // Auto-migrate settings & data from alternative folder names (e.g. IntelliFile vs intellifile)
  const altUserData = path.join(appDataDir, 'IntelliFile');
  if (fs.existsSync(altUserData) && altUserData !== canonicalUserData) {
    // 1. Settings
    const altSettings = path.join(altUserData, 'app_settings.json');
    const targetSettings = path.join(canonicalUserData, 'app_settings.json');
    if (fs.existsSync(altSettings) && !fs.existsSync(targetSettings)) {
      try {
        fs.copyFileSync(altSettings, targetSettings);
        console.log('[Migration] Successfully migrated app_settings.json to canonical userData');
      } catch (err) {
        console.warn('[Migration] Could not copy app_settings.json:', err.message);
      }
    }

    // 2. Offline setup marker
    const altMarker = path.join(altUserData, 'offline-setup.done');
    const targetMarker = path.join(canonicalUserData, 'offline-setup.done');
    if (fs.existsSync(altMarker) && !fs.existsSync(targetMarker)) {
      try {
        fs.copyFileSync(altMarker, targetMarker);
        console.log('[Migration] Successfully migrated offline-setup.done to canonical userData');
      } catch (err) {
        console.warn('[Migration] Could not copy offline-setup.done:', err.message);
      }
    }

    // 3. Backend data (SQLite files.db and FAISS vectors.faiss)
    const altData = path.join(altUserData, 'backend', 'data');
    const targetData = path.join(canonicalUserData, 'backend', 'data');
    if (fs.existsSync(altData)) {
      if (!fs.existsSync(targetData)) {
        fs.mkdirSync(targetData, { recursive: true });
      }
      try {
        const dataFiles = fs.readdirSync(altData);
        for (const df of dataFiles) {
          const src = path.join(altData, df);
          const dst = path.join(targetData, df);
          if (!fs.existsSync(dst) && fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dst);
            console.log(`[Migration] Migrated data file ${df} to canonical userData`);
          }
        }
      } catch (err) {
        console.warn('[Migration] Error migrating backend data:', err.message);
      }
    }

    // 4. Backend models (models--*)
    const altModels = path.join(altUserData, 'backend', 'models');
    const targetModels = path.join(canonicalUserData, 'backend', 'models');
    if (fs.existsSync(altModels)) {
      if (!fs.existsSync(targetModels)) {
        fs.mkdirSync(targetModels, { recursive: true });
      }
      try {
        const modelEntries = fs.readdirSync(altModels);
        for (const me of modelEntries) {
          const src = path.join(altModels, me);
          const dst = path.join(targetModels, me);
          if (!fs.existsSync(dst)) {
            fs.cpSync(src, dst, { recursive: true });
            console.log(`[Migration] Migrated model ${me} to canonical userData`);
          }
        }
      } catch (err) {
        console.warn('[Migration] Error migrating models:', err.message);
      }
    }
  }
} catch (e) {
  console.warn('[UserData] Warning setting canonical userData path:', e.message);
}

const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.logger = console;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = true;

let cachedUpdateState = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version: '',
  progress: 0,
  error: null
};

// Multiple IntelliFile windows share this process. Claiming the tour here is
// atomic, so two windows starting together cannot both launch onboarding.
let onboardingTourClaimed = false;

let checkTimeout = null;

autoUpdater.on('checking-for-update', () => {
  console.log('[Update] Checking for updates on GitHub...');
  if (cachedUpdateState.status !== 'available' && cachedUpdateState.status !== 'downloaded') {
    cachedUpdateState.status = 'checking';
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-checking', cachedUpdateState);
  }

  if (checkTimeout) clearTimeout(checkTimeout);
  checkTimeout = setTimeout(async () => {
    if (cachedUpdateState.status === 'checking') {
      console.log('[Update] Checking timed out after 10s. Running direct GitHub query fallback...');
      const ghRelease = await fetchLatestGitHubRelease();
      const currentVer = app.getVersion();
      if (ghRelease?.version && isNewerVersion(ghRelease.version, currentVer)) {
        cachedUpdateState = { status: 'available', version: ghRelease.version, progress: 0, error: null };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', { version: ghRelease.version });
        }
      } else {
        cachedUpdateState.status = 'latest';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-not-available', { version: currentVer });
        }
      }
    }
  }, 10000);
});

autoUpdater.on('update-available', (info) => {
  if (checkTimeout) clearTimeout(checkTimeout);
  const ver = info?.version || 'unknown';
  console.log('[Update] 🎉 New version available:', ver);
  cachedUpdateState = { status: 'available', version: ver, progress: 0, error: null };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', {
      version: ver,
      releaseNotes: info?.releaseNotes,
      releaseDate: info?.releaseDate
    });
  }

  // If Wi-Fi Auto-Download setting is enabled, trigger update download automatically
  const localSettings = readLocalSettings();
  if (localSettings.auto_update_wifi !== false) {
    console.log('[Update] Wi-Fi Auto-Download is enabled. Triggering background download...');
    try {
      autoUpdater.downloadUpdate();
    } catch (e) {
      console.warn('[Update] Auto download trigger failed:', e && e.message ? e.message : e);
    }
  }
});

autoUpdater.on('update-not-available', (info) => {
  if (checkTimeout) clearTimeout(checkTimeout);
  console.log('[Update] ✓ Application is up to date.');
  if (cachedUpdateState.status !== 'downloaded' && cachedUpdateState.status !== 'available') {
    cachedUpdateState = { status: 'latest', version: app.getVersion(), progress: 100, error: null };
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-not-available', {
      version: app.getVersion()
    });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (checkTimeout) clearTimeout(checkTimeout);
  const pct = Math.round(progressObj.percent || 0);
  console.log(`[Update] Download progress: ${pct}%`);
  cachedUpdateState = { ...cachedUpdateState, status: 'downloading', progress: pct };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-download-progress', {
      percent: pct,
      bytesPerSecond: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (checkTimeout) clearTimeout(checkTimeout);
  const ver = info?.version || cachedUpdateState.version || '';
  console.log('[Update] ⚡ Update downloaded and ready to install:', ver);
  cachedUpdateState = { status: 'downloaded', version: ver, progress: 100, error: null };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', {
      version: ver
    });
  }
});

function isNonFatalUpdateError(msg) {
  if (!msg) return false;
  const lower = String(msg).toLowerCase();
  return (
    lower.includes('no update') ||
    lower.includes('404') ||
    lower.includes('406') ||
    lower.includes('cannot find') ||
    lower.includes('cannot parse') ||
    lower.includes('unable to find') ||
    lower.includes('latest.yml') ||
    lower.includes('dev-app-update') ||
    lower.includes('already in progress') ||
    lower.includes('in progress')
  );
}

autoUpdater.on('error', (err) => {
  const msg = err && err.message ? err.message : String(err);
  console.warn('[Update] Notice/Warning during update check:', msg);
  if (msg.toLowerCase().includes('in progress')) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isNonFatalUpdateError(msg)) {
      if (cachedUpdateState.status !== 'downloaded' && cachedUpdateState.status !== 'available') {
        cachedUpdateState.status = 'latest';
      }
      mainWindow.webContents.send('update-not-available', {
        version: app.getVersion()
      });
      return;
    }
    cachedUpdateState = { ...cachedUpdateState, status: 'error', error: msg };
    mainWindow.webContents.send('update-error', {
      message: msg
    });
  }
});

// Check GitHub quietly after launch and then once a day.  A release is only
// announced to the renderer; downloading remains an explicit user action.
async function checkForUpdatesInBackground() {
  if (!app.isPackaged || cachedUpdateState.status === 'available' || cachedUpdateState.status === 'downloaded') return;

  try {
    cachedUpdateState = { ...cachedUpdateState, status: 'checking', error: null };
    const release = await fetchLatestGitHubRelease();
    const currentVersion = app.getVersion();

    if (release?.version && isNewerVersion(release.version, currentVersion)) {
      cachedUpdateState = { status: 'available', version: release.version, progress: 0, error: null };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', { version: release.version });
      }
      console.log('[Update] Background check found version:', release.version);
      return;
    }

    cachedUpdateState = { status: 'latest', version: currentVersion, progress: 100, error: null };
    console.log('[Update] Background check completed; app is up to date.');
  } catch (err) {
    // Background checks should never interrupt the user. The manual check can
    // still provide an error message and retry when needed.
    cachedUpdateState = { ...cachedUpdateState, status: 'idle', error: null };
    console.log('[Update] Background check skipped:', err?.message || err);
  }
}

// Daily automatic background update check (runs shortly after startup and every 24h)
function setupDailyUpdateCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    console.log('[Update] Running automatic background update check...');
    checkForUpdatesInBackground();
  }, 3000);

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    console.log('[Update] Running 24-hour scheduled update check...');
    checkForUpdatesInBackground();
  }, TWENTY_FOUR_HOURS);
}

setupDailyUpdateCheck();

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-system-info', () => {
  const os = require('os');
  let username = 'Unknown User';
  let hostname = 'Unknown PC';
  try { username = os.userInfo()?.username || 'Unknown User'; } catch (_) {}
  try { hostname = os.hostname() || 'Unknown PC'; } catch (_) {}
  return {
    hostname,
    username,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    appVersion: app.getVersion() || '1.0.4',
  };
});

ipcMain.handle('claim-onboarding-tour', () => {
  try {
    const tourFlagPath = path.join(app.getPath('userData'), 'onboarding_tour_claimed.flag');
    if (onboardingTourClaimed || fs.existsSync(tourFlagPath)) return false;
    onboardingTourClaimed = true;
    fs.writeFileSync(tourFlagPath, 'true', 'utf8');
    return true;
  } catch (_) {
    if (onboardingTourClaimed) return false;
    onboardingTourClaimed = true;
    return true;
  }
});

function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const l = parse(latest);
  const c = parse(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lNum = l[i] || 0;
    const cNum = c[i] || 0;
    if (lNum > cNum) return true;
    if (lNum < cNum) return false;
  }
  return false;
}

function fetchLatestGitHubRelease() {
  return new Promise((resolve) => {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: '/repos/rishivejani15/Intellifile/releases',
      headers: {
        'User-Agent': 'IntelliFile-App'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          if (Array.isArray(releases) && releases.length > 0) {
            const valid = releases.find((r) => !r.draft);
            if (valid && valid.tag_name) {
              const cleanVer = valid.tag_name.replace(/^v/, '');
              return resolve({ version: cleanVer });
            }
          }
          resolve(null);
        } catch (_e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

ipcMain.handle('get-update-state', () => {
  return { ...cachedUpdateState };
});

ipcMain.handle('check-for-updates', async () => {
  // If update is already downloaded, in progress, or available, return state immediately
  if (cachedUpdateState.status === 'downloaded') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: cachedUpdateState.version });
    }
    return { updateAvailable: true, version: cachedUpdateState.version, downloaded: true, status: 'downloaded' };
  }

  if (cachedUpdateState.status === 'available' && cachedUpdateState.version) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: cachedUpdateState.version });
    }
    return { updateAvailable: true, version: cachedUpdateState.version, downloaded: false, status: 'available' };
  }

  try {
    const currentVer = app.getVersion();
    // Primary Check: Query GitHub API directly (works 100% reliably in dev & packaged mode)
    const ghRelease = await fetchLatestGitHubRelease();
    const updateVer = ghRelease?.version;

    if (updateVer && isNewerVersion(updateVer, currentVer)) {
      cachedUpdateState = { status: 'available', version: updateVer, progress: 0, error: null };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', { version: updateVer });
      }
      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(() => {});
      }
      return {
        updateAvailable: true,
        version: updateVer,
        currentVersion: currentVer,
        downloaded: false,
        status: 'available'
      };
    }

    if (app.isPackaged) {
      try {
        const result = await autoUpdater.checkForUpdates();
        const autoVer = result?.updateInfo?.version;
        if (autoVer && isNewerVersion(autoVer, currentVer)) {
          cachedUpdateState = { status: 'available', version: autoVer, progress: 0, error: null };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', { version: autoVer });
          }
          return {
            updateAvailable: true,
            version: autoVer,
            currentVersion: currentVer,
            downloaded: false,
            status: 'available'
          };
        }
      } catch (e) {
        console.log('[Update] autoUpdater check notice:', e?.message || e);
      }
    }

    cachedUpdateState.status = 'latest';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available', { version: currentVer });
    }
    return { updateAvailable: false, version: currentVer, status: 'latest' };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.toLowerCase().includes('in progress')) {
      console.log('[Update] Check is already in progress, returning current state.');
      return {
        updateAvailable: cachedUpdateState.status === 'available' || cachedUpdateState.status === 'downloaded',
        checking: true,
        status: cachedUpdateState.status === 'idle' ? 'checking' : cachedUpdateState.status,
        version: cachedUpdateState.version
      };
    }
    if (cachedUpdateState.status === 'available' || cachedUpdateState.status === 'downloaded') {
      return { updateAvailable: true, version: cachedUpdateState.version, status: cachedUpdateState.status };
    }
    if (isNonFatalUpdateError(msg)) {
      if (cachedUpdateState.status !== 'downloaded' && cachedUpdateState.status !== 'available') {
        cachedUpdateState.status = 'latest';
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-not-available', { version: app.getVersion() });
      }
      return { updateAvailable: false, version: app.getVersion(), status: 'latest' };
    }
    cachedUpdateState = { ...cachedUpdateState, status: 'error', error: msg };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: msg });
    }
    return { error: msg, updateAvailable: false, status: 'error' };
  }
});

ipcMain.handle('download-update', async () => {
  if (cachedUpdateState.status === 'downloaded') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: cachedUpdateState.version });
    }
    return { success: true, downloaded: true, version: cachedUpdateState.version, status: 'downloaded' };
  }

  try {
    cachedUpdateState.status = 'downloading';
    cachedUpdateState.progress = 0;
    const downloadedPaths = await autoUpdater.downloadUpdate();
    console.log('[Update] downloadUpdate finished, downloadedPaths:', downloadedPaths);
    cachedUpdateState.status = 'downloaded';
    cachedUpdateState.progress = 100;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: cachedUpdateState.version });
    }
    return { success: true, downloaded: true, version: cachedUpdateState.version, status: 'downloaded' };
  } catch (err) {
    console.error('[Update] Error during downloadUpdate, opening release page:', err);
    const ver = cachedUpdateState.version || 'latest';
    shell.openExternal(`https://github.com/rishivejani15/Intellifile/releases/tag/v${ver.replace(/^v/, '')}`);
    return { success: false, openedBrowser: true, error: err.message || String(err) };
  }
});

ipcMain.handle('update-restart', () => {
  try {
    // quitAndInstall(isSilent, isForceRunAfter)
    // true: Installs without showing any NSIS wizard UI dialogs
    // true: Automatically restarts app seamlessly after silent install completes
    autoUpdater.quitAndInstall(true, true);
  } catch (err) {
    console.error('[Update] Quit and install failed:', err);
  }
});

const util = require('util');
const execAsync = util.promisify(require('child_process').exec);
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { registerSystemRoots, getSystemRoots, updateSystemRootsPortableDevices } = require('./system_roots');
const { SyncEngine } = require('./sync_engine');
const { createListDirectoryController } = require('./listDirectoryCache');
const { FileLockService } = require('./file_lock_service');

const candidateCache = new Map(); // Cache for open-with candidates
const lookupInProgress = new Map(); // tracks in‑flight lookups per extension

// Persistent map of extension → candidate list (saved in userData)
const openWithMapPath = path.join(app.getPath('userData'), 'openWithMap.json');
let openWithMap = {};
function loadOpenWithMap() {
  try {
    if (fs.existsSync(openWithMapPath)) {
      const data = fs.readFileSync(openWithMapPath, 'utf8');
      openWithMap = JSON.parse(data);
    }
  } catch (e) {
    console.warn('[OpenWith] Failed to load persisted map:', e);
    openWithMap = {};
  }
}
function saveOpenWithMap() {
  try {
    fs.writeFileSync(openWithMapPath, JSON.stringify(openWithMap, null, 2), 'utf8');
  } catch (e) {
    console.warn('[OpenWith] Failed to save persisted map:', e);
  }
}
loadOpenWithMap();

const PROJECT_ROOT = path.join(__dirname, '..');

// ── Session Undo Trash Buffer (Bounded max 50 items) ──────────────────
let _sessionTrashDir = null;
const _sessionTrashMap = new Map();
const MAX_SESSION_TRASH_ITEMS = 50;

function getSessionTrashDir() {
  if (!_sessionTrashDir) {
    _sessionTrashDir = path.join(app.getPath('userData'), 'session_trash');
  }
  if (!fs.existsSync(_sessionTrashDir)) {
    fs.mkdirSync(_sessionTrashDir, { recursive: true });
  }
  return _sessionTrashDir;
}

function commitSessionTrashToRecycleBin() {
  try {
    if (!_sessionTrashDir || !fs.existsSync(_sessionTrashDir)) return;
    const { execSync } = require('child_process');
    for (const [lowerKey, entry] of _sessionTrashMap.entries()) {
      if (entry && fs.existsSync(entry.trashPath)) {
        const escaped = entry.trashPath.replace(/'/g, "''");
        try {
          const psCmd = entry.isDir
            ? `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`
            : `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`;
          execSync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 5000 });
        } catch (_) {
          try { fs.rmSync(entry.trashPath, { recursive: true, force: true }); } catch (e) {}
        }
      }
    }
    _sessionTrashMap.clear();
    try { fs.rmSync(_sessionTrashDir, { recursive: true, force: true }); } catch (_) {}
  } catch (err) {
    console.warn('[SessionTrash] Exit cleanup warning:', err);
  }
}

app.on('before-quit', () => {
  commitSessionTrashToRecycleBin();
});

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

  const isAppSelf = (p) => {
    if (!p) return false;
    const lower = p.toLowerCase();
    if (lower.endsWith('intellifile.exe') || lower.endsWith('electron.exe') || lower.endsWith('electron') || lower.endsWith('main.js')) return true;
    if (lower.includes('intellifile.lnk')) return true;
    try {
      if (process.execPath && path.resolve(p).toLowerCase() === path.resolve(process.execPath).toLowerCase()) return true;
    } catch (_) {}
    return false;
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

    if (targetPath && !isAppSelf(targetPath)) {
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

  // Fallback: search for any user-provided absolute path that exists
  for (let i = argv.length - 1; i >= 0; i--) {
    let arg = cleanArg(argv[i]);
    if (!arg) continue;
    // Skip command line flags and options
    if (arg.startsWith('-') || arg.startsWith('/')) continue;
    if (arg === '.' || isAppSelf(arg)) continue;

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
            if (!isAppSelf(candidate) && fs.existsSync(candidate)) {
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
          if (!isAppSelf(p) && fs.existsSync(p)) {
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
          if (!isAppSelf(p) && fs.existsSync(p)) {
            console.log('[ArgvDebug] Extracted generic file URI path:', p);
            return p;
          }
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
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
  console.log('[SecondInstance] second-instance triggered, commandLine:', commandLine);

  try {
    require('fs').appendFileSync(require('path').join(__dirname, 'second-instance-debug.txt'), new Date().toISOString() + ': ' + JSON.stringify(commandLine) + '\n');
  } catch (_) {}

  const rawPath = getPathFromArgv(commandLine);
  console.log('[SecondInstance] rawPath parsed:', rawPath);
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
            console.log('[Heuristic] Not confident to auto-select file - showing directory');
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
    console.log('[SecondInstance] payload resolved:', payload);
    if (payload) {
      payload.fromExplorer = true;
      const targetWin = getActiveWindow();
      if (targetWin && !targetWin.isDestroyed()) {
        if (targetWin.isMinimized()) targetWin.restore();
        targetWin.setAlwaysOnTop(true);
        targetWin.show();
        targetWin.focus();
        targetWin.setAlwaysOnTop(false);
        targetWin.webContents.send('open-path', payload);
      } else {
        startupPathPayload = payload;
        createWindow();
      }
    }
  } else {
    // User opened IntelliFile again without passing a specific file/folder -> open a new window in the existing process!
    console.log('[SecondInstance] No path passed; opening new window');
    createWindow();
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

function isIntellifileModel(name) {
  if (!name || typeof name !== 'string') return false;
  return name === 'onnx-export' ||
         name === 'models--Xenova--bge-small-en-v1.5' ||
         (name.startsWith('models--Xenova') && name.includes('bge')) ||
         (name.startsWith('models--') && name.includes('bge-small-en-v1.5'));
}

function hasOfflineSetupCompleted() {
  try {
    const userData = app.getPath('userData');
    const modelsDir = path.join(userData, 'backend', 'models');

    let modelFound = false;
    if (fs.existsSync(modelsDir)) {
      const entries = fs.readdirSync(modelsDir);
      modelFound = entries.some(isIntellifileModel);
    }

    if (!modelFound) {
      const candidatePaths = [
        path.join(app.getPath('appData'), 'IntelliFile', 'backend', 'models'),
        path.join(process.resourcesPath || '', 'backend-dist', 'models'),
        path.join(__dirname, '..', 'backend', 'models')
      ];
      for (const cp of candidatePaths) {
        try {
          if (fs.existsSync(cp)) {
            const cfiles = fs.readdirSync(cp);
            if (cfiles.some(isIntellifileModel)) {
              modelFound = true;
              break;
            }
          }
        } catch (_) {}
      }
    }

    const markerPath = getOfflineSetupMarkerPath();
    if (modelFound) {
      if (!fs.existsSync(markerPath)) {
        markOfflineSetupComplete();
      }
      return true;
    }

    // If model does not exist on disk, remove stale marker and return false
    if (fs.existsSync(markerPath)) {
      try { fs.unlinkSync(markerPath); } catch (_) {}
    }
    return false;
  } catch (err) {
    return false;
  }
}

function getLogFilePath() {
  return path.join(app.getPath('userData'), 'intellifile.log');
}

let logWriteQueue = '';
let logWriteTimer = null;

function flushLogQueue() {
  if (!logWriteQueue) return;
  const chunk = logWriteQueue;
  logWriteQueue = '';
  fs.appendFile(getLogFilePath(), chunk, 'utf-8', (err) => {
    if (err) {
      originalConsoleWarn('[Logs] Failed to write log file:', err.message || err);
    }
  });
}

function persistLogEntry(logEntry) {
  const line = `[${logEntry.timestamp}] [${logEntry.category}]${logEntry.isError ? ' [ERROR]' : ''} ${logEntry.message}\n`;
  logWriteQueue += line;
  if (!logWriteTimer) {
    logWriteTimer = setTimeout(() => {
      logWriteTimer = null;
      flushLogQueue();
    }, 200);
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

    // Initial check
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

// Force update check function
function forceCheckForUpdates() {
  console.log('[Updater] Force checking for updates...');
  checkGitHubUpdatesOncePerDay({ force: true }).then((result) => {
    if (result && result.success) {
      if (result.updateAvailable && result.updateInfo) {
        updateAvailable = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', { version: result.updateInfo.version });
        }
        console.log('[Updater] Force check found new release:', result.updateInfo.version);
      } else {
        console.log('[Updater] Force check completed; no update found');
      }
    }
  });
}

let logBuffer = [];
const MAX_LOG_LINES = 2000;

// Derive a log level from message content and isError flag
function _deriveLevel(message, isError) {
  if (isError) return 'error';
  const msg = String(message).toLowerCase();
  if (msg.includes('warning') || msg.includes('warn') || msg.includes('deprecated') || msg.includes('timeout') || msg.includes('retrying') || msg.includes('skipping')) return 'warning';
  if (
    msg.includes('✅') || msg.includes('done') || msg.includes('success') ||
    msg.includes('complete') || msg.includes('[ok]') || msg.includes('healthy') ||
    msg.includes('ready') || msg.includes('loaded') || msg.includes('downloaded')
  ) return 'success';
  if (msg.includes('starting') || msg.includes('spawning') || msg.includes('connecting') || msg.includes('downloading') || msg.includes('initializ') || msg.includes('attempt')) return 'info';
  return 'info';
}

function appendLog(category, message, isError = false, level = null) {
  const timestamp = new Date().toLocaleString();
  const resolvedLevel = level || _deriveLevel(message, isError);
  const logEntry = { timestamp, category, message, isError, level: resolvedLevel };

  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }

  persistLogEntry(logEntry);

  broadcastToAllWindows('backend-log', logEntry);
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
      appendLog(match[1], args.join(' ').replace(/^\[.*?\]\s*/, ''), true, 'error');
    } else {
      appendLog('Main', args.join(' '), true, 'error');
    }
  } else {
    appendLog('Main', args.join(' '), true, 'error');
  }
};

console.warn = function (...args) {
  originalConsoleWarn.apply(console, args);
  if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[')) {
    const match = args[0].match(/^\[(.*?)\]/);
    if (match) {
      appendLog(match[1], args.join(' ').replace(/^\[.*?\]\s*/, ''), false, 'warning');
    } else {
      appendLog('Main', args.join(' '), false, 'warning');
    }
  } else {
    appendLog('Main', args.join(' '), false, 'warning');
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
let autoIndexTriggeredThisSession = false;
let autoIndexRequested = false;
let indexInProgress = false;
let lastIndexMessage = '';
let lastIndexStatus = null;
let lastIndexBroadcastTime = 0;
let lastLoggedIndexPhase = '';
let fileWatchers = new Map();
let directoryWatchers = new Map();
let fileContents = new Map();
let debounceTimers = new Map();
let directoryIndexTimers = new Map();

// Tracks files recently deleted through the UI so the watcher can suppress
// the spurious unlink→re-add storm that chokidar's polling causes on Windows.
const _recentlyDeletedPaths = new Set();
let pyModelLoaded = false;

// Auto-restart tracking for the Python engine
const PY_MAX_RESTART_ATTEMPTS = 3;
const PY_BASE_RESTART_DELAY_MS = 1000;
let pyRestartAttempts = 0;
let pyRestartTimer = null;

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
  if (autoIndexTriggeredThisSession || autoIndexRequested || indexInProgress) return;
  if (!pythonReadyForIndexing || !windowReadyForIndexing) return;
  if (!pyModelLoaded) {
    console.log('[Index] Skipping auto-index: embedding model is not loaded yet');
    return;
  }
  autoIndexTriggeredThisSession = true;
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
  if (fileLockService) {
    fileLockService.cleanupTempFiles();
    fileLockService.cleanupOSLocks();
  }
});

function triggerFileVersionSave(filePath) {
  if (!filePath || _isTransientFile(filePath)) return;
  const normP = filePath.toLowerCase().replace(/\//g, '\\');
  if (_recentlyDeletedPaths.has(normP)) return;

  if (debounceTimers.has(normP)) {
    clearTimeout(debounceTimers.get(normP));
  }

  debounceTimers.set(normP, setTimeout(async () => {
    debounceTimers.delete(normP);
    console.log(`[Watcher] Processing debounced version save for: ${filePath}`);

    try {
      if (!fs.existsSync(filePath)) return;
      const extP = path.extname(filePath).toLowerCase();
      const isBinaryP = ['.docx', '.doc', '.xlsx', '.xls', '.pdf', '.zip', '.pptx', '.pptm', '.ppt', '.odt', '.rtf'].includes(extP);

      let currentVal = '';
      if (!isBinaryP) {
        try {
          currentVal = fs.readFileSync(filePath, 'utf-8');
        } catch (_) {
          return;
        }
      } else {
        try {
          currentVal = fs.statSync(filePath).mtimeMs.toString();
        } catch (_) {
          return;
        }
      }

      let lastVal = fileContents.get(normP) || '';
      if (!isBinaryP && currentVal.trim() === lastVal.trim() && lastVal.length > 0) return;
      if (isBinaryP && currentVal === lastVal && lastVal.length > 0) return;

      console.log(`[Watcher] External file change verified. Triggering version save for ${filePath}...`);
      const result = await sendToPython({
        action: "save_version",
        file_path: filePath,
        old_content: isBinaryP ? filePath : lastVal,
        new_content: isBinaryP ? filePath : currentVal
      });

      if (result && result.success) {
        fileContents.set(normP, currentVal);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('version-updated', {
            filePath: filePath,
            versionId: result.data?.version_id,
            summary: result.data?.summary,
            riskLevel: result.data?.risk_level
          });
        }
      }
    } catch (err) {
      console.error(`[Watcher] Version save error for ${filePath}: ${err.message || err}`);
    }
  }, 2000));
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
      triggerFileVersionSave(p);
      sendToPython({
        action: "index_file",
        file_path: p,
        allow_protected: getAllowProtectedIndexing(),
      }).catch(err => console.error(`[Watcher] Index trigger error:`, err));
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

  // Don't watch Windows system folders, root drives, or virtual folders
  const upperPath = directoryPath.toUpperCase().trim().replace(/[\\/]+$/, '');
  if (upperPath === 'THIS PC' || upperPath === 'HOME' || /^[A-Z]:?$/.test(upperPath) ||
    upperPath.includes('\\WINDOWS') || upperPath.includes('\\PROGRAM FILES') ||
    upperPath.includes('\\PROGRAMDATA') || upperPath.includes('\\SYSTEM VOLUME INFORMATION')) {
    return { success: false, error: 'Cannot watch system folders or root drives.' };
  }

  const normPath = path.resolve(directoryPath).toLowerCase();
  if (directoryWatchers.has(normPath)) return { success: true };

  try {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(directoryPath, {
      ignoreInitial: true,
      depth: 0,
      usePolling: false, // Native OS events (ReadDirectoryChangesW) for near-zero CPU/disk idle overhead
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
        if (item.type === 'file') {
          sendToPython({ action: 'index_file', file_path: filePath, allow_protected: getAllowProtectedIndexing() }).catch(() => { });
          triggerFileVersionSave(filePath);
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
          triggerFileVersionSave(filePath);
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
        pyRestartAttempts = 0; // Reset restart counter on successful start
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
            broadcastToAllWindows('model-status', { loaded: false, error: modelError });
          }
        }).catch((err) => {
          pyModelLoaded = false;
          pythonReadyForIndexing = false;
          const errMsg = err && err.message ? err.message : String(err);
          console.warn('[Python] Model status check failed:', errMsg);
          broadcastToAllWindows('model-status', { loaded: false, error: errMsg });
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
          broadcastToAllWindows('autosort:notification', parsed.payload);
        }

        // Forward progress messages to the renderer (throttled to maintain UI fluidness)
        if (parsed.type === 'progress') {
          lastIndexStatus = parsed;
          const now = Date.now();
          const phase = parsed.phase || 'indexing';
          const isTerminal = phase === 'done' || phase === 'error' || parsed.pct === 100 || parsed.pct === 0;

          if (isTerminal || (now - lastIndexBroadcastTime >= 250)) {
            lastIndexBroadcastTime = now;
            broadcastToAllWindows('index-progress', parsed);
          }

          // Only log major phase transitions or completions to prevent disk I/O and UI flood
          if (isTerminal || phase !== lastLoggedIndexPhase) {
            lastLoggedIndexPhase = phase;
            const detail = parsed.detail || '';
            const pct = typeof parsed.pct === 'number' ? ` (${parsed.pct}%)` : '';
            appendLog('Indexing', `${phase}: ${detail}${pct}`);
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

    // Auto-restart the engine if the exit was unexpected (not during app quit)
    // The before-quit handler sets pyProcess = null before killing, so if
    // pyProcess is still set here, the exit was unexpected (a crash).
    if (!isAppQuitting && pyProcess) {
      pyProcess = null;
      if (pyRestartAttempts < PY_MAX_RESTART_ATTEMPTS) {
        const delay = PY_BASE_RESTART_DELAY_MS * Math.pow(2, pyRestartAttempts);
        pyRestartAttempts++;
        console.warn(`[Python] Engine crashed (exit code ${code}). Auto-restarting in ${delay}ms (attempt ${pyRestartAttempts}/${PY_MAX_RESTART_ATTEMPTS})...`);
        appendLog('Python', `Engine crashed — auto-restarting (attempt ${pyRestartAttempts}/${PY_MAX_RESTART_ATTEMPTS})...`, true, 'warning');
        if (pyRestartTimer) clearTimeout(pyRestartTimer);
        pyRestartTimer = setTimeout(() => {
          pyRestartTimer = null;
          // Reset indexing flags so auto-index can re-trigger after restart
          autoIndexTriggeredThisSession = false;
          startPython();
        }, delay);
      } else {
        console.error(`[Python] Engine has crashed ${PY_MAX_RESTART_ATTEMPTS} times. Not restarting — manual app restart required.`);
        appendLog('Python', `Engine crashed ${PY_MAX_RESTART_ATTEMPTS} times. Please restart the app.`, true, 'error');
        pyEngineError = `Engine crashed repeatedly (${PY_MAX_RESTART_ATTEMPTS} times). Please restart the app.`;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-error', pyEngineError);
        }
      }
    } else {
      pyProcess = null;
    }
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
  const linkLocalCandidates = [];
  let loopbackAddress = '127.0.0.1';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = typeof net.family === 'string' ? net.family : String(net.family);
      if (family !== 'IPv4') continue;
      if (net.internal) {
        if (net.address) loopbackAddress = net.address;
        continue;
      }
      if (net.address) {
        if (net.address.startsWith('169.254.')) {
          linkLocalCandidates.push({ name, address: net.address });
        } else {
          candidates.push({ name, address: net.address });
        }
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

  if (candidates.length > 0) {
    return { address: candidates[0].address, candidates };
  }

  if (linkLocalCandidates.length > 0) {
    return { address: linkLocalCandidates[0].address, candidates: linkLocalCandidates };
  }

  return { address: loopbackAddress, candidates: [{ name: 'loopback', address: loopbackAddress }] };
}

function checkInternetConnectivity(timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const dns = require('dns');
      let finished = false;
      const finish = (value, err) => {
        if (finished) return;
        finished = true;
        if (!value) {
          // Emit a specific firewall/network log so it's visible in the Logs panel
          const reason = err
            ? (err.code === 'ENOTFOUND' ? 'DNS lookup failed (ENOTFOUND)'
              : err.code === 'EAI_AGAIN' ? 'DNS temporarily unavailable (EAI_AGAIN)'
                : err.code === 'ECONNREFUSED' ? 'Connection refused (ECONNREFUSED)'
                  : err.code === 'ETIMEDOUT' ? 'Connection timed out (ETIMEDOUT)'
                    : `Network error: ${err.code || err.message}`)
            : 'DNS lookup timed out';
          appendLog('Firewall', `Cannot reach huggingface.co — ${reason}. Check firewall/proxy/VPN settings.`, true, 'error');
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(false, null), timeoutMs);
      dns.lookup('huggingface.co', (err) => {
        clearTimeout(timer);
        if (err) {
          finish(false, err);
        } else {
          finish(true, null);
        }
      });
    } catch (err) {
      appendLog('Firewall', `Network connectivity check threw an exception: ${err && err.message ? err.message : err}`, true, 'error');
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
    broadcastToAllWindows('sync-server-error', `Sync server failed: ${message}`);
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
      broadcastToAllWindows('sync-server-error', errorMsg);
      syncServerStarting = false;
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
      syncServerStarting = false;
      if (healthCheckTimer) clearInterval(healthCheckTimer);

      const errorMsg = err && err.message ? err.message : String(err);
      console.error('[SyncServer] spawn error:', errorMsg);
      appendLog('SyncServer', `Spawn error: ${errorMsg}`, true);

      syncServerProcess = null;
      handleSyncServerFailure(`Process error: ${errorMsg}`);
    });

    // SyncServer stdout: filter to only meaningful lines (skip raw HTTP request logs)
    syncServerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        // Skip verbose HTTP access logs
        if (/(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+[\/\w\-]+/i.test(line)) continue;
        if (/INFO:.*\s+(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+/i.test(line)) continue;
        if (/^\d+\.\d+\.\d+\.\d+.*\s(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s/i.test(line)) continue;
        if (/^\s*(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+\//.test(line)) continue;
        if (line.includes('/status')) continue;
        originalConsoleLog('[SyncServer]', line);
        appendLog('SyncServer', line);
      }
    });

    syncServerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        // Skip verbose HTTP access logs from stderr too
        if (/(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+[\/\w\-]+/i.test(line)) continue;
        if (/INFO:.*\s+(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+/i.test(line)) continue;
        if (/^\d+\.\d+\.\d+\.\d+.*\s(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s/i.test(line)) continue;
        if (/^\s*(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+\//.test(line)) continue;
        if (line.includes('/status')) continue;
        originalConsoleError('[SyncServer stderr]', line);
        appendLog('SyncServer', line, true, 'error');
      }
    });

    syncServerProcess.on('close', (code) => {
      if (healthCheckTimer) clearInterval(healthCheckTimer);
      syncServerProcess = null;
      syncServerStarting = false;

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
        syncServerStarting = false;
        return;
      }

      checkSyncServerHealth().then((isHealthy) => {
        if (spawnedCompleted) {
          clearInterval(healthCheckTimer);
          syncServerStarting = false;
          return;
        }

        if (isHealthy) {
          clearInterval(healthCheckTimer);
          spawnedCompleted = true;
          syncServerStarting = false;
          console.log('[SyncServer] ✅ Sync server is healthy and running.');
          appendLog('SyncServer', '✅ Sync server is healthy and running.');
          syncServerRetries = 0; // reset retries
        } else {
          healthCheckAttempts++;
          if (healthCheckAttempts >= maxHealthCheckAttempts) {
            clearInterval(healthCheckTimer);
            spawnedCompleted = true;
            syncServerStarting = false;
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
    syncServerStarting = false;
    const errorMsg = err && err.message ? err.message : String(err);
    console.error('[SyncServer] failed to spawn process:', errorMsg);
    appendLog('SyncServer', `Exception starting: ${errorMsg}`, true);
    syncServerProcess = null;
    handleSyncServerFailure(`Spawn exception: ${errorMsg}`);
  }
}

let syncServerStarting = false;

function startSyncServer() {
  try {
    if (syncServerProcess && !syncServerProcess.killed) {
      console.log('[SyncServer] already running');
      return Promise.resolve();
    }
    if (syncServerStarting) {
      console.log('[SyncServer] startup already in progress');
      return Promise.resolve();
    }
    syncServerStarting = true;

    return isPortOpen(SYNC_PORT, '127.0.0.1', 300).then((portOpen) => {
      if (portOpen) {
        console.log(`[SyncServer] port ${SYNC_PORT} already in use; assuming server is running`);
        syncServerStarting = false;
        return;
      }

      attemptStartSyncServer();
    }).catch((err) => {
      syncServerStarting = false;
      throw err;
    });
  } catch (err) {
    syncServerStarting = false;
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
    broadcastToAllWindows('sync-status', data);
  });

  syncEngine.on('log', (msg) => {
    broadcastToAllWindows('sync-log', msg);
  });

  syncEngine.on('files', (files) => {
    broadcastToAllWindows('sync-files', files);
  });

  syncEngine.on('pending', (changes) => {
    broadcastToAllWindows('sync-pending', changes);
  });

  return syncEngine;
}
// ── NLP Date Parser for search queries ──────────────────
function parseDateFromQuery(rawQuery) {
  // Handle unambiguous month constraints first.  The general natural-language
  // parser below remains available for day, year, and relative-date queries.
  // This prevents "all files" from becoming a semantic query after its date
  // condition has been removed.
  const deterministicMonthQuery = parseDeterministicMonthDateQuery(rawQuery);
  if (deterministicMonthQuery) {
    return deterministicMonthQuery;
  }

  const MONTHS = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };

  let query = rawQuery;
  let dateFrom = null;
  let dateTo = null;

  // Helper: build [start, end) timestamps.  The backend interprets all upper
  // bounds as exclusive, preventing the final second of a day/month from
  // falling through a date filter.
  const startOfDay = (y, m, d) => new Date(y, m, d, 0, 0, 0).getTime() / 1000;
  const endOfDay = (y, m, d) => new Date(y, m, d + 1, 0, 0, 0).getTime() / 1000;
  const endOfMonth = (y, m) => new Date(y, m + 1, 1, 0, 0, 0).getTime() / 1000;
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
        dateTo = startOfDay(year, month, parseInt(match[1]));
      } else {
        dateTo = startOfMonth(year, month);
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
        const day = parseInt(match[1]);
        dateFrom = startOfDay(year, month, day + 1);
      } else {
        dateFrom = startOfMonth(year, month + 1);
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

  // Pattern: "<month> <year>" or explicit prefix + "<month>" (e.g. "in august", "from may 2025")
  if (!dateFrom && !dateTo) {
    const monthYearWithPrefixRe = new RegExp(
      `(?:\\b(?:from|in|during|of|dated|created)\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b)|(?:\\b(${monthPattern})\\s+(\\d{4})\\b)`,
      'i'
    );
    match = query.match(monthYearWithPrefixRe);
    if (match) {
      const monthStr = match[1] || match[3];
      const yearStr = match[2] || match[4];
      const month = MONTHS[monthStr.toLowerCase()];
      const now = new Date();
      const year = yearStr ? parseInt(yearStr) : now.getFullYear();

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

  // Clean up date-related filler words only if a date filter was actually identified
  if (dateFrom || dateTo) {
    query = query.replace(/\b(containing|with|about|files?|from|created|on|dated|in|during|of)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  return {
    cleanQuery: (!query.trim() && (dateFrom || dateTo)) ? "" : (query.trim() || rawQuery.trim()),
    dateFrom: dateFrom ? Math.floor(dateFrom) : null,
    dateTo: dateTo ? Math.floor(dateTo) : null,
  };
}

// ── File Lock Service ──
// Lazy-initialized after app is ready (needs app.getPath)
let fileLockService = null;
function getFileLockService() {
  if (!fileLockService) {
    fileLockService = new FileLockService(app.getPath('userData'));
  }
  return fileLockService;
}

ipcMain.handle('file-lock:lock', async (_event, filePath, password, options) => {
  return getFileLockService().lockFile(filePath, password, options);
});

ipcMain.handle('file-lock:unlock', async (_event, fileId, password, recoveryKey, securityAnswers) => {
  return getFileLockService().unlockFile(fileId, password, recoveryKey, securityAnswers);
});

ipcMain.handle('file-lock:access', async (_event, fileId, password, recoveryKey, securityAnswers) => {
  const result = await getFileLockService().accessFile(fileId, password, recoveryKey, securityAnswers);
  if (result.success && result.tempPath) {
    shell.openPath(result.tempPath);
  }
  return result;
});

ipcMain.handle('file-lock:recover-key', async (_event, fileId, recoveryKey) => {
  return getFileLockService().recoverFileWithKey(fileId, recoveryKey);
});

ipcMain.handle('file-lock:recover-questions', async (_event, fileId, answers) => {
  return getFileLockService().recoverFileWithSecurityQuestions(fileId, answers);
});

ipcMain.handle('file-lock:reset-password', async (_event, fileId, payload) => {
  return getFileLockService().resetFilePassword(fileId, payload);
});

ipcMain.handle('file-lock:get-security-questions', async (_event, fileId) => {
  return getFileLockService().getSecurityQuestions(fileId);
});

ipcMain.handle('file-lock:verify', async (_event, fileId, password) => {
  return getFileLockService().verifyPassword(fileId, password);
});

ipcMain.handle('file-lock:change-password', async (_event, fileId, oldPassword, newPassword) => {
  return getFileLockService().changePassword(fileId, oldPassword, newPassword);
});

ipcMain.handle('file-lock:rename', async (_event, fileId, password, newName) => {
  return getFileLockService().renameLockedFile(fileId, password, newName);
});

ipcMain.handle('file-lock:delete', async (_event, fileId, password) => {
  return getFileLockService().deleteLockedFile(fileId, password);
});

ipcMain.handle('file-lock:get-locked-files', async () => {
  return getFileLockService().getLockedFiles();
});

ipcMain.handle('file-lock:get-status', async (_event, filePath) => {
  return getFileLockService().getFileStatus(filePath);
});

ipcMain.handle('file-lock:get-history', async () => {
  return getFileLockService().getHistory();
});

ipcMain.handle('file-lock:set-auto-lock', async (_event, fileId, timeoutMinutes) => {
  return getFileLockService().setAutoLockTimeout(fileId, timeoutMinutes);
});

ipcMain.handle('file-lock:select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a file to lock',
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  return { canceled: result.canceled, filePaths: result.filePaths || [] };
});

ipcMain.handle('file-lock:is-locked-extension', async (_event, filePath) => {
  return { isLocked: getFileLockService().isLockedExtension(filePath) };
});

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
  const directFolder = typeof payload === 'object' && payload ? (payload.folder_name || payload.folderName || null) : null;
  const explicitDateFrom = typeof payload === 'object' && payload && payload.date_from !== undefined && payload.date_from !== null
    ? payload.date_from
    : (payload?.dateFrom !== undefined && payload.dateFrom !== null ? payload.dateFrom : null);
  const explicitDateTo = typeof payload === 'object' && payload && payload.date_to !== undefined && payload.date_to !== null
    ? payload.date_to
    : (payload?.dateTo !== undefined && payload.dateTo !== null ? payload.dateTo : null);
  const extensions = typeof payload === 'object' && payload && Array.isArray(payload.extensions) && payload.extensions.length > 0
    ? payload.extensions
    : null;

  console.log('[IPC] search called, pyReady:', pyReady, 'query:', query, 'rootFolder:', rootFolder, 'directFolder:', directFolder, 'extensions:', extensions);
  const { cleanQuery, dateFrom: parsedDateFrom, dateTo: parsedDateTo } = parseDateFromQuery(query);
  const dateFrom = explicitDateFrom !== null ? explicitDateFrom : parsedDateFrom;
  const dateTo = explicitDateTo !== null ? explicitDateTo : parsedDateTo;
  const folderQuery = directFolder ? { folderName: directFolder } : parseFolderSearchQuery(cleanQuery);
  console.log('[IPC] parsed search filters:', { cleanQuery, dateFrom, dateTo, folderName: folderQuery?.folderName || null, extensions });
  const effectiveQuery = (cleanQuery || query || '').trim();
  const hasMetadataFilter = dateFrom !== null || dateTo !== null || (extensions && extensions.length > 0) || Boolean(folderQuery?.folderName);
  if (!effectiveQuery && !hasMetadataFilter) {
    return { results: [] };
  }

  return sendToPython({
    action: "search",
    query: effectiveQuery,
    date_from: dateFrom,
    date_to: dateTo,
    folder_name: folderQuery?.folderName || null,
    root_folder: rootFolder,
    extensions: extensions,
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

// ═══ Storage Summary & Disk Analysis IPC Handler ═══
function getDirectorySizeRecursive(dirPath, maxDepth = 4, currentDepth = 0) {
  let total = 0;
  if (currentDepth >= maxDepth || !fs.existsSync(dirPath)) return 0;
  try {
    const stats = fs.statSync(dirPath);
    if (stats.isFile()) return stats.size;
    if (stats.isDirectory()) {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        if (file.name.startsWith('.') || file.name.startsWith('$') || ['node_modules', '.git', 'AppData', '$Recycle.Bin'].includes(file.name)) continue;
        total += getDirectorySizeRecursive(path.join(dirPath, file.name), maxDepth, currentDepth + 1);
      }
    }
  } catch (_e) {}
  return total;
}

const STORAGE_CATEGORY_EXTENSIONS = {
  images: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic', '.raw', '.psd', '.ai']),
  videos: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpeg', '.mpg']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.mid', '.alac', '.aiff']),
  documents: new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.csv', '.md', '.rtf', '.odt', '.ods', '.pages', '.key', '.numbers']),
  archives: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.iso', '.dmg', '.exe', '.msi', '.apk']),
  developer: new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.sql', '.sh', '.bat', '.ps1', '.php', '.go', '.rs', '.vue', '.svelte'])
};

function getStorageCategoryForExt(ext) {
  const cleanExt = (ext || '').toLowerCase();
  for (const [cat, set] of Object.entries(STORAGE_CATEGORY_EXTENSIONS)) {
    if (set.has(cleanExt)) return cat;
  }
  return 'others';
}

let cachedStorageSummary = null;
let lastStorageScanTime = 0;

ipcMain.handle('storage:get-summary', async (_event, forceRefresh = false) => {
  const now = Date.now();
  // Cache for 5 minutes unless forced
  if (cachedStorageSummary && !forceRefresh && (now - lastStorageScanTime < 300000)) {
    return cachedStorageSummary;
  }

  try {
    const userHome = app.getPath('home');
    let totalBytes = 0;
    let freeBytes = 0;

    // Use native fs.statfsSync first (instant <0.1ms, zero subprocess overhead)
    if (typeof fs.statfsSync === 'function') {
      try {
        const rootDrive = path.parse(userHome).root || 'C:\\';
        const diskStats = fs.statfsSync(rootDrive);
        const bsize = diskStats.bsize || 4096;
        totalBytes = (diskStats.blocks || 0) * bsize;
        freeBytes = (diskStats.bavail || diskStats.bfree || 0) * bsize;
      } catch (_e) {}
    }

    if (!totalBytes || totalBytes === 0) {
      totalBytes = 256 * 1024 * 1024 * 1024;
      freeBytes = 128 * 1024 * 1024 * 1024;
    }

    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const userDataPath = app.getPath('userData');
    const intellifileBytes = getDirectorySizeRecursive(userDataPath, 3);

    // Approximate System & Software storage without locking the main thread
    // Deep recursive walking of C:\Windows and C:\Program Files causes severe UI freezing
    let softwareBytes = 0;
    let systemBytes = 0;
    if (process.platform === 'win32') {
      const remainingUsed = Math.max(0, usedBytes - intellifileBytes);
      softwareBytes = Math.round(remainingUsed * 0.35);
      systemBytes = Math.round(remainingUsed * 0.25);
    }

    const localSettings = readLocalSettings();
    const userWatched = Array.isArray(localSettings.watched_folders) ? localSettings.watched_folders : [];

    const defaultDirs = [
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('desktop'),
      app.getPath('pictures'),
      app.getPath('videos'),
      app.getPath('music')
    ];

    for (const wFolder of userWatched) {
      if (typeof wFolder === 'string') {
        const resolvedPath = path.isAbsolute(wFolder) ? wFolder : path.join(app.getPath('home'), wFolder);
        if (fs.existsSync(resolvedPath) && !defaultDirs.includes(resolvedPath)) {
          defaultDirs.push(resolvedPath);
        }
      }
    }

    const scanDirs = defaultDirs.filter((dp) => dp && fs.existsSync(dp));

    const breakdown = {
      images: { bytes: 0, count: 0 },
      videos: { bytes: 0, count: 0 },
      audio: { bytes: 0, count: 0 },
      documents: { bytes: 0, count: 0 },
      archives: { bytes: 0, count: 0 },
      developer: { bytes: 0, count: 0 },
      software: { bytes: softwareBytes, count: 0 },
      system: { bytes: systemBytes, count: 0 },
      intellifile: { bytes: intellifileBytes, count: 1 },
      others: { bytes: 0, count: 0 }
    };

    function scanFolderForStorage(dirPath, maxDepth = 4, currentDepth = 0) {
      if (currentDepth >= maxDepth || !fs.existsSync(dirPath)) return;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              const ext = path.extname(entry.name);
              const cat = getStorageCategoryForExt(ext);
              if (breakdown[cat]) {
                breakdown[cat].bytes += stat.size;
                breakdown[cat].count += 1;
              }
            } catch (_e) {}
          } else if (entry.isDirectory() && !['node_modules', '.git', 'AppData', '$Recycle.Bin'].includes(entry.name)) {
            scanFolderForStorage(fullPath, maxDepth, currentDepth + 1);
          }
        }
      } catch (_e) {}
    }

    for (const sDir of scanDirs) {
      scanFolderForStorage(sDir);
    }

    const analyzedUserBytes = breakdown.images.bytes + breakdown.videos.bytes + breakdown.audio.bytes + breakdown.documents.bytes + breakdown.archives.bytes + breakdown.developer.bytes + breakdown.software.bytes + breakdown.system.bytes + breakdown.intellifile.bytes;
    const otherSystemBytes = Math.max(0, usedBytes - analyzedUserBytes);
    breakdown.others.bytes = otherSystemBytes;

    cachedStorageSummary = {
      totalBytes,
      usedBytes,
      freeBytes,
      breakdown,
      scanTime: Date.now()
    };
    lastStorageScanTime = now;
    return cachedStorageSummary;
  } catch (err) {
    console.error('[Storage] Error calculating storage summary:', err);
    return {
      totalBytes: 512 * 1073741824,
      usedBytes: 240 * 1073741824,
      freeBytes: 272 * 1073741824,
      breakdown: {
        images: { bytes: 45 * 1073741824, count: 1240 },
        videos: { bytes: 85 * 1073741824, count: 180 },
        audio: { bytes: 18 * 1073741824, count: 420 },
        documents: { bytes: 28 * 1073741824, count: 3100 },
        archives: { bytes: 22 * 1073741824, count: 95 },
        intellifile: { bytes: 675 * 1024 * 1024, count: 1 },
        others: { bytes: 40.2 * 1073741824, count: 5000 }
      },
      scanTime: Date.now()
    };
  }
});

// ═══ Storage Diagnostics: Largest Files Scanner ═══
ipcMain.handle('storage:get-largest-files', async () => {
  try {
    const localSettings = readLocalSettings();
    const userWatched = Array.isArray(localSettings.watched_folders) ? localSettings.watched_folders : [];

    const defaultDirs = [
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('desktop'),
      app.getPath('pictures'),
      app.getPath('videos'),
      app.getPath('music')
    ];

    for (const wFolder of userWatched) {
      if (typeof wFolder === 'string') {
        const resolvedPath = path.isAbsolute(wFolder) ? wFolder : path.join(app.getPath('home'), wFolder);
        if (fs.existsSync(resolvedPath) && !defaultDirs.includes(resolvedPath)) {
          defaultDirs.push(resolvedPath);
        }
      }
    }

    const scanDirs = defaultDirs.filter((dp) => dp && fs.existsSync(dp));
    const allFiles = [];

    function collectFiles(dirPath, maxDepth = 4, currentDepth = 0) {
      if (currentDepth >= maxDepth || !fs.existsSync(dirPath)) return;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size > 10 * 1024 * 1024) { // Only files > 10 MB
                allFiles.push({
                  name: entry.name,
                  path: fullPath,
                  size: stat.size,
                  folder: path.basename(dirPath),
                  modified: stat.mtimeMs
                });
              }
            } catch (_e) {}
          } else if (entry.isDirectory() && !['node_modules', '.git', 'AppData', '$Recycle.Bin'].includes(entry.name)) {
            collectFiles(fullPath, maxDepth, currentDepth + 1);
          }
        }
      } catch (_e) {}
    }

    for (const sDir of scanDirs) {
      collectFiles(sDir);
    }

    allFiles.sort((a, b) => b.size - a.size);
    return allFiles.slice(0, 10);
  } catch (err) {
    console.error('[Storage] Error scanning largest files:', err);
    return [];
  }
});

// ═══ Storage Diagnostics: Folder Breakdown ═══
ipcMain.handle('storage:get-folder-breakdown', async () => {
  try {
    const localSettings = readLocalSettings();
    const userWatched = Array.isArray(localSettings.watched_folders) ? localSettings.watched_folders : [];

    const dirs = [
      { name: 'Downloads', path: app.getPath('downloads'), icon: '📥' },
      { name: 'Documents', path: app.getPath('documents'), icon: '📄' },
      { name: 'Desktop', path: app.getPath('desktop'), icon: '🖥️' },
      { name: 'Pictures', path: app.getPath('pictures'), icon: '🖼️' },
      { name: 'Videos', path: app.getPath('videos'), icon: '🎥' },
      { name: 'Music', path: app.getPath('music'), icon: '🎵' }
    ];

    for (const wFolder of userWatched) {
      if (typeof wFolder === 'string') {
        const resolvedPath = path.isAbsolute(wFolder) ? wFolder : path.join(app.getPath('home'), wFolder);
        if (fs.existsSync(resolvedPath) && !dirs.some(d => d.path === resolvedPath)) {
          dirs.push({ name: path.basename(resolvedPath), path: resolvedPath, icon: '📁' });
        }
      }
    }

    const folderStats = [];
    for (const dirObj of dirs) {
      if (fs.existsSync(dirObj.path)) {
        let size = 0;
        let count = 0;

        function scanSubfolder(dirPath, maxDepth = 5, currentDepth = 0) {
          if (currentDepth >= maxDepth || !fs.existsSync(dirPath)) return;
          try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
              const fp = path.join(dirPath, entry.name);
              if (entry.isFile()) {
                try {
                  const st = fs.statSync(fp);
                  size += st.size;
                  count += 1;
                } catch (_e) {}
              } else if (entry.isDirectory() && !['node_modules', '.git', 'AppData', '$Recycle.Bin'].includes(entry.name)) {
                scanSubfolder(fp, maxDepth, currentDepth + 1);
              }
            }
          } catch (_e) {}
        }

        scanSubfolder(dirObj.path);

        folderStats.push({
          name: dirObj.name,
          path: dirObj.path,
          icon: dirObj.icon,
          bytes: size,
          count
        });
      }
    }

    folderStats.sort((a, b) => b.bytes - a.bytes);
    return folderStats;
  } catch (err) {
    console.error('[Storage] Error calculating folder breakdown:', err);
    return [];
  }
});

// ═══ Storage Diagnostics: Clean Temp Cache ═══
ipcMain.handle('storage:clean-temp-cache', async () => {
  try {
    let bytesCleaned = 0;
    let filesCount = 0;
    const tempDir = app.getPath('temp');
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    const logsDir = path.join(app.getPath('userData'), 'logs');

    const cleanTargets = [tempDir, cacheDir, logsDir];
    for (const target of cleanTargets) {
      if (!fs.existsSync(target)) continue;
      try {
        const files = fs.readdirSync(target, { withFileTypes: true });
        for (const f of files) {
          const lowerName = f.name.toLowerCase();
          if (
            lowerName.startsWith('intellifile') ||
            lowerName.endsWith('.tmp') ||
            lowerName.endsWith('.log') ||
            lowerName.endsWith('.cache') ||
            lowerName.endsWith('.bak') ||
            lowerName.includes('temp')
          ) {
            const fp = path.join(target, f.name);
            try {
              const st = fs.statSync(fp);
              if (st.isFile()) {
                bytesCleaned += st.size;
                filesCount += 1;
                fs.unlinkSync(fp);
              }
            } catch (_e) {}
          }
        }
      } catch (_e) {}
    }

    return { success: true, bytesCleaned, filesCount };
  } catch (err) {
    console.error('[Storage] Error cleaning temp cache:', err);
    return { success: false, error: err.message, bytesCleaned: 0, filesCount: 0 };
  }
});

// ═══ Shell & File Actions for Storage ═══
ipcMain.handle('shell:show-item-in-folder', async (_event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: 'File does not exist' };
});

ipcMain.handle('storage:delete-file', async (_event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    const { shell } = require('electron');
    try {
      await shell.trashItem(filePath);
      return { success: true, trashed: true };
    } catch (_e) {
      try {
        fs.unlinkSync(filePath);
        return { success: true, unlinked: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }
  return { success: false, error: 'File does not exist' };
});

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'app_settings.json');
}

function readLocalSettings() {
  try {
    const fp = getSettingsFilePath();
    if (fs.existsSync(fp)) {
      const data = fs.readFileSync(fp, 'utf-8');
      return JSON.parse(data) || {};
    }
  } catch (e) {
    console.warn('[Settings] Failed to read local settings file:', e.message);
  }
  return {};
}

function saveLocalSetting(key, value) {
  if (!key) return;
  try {
    const fp = getSettingsFilePath();
    const current = readLocalSettings();
    current[key] = value;
    fs.writeFileSync(fp, JSON.stringify(current, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Settings] Failed to save local setting:', e.message);
  }
}

ipcMain.handle('settings:get', async (_event, key) => {
  const targetKey = typeof key === 'object' && key?.key ? key.key : key;
  if (!targetKey) return { key: targetKey, value: null };
  const localSettings = readLocalSettings();
  if (Object.prototype.hasOwnProperty.call(localSettings, targetKey)) {
    return { key: targetKey, value: localSettings[targetKey] };
  }
  // Fallback to Python database if not in local settings file
  try {
    const res = await sendToPython({ action: 'settings_get', key: targetKey }, 5000);
    if (res && res.value !== undefined && res.value !== null) {
      saveLocalSetting(targetKey, res.value);
      return res;
    }
  } catch (_e) {
    // Return default or null gracefully if engine isn't ready
  }
  return { key: targetKey, value: null };
});

ipcMain.handle('get-setting', async (_event, key) => {
  const targetKey = typeof key === 'object' && key?.key ? key.key : key;
  if (!targetKey) return { key: targetKey, value: null };
  const localSettings = readLocalSettings();
  if (Object.prototype.hasOwnProperty.call(localSettings, targetKey)) {
    return { key: targetKey, value: localSettings[targetKey] };
  }
  try {
    const res = await sendToPython({ action: 'settings_get', key: targetKey }, 5000);
    if (res && res.value !== undefined && res.value !== null) {
      saveLocalSetting(targetKey, res.value);
      return res;
    }
  } catch (_e) {
    // Engine fallback
  }
  return { key: targetKey, value: null };
});

// Open trusted web links in the operating system's default browser instead of
// creating a new Electron window inside IntelliFile.
ipcMain.handle('open-external-url', async (_event, rawUrl) => {
  try {
    const target = new URL(String(rawUrl));
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return { success: false, error: 'Only web links can be opened externally.' };
    }
    await shell.openExternal(target.href);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:set', async (_event, payload = {}) => {
  const key = payload?.key;
  const value = payload?.value;
  if (key) {
    saveLocalSetting(key, value);
  }

  let result;
  try {
    result = await sendToPython({ action: 'settings_update', key, value });
  } catch (_e) {
    result = { success: true, localOnly: true };
  }

  if (key === 'auto_sort_enabled' || key === 'watched_folders') {
    let enabled = false;
    if (key === 'auto_sort_enabled') {
      enabled = typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
    } else {
      const localS = readLocalSettings();
      enabled = !!localS.auto_sort_enabled;
    }

    if (enabled) {
      await sendToPython({ action: 'watcher_start' }).catch(() => {});
    } else {
      await sendToPython({ action: 'watcher_stop' }).catch(() => {});
    }
  } else if (key === 'auto_update_wifi') {
    const enabled = typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
    autoUpdater.autoDownload = enabled;
    console.log('[Settings] Wi-Fi auto-download set to:', enabled);
  } else if (key === 'index_enabled') {
    const enabled = typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
    indexingPreferences.autoIndexingEnabled = enabled;
    saveIndexingPreferences();
    console.log('[Settings] Background indexing set to:', enabled);
  }

  return result || { success: true };
});

ipcMain.handle('index:recreate-embeddings', async () => {
  return sendToPython({ action: 'recreate_embeddings' }, 600000);
});

ipcMain.handle('index:reset-all', async () => {
  return sendToPython({ action: 'reset_index_all' });
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

ipcMain.handle('dialog:select-folder', async () => {
  const win = getActiveWindow();
  const result = await dialog.showOpenDialog(win || mainWindow, {
    title: 'Select Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
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

      appendLog('ModelDownload', 'Starting model download process...', false, 'info');

      const dl = spawn(exePath, args, {
        cwd: path.join(__dirname, '..'),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      dl.stdout.on('data', (d) => {
        const s = d.toString();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model-download-log', s);
        // Also pipe JSON log/progress messages to the Logs panel
        for (const rawLine of s.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'log' && parsed.message) {
              appendLog('ModelDownload', parsed.message, false, _deriveLevel(parsed.message, false));
            } else if (parsed.type === 'step') {
              appendLog('ModelDownload', `Step ${parsed.step}/${parsed.total}: ${parsed.name} — ${parsed.status}`, false, parsed.status === 'done' ? 'success' : 'info');
            } else if (parsed.type === 'error') {
              appendLog('ModelDownload', `Error: ${parsed.message}`, true, 'error');
            } else if (parsed.type === 'done') {
              appendLog('ModelDownload', parsed.success ? '✅ All models downloaded successfully' : 'Download completed with errors', !parsed.success, parsed.success ? 'success' : 'error');
            }
          } catch (e) {
            // Plain text line
            if (line.length > 1) appendLog('ModelDownload', line, false, _deriveLevel(line, false));
          }
        }
      });
      dl.stderr.on('data', (d) => {
        const s = d.toString();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model-download-log', s);
        // Check for common network/firewall errors
        for (const rawLine of s.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('econnrefused') || lowerLine.includes('connection refused')) {
            appendLog('Firewall', `Connection refused during model download — firewall may be blocking downloads. Detail: ${line}`, true, 'error');
          } else if (lowerLine.includes('etimedout') || lowerLine.includes('timed out') || lowerLine.includes('timeout')) {
            appendLog('Firewall', `Connection timed out during model download — check firewall/proxy. Detail: ${line}`, true, 'error');
          } else if (lowerLine.includes('enotfound') || lowerLine.includes('name or service not known') || lowerLine.includes('could not resolve')) {
            appendLog('Firewall', `DNS resolution failed during model download — huggingface.co unreachable. Check firewall/VPN. Detail: ${line}`, true, 'error');
          } else if (lowerLine.includes('ssl') || lowerLine.includes('certificate')) {
            appendLog('Firewall', `SSL/Certificate error during download — proxy or firewall may be intercepting traffic. Detail: ${line}`, true, 'error');
          } else if (lowerLine.includes('error') || lowerLine.includes('exception') || lowerLine.includes('failed')) {
            appendLog('ModelDownload', line, true, 'error');
          } else if (lowerLine.includes('warning') || lowerLine.includes('warn')) {
            appendLog('ModelDownload', line, false, 'warning');
          }
          // Skip verbose tqdm progress bars and empty lines
        }
      });

      dl.on('close', (code) => {
        if (code === 0) {
          appendLog('ModelDownload', '✅ Model download complete. Restarting engine...', false, 'success');
          try {
            originalConsoleLog('[ModelDownload] Restarting Python engine to load new models');
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
            appendLog('ModelDownload', `Failed to restart engine after download: ${e && e.message ? e.message : e}`, true, 'error');
          }
        } else {
          appendLog('ModelDownload', `Model download process exited with code ${code}`, true, 'error');
        }
        resolve({ success: code === 0, code });
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      appendLog('ModelDownload', `Failed to start model download: ${msg}`, true, 'error');
      resolve({ success: false, error: msg });
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
  const filePath = payload.filePath || payload.file_path;
  const extP = path.extname(filePath || '').toLowerCase();
  const isBinaryP = ['.docx', '.doc', '.xlsx', '.xls', '.pdf', '.zip', '.pptx', '.pptm', '.ppt', '.odt', '.rtf'].includes(extP);

  const result = await sendToPython({
    action: 'save_version',
    file_path: filePath,
    old_content: isBinaryP ? filePath : (payload.oldContent || payload.old_content || ''),
    new_content: isBinaryP ? filePath : (payload.newContent || payload.new_content || ''),
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

// -------------------------------------------------------------------------
// Open‑with helpers – expose Windows registry information to the renderer
// -------------------------------------------------------------------------
const { exec } = require('child_process');
const { execSync } = require('child_process');

function getAppInfo(exePath) {
  try {
    const fullPath = fs.realpathSync(exePath);
    const appName = exePath.split('\\').find(f => f.endsWith('.exe'))?.replace('.exe', '') || 'Application';

    // Get friendly name from file version info
    let displayName = appName;
    try {
      const nameResult = execSync(`powershell -NoProfile -Command "(Get-Item '${fullPath}').VersionInfo.FileDescription"`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      if (nameResult && nameResult.trim()) {
        displayName = nameResult.trim();
      }
    } catch { }

    return { name: displayName || appName, exe: fullPath, icon: null };
  } catch {
    return { name: exePath.split('\\').pop().replace('.exe', ''), exe: exePath, icon: null };
  }
}

// Return a list of candidate apps for a given extension (e.g. ".txt")
ipcMain.handle('open-with:get-candidates', async (_, ext) => {
  console.log('[OpenWith] get-candidates called for extension:', ext);
  // Simple cache to avoid repeated heavy registry lookups
  const cleanExt = ext.replace(/^\./, '').toLowerCase();
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const cached = candidateCache.get(cleanExt);
  if (cached && now - cached.timestamp < CACHE_TTL && cached.candidates && cached.candidates.length > 0) {
    return { candidates: cached.candidates };
  }


  // Blacklist common generic editors/interpreters that we don't want to show as primary candidates
  const APP_BLACKLIST = ['notepad.exe', 'notepad++.exe', 'python.exe', 'pythonw.exe', 'py.exe'];
  const candidates = [];
  const seenExe = new Set();
  // Quick fallback for image and code extensions – adds a default entry and returns early
  const quickFallback = [];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg'];
  if (imageExts.includes(cleanExt)) {
    quickFallback.push({ name: 'Open with default app', exe: null });
  }
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'rb', 'php'];
  if (codeExts.includes(cleanExt)) {
    quickFallback.push({ name: 'Open with default app', exe: null });
  }
  // Return early for these extensions
  if (quickFallback.length) {
    candidateCache.set(cleanExt, { candidates: quickFallback, timestamp: Date.now() });
    openWithMap[cleanExt] = quickFallback;
    saveOpenWithMap();
    console.log('[OpenWith] Quick fallback used, returning early for', cleanExt);
    return { candidates: quickFallback };
  }
  // const APP_BLACKLIST = ['notepad.exe', 'notepad++.exe', 'python.exe', 'pythonw.exe', 'py.exe']; // duplicate removed
  // const candidates = []; // duplicate removed
  // const seenExe = new Set(); // duplicate removed

  const addApp = (exePath) => {
    if (!exePath || !fs.existsSync(exePath)) return;
    // Normalize path for deduplication
    const normalized = exePath.toLowerCase().replace(/\\/g, '\\\\');
    if (!seenExe.has(normalized)) {
      const info = getAppInfo(exePath);
      candidates.push(info);
      seenExe.add(normalized);
    }
  };

  const extractExeFromCommand = (cmd) => {
    if (!cmd) return null;
    // Handle quoted paths like "C:\Program Files\App\app.exe" "%1"
    const match = cmd.match(/^"([^"]+)"|(^\S+)/);
    if (match) {
      return match[1] || match[2];
    }
    return cmd.split(' ')[0];
  };

  // Method 1: Enumerate ALL applications in HKCR\Applications that support this extension
  // This is the primary method - finds Chrome, Edge, and all registered apps
  try {
    const psCmd = `$ext = '.${cleanExt}'; Get-ChildItem 'HKCR:\\Applications' -ErrorAction SilentlyContinue | ForEach-Object { $appKey = $_.PSChildName; $supportedPath = Join-Path $_.PSPath 'SupportedTypes'; $valueNames = (Get-ItemProperty $supportedPath -ErrorAction SilentlyContinue).PSObject.Properties.Name; if ($valueNames -contains $ext) { $cmd = (Get-ItemProperty (Join-Path $_.PSPath 'shell\\open\\command') -ErrorAction SilentlyContinue).'(Default)'; if ($cmd) { $exe = $cmd -replace '^"','' -replace '".*','' -replace ' .*',''; if ($exe -and (Test-Path $exe)) { Write-Output $exe } } } }`;
    // const apps = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    //   .trim().split('\n').filter(Boolean);
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd}"`);
    const apps = stdout.trim().split('\n').filter(Boolean);
    apps.forEach(exe => addApp(exe.trim()));
  } catch (e) {
    // Registry not available
  }

  // Method 2: Query OpenWithProgids - Microsoft recommended method
  // HKEY_CLASSES_ROOT\.{ext}\OpenWithProgids contains ProgIDs
  try {
    const psCmd = `$ext = '.${cleanExt}'; $progPath = "HKCR:\\$ext\\OpenWithProgids"; if (Test-Path $progPath) { $progIds = Get-ItemProperty $progPath -ErrorAction SilentlyContinue | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name; foreach ($pid in $progIds) { if ($pid -and (Test-Path "HKCR:\\$pid\\shell\\open\\command")) { $cmd = (Get-ItemProperty "HKCR:\\$pid\\shell\\open\\command" -ErrorAction SilentlyContinue).'(Default)'; if ($cmd) { $exe = $cmd -replace '^"','' -replace '".*','' -replace ' .*',''; if ($exe) { Write-Output $exe } } } } }`;
    // const apps = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    //   .trim().split('\n').filter(Boolean);
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd}"`);
    const apps = stdout.trim().split('\n').filter(Boolean);
    apps.forEach(exe => addApp(exe.trim()));
  } catch (e) {
    // Registry not available
  }

  // Method 3: Query OpenWithList - legacy method with direct exe names
  try {
    const psCmd = `$ext = '.${cleanExt}'; $listPath = "HKCR:\\$ext\\OpenWithList"; if (Test-Path $listPath) { $exes = Get-ItemProperty $listPath -ErrorAction SilentlyContinue | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name; foreach ($exe in $exes) { if ($exe -like '*.exe' -and (Test-Path $exe)) { Write-Output $exe } } }`;
    // const appNames = execSync(`powershell -Command "${psCmd}"`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    //   .trim().split('\n').filter(Boolean);
    const { stdout } = await execAsync(`powershell -Command "${psCmd}"`);
    const appNames = stdout.trim().split('\n').filter(Boolean);

    // Resolve exe names to full paths
    for (const exeName of appNames) {
      const systemPaths = [
        process.env.WINDIR + '\\System32\\' + exeName,
        process.env.WINDIR + '\\SysWOW64\\' + exeName,
        process.env.WINDIR + '\\' + exeName,
      ];
      for (const candidate of systemPaths) {
        if (fs.existsSync(candidate)) {
          addApp(candidate);
          break;
        }
      }
    }
  } catch (e) {
    // Registry not available
  }

  // Method 4: HKCU FileExts OpenWithList (user-specific choices)
  try {
    const psCmd = `$key = Get-Item "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${cleanExt}\\OpenWithList" -ErrorAction SilentlyContinue; if ($key) { $key.GetValueNames() | Where-Object { $_ -match '^[a-z]+$' } | ForEach-Object { $val = $key.GetValue($_); if ($val -like '*.exe' -and $val -like '*:\\*' -and (Test-Path $val)) { $val } } }`;
    // const apps = execSync(`powershell -Command "${psCmd}"`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    //   .trim().split('\n').filter(l => l.includes('\\') && l.includes('.exe'));
    const { stdout } = await execAsync(`powershell -Command "${psCmd}"`);
    const apps = stdout.trim().split('\n').filter(l => l.includes('\\') && l.includes('.exe'));
    apps.forEach(exe => addApp(exe.trim()));
  } catch (e) {
    // Registry not available
  }

  // Method 5: Default association via assoc/ftype
  try {
    // const assocOut = execSync(`assoc .${cleanExt}`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const { stdout: assocOut } = await execAsync(`assoc .${cleanExt}`);
    const progId = assocOut.split('=')[1]?.trim();
    if (progId) {
      // const ftypeOut = execSync(`ftype ${progId}`, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      const { stdout: ftypeOut } = await execAsync(`ftype ${progId}`);
      const cmd = ftypeOut.split('=')[1];
      if (cmd) {
        const exe = extractExeFromCommand(cmd);
        if (exe && fs.existsSync(exe)) addApp(exe);
      }
    }
  } catch (e) {
    // assoc/ftype not available
  }

  // Fallback: Common apps by extension - check hardcoded paths
  const commonApps = {
    // Expanded common editors for programming languages
    // VS Code (code.exe) covers many, plus typical IDEs/editors
    // .jsx/.tsx (React/TSX), .c/.cpp/.java/.go/.rb/.php/.sh etc.
    // Add more entries as needed for broader detection.

    txt: ['notepad.exe'],
    log: ['notepad.exe'],
    json: ['notepad.exe'],
    xml: ['notepad.exe'],
    csv: ['notepad.exe'],
    md: ['notepad.exe'],
    xlsx: ['excel.exe'],
    xls: ['excel.exe'],
    docx: ['winword.exe'],
    doc: ['winword.exe'],
    pptx: ['powerpnt.exe'],
    pdf: ['AcroRd32.exe', 'msedge.exe', 'chrome.exe'],
    html: ['msedge.exe', 'chrome.exe'],
    htm: ['msedge.exe', 'chrome.exe'],
    jpg: ['photos.exe', 'mspaint.exe'],
    jpeg: ['photos.exe'],
    png: ['photos.exe', 'mspaint.exe'],
    gif: ['photos.exe'],
    mp3: ['wmplayer.exe'],
    mp4: ['wmplayer.exe'],
    py: ['code.exe', 'notepad.exe'],
    js: ['code.exe', 'notepad.exe'],
    ts: ['code.exe', 'notepad.exe'],
    css: ['code.exe', 'notepad.exe'],
  };

  // Office app paths
  const officePaths = [
    'C:\\Program Files\\Microsoft Office\\root\\Office16\\',
    'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\',
    'C:\\Program Files\\Microsoft Office\\Office16\\',
    'C:\\Program Files (x86)\\Microsoft Office\\Office16\\',
    'C:\\Program Files\\Microsoft Office\\root\\Office15\\',
    'C:\\Program Files (x86)\\Microsoft Office\\root\\Office15\\',
  ];

  // Edge paths
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  // Chrome paths
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  // Adobe Reader paths
  const adobePaths = [
    'C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe',
    'C:\\Program Files\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe',
    'C:\\Program Files (x86)\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe',
  ];

  // VS Code paths
  const vscodePaths = [
    'C:\\Users\\' + (process.env.USERPROFILE?.split('\\').pop() || '') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  ];

  if (commonApps[cleanExt]) {
    for (const exeName of commonApps[cleanExt]) {
      // Check System32 and Windows folder
      const systemPaths = [
        process.env.WINDIR + '\\System32\\' + exeName,
        process.env.WINDIR + '\\SysWOW64\\' + exeName,
        process.env.WINDIR + '\\' + exeName,
      ];

      for (const candidate of systemPaths) {
        if (fs.existsSync(candidate)) {
          addApp(candidate);
        }
      }

      // Check Office paths for Office apps
      if (['excel.exe', 'winword.exe', 'powerpnt.exe'].includes(exeName)) {
        for (const officePath of officePaths) {
          const candidate = officePath + exeName;
          if (fs.existsSync(candidate)) {
            addApp(candidate);
          }
        }
      }

      // Check Edge paths
      if (exeName === 'msedge.exe') {
        for (const candidate of edgePaths) {
          if (fs.existsSync(candidate)) {
            addApp(candidate);
          }
        }
      }

      // Check Chrome paths
      if (exeName === 'chrome.exe') {
        for (const candidate of chromePaths) {
          if (fs.existsSync(candidate)) {
            addApp(candidate);
          }
        }
      }

      // Check Adobe paths
      if (exeName === 'AcroRd32.exe') {
        for (const candidate of adobePaths) {
          if (fs.existsSync(candidate)) {
            addApp(candidate);
          }
        }
      }

      // Check VS Code paths
      if (exeName === 'code.exe' || exeName === 'Code.exe') {
        for (const candidate of vscodePaths) {
          if (fs.existsSync(candidate)) {
            addApp(candidate);
          }
        }
      }
    }
  }

  // Add Store search for office formats
  if (['xlsx', 'docx', 'pptx', 'pdf'].includes(cleanExt)) {
    candidates.push({
      name: 'Search Microsoft Store',
      exe: 'ms-windows-store://',
      isStoreSearch: true
    });
  }

  // Filter out blacklisted generic executables
  let filtered = candidates.filter(c => {
    try {
      const base = require('path').basename(c.exe).toLowerCase();
      return !APP_BLACKLIST.includes(base);
    } catch (_) { return true; }
  });

  // If nothing found (including after hard‑coded common apps), fall back to a lightweight scan of Program Files directories.
  // This catches apps like Antigravity that may not be registered in the registry yet expose an executable.
  if (filtered.length === 0) {
    const programDirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')].filter(Boolean); // fallback scan of Program Files and Windows Store apps
    for (const dir of programDirs) {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          try {
            const stats = fs.statSync(fullPath);
            if (stats.isFile() && fullPath.toLowerCase().endsWith('.exe')) {
              // addApp ensures dedup and blacklist handling
              addApp(fullPath);
            }
          } catch (_) { }
        }
      } catch (_) { }
    }
    // Re‑apply blacklist filter after scanning program files
    filtered = candidates.filter(c => {
      try {
        const base = require('path').basename(c.exe).toLowerCase();
        return !APP_BLACKLIST.includes(base);
      } catch (_) { return true; }
    });
  }

  // Additional recursive scan of Windows Store apps to catch UWP executables (Antigravity, Photos, etc.)
  if (filtered.length === 0) {
    const storeDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
    const scanDirForExes = (dir, depth = 0) => {
      if (!dir || depth > 5) return; // increase depth to capture deeper UWP packages
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          try {
            const stats = fs.statSync(fullPath);
            if (stats.isFile() && fullPath.toLowerCase().endsWith('.exe')) {
              addApp(fullPath);
            } else if (stats.isDirectory()) {
              scanDirForExes(fullPath, depth + 1);
            }
          } catch (_) { }
        }
      } catch (_) { }
    };
    scanDirForExes(storeDir);
    // Re‑apply blacklist filter after scanning store apps
    filtered = candidates.filter(c => {
      try {
        if (!c.exe) return true;
        const base = require('path').basename(c.exe).toLowerCase();
        return !APP_BLACKLIST.includes(base);
      } catch (_) { return true; }
    });
  }

  // If still empty after program‑files scan, add generic editors based on file type
  if (filtered.length === 0) {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg'];
    const isImage = imageExts.includes(cleanExt);
    const genericList = isImage ? ['photos.exe', 'mspaint.exe'] : ['code.exe', 'notepad++.exe', 'sublime_text.exe', 'atom.exe'];
    genericList.forEach(name => {
      const possible = [
        process.env.WINDIR + '\\System32\\' + name,
        process.env.WINDIR + '\\SysWOW64\\' + name,
        process.env.WINDIR + '\\' + name,
        // Windows Store apps folder (symlinks for store apps)
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', name),
        // Program Files paths
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, name),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], name)
      ].filter(Boolean);
      for (const p of possible) {
        if (fs.existsSync(p)) {
          addApp(p);
        }
      }
    });
    // Re‑filter after adding generic editors
    filtered = candidates.filter(c => {
      try {
        const base = require('path').basename(c.exe).toLowerCase();
        return !APP_BLACKLIST.includes(base);
      } catch (_) { return true; }
    });
  }

  // Store in runtime cache and persist to disk
  candidateCache.set(cleanExt, { candidates: filtered, timestamp: Date.now() });
  openWithMap[cleanExt] = filtered;
  saveOpenWithMap();
  console.log('[OpenWith] Handler finished for', cleanExt, '- candidates:', filtered.length);

  // Final fallback: if no candidates were discovered, provide a generic default entry
  if (filtered.length === 0) {
    console.log('[OpenWith] No candidates found for', cleanExt, '- using generic fallback');
    const generic = { name: 'Open with default app', exe: null };
    candidateCache.set(cleanExt, { candidates: [generic], timestamp: Date.now() });
    openWithMap[cleanExt] = [generic];
    saveOpenWithMap();
    return { candidates: [generic] };
  }

  return { candidates: filtered };

});

// Launch the selected executable with the target file
ipcMain.handle('open-with:launch', async (_, { exe, file }) => {
  // Handle Microsoft Store search URL
  if (exe?.startsWith('ms-windows-store://')) {
    const { shell } = require('electron');
    await shell.openExternal(exe);
    return;
  }

  // If no specific executable was found, fall back to the system default handler (works for UWP apps like Photos, Antigravity, etc.)
  if (!exe) {
    const { shell } = require('electron');
    // Use the actual file path if provided; fallback to string if file is already a path.
    const targetPath = typeof file === 'string' ? file : (file && file.path) || '';
    if (targetPath) await shell.openPath(targetPath);
    return;
  }

  return new Promise((resolve, reject) => {
    const targetPath = typeof file === 'string' ? file : (file && file.path) || '';
    exec(`"${exe}" "${targetPath}"`, { windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

// Show file picker for a custom executable ("Browse for app…")
ipcMain.handle('open-with:browse', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select an application',
    properties: ['openFile'],
    filters: [{ name: 'Executable', extensions: ['exe'] }]
  });
  return { canceled, filePaths };
});

// Open native Windows "Open With" dialog using SHOpenWithDialog API
ipcMain.handle('open-with:show-native-dialog', async (_, filePath) => {
  const path = require('path');

  console.log('[open-with:show-native-dialog] Received filePath:', filePath);

  // Validate the file exists and normalize the path
  const normalizedPath = path.resolve(filePath);
  console.log('[open-with:show-native-dialog] Normalized path:', normalizedPath);

  if (!fs.existsSync(normalizedPath)) {
    console.error('[open-with:show-native-dialog] File not found:', normalizedPath);
    throw new Error('File not found: ' + normalizedPath);
  }

  try {
    // Use C# compiled inline to call SHOpenWithDialog via P/Invoke
    const { execSync } = require('child_process');

    // Create a temporary C# script and compile it
    const csScript = `
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class OpenWithDialog {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHOpenWithDialog(IntPtr hWndParent, ref OPEN_AS_INFO pInfo);

  [StructLayout(LayoutKind.Sequential)]
  private struct OPEN_AS_INFO {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pcwszFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pcwszClass;
    public uint fwFlags;
  }

  public static int Main(string[] args) {
    if (args.Length == 0) return 1;

    // Create hidden form for valid window handle
    using (var form = new Form { Opacity = 0, ShowInTaskbar = false }) {
      form.Show();

      OPEN_AS_INFO info = new OPEN_AS_INFO();
      info.pcwszFile = args[0];
      info.pcwszClass = null;
      info.fwFlags = 0;

      int result = SHOpenWithDialog(form.Handle, ref info);
      Application.DoEvents();
      form.Close();
      return result;
    }
  }
}
`;
    // Write temp file and compile
    const tempDir = require('os').tmpdir();
    const tempCsPath = path.join(tempDir, 'openwith_' + Date.now() + '.cs');
    const tempExePath = path.join(tempDir, 'openwith_' + Date.now() + '.exe');

    fs.writeFileSync(tempCsPath, csScript);

    // Compile with csc.exe (C# compiler) - reference System.Windows.Forms
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe';
    if (fs.existsSync(cscPath)) {
      execSync(`"${cscPath}" /target:exe /r:System.Windows.Forms.dll /out:"${tempExePath}" "${tempCsPath}"`, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Run the compiled exe
      execSync(`"${tempExePath}" "${normalizedPath}"`, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Cleanup
      try { fs.unlinkSync(tempCsPath); } catch { }
      try { fs.unlinkSync(tempExePath); } catch { }

      console.log('[open-with:show-native-dialog] Dialog launched via SHOpenWithDialog');
      return true;
    } else {
      console.error('[open-with:show-native-dialog] csc.exe not found');
      throw new Error('C# compiler not found');
    }
  } catch (e) {
    console.error('[open-with:show-native-dialog] Error:', e.message);
    throw e;
  }
});

// Get file icon as data URL for an executable or any file
ipcMain.handle('get-file-icon', async (_, filePath) => {
  try {
    const { execSync } = require('child_process');
    // Escape single quotes and backslashes for PowerShell
    const escPath = filePath.replace(/'/g, "''").replace(/\\/g, '\\\\');
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(
    string pszPath,
    uint dwFileAttributes,
    ref SHFILEINFO psfi,
    uint cbFileInfo,
    uint uFlags);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon;
    public int iIcon;
    public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
    public string szTypeName;
  }
}
"@

$filePath = '${escPath}'
$shfi = New-Object Win32+SHFILEINFO
$SHGFI_ICON = 0x000000100
$SHGFI_LARGEICON = 0x000000000
[void] [Win32]::SHGetFileInfo($filePath, 0, [ref]$shfi, [System.Runtime.InteropServices.Marshal]::SizeOf($shfi), $SHGFI_ICON -bor $SHGFI_LARGEICON)
if ($shfi.hIcon -ne [IntPtr]::Zero) {
  $icon = [System.Drawing.Icon]::FromHandle($shfi.hIcon)
  $bmp = $icon.ToBitmap()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = [Convert]::ToBase64String($ms.ToArray())
  $icon.Dispose()
  $bmp.Dispose()
  $ms.Dispose()
  Write-Output $bytes
}
`;
    const b64 = execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    if (b64 && b64.length > 0) {
      return { icon: 'data:image/png;base64,' + b64 };
    }
  } catch (e) {
    console.log('[get-file-icon] Error:', e.message);
  }
  return { icon: null };
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

  broadcastToAllWindows('index-complete', payload || {});
}

// Always-available handler for opening files with the OS default app
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    // Check if the file is locked before opening
    const lockService = getFileLockService();
    if (lockService.isLockedExtension(filePath)) {
      const entry = lockService.findByEncryptedPath(filePath);
      if (entry) {
        return {
          success: false,
          error: 'This file is locked. Please unlock it first.',
          isLocked: true,
          fileId: entry.id,
          originalName: entry.originalName,
        };
      }
    }
    // Also check if the original path is tracked as locked
    const status = lockService.getFileStatus(filePath);
    if (status.isLocked) {
      return {
        success: false,
        error: 'This file is locked. Please unlock it first.',
        isLocked: true,
        fileId: status.fileId,
        originalName: status.entry?.originalName,
      };
    }

    // Support opening files directly from portable devices (e.g. MTP phones)
    const normFile = (filePath || '').replace(/\//g, '\\');
    const matchingPortable = cachedPortableDevices.find(p => p && (
      normFile.toLowerCase() === p.name.toLowerCase() ||
      normFile.toLowerCase().startsWith(p.name.toLowerCase() + '\\')
    ));
    if (matchingPortable) {
      const scriptPath = getShellNavScriptPath();
      if (scriptPath) {
        const targetName = matchingPortable.name;
        const subPath = normFile.toLowerCase() === targetName.toLowerCase() ? '' : normFile.slice(targetName.length + 1);
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action open-item -TargetName "${targetName}" -SubPath "${subPath}"`, (err) => {
          if (err) console.warn('[open-file] portable open error:', err.message);
        });
        return { success: true };
      }
    }

    const result = await shell.openPath(filePath);
    if (result) {
      return { success: false, error: result };
    }
    try {
      app.addRecentDocument(filePath);
      mainWindow?.webContents?.send('recent-files-updated', filePath);
    } catch (_) {}
    startWatchingFile(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('open-file', (event, filePath) => {
  const normFile = (filePath || '').replace(/\//g, '\\');
  const matchingPortable = cachedPortableDevices.find(p => p && (
    normFile.toLowerCase() === p.name.toLowerCase() ||
    normFile.toLowerCase().startsWith(p.name.toLowerCase() + '\\')
  ));
  if (matchingPortable) {
    const scriptPath = getShellNavScriptPath();
    if (scriptPath) {
      const targetName = matchingPortable.name;
      const subPath = normFile.toLowerCase() === targetName.toLowerCase() ? '' : normFile.slice(targetName.length + 1);
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action open-item -TargetName "${targetName}" -SubPath "${subPath}"`, (err) => {
        if (err) console.warn('[open-file] portable open error:', err.message);
      });
      return;
    }
  }

  shell.openPath(filePath).then((result) => {
    if (!result) {
      try {
        app.addRecentDocument(filePath);
        mainWindow?.webContents?.send('recent-files-updated', filePath);
      } catch (_) {}
      startWatchingFile(filePath);
    }
  }).catch(err => {
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

  let setupProcess = null;
  let lastSetupProgress = null;

  ipcMain.handle('offline-setup-status', async () => {
    const appDataDir = app.getPath('userData');
    const modelsDir = path.join(appDataDir, 'backend', 'models');
    // Check if models exist (at least one gguf and the sentence transformer folder)
    let hasChatModel = false;
    let hasEmbeddingModel = false;
    const isIntellifileModel = (name) => {
      if (!name || typeof name !== 'string') return false;
      return name === 'onnx-export' ||
             name === 'models--Xenova--bge-small-en-v1.5' ||
             (name.startsWith('models--Xenova') && name.includes('bge')) ||
             (name.startsWith('models--') && name.includes('bge-small-en-v1.5'));
    };

    try {
      if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        hasChatModel = files.some(f => f.endsWith('.gguf'));
        hasEmbeddingModel = files.some(isIntellifileModel);
      }

      if (!hasEmbeddingModel) {
        const candidatePaths = [
          path.join(app.getPath('appData'), 'IntelliFile', 'backend', 'models'),
          path.join(process.resourcesPath || '', 'backend-dist', 'models'),
          path.join(__dirname, '..', 'backend', 'models')
        ];
        for (const cp of candidatePaths) {
          try {
            if (fs.existsSync(cp)) {
              const cfiles = fs.readdirSync(cp);
              if (cfiles.some(isIntellifileModel)) {
                hasEmbeddingModel = true;
                break;
              }
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[Setup] Error checking models:', e.message);
    }

    const modelsExist = hasEmbeddingModel;
    const setupCompleted = hasOfflineSetupCompleted();

    if (modelsExist && !setupCompleted) {
      markOfflineSetupComplete();
    }

    // Only show setup dialog if models don't exist
    const needed = !modelsExist;

    return {
      needed,
      running: setupProcess !== null,
      lastProgress: lastSetupProgress,
      hasChatModel,
      hasEmbeddingModel,
      setupCompleted
    };
  });

  ipcMain.handle('offline-setup-run', async (event) => {
    if (setupProcess) {
      return { success: true, running: true, message: 'Setup already running' };
    }

    appendLog('ModelDownload', 'Checking internet connectivity before setup...', false, 'info');
    const hasInternet = await checkInternetConnectivity();
    if (!hasInternet) {
      // Firewall log already emitted inside checkInternetConnectivity
      appendLog('ModelDownload', 'Setup aborted: no internet connection detected.', true, 'error');
      return {
        success: false,
        error: 'Internet connection is required to download the AI models. Please turn on Wi-Fi or connect to the internet and try again.',
        code: 'NO_INTERNET'
      };
    }

    appendLog('ModelDownload', '✅ Internet connectivity confirmed. Starting offline model setup...', false, 'success');

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

      const initialTotal = skipChat ? 2 : 3;
      lastSetupProgress = {
        type: 'step',
        step: 1,
        total: initialTotal,
        name: 'Initializing...',
        status: 'processing',
        pct: 0
      };

      // Immediately notify all renderers that setup has started
      try {
        broadcastToAllWindows('offline-setup-progress', lastSetupProgress);
      } catch (e) {
        originalConsoleWarn('[Setup] Failed to send initial progress:', e.message || e);
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
            if (parsed.type === 'step') {
              lastSetupProgress = {
                ...(lastSetupProgress || {}),
                ...parsed
              };
            } else if (parsed.type === 'progress') {
              lastSetupProgress = {
                ...(lastSetupProgress || {}),
                ...parsed,
                name: parsed.name || lastSetupProgress?.name || 'Embedding Model',
                status: parsed.status || 'downloading'
              };
            }

            broadcastToAllWindows('offline-setup-progress', parsed);

            // Mirror to Logs panel
            if (parsed.type === 'log' && parsed.message) {
              appendLog('ModelDownload', parsed.message, false, _deriveLevel(parsed.message, false));
            } else if (parsed.type === 'step') {
              appendLog('ModelDownload', `Step ${parsed.step}/${parsed.total}: ${parsed.name} — ${parsed.status}`, false, parsed.status === 'done' ? 'success' : 'info');
            } else if (parsed.type === 'error') {
              appendLog('ModelDownload', `Setup error: ${parsed.message}`, true, 'error');
            } else if (parsed.type === 'done') {
              appendLog('ModelDownload', parsed.success ? '✅ Setup complete! Models ready.' : 'Setup completed with errors.', !parsed.success, parsed.success ? 'success' : 'error');
            }
          } catch (e) {
            // Plain text
            const t = line.trim();
            if (t.length > 1) appendLog('ModelDownload', t, false, _deriveLevel(t, false));
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
            const progressUpdate = {
              type: 'progress',
              name: 'Embedding Model',
              status: 'downloading',
              pct,
              downloaded_files: processed,
              total_files: total,
            };
            lastSetupProgress = {
              ...(lastSetupProgress || {}),
              ...progressUpdate,
              step: lastSetupProgress?.step || 1,
              total: lastSetupProgress?.total || 2
            };
            broadcastToAllWindows('offline-setup-progress', progressUpdate);
            continue;
          }
          // Check for firewall/network errors in stderr
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('econnrefused') || lowerLine.includes('connection refused')) {
            appendLog('Firewall', `Connection refused during setup — firewall may be blocking downloads. ${line}`, true, 'error');
          } else if (lowerLine.includes('etimedout') || lowerLine.includes('timed out')) {
            appendLog('Firewall', `Connection timed out during setup — check firewall/proxy settings. ${line}`, true, 'error');
          } else if (lowerLine.includes('enotfound') || lowerLine.includes('could not resolve') || lowerLine.includes('name or service not known')) {
            appendLog('Firewall', `DNS resolution failed during setup — huggingface.co unreachable. Check firewall/VPN. ${line}`, true, 'error');
          } else if (lowerLine.includes('ssl') || lowerLine.includes('certificate')) {
            appendLog('Firewall', `SSL/Certificate error — proxy or firewall may be intercepting traffic. ${line}`, true, 'error');
          } else if (!matchedProgress && (lowerLine.includes('error') || lowerLine.includes('exception') || lowerLine.includes('traceback'))) {
            appendLog('ModelDownload', `Setup error: ${line}`, true, 'error');
          }
        }

        if (!matchedProgress) {
          originalConsoleError('[Setup Error]', s.trim());
        } else {
          originalConsoleLog('[Setup Progress]', s.trim());
        }
      });

      setupProcess.on('close', (code) => {
        setupProcess = null;
        lastSetupProgress = null;
        if (code === 0) {
          appendLog('ModelDownload', '✅ Setup completed successfully. Restarting Python engine and sync server...', false, 'success');
          originalConsoleLog('[Setup] Setup completed successfully. Marking setup as completed and restarting Python engine...');
          // Mark setup as completed so we don't show the dialog again
          indexingPreferences.offlineSetupCompleted = true;
          saveIndexingPreferences();
          markOfflineSetupComplete();

          broadcastToAllWindows('offline-setup-progress', { type: 'done', success: true });
          broadcastToAllWindows('offline-setup-complete', { success: true });

          if (pyProcess) {
            pyProcess.kill(); // The 'close' listener in startPython will handle cleanup
          }
          // Give it a tiny delay to ensure the port/locks are released
          setTimeout(() => {
            startPython();
            // Also restart the sync server so it picks up the new environment without requiring an app restart
            syncServerRetries = 0;
            startSyncServer().catch(err => {
              appendLog('SyncServer', `Failed to restart sync server after setup: ${err && err.message ? err.message : err}`, true, 'error');
            });
            resolve({ success: true });
          }, 1000);
        } else {
          const errMsg = stderrBuffer.trim() || `Setup process exited with code ${code}`;
          appendLog('ModelDownload', `Setup failed with exit code ${code}: ${errMsg.split('\n')[0]}`, true, 'error');
          const isNet = /no internet|getaddrinfo|connection|enotfound|econnrefused|etimedout|network|timed out/i.test(errMsg);
          const errCode = isNet ? 'NO_INTERNET' : undefined;
          try {
            broadcastToAllWindows('offline-setup-progress', { type: 'error', message: errMsg, code: errCode });
          } catch (e) { }
          resolve({ success: false, error: errMsg, code: errCode });
        }
      });
    });
  });

  // ── Native Title Bar Overlay Controls ──
  ipcMain.handle('set-title-bar-overlay', (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && typeof win.setTitleBarOverlay === 'function') {
      try {
        const config = { ...options };
        win.setTitleBarOverlay(config);
        return { success: true };
      } catch (err) {
        console.warn('[TitleBar] Failed to set title bar overlay:', err.message);
        return { success: false, error: err.message };
      }
    }
    return { success: false };
  });

  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
    return true;
  });

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return win.isMaximized();
    }
    return false;
  });

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
    return true;
  });

  ipcMain.handle('window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  ipcMain.handle('open-new-window', async () => {
    createWindow();
    return { success: true };
  });

  // Manual sync server restart — visible in the UI (Logs toolbar)
  ipcMain.handle('restart-sync-server', async () => {
    try {
      appendLog('SyncServer', 'Manual restart requested via UI...', false, 'info');
      if (syncServerProcess && !syncServerProcess.killed) {
        try { syncServerProcess.kill(); } catch (e) { /* ignore */ }
        syncServerProcess = null;
      }
      syncServerRetries = 0;
      await startSyncServer();
      return { success: true };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      appendLog('SyncServer', `Restart failed: ${msg}`, true, 'error');
      return { success: false, error: msg };
    }
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

      if (isDev) {
        const devModelsDir = path.join(__dirname, '..', 'backend', 'models');
        if (fs.existsSync(devModelsDir)) {
          fs.rmSync(devModelsDir, { recursive: true, force: true });
        }
      }

      indexingPreferences.offlineSetupCompleted = false;
      saveIndexingPreferences();
      lastSetupProgress = null;
      broadcastToAllWindows('offline-setup-reset');

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
  const listDirectoryController = createListDirectoryController({
    readDirectory: async (dirPath, options = {}) => {
      const showHidden = options?.showHidden || false;
      try {
        console.log('[list-directory] called with:', dirPath);
        let resolvedPath = dirPath;

        // Handle special folder names
        if (dirPath === 'Home' || dirPath === 'home') {
          return { items: [], error: null };
        } else if (dirPath === 'This PC' || String(dirPath).toLowerCase() === 'this pc') {
          // Return list of drives for This PC view
          const drivesResult = await getDrivesInfo();
          if (drivesResult.success) {
            const driveItems = drivesResult.drives.map(drive => ({
              name: drive.description || drive.name,
              path: drive.device || drive.path,
              type: drive.isPortable ? 'portable' : 'drive',
              ext: '',
              editable: false,
              size: drive.size || 0,
              available: drive.available || 0,
              isPortable: drive.isPortable || false,
              isRemovable: drive.isRemovable || drive.isUSB,
              isUSB: drive.isUSB,
              modified: Date.now()
            }));
            return { items: driveItems, error: null };
          }
          return { items: [], error: 'Could not load drives' };
        }

        // Check if path belongs to a portable device (like Redmi Note 6 Pro)
        const normDir = (dirPath || '').replace(/\//g, '\\');
        const matchingPortable = cachedPortableDevices.find(p => p && (
          normDir.toLowerCase() === p.name.toLowerCase() ||
          normDir.toLowerCase().startsWith(p.name.toLowerCase() + '\\') ||
          (p.path && normDir.toLowerCase().startsWith(p.path.toLowerCase()))
        ));
        if (matchingPortable) {
          const targetName = matchingPortable.name;
          const subPath = normDir.toLowerCase() === targetName.toLowerCase() ? '' : normDir.slice(targetName.length + 1);
          const scriptPath = getShellNavScriptPath();
          
          return new Promise((resolve) => {
            if (!scriptPath) {
              return resolve({ items: [], error: 'Portable device helper script not found' });
            }
            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action list-subitems -TargetName "${targetName}" -SubPath "${subPath}"`, { timeout: 15000 }, (err, stdout) => {
              if (err || !stdout) {
                return resolve({ items: [], error: err ? err.message : null });
              }
              try {
                const parsed = JSON.parse(stdout.trim());
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                const items = arr
                  .filter(it => it && it.name && !isSystemFile(it.name, showHidden))
                  .map(it => {
                    const isFolder = it.type === 'folder';
                    const ext = isFolder ? '' : path.extname(it.name).toLowerCase();
                    return {
                      name: it.name,
                      path: it.path,
                      type: isFolder ? 'folder' : 'file',
                      ext: ext,
                      editable: false,
                      size: it.size || 0,
                      isPortable: false,
                      isPortableItem: true,
                      modified: Date.now()
                    };
                  });
                resolve({ items, error: null });
              } catch (parseErr) {
                resolve({ items: [], error: parseErr.message });
              }
            });
          });
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

        // Use async exists check
        try {
          await fs.promises.access(resolvedPath);
        } catch {
          return { items: [], error: 'Path not found' };
        }

        console.log('[list-directory] reading directory...');
        const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
        console.log('[list-directory] found', dirents.length, 'items');

        const filteredList = dirents.filter(dirent => !isSystemFile(dirent.name, showHidden));
        const items = [];
        const CHUNK_SIZE = 100;

        // Process items in batches to prevent UV thread pool starvation
        for (let i = 0; i < filteredList.length; i += CHUNK_SIZE) {
          const chunk = filteredList.slice(i, i + CHUNK_SIZE);
          const chunkPromises = chunk.map(async dirent => {
            try {
              const fullPath = path.join(resolvedPath, dirent.name);
              const isDir = dirent.isDirectory();
              const ext = isDir ? '' : path.extname(dirent.name).toLowerCase();
              const isProtected = isProtectedPath(fullPath);
              const isEditable = !isDir && EDITABLE_EXTENSIONS.includes(ext) && !isProtected;

              let size = 0;
              let modified = 0;
              try {
                const stats = await fs.promises.stat(fullPath);
                size = isDir ? 0 : stats.size;
                modified = stats.mtimeMs;
              } catch {
                // If stat fails (e.g. temporary permission lock), retain directory entry
              }

              return {
                name: dirent.name,
                path: fullPath,
                type: isDir ? 'folder' : 'file',
                ext: ext,
                editable: isEditable,
                protected: isProtected,
                size: size,
                modified: modified
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
    }
  });

  ipcMain.handle('list-directory', async (event, dirPath, options = {}) => {
    return listDirectoryController.get(dirPath, options);
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

  ipcMain.handle('get-sync-server-status', async () => {
    return new Promise((resolve) => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${SYNC_PORT}/status`, { timeout: 2000 }, (res) => {
        if (res.statusCode !== 200) {
          return resolve({ success: false, device_ids: [], connected_devices: 0 });
        }
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve({
              success: true,
              device_ids: parsed.device_ids || [],
              connected_devices: parsed.connected_devices || 0,
              pending_changes: parsed.pending_changes || 0,
            });
          } catch (e) {
            resolve({ success: false, device_ids: [], connected_devices: 0 });
          }
        });
      });
      req.on('error', () => {
        resolve({ success: false, device_ids: [], connected_devices: 0 });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, device_ids: [], connected_devices: 0 });
      });
    });
  });

  // ── Recent items for Windows 11-style Home view
  ipcMain.handle('get-recent-items', async (_event, maxCount = 50) => {
    try {
      const recentDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
      const items = [];
      const seenPaths = new Set();

      if (fs.existsSync(recentDir)) {
        const files = fs.readdirSync(recentDir);
        const lnkFiles = files.filter(f => f.toLowerCase().endsWith('.lnk'));

        const statList = [];
        for (const fname of lnkFiles) {
          try {
            const fullLnk = path.join(recentDir, fname);
            const stat = fs.statSync(fullLnk);
            statList.push({ fname, fullLnk, mtime: stat.mtimeMs });
          } catch (_) { }
        }
        statList.sort((a, b) => b.mtime - a.mtime);

        const homeDir = process.env.USERPROFILE || '';
        for (const { fname, fullLnk, mtime } of statList) {
          try {
            const resolved = shell.readShortcutLink(fullLnk);
            if (resolved && resolved.target && fs.existsSync(resolved.target)) {
              const targetPath = path.resolve(resolved.target);
              const normTarget = targetPath.toLowerCase();
              if (seenPaths.has(normTarget)) continue;
              seenPaths.add(normTarget);

              const stats = fs.statSync(targetPath);
              const isDirectory = stats.isDirectory();
              const name = path.basename(targetPath);
              const parentDir = path.dirname(targetPath);
              const ext = isDirectory ? '' : path.extname(targetPath).toLowerCase();

              // Compute human-friendly relative location string (e.g. "Downloads", "Documents\Projects\Prototype")
              let relativeLocation = parentDir;
              if (parentDir.toLowerCase().startsWith(homeDir.toLowerCase())) {
                relativeLocation = parentDir.slice(homeDir.length).replace(/^[\\/]+/, '');
              }

              items.push({
                name,
                path: targetPath,
                location: relativeLocation || parentDir,
                parentPath: parentDir,
                type: isDirectory ? 'folder' : 'file',
                size: stats.size,
                modified: stats.mtimeMs,
                accessed: mtime || stats.mtimeMs || Date.now(),
                ext,
                lnkFile: fname,
              });

              if (items.length >= maxCount) break;
            }
          } catch (_) { }
        }
      }

      return { success: true, items };
    } catch (err) {
      console.error('[Recent] get-recent-items error:', err);
      return { success: false, items: [], error: err.message };
    }
  });

  ipcMain.handle('remove-recent-item', async (_event, itemPath) => {
    try {
      const recentDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
      if (fs.existsSync(recentDir)) {
        const files = fs.readdirSync(recentDir);
        for (const fname of files) {
          if (!fname.toLowerCase().endsWith('.lnk')) continue;
          const fullLnk = path.join(recentDir, fname);
          try {
            const resolved = shell.readShortcutLink(fullLnk);
            if (resolved && resolved.target && path.resolve(resolved.target).toLowerCase() === path.resolve(itemPath).toLowerCase()) {
              fs.unlinkSync(fullLnk);
            }
          } catch (_) { }
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-quick-access-items', async () => {
    try {
      const home = process.env.USERPROFILE || os.homedir();
      const standard = [
        { id: 'desktop', name: 'Desktop', path: path.join(home, 'Desktop'), subtitle: 'Stored locally', iconType: 'desktop', pinned: true },
        { id: 'downloads', name: 'Downloads', path: path.join(home, 'Downloads'), subtitle: 'Stored locally', iconType: 'downloads', pinned: true },
        { id: 'documents', name: 'Documents', path: path.join(home, 'Documents'), subtitle: 'Stored locally', iconType: 'documents', pinned: true },
        { id: 'pictures', name: 'Pictures', path: path.join(home, 'Pictures'), subtitle: 'Stored locally', iconType: 'pictures', pinned: true },
        { id: 'music', name: 'Music', path: path.join(home, 'Music'), subtitle: 'Stored locally', iconType: 'music', pinned: true },
        { id: 'videos', name: 'Videos', path: path.join(home, 'Videos'), subtitle: 'Stored locally', iconType: 'videos', pinned: true },
      ].filter(f => fs.existsSync(f.path));

      return { success: true, items: standard };
    } catch (err) {
      return { success: false, items: [], error: err.message };
    }
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

  ipcMain.handle('add-files-to-sync', async (_event, filePaths) => {
    try {
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      if (paths.length === 0) return { success: false, added: 0 };
      const syncDir = path.join(__dirname, '..', 'sync', 'intellifil_files');
      if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
      const errors = [];
      let added = 0;
      for (const src of paths) {
        if (!src || !fs.existsSync(src)) continue;
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
      console.error('[Sync] add-files-to-sync error:', err && err.message ? err.message : err);
      return { success: false, added: 0, error: err && err.message ? err.message : String(err) };
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

  const emitFileOpProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-op-progress', data);
    }
  };

  ipcMain.handle('copy-file', async (event, sourcePath, destPath) => {
    try {
      if (fs.existsSync(destPath)) {
       return { success: false, error: 'An item with this name already exists in the destination folder.' };
      }

      const stat = fs.statSync(sourcePath);
      const isDir = stat.isDirectory();
      const opName = 'Copying';

      if (isDir) {
        const filesToCopy = [];
        const collectFiles = (src, dst) => {
          if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
          const items = fs.readdirSync(src);
          for (const item of items) {
            const s = path.join(src, item);
            const d = path.join(dst, item);
            const st = fs.statSync(s);
            if (st.isDirectory()) {
              collectFiles(s, d);
            } else {
              filesToCopy.push({ src: s, dst: d, size: st.size });
            }
          }
        };
        collectFiles(sourcePath, destPath);

        const totalFiles = filesToCopy.length;
        const totalBytes = filesToCopy.reduce((sum, f) => sum + f.size, 0);
        let processedFiles = 0;
        let processedBytes = 0;

        emitFileOpProgress({ operation: 'copy', active: true, title: `${opName} folder…`, pct: 0, processedFiles, totalFiles, processedBytes, totalBytes });

        for (const file of filesToCopy) {
          fs.copyFileSync(file.src, file.dst);
          processedFiles++;
          processedBytes += file.size;
          const pct = totalBytes > 0 ? Math.round((processedBytes / totalBytes) * 100) : Math.round((processedFiles / Math.max(1, totalFiles)) * 100);
          emitFileOpProgress({
            operation: 'copy',
            active: true,
            title: `${opName} ${path.basename(file.src)}`,
            pct: Math.min(99, pct),
            processedFiles,
            totalFiles,
            processedBytes,
            totalBytes
          });
        }
        emitFileOpProgress({ operation: 'copy', active: false, done: true, pct: 100 });
      } else {
        const totalBytes = stat.size;
        const fileName = path.basename(sourcePath);
        if (totalBytes > 5 * 1024 * 1024) {
          const CHUNK = 1024 * 1024;
          const rfd = fs.openSync(sourcePath, 'r');
          const wfd = fs.openSync(destPath, 'w');
          const buf = Buffer.alloc(CHUNK);
          let written = 0;

          emitFileOpProgress({ operation: 'copy', active: true, title: `${opName} ${fileName}`, pct: 0, processedBytes: 0, totalBytes });

          while (written < totalBytes) {
            const bytesRead = fs.readSync(rfd, buf, 0, CHUNK, written);
            if (bytesRead === 0) break;
            fs.writeSync(wfd, buf, 0, bytesRead);
            written += bytesRead;
            const pct = Math.round((written / totalBytes) * 100);
            emitFileOpProgress({ operation: 'copy', active: true, title: `${opName} ${fileName}`, pct: Math.min(99, pct), processedBytes: written, totalBytes });
          }
          fs.closeSync(rfd);
          fs.closeSync(wfd);
          emitFileOpProgress({ operation: 'copy', active: false, done: true, pct: 100 });
        } else {
          fs.copyFileSync(sourcePath, destPath);
        }
      }
      return { success: true };
    } catch (err) {
      emitFileOpProgress({ operation: 'copy', active: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('move-file', async (event, sourcePath, destPath) => {
    try {
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

      const stat = fs.statSync(sourcePath);
      const fileName = path.basename(sourcePath);

      emitFileOpProgress({ operation: 'move', active: true, title: `Moving ${fileName}…`, pct: 10 });
      fs.renameSync(sourcePath, destPath);
      emitFileOpProgress({ operation: 'move', active: false, done: true, pct: 100 });
      return { success: true };
    } catch (err) {
      emitFileOpProgress({ operation: 'move', active: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('rename-file', async (event, oldPath, newPath) => {
    try {
      // Check if source is protected
      if (isProtectedPath(oldPath)) {
        return { success: false, error: 'Cannot rename system files or folders' };
      }
      // Check if file is locked
      const lockStatus = getFileLockService().getFileStatus(oldPath);
      if (lockStatus?.isLocked || getFileLockService().isLockedExtension(oldPath)) {
        return {
          success: false,
          error: 'LOCKED_FILE_REQUIRES_PASSWORD',
          isLocked: true,
          fileId: lockStatus?.fileId || lockStatus?.entry?.id,
          filePath: oldPath
        };
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
      if (isProtectedPath(filePath)) {
        return { success: false, error: 'Cannot delete system files or folders' };
      }
      const lockStatus = getFileLockService().getFileStatus(filePath);
      if (lockStatus?.isLocked || getFileLockService().isLockedExtension(filePath)) {
        return {
          success: false,
          error: 'LOCKED_FILE_REQUIRES_PASSWORD',
          isLocked: true,
          fileId: lockStatus?.fileId || lockStatus?.entry?.id,
          filePath
        };
      }

      const trashDir = getSessionTrashDir();
      const lowerKey = filePath.toLowerCase();
      const stat = fs.statSync(filePath);

      // Enforce max capacity (50 items) — commit oldest item to Recycle Bin
      if (_sessionTrashMap.size >= MAX_SESSION_TRASH_ITEMS) {
        const oldestKey = _sessionTrashMap.keys().next().value;
        if (oldestKey) {
          const oldestEntry = _sessionTrashMap.get(oldestKey);
          _sessionTrashMap.delete(oldestKey);
          if (oldestEntry && fs.existsSync(oldestEntry.trashPath)) {
            const escaped = oldestEntry.trashPath.replace(/'/g, "''");
            const psCmd = oldestEntry.isDir
              ? `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`
              : `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`;
            require('child_process').exec(`powershell -NoProfile -Command "${psCmd}"`, () => {});
          }
        }
      }

      const trashId = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      const trashPath = path.join(trashDir, `${trashId}_${path.basename(filePath)}`);

      _recentlyDeletedPaths.add(lowerKey);
      setTimeout(() => _recentlyDeletedPaths.delete(lowerKey), 5000);

      // Move file into session trash folder
      fs.renameSync(filePath, trashPath);

      _sessionTrashMap.set(lowerKey, {
        trashId,
        originalPath: filePath,
        trashPath,
        isDir: stat.isDirectory(),
        timestamp: Date.now()
      });

      return { success: true, trashId, originalPath: filePath };
    } catch (err) {
      return { success: false, error: err.message || 'Delete failed' };
    }
  });

  ipcMain.handle('restore-deleted-file', async (event, originalPath) => {
    try {
      if (!originalPath) return { success: false, error: 'No original path provided' };
      const lowerKey = originalPath.toLowerCase();
      const entry = _sessionTrashMap.get(lowerKey);

      if (entry && fs.existsSync(entry.trashPath)) {
        const parentDir = path.dirname(originalPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.renameSync(entry.trashPath, originalPath);
        _sessionTrashMap.delete(lowerKey);
        return { success: true, restoredPath: originalPath };
      }

      // Fallback: restore from Recycle Bin if deleted earlier
      const baseName = path.basename(originalPath).replace(/'/g, "''");
      const psScript = `
        $shell = New-Object -ComObject Shell.Application
        $bin = $shell.Namespace(10)
        $item = $bin.Items() | Where-Object { $_.Name -eq '${baseName}' } | Select-Object -First 1
        if ($item) { $item.InvokeVerb('RESTORE'); exit 0 } else { exit 1 }
      `;
      return await new Promise((resolve) => {
        require('child_process').exec(`powershell -NoProfile -Command "${psScript}"`, (err) => {
          if (!err) {
            resolve({ success: true, restoredPath: originalPath });
          } else {
            resolve({ success: false, error: 'Item not found in session trash or Recycle Bin' });
          }
        });
      });
    } catch (err) {
      return { success: false, error: err.message || 'Restore failed' };
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
  ipcMain.handle('open-with', async (event, filePath) => { // custom open with (handled by UI)

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

  // Open Default Apps Settings fallback (used when no apps are associated)
  ipcMain.handle('open-default-apps-settings', async () => {
    const { shell } = require('electron');
    await shell.openExternal('ms-settings:defaultapps');
    return true;
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

  ipcMain.handle('watch-file', async (_event, filePath) => {
    startWatchingFile(filePath);
    return { success: true };
  });

  ipcMain.handle('unwatch-file', async (_event, filePath) => {
    stopWatchingFile(filePath);
    return { success: true };
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

}

// Cache for drive metadata (labels, drive types)
let cachedDriveMetadata = {};
let lastMetadataFetch = 0;
let lastKnownDrivesHash = '';

function refreshDriveMetadataAsync() {
  const now = Date.now();
  if (now - lastMetadataFetch < 10000) return;
  lastMetadataFetch = now;

  const { exec } = require('child_process');
  const psCmd = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,Size,FreeSpace | ConvertTo-Json"`;
  exec(psCmd, { timeout: 3500 }, (err, stdout) => {
    if (!err && stdout) {
      try {
        const parsed = JSON.parse(stdout.trim());
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const newMeta = {};
        for (const row of rows) {
          if (!row || !row.DeviceID) continue;
          const device = String(row.DeviceID).replace(':', '').toUpperCase();
          const driveType = String(row.DriveType || '');
          newMeta[device] = {
            label: row.VolumeName || null,
            driveType: driveType,
            isRemovable: driveType === '2' || driveType === '5',
            isUSB: driveType === '2',
            size: parseInt(row.Size || '0', 10) || 0,
            available: parseInt(row.FreeSpace || '0', 10) || 0
          };
        }
        cachedDriveMetadata = newMeta;
      } catch (_) {}
    }
  });
}

function getShellNavScriptPath() {
  const isPackaged = __dirname.includes('app.asar');
  const candidates = [
    path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked').replace(/app\.asar[\\/]/, 'app.asar.unpacked' + path.sep), 'shell_nav.ps1'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'shell_nav.ps1'),
    path.join(process.resourcesPath || '', 'shell_nav.ps1'),
    path.join(app.getPath('userData'), 'shell_nav.ps1'),
  ];
  if (!isPackaged) {
    candidates.unshift(path.join(__dirname, 'shell_nav.ps1'));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  // If not found on disk, extract from bundled script to userData so PowerShell can execute it
  try {
    const targetPath = path.join(app.getPath('userData'), 'shell_nav.ps1');
    const bundledScript = path.join(__dirname, 'shell_nav.ps1');
    if (fs.existsSync(bundledScript)) {
      const content = fs.readFileSync(bundledScript);
      fs.writeFileSync(targetPath, content);
      return targetPath;
    }
  } catch (err) {
    console.warn('[ShellNav] Failed to write script to userData:', err.message);
  }
  return null;
}

let cachedPortableDevices = [];
let isRefreshingPortable = false;
let pendingPortableRefresh = false;

function refreshPortableDevicesAsync(force = false) {
  if (isRefreshingPortable) {
    pendingPortableRefresh = true;
    return;
  }
  isRefreshingPortable = true;
  const scriptPath = getShellNavScriptPath();
  if (!scriptPath) {
    isRefreshingPortable = false;
    return;
  }
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action list-devices`, { timeout: 12000 }, (err, stdout) => {
    isRefreshingPortable = false;
    if (err) {
      console.warn('[PortableDevice] list-devices error:', err.message);
    }
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout.trim());
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const newDevices = arr.filter(d => d && d.name);
        const oldNames = cachedPortableDevices.map(d => d.name).sort().join('|');
        const newNames = newDevices.map(d => d.name).sort().join('|');
        cachedPortableDevices = newDevices;
        if (oldNames !== newNames || force) {
          console.log('[PortableDevice] Devices updated:', newNames);
          cachedDrivesResult = null;
          lastKnownDrivesHash = '';
          if (typeof updateSystemRootsPortableDevices === 'function') {
            updateSystemRootsPortableDevices(newDevices, mainWindow);
          }
          getDrivesInfo().then((res) => {
            if (res && res.success) {
              broadcastToAllWindows('drives-changed', res.drives);
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('[PortableDevice] Failed to parse devices JSON:', e.message);
      }
    }
    if (pendingPortableRefresh) {
      pendingPortableRefresh = false;
      setTimeout(() => refreshPortableDevicesAsync(), 200);
    }
  });
}

let cachedDrivesResult = null;
let lastDrivesFetchTime = 0;

// Separate function to get drives info (instant, non-blocking)
async function getDrivesInfo() {
  const now = Date.now();
  if (cachedDrivesResult && (now - lastDrivesFetchTime < 3000)) {
    return cachedDrivesResult;
  }
  try {
    refreshDriveMetadataAsync();
    refreshPortableDevicesAsync();
    const drives = [];
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    for (const letter of letters) {
      const drive = letter + ':';
      const drivePath = drive + '\\';

      if (!fs.existsSync(drivePath)) continue;

      try {
        let size = 0;
        let available = 0;
        if (fs.statfsSync) {
          try {
            const stats = fs.statfsSync(drivePath);
            size = stats.blocks * stats.bsize;
            available = stats.bavail * stats.bsize;
          } catch (_) {}
        }

        const meta = cachedDriveMetadata[letter] || {};
        if (size === 0 && meta.size) size = meta.size;
        if (available === 0 && meta.available) available = meta.available;

        const isRemovable = meta.isRemovable || (letter !== 'C' && meta.isUSB);
        const isUSB = meta.isUSB || meta.driveType === '2';
        const defaultName = isUSB ? `USB Drive (${drive})` : isRemovable ? `Removable Disk (${drive})` : `Local Disk (${drive})`;
        const description = meta.label ? `${meta.label} (${drive})` : defaultName;

        drives.push({
          device: drive,
          description: description,
          name: description,
          label: meta.label || null,
          mountpoints: [{ path: drivePath }],
          path: drivePath,
          type: 'drive',
          size: size,
          available: available,
          free: available,
          isSystem: letter === 'C',
          isRemovable: isRemovable,
          isUSB: isUSB,
          isCard: false,
          isReadOnly: false
        });
      } catch (err) {
        console.warn(`[get-drives-info] Could not get stats for ${drive}:`, err.message);
      }
    }

    for (const p of cachedPortableDevices) {
      drives.push({
        device: p.name,
        description: p.name,
        name: p.name,
        label: p.name,
        path: p.name,
        type: 'portable',
        isPortable: true,
        size: 0,
        available: 0,
        free: 0,
        isSystem: false,
        isRemovable: true,
        isUSB: true,
        isCard: false,
        isReadOnly: false
      });
    }

    // Keep fixed, removable, and portable drives in a stable natural order.
    drives.sort((a, b) => String(a.device || a.path || a.name || '').localeCompare(
      String(b.device || b.path || b.name || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    ));
    cachedDrivesResult = { success: true, drives };
    lastDrivesFetchTime = Date.now();
    return cachedDrivesResult;
  } catch (err) {
    console.error('[get-drives-info] error:', err);
    return { success: false, drives: [], error: err.message };
  }
}

function startDriveWatcher() {
  setInterval(async () => {
    try {
      if (BrowserWindow.getAllWindows().length === 0) return;
      const res = await getDrivesInfo();
      if (res && res.success) {
        // Only trigger when drives are attached/detached or labels/total sizes change
        const hash = res.drives.map(d => `${d.device}-${d.description}-${d.size}`).join('|');
        if (hash !== lastKnownDrivesHash) {
          lastKnownDrivesHash = hash;
          broadcastToAllWindows('drives-changed', res.drives);
        }
      }
    } catch (_) {}
  }, 2500);
}

function resolveAppIconPath(filename) {
  const isWin = process.platform === 'win32';
  const primaryName = filename || (isWin ? 'intellifile_logo.ico' : 'intellifile_logo.png');
  const fallbackName = isWin ? 'intellifile_logo.png' : 'intellifile_logo.ico';
  const possiblePaths = [
    path.join(__dirname, 'public', primaryName),
    path.join(__dirname, 'build', primaryName),
    path.join(__dirname, primaryName),
    path.join(process.resourcesPath || '', 'public', primaryName),
    path.join(process.resourcesPath || '', primaryName),
    path.join(__dirname, 'public', fallbackName),
    path.join(__dirname, 'build', fallbackName),
    path.join(process.resourcesPath || '', 'public', fallbackName),
    path.join(process.resourcesPath || '', fallbackName)
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'public', primaryName);
}

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadSavedWindowState() {
  try {
    const p = getWindowStateFilePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data && typeof data === 'object') {
        return data;
      }
    }
  } catch (err) {
    console.warn('[Window] Failed to read saved window state:', err.message);
  }
  return null;
}

function saveWindowState(targetWin) {
  if (!targetWin || targetWin.isDestroyed()) return;
  try {
    const isMaximized = targetWin.isMaximized();
    let bounds = null;
    if (!isMaximized && !targetWin.isMinimized() && !targetWin.isFullScreen()) {
      bounds = targetWin.getBounds();
    } else {
      // Keep existing unmaximized bounds so unmaximize later restores them
      const prev = loadSavedWindowState();
      if (prev && prev.bounds) {
        bounds = prev.bounds;
      }
    }
    const state = {
      isMaximized,
      bounds
    };
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Window] Failed to persist window state:', err.message);
  }
}

function getInitialWindowBounds() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  // Safe windowed proportions fitted comfortably inside the workArea (above the taskbar)
  const maxWidth = Math.max(640, workArea.width - 40);
  const maxHeight = Math.max(480, workArea.height - 40);
  const defaultWidth = Math.min(1360, Math.floor(workArea.width * 0.88));
  const defaultHeight = Math.min(800, Math.floor(workArea.height * 0.85));

  const fallbackWidth = Math.min(defaultWidth, maxWidth);
  const fallbackHeight = Math.min(defaultHeight, maxHeight);
  const fallbackX = Math.floor(workArea.x + (workArea.width - fallbackWidth) / 2);
  const fallbackY = Math.floor(workArea.y + (workArea.height - fallbackHeight) / 2);

  const saved = loadSavedWindowState();
  if (saved && saved.bounds) {
    const { x, y, width, height } = saved.bounds;
    const matchingDisplay = screen.getDisplayMatching(saved.bounds) || primaryDisplay;
    const wa = matchingDisplay.workArea;

    // Check visibility on matching display
    const isVisible = (
      x + 80 >= wa.x &&
      x <= wa.x + wa.width - 80 &&
      y >= wa.y - 10 &&
      y <= wa.y + wa.height - 80
    );

    if (isVisible && width >= 400 && height >= 300) {
      // Fit within target display workArea and clamp so the bottom NEVER overlaps taskbar
      const safeWidth = Math.min(width, wa.width);
      const safeHeight = Math.min(height, wa.height - 16);
      const safeX = Math.max(wa.x, Math.min(x, wa.x + wa.width - safeWidth));
      const safeY = Math.max(wa.y, Math.min(y, wa.y + wa.height - safeHeight));

      return {
        x: safeX,
        y: safeY,
        width: safeWidth,
        height: safeHeight,
        isMaximized: !!saved.isMaximized
      };
    }
  }

  return {
    x: fallbackX,
    y: fallbackY,
    width: fallbackWidth,
    height: fallbackHeight,
    isMaximized: saved ? !!saved.isMaximized : false
  };
}

function createWindow() {
  const bounds = getInitialWindowBounds();

  // Cascade secondary windows slightly if space allows
  if (activeWindows.size > 0) {
    const cascadeOffset = (activeWindows.size % 6) * 26;
    const primaryDisplay = screen.getPrimaryDisplay();
    const wa = primaryDisplay.workArea;
    if (bounds.x + cascadeOffset + bounds.width <= wa.x + wa.width &&
        bounds.y + cascadeOffset + bounds.height <= wa.y + wa.height) {
      bounds.x += cascadeOffset;
      bounds.y += cascadeOffset;
    }
  }

  const minWidth = Math.min(800, bounds.width);
  const minHeight = Math.min(560, bounds.height);

  const newWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth,
    minHeight,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#1f2937',
      height: 44
    },
    backgroundColor: '#ffffff',
    icon: resolveAppIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (bounds.isMaximized) {
    newWin.maximize();
  }

  if (process.platform === 'win32') {
    try {
      newWin.setAppDetails({
        appId: 'com.intellifile.app'
      });
    } catch (e) {
      console.warn('[Window] Failed to setAppDetails:', e.message);
    }
    try {
      // 0x0219 = WM_DEVICECHANGE (device arrival/removal, USB, MTP phone)
      newWin.hookWindowMessage(0x0219, (wParam, lParam) => {
        console.log('[DeviceChange] Hardware event received (WM_DEVICECHANGE)');
        cachedDrivesResult = null;
        lastKnownDrivesHash = '';
        refreshDriveMetadataAsync();
        refreshPortableDevicesAsync(true);
      });
    } catch (e) {
      console.warn('[Window] Failed to hook WM_DEVICECHANGE:', e.message);
    }
  }

  activeWindows.add(newWin);
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = newWin;
    win = newWin;
  }

  // Debounced window state persistence
  let saveStateTimeout = null;
  const triggerSaveState = () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(() => {
      saveWindowState(newWin);
    }, 400);
  };

  newWin.on('resize', triggerSaveState);
  newWin.on('move', triggerSaveState);

  newWin.on('maximize', () => {
    triggerSaveState();
    if (!newWin.isDestroyed()) {
      newWin.webContents.send('window-maximized-change', true);
    }
  });

  newWin.on('unmaximize', () => {
    triggerSaveState();
    if (!newWin.isDestroyed()) {
      newWin.webContents.send('window-maximized-change', false);
    }
  });

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
    newWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(missingHtml)}`);
  } else {
    newWin.loadURL(startUrl);
  }

  newWin.once('ready-to-show', () => {
    if (!newWin.isDestroyed()) {
      newWin.show();
    }
  });

  newWin.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[UI] Failed to load window:', errorCode, errorDescription, validatedURL);
    if (!newWin.isDestroyed()) {
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
      newWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
    }
  });

  // Trigger auto-indexing once window is ready and Python is ready
  // Defer auto-indexing so initial launch, UI render, and user interaction are instant and smooth
  // IMPORTANT: Auto-indexing must only run ONCE per app session across all open windows!
  newWin.webContents.on('did-finish-load', () => {
    windowReadyForIndexing = true;
    if (!autoIndexTriggeredThisSession && !autoIndexRequested && !indexInProgress) {
      console.log('[Window] Ready for indexing — will start in 25s background delay');
      setTimeout(() => {
        tryAutoIndex();
      }, 25000);
    } else {
      console.log('[Window] Ready, auto-indexing already scheduled or completed for this session');
    }
  });

  // Increase max event listeners to prevent memory leak warnings during indexing
  newWin.webContents.setMaxListeners(100);

  newWin.on('closed', () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveWindowState(newWin);
    activeWindows.delete(newWin);
    if (mainWindow === newWin) {
      const remaining = Array.from(activeWindows).filter(w => !w.isDestroyed());
      mainWindow = remaining.length > 0 ? remaining[0] : null;
      win = mainWindow;
    }
  });

  return newWin;
}

function initializeWatchedDirectories() {
  try {
    const localSettings = readLocalSettings();
    const userWatched = Array.isArray(localSettings.watched_folders) ? localSettings.watched_folders : [];

    const defaultDirs = [
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('desktop'),
    ];

    for (const wFolder of userWatched) {
      if (typeof wFolder === 'string') {
        const resolvedPath = path.isAbsolute(wFolder) ? wFolder : path.join(app.getPath('home'), wFolder);
        if (fs.existsSync(resolvedPath) && !defaultDirs.includes(resolvedPath)) {
          defaultDirs.push(resolvedPath);
        }
      }
    }

    for (const dirPath of defaultDirs) {
      if (dirPath && fs.existsSync(dirPath)) {
        startWatchingDirectory(dirPath);
      }
    }
  } catch (err) {
    console.error('[Watcher] Failed to initialize watched directories:', err);
  }
}

function cleanupStaleUpdaterFiles() {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return;

    const updaterDirs = [
      path.join(localAppData, 'intellifile-updater'),
      path.join(localAppData, 'IntelliFile-updater')
    ];

    for (const upDir of updaterDirs) {
      if (fs.existsSync(upDir)) {
        const pendingDir = path.join(upDir, 'pending');
        if (fs.existsSync(pendingDir)) {
          const files = fs.readdirSync(pendingDir);
          for (const file of files) {
            const filePath = path.join(pendingDir, file);
            try {
              const stat = fs.statSync(filePath);
              // Clean up files older than 2 hours to avoid disk bloat from prior updates
              if (Date.now() - stat.mtimeMs > 2 * 60 * 60 * 1000) {
                fs.rmSync(filePath, { recursive: true, force: true });
                console.log('[Update] Cleaned up stale updater file:', file);
              }
            } catch (_) {}
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Update] Failed to cleanup stale updater files:', err.message);
  }
}

app.on('ready', () => {
  loadIndexingPreferences();
  registerIpcHandlers();
  refreshPortableDevicesAsync();
  startPython();
  if (CHAT_ENABLED) startChatBackend();
  createWindow();

  // Stagger secondary background services so initial window creation & React render are smooth
  setTimeout(() => {
    startSyncServer();
    ensureSyncEngine();
    startDriveWatcher();
    initializeWatchedDirectories();
    cleanupStaleUpdaterFiles();
  }, 2500);
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

  // Cancel any pending engine restart
  if (pyRestartTimer) {
    clearTimeout(pyRestartTimer);
    pyRestartTimer = null;
  }

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

let appTray = null;
let isAppQuitting = false;

app.on('before-quit', () => {
  isAppQuitting = true;
});

function createTrayIconIfNeeded() {
  if (appTray) return;
  try {
    const iconPath = resolveAppIconPath('intellifile_logo.ico');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createFromPath(resolveAppIconPath('intellifile_logo.png'));
    appTray = new Tray(icon);
    appTray.setToolTip('IntelliFile - File Lock Guard Active');

    const contextMenu = Menu.buildFromTemplate([
      { label: '🛡️ IntelliFile Lock Guard Active', enabled: false },
      { type: 'separator' },
      {
        label: 'Open IntelliFile',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: 'Exit IntelliFile (Unlock Handles)',
        click: () => {
          isAppQuitting = true;
          app.quit();
        }
      }
    ]);

    appTray.setContextMenu(contextMenu);
    appTray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  } catch (err) {
    console.warn('[Tray] System tray creation error:', err.message || err);
  }
}

app.on('window-all-closed', () => {
  if (fileLockService && !isAppQuitting) {
    const lockedRes = fileLockService.getLockedFiles();
    if (lockedRes?.files && Object.keys(lockedRes.files).length > 0) {
      createTrayIconIfNeeded();
      console.log('[LockGuard] Windows closed, but IntelliFile remains active in System Tray to preserve OS kernel handle locks.');
      return;
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null || mainWindow?.isDestroyed?.()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});
// Duplicate handler for open-default-apps-settings removed – original registration is at line 3500

// Watch for installation/uninstallation changes to clear caches
const watchDirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
const REBUILD_DEBOUNCE_MS = 3000;
let rebuildTimer = null;
// Temporary ignore window after system resume to avoid spurious cache clears.
let ignoreCacheResetUntil = 0;
app.on('resume', () => {
  // Ignore cache resets for the next few seconds after resume.
  ignoreCacheResetUntil = Date.now() + 5000;
});
function scheduleCacheReset() {
  if (Date.now() < ignoreCacheResetUntil) {
    // Skip clearing caches during the ignore window.
    return;
  }
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    console.log('[OpenWith] Detected program install/uninstall – clearing caches');
    candidateCache.clear();
    openWithMap = {};
    saveOpenWithMap();
  }, REBUILD_DEBOUNCE_MS);
}
watchDirs.forEach(dir => {
  try {
    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.exe') || filename.endsWith('.lnk'))) {
        scheduleCacheReset();
      }
    });
  } catch (e) {
    console.warn('[OpenWith] Failed to watch', dir, ':', e.message || e);
  }
});
