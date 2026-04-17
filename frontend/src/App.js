import React, { useState, useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import VersionTimeline from './components/Versioning/VersionTimeline';
import ChatSidebar from './components/ChatSidebar';
import SyncManager from './components/Sync/SyncManager';

const ipcRenderer = window.electron?.ipcRenderer;

function App() {
  const [activeTab, setActiveTab] = useState('explorer');
  const [drives, setDrives] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
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

      <div className="container">
        <div className="main-content">
          {activeTab === 'explorer' && (
            <div className="explorer-view">
              <div className="explorer-main">
                <div className="explorer-controls" style={{ padding: '10px', background: '#252526', borderBottom: '1px solid #333' }}>
                  <button
                    onClick={handleOpenFile}
                    disabled={!selectedFile}
                    style={{ padding: '6px 12px', background: '#0e639c', color: 'white', border: 'none', borderRadius: '4px', cursor: selectedFile ? 'pointer' : 'not-allowed' }}
                  >
                    Open in External Editor
                  </button>
                  <span style={{ marginLeft: '12px', color: '#888', fontSize: '0.8rem' }}>
                    {selectedFile ? 'Saving in external editor will trigger AI versioning automatically.' : 'Select a file to edit.'}
                  </span>
                </div>
                <FileExplorer
                  onFileSelect={handleFileSelect}
                  selectedFiles={{}}
                  drives={drives}
                  onChatWithAI={handleChatWithAI}
                />
              </div>
              {selectedFile && selectedFile.editable && (
                <VersionTimeline filePath={selectedFile.path} />
              )}
              {selectedFile && !selectedFile.editable && (
                <div className="no-versioning-placeholder" style={{ padding: '20px', color: '#888', background: '#1e1e1e', height: '100%', borderLeft: '1px solid #333' }}>
                  <h3>File Properties</h3>
                  <p><strong>Name:</strong> {selectedFile.name}</p>
                  <p><strong>Type:</strong> {selectedFile.ext || 'Folder'}</p>
                  <p><em>AI Versioning is not yet available for this file type.</em></p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'sync' && (
            <SyncManager />
          )}
        </div>
      </div>

      {showChatSidebar && selectedFileForChat && (
        <ChatSidebar file={selectedFileForChat} onClose={closeChatSidebar} />
      )}
    </div>
  );
}

export default App;
