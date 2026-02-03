import React from 'react';
import './DiffViewer.css';

function DiffViewer({ oldValue, newValue, mergedValue }) {
  const getLineDiff = () => {
    const oldLines = oldValue.split('\n');
    const newLines = newValue.split('\n');
    
    const lines = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
      
      lines.push({
        lineNum: i + 1,
        oldLine,
        newLine,
        changed: oldLine !== newLine,
        added: !oldLine && newLine,
        deleted: oldLine && !newLine,
        modified: oldLine && newLine && oldLine !== newLine
      });
    }
    
    return lines;
  };

  const lineDiffs = getLineDiff();

  return (
    <div className="diff-viewer-container">
      <div className="diff-header">
        <div className="diff-column-header">Base Version</div>
        <div className="diff-column-header">Merged Result</div>
      </div>
      
      <div className="diff-content">
        {lineDiffs.map((line, idx) => (
          <div 
            key={idx} 
            className={`diff-line ${line.changed ? 'changed' : ''} ${line.added ? 'added' : ''} ${line.deleted ? 'deleted' : ''} ${line.modified ? 'modified' : ''}`}
          >
            <div className="line-num old-line-num">
              {line.deleted ? '✕' : (line.oldLine ? line.lineNum : '')}
            </div>
            <div className="line-content old-line">
              <code>{line.oldLine}</code>
            </div>
            
            <div className="line-num new-line-num">
              {line.added ? '+' : (line.newLine ? line.lineNum : '')}
            </div>
            <div className="line-content new-line">
              <code>{line.newLine}</code>
            </div>
          </div>
        ))}
      </div>

      <div className="diff-legend">
        <div className="legend-item">
          <span className="legend-color added"></span> Added
        </div>
        <div className="legend-item">
          <span className="legend-color deleted"></span> Deleted
        </div>
        <div className="legend-item">
          <span className="legend-color modified"></span> Modified
        </div>
      </div>
    </div>
  );
}

export default DiffViewer;
