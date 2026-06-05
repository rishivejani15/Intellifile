import React, { useState, useCallback, useEffect } from 'react';
import { searchFiles, getSearchStatus, onIndexProgress, onIndexComplete } from '../services/searchService';
import './Search.css';

const ipcRenderer = window.electron?.ipcRenderer;

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexPhase, setIndexPhase] = useState('');
  const [indexDetail, setIndexDetail] = useState('');
  const [indexPct, setIndexPct] = useState(null);
  const [indexMessage, setIndexMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  // Poll engine readiness
  useEffect(() => {
    let interval;
    async function check() {
      try {
        const status = await getSearchStatus();
        if (status.ready) {
          setReady(true);
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    }
    check();
    interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

 // ── Indexing status ────────────────────────
  useEffect(() => {
    const unsubscribeProgress = onIndexProgress((payload) => {
      if (!payload || payload.type !== 'progress') return;
      setIndexing(true);
      setIndexPhase(payload.phase || '');
      setIndexDetail(payload.detail || '');
      setIndexPct(typeof payload.pct === 'number' ? payload.pct : null);
      if (payload.detail) {
        setIndexMessage('');
      }
    });

      const unsubscribeComplete = onIndexComplete((payload) => {
      setIndexing(false);
      setIndexPhase('');
      setIndexDetail('');
      setIndexPct(null);
      if (payload && payload.error) {
        setIndexMessage(`Indexing failed: ${payload.error}`);
      } else {
         setIndexMessage('Index updated');
      }
    });
     return () => {
      unsubscribeProgress();
      unsubscribeComplete();
    };
  }, []);

  // ── Search ────────────────────────────────
  const handleSearch = useCallback(async (e) => {
    e && e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setError('');
    try {
      const res = await searchFiles(query);
      setResults(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }, [query]);

  // ── Open file on click ────────────────────
  const openFile = useCallback((filePath) => {
    if (window.electron?.shell?.openPath) {
      window.electron.shell.openPath(filePath);
    }
  }, []);
 // ── Format Unix timestamp ─────────────────
  const formatDate = (timestamp) => {
    if (!timestamp) return null;
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  // Detect if query has a date component (for UI badge)
  const hasDateFilter = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|\d{4}|yesterday|today|last\s+week|last\s+month|this\s+month|this\s+year)\b/i.test(query);
  return (
    <div className="search-page">
      <h2>Semantic Search</h2>

      {!ready && (
        <div className="search-notice">
          ⏳ Search engine is loading… please wait.
        </div>
      )}

{(indexing || indexMessage) && (
        <div className={`index-status ${indexing ? 'running' : (indexMessage && indexMessage.toLowerCase().includes('failed') ? 'error' : 'done')}`} title={indexDetail || indexMessage}>
          <span className="index-dot" />
          <span className="index-text">
            {indexing ? `Indexing${indexPhase ? ` (${indexPhase})` : ''}` : (indexMessage || 'Checking index...')}
          </span>
     
      {indexing && typeof indexPct === 'number' && (
            <span className="index-pct">{indexPct}%</span>
          )}
        </div>
      )}

      {/* Search bar */}
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder='Search files… try "bills from june 2025" or "report last week"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!ready}
        />
        <button type="submit" disabled={searching || !ready}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {hasDateFilter && query.trim() && (
        <div className="date-filter-badge">
          📅 Date filter detected — results will be filtered by file creation date
        </div>
      )}
      {error && <div className="search-error">{error}</div>}

      {/* Results */}
      <div className="search-results">
        {results.length === 0 && !searching && query && (
          <div className="no-results">No results found.</div>
        )}

        {results.map((r, i) => (
          <div
            key={i}
            className="result-card"
            onClick={() => openFile(r.path)}
            title={r.path}
          >
            <div className="result-path">{r.path}</div>
            <div className="result-meta">
              <span className="result-score">
                Score: {(r.score * 100).toFixed(1)}%
              </span>
              {r.created_time && (
                <span className="result-date">
                  📅 Created: {formatDate(r.created_time)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
