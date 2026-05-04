const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function mapDriveType(code) {
  // WMIC DriveType codes
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

  // Recycle Bin (virtual) - expose path to $Recycle.Bin if present
  const recycleRoot = path.parse(home).root || 'C:\\';
  const recycle = path.join(recycleRoot, '$Recycle.Bin');
  if (fs.existsSync(recycle)) folders.push({ id: 'recycle', name: 'Recycle Bin', path: recycle, virtual: true });

  // This PC - virtual root
  folders.unshift({ id: 'this_pc', name: 'This PC', path: null, virtual: true });

  return folders;
}

function listWindowsDrives() {
  try {
    const out = execSync('wmic logicaldisk get DeviceID,DriveType,ProviderName,VolumeName,Size,FreeSpace /format:csv', { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const rows = lines.slice(1);
    const drives = [];
    for (const row of rows) {
      const cols = row.split(',');
      const map = {};
      for (let i = 0; i < headers.length; i++) {
        map[headers[i]] = cols[i] || '';
      }
      const device = map.DeviceID || map.Device || cols[1];
      if (!device) continue;
      const type = map.DriveType || '';
      const provider = map.ProviderName || '';
      const vol = map.VolumeName || '';
      const size = parseInt(map.Size || '0', 10) || 0;
      const free = parseInt(map.FreeSpace || '0', 10) || 0;

      drives.push({
        id: device,
        path: device + (device.endsWith('\\') ? '' : '\\'),
        name: vol || device,
        type: mapDriveType(type),
        provider: provider || null,
        size,
        free
      });
    }
    return drives;
  } catch (err) {
    // Fallback: try parsing PowerShell Get-PSDrive
    try {
      const out = execSync('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Free,Used,Root | ConvertTo-Json"', { encoding: 'utf8' });
      const parsed = JSON.parse(out);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map(d => ({ id: d.Name + ':', path: d.Root, name: d.Name, type: 'Local', size: null, free: d.Free || null }));
    } catch (e) {
      return [];
    }
  }
}

function listPortableDevices() {
  try {
    // Best-effort using PowerShell to list PnP devices in PortableDevice class
    const cmd = `powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'PortableDevice' -or $_.Class -eq 'Image' } | Select-Object -Property FriendlyName,InstanceId | ConvertTo-Json"`;
    const out = execSync(cmd, { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((d, i) => ({ id: `portable-${i}`, name: d.FriendlyName || d.InstanceId || 'Portable Device', details: d }));
  } catch (err) {
    return [];
  }
}

function listNetworkShares() {
  try {
    const out = execSync('net use', { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const shares = [];
    for (const line of lines) {
      const driveMatch = line.match(/([A-Z]:)/i);
      if (!driveMatch) continue;

      const drive = driveMatch[1];
      const afterDrive = line.slice((driveMatch.index || 0) + drive.length).trim();
      const uncMatch = afterDrive.match(/\\+[^\s]+/);
      if (!uncMatch) continue;
      const unc = uncMatch[0];

      shares.push({ id: drive, path: unc, name: drive, type: 'Network' });
    }
    return shares;
  } catch (e) {
    return [];
  }
}

async function getSystemRoots() {
  const special = getSpecialFolders();
  const drives = process.platform === 'win32' ? listWindowsDrives() : [];
  const portable = process.platform === 'win32' ? listPortableDevices() : [];
  const network = process.platform === 'win32' ? listNetworkShares() : [];

  return {
    success: true,
    data: {
      specialFolders: special,
      drives,
      portableDevices: portable,
      networkShares: network
    }
  };
}

function registerSystemRoots(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  ipcMain.handle('get-system-roots', async (_event, _opts) => {
    try {
      return await getSystemRoots();
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}

module.exports = { registerSystemRoots, getSystemRoots };
