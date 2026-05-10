import React, { useState, useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import SyncManager from './components/Sync/SyncManager';
import LogsPanel from './components/LogsPanel';
import OfflineSetup from './components/OfflineSetup';
import ToastHost from './components/ToastHost';

const ipcRenderer = window.electron?.ipcRenderer;

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

    // Check for updates on app startup
    ipcRenderer.invoke('check-for-updates').catch(err => {
      console.warn('[App] Check for updates failed:', err);
    });

    return () => {
      ipcRenderer.removeListener('update-available', handleUpdateAvailable);
      ipcRenderer.removeListener('update-downloaded', handleUpdateDownloaded);
    };
  }, [ipcRenderer]);

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
  useEffect(() => {
    console.log('[App] versioningFile:', versioningFile);
  }, [versioningFile]);

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
        </div>
        {updateAvailable && (
          <div className="update-section">
            {!updateDownloaded ? (
              <span className="update-status">
                Update v{updateVersion} available - downloading...
              </span>
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
        </main>
      </div>
      <ToastHost />

      {!setupComplete && <OfflineSetup key={offlineSetupKey} onComplete={() => setSetupComplete(true)} />}
    </div>
  );
}

export default App;
