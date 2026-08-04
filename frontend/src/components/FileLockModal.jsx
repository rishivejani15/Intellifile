import React, { useState, useEffect, useRef } from 'react';
import './FileLockModal.css';

const ipcRenderer = window.electron?.ipcRenderer;

function FileLockModal({ visible, mode, file, onClose, onSuccess }) {
  // mode: 'lock' | 'unlock' | 'changePassword'
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [passwordHint, setPasswordHint] = useState('');
  const passwordRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setPassword('');
      setConfirmPassword('');
      setHint('');
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowPassword(false);
      setError('');
      setLoading(false);
      setSuccess(false);
      setPasswordHint('');

      // If unlocking, fetch the password hint
      if (mode === 'unlock' && file?.fileId) {
        window.intellifile?.fileLock?.getLockedFiles?.().then((result) => {
          if (result?.success && result.files?.[file.fileId]) {
            setPasswordHint(result.files[file.fileId].passwordHint || '');
          }
        });
      }

      // Focus password input after render
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [visible, mode, file]);

  if (!visible) return null;

  const getPasswordStrength = (pwd) => {
    if (!pwd) return { label: '', level: 0, color: '' };
    let score = 0;
    if (pwd.length >= 4) score++;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { label: 'Weak', level: 1, color: '#ff4757' };
    if (score <= 2) return { label: 'Fair', level: 2, color: '#ffa502' };
    if (score <= 3) return { label: 'Good', level: 3, color: '#2ed573' };
    return { label: 'Strong', level: 4, color: '#7bed9f' };
  };

  const handleLock = async () => {
    setError('');

    if (!password) {
      setError('Please enter a password.');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.lockFile(
        file.path,
        password,
        { hint: hint.trim() }
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) {}
        setTimeout(() => {
          onSuccess?.({ action: 'locked', fileId: result.fileId, filePath: file.path });
          onClose();
        }, 1200);
      } else {
        setError(result.error || 'Failed to lock file.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setError('');

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.unlockFile(
        file.fileId,
        password
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) {}
        setTimeout(() => {
          onSuccess?.({ action: 'unlocked', restoredPath: result.restoredPath, filePath: file.path });
          onClose();
        }, 1200);
      } else {
        setError(result.error || 'Failed to unlock file.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccess = async () => {
    setError('');

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.accessFile(
        file.fileId,
        password
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) {}
        setTimeout(() => {
          onSuccess?.({ action: 'accessed', fileId: file.fileId });
          onClose();
        }, 800);
      } else {
        setError(result.error || 'Failed to open file.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setError('');

    if (!oldPassword) {
      setError('Please enter your current password.');
      return;
    }
    if (!newPassword) {
      setError('Please enter a new password.');
      return;
    }
    if (newPassword.length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.changePassword(
        file.fileId,
        oldPassword,
        newPassword
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) {}
        setTimeout(() => {
          onSuccess?.({ action: 'password_changed', fileId: file.fileId });
          onClose();
        }, 1200);
      } else {
        setError(result.error || 'Failed to change password.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'lock') handleLock();
    else if (mode === 'unlock') handleUnlock();
    else if (mode === 'access') handleAccess();
    else if (mode === 'changePassword') handleChangePassword();
  };

  const strength = mode === 'lock' ? getPasswordStrength(password) : 
                   mode === 'changePassword' ? getPasswordStrength(newPassword) : null;

  const getTitle = () => {
    if (mode === 'lock') return 'Lock File';
    if (mode === 'unlock') return 'Unlock File';
    if (mode === 'access') return 'Access File';
    return 'Change Password';
  };

  const getIcon = () => {
    if (success) return '✅';
    if (mode === 'lock') return '🔒';
    if (mode === 'unlock') return '🔓';
    if (mode === 'access') return '👁️';
    return '🔑';
  };

  const fileName = file?.name || file?.originalName || 'Unknown File';

  return (
    <div className="file-lock-overlay" onClick={onClose}>
      <div className={`file-lock-modal ${success ? 'success' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="file-lock-header">
          <div className={`file-lock-icon ${success ? 'success-anim' : ''}`}>
            {getIcon()}
          </div>
          <h2 className="file-lock-title">{success ? 'Success!' : getTitle()}</h2>
          <button className="file-lock-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* File info */}
        <div className="file-lock-file-info">
          <span className="file-lock-filename" title={file?.path || ''}>
            📄 {fileName}
          </span>
          {file?.size && (
            <span className="file-lock-filesize">
              {formatFileSize(file.size || file.originalSize)}
            </span>
          )}
        </div>

        {success ? (
          <div className="file-lock-success-message">
            {mode === 'lock' && 'File has been encrypted and locked securely.'}
            {mode === 'unlock' && 'File has been decrypted and restored.'}
            {mode === 'access' && 'Opening file...'}
            {mode === 'changePassword' && 'Password has been changed successfully.'}
          </div>
        ) : (
          <form className="file-lock-form" onSubmit={handleSubmit}>
            {/* Lock Mode */}
            {mode === 'lock' && (
              <>
                <div className="file-lock-field">
                  <label>Password / PIN</label>
                  <div className="file-lock-input-wrapper">
                    <input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter a password or PIN"
                      disabled={loading}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="file-lock-toggle-vis"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {password && strength && (
                    <div className="file-lock-strength">
                      <div className="file-lock-strength-bar">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`file-lock-strength-segment ${i <= strength.level ? 'active' : ''}`}
                            style={{ backgroundColor: i <= strength.level ? strength.color : '' }}
                          />
                        ))}
                      </div>
                      <span className="file-lock-strength-label" style={{ color: strength.color }}>
                        {strength.label}
                      </span>
                    </div>
                  )}
                </div>
                <div className="file-lock-field">
                  <label>Confirm Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <div className="file-lock-field">
                  <label>Password Hint <span className="file-lock-optional">(optional)</span></label>
                  <input
                    type="text"
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="e.g. my pet's name"
                    disabled={loading}
                  />
                </div>

                <div className="file-lock-warning">
                  ⚠️ If you forget your password, the file <strong>cannot be recovered</strong>. 
                  The original file will be encrypted and securely deleted.
                </div>
              </>
            )}

            {/* Unlock Mode */}
            {mode === 'unlock' && (
              <>
                <div className="file-lock-field">
                  <label>Password / PIN</label>
                  <div className="file-lock-input-wrapper">
                    <input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password or PIN"
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="file-lock-toggle-vis"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                {passwordHint && (
                  <div className="file-lock-hint">
                    💡 <strong>Hint:</strong> {passwordHint}
                  </div>
                )}
                <div className="file-lock-warning" style={{ color: '#aaa', background: 'none', border: 'none', padding: 0 }}>
                  This will permanently decrypt and restore the file to your computer.
                </div>
              </>
            )}

            {/* Access Mode */}
            {mode === 'access' && (
              <>
                <div className="file-lock-field">
                  <label>Password / PIN</label>
                  <div className="file-lock-input-wrapper">
                    <input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password or PIN"
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="file-lock-toggle-vis"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                {passwordHint && (
                  <div className="file-lock-hint">
                    💡 <strong>Hint:</strong> {passwordHint}
                  </div>
                )}
                <div className="file-lock-warning" style={{ color: '#2ed573', background: 'rgba(46, 213, 115, 0.1)', borderColor: 'rgba(46, 213, 115, 0.2)' }}>
                  The file will remain locked in your vault. A temporary copy will be opened for viewing.
                </div>
              </>
            )}

            {/* Change Password Mode */}
            {mode === 'changePassword' && (
              <>
                <div className="file-lock-field">
                  <label>Current Password</label>
                  <div className="file-lock-input-wrapper">
                    <input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder="Enter current password"
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="file-lock-toggle-vis"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div className="file-lock-field">
                  <label>New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  {newPassword && strength && (
                    <div className="file-lock-strength">
                      <div className="file-lock-strength-bar">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`file-lock-strength-segment ${i <= strength.level ? 'active' : ''}`}
                            style={{ backgroundColor: i <= strength.level ? strength.color : '' }}
                          />
                        ))}
                      </div>
                      <span className="file-lock-strength-label" style={{ color: strength.color }}>
                        {strength.label}
                      </span>
                    </div>
                  )}
                </div>
                <div className="file-lock-field">
                  <label>Confirm New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <div className="file-lock-error">
                ❌ {error}
              </div>
            )}

            {/* Actions */}
            <div className="file-lock-actions">
              <button
                type="button"
                className="file-lock-btn file-lock-btn-cancel"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`file-lock-btn file-lock-btn-primary ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading && <span className="file-lock-spinner" />}
                {mode === 'lock' && (loading ? 'Encrypting…' : '🔒 Lock File')}
                {mode === 'unlock' && (loading ? 'Decrypting…' : '🔓 Unlock File')}
                {mode === 'access' && (loading ? 'Opening…' : '👁️ Open File')}
                {mode === 'changePassword' && (loading ? 'Updating…' : '🔑 Change Password')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default FileLockModal;
