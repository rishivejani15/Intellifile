import React, { useEffect, useState, useRef } from 'react';
import './LogsPanel.css';

const LogsPanel = () => {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContainerRef = useRef(null);

  useEffect(() => {
    if (!window.intellifile) return;

    // Load initial logs
    window.intellifile.getLogs().then(initialLogs => {
      if (initialLogs) setLogs(initialLogs);
    });

    // Listen for new logs
    const cleanup = window.intellifile.onBackendLog((newLog) => {
      setLogs(prev => {
        const next = [...prev, newLog];
        if (next.length > 1000) return next.slice(1);
        return next;
      });
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    if (window.intellifile) await window.intellifile.clearLogs();
    setLogs([]);
  };

  const filteredLogs = logs.filter(log => {
    if (!filter) return true;
    const l = filter.toLowerCase();
    return (
      (log.message && log.message.toLowerCase().includes(l)) ||
      (log.category && log.category.toLowerCase().includes(l))
    );
  });

  const getCategoryClass = (cat) => {
    const c = cat.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c.includes('pystdout')) return 'cat-py-stdout';
    if (c.includes('pystderr')) return 'cat-py-stderr';
    if (c.includes('chatbackend')) return 'cat-chatbackend';
    if (c.includes('index')) return 'cat-index';
    if (c.includes('watcher')) return 'cat-watcher';
    if (c.includes('main')) return 'cat-main';
    return 'cat-default';
  };

  const handleCopyAll = () => {
    const textToCopy = filteredLogs
      .map(log => `[${log.timestamp}] [${log.category}] ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      // Could show a toast here if we had access to the toast system in this component
      console.log('Logs copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy logs:', err);
    });
  };

  return (
    <div className="logs-panel">
      <div className="logs-toolbar">
        <div className="left-controls">
          <input 
            type="text" 
            placeholder="Filter logs..." 
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="right-controls">
          <label>
            <input 
              type="checkbox" 
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button onClick={handleCopyAll} title="Copy all logs to clipboard">Copy All</button>
          <button onClick={handleClear}>Clear</button>
        </div>
      </div>
      <div className="logs-container" ref={logsContainerRef}>
        {filteredLogs.map((log, i) => (
          <div key={i} className={`log-entry ${log.isError ? 'log-error' : ''}`}>
            <span className="log-timestamp">{log.timestamp}</span>
            <span className={`log-category ${getCategoryClass(log.category)}`}>[{log.category}]</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogsPanel;
