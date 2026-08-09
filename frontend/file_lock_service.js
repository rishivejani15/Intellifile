/**
 * FileLockService — Secure file encryption/decryption for IntelliFile
 *
 * Uses AES-256-GCM with PBKDF2 key derivation (SHA-512, 100k iterations).
 * All crypto is handled via Node.js built-in `crypto` module — zero external deps.
 *
 * File format (.intellilock):
 *   [4-byte magic "IFLK"] [1-byte version] [32-byte salt] [16-byte IV]
 *   [N-byte ciphertext (includes GCM auth tag)]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Constants
const MAGIC = Buffer.from('IFLK', 'ascii');
const FORMAT_VERSION = 1;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';
const VERIFICATION_TOKEN = 'INTELLIFILE_VERIFIED';
const ENCRYPTED_EXTENSION = '.intellilock';
const HEADER_SIZE = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH; // 4 + 1 + 32 + 16 = 53 bytes
const AUTH_TAG_LENGTH = 16;
const SECURE_DELETE_PASSES = 3;

class FileLockService {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.metadataPath = path.join(userDataPath, 'file-lock-metadata.json');
    this.metadata = { version: 1, lockedFiles: {}, history: [] };
    this.autoLockTimers = new Map(); // fileId -> timer handle
    this.tempAccessFiles = new Set(); // Track temp files for cleanup
    this.osHandles = new Map(); // fileId -> { handle, path }
    this._win32Initialized = false;
    this._loaded = false;
  }

  // ── Win32 OS Kernel Handle Locking (Prevents Explorer Delete/Rename) ──

  _initWin32API() {
    if (process.platform === 'win32' && !this._win32Initialized) {
      try {
        let koffi;
        try {
          koffi = require('koffi');
        } catch {
          koffi = require(path.join(__dirname, 'node_modules', 'koffi'));
        }
        const kernel32 = koffi.load('kernel32.dll');
        this._win32CreateFileW = kernel32.func('__stdcall', 'CreateFileW', 'intptr', [
          'str16', // lpFileName
          'uint32', // dwDesiredAccess
          'uint32', // dwShareMode
          'void *', // lpSecurityAttributes
          'uint32', // dwCreationDisposition
          'uint32', // dwFlagsAndAttributes
          'void *'  // hTemplateFile
        ]);
        this._win32CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['intptr']);
        this._win32Initialized = true;
        console.log('[FileLock] Win32 Kernel handle locking initialized');
      } catch (err) {
        console.warn('[FileLock] Could not initialize Win32 FFI handle locking:', err.message || err);
      }
    }
  }

  _applyNTFSACLDeny(filePath) {
    if (process.platform !== 'win32' || !filePath || !fs.existsSync(filePath)) return false;
    try {
      const { execSync } = require('child_process');
      execSync(`icacls "${filePath}" /deny "*S-1-1-0:(F)"`, { stdio: 'pipe' });
      console.log(`[FileLock] Applied NTFS ACL Deny Full Control on: ${filePath}`);
      return true;
    } catch (err) {
      console.warn(`[FileLock] Failed to apply NTFS ACL Deny on ${filePath}:`, err.message || err);
      return false;
    }
  }

  _removeNTFSACLDeny(filePath) {
    if (process.platform !== 'win32' || !filePath || !fs.existsSync(filePath)) return false;
    try {
      const { execSync } = require('child_process');
      execSync(`attrib -r -s "${filePath}"`, { stdio: 'pipe' });
      execSync(`icacls "${filePath}" /remove:d "*S-1-1-0"`, { stdio: 'pipe' });
      console.log(`[FileLock] Removed NTFS ACL Deny on: ${filePath}`);
      return true;
    } catch (err) {
      console.warn(`[FileLock] Failed to remove NTFS ACL Deny on ${filePath}:`, err.message || err);
      return false;
    }
  }

  _acquireOSLock(fileId, filePath) {
    if (process.platform !== 'win32' || !filePath) return false;
    this._initWin32API();

    // First ensure offline NTFS ACL Deny is enforced
    this._applyNTFSACLDeny(filePath);

    if (!this._win32CreateFileW) return false;

    // Release any existing handle for this fileId first
    this._releaseOSLock(fileId);

    try {
      if (!fs.existsSync(filePath)) return false;

      const GENERIC_READ = 0x80000000;
      const FILE_SHARE_READ = 0x00000001; // NO FILE_SHARE_DELETE or FILE_SHARE_WRITE!
      const OPEN_EXISTING = 3;
      const FILE_ATTRIBUTE_NORMAL = 0x80;

      const handle = this._win32CreateFileW(
        filePath,
        GENERIC_READ,
        FILE_SHARE_READ,
        null,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        null
      );

      if (handle && handle !== -1 && handle !== 0) {
        this.osHandles.set(fileId, { handle, path: filePath });
        console.log(`[FileLock] Acquired OS kernel lock on: ${filePath} (fileId: ${fileId})`);
        return true;
      } else {
        console.warn(`[FileLock] CreateFileW returned invalid handle for: ${filePath}`);
        return false;
      }
    } catch (err) {
      console.warn(`[FileLock] Failed to acquire OS lock on ${filePath}:`, err.message || err);
      return false;
    }
  }

  _releaseOSLock(fileId) {
    if (!this.osHandles.has(fileId)) return false;
    const entry = this.osHandles.get(fileId);
    this.osHandles.delete(fileId);

    if (process.platform === 'win32' && this._win32CloseHandle && entry?.handle) {
      try {
        this._win32CloseHandle(entry.handle);
        console.log(`[FileLock] Released OS kernel lock on: ${entry.path} (fileId: ${fileId})`);
        return true;
      } catch (err) {
        console.warn(`[FileLock] Failed to release OS lock handle for ${fileId}:`, err.message || err);
      }
    }
    return false;
  }

  _acquireAllOSLocks() {
    if (process.platform !== 'win32') return;
    console.log('[FileLock] Acquiring OS kernel handles and applying NTFS ACL protections for all locked files...');
    for (const [fileId, entry] of Object.entries(this.metadata.lockedFiles)) {
      if (entry && entry.lockStatus === 'locked' && entry.encryptedPath) {
        this._acquireOSLock(fileId, entry.encryptedPath);
      }
    }
  }

  cleanupOSLocks() {
    console.log(`[FileLock] Cleaning up ${this.osHandles.size} OS file handles...`);
    for (const fileId of Array.from(this.osHandles.keys())) {
      this._releaseOSLock(fileId);
    }
  }

  // ── Initialization ──

  _ensureLoaded() {
    if (!this._loaded) {
      this._loadMetadata();
      this._loaded = true;
      this._acquireAllOSLocks();
    }
  }

  _loadMetadata() {
    try {
      if (fs.existsSync(this.metadataPath)) {
        const raw = fs.readFileSync(this.metadataPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.metadata = {
            version: parsed.version || 1,
            lockedFiles: parsed.lockedFiles || {},
            history: parsed.history || [],
          };
        }
      }
    } catch (err) {
      console.warn('[FileLock] Failed to load metadata:', err.message || err);
    }
  }

  _saveMetadata() {
    try {
      const dir = path.dirname(this.metadataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[FileLock] Failed to save metadata:', err.message || err);
    }
  }

  _addHistory(fileId, action, originalPath) {
    this.metadata.history.unshift({
      fileId,
      action,
      timestamp: new Date().toISOString(),
      originalPath,
    });
    // Cap history at 500 entries
    if (this.metadata.history.length > 500) {
      this.metadata.history = this.metadata.history.slice(0, 500);
    }
  }

  _generateId() {
    return crypto.randomUUID();
  }

  // ── Cryptographic Primitives ──

  _deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  }

  /**
   * Encrypt a file using AES-256-GCM.
   * Returns { salt, iv, encryptedData } where encryptedData includes auth tag appended.
   */
  _encryptBuffer(plainBuffer, password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this._deriveKey(password, salt);

    // Prepend verification token to plaintext so we can verify password on decrypt
    const verificationBuf = Buffer.from(VERIFICATION_TOKEN, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(verificationBuf.length, 0);
    const payload = Buffer.concat([lenBuf, verificationBuf, plainBuffer]);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    return { salt, iv, encryptedData: Buffer.concat([encrypted, authTag]) };
  }

  /**
   * Decrypt a file using AES-256-GCM.
   * Returns the original file buffer, or throws on failure.
   */
  _decryptBuffer(encryptedData, password, salt, iv) {
    const key = this._deriveKey(password, salt);

    // Separate ciphertext from auth tag
    const ciphertext = encryptedData.slice(0, encryptedData.length - AUTH_TAG_LENGTH);
    const authTag = encryptedData.slice(encryptedData.length - AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted;
    try {
      decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error('Decryption failed — incorrect password or corrupted file.');
    }

    // Verify the token
    const tokenLen = decrypted.readUInt32BE(0);
    const token = decrypted.slice(4, 4 + tokenLen).toString('utf-8');
    if (token !== VERIFICATION_TOKEN) {
      throw new Error('Verification failed — incorrect password or corrupted file.');
    }

    return decrypted.slice(4 + tokenLen);
  }

  /**
   * Build the .intellilock file format.
   */
  _buildLockedFile(salt, iv, encryptedData) {
    const versionBuf = Buffer.alloc(1);
    versionBuf.writeUInt8(FORMAT_VERSION, 0);
    return Buffer.concat([MAGIC, versionBuf, salt, iv, encryptedData]);
  }

  /**
   * Parse a .intellilock file and return { salt, iv, encryptedData }.
   */
  _parseLockedFile(fileBuffer) {
    if (fileBuffer.length < HEADER_SIZE) {
      throw new Error('File is too small to be a valid .intellilock file.');
    }

    const magic = fileBuffer.slice(0, 4);
    if (!magic.equals(MAGIC)) {
      throw new Error('Not a valid .intellilock file (bad magic bytes).');
    }

    const version = fileBuffer.readUInt8(4);
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported .intellilock format version: ${version}`);
    }

    const salt = fileBuffer.slice(5, 5 + SALT_LENGTH);
    const iv = fileBuffer.slice(5 + SALT_LENGTH, 5 + SALT_LENGTH + IV_LENGTH);
    const encryptedData = fileBuffer.slice(HEADER_SIZE);

    return { salt, iv, encryptedData };
  }

  // ── Secure File Deletion ──

  async _secureDelete(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Overwrite with random data multiple passes
      for (let pass = 0; pass < SECURE_DELETE_PASSES; pass++) {
        const fd = fs.openSync(filePath, 'w');
        const chunkSize = 64 * 1024; // 64KB chunks
        let written = 0;
        while (written < fileSize) {
          const remaining = fileSize - written;
          const size = Math.min(chunkSize, remaining);
          const randomData = crypto.randomBytes(size);
          fs.writeSync(fd, randomData, 0, size, written);
          written += size;
        }
        fs.closeSync(fd);
      }

      // Finally delete the file
      fs.unlinkSync(filePath);
    } catch (err) {
      // Fallback: just delete normally
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.warn('[FileLock] Failed to delete file:', unlinkErr.message || unlinkErr);
        throw unlinkErr;
      }
    }
  }

  // ── Public API ──

  /**
   * Lock a file with a password.
   * @param {string} filePath - Absolute path to the file to lock
   * @param {string} password - User's password/PIN
   * @param {object} options - { hint?: string, autoLockTimeout?: number }
   * @returns {{ success: boolean, error?: string, fileId?: string }}
   */
  async lockFile(filePath, password, options = {}) {
    this._ensureLoaded();

    try {
      // Validate inputs
      if (!filePath || !password) {
        return { success: false, error: 'File path and password are required.' };
      }

      if (password.length < 4) {
        return { success: false, error: 'Password must be at least 4 characters.' };
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found.' };
      }

      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        return { success: false, error: 'Cannot lock directories directly. Use folder lock instead.' };
      }

      // Check if already locked
      if (filePath.endsWith(ENCRYPTED_EXTENSION)) {
        return { success: false, error: 'File is already locked.' };
      }

      // Check if this file path is already tracked as locked
      const existingEntry = Object.values(this.metadata.lockedFiles).find(
        (entry) => entry.originalPath.toLowerCase() === filePath.toLowerCase() && entry.lockStatus === 'locked'
      );
      if (existingEntry) {
        return { success: false, error: 'This file is already locked.' };
      }

      // Read the file
      console.log('[FileLock] Reading file for encryption:', filePath);
      const fileData = fs.readFileSync(filePath);

      // Encrypt
      console.log('[FileLock] Encrypting file...');
      const { salt, iv, encryptedData } = this._encryptBuffer(fileData, password);

      // Build the locked file
      const lockedFileBuffer = this._buildLockedFile(salt, iv, encryptedData);

      // Determine output path
      const encryptedPath = filePath + ENCRYPTED_EXTENSION;

      // Write encrypted file
      console.log('[FileLock] Writing encrypted file:', encryptedPath);
      fs.writeFileSync(encryptedPath, lockedFileBuffer);

      // Securely delete original
      console.log('[FileLock] Securely deleting original file...');
      await this._secureDelete(filePath);

      // Store metadata
      const fileId = this._generateId();
      this.metadata.lockedFiles[fileId] = {
        id: fileId,
        originalPath: filePath,
        encryptedPath: encryptedPath,
        originalName: path.basename(filePath),
        originalExt: path.extname(filePath).toLowerCase(),
        originalSize: stats.size,
        lockStatus: 'locked',
        lockedAt: new Date().toISOString(),
        lastAccessedAt: null,
        passwordHint: options.hint || '',
        autoLockTimeout: options.autoLockTimeout || 0,
      };

      this._addHistory(fileId, 'locked', filePath);
      this._saveMetadata();

      // Acquire OS kernel handle lock on the .intellilock file
      this._acquireOSLock(fileId, encryptedPath);

      console.log('[FileLock] File locked successfully:', fileId);
      return { success: true, fileId };
    } catch (err) {
      console.error('[FileLock] Lock failed:', err.message || err);
      return { success: false, error: err.message || 'Failed to lock file.' };
    }
  }

  /**
   * Unlock a file by its ID.
   * @param {string} fileId - The locked file's UUID
   * @param {string} password - User's password/PIN
   * @returns {{ success: boolean, error?: string, restoredPath?: string }}
   */
  async unlockFile(fileId, password) {
    this._ensureLoaded();

    try {
      if (!fileId || !password) {
        return { success: false, error: 'File ID and password are required.' };
      }

      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'Locked file not found in vault.' };
      }

      if (entry.lockStatus !== 'locked') {
        return { success: false, error: 'File is not currently locked.' };
      }

      // Check encrypted file exists
      if (!fs.existsSync(entry.encryptedPath)) {
        return { success: false, error: 'Encrypted file not found on disk. It may have been moved or deleted.' };
      }

      // Release OS handle lock and remove NTFS ACL deny before reading encrypted file
      this._releaseOSLock(fileId);
      this._removeNTFSACLDeny(entry.encryptedPath);

      // Read encrypted file
      console.log('[FileLock] Reading encrypted file:', entry.encryptedPath);
      let fileBuffer;
      try {
        fileBuffer = fs.readFileSync(entry.encryptedPath);
      } catch (readErr) {
        this._applyNTFSACLDeny(entry.encryptedPath);
        this._acquireOSLock(fileId, entry.encryptedPath);
        return { success: false, error: 'Failed to read encrypted file.' };
      }

      // Parse the locked file format
      const { salt, iv, encryptedData } = this._parseLockedFile(fileBuffer);

      // Decrypt
      console.log('[FileLock] Decrypting file...');
      let originalData;
      try {
        originalData = this._decryptBuffer(encryptedData, password, salt, iv);
      } catch (decryptErr) {
        this._applyNTFSACLDeny(entry.encryptedPath);
        this._acquireOSLock(fileId, entry.encryptedPath);
        return { success: false, error: 'Incorrect password.' };
      }

      // Restore original file
      const restoredPath = entry.originalPath;
      console.log('[FileLock] Restoring original file:', restoredPath);

      // Ensure parent directory exists
      const parentDir = path.dirname(restoredPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(restoredPath, originalData);

      // Delete encrypted file
      try {
        fs.unlinkSync(entry.encryptedPath);
      } catch (e) {
        console.warn('[FileLock] Could not delete encrypted file:', e.message);
      }

      // Clear auto-lock timer if active
      if (this.autoLockTimers.has(fileId)) {
        clearTimeout(this.autoLockTimers.get(fileId));
        this.autoLockTimers.delete(fileId);
      }

      // Update metadata
      this._addHistory(fileId, 'unlocked', entry.originalPath);

      // Remove from locked files after unlocking
      delete this.metadata.lockedFiles[fileId];
      this._saveMetadata();

      console.log('[FileLock] File unlocked successfully:', restoredPath);
      return { success: true, restoredPath };
    } catch (err) {
      console.error('[FileLock] Unlock failed:', err.message || err);
      return { success: false, error: err.message || 'Failed to unlock file.' };
    }
  }

  /**
   * Temporarily decrypt a file to the OS temp directory for viewing.
   * The original encrypted file remains in the vault.
   * @param {string} fileId - The locked file's UUID
   * @param {string} password - User's password/PIN
   * @returns {{ success: boolean, error?: string, tempPath?: string }}
   */
  async accessFile(fileId, password) {
    this._ensureLoaded();

    try {
      if (!fileId || !password) {
        return { success: false, error: 'File ID and password are required.' };
      }

      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'Locked file not found in vault.' };
      }

      if (entry.lockStatus !== 'locked') {
        return { success: false, error: 'File is not currently locked.' };
      }

      if (!fs.existsSync(entry.encryptedPath)) {
        return { success: false, error: 'Encrypted file not found on disk.' };
      }

      // Read encrypted file
      console.log('[FileLock] Reading encrypted file for access:', entry.encryptedPath);
      const fileBuffer = fs.readFileSync(entry.encryptedPath);

      // Parse the locked file format
      const { salt, iv, encryptedData } = this._parseLockedFile(fileBuffer);

      // Decrypt
      console.log('[FileLock] Decrypting file to memory...');
      let originalData;
      try {
        originalData = this._decryptBuffer(encryptedData, password, salt, iv);
      } catch (decryptErr) {
        return { success: false, error: 'Incorrect password.' };
      }

      // Create temp file path
      const tempDir = path.join(os.tmpdir(), 'intellifile-secure-view');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Add a random suffix to avoid collisions but keep the original extension for the OS to know how to open it
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const tempFileName = `[Locked] ${entry.originalName.replace(entry.originalExt, '')}_${randomSuffix}${entry.originalExt}`;
      const tempPath = path.join(tempDir, tempFileName);

      fs.writeFileSync(tempPath, originalData);
      
      // Track for cleanup
      this.tempAccessFiles.add(tempPath);

      // Update metadata to show it was accessed
      entry.lastAccessedAt = new Date().toISOString();
      this._addHistory(fileId, 'accessed', entry.originalPath);
      this._saveMetadata();

      console.log('[FileLock] File temporarily decrypted for access:', tempPath);
      return { success: true, tempPath };
    } catch (err) {
      console.error('[FileLock] Access failed:', err.message || err);
      return { success: false, error: err.message || 'Failed to access file.' };
    }
  }

  /**
   * Cleans up any temporarily decrypted files.
   * Call this when IntelliFile exits.
   */
  cleanupTempFiles() {
    console.log(`[FileLock] Cleaning up ${this.tempAccessFiles.size} temp files...`);
    for (const tempPath of this.tempAccessFiles) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (err) {
        console.warn(`[FileLock] Failed to clean up temp file ${tempPath}:`, err.message);
      }
    }
    this.tempAccessFiles.clear();
  }

  /**
   * Verify a password without decrypting the full file.
   * We still need to decrypt to verify (GCM authentication), but we don't write anything.
   */
  verifyPassword(fileId, password) {
    this._ensureLoaded();

    try {
      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'File not found in vault.' };
      }

      if (!fs.existsSync(entry.encryptedPath)) {
        return { success: false, error: 'Encrypted file not found on disk.' };
      }

      this._removeNTFSACLDeny(entry.encryptedPath);
      let fileBuffer;
      try {
        fileBuffer = fs.readFileSync(entry.encryptedPath);
      } finally {
        this._applyNTFSACLDeny(entry.encryptedPath);
      }

      const { salt, iv, encryptedData } = this._parseLockedFile(fileBuffer);

      try {
        this._decryptBuffer(encryptedData, password, salt, iv);
        return { success: true, verified: true };
      } catch {
        return { success: true, verified: false };
      }
    } catch (err) {
      return { success: false, error: err.message || 'Verification failed.' };
    }
  }

  /**
   * Change password for a locked file.
   * Decrypts with old password, re-encrypts with new password.
   */
  async changePassword(fileId, oldPassword, newPassword) {
    this._ensureLoaded();

    try {
      if (!fileId || !oldPassword || !newPassword) {
        return { success: false, error: 'File ID, old password, and new password are required.' };
      }

      if (newPassword.length < 4) {
        return { success: false, error: 'New password must be at least 4 characters.' };
      }

      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'File not found in vault.' };
      }

      if (!fs.existsSync(entry.encryptedPath)) {
        return { success: false, error: 'Encrypted file not found on disk.' };
      }

      // Read and decrypt with old password
      const fileBuffer = fs.readFileSync(entry.encryptedPath);
      const { salt, iv, encryptedData } = this._parseLockedFile(fileBuffer);

      let originalData;
      try {
        originalData = this._decryptBuffer(encryptedData, oldPassword, salt, iv);
      } catch {
        return { success: false, error: 'Current password is incorrect.' };
      }

      // Re-encrypt with new password
      const newEncrypted = this._encryptBuffer(originalData, newPassword);
      const newLockedBuffer = this._buildLockedFile(newEncrypted.salt, newEncrypted.iv, newEncrypted.encryptedData);

      // Temporarily release OS handle lock to write re-encrypted file
      this._releaseOSLock(fileId);

      // Write new encrypted file
      fs.writeFileSync(entry.encryptedPath, newLockedBuffer);

      // Re-acquire OS handle lock
      this._acquireOSLock(fileId, entry.encryptedPath);

      this._addHistory(fileId, 'password_changed', entry.originalPath);
      this._saveMetadata();

      console.log('[FileLock] Password changed for:', fileId);
      return { success: true };
    } catch (err) {
      console.error('[FileLock] Password change failed:', err.message || err);
      return { success: false, error: err.message || 'Failed to change password.' };
    }
  }

  /**
   * Rename a locked file after verifying its password.
   * @param {string} fileId - The locked file's UUID
   * @param {string} password - User's password/PIN
   * @param {string} newName - Target new file name (or path)
   */
  async renameLockedFile(fileId, password, newName) {
    this._ensureLoaded();

    try {
      if (!fileId || !password || !newName) {
        return { success: false, error: 'File ID, password, and new name are required.' };
      }

      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'Locked file not found in vault.' };
      }

      if (entry.lockStatus !== 'locked') {
        return { success: false, error: 'File is not currently locked.' };
      }

      // Verify password first
      const verifyResult = this.verifyPassword(fileId, password);
      if (!verifyResult.success || !verifyResult.verified) {
        return { success: false, error: 'Incorrect password.' };
      }

      const currentEncryptedPath = entry.encryptedPath;
      if (!fs.existsSync(currentEncryptedPath)) {
        return { success: false, error: 'Encrypted file not found on disk.' };
      }

      const dir = path.dirname(currentEncryptedPath);
      let cleanNewName = path.basename(newName.trim());
      if (!cleanNewName) {
        return { success: false, error: 'New file name cannot be empty.' };
      }

      // Preserve .intellilock extension if target path needs it
      if (currentEncryptedPath.endsWith(ENCRYPTED_EXTENSION) && !cleanNewName.endsWith(ENCRYPTED_EXTENSION)) {
        cleanNewName += ENCRYPTED_EXTENSION;
      }

      const targetEncryptedPath = path.join(dir, cleanNewName);

      if (currentEncryptedPath.toLowerCase() !== targetEncryptedPath.toLowerCase() && fs.existsSync(targetEncryptedPath)) {
        return { success: false, error: 'A file with that name already exists in this folder.' };
      }

      // Temporarily release OS handle lock and remove NTFS ACL deny
      this._releaseOSLock(fileId);
      this._removeNTFSACLDeny(currentEncryptedPath);

      // Rename on disk
      fs.renameSync(currentEncryptedPath, targetEncryptedPath);

      // Update metadata entries
      entry.encryptedPath = targetEncryptedPath;
      const baseNoLock = cleanNewName.endsWith(ENCRYPTED_EXTENSION)
        ? cleanNewName.slice(0, -ENCRYPTED_EXTENSION.length)
        : cleanNewName;

      const originalDir = path.dirname(entry.originalPath);
      entry.originalName = baseNoLock;
      entry.originalPath = path.join(originalDir, baseNoLock);

      this._addHistory(fileId, 'renamed', targetEncryptedPath);
      this._saveMetadata();

      // Re-acquire OS handle lock on the new path!
      this._acquireOSLock(fileId, targetEncryptedPath);

      console.log('[FileLock] Locked file renamed successfully:', targetEncryptedPath);
      return { success: true, newPath: targetEncryptedPath, entry };
    } catch (err) {
      console.error('[FileLock] Rename failed:', err.message || err);
      // Attempt to restore OS handle lock if file still exists
      const entry = this.metadata.lockedFiles[fileId];
      if (entry && fs.existsSync(entry.encryptedPath)) {
        this._acquireOSLock(fileId, entry.encryptedPath);
      }
      return { success: false, error: err.message || 'Failed to rename locked file.' };
    }
  }

  /**
   * Delete a locked file permanently after verifying its password.
   * @param {string} fileId - The locked file's UUID
   * @param {string} password - User's password/PIN
   */
  async deleteLockedFile(fileId, password) {
    this._ensureLoaded();

    try {
      if (!fileId || !password) {
        return { success: false, error: 'File ID and password are required.' };
      }

      const entry = this.metadata.lockedFiles[fileId];
      if (!entry) {
        return { success: false, error: 'Locked file not found in vault.' };
      }

      if (entry.lockStatus !== 'locked') {
        return { success: false, error: 'File is not currently locked.' };
      }

      // Verify password first
      const verifyResult = this.verifyPassword(fileId, password);
      if (!verifyResult.success || !verifyResult.verified) {
        return { success: false, error: 'Incorrect password.' };
      }

      const encryptedPath = entry.encryptedPath;

      // Release OS handle lock and remove NTFS ACL deny
      this._releaseOSLock(fileId);
      this._removeNTFSACLDeny(encryptedPath);

      // Securely delete file if it exists
      if (fs.existsSync(encryptedPath)) {
        await this._secureDelete(encryptedPath);
      }

      // Clear auto-lock timer if active
      if (this.autoLockTimers.has(fileId)) {
        clearTimeout(this.autoLockTimers.get(fileId));
        this.autoLockTimers.delete(fileId);
      }

      // Update metadata
      this._addHistory(fileId, 'deleted', entry.originalPath);
      delete this.metadata.lockedFiles[fileId];
      this._saveMetadata();

      console.log('[FileLock] Locked file deleted successfully:', encryptedPath);
      return { success: true };
    } catch (err) {
      console.error('[FileLock] Delete failed:', err.message || err);
      // Re-acquire OS lock if file still exists
      const entry = this.metadata.lockedFiles[fileId];
      if (entry && fs.existsSync(entry.encryptedPath)) {
        this._acquireOSLock(fileId, entry.encryptedPath);
      }
      return { success: false, error: err.message || 'Failed to delete locked file.' };
    }
  }

  /**
   * Get all locked files metadata.
   */
  getLockedFiles() {
    this._ensureLoaded();

    // Validate that encrypted files still exist on disk
    const files = {};
    for (const [id, entry] of Object.entries(this.metadata.lockedFiles)) {
      const exists = fs.existsSync(entry.encryptedPath);
      files[id] = {
        ...entry,
        fileExists: exists,
      };
    }

    return { success: true, files };
  }

  /**
   * Check if a specific file path is locked.
   */
  getFileStatus(filePath) {
    this._ensureLoaded();

    if (!filePath) return { success: true, isLocked: false };

    const normalizedPath = filePath.toLowerCase();

    // Check if this is the original path of a locked file
    const entry = Object.values(this.metadata.lockedFiles).find(
      (e) => e.originalPath.toLowerCase() === normalizedPath && e.lockStatus === 'locked'
    );

    if (entry) {
      return { success: true, isLocked: true, fileId: entry.id, entry };
    }

    // Check if this IS the encrypted file
    const encEntry = Object.values(this.metadata.lockedFiles).find(
      (e) => e.encryptedPath.toLowerCase() === normalizedPath && e.lockStatus === 'locked'
    );

    if (encEntry) {
      return { success: true, isLocked: true, fileId: encEntry.id, entry: encEntry };
    }

    return { success: true, isLocked: false };
  }

  /**
   * Get lock/unlock history.
   */
  getHistory(limit = 100) {
    this._ensureLoaded();
    return { success: true, history: this.metadata.history.slice(0, limit) };
  }

  /**
   * Set auto-lock timeout for a file (in minutes). 0 = disabled.
   */
  setAutoLockTimeout(fileId, timeoutMinutes) {
    this._ensureLoaded();

    const entry = this.metadata.lockedFiles[fileId];
    if (!entry) {
      return { success: false, error: 'File not found in vault.' };
    }

    entry.autoLockTimeout = timeoutMinutes || 0;
    this._saveMetadata();

    return { success: true };
  }

  /**
   * Check if a file has the .intellilock extension.
   */
  isLockedExtension(filePath) {
    if (!filePath) return false;
    return filePath.toLowerCase().endsWith(ENCRYPTED_EXTENSION);
  }

  /**
   * Find a locked file entry by its encrypted path.
   */
  findByEncryptedPath(encryptedPath) {
    this._ensureLoaded();
    if (!encryptedPath) return null;

    const normalized = encryptedPath.toLowerCase();
    return Object.values(this.metadata.lockedFiles).find(
      (e) => e.encryptedPath.toLowerCase() === normalized
    ) || null;
  }
}

module.exports = { FileLockService, ENCRYPTED_EXTENSION };
