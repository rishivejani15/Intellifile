import React, { useState, useEffect } from 'react';
import './OfflineSetup.css';

const OfflineSetup = ({ onComplete }) => {
  const [status, setStatus] = useState('checking'); // checking, needed, running, error
  const [progress, setProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const res = await window.intellifile.offlineSetupStatus();
      if (res.needed) {
        setStatus('needed');
      } else {
        onComplete();
      }
    } catch (e) {
      console.error(e);
      setStatus('needed'); // default to showing if error
    }
  };

  const startSetup = async () => {
    setStatus('running');
    setErrorMsg('');
    setProgress({ step: 1, total: 3, name: 'Initializing...', status: 'processing', pct: 0 });

    const cleanup = window.intellifile.onOfflineSetupProgress((msg) => {
      if (msg.type === 'step') {
        setProgress(p => ({ ...p, step: msg.step, total: msg.total, name: msg.name, status: msg.status }));
      } else if (msg.type === 'progress') {
        setProgress(p => ({ 
          ...p, 
          name: msg.name || p.name, 
          pct: msg.pct, 
          downloaded: msg.downloaded_mb, 
          total_mb: msg.total_mb 
        }));
      } else if (msg.type === 'error') {
        setErrorMsg(msg.message);
        setStatus('error');
      } else if (msg.type === 'done') {
        setTimeout(onComplete, 1000);
      }
    });

    try {
      const result = await window.intellifile.offlineSetupRun();
      if (!result.success && status !== 'error') {
        setErrorMsg(result.error || 'Setup process exited with an error.');
        setStatus('error');
      }
    } catch (e) {
      setErrorMsg(e.message);
      setStatus('error');
    } finally {
      cleanup();
    }
  };

  if (status === 'checking') return null;

  return (
    <div className="offline-setup-overlay">
      <div className="offline-setup-container">
        <h2>Offline Setup Required</h2>
        <p>
          IntelliFile needs to download AI models (approx. 1.5 GB) for offline search and chat. 
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
              <h3>Step {progress.step} of {progress.total}: {progress.name}</h3>
              <span>{progress.status === 'downloading' ? 'Downloading...' : 'Processing...'}</span>
            </div>
            
            <div className="progress-bar-bg">
              <div 
                className={`progress-bar-fill ${progress.pct === null || progress.pct === undefined ? 'indeterminate' : ''}`}
                style={{ width: `${Math.max(5, progress.pct || 0)}%` }}
              ></div>
            </div>
            
            <div className="progress-details">
              <span>{progress.pct ? `${progress.pct.toFixed(1)}%` : 'Processing... this might take a moment'}</span>
              <span>
                {progress.downloaded ? `${Math.round(progress.downloaded)} MB` : ''}
                {progress.total_mb ? ` / ${Math.round(progress.total_mb)} MB` : ''}
              </span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="setup-error">
            <strong>Error:</strong> {errorMsg}
            <div style={{ marginTop: '15px', textAlign: 'center' }}>
              <button className="setup-button" onClick={startSetup}>Retry Setup</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflineSetup;
