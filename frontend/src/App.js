import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import SyncManager from './components/Sync/SyncManager';
import LogsPanel from './components/LogsPanel';
import OfflineSetup from './components/OfflineSetup';
import ToastHost from './components/ToastHost';
import AutoSortToastHost from './components/AutoSortToastHost';
import Settings from './pages/Settings';

const ipcRenderer = window.electron?.ipcRenderer;




function getInitialTheme() {
  const saved = localStorage.getItem('intellifile-theme');
  if (saved && ['light', 'dark', 'system'].includes(saved)) return saved;
  return 'system';
}

function App() {
  const [activeTab, setActiveTab] = useState('explorer');
  const [drives, setDrives] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [versioningFile, setVersioningFile] = useState(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [offlineSetupKey, setOfflineSetupKey] = useState(0);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);

  useEffect(() => {
    console.log('App mounted, ipcRenderer available:', !!ipcRenderer);
  }, []);

  useEffect(() => {
    if (!ipcRenderer) return;

    // Listen for update-available event
    const handleUpdateAvailable = (event, data) => {
      console.log('[App] Update available:', data.version);
      setUpdateVersion(data.version);
      setUpdateAvailable(true);
    };

    // Listen for update-downloaded event
    const handleUpdateDownloaded = (event, data) => {
      console.log('[App] Update downloaded:', data.version);
      setUpdateDownloaded(true);
    };

    ipcRenderer.on('update-available', handleUpdateAvailable);
    ipcRenderer.on('update-downloaded', handleUpdateDownloaded);

    return () => {
      ipcRenderer.removeListener('update-available', handleUpdateAvailable);
      ipcRenderer.removeListener('update-downloaded', handleUpdateDownloaded);
    };
  }, []);

  useEffect(() => {
    async function fetchDrives() {
      if (ipcRenderer) {
        const result = await ipcRenderer.invoke('get-drives-info');
        if (result.success) {
          setDrives(result.drives);
        }
      }
    }
    fetchDrives();
  }, []);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setVersioningFile(null);
  };

  const handleVersioning = (file) => {
    setSelectedFile(file);
    setVersioningFile(file);
    setActiveTab('explorer');
  };

  const handleOpenFile = () => {
    if (selectedFile) {
      window.electron.ipcRenderer.send('open-file', selectedFile.path);
    }
  };

  const handleResetOfflineSetup = async () => {
    const confirmed = window.confirm('This will delete downloaded AI models and run offline setup again. Continue?');
    if (!confirmed || !ipcRenderer) return;

    const result = await ipcRenderer.invoke('reset-offline-setup');
    if (result.success) {
      setSetupComplete(false);
      setOfflineSetupKey((key) => key + 1);
    } else {
      console.error('[App] Reset offline setup failed:', result.error);
    }
  };

  const handleOfflineSetupComplete = useCallback(() => {
    setSetupComplete(true);
  }, []);
  useEffect(() => {
    console.log('[App] versioningFile:', versioningFile);
  }, [versioningFile]);

  // Apply theme
  useEffect(() => {
    const doc = document.documentElement;
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        if (mql.matches) {
          doc.setAttribute('data-theme', 'dark');
        } else {
          doc.setAttribute('data-theme', 'light');
        }
      };
      apply();
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    } else {
      doc.setAttribute('data-theme', theme);
    }
    localStorage.setItem('intellifile-theme', theme);
  }, [theme]);

  // Close theme dropdown on outside click
  useEffect(() => {
    if (!showThemeDropdown) return;
    const handler = (e) => {
      if (!e.target.closest('.theme-toggle-wrapper')) {
        setShowThemeDropdown(false);
      }
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showThemeDropdown]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    setShowThemeDropdown(false);
  };

  const themeLabel = useMemo(() => {
    if (theme === 'light') return 'Light';
    if (theme === 'dark') return 'Dark';
    return 'Auto';
  }, [theme]);

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-left">
          <img src={process.env.PUBLIC_URL + '/intellifile_logo.png'} alt="IntelliFile Logo" className="app-logo" />
          <h1 className="app-title">IntelliFile</h1>
        </div>
        <div className="tab-nav">
          <button
            className={`tab-btn ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            Explorer
          </button>
          <button
            className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            Sync
          </button>
          <button
            className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Logs
          </button>
           <button
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>
        <div className="theme-toggle-wrapper" style={{ position: 'relative' }}>
          <button
            className="theme-toggle"
            onClick={(e) => { e.stopPropagation(); setShowThemeDropdown((prev) => !prev); }}
            title={`Theme: ${themeLabel}`}
          >
            <span style={{ fontSize: '18px' }}>{theme === 'dark' ? '☽' : theme === 'light' ? '☀' : '◔'}</span>
          </button>
          {showThemeDropdown && (
            <div className="theme-dropdown" onClick={(e) => e.stopPropagation()}>
              <button
                className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => handleThemeChange('light')}
              >
                <span>Light</span>{theme === 'light' && <span className="checkmark">✓</span>}
              </button>
              <button
                className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => handleThemeChange('dark')}
              >
                <span>Dark</span>{theme === 'dark' && <span className="checkmark">✓</span>}
              </button>
              <button
                className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                onClick={() => handleThemeChange('system')}
              >
                <span>Auto</span>{theme === 'system' && <span className="checkmark">✓</span>}
              </button>
            </div>
          )}
        </div>
        {updateAvailable && (
          <div className="update-section">
            {!updateDownloaded ? (
              <div className="update-status-container">
                <span className="update-status">
                  Update v{updateVersion} available
                </span>
                <button
                  className="update-check-btn"
                  onClick={() => {
                    if (ipcRenderer) {
                      ipcRenderer.send('check-for-updates');
                    }
                  }}
                >
                  Check Now
                </button>
              </div>
            ) : (
              <button
                className="update-btn"
                onClick={() => {
                  if (ipcRenderer) {
                    ipcRenderer.send('update-restart');
                  }
                }}
              >
                Restart to Update
              </button>
            )}
          </div>
        )}
      </header>

      <div className="app-container">
        <main className="app-main">
          <div style={{ display: activeTab === 'explorer' ? 'block' : 'none', height: '100%' }}>
            <div className="explorer-wrapper">
              <div className="explorer-toolbar">
                <button
                  className="toolbar-btn primary"
                  onClick={handleOpenFile}
                  disabled={!selectedFile}
                >
                  Open in External Editor
                </button>
                <button
                  className="toolbar-btn"
                  onClick={handleResetOfflineSetup}
                >
                  Reset AI Models
                </button>
                <button
                  className="toolbar-btn update-check"
                  onClick={() => {
                    if (ipcRenderer) {
                      ipcRenderer.send('check-for-updates');
                    }
                  }}
                >
                  Check for Updates
                </button>
                <span className="toolbar-hint">
                  {selectedFile ? 'Saving will trigger AI versioning.' : 'Select a file.'}
                </span>
              </div>
              <FileExplorer
                onFileSelect={handleFileSelect}
                selectedFiles={{}}
                drives={drives}
                onVersioning={handleVersioning}
                versioningFile={versioningFile}
                onCloseVersioning={() => setVersioningFile(null)}
              />
            </div>
          </div>
          
          <div style={{ display: activeTab === 'sync' ? 'block' : 'none', height: '100%' }}>
            <SyncManager />
          </div>
          
          <div style={{ display: activeTab === 'logs' ? 'block' : 'none', height: '100%' }}>
            <LogsPanel />
          </div>

          <div style={{ display: activeTab === 'settings' ? 'block' : 'none', height: '100%' }}>
            <Settings />
          </div>
        </main>
      </div>
      <ToastHost />
      <AutoSortToastHost />

      {!setupComplete && <OfflineSetup key={offlineSetupKey} onComplete={handleOfflineSetupComplete} />}
    </div>
  );
}

export default App;
