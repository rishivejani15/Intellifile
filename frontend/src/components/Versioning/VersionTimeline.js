import React, { useState, useEffect, useCallback } from 'react';
import VersionCard from './VersionCard';
import VersionDiffViewer from './VersionDiffViewer';
import { getVersions, compareVersions } from '../../services/versionService';
import { showErrorToast } from '../../utils/toast';
import './versioning.css';

const ipc = window.electron?.ipcRenderer;

const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\').replace(/[\\/]+$/, '');

const VersionTimeline = ({ filePath }) => {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [diffText, setDiffText] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const normalizeVersions = useCallback((raw) => {
    if (!Array.isArray(raw)) return [];

    const sorted = [...raw].sort((a, b) => String(b?.version_id || '').localeCompare(String(a?.version_id || '')));
    const seenById = new Set();

    return sorted.filter((v) => {
      const versionId = v?.version_id;

      if (!versionId) return false;
      if (seenById.has(versionId)) return false;

      seenById.add(versionId);
      return true;
    });
  }, []);

  const fetchVersions = useCallback(async (isInitial = false) => {
    if (!filePath) {
      console.warn('[Timeline] No filePath provided');
      return;
    }
    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
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
      setRefreshing(false);
      setLoading(false);
    }
  }, [filePath, normalizeVersions]);

  useEffect(() => {
    console.log('[VersionTimeline] Mounting/Updating for path:', filePath);
    fetchVersions(true);

    const handleManualRefresh = () => {
      console.log('[VersionTimeline] Manual refresh triggered');
      fetchVersions(false);
    };
    window.addEventListener('refresh-version-timeline', handleManualRefresh);

    const handler = (event, data) => {
      try {
        const normalizedPropPath = normalizePath(filePath);
        const normalizedEventPath = normalizePath(data?.filePath);

        if (normalizedEventPath === normalizedPropPath) {
          console.log('[Timeline] Refreshing due to external save:', data.filePath);
          fetchVersions(false);
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
          if (typeof ipc.off === 'function') ipc.off('version-updated', handler);
          else if (typeof ipc.removeListener === 'function') ipc.removeListener('version-updated', handler);
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
        showErrorToast('Comparison failed.', result?.error || 'Unknown error', 'Choose two versions and try again.');
        setCompareA(null);
        setCompareB(null);
      }
    } catch (err) {
      showErrorToast('Comparison failed.', err?.message || 'Unknown error', 'Choose two versions and try again.');
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
// const handleCleanup = async () => {
//         const confirmed = window.confirm(
//             "IntelliFile Smart Cleanup\n\n" +
//             "This will apply the following maintenance to save disk space:\n" +
//             "• PURGE orphaned 'Lego Blocks' (Chunks) and Cache.\n" +
//             "• KEEP all versions for the last 7 days.\n" +
//             "• KEEP only 1 version per day for versions older than 30 days.\n" +
//             "• DELETE all versions older than 1 year.\n\n" +
//             "Do you want to proceed with the total cleanup?"
//         );

//         if (!confirmed) return;

//         setLoading(true);
//         try {
//             const res = await runSmartCleanup(filePath);
//             if (res && res.success) {
//                 const itemsCleaned = res.maintenance_count || 0;
//                 alert(`Cleanup Complete!\n\nHistory: Deleted ${res.deleted_versions} versions.\nStorage: Cleaned ${itemsCleaned} background items.\nFreed up ${res.freed_mb} MB of space.`);
//                 fetchVersions();
//             } else {
//                 alert("Cleanup failed: " + (res?.error || "Unknown error"));
//             }
//         } catch (err) {
//             alert("Error during cleanup: " + err.message);
//         } finally {
//             setLoading(false);
//         }
//     };


  if (!filePath) {
    return null;
  }

  // Block versioning for binary, image, system, and executable file types
  const blockedExts = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.ico', '.svg', '.tiff', '.heic', // images
    '.exe', '.dll', '.sys', '.msi', '.com', '.scr',                                      // executables/system
    '.lnk', '.url', '.shortcut',                                                          // shortcuts
    '.mp4', '.mp3', '.avi', '.mkv', '.mov', '.wav', '.flac', '.aac',                     // media
    '.zip', '.rar', '.7z', '.tar', '.gz',                                                 // archives
    '.ppt', '.pptm',                                                                       // presentations (not .pptx)
  ]);
  const getExt = (p) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx).toLowerCase() : '';
  };
  const fileExt = getExt(filePath);
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  const extIconMap = {
    // Images
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🎞️', '.bmp': '🖼️',
    '.webp': '🖼️', '.ico': '🖼️', '.svg': '🎨', '.tiff': '🖼️', '.heic': '🖼️',
    // Executables
    '.exe': '⚙️', '.dll': '⚙️', '.sys': '🔧', '.msi': '📦', '.com': '⚙️', '.scr': '🖥️',
    // Shortcuts
    '.lnk': '🔗', '.url': '🔗', '.shortcut': '🔗',
    // Media
    '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
    '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵',
    // Archives
    '.zip': '🗜️', '.rar': '🗜️', '.7z': '🗜️', '.tar': '🗜️', '.gz': '🗜️',
    // Presentations
    '.ppt': '📊', '.pptm': '📊',
  };
  const extLabelMap = {
    '.jpg': 'JPEG Image', '.jpeg': 'JPEG Image', '.png': 'PNG Image', '.gif': 'GIF Image',
    '.bmp': 'Bitmap Image', '.webp': 'WebP Image', '.ico': 'Icon File', '.svg': 'SVG Vector',
    '.tiff': 'TIFF Image', '.heic': 'HEIC Image',
    '.exe': 'Executable', '.dll': 'System Library', '.sys': 'System File', '.msi': 'Installer',
    '.com': 'Executable', '.scr': 'Screensaver',
    '.lnk': 'Windows Shortcut', '.url': 'URL Shortcut', '.shortcut': 'Shortcut',
    '.mp4': 'MP4 Video', '.avi': 'AVI Video', '.mkv': 'MKV Video', '.mov': 'QuickTime Video',
    '.mp3': 'MP3 Audio', '.wav': 'WAV Audio', '.flac': 'FLAC Audio', '.aac': 'AAC Audio',
    '.zip': 'ZIP Archive', '.rar': 'RAR Archive', '.7z': '7-Zip Archive',
    '.tar': 'TAR Archive', '.gz': 'GZip Archive',
    '.ppt': 'PowerPoint', '.pptm': 'PowerPoint Macro',
  };

  const comingSoonExts = new Set(['.pptx', '.ppt', '.pptm']);
  if (comingSoonExts.has(fileExt)) {
    return (
      <div className="versioning-unavailable-wrapper">
        <div className="versioning-unavailable-card versioning-coming-soon-card">
          <div className="versioning-unavailable-icon-ring versioning-coming-soon-ring">
            <span className="versioning-unavailable-icon">📊</span>
            <div className="versioning-unavailable-badge versioning-coming-soon-badge">
              <span>🚀</span>
            </div>
          </div>
          <h3 className="versioning-unavailable-title">Versioning Coming Soon</h3>
          <p className="versioning-unavailable-subtitle">
            <span className="versioning-unavailable-ext-chip versioning-coming-soon-chip">PowerPoint Presentation</span>
          </p>
          <p className="versioning-unavailable-desc">
            Version history support for <strong>{fileName}</strong> is currently under active development.
            <br />
            Full timeline tracking for PowerPoint files will be available in an upcoming release!
          </p>
          <div className="versioning-coming-soon-footer">
            <span className="versioning-coming-soon-tag">✨ Feature in Progress</span>
          </div>
        </div>
      </div>
    );
  }

  if (blockedExts.has(fileExt)) {
    const icon = extIconMap[fileExt] || '🚫';
    const label = extLabelMap[fileExt] || fileExt.toUpperCase().replace('.', '') + ' File';
    return (
      <div className="versioning-unavailable-wrapper">
        <div className="versioning-unavailable-card">
          <div className="versioning-unavailable-icon-ring">
            <span className="versioning-unavailable-icon">{icon}</span>
            <div className="versioning-unavailable-badge">
              <span>!</span>
            </div>
          </div>
          <h3 className="versioning-unavailable-title">Versioning Unavailable</h3>
          <p className="versioning-unavailable-subtitle">
            <span className="versioning-unavailable-ext-chip">{label}</span>
          </p>
          <p className="versioning-unavailable-desc">
            Version history is not supported for <strong>{fileName}</strong>.
            <br />
            Only text-based and document files can be tracked.
          </p>
          <div className="versioning-unavailable-supported-label">Supported types include</div>
          <div className="versioning-unavailable-supported-list">
            {['.txt', '.js', '.py', '.md', '.json', '.csv', '.html', '.css', '.docx', '.xlsx'].map(ext => (
              <span key={ext} className="versioning-supported-chip">{ext}</span>
            ))}
            <span className="versioning-supported-chip">and more…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
        <div className="version-timeline">
    <div className={`timeline-list ${refreshing ? 'is-refreshing' : ''}`}>
        {compareA && (
            <div className="compare-banner">
                <span>Select version to compare with <strong>{compareA.substring(0, 8)}</strong></span>
                <button className="btn-compare-now" onClick={() => setCompareA(null)}>Cancel</button>
            </div>
        )}
              {refreshing && (
                <div className="timeline-refresh-indicator" aria-live="polite">
                  Updating timeline...
                </div>
              )}
              {loading && versions.length === 0 && <div className="timeline-loading">Loading versions...</div>}
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
