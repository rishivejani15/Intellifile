import React, { useState, useEffect, useCallback } from 'react';
import VersionCard from './VersionCard';
import VersionDiffViewer from './VersionDiffViewer';
import { getVersions, compareVersions } from '../../services/versionService';
import './versioning.css';

const ipc = window.electron?.ipcRenderer;

const VersionTimeline = ({ filePath }) => {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [diffText, setDiffText] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const normalizeVersions = useCallback((raw) => {
    if (!Array.isArray(raw)) return [];

    const sorted = [...raw].sort((a, b) => String(b?.version_id || '').localeCompare(String(a?.version_id || '')));
    const seenById = new Set();
    const seenByHash = new Set();

    return sorted.filter((v) => {
      const versionId = v?.version_id;
      const fileHash = v?.file_hash;

      if (!versionId) return false;
      if (seenById.has(versionId)) return false;

      // Collapse visually identical snapshots to avoid repeated "modified" cards.
      if (fileHash && seenByHash.has(fileHash)) {
        seenById.add(versionId);
        return false;
      }

      seenById.add(versionId);
      if (fileHash) seenByHash.add(fileHash);
      return true;
    });
  }, []);

  const fetchVersions = useCallback(async () => {
    if (!filePath) {
      console.warn('[Timeline] No filePath provided');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      console.log('[Timeline] Fetching versions for:', filePath);
      const result = await getVersions(filePath);
      console.log('[Timeline] Raw Result:', result);

      if (result && result.success && Array.isArray(result.data)) {
        const normalized = normalizeVersions(result.data);
        console.log(`[Timeline] Success! Found ${result.data.length} versions (${normalized.length} unique)`);
        setVersions(normalized);
      } else if (result && result.error) {
        console.error('[Timeline] Engine Error:', result.error);
        setError(`Engine error: ${result.error}`);
        setVersions([]);
      } else if (Array.isArray(result)) {
        const normalized = normalizeVersions(result);
        console.log(`[Timeline] Success (direct array)! Found ${result.length} versions (${normalized.length} unique)`);
        setVersions(normalized);
      } else {
        console.warn('[Timeline] No versions found or invalid format');
        setVersions([]);
      }
    } catch (err) {
      console.error('[Timeline] Fetch Exception:', err);
      setError('Failed to connect to version engine');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, normalizeVersions, refreshKey]);

  useEffect(() => {
    console.log('[VersionTimeline] Mounting/Updating for path:', filePath);
    fetchVersions();

    const handleManualRefresh = () => {
      console.log('[VersionTimeline] Manual refresh triggered');
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('refresh-version-timeline', handleManualRefresh);

    const handler = (event, data) => {
      try {
        const normalizedPropPath = (filePath || '').toLowerCase().replace(/\//g, '\\\\');
        const normalizedEventPath = (data?.filePath || '').toLowerCase().replace(/\//g, '\\\\');

        if (normalizedEventPath === normalizedPropPath) {
          console.log('[Timeline] Refreshing due to external save:', data.filePath);
          fetchVersions();
        }
      } catch (err) {
        console.error('[Timeline] handler error:', err);
      }
    };

    if (ipc) {
      if (typeof ipc.on === 'function') ipc.on('version-updated', handler);
      else if (typeof ipc.addListener === 'function') ipc.addListener('version-updated', handler);
    }

    return () => {
      window.removeEventListener('refresh-version-timeline', handleManualRefresh);
      if (ipc) {
        try {
          if (typeof ipc.removeListener === 'function') ipc.removeListener('version-updated', handler);
          else if (typeof ipc.off === 'function') ipc.off('version-updated', handler);
        } catch (err) {
          console.error('[Timeline] Error removing listener:', err);
        }
      }
    };
  }, [filePath, fetchVersions]);

  const handleCompareClick = (versionId) => {
    if (!compareA) {
      setCompareA(versionId);
    } else if (compareA === versionId) {
      setCompareA(null);
    } else {
      setCompareB(versionId);
      triggerComparison(compareA, versionId);
    }
  };

  const triggerComparison = async (vA, vB) => {
    setLoading(true);
    try {
      const result = await compareVersions(filePath, vA, vB);

      if (result && result.success && result.data && result.data.diff !== undefined) {
        setDiffText(result.data.diff);
        setShowDiff(true);
      } else {
        alert('Comparison failed: ' + (result?.error || 'Unknown error'));
        setCompareA(null);
        setCompareB(null);
      }
    } catch (err) {
      alert('Error comparing: ' + (err?.message || err));
      setCompareA(null);
      setCompareB(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseDiff = () => {
    setShowDiff(false);
    setCompareA(null);
    setCompareB(null);
  };
  if (!filePath) {
    return null;
  }
 return (
        <div className="version-timeline">

            {compareA && (
                <div className="compare-banner">
                    <span>Select version to compare with <strong>{compareA.substring(0, 8)}</strong></span>
                    <button className="btn-compare-now" onClick={() => setCompareA(null)}>Cancel</button>
                </div>
            )}

            <div className="timeline-list">
                {loading && <div className="timeline-loading">Loading versions...</div>}
                {error && <div className="timeline-error">{error}</div>}
                {!loading && versions.length === 0 && (
                    <div className="no-versions">No versions found for this file.</div>
                )}
                {versions.map((v, index) => (
                    <VersionCard
                        key={v.version_id}
                        version={v}
                        filePath={filePath}
                        onRefresh={fetchVersions}
                        onCompareClick={() => handleCompareClick(v.version_id)}
                        isSelecting={compareA === v.version_id}
                        isLatest={index === 0}
                        isBaseline={index === versions.length - 1 && versions.length > 1}
                    />
                ))}
            </div>

            {showDiff && (
                <VersionDiffViewer
                    diffText={diffText}
                    versionA={compareA}
                    versionB={compareB}
                    onClose={handleCloseDiff}
                />
            )}
        </div>
    );
};

export default VersionTimeline;
