import React, { useState, useRef, useCallback, useEffect } from 'react';
import FileExplorer from '../FileExplorer/FileExplorer';
import './DualPane.css';

/**
 * DualPane — renders two independent FileExplorer panes side by side
 * with a draggable divider between them.
 */
function DualPane({ drives, onFileSelect }) {
  // Left pane takes leftPct% of the width
  const [leftPct, setLeftPct] = useState(() => {
    try {
      const saved = localStorage.getItem('intellifile-dual-pane-split');
      const pct = parseFloat(saved);
      return isNaN(pct) ? 50 : Math.max(20, Math.min(80, pct));
    } catch {
      return 50;
    }
  });
  const [activePane, setActivePane] = useState('left'); // 'left' | 'right'
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const dragStartXRef = useRef(0);
  const dragStartPctRef = useRef(50);

  // Persist split ratio
  useEffect(() => {
    try { localStorage.setItem('intellifile-dual-pane-split', String(leftPct)); } catch { }
  }, [leftPct]);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartPctRef.current = leftPct;
  }, [leftPct]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartXRef.current;
      const deltaPct = (deltaX / rect.width) * 100;
      const newPct = Math.max(20, Math.min(80, dragStartPctRef.current + deltaPct));
      setLeftPct(newPct);
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className="dual-pane-container"
      style={{ userSelect: isDragging ? 'none' : 'auto', cursor: isDragging ? 'col-resize' : 'auto' }}
    >
      {/* Left Pane */}
      <div
        className={`explorer-pane${activePane === 'left' ? ' pane-active' : ''}`}
        style={{ flex: `0 0 ${leftPct}%`, maxWidth: `${leftPct}%` }}
        onClick={() => setActivePane('left')}
      >
        <div className="pane-label">
          <span className="pane-label-dot" />
          Left Panel
        </div>
        <FileExplorer
          drives={drives}
          onFileSelect={onFileSelect}
          selectedFiles={{}}
          paneId="left"
        />
      </div>

      {/* Divider */}
      <div
        className={`pane-divider${isDragging ? ' dragging' : ''}`}
        onMouseDown={onDividerMouseDown}
        title="Drag to resize panels"
      >
        <div className="pane-divider-handle" />
      </div>

      {/* Right Pane */}
      <div
        className={`explorer-pane${activePane === 'right' ? ' pane-active' : ''}`}
        style={{ flex: `0 0 ${100 - leftPct}%`, maxWidth: `${100 - leftPct}%` }}
        onClick={() => setActivePane('right')}
      >
        <div className="pane-label">
          <span className="pane-label-dot" />
          Right Panel
        </div>
        <FileExplorer
          drives={drives}
          onFileSelect={onFileSelect}
          selectedFiles={{}}
          paneId="right"
        />
      </div>
    </div>
  );
}

export default DualPane;
