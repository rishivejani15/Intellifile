import React, { useState, useEffect, useRef } from 'react';
import {
  MdLock, MdLockOpen, MdOutlineVisibility, MdVpnKey, MdEdit, MdDelete
} from 'react-icons/md';
import './FileLockModal.css';

function FileLockModal({ visible, mode, file, onClose, onSuccess }) {
  // mode: 'lock' | 'unlock' | 'access' | 'changePassword' | 'renameLocked' | 'deleteLocked'
  const [viewMode, setViewMode] = useState('normal'); // 'normal' | 'forgotPassword' | 'resetPassword' | 'recoveryKeyCreated'
  const [recoveryTab, setRecoveryTab] = useState('key'); // 'key' | 'questions'

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [renameNewName, setRenameNewName] = useState('');

  // Recovery States
  const [createdRecoveryKey, setCreatedRecoveryKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [showSecQuestionsSetup, setShowSecQuestionsSetup] = useState(false);
  const [q1Input, setQ1Input] = useState('What is the name of your first pet?');
  const [a1Input, setA1Input] = useState('');
  const [q2Input, setQ2Input] = useState('What city were you born in?');
  const [a2Input, setA2Input] = useState('');

  // Loaded Security Questions for Recovery
  const [securityQuestions, setSecurityQuestions] = useState([]);
  const [hasSecurityQuestions, setHasSecurityQuestions] = useState(false);
  const [q1AnswerInput, setQ1AnswerInput] = useState('');
  const [q2AnswerInput, setQ2AnswerInput] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [passwordHint, setPasswordHint] = useState('');
  const passwordRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setViewMode('normal');
      setRecoveryTab('key');
      setPassword('');
      setConfirmPassword('');
      setHint('');
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setRenameNewName(file?.targetNewName || file?.name || file?.originalName || '');
      setCreatedRecoveryKey(null);
      setCopiedKey(false);
      setRecoveryKeyInput('');
      setShowSecQuestionsSetup(false);
      setA1Input('');
      setA2Input('');
      setQ1AnswerInput('');
      setQ2AnswerInput('');
      setShowPassword(false);
      setError('');
      setLoading(false);
      setSuccess(false);
      setPasswordHint('');

      const fileId = file?.fileId || file?.id;

      // Fetch password hint & security questions if unlocking, renaming, deleting, or recovering
      if (fileId && (mode === 'unlock' || mode === 'access' || mode === 'renameLocked' || mode === 'deleteLocked')) {
        window.intellifile?.fileLock?.getLockedFiles?.().then((result) => {
          if (result?.success && result.files?.[fileId]) {
            setPasswordHint(result.files[fileId].passwordHint || '');
          }
        });

        window.intellifile?.fileLock?.getSecurityQuestions?.(fileId).then((result) => {
          if (result?.success) {
            setHasSecurityQuestions(result.hasSecurityQuestions);
            setSecurityQuestions(result.questions || []);
            if (!result.hasSecurityQuestions) {
              setRecoveryTab('key');
            }
          }
        });
      }

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

  const copyToClipboard = (text) => {
    if (navigator.clipboard && text) {
      navigator.clipboard.writeText(text);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
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

    const secQs = [];
    if (showSecQuestionsSetup) {
      if (q1Input.trim() && a1Input.trim()) secQs.push({ question: q1Input.trim(), answer: a1Input.trim() });
      if (q2Input.trim() && a2Input.trim()) secQs.push({ question: q2Input.trim(), answer: a2Input.trim() });
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.lockFile(
        file.path,
        password,
        {
          hint: hint.trim(),
          securityQuestions: secQs,
        }
      );

      if (result.success) {
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        if (result.recoveryKey) {
          setCreatedRecoveryKey(result.recoveryKey);
          setViewMode('recoveryKeyCreated');
        } else {
          setSuccess(true);
          setTimeout(() => {
            onSuccess?.({ action: 'locked', fileId: result.fileId, filePath: file.path });
            onClose();
          }, 1200);
        }
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
        file.fileId || file.id,
        password
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
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
        file.fileId || file.id,
        password
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        setTimeout(() => {
          onSuccess?.({ action: 'accessed', fileId: file.fileId || file.id });
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

  const handleRecoverUnlock = async () => {
    setError('');
    const targetFileId = file?.fileId || file?.id;

    if (recoveryTab === 'key') {
      if (!recoveryKeyInput.trim()) {
        setError('Please enter your Master Recovery Key.');
        return;
      }

      setLoading(true);
      try {
        const result = await window.intellifile.fileLock.recoverFileWithKey(
          targetFileId,
          recoveryKeyInput.trim()
        );

        if (result.success) {
          setSuccess(true);
          try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
          setTimeout(() => {
            onSuccess?.({ action: 'unlocked', restoredPath: result.restoredPath });
            onClose();
          }, 1200);
        } else {
          setError(result.error || 'Invalid Master Recovery Key.');
        }
      } catch (err) {
        setError(err.message || 'Recovery failed.');
      } finally {
        setLoading(false);
      }
    } else {
      const answers = [q1AnswerInput.trim(), q2AnswerInput.trim()].filter(Boolean);
      if (answers.length === 0) {
        setError('Please answer the security questions.');
        return;
      }

      setLoading(true);
      try {
        const result = await window.intellifile.fileLock.recoverFileWithQuestions(
          targetFileId,
          answers
        );

        if (result.success) {
          setSuccess(true);
          try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
          setTimeout(() => {
            onSuccess?.({ action: 'unlocked', restoredPath: result.restoredPath });
            onClose();
          }, 1200);
        } else {
          setError(result.error || 'Incorrect security question answers.');
        }
      } catch (err) {
        setError(err.message || 'Recovery failed.');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleProceedToResetPassword = () => {
    setError('');
    if (recoveryTab === 'key' && !recoveryKeyInput.trim()) {
      setError('Please enter your Master Recovery Key first.');
      return;
    }
    if (recoveryTab === 'questions' && (!q1AnswerInput.trim() && !q2AnswerInput.trim())) {
      setError('Please answer the security questions first.');
      return;
    }
    setViewMode('resetPassword');
  };

  const handleExecuteResetPassword = async () => {
    setError('');

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

    const targetFileId = file?.fileId || file?.id;
    const payload = {
      newPassword,
      hint: hint.trim(),
    };

    if (recoveryTab === 'key') {
      payload.recoveryKey = recoveryKeyInput.trim();
    } else {
      payload.securityAnswers = [q1AnswerInput.trim(), q2AnswerInput.trim()].filter(Boolean);
    }

    setLoading(true);
    try {
      const result = await window.intellifile.fileLock.resetFilePassword(targetFileId, payload);

      if (result.success) {
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        if (result.newRecoveryKey) {
          setCreatedRecoveryKey(result.newRecoveryKey);
          setViewMode('recoveryKeyCreated');
        } else {
          setSuccess(true);
          setTimeout(() => {
            onSuccess?.({ action: 'password_reset', fileId: targetFileId });
            onClose();
          }, 1200);
        }
      } else {
        setError(result.error || 'Failed to reset password.');
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
      const targetFileId = file?.fileId || file?.id;
      const result = await window.intellifile.fileLock.changePassword(
        targetFileId,
        oldPassword,
        newPassword
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        setTimeout(() => {
          onSuccess?.({ action: 'password_changed', fileId: targetFileId });
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

  const handleRenameLocked = async () => {
    setError('');

    if (!password) {
      setError('Please enter your password.');
      return;
    }
    if (!renameNewName.trim()) {
      setError('Please enter a new file name.');
      return;
    }

    setLoading(true);
    try {
      const targetFileId = file?.fileId || file?.id;
      const result = await window.intellifile.fileLock.renameLockedFile(
        targetFileId,
        password,
        renameNewName.trim()
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        setTimeout(() => {
          onSuccess?.({ action: 'renamed', newPath: result.newPath, fileId: targetFileId });
          onClose();
        }, 1200);
      } else {
        setError(result.error || 'Failed to rename locked file.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLocked = async () => {
    setError('');

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const targetFileId = file?.fileId || file?.id;
      const result = await window.intellifile.fileLock.deleteLockedFile(
        targetFileId,
        password
      );

      if (result.success) {
        setSuccess(true);
        try { window.dispatchEvent(new CustomEvent('vault-updated')); } catch (_) { }
        setTimeout(() => {
          onSuccess?.({ action: 'deleted', fileId: targetFileId });
          onClose();
        }, 1200);
      } else {
        setError(result.error || 'Failed to delete locked file.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (viewMode === 'forgotPassword') {
      handleRecoverUnlock();
    } else if (viewMode === 'resetPassword') {
      handleExecuteResetPassword();
    } else if (mode === 'lock') {
      handleLock();
    } else if (mode === 'unlock') {
      handleUnlock();
    } else if (mode === 'access') {
      handleAccess();
    } else if (mode === 'changePassword') {
      handleChangePassword();
    } else if (mode === 'renameLocked') {
      handleRenameLocked();
    } else if (mode === 'deleteLocked') {
      handleDeleteLocked();
    }
  };

  const strength = (mode === 'lock' || viewMode === 'resetPassword') ? getPasswordStrength(password || newPassword) :
    mode === 'changePassword' ? getPasswordStrength(newPassword) : null;

  const getTitle = () => {
    if (viewMode === 'recoveryKeyCreated') return 'Master Recovery Key';
    if (viewMode === 'forgotPassword') return 'Recover File Access';
    if (viewMode === 'resetPassword') return 'Reset File Password';
    if (mode === 'lock') return 'Lock File';
    if (mode === 'unlock') return 'Unlock File';
    if (mode === 'access') return 'Access File';
    if (mode === 'changePassword') return 'Change Password';
    if (mode === 'renameLocked') return 'Rename Locked File';
    if (mode === 'deleteLocked') return 'Delete Locked File';
    return 'File Vault';
  };

  const getIcon = () => {
    if (success) return '✅';
    if (viewMode === 'recoveryKeyCreated') return '🔑';
    if (viewMode === 'forgotPassword' || viewMode === 'resetPassword') return '🛠️';
    if (mode === 'lock') return '🔒';
    if (mode === 'unlock') return '🔓';
    if (mode === 'access') return '👁️';
    if (mode === 'changePassword') return '🔑';
    if (mode === 'renameLocked') return '✏️';
    if (mode === 'deleteLocked') return '🗑️';
    return '🔐';
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
        ) : viewMode === 'recoveryKeyCreated' ? (
          /* Recovery Key Display View */
          <div className="file-lock-recovery-created">
            <p className="file-lock-recovery-subtitle">
              Your file is now encrypted! Please save this <strong>Master Recovery Key</strong> in a safe place.
            </p>
            <div className="file-lock-key-box">
              <code className="file-lock-key-code">{createdRecoveryKey}</code>
              <button
                type="button"
                className="file-lock-copy-btn"
                onClick={() => copyToClipboard(createdRecoveryKey)}
              >
                {copiedKey ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
            <div className="file-lock-warning file-lock-recovery-warning">
              <span className="file-lock-warning-icon">⚠️</span>
              <p className="file-lock-warning-text">
                If you forget your password and hint, this key is the <strong>only way</strong> to recover your file.
              </p>
            </div>
            <button
              type="button"
              className="file-lock-btn file-lock-btn-primary full-width"
              onClick={() => {
                onSuccess?.({ action: 'locked', fileId: file?.fileId || file?.id, filePath: file?.path });
                onClose();
              }}
            >
              Done (I've Saved My Key)
            </button>
          </div>
        ) : (
          <form className="file-lock-form" onSubmit={handleSubmit}>

            {/* Lock Mode */}
            {viewMode === 'normal' && mode === 'lock' && (
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

                {/* Optional Security Questions Setup Toggle */}
                <div className="file-lock-sec-toggle">
                  <label className="file-lock-checkbox-label">
                    <input
                      type="checkbox"
                      checked={showSecQuestionsSetup}
                      onChange={(e) => setShowSecQuestionsSetup(e.target.checked)}
                    />
                    Add Security Questions for Easy Recovery
                  </label>
                </div>

                {showSecQuestionsSetup && (
                  <div className="file-lock-sec-questions-box">
                    <div className="file-lock-field">
                      <label>Question 1</label>
                      <input
                        type="text"
                        value={q1Input}
                        onChange={(e) => setQ1Input(e.target.value)}
                        placeholder="Security Question 1"
                      />
                      <input
                        type="text"
                        className="sec-ans-input"
                        value={a1Input}
                        onChange={(e) => setA1Input(e.target.value)}
                        placeholder="Your Answer"
                      />
                    </div>
                    <div className="file-lock-field">
                      <label>Question 2</label>
                      <input
                        type="text"
                        value={q2Input}
                        onChange={(e) => setQ2Input(e.target.value)}
                        placeholder="Security Question 2"
                      />
                      <input
                        type="text"
                        className="sec-ans-input"
                        value={a2Input}
                        onChange={(e) => setA2Input(e.target.value)}
                        placeholder="Your Answer"
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Normal Unlock / Access / Rename / Delete Modes */}
            {viewMode === 'normal' && (mode === 'unlock' || mode === 'access' || mode === 'renameLocked' || mode === 'deleteLocked') && (
              <>
                {mode === 'renameLocked' && (
                  <div className="file-lock-field">
                    <label>New File Name</label>
                    <input
                      type="text"
                      value={renameNewName}
                      onChange={(e) => setRenameNewName(e.target.value)}
                      placeholder="Enter new file name"
                      disabled={loading}
                    />
                  </div>
                )}

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

                {/* Forgot Password trigger */}
                <div className="file-lock-forgot-wrapper">
                  <button
                    type="button"
                    className="file-lock-forgot-btn"
                    onClick={() => {
                      setError('');
                      setViewMode('forgotPassword');
                    }}
                  >
                    🔑 Forgot Password? Recover File
                  </button>
                </div>
              </>
            )}

            {/* Forgot Password View */}
            {viewMode === 'forgotPassword' && (
              <div className="file-lock-recovery-view">
                <p className="file-lock-recovery-desc">
                  Select a recovery method to unlock or reset the password for this file:
                </p>

                <div className="file-lock-tabs">
                  <button
                    type="button"
                    className={`file-lock-tab ${recoveryTab === 'key' ? 'active' : ''}`}
                    onClick={() => setRecoveryTab('key')}
                  >
                    🔑 Master Recovery Key
                  </button>
                  {hasSecurityQuestions && (
                    <button
                      type="button"
                      className={`file-lock-tab ${recoveryTab === 'questions' ? 'active' : ''}`}
                      onClick={() => setRecoveryTab('questions')}
                    >
                      ❓ Security Questions
                    </button>
                  )}
                </div>

                {recoveryTab === 'key' ? (
                  <div className="file-lock-field">
                    <label>Master Recovery Key</label>
                    <input
                      type="text"
                      value={recoveryKeyInput}
                      onChange={(e) => setRecoveryKeyInput(e.target.value)}
                      placeholder="e.g. A1B2-C3D4-E5F6-G7H8"
                      disabled={loading}
                      className="file-lock-key-input"
                    />
                    <span className="file-lock-field-note">
                      Enter the 16-character key generated when the file was locked.
                    </span>
                  </div>
                ) : (
                  <div className="file-lock-questions-recovery">
                    {securityQuestions.map((q, idx) => (
                      <div key={idx} className="file-lock-field">
                        <label>{q}</label>
                        <input
                          type="text"
                          value={idx === 0 ? q1AnswerInput : q2AnswerInput}
                          onChange={(e) => idx === 0 ? setQ1AnswerInput(e.target.value) : setQ2AnswerInput(e.target.value)}
                          placeholder="Your answer"
                          disabled={loading}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Reset Password View */}
            {viewMode === 'resetPassword' && (
              <>
                <div className="file-lock-field">
                  <label>New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    disabled={loading}
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
                  />
                </div>
                <div className="file-lock-field">
                  <label>New Password Hint <span className="file-lock-optional">(optional)</span></label>
                  <input
                    type="text"
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="e.g. my cat's name"
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {/* Error Display */}
            {error && (
              <div className="file-lock-error">
                ❌ {error}
              </div>
            )}

            {/* Action Buttons */}
            <div className="file-lock-actions">
              {viewMode === 'forgotPassword' ? (
                <>
                  <button
                    type="button"
                    className="file-lock-btn file-lock-btn-cancel"
                    onClick={() => {
                      setViewMode('normal');
                      setError('');
                    }}
                    disabled={loading}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="file-lock-btn file-lock-btn-secondary"
                    onClick={handleProceedToResetPassword}
                    disabled={loading}
                  >
                    Reset Password
                  </button>
                  <button
                    type="submit"
                    className={`file-lock-btn file-lock-btn-primary ${loading ? 'loading' : ''}`}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="file-lock-spinner" />
                        <span>Recovering…</span>
                      </>
                    ) : (
                      '🔓 Recover & Unlock'
                    )}
                  </button>
                </>
              ) : viewMode === 'resetPassword' ? (
                <>
                  <button
                    type="button"
                    className="file-lock-btn file-lock-btn-cancel"
                    onClick={() => {
                      setViewMode('forgotPassword');
                      setError('');
                    }}
                    disabled={loading}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className={`file-lock-btn file-lock-btn-primary ${loading ? 'loading' : ''}`}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="file-lock-spinner" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      'Save New Password'
                    )}
                  </button>
                </>
              ) : (
                <>
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
                    {loading ? (
                      <>
                        <span className="file-lock-spinner" />
                        <span>
                          {mode === 'lock' && 'Encrypting…'}
                          {mode === 'unlock' && 'Decrypting…'}
                          {mode === 'access' && 'Opening…'}
                          {mode === 'changePassword' && 'Updating…'}
                          {mode === 'renameLocked' && 'Renaming…'}
                          {mode === 'deleteLocked' && 'Deleting…'}
                        </span>
                      </>
                    ) : (
                      <>
                        {mode === 'lock' && <><MdLock style={{ marginRight: 6 }} /> Lock File</>}
                        {mode === 'unlock' && <><MdLockOpen style={{ marginRight: 6 }} /> Unlock File</>}
                        {mode === 'access' && <><MdOutlineVisibility style={{ marginRight: 6 }} /> Open File</>}
                        {mode === 'changePassword' && <><MdVpnKey style={{ marginRight: 6 }} /> Change Password</>}
                        {mode === 'renameLocked' && <><MdEdit style={{ marginRight: 6 }} /> Rename File</>}
                        {mode === 'deleteLocked' && <><MdDelete style={{ marginRight: 6 }} /> Delete File</>}
                      </>
                    )}
                  </button>
                </>
              )}
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
