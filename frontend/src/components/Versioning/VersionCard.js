import React, { useState } from 'react';
import RiskBadge from './RiskBadge';
import { restoreVersion } from '../../services/versionService';
import './versioning.css';

const VersionCard = ({ version, filePath, onRefresh, onCompareClick, isSelecting, isLatest, isBaseline }) => {
    const [restoring, setRestoring] = useState(false);

    const handleRollback = async () => {
        if (!window.confirm(`Rollback file to version ${version.version_id}? Current changes will be backed up.`)) {
            return;
        }

        setRestoring(true);
        try {
            const result = await restoreVersion(filePath, version.version_id);
            if (result && result.success) {
                const len = result.restored_length !== undefined ? ` (${result.restored_length} bytes)` : '';
                alert(`Rollback successful!${len}\n\nNote: If you have the file open in an external editor, please reload it to see the changes.`);
                onRefresh(); // Refresh timeline to see the current state
            } else {
                alert('Rollback failed: ' + (result?.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Error during rollback: ' + err.message);
        } finally {
            setRestoring(false);
        }
    };

    const formatDate = (ts) => {
        if (!ts) return 'Unknown Date';
        // TS is YYYYMMDDHHMMSSffffff (UTC)
        try {
            const year = parseInt(ts.substring(0, 4));
            const month = parseInt(ts.substring(4, 6)) - 1; // 0-indexed
            const day = parseInt(ts.substring(6, 8));
            const hour = parseInt(ts.substring(8, 10));
            const min = parseInt(ts.substring(10, 12));
            const sec = parseInt(ts.substring(12, 14));

            // Create a Date object in UTC
            const date = new Date(Date.UTC(year, month, day, hour, min, sec));

            // Fallback for invalid date
            if (isNaN(date.getTime())) return ts;

            // Return local string
            return date.toLocaleString();
        } catch (e) {
            return ts;
        }
    };

    const getIntentClass = (intent) => {
        if (!intent) return '';
        const i = intent.toLowerCase();
        if (i.includes('heavy deletion')) return 'intent-heavy-deletion';
        if (i.includes('moderate deletion')) return 'intent-moderate-deletion';
        if (i.includes('light deletion')) return 'intent-light-deletion';
        if (i.includes('sensitive')) return 'intent-sensitive';
        if (i.includes('addition')) return 'intent-addition';
        return '';
    };

    return (
        <div className={`version-card ${isSelecting ? 'selecting' : ''}`}>
            <div className="version-header">
                <span className="version-id">{version.version_id?.substring(0, 8)}</span>
                <span className="version-date">{formatDate(version.version_id)}</span>
            </div>

            <div className="version-intent-row">
                <span className={`intent-label ${isBaseline ? '' : getIntentClass(version.intent)}`}>
                    {isBaseline ? 'Original Version' : (version.intent || 'Update')}
                </span>
                <RiskBadge level={isBaseline ? 'Low' : version.risk_level} />
            </div>

            <p className="version-summary">
                {isBaseline ? 'Original file state captured.' : version.summary}
            </p>

            <div className="version-metrics">
                <div className="metric">
                    <span className="metric-label">Stability</span>
                    <div className="stability-bar">
                        <div
                            className="stability-fill"
                            style={{ width: `${(version.stability_score || 0) * 100}%` }}
                        ></div>
                    </div>
                    <span className="metric-value">{((version.stability_score || 0) * 100).toFixed(0)}%</span>
                </div>
            </div>

            <div className="version-actions">
                {isLatest ? (
                    <button className="btn-current-state" disabled>
                        Current State
                    </button>
                ) : (
                    <button className="btn-restore" onClick={handleRollback} disabled={restoring}>
                        {restoring ? 'Restoring...' : 'Rollback'}
                    </button>
                )}
                <button className="btn-compare" onClick={onCompareClick}>
                    {isSelecting ? 'Cancel' : 'Compare'}
                </button>
            </div>
        </div>
    );
};

export default VersionCard;
