import React, { useState, useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer';

const ipcRenderer = window.electron?.ipcRenderer;
function App() {
  const [drives, setDrives] = useState([]);

  useEffect(() => {
    console.log('App mounted, ipcRenderer available:', !!ipcRenderer);
  }, []);

  useEffect(() => {
    async function fetchDrives() {
      if (ipcRenderer) {
        const result = await ipcRenderer.invoke('get-drives-info');
        console.log('Drives fetched:', result);
        if (result.success) {
          console.log('Setting drives:', result.drives);
          setDrives(result.drives);
        }
      }
    }
    fetchDrives();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>IntelliFile</h1>
      </header>

      <div className="container">
        <div className="main-content">
          <div className="explorer-view">
            <div className="explorer-main">
              <FileExplorer 
                onFileSelect={() => {}}
                selectedFiles={{}}
                drives={drives}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
