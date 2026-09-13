import React, { useState, useEffect, useCallback, useRef } from 'react';
import './OfflineSetup.css';
import { showErrorToast, showToast } from '../utils/toast';
const NETWORK_ERROR_PATTERNS = [
  'no internet',
  'internet connection is required',
  'network connectivity',
  'getaddrinfo',
  'nameresolutionerror',
  'failed to establish a new connection',
  'maxretryerror',
  'connectionerror',
  'network is unreachable',
  'connection refused',
  'connection timed out',
  'timed out',
  'timeouterror',
  'econnrefused',
  'etimedout',
  'enotfound',
  'offline',
  'unreachable',
  'cannot reach huggingface.co'
];

function isNetworkError(message, code) {
  if (code === 'NO_INTERNET') return true;
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

function shouldAutoStartSetup(status) {
  if (!status || typeof status !== 'object') return false;
  if (status.running) return false;
  return Boolean(status.needed);
}

function formatProgressDetails(progress) {
  if (!progress || typeof progress !== 'object') {
    return {
      percentText: 'Starting download...',
      downloadedText: '',
      pctValue: null
    };
  }

  const pct = typeof progress.pct === 'number' ? Math.max(0, Math.min(100, progress.pct)) : null;
  const percentText = pct !== null ? `${pct.toFixed(1)}%` : 'Processing model files...';

  let downloadedText = '';
  if (typeof progress.downloaded === 'number' && typeof progress.total_mb === 'number') {
    downloadedText = `${Math.round(progress.downloaded)} MB / ${Math.round(progress.total_mb)} MB`;
  } else if (typeof progress.downloaded_files === 'number' && typeof progress.total_files === 'number') {
    downloadedText = `${progress.downloaded_files} / ${progress.total_files} files`;
  }

  return {
    percentText,
    downloadedText,
    pctValue: pct
  };
}

function getSetupTitleAndSubtitle(status, errorCode) {
  switch (status) {
    case 'checking':
      return {
        title: 'Initializing IntelliFile',
        subtitle: 'Checking local AI model and environment status...'
      };
    case 'running':
      return {
        title: 'Downloading AI Search Model',
        subtitle: 'IntelliFile is automatically downloading the offline AI model (~200 MB). This is a one-time process so you can search files offline. Please keep the app open.'
      };
    case 'no-internet':
      return {
        title: 'Internet Connection Required',
        subtitle: 'IntelliFile needs an internet connection to download the offline AI model (~200 MB). Please connect to Wi-Fi or Ethernet to proceed.'
      };
    case 'error':
      if (errorCode === 'SSL_CERT_VERIFY_FAILED') {
        return {
          title: 'Secure Connection Blocked',
          subtitle: 'Your security software or VPN is intercepting HTTPS downloads.'
        };
      }
      return {
        title: 'Setup Could Not Complete',
        subtitle: 'An unexpected issue occurred while setting up the AI search model.'
      };
    case 'done':
      return {
        title: 'Setup Complete!',
        subtitle: 'AI models are ready for offline search.'
      };
    default:
      return {
        title: 'AI Model Setup',
        subtitle: 'Setting up offline semantic search.'
      };
  }
}

const OfflineSetup = ({ onComplete }) => {
  const [status, setStatus] = useState('checking'); // 'checking' | 'running' | 'no-internet' | 'error' | 'done'
  const [progress, setProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState(null); // e.g. "NO_INTERNET" | "SSL_CERT_VERIFY_FAILED"
  const [manualPath, setManualPath] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);

  const isStartingRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const handleProgress = useCallback((msg) => {
    if (!msg) return;
    if (msg.type === 'step') {
      setStatus('running');
      setProgress((p) => ({
        ...p,
        step: msg.step,
        total: msg.total,
        name: msg.name,
        status: msg.status,
        pct: msg.pct ?? p?.pct ?? 0,
      }));
    } else if (msg.type === 'progress') {
      setStatus('running');
      setProgress((p) => ({
        ...p,
        name: msg.name || p?.name || 'Embedding Model',
        status: msg.status || 'downloading',
        pct: typeof msg.pct === 'number' ? msg.pct : p?.pct,
        downloaded: typeof msg.downloaded_mb === 'number' ? msg.downloaded_mb : p?.downloaded,
        total_mb: typeof msg.total_mb === 'number' ? msg.total_mb : p?.total_mb,
        downloaded_files: typeof msg.downloaded_files === 'number' ? msg.downloaded_files : p?.downloaded_files,
        total_files: typeof msg.total_files === 'number' ? msg.total_files : p?.total_files,
      }));
    } else if (msg.type === 'error') {
      const isNet = isNetworkError(msg.message, msg.code) || (typeof navigator !== 'undefined' && !navigator.onLine);
      const nextCode = isNet ? 'NO_INTERNET' : (msg.code || null);
      const nextMsg = isNet
        ? 'Internet connection is required to download the AI models. Please connect to Wi-Fi or Ethernet.'
        : (msg.message || 'Model download or setup failed.');

      setErrorMsg(nextMsg);
      setErrorCode(nextCode);
      setManualPath(msg.manual_install_path || null);
      setStatus(isNet ? 'no-internet' : 'error');

      if (isNet) {
        showErrorToast(
          'Internet connection required.',
          'Please connect to the internet to download the AI models.',
          'Download will resume automatically once connected.'
        );
      } else {
        showErrorToast(
          'Offline setup failed.',
          msg.message || 'Model download or setup failed.',
          'Check your settings and try again.'
        );
      }
    } else if (msg.type === 'done') {
      setStatus('done');
      showToast('Offline setup complete.', {
        type: 'success',
        message: 'AI models are ready for offline search.',
      });
      setTimeout(onComplete, 800);
    }
  }, [onComplete]);

  // Listen to live broadcast setup progress immediately upon mount
  useEffect(() => {
    if (!window.intellifile?.onOfflineSetupProgress) return;
    const cleanup = window.intellifile.onOfflineSetupProgress(handleProgress);
    return () => {
      if (cleanup) cleanup();
    };
  }, [handleProgress]);

  const copyPath = useCallback(() => {
    if (!manualPath) return;
    navigator.clipboard.writeText(manualPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [manualPath]);

  const startSetup = useCallback(async () => {
    if (statusRef.current === 'running' || isStartingRef.current) return;
    isStartingRef.current = true;

    // Fast-path 1: Browser navigator online check
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const message = 'No internet connection detected. Please connect to Wi-Fi or Ethernet to download the AI model.';
      setErrorMsg(message);
      setErrorCode('NO_INTERNET');
      setStatus('no-internet');
      isStartingRef.current = false;
      return;
    }

    // Fast-path 2: IPC DNS lookup check via main process
    try {
      const networkCheck = await window.intellifile?.checkNetworkConnectivity?.();
      if (networkCheck && (!networkCheck.success || !networkCheck.online)) {
        const message = 'Internet connection is required to download the AI models. Please connect to Wi-Fi or Ethernet, then try again.';
        setErrorMsg(message);
        setErrorCode('NO_INTERNET');
        setStatus('no-internet');
        isStartingRef.current = false;
        return;
      }
    } catch (_e) {
      // If connectivity check fails, proceed to attempt setup
    }

    // Internet is confirmed or reachable: directly start downloading
    setStatus('running');
    setErrorMsg('');
    setErrorCode(null);
    setCopied(false);
    setProgress({ step: 1, total: 2, name: 'Embedding Model', status: 'downloading', pct: 0 });

    try {
      const result = await window.intellifile?.offlineSetupRun?.();
      if (result && !result.success && !result.running && statusRef.current !== 'error') {
        const isNet = isNetworkError(result.error, result.code) || (typeof navigator !== 'undefined' && !navigator.onLine);
        const errMsg = isNet
          ? 'Internet connection is required to download the AI models. Please connect to Wi-Fi or Ethernet.'
          : (result.error || 'Setup process exited with an error.');

        setErrorMsg(errMsg);
        setErrorCode(isNet ? 'NO_INTERNET' : (result.code || null));
        setManualPath(result.manual_install_path || null);
        setStatus(isNet ? 'no-internet' : 'error');

        if (isNet) {
          showErrorToast(
            'Internet connection required.',
            errMsg,
            'Download will resume automatically once connected.'
          );
        } else {
          showErrorToast('Offline setup failed.', errMsg, 'Check your connection and try again.');
        }
      }
    } catch (e) {
      const isNet = isNetworkError(e?.message, null) || (typeof navigator !== 'undefined' && !navigator.onLine);
      setErrorMsg(e?.message || 'Setup could not start.');
      setErrorCode(isNet ? 'NO_INTERNET' : null);
      setManualPath(null);
      setStatus(isNet ? 'no-internet' : 'error');
      showErrorToast('Offline setup failed.', e?.message || 'Setup could not start.', 'Please try again.');
    } finally {
      isStartingRef.current = false;
    }
  }, []);

  // Check initial offline setup status on mount and auto-start if needed
  useEffect(() => {
    let isMounted = true;
    const checkStatus = async () => {
      try {
        const res = await window.intellifile?.offlineSetupStatus?.();
        if (!isMounted) return;

        if (res?.running) {
          setStatus('running');
          if (res.lastProgress) {
            handleProgress(res.lastProgress);
          } else {
            setProgress({ step: 1, total: 2, name: 'Embedding Model', status: 'downloading', pct: 0 });
          }
        } else if (shouldAutoStartSetup(res)) {
          // Model does not exist or first time launch -> Automatically start downloading without waiting for button click
          startSetup();
        } else if (res && !res.needed) {
          onComplete();
        } else {
          // Fallback: start setup if needed
          startSetup();
        }
      } catch (e) {
        if (!isMounted) return;
        // On status check error, attempt auto-starting setup
        startSetup();
      }
    };

    checkStatus();
    return () => {
      isMounted = false;
    };
  }, [onComplete, handleProgress, startSetup]);

  // Automatically resume download when internet connectivity is restored
  useEffect(() => {
    let reconnectTimeout = null;

    const handleOnline = () => {
      console.log('[OfflineSetup] Network online event detected');
      if (statusRef.current === 'no-internet' || statusRef.current === 'error') {
        // Wait 1.2s for DHCP/DNS to establish before retrying
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          startSetup();
        }, 1200);
      }
    };

    const handleOffline = () => {
      console.log('[OfflineSetup] Network offline event detected');
      if (statusRef.current === 'running') {
        setStatus('no-internet');
        setErrorCode('NO_INTERNET');
        setErrorMsg('Internet connection was disconnected. Download will resume automatically once connected.');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [startSetup]);

  const isSSLError = errorCode === 'SSL_CERT_VERIFY_FAILED';
  const isNoInternet = status === 'no-internet' || errorCode === 'NO_INTERNET';
  const { title, subtitle } = getSetupTitleAndSubtitle(status, errorCode);
  const { percentText, downloadedText, pctValue } = formatProgressDetails(progress);

  return (
    <div className="offline-setup-overlay">
      <div className="offline-setup-container">
        <h2>{title}</h2>
        <p>{subtitle}</p>

        {/* Initial Status Verification */}
        {status === 'checking' && (
          <div className="setup-checking-state">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill indeterminate"></div>
            </div>
            <div className="setup-status-badge">
              <span className="setup-pulse-dot"></span>
              <span>Checking AI models...</span>
            </div>
          </div>
        )}

        {/* Live Downloading State */}
        {status === 'running' && (
          <div className="setup-progress-container">
            <div className="step-info active">
              <h3>
                {progress?.total
                  ? `Step ${progress.step || 1} of ${progress.total}: ${progress.name || 'Embedding Model'}`
                  : `Step ${progress?.step || 1}: ${progress?.name || 'Embedding Model'}`}
              </h3>
              <span>{progress?.status === 'downloading' ? 'Downloading model files...' : 'Finalizing offline setup...'}</span>
            </div>

            <div className="progress-bar-bg">
              <div
                className={`progress-bar-fill ${pctValue === null ? 'indeterminate' : ''}`}
                style={{ width: `${pctValue !== null ? Math.max(4, pctValue) : 100}%` }}
              ></div>
            </div>

            <div className="progress-details">
              <span className="progress-percent">{percentText}</span>
              <span>{downloadedText}</span>
            </div>

            <div className="setup-auto-status">
              <span className="setup-pulse-dot active"></span>
              <span>Downloading automatically in background. Please keep IntelliFile open.</span>
            </div>
          </div>
        )}

        {/* No Internet State */}
        {isNoInternet && (
          <div className="setup-error-card setup-no-internet">
            <div className="setup-error-header setup-no-internet-header">
              <span className="setup-error-icon">🌐</span>
              <strong>No Internet Connection</strong>
            </div>
            <p className="setup-error-body">
              {errorMsg || 'An active internet connection is required to download the AI models (~200 MB).'}
            </p>

            <div className="setup-status-badge waiting-connection">
              <span className="setup-pulse-dot warning"></span>
              <span>Waiting for internet connection... Setup will resume automatically.</span>
            </div>

            <div className="setup-actions-row">
              <button className="setup-button setup-button-retry" onClick={startSetup}>
                ⚡ Retry Download
              </button>
            </div>

            {manualPath && (
              <div className="setup-manual-toggle">
                <button
                  type="button"
                  className="setup-toggle-link"
                  onClick={() => setShowManualGuide((prev) => !prev)}
                >
                  {showManualGuide ? '▼ Hide manual installation guide' : '▶ Or install model manually offline'}
                </button>
                {showManualGuide && (
                  <div className="setup-manual-install">
                    <p className="setup-manual-label">
                      📁 Download model files from{' '}
                      <a
                        href="https://huggingface.co/Xenova/bge-small-en-v1.5"
                        target="_blank"
                        rel="noreferrer"
                        className="setup-hf-link"
                      >
                        HuggingFace ↗
                      </a>{' '}
                      and copy them into this folder:
                    </p>
                    <div className="setup-path-row">
                      <code className="setup-path-code">{manualPath}</code>
                      <button className="setup-copy-btn" onClick={copyPath} title="Copy path">
                        {copied ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* General / SSL Error State */}
        {status === 'error' && !isNoInternet && (
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
