const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Log file location under %APPDATA%\IntelliFile\log.txt
const LOG_PATH = path.join(process.env.APPDATA || process.env.LOCALAPPDATA, 'IntelliFile', 'log.txt');

function ensureLogDir() {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

function log(message, level = 'info') {
  ensureLogDir();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${message}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (_) {}
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // Encode script as UTF‑16LE Base64 for PowerShell -EncodedCommand
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const cmd = `powershell -NoProfile -EncodedCommand ${encoded}`;
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        log(`PowerShell error: ${stderr || err.message}`, 'error');
        return reject(err);
      }
      log(`PowerShell output: ${stdout.trim()}`, 'info');
      resolve(stdout.trim());
    });
  });
}

module.exports = { runPowerShell, log };
