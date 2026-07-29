import React, { useEffect, useState, useRef } from 'react';
import { showToast } from '../utils/toast';
import './LogsPanel.css';

// Categories that map to CSS colour classes
const CATEGORY_COLORS = {
  'pystdout':      'cat-py-stdout',
  'pystderr':      'cat-py-stderr',
  'chatbackend':   'cat-chatbackend',
  'index':         'cat-index',
  'indexing':      'cat-index',
  'watcher':       'cat-watcher',
  'filewatch':     'cat-watcher',
  'main':          'cat-main',
  'syncserver':    'cat-syncserver',
  'sync':          'cat-syncserver',
  'modeldownload': 'cat-modeldownload',
  'model':         'cat-modeldownload',
  'firewall':      'cat-firewall',
  'network':       'cat-network',
  'setup':         'cat-modeldownload',
  'python':        'cat-py-stdout',
  'ui':            'cat-ui',
};

const LEVEL_FILTERS = ['all', 'error', 'warning', 'success', 'info'];
const LEVEL_LABELS  = { all: 'All', error: 'Error', warning: 'Warning', success: 'Success', info: 'Info' };
const LEVEL_ICONS   = { all: '📋', error: '🔴', warning: '🟡', success: '🟢', info: '🔵' };

const CATEGORY_OPTIONS = [
  { value: 'all',           label: 'All Categories' },
  { value: 'firewall',      label: '🛡️ Firewall' },
  { value: 'modeldownload', label: '⬇️ Model Download' },
  { value: 'syncserver',    label: '🔄 Sync Server' },
  { value: 'indexing',      label: '📇 Indexing' },
  { value: 'python',        label: '🐍 Python Engine' },
  { value: 'watcher',       label: '👁️ File Watcher' },
  { value: 'main',          label: '⚙️ Main Process' },
];

function getCategoryClass(cat) {
  if (!cat) return 'cat-default';
  const key = cat.toLowerCase().replace(/[\s_-]/g, '');
  return CATEGORY_COLORS[key] || 'cat-default';
}

function matchesCategory(log, catFilter) {
  if (catFilter === 'all') return true;
  const cat = (log.category || '').toLowerCase().replace(/[\s_-]/g, '');
  if (catFilter === 'python')        return cat.includes('py') || cat.includes('python') || cat.includes('chatbackend');
  if (catFilter === 'watcher')       return cat.includes('watch') || cat.includes('filewatch') || cat.includes('watcher');
  if (catFilter === 'indexing')      return cat.includes('index') || cat.includes('indexing');
  if (catFilter === 'main')          return cat === 'main' || cat.includes('argv') || cat.includes('updater') || cat.includes('openwith') || cat.includes('ui');
  if (catFilter === 'syncserver')    return cat.includes('sync');
  if (catFilter === 'modeldownload') return cat.includes('model') || cat.includes('setup');
  if (catFilter === 'firewall')      return cat.includes('firewall') || cat.includes('network');
  return cat.includes(catFilter);
}

