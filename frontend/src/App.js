import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import SyncManager from './components/Sync/SyncManager';
import LogsPanel from './components/LogsPanel';
import OfflineSetup from './components/OfflineSetup';
import ToastHost from './components/ToastHost';
import AutoSortToastHost from './components/AutoSortToastHost';
import Settings from './pages/Settings';
import FileLockManager from './components/FileLockManager';
import OnboardingTour from './components/OnboardingTour';

const ipcRenderer = window.electron?.ipcRenderer;
const TOUR_COMPLETED_KEY = 'intellifile-onboarding-completed-v1';






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
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);

  useEffect(() => {
    console.log('App mounted, ipcRenderer available:', !!ipcRenderer);
    
    // Load theme from IPC backend on mount to ensure it persists
    const loadTheme = async () => {
      try {
        let themeSetting = null;
        if (window.intellifile?.getSetting) {
          themeSetting = await window.intellifile.getSetting('theme');
        } else if (ipcRenderer) {
          themeSetting = await ipcRenderer.invoke('get-setting', 'theme');
        }
        
        if (themeSetting && themeSetting.value) {
          setTheme(themeSetting.value);
        }
      } catch (err) {
        console.warn('[App] Failed to load theme setting:', err);
      }
    };
    loadTheme();
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

  useEffect(() => {
    if (!setupComplete) return;
    try {
      const hasSeenTour = localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
      if (!hasSeenTour) {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
        setShowOnboardingTour(true);
      } else {
        setShowOnboardingTour(false);
      }
    } catch (_) {
      // If storage is unavailable, show the tour for this session only.
      setShowOnboardingTour(true);
    }
  }, [setupComplete]);

  const startOnboardingTour = () => {
    setActiveTab('explorer');
    setShowOnboardingTour(true);
  };

  const closeOnboardingTour = () => {
    try { localStorage.setItem(TOUR_COMPLETED_KEY, 'true'); } catch (_) {}
    setShowOnboardingTour(false);
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-left">
          <img src={process.env.PUBLIC_URL + '/intellifile_logo.png'} alt="IntelliFile Logo" className="app-logo" />
          <h1 className="app-title">IntelliFile</h1>
        </div>
        <div className="tab-nav" data-tour="app-navigation">
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
            className={`tab-btn ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => setActiveTab('vault')}
          >
            Vault
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
      </header>

      {setupComplete && (
        <div className="app-container">
          <main className="app-main">
            <div style={{ display: activeTab === 'explorer' ? 'block' : 'none', height: '100%' }}>
              <div className="explorer-wrapper">
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

            <div style={{ display: activeTab === 'vault' ? 'block' : 'none', height: '100%' }}>
              <FileLockManager />
            </div>

            <div style={{ display: activeTab === 'logs' ? 'block' : 'none', height: '100%' }}>
              <LogsPanel />
            </div>

            <div style={{ display: activeTab === 'settings' ? 'block' : 'none', height: '100%' }}>
              <Settings theme={theme} onThemeChange={setTheme} onStartTour={startOnboardingTour} />
            </div>
          </main>
        </div>)}
      <ToastHost />
      <AutoSortToastHost />

      <OnboardingTour
        open={showOnboardingTour && setupComplete}
        onStart={() => setActiveTab('explorer')}
        onNavigate={setActiveTab}
        onClose={closeOnboardingTour}
      />

      {!setupComplete && <OfflineSetup key={offlineSetupKey} onComplete={handleOfflineSetupComplete} />}
    </div>
  );
}

export default App;
