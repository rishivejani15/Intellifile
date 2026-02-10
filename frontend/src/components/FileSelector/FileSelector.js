import React, { useState } from 'react';
import './FileSelector.css';

function FileSelector({ label, files, selectedFile, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (file) => {
    onSelect(file);
    setIsOpen(false);
  };

  return (
    <div className="file-selector">
      <label>{label}</label>
      <div className="selector-box">
        <div className="selected-file">
          {selectedFile ? (
            <>
              <span className="file-name">✓ {selectedFile.name}</span>
              <span className="file-ext">{selectedFile.ext}</span>
            </>
          ) : (
            <span className="placeholder">Click to select file...</span>
          )}
        </div>
        {isOpen && (
          <div className="file-dropdown">
            {files.length > 0 ? (
              files.map((file, idx) => (
                <div 
                  key={idx}
                  className={`file-item ${selectedFile?.path === file.path ? 'active' : ''}`}
                  onClick={() => handleSelect(file)}
                >
                  <span className="file-icon">📄</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-ext">{file.ext}</span>
                </div>
              ))
            ) : (
              <div className="no-files">No files available</div>
            )}
          </div>
        )}
      </div>
      <button 
        className="toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? '▲ Close' : '▼ Browse'}
      </button>
    </div>
  );
}

export default FileSelector;
