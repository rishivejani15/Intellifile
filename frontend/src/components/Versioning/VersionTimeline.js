import React, { useState, useEffect, useCallback } from 'react';
import VersionCard from './VersionCard';
import VersionDiffViewer from './VersionDiffViewer';
import { getVersions } from '../../services/versionService';
import './versioning.css';

const VersionTimeline = ({ filePath }) => {
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [compareA, setCompareA] = useState(null);
    const [compareB, setCompareB] = useState(null);
    const [diffText, setDiffText] = useState(null);
    const [showDiff, setShowDiff] = useState(false);

    const fetchVersions = useCallback(async () => {
        if (!filePath) return;
        setLoading(true);
        setError(null);
        try {
            const result = await getVersions(filePath);
            console.log('[Timeline] Versions received:', result);

            if (result && result.success && Array.isArray(result.data)) {
                setVersions(result.data);
            } else if (Array.isArray(result)) {
                setVersions(result);
            } else if (result && result.error) {
                setError(result.error);
                setVersions([]);
            } else {
                setVersions([]);
            }
        } catch (err) {
            setError('Failed to load version history');
            setVersions([]);
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [filePath]);

    useEffect(() => {
        fetchVersions();

        let handler = null;
        if (window.electron?.ipcRenderer) {
            handler = (data) => {
                const normalizedPropPath = filePath.toLowerCase().replace(/\//g, '\\');
                const normalizedEventPath = data.filePath.toLowerCase().replace(/\//g, '\\');

                if (normalizedEventPath === normalizedPropPath) {
                    console.log('[Timeline] Refreshing due to external save:', data.filePath);
                    fetchVersions();
                }
            };
            window.electron.ipcRenderer.on('version-updated', handler);
        }

        return () => {
            // No-op: ipcRenderer.on doesn't provide a built-in unsubscribe,
            // but the listener will be GC'd when this component unmounts.
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
            const result = await window.electron.ipcRenderer.invoke('compare-versions', {
                filePath,
                versionA: vA,
                versionB: vB
            });

            if (result && result.success && result.data && result.data.diff !== undefined) {
                setDiffText(result.data.diff);
                setShowDiff(true);
            } else {
                alert('Comparison failed: ' + (result?.error || 'Unknown error'));
                setCompareA(null);
                setCompareB(null);
            }
        } catch (err) {
            alert('Error comparing: ' + err.message);
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

    return (
        <div className="version-timeline">
            <div className="timeline-header">
                <h3>Version History</h3>
                <button className="btn-refresh" onClick={fetchVersions} disabled={loading}>
                    {loading ? '...' : 'Refresh'}
                </button>
            </div>

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
                {versions.map((v) => (
                    <VersionCard
                        key={v.version_id}
                        version={v}
                        filePath={filePath}
                        onRefresh={fetchVersions}
                        onCompareClick={() => handleCompareClick(v.version_id)}
                        isSelecting={compareA === v.version_id}
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