const LogsPanel = () => {
  const [logs, setLogs]               = useState([]);
  const [textFilter, setTextFilter]   = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [catFilter, setCatFilter]     = useState('all');
  const [autoScroll, setAutoScroll]   = useState(true);
  const [restarting, setRestarting]   = useState(false);
  const logsContainerRef              = useRef(null);

  useEffect(() => {
    if (!window.intellifile) return;
    window.intellifile.getLogs().then(initialLogs => {
      if (initialLogs) setLogs(initialLogs);
    });
    const cleanup = window.intellifile.onBackendLog((newLog) => {
      setLogs(prev => {
        const next = [...prev, newLog];
        if (next.length > 2000) return next.slice(next.length - 2000);
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

  const handleRestartSync = async () => {
    if (!window.intellifile?.restartSyncServer) return;
    setRestarting(true);
    try {
      const result = await window.intellifile.restartSyncServer();
      if (result && result.success) {
        showToast('Sync server restart initiated', { type: 'success', title: 'Sync Server', duration: 3000 });
      } else {
        showToast(`Restart failed: ${result?.error || 'Unknown error'}`, { type: 'error', title: 'Sync Server', duration: 4000 });
      }
    } catch (err) {
      showToast(`Restart error: ${err.message}`, { type: 'error', title: 'Sync Server', duration: 4000 });
    } finally {
      setRestarting(false);
    }
  };

  const handleExport = () => {
    const text = filteredLogs
      .map(log => `[${log.timestamp}] [${(log.level || 'info').toUpperCase()}] [${log.category}] ${log.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `intellifile-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Logs exported', { type: 'success', title: 'Export', duration: 2500 });
  };

  const handleCopyAll = () => {
    const textToCopy = filteredLogs
      .map(log => `[${log.timestamp}] [${(log.level || 'info').toUpperCase()}] [${log.category}] ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Logs copied to clipboard', { type: 'success', title: 'Copied', duration: 2500 });
    }).catch(err => {
      console.error('Failed to copy logs:', err);
    });
  };

  // Count logs per level for badge display
  const levelCounts = logs.reduce((acc, log) => {
    const lv = log.level || 'info';
    acc[lv] = (acc[lv] || 0) + 1;
    return acc;
  }, {});

  const filteredLogs = logs.filter(log => {
    if (levelFilter !== 'all') {
      const lv = log.level || 'info';
      if (lv !== levelFilter) return false;
    }
    if (!matchesCategory(log, catFilter)) return false;
    if (textFilter) {
      const t = textFilter.toLowerCase();
      const msgMatch = log.message  && log.message.toLowerCase().includes(t);
      const catMatch = log.category && log.category.toLowerCase().includes(t);
      if (!msgMatch && !catMatch) return false;
    }
    return true;
  });

  const getLevelClass = (log) => {
    const lv = log.level || (log.isError ? 'error' : 'info');
    if (lv === 'error')   return 'log-error';
    if (lv === 'warning') return 'log-warning';
    if (lv === 'success') return 'log-success';
    return 'log-info';
  };

  const hasActiveFilter = levelFilter !== 'all' || catFilter !== 'all' || textFilter;

  return (
    <div className="logs-panel">
      {/* ── Toolbar top row: search + level chips ── */}
      <div className="logs-toolbar">
        <div className="logs-toolbar-row logs-toolbar-top">
          <input
            type="text"
            className="logs-search-input"
            placeholder="🔍  Filter logs…"
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
          />
          <div className="logs-level-chips" role="group" aria-label="Filter by level">
            {LEVEL_FILTERS.map(lv => (
              <button
                key={lv}
                className={`level-chip level-chip--${lv}${levelFilter === lv ? ' active' : ''}`}
                onClick={() => setLevelFilter(lv)}
                title={`Show ${LEVEL_LABELS[lv]} logs`}
              >
                {LEVEL_ICONS[lv]} {LEVEL_LABELS[lv]}
                {lv !== 'all' && levelCounts[lv] ? (
                  <span className="chip-badge">{levelCounts[lv]}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* ── Toolbar bottom row: category chips + action buttons ── */}
        <div className="logs-toolbar-row logs-toolbar-bottom">
          <div className="logs-cat-chips" role="group" aria-label="Filter by category">
            {CATEGORY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`cat-chip${catFilter === opt.value ? ' active' : ''}`}
                onClick={() => setCatFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="logs-controls-right">
            <label className="logs-autoscroll-label">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button
              className={`logs-btn logs-btn--restart${restarting ? ' loading' : ''}`}
              onClick={handleRestartSync}
              disabled={restarting}
              title="Restart the sync server process"
            >
              {restarting ? '⟳ Restarting…' : '🔄 Restart Sync'}
            </button>
            <button className="logs-btn" onClick={handleExport} title="Export visible logs as .txt">⬇ Export</button>
            <button className="logs-btn" onClick={handleCopyAll} title="Copy visible logs to clipboard">📋 Copy</button>
            <button className="logs-btn logs-btn--danger" onClick={handleClear} title="Clear all logs">🗑 Clear</button>
          </div>
        </div>
      </div>

      {/* ── Log Entries ── */}
      <div className="logs-container" ref={logsContainerRef}>
        {filteredLogs.length === 0 ? (
          <div className="logs-empty">
            <p>No logs match the current filters.</p>
            {hasActiveFilter && (
              <button
                className="logs-empty-clear-btn"
                onClick={() => { setLevelFilter('all'); setCatFilter('all'); setTextFilter(''); }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} className={`log-entry ${getLevelClass(log)}`}>
              <span className="log-timestamp">{log.timestamp}</span>
              <span className={`log-level-badge level-badge--${log.level || 'info'}`}>
                {(log.level || 'info').toUpperCase()}
              </span>
              <span className={`log-category ${getCategoryClass(log.category)}`}>
                [{log.category}]
              </span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="logs-statusbar">
        <span className="logs-statusbar-count">
          {filteredLogs.length} of {logs.length} entries
        </span>
        {hasActiveFilter && (
          <button
            className="logs-statusbar-clear-filter"
            onClick={() => { setLevelFilter('all'); setCatFilter('all'); setTextFilter(''); }}
          >
            ✕ Clear all filters
          </button>
        )}
      </div>
    </div>
  );
};

export default LogsPanel;


