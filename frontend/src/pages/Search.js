import React, { useState, useCallback, useEffect, useRef } from 'react';
import { searchFiles, indexDevice, getSearchStatus, onIndexProgress } from '../services/searchService';
import './Search.css';

const ipcRenderer = window.electron?.ipcRenderer;

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [lastIndexedTime, setLastIndexedTime] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);   // { phase, detail, pct }
  const indexingRef = useRef(false);

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

  // Listen for indexing progress from the Python engine
  useEffect(() => {
    const unsub = onIndexProgress((data) => {
      setProgress({ phase: data.phase, detail: data.detail, pct: data.pct ?? null });
    });
    return unsub;
  }, []);

  // Auto-start indexing once the engine is ready (first launch only)
  useEffect(() => {
    if (ready && !indexingRef.current && !lastIndexedTime) {
      handleIndexDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ── Index device ────────────────────────
  const handleIndexDevice = useCallback(async () => {
    if (indexingRef.current) return;  // prevent double-start
    try {
      indexingRef.current = true;
      setIndexing(true);
      setError('');
      setProgress({ phase: 'starting', detail: 'Starting indexing…', pct: 0 });

      const res = await indexDevice();
      
      if (res && res.error) {
        setError(res.error);
      } else {
        setLastIndexedTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      setError(err.message);
    } finally {
      indexingRef.current = false;
      setIndexing(false);
      setProgress(null);
    }
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

  return (
    <div className="search-page">
      <h2>Semantic Search</h2>

      {!ready && (
        <div className="search-notice">
          ⏳ Search engine is loading… please wait.
        </div>
      )}

      <div className="index-section">
        <button
          className="index-btn"
          onClick={handleIndexDevice}
          disabled={indexing || !ready}
        >
          {indexing ? 'Indexing Device…' : '🧠 Index Entire Device'}
        </button>

        {lastIndexedTime && (
          <span className="indexed-label">
            ✅ Last indexed: <strong>{lastIndexedTime}</strong>
          </span>
        )}

        {progress && (
          <div className="index-progress">
            <div className="progress-detail">{progress.detail}</div>
            {progress.pct != null && (
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(progress.pct, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {indexing && (
        <div className="search-notice indexing-hint">
          You can search while indexing is in progress — results will improve as more files are indexed.
        </div>
      )}

      {/* Search bar */}
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search files semantically…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!ready}
        />
        <button type="submit" disabled={searching || !ready}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

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
            <div className="result-score">
              Score: {(r.score * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
