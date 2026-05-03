import React, { useState, useEffect, useCallback } from 'react';
import './FileExplorer/FileExplorer.css';

const FAVORITES_KEY = 'intellifile-favorites';

const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\').replace(/[\\]+$/, '');

function ExplorerSidebar({ drives, onNavigate, currentPath }) {
  const [favorites, setFavorites] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    quickAccess: true,
    drives: true,
  });

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading favorites:', e);
    }
  }, []);

  // Save favorites to localStorage
  const saveFavorites = (newFavorites) => {
    setFavorites(newFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
  };

  const addFavorite = useCallback((folderPath, folderName) => {
    if (favorites.some(f => f.path === folderPath)) return;
    const newFavorites = [...favorites, { path: folderPath, name: folderName || folderPath.split('\\').pop() }];
    saveFavorites(newFavorites);
  }, [favorites]);

  const removeFavorite = useCallback((folderPath) => {
    const newFavorites = favorites.filter(f => f.path !== folderPath);
    saveFavorites(newFavorites);
  }, [favorites]);

  const toggleSection = useCallback((section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Expose addFavorite through window for ContextMenu to use
  useEffect(() => {
    window.__intellifile_addFavorite = addFavorite;
    window.__intellifile_removeFavorite = removeFavorite;
    window.__intellifile_isFavorite = (folderPath) => {
      const target = normalizePath(folderPath);
      return favorites.some((f) => normalizePath(f.path) === target);
    };
    return () => {
      delete window.__intellifile_addFavorite;
      delete window.__intellifile_removeFavorite;
      delete window.__intellifile_isFavorite;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites]);
  
  const navigateToQuickAccess = (folderName) => {
    onNavigate(folderName);
  };

  const isActive = (path) => {
    if (!currentPath) return false;
    const norm = (p) => (p || '').toLowerCase().replace(/[\\/]+$/, '');
    return norm(currentPath) === norm(path);
  };
  return (
    <div className="explorer-sidebar">
      {/* Favorites / Pinned */}
      {favorites.length > 0 && (
        <div className="sidebar-section">
          <div
            className="sidebar-title collapsible"
            onClick={() => toggleSection('favorites')}
          >
            <span className="collapse-icon">{expandedSections.favorites ? '▾' : '▸'}</span>
            ⭐ Favorites
          </div>
          {expandedSections.favorites && favorites.map((fav, idx) => (
            <div
              key={fav.path}
              className={`sidebar-item ${isActive(fav.path) ? 'active' : ''}`}
              onClick={() => onNavigate(fav.path)}
            >
              <span className="sidebar-icon">📌</span>
              <span className="sidebar-label">{fav.name}</span>
              <button
                className="sidebar-unpin"
                onClick={(e) => { e.stopPropagation(); removeFavorite(fav.path); }}
                title="Unpin"
              >
                ×
              </button>
            </div>
          ))}
        </div>
)}
         {/* Quick Access */}
      <div className="sidebar-section">
        <div
          className="sidebar-title collapsible"
          onClick={() => toggleSection('quickAccess')}
        >
          <span className="collapse-icon">{expandedSections.quickAccess ? '▾' : '▸'}</span>
          Quick access
        </div>
        {expandedSections.quickAccess && (
          <>
            <div className={`sidebar-item ${isActive('This PC') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('This PC')}>
              <span className="sidebar-icon">💻</span>
              <span className="sidebar-label">This PC</span>
            </div>
            <div className={`sidebar-item ${isActive('Desktop') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Desktop')}>
              <span className="sidebar-icon">🖥️</span>
              <span className="sidebar-label">Desktop</span>
            </div>
            <div className={`sidebar-item ${isActive('Documents') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Documents')}>
              <span className="sidebar-icon">📄</span>
              <span className="sidebar-label">Documents</span>
            </div>
            <div className={`sidebar-item ${isActive('Downloads') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Downloads')}>
              <span className="sidebar-icon">⬇️</span>
              <span className="sidebar-label">Downloads</span>
            </div>
            <div className={`sidebar-item ${isActive('Pictures') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Pictures')}>
              <span className="sidebar-icon">🖼️</span>
              <span className="sidebar-label">Pictures</span>
            </div>
            <div className={`sidebar-item ${isActive('Music') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Music')}>
              <span className="sidebar-icon">🎵</span>
              <span className="sidebar-label">Music</span>
            </div>
            <div className={`sidebar-item ${isActive('Videos') ? 'active' : ''}`} onClick={() => navigateToQuickAccess('Videos')}>
              <span className="sidebar-icon">🎬</span>
              <span className="sidebar-label">Videos</span>
            </div>
          </>
        )}
      </div>

              {/* Drives */}
      {drives.length > 0 && (
        <div className="sidebar-section">
          <div
            className="sidebar-title collapsible"
            onClick={() => toggleSection('drives')}
          >
            <span className="collapse-icon">{expandedSections.drives ? '▾' : '▸'}</span>
            Drives
          </div>
          {expandedSections.drives && drives.map((drive, idx) => {
            const usedSpace = drive.size - (drive.available || 0);
            const usedPercent = drive.size > 0 ? Math.round((usedSpace / drive.size) * 100) : 0;
            const availableGB = Math.round((drive.available || 0) / (1024 ** 3));
            const totalGB = Math.round(drive.size / (1024 ** 3));

            return (
              <div key={drive.device || idx} className={`drive-item ${isActive(drive.device) ? 'active' : ''}`} onClick={() => onNavigate(drive.device)}>
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
                      className={`drive-progress-fill ${usedPercent > 90 ? 'critical' : ''}`}
                      style={{ width: `${usedPercent}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ExplorerSidebar;
