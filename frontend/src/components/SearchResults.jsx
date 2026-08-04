import React from 'react';
import { MdClose, MdInsertDriveFile, MdOutlineSmartToy, MdCalendarToday, MdHourglassEmpty } from 'react-icons/md';
import './FileExplorer/FileExplorer.css';

function SearchResults({ visible, results, loading, onClose, onResultClick, onResultDoubleClick, onResultContextMenu }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="semantic-results">
      <div className="semantic-results-header">
        <div className="semantic-results-title">
          <MdOutlineSmartToy className="semantic-results-icon" />
          <h3>AI Search Results</h3>
        </div>
        <button className="close-results-btn" onClick={onClose}>
          <MdClose />
          <span>Close</span>
        </button>
      </div>
      {loading ? (
        <div className="search-loading-center">
          <MdHourglassEmpty className="search-loading-hourglass" />
          <span>Searching files...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">No matching files found</div>
      ) : (
        <div className="semantic-results-body">
          <div className="file-list list">
            {results.map((result, idx) => {
              const fileName = result.path.split('\\').pop() || result.path.split('/').pop();
              const scorePercent = Math.round(result.score * 100);
               const createdDate = result.created_time
                ? new Date(result.created_time * 1000).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                  })
                : null;
              return (
                <div
                  key={result.path + idx}
                  className="file-item file search-result-item"
                  onClick={() => onResultClick(result.path)}
                  onDoubleClick={() => onResultDoubleClick?.(result.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onResultContextMenu?.(result, e);
                  }}
                  title={result.path}
                >
                  <div className="file-icon"><MdInsertDriveFile /></div>
                  <div className="file-info">
                    <div className="file-name">{fileName}</div>
                    <div className="file-meta">
                      {result.path}
                      {createdDate && (
                        <span className="result-created-date"> · <MdCalendarToday className="result-date-icon" /> {createdDate}</span>
                      )}
                    </div>
                  </div>
                  <div className="search-score">
                    <div className="score-bar">
                      <div className="score-fill" style={{ width: `${scorePercent}%` }}></div>
                    </div>
                    <span className="score-text">{scorePercent}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchResults;
