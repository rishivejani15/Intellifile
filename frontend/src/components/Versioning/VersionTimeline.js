import React, { useState, useEffect, useCallback } from 'react';
import VersionCard from './VersionCard';
import VersionDiffViewer from './VersionDiffViewer';
import { getVersions, runSmartCleanup } from '../../services/versionService';
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

        let unsubscribe = null;
        if (window.electron?.ipcRenderer) {
            unsubscribe = window.electron.ipcRenderer.on('version-updated', (event, data) => {
                const normalizedPropPath = filePath.toLowerCase().replace(/\//g, '\\');
                const normalizedEventPath = data.filePath.toLowerCase().replace(/\//g, '\\');

                if (normalizedEventPath === normalizedPropPath) {
                    console.log('[Timeline] Refreshing due to external save:', data.filePath);
                    fetchVersions();
                }
            });
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
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

    const handleCleanup = async () => {
        const confirmed = window.confirm(
            "IntelliFile Smart Cleanup\n\n" +
            "This will apply the following maintenance to save disk space:\n" +
            "• PURGE orphaned 'Lego Blocks' (Chunks) and Cache.\n" +
            "• KEEP all versions for the last 7 days.\n" +
            "• KEEP only 1 version per day for versions older than 30 days.\n" +
            "• DELETE all versions older than 1 year.\n\n" +
            "Do you want to proceed with the total cleanup?"
        );

        if (!confirmed) return;

        setLoading(true);
        try {
            const res = await runSmartCleanup(filePath);
            if (res && res.success) {
                const itemsCleaned = res.maintenance_count || 0;
                alert(`Cleanup Complete!\n\nHistory: Deleted ${res.deleted_versions} versions.\nStorage: Cleaned ${itemsCleaned} background items.\nFreed up ${res.freed_mb} MB of space.`);
                fetchVersions();
            } else {
                alert("Cleanup failed: " + (res?.error || "Unknown error"));
            }
        } catch (err) {
            alert("Error during cleanup: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="version-timeline">
            <div className="timeline-header">
                <h3>Version History</h3>
                <div className="header-actions">
                    <button className="btn-cleanup" onClick={handleCleanup} disabled={loading} title="Run Smart Cleanup">
                        {loading ? '...' : '🧹'}
                    </button>
                    <button className="btn-refresh" onClick={fetchVersions} disabled={loading}>
                        {loading ? '...' : 'Refresh'}
                    </button>
                </div>
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
