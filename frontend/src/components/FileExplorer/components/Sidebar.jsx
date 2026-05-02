import React from 'react';
import { QUICK_ACCESS_FOLDERS } from '../utils/constants';

function Sidebar({ drives = [], onNavigate }) {
  const formatDriveSpace = (drive) => {
    const availableGB = Math.round((drive.available || 0) / (1024 ** 3));
    const totalGB = Math.round(drive.size / (1024 ** 3));
    return `${availableGB} GB free of ${totalGB} GB`;
  };

  const getDrivePercent = (drive) => {
    if (drive.size === 0) return 0;
    const usedSpace = drive.size - (drive.available || 0);
    return Math.round((usedSpace / drive.size) * 100);
  };

  return (
    <div className="explorer-sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">Quick access</div>
        
        {QUICK_ACCESS_FOLDERS.map(folder => (
          <div
            key={folder.id}
            className="sidebar-item"
            onClick={() => onNavigate(folder.name)}
          >
            <span className="sidebar-icon">{folder.icon}</span>
            <span className="sidebar-label">{folder.name}</span>
          </div>
        ))}

        {/* Drives Section */}
        {drives.length > 0 && (
          <>
            <div className="sidebar-title" style={{ marginTop: '20px' }}>Drives</div>
            {drives.map((drive, idx) => (
              <div 
                key={drive.device || idx} 
                className="drive-item" 
                onClick={() => onNavigate(drive.device)}
              >
                <div className="drive-header">
                  <span className="drive-icon">💾</span>
                  <div className="drive-name-info">
                    <div className="drive-name">{drive.description}</div>
                    <div className="drive-space-text">{formatDriveSpace(drive)}</div>
                  </div>
                </div>
                <div className="drive-progress-container">
                  <div className="drive-progress-bar">
                    <div 
                      className="drive-progress-fill" 
                      style={{ width: `${getDrivePercent(drive)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
