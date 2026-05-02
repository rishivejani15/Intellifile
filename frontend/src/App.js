import React, { useState, useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import ChatSidebar from './components/ChatSidebar';
import SyncManager from './components/Sync/SyncManager';

const ipcRenderer = window.electron?.ipcRenderer;

function App() {
  const [activeTab, setActiveTab] = useState('explorer');
  const [drives, setDrives] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [versioningFile, setVersioningFile] = useState(null);
  const [showChatSidebar, setShowChatSidebar] = useState(false);
  const [selectedFileForChat, setSelectedFileForChat] = useState(null);

  useEffect(() => {
    console.log('App mounted, ipcRenderer available:', !!ipcRenderer);
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

  const handleChatWithAI = (file) => {
    setSelectedFileForChat(file);
    setShowChatSidebar(true);
  };

  // Debug: log versioningFile state
  useEffect(() => {
    console.log('[App] versioningFile:', versioningFile);
  }, [versioningFile]);

  const closeChatSidebar = () => {
    setShowChatSidebar(false);
    setSelectedFileForChat(null);
  };

  return (
    <div className="App">
      <header className="App-header">
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
        </div>
      </header>

      <div className="app-container">
        <main className="app-main">
          {activeTab === 'explorer' ? (
            <div className="explorer-wrapper">
              <div className="explorer-toolbar">
                <button
                  className="toolbar-btn primary"
                  onClick={handleOpenFile}
                  disabled={!selectedFile}
                >
                  Open in External Editor
                </button>
                <span className="toolbar-hint">
                  {selectedFile ? 'Saving will trigger AI versioning.' : 'Select a file.'}
                </span>
              </div>
              <FileExplorer
                onFileSelect={handleFileSelect}
                selectedFiles={{}}
                drives={drives}
                onChatWithAI={handleChatWithAI}
                onVersioning={handleVersioning}
                versioningFile={versioningFile}
                onCloseVersioning={() => setVersioningFile(null)}
              />
            </div>
          ) : (
            <SyncManager />
          )}
        </main>
      </div>

      {showChatSidebar && selectedFileForChat && (
        <ChatSidebar file={selectedFileForChat} onClose={closeChatSidebar} />
      )}
    </div>
  );
}

export default App;
