import React, { useState, useCallback, useEffect } from 'react';
import { searchFiles, indexDevice, getSearchStatus } from '../services/searchService';
import './Search.css';

const ipcRenderer = window.electron?.ipcRenderer;

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexedFolder, setIndexedFolder] = useState('');
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

  // ── Index the device ────────────────────────
  const handleIndex = useCallback(async () => {
    try {
      setIndexing(true);
      setError('');
      const res = await indexDevice();

      if (res.error) {
        setError(res.error);
      } else {
        setIndexedFolder('Device Root');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIndexing(false);
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

      {/* Device selector */}
      <div className="index-section">
        <button
          className="index-btn"
          onClick={handleIndex}
          disabled={indexing || !ready}
        >
          {indexing ? 'Indexing…' : '💻 Index Device'}
        </button>

        {indexedFolder && (
          <span className="indexed-label">
            ✅ Indexed: <strong>{indexedFolder}</strong>
          </span>
        )}
      </div>

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
