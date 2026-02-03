import React, { useState, useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer';

const ipcRenderer = window.electron?.ipcRenderer;
function App() {
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    console.log('App mounted, ipcRenderer available:', !!ipcRenderer);
  }, []);

  const handleFileClick = (file) => {
    if (!file.editable || file.type === 'folder') return;
    setSelectedFile(file);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>IntelliFile</h1>
      </header>

      <div className="container">
        <aside className="app-sidebar">
        </aside>

        <div className="main-content">
          <div className="explorer-view">
            <div className="explorer-main">
              <FileExplorer 
                onFileSelect={handleFileClick}
                selectedFiles={{}}
              />
            </div>

            {selectedFile && (
              <div className="file-action-panel">
                <div className="profile-section">
                  <div className="profile-avatar">👤</div>
                  <div className="profile-name">User Profile</div>
                  <div className="profile-email">12.25 GB Available</div>
                </div>

                <div className="storage-section">
                  <div className="storage-title">Storage</div>
                  <div className="storage-item">
                    <span className="storage-icon">🖼️</span>
                    <div className="storage-info">
                      <span className="storage-name">Images</span>
                      <span className="storage-size">12.2 GB</span>
                    </div>
                  </div>
                  <div className="storage-item">
                    <span className="storage-icon">📄</span>
                    <div className="storage-info">
                      <span className="storage-name">Documents</span>
                      <span className="storage-size">3.2 GB</span>
                    </div>
                  </div>
                  <div className="storage-item">
                    <span className="storage-icon">🎬</span>
                    <div className="storage-info">
                      <span className="storage-name">Media Files</span>
                      <span className="storage-size">23.5 GB</span>
                    </div>
                  </div>
                  <div className="storage-item">
                    <span className="storage-icon">📦</span>
                    <div className="storage-info">
                      <span className="storage-name">Other Files</span>
                      <span className="storage-size">15.8 GB</span>
                    </div>
                  </div>
                </div>

                <div className="selected-info">
                  <div className="file-icon">📄</div>
                  <div className="file-details">
                    <div className="file-name">{selectedFile.name}</div>
                    <div className="file-path">{selectedFile.path}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
