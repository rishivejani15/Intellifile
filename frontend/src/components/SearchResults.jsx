import React from 'react';
import {
  MdClose,
  MdInsertDriveFile,
  MdOutlineSmartToy,
  MdCalendarToday,
  MdHourglassEmpty,
  MdOutlineAutoAwesome,
  MdOutlineTextFields,
  MdOutlineDriveFileRenameOutline,
  MdOutlineDocumentScanner
} from 'react-icons/md';
import './FileExplorer/FileExplorer.css';

const RETRIEVAL_METHODS = {
  semantic: {
    label: 'Semantic',
    icon: <MdOutlineAutoAwesome className="method-badge-icon" />,
    className: 'method-badge-semantic',
    tooltip: 'Retrieved via AI semantic similarity search'
  },
  keyword: {
    label: 'Keyword',
    icon: <MdOutlineTextFields className="method-badge-icon" />,
    className: 'method-badge-keyword',
    tooltip: 'Retrieved via exact keyword matching'
  },
  filename: {
    label: 'File Name',
    icon: <MdOutlineDriveFileRenameOutline className="method-badge-icon" />,
    className: 'method-badge-filename',
    tooltip: 'Retrieved via file name match'
  },
  ocr: {
    label: 'OCR',
    icon: <MdOutlineDocumentScanner className="method-badge-icon" />,
    className: 'method-badge-ocr',
    tooltip: 'Retrieved via OCR text recognized in image/scan'
  },
  date: {
    label: 'Date',
    icon: <MdCalendarToday className="method-badge-icon" />,
    className: 'method-badge-date',
    tooltip: 'Retrieved via creation date match'
  }
};

function getResultMethods(result) {
  if (Array.isArray(result.methods) && result.methods.length > 0) {
    return result.methods;
  }
  if (typeof result.methods === 'string' && result.methods.trim()) {
    return [result.methods.trim()];
  }
  const path = (result.path || '').toLowerCase();
  const isImage = /\.(png|jpe?g|bmp|webp|tiff)$/i.test(path);
  if (isImage) {
    return ['ocr', 'semantic'];
  }
  return ['semantic'];
}

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
              const methods = getResultMethods(result);

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
                    <div className="file-name-header">
                      <div className="file-name">{fileName}</div>
                      <div className="retrieval-method-badges">
                        {methods.map((methodKey) => {
                          const config = RETRIEVAL_METHODS[methodKey.toLowerCase()] || {
                            label: methodKey,
                            icon: null,
                            className: 'method-badge-default',
                            tooltip: `Retrieved via ${methodKey}`
                          };
                          return (
                            <span
                              key={methodKey}
                              className={`method-badge ${config.className}`}
                              title={config.tooltip}
                            >
                              {config.icon}
                              <span className="method-badge-label">{config.label}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
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
