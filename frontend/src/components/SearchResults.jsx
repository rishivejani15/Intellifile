import React from 'react';
import './FileExplorer/FileExplorer.css';

function SearchResults({ visible, results, loading, onClose, onResultClick }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="semantic-results">
      <div className="semantic-results-header">
        <h3>🧠 AI Search Results</h3>
        <button className="close-results-btn" onClick={onClose}>✕ Close</button>
      </div>
      {results.length === 0 ? (
        <div className="empty-state">No matching files found</div>
      ) : (
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
                title={result.path}
              >
                <div className="file-icon">📄</div>
                <div className="file-info">
                  <div className="file-name">{fileName}</div>
                  <div className="file-meta">
                    {result.path}
                    {createdDate && (
                      <span className="result-created-date"> · 📅 {createdDate}</span>
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
      )}
    </div>
  );
}

export default SearchResults;
