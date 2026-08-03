import React, { useState, useEffect, useCallback } from 'react';
import './OfflineSetup.css';
import { showErrorToast, showToast } from '../utils/toast';

const OfflineSetup = ({ onComplete }) => {
  const [status, setStatus] = useState('checking'); // checking, needed, running, error
  const [progress, setProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState(null);       // e.g. "SSL_CERT_VERIFY_FAILED"
  const [manualPath, setManualPath] = useState(null);     // manual model install path
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await window.intellifile.offlineSetupStatus();
        if (res.needed) {
          setStatus('needed');
        } else {
          onComplete();
        }
      } catch (e) {
        showErrorToast('Offline setup check failed.', e?.message || 'Could not verify model status.', 'Check the app can read its data folder, then try again.');
        setStatus('needed'); // default to showing if error
      }
    };

    checkStatus();
  }, [onComplete]);


  const copyPath = useCallback(() => {
    if (!manualPath) return;
    navigator.clipboard.writeText(manualPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [manualPath]);

  const startSetup = async () => {
    if (status === 'running') return;

    try {
      const networkCheck = await window.intellifile.checkNetworkConnectivity?.();
      if (!networkCheck?.success || !networkCheck?.online) {
        const message = 'Internet connection is required to download the AI models. Please turn on Wi-Fi or connect to the internet, then try again.';
        setErrorMsg(message);
        setErrorCode(null);
        setManualPath(null);
        setStatus('error');
        showErrorToast('Offline setup needs internet.', message, 'Once the connection is back, click Retry Setup.');
        return;
      }
    } catch (e) {
      const message = 'Could not verify network connectivity. Please check your internet connection and try again.';
      setErrorMsg(message);
      setErrorCode(null);
      setManualPath(null);
      setStatus('error');
      showErrorToast('Offline setup needs internet.', message, 'Once the connection is back, click Retry Setup.');
      return;
    }

    setStatus('running');
    setErrorMsg('');
    setErrorCode(null);
    setManualPath(null);
    setCopied(false);
    // Don't assume total steps here; wait for the first 'step' message from the backend
    setProgress({ step: 1, total: null, name: 'Initializing...', status: 'processing', pct: 0 });

    const cleanup = window.intellifile.onOfflineSetupProgress((msg) => {
      if (msg.type === 'step') {
        setProgress(p => ({ ...p, step: msg.step, total: msg.total, name: msg.name, status: msg.status, pct: msg.pct ?? p?.pct ?? 0 }));
      } else if (msg.type === 'progress') {
        setProgress(p => ({ 
          ...p, 
          name: msg.name || p.name, 
          status: msg.status || 'downloading',
          pct: typeof msg.pct === 'number' ? msg.pct : p?.pct, 
          downloaded: msg.downloaded_mb, 
          total_mb: msg.total_mb,
          downloaded_files: msg.downloaded_files,
          total_files: msg.total_files,
        }));
      } else if (msg.type === 'error') {
        setErrorMsg(msg.message);
        setErrorMsg(msg.message || 'Model download or setup failed.');
        setErrorCode(msg.code || null);
        setManualPath(msg.manual_install_path || null);
        setStatus('error');
        showErrorToast('Offline setup failed.', msg.message || 'Model download or setup failed.', 'Check your internet connection and try again.');
      } else if (msg.type === 'done') {
        showToast('Offline setup complete.', {
          type: 'success',
          message: 'AI models are ready for offline search and chat.',
        });
        setTimeout(onComplete, 1000);
      }
    });

    try {
      const result = await window.intellifile.offlineSetupRun();
      if (!result.success && status !== 'error') {
        setErrorMsg(result.error || 'Setup process exited with an error.');
        setErrorCode(null);
        setManualPath(null);
        setStatus('error');
        showErrorToast('Offline setup failed.', result.error || 'Setup process exited with an error.', 'Check your internet connection and try again.');
      }
    } catch (e) {
      setErrorMsg(e.message);
      setErrorCode(null);
      setManualPath(null);
      setStatus('error');
      showErrorToast('Offline setup failed.', e?.message || 'Setup could not start.', 'Check your internet connection and try again.');
    } finally {
      cleanup();
    }
  };

  if (status === 'checking') return null;

    const isSSLError = errorCode === 'SSL_CERT_VERIFY_FAILED';

  return (
    <div className="offline-setup-overlay">
      <div className="offline-setup-container">
        <h2>Offline Setup Required</h2>
        <p>
          IntelliFile needs to download the semantic AI model (about 200 MB). 
          This is a one-time process and requires an internet connection. Depending on your network speed, this may take several minutes. Please do not close the application.
        </p>

        {status === 'needed' && (
          <button className="setup-button" onClick={startSetup}>
            Run Offline Setup
          </button>
        )}

        {status === 'running' && progress && (
          <div className="setup-progress-container">
            <div className="step-info">
              <h3>
                {progress.total ? `Step ${progress.step} of ${progress.total}: ${progress.name}` : `Step ${progress.step}: ${progress.name}`}
              </h3>
              <span>{progress.status === 'downloading' ? 'Downloading...' : 'Processing...'}</span>
            </div>
            
            <div className="progress-bar-bg">
              {(() => {
                const pct = typeof progress.pct === 'number' ? Math.max(0, Math.min(100, progress.pct)) : null;
                const fillWidth = pct === null ? 5 : Math.max(0, pct);
                return (
              <div 
                className={`progress-bar-fill ${pct === null ? 'indeterminate' : ''}`}
                style={{ width: `${fillWidth}%` }}
              ></div>
                );
              })()}
            </div>
            
            <div className="progress-details">
              <span>{typeof progress.pct === 'number' ? `${progress.pct.toFixed(1)}%` : 'Processing... this might take a moment'}</span>
              <span>
                {typeof progress.downloaded === 'number' && typeof progress.total_mb === 'number'
                  ? `${Math.round(progress.downloaded)} MB / ${Math.round(progress.total_mb)} MB`
                  : typeof progress.downloaded_files === 'number' && typeof progress.total_files === 'number'
                    ? `${progress.downloaded_files} / ${progress.total_files} files`
                    : ''}
              </span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className={`setup-error-card ${isSSLError ? 'setup-error-ssl' : ''}`}>
            {isSSLError ? (
              <>
                <div className="setup-error-header">
                  <span className="setup-error-icon">🔒</span>
                  <strong>Secure connection failed</strong>
                </div>
                <p className="setup-error-body">
                  Your network or security software is blocking the secure download.
                  This is common on corporate networks, VPNs, or when antivirus 
                  software intercepts HTTPS traffic.
                </p>
                <ul className="setup-error-causes">
                  <li>Corporate network / VPN intercepting connections</li>
                  <li>Antivirus performing TLS/SSL inspection</li>
                  <li>Missing or expired root certificates</li>
                </ul>
                <div className="setup-error-actions-list">
                  <p><strong>What you can do:</strong></p>
                  <ol>
                    <li>Disconnect from VPN, then click <em>Retry Setup</em></li>
                    <li>Ask IT to install the company root certificate</li>
                    <li>Or place the model files manually (see below)</li>
                  </ol>
                </div>
              </>
            ) : (
              <div className="setup-error-header">
                <span className="setup-error-icon">⚠️</span>
                <span className="setup-error-body">{errorMsg}</span>
              </div>
            )}

            {manualPath && (
              <div className="setup-manual-install">
                <p className="setup-manual-label">
                  📁 <strong>Manual install path</strong> — download the model from{' '}
                  <a
                    href="https://huggingface.co/Xenova/bge-small-en-v1.5"
                    target="_blank"
                    rel="noreferrer"
                    className="setup-hf-link"
                  >
                    HuggingFace ↗
                  </a>{' '}
                  and place the files in this folder, then relaunch the app:
                </p>
                <div className="setup-path-row">
                  <code className="setup-path-code">{manualPath}</code>
                  <button className="setup-copy-btn" onClick={copyPath} title="Copy path">
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="setup-error-retry">
              <button className="setup-button" onClick={startSetup}>⚡ Retry Setup</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflineSetup;
