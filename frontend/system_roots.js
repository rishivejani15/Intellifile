const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

function mapDriveType(code) {
  switch (String(code)) {
    case '0': return 'Unknown';
    case '1': return 'NoRoot';
    case '2': return 'Removable';
    case '3': return 'Local';
    case '4': return 'Network';
    case '5': return 'CDROM';
    case '6': return 'RAMDisk';
    default: return 'Unknown';
  }
}

function getSpecialFolders() {
  const home = os.homedir();
  const folders = [];

  const addIfExists = (id, name, p) => {
    if (p && fs.existsSync(p)) folders.push({ id, name, path: p });
  };

  addIfExists('desktop', 'Desktop', path.join(home, 'Desktop'));
  addIfExists('documents', 'Documents', path.join(home, 'Documents'));
  addIfExists('downloads', 'Downloads', path.join(home, 'Downloads'));
  addIfExists('pictures', 'Pictures', path.join(home, 'Pictures'));
  addIfExists('music', 'Music', path.join(home, 'Music'));
  addIfExists('videos', 'Videos', path.join(home, 'Videos'));

  // OneDrive (consumer/business)
  const oneDrive = process.env.OneDrive || process.env.OneDriveCommercial || process.env.OneDriveConsumer || path.join(home, 'OneDrive');
  addIfExists('onedrive', 'OneDrive', oneDrive);

  // Recycle Bin (virtual)
  const recycleRoot = path.parse(home).root || 'C:\\';
  const recycle = path.join(recycleRoot, '$Recycle.Bin');
  if (fs.existsSync(recycle)) folders.push({ id: 'recycle', name: 'Recycle Bin', path: recycle, virtual: true });

  // This PC - virtual root
  folders.unshift({ id: 'this_pc', name: 'This PC', path: null, virtual: true });

  return folders;
}

function getFastDrives() {
  const drives = [];
  const letters = ['C', 'D', 'E', 'F', 'G'];
  for (const letter of letters) {
    const drivePath = letter + ':\\';
    try {
      if (fs.existsSync(drivePath)) {
        let size = 0;
        let free = 0;
        if (fs.statfsSync) {
          try {
            const stats = fs.statfsSync(drivePath);
            size = stats.blocks * stats.bsize;
            free = stats.bavail * stats.bsize;
          } catch (_) {}
        }
        drives.push({
          id: letter + ':',
          path: drivePath,
          name: letter === 'C' ? `Local Disk (${letter}:)` : `Drive (${letter}:)`,
          type: 'Local',
          size,
          free
        });
      }
    } catch (_) {}
  }
  return drives;
}

let cachedRoots = null;
let isRefreshingRoots = false;
let lastRefreshTime = 0;

function refreshSystemRootsAsync(targetWindow) {
  if (isRefreshingRoots) return;
  const now = Date.now();
  if (now - lastRefreshTime < 10000 && cachedRoots) return;
  isRefreshingRoots = true;
  lastRefreshTime = now;

  // Query network shares asynchronously without blocking event loop
  exec('net use', { timeout: 3000, encoding: 'utf8' }, (_errNet, stdoutNet) => {
    const shares = [];
    if (stdoutNet) {
      try {
        const lines = stdoutNet.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const driveMatch = line.match(/([A-Z]:)/i);
          if (!driveMatch) continue;
          const drive = driveMatch[1];
          const afterDrive = line.slice((driveMatch.index || 0) + drive.length).trim();
          const uncMatch = afterDrive.match(/\\+[^\s]+/);
          if (uncMatch) {
            shares.push({ id: drive, path: uncMatch[0], name: drive, type: 'Network' });
          }
        }
      } catch (_) {}
    }

    if (cachedRoots) {
      cachedRoots.networkShares = shares;
    }
    isRefreshingRoots = false;

    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('system-roots-changed', cachedRoots);
    }
  });
}

async function getSystemRoots(targetWindow) {
  if (!cachedRoots) {
    cachedRoots = {
      specialFolders: getSpecialFolders(),
      drives: getFastDrives(),
      portableDevices: [],
      networkShares: []
    };
  }

  // Kick off non-blocking background refresh
  setTimeout(() => refreshSystemRootsAsync(targetWindow), 100);

  return {
    success: true,
    data: cachedRoots
  };
}

function registerSystemRoots(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  ipcMain.handle('get-system-roots', async (event) => {
    try {
      const win = event?.sender?.getOwnerBrowserWindow?.() || null;
      return await getSystemRoots(win);
    } catch (err) {
      return {
        success: true,
        data: cachedRoots || {
          specialFolders: getSpecialFolders(),
          drives: getFastDrives(),
          portableDevices: [],
          networkShares: []
        }
      };
    }
  });
}

function updateSystemRootsPortableDevices(devices, targetWindow) {
  if (!cachedRoots) {
    cachedRoots = {
      specialFolders: getSpecialFolders(),
      drives: getFastDrives(),
      portableDevices: [],
      networkShares: []
    };
  }
  cachedRoots.portableDevices = Array.isArray(devices) ? devices : [];
  try {
    const { BrowserWindow } = require('electron');
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send('system-roots-changed', cachedRoots);
      }
    }
  } catch (_) {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('system-roots-changed', cachedRoots);
    }
  }
}

module.exports = { registerSystemRoots, getSystemRoots, updateSystemRootsPortableDevices };
