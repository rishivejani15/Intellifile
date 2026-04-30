import React from 'react';
import './FileExplorer/FileExplorer.css';

function ExplorerSidebar({ drives, onNavigate }) {
  const navigateToQuickAccess = (folderName) => {
    onNavigate(folderName);
  };

  return (
    <div className="explorer-sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">Quick access</div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('This PC')}>
          <span className="sidebar-icon">💻</span>
          <span className="sidebar-label">This PC</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Desktop')}>
          <span className="sidebar-icon">🖥️</span>
          <span className="sidebar-label">Desktop</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Documents')}>
          <span className="sidebar-icon">📄</span>
          <span className="sidebar-label">Documents</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Downloads')}>
          <span className="sidebar-icon">⬇️</span>
          <span className="sidebar-label">Downloads</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Pictures')}>
          <span className="sidebar-icon">🖼️</span>
          <span className="sidebar-label">Pictures</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Music')}>
          <span className="sidebar-icon">🎵</span>
          <span className="sidebar-label">Music</span>
        </div>
        <div className="sidebar-item" onClick={() => navigateToQuickAccess('Videos')}>
          <span className="sidebar-icon">🎬</span>
          <span className="sidebar-label">Videos</span>
        </div>

        {drives.length > 0 && (
          <>
            <div className="sidebar-title" style={{ marginTop: '20px' }}>Drives</div>
            {drives.map((drive, idx) => {
              const usedSpace = drive.size - (drive.available || 0);
              const usedPercent = drive.size > 0 ? Math.round((usedSpace / drive.size) * 100) : 0;
              const availableGB = Math.round((drive.available || 0) / (1024 ** 3));
              const totalGB = Math.round(drive.size / (1024 ** 3));

              return (
                <div key={drive.device || idx} className="drive-item" onClick={() => onNavigate(drive.device)}>
                  <div className="drive-header">
                    <span className="drive-icon">💾</span>
                    <div className="drive-name-info">
                      <div className="drive-name">{drive.description}</div>
                      <div className="drive-space-text">{availableGB} GB free of {totalGB} GB</div>
                    </div>
                  </div>
                  <div className="drive-progress-container">
                    <div className="drive-progress-bar">
                      <div
                        className="drive-progress-fill"
                        style={{ width: `${usedPercent}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default ExplorerSidebar;
