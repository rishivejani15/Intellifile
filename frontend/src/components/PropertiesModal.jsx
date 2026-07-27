import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatFileSize, getFileIcon } from '../utils/fileUtils';
import { getVersions, restoreVersion } from '../services/versionService';
import './FileExplorer/FileExplorer.css';

const ipcRenderer = window.electron?.ipcRenderer;

const TAB_DEFS = [
  { id: 'general', label: 'General' },
  { id: 'security', label: 'Security' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'previousVersions', label: 'Previous Versions' },
  { id: 'customize', label: 'Customize' },
  { id: 'location', label: 'Location' },
  { id: 'details', label: 'Details' },
];

function PropertiesModal({ visible, selectedItem, onClose }) {
  const [details, setDetails] = useState(null);
  const [security, setSecurity] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [attributeDraft, setAttributeDraft] = useState({ readOnly: false, hidden: false });
  const [savingAttributes, setSavingAttributes] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const pathParent = useMemo(() => {
    if (!selectedItem?.path) return '';
    const idx = selectedItem.path.lastIndexOf('\\');
    return idx > 0 ? selectedItem.path.slice(0, idx) : selectedItem.path;
  }, [selectedItem?.path]);

  const formatFullDate = (ms) => {
    if (!ms) return '-';
    return new Date(ms).toLocaleString();
  };

  const loadProperties = useCallback(async () => {
    if (!visible || !selectedItem?.path) return;
    setLoading(true);
    setActiveTab('general');
    setLoadingVersions(true);

    try {
      const [detailsResult, securityResult, sharingResult, versionsResult] = await Promise.allSettled([
        ipcRenderer?.invoke('get-file-details', selectedItem.path),
        ipcRenderer?.invoke('get-file-security', selectedItem.path),
        ipcRenderer?.invoke('get-file-sharing-info', selectedItem.path),
        getVersions(selectedItem.path),
      ]);

      const nextDetails = detailsResult.status === 'fulfilled' && detailsResult.value?.success
        ? detailsResult.value.details
        : null;
      const nextSecurity = securityResult.status === 'fulfilled' && securityResult.value?.success
        ? securityResult.value.security
        : null;
      const nextSharing = sharingResult.status === 'fulfilled' && sharingResult.value?.success
        ? sharingResult.value.info
        : null;
      const nextVersionsRaw = versionsResult.status === 'fulfilled' ? versionsResult.value : null;
      const nextVersions = Array.isArray(nextVersionsRaw?.versions)
        ? nextVersionsRaw.versions
        : Array.isArray(nextVersionsRaw?.data)
          ? nextVersionsRaw.data
          : Array.isArray(nextVersionsRaw?.data?.versions)
            ? nextVersionsRaw.data.versions
            : [];

      setDetails(nextDetails);
      setSecurity(nextSecurity);
      setSharing(nextSharing);
      setVersions(nextVersions);
      setAttributeDraft({
        readOnly: !!nextDetails?.isReadOnly,
        hidden: !!nextDetails?.isHidden,
      });
    } catch (error) {
      setDetails(null);
      setSecurity(null);
      setSharing(null);
      setVersions([]);
    } finally {
      setLoading(false);
      setLoadingVersions(false);
    }
  }, [visible, selectedItem?.path]);

  useEffect(() => {
    if (visible && selectedItem?.path) {
      loadProperties();
    } else {
      setDetails(null);
      setSecurity(null);
      setSharing(null);
      setVersions([]);
      setAttributeDraft({ readOnly: false, hidden: false });
    }
  }, [visible, selectedItem?.path, loadProperties]);

  useEffect(() => {
    if (details) {
      setAttributeDraft({
        readOnly: !!details.isReadOnly,
        hidden: !!details.isHidden,
      });
    }
  }, [details]);

  if (!visible || !selectedItem?.path) {
    return null;
  }

  const d = details || {};
  const isFolder = !!d.isDirectory || selectedItem.type === 'folder';
  const currentLocation = pathParent || selectedItem.path;

  const saveAttributes = async () => {
    setSavingAttributes(true);
    try {
      await ipcRenderer?.invoke('set-file-attributes', {
        filePath: selectedItem.path,
        readOnly: attributeDraft.readOnly,
        hidden: attributeDraft.hidden,
      });
      const result = await ipcRenderer?.invoke('get-file-details', selectedItem.path);
      if (result?.success) {
        setDetails(result.details);
      }
    } finally {
      setSavingAttributes(false);
    }
  };

  const openNativeProperties = async () => {
    await ipcRenderer?.invoke('open-native-properties', selectedItem.path);
  };

  const openLocation = async () => {
    await ipcRenderer?.invoke('open-file', currentLocation || selectedItem.path);
  };

  const handleRestoreVersion = async (version) => {
    if (!version?.version_id) return;
    setRestoringVersionId(version.version_id);
    try {
      const result = await restoreVersion(selectedItem.path, version.version_id);
      if (result?.success || result?.ok) {
        await loadProperties();
      }
    } finally {
      setRestoringVersionId(null);
    }
  };

  const renderRow = (label, value) => (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );

  const renderActionButtons = () => (
    <div className="properties-action-row">
      <button className="properties-secondary-btn" onClick={openNativeProperties}>
        Open Windows Properties
      </button>
      <button className="properties-secondary-btn" onClick={openLocation}>
        Open Location
      </button>
    </div>
  );

  return (
    <div className="properties-modal" onClick={onClose}>
      <div className="properties-dialog enhanced properties-dialog--windows" onClick={(e) => e.stopPropagation()}>
        <div className="properties-titlebar">
          <span className="properties-title-icon">{getFileIcon(selectedItem)}</span>
          <span className="properties-title-text">{selectedItem.name} Properties</span>
          <button className="properties-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="properties-tabs">
          {TAB_DEFS.map((tab) => (
            <button
              key={tab.id}
              className={`properties-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="properties-content">
          {loading && <div className="properties-loading">Loading properties...</div>}

          {!loading && activeTab === 'general' && (
            <>
              <div className="properties-icon-row">
                <span className="properties-big-icon">{getFileIcon(selectedItem)}</span>
                <div>
                  <div className="properties-name-edit">{selectedItem.name}</div>
                  <div className="properties-subtitle">{isFolder ? 'File folder' : (d.ext || selectedItem.ext || 'File')}</div>
                </div>
              </div>

              <div className="properties-divider" />

              {renderRow('Type', isFolder ? 'File folder' : (d.ext || selectedItem.ext || 'File'))}
              {renderRow('Location', <span className="detail-value path-value">{currentLocation || '-'}</span>)}
              {renderRow('Size', d.size != null ? `${formatFileSize(d.size)} (${d.size.toLocaleString()} bytes)` : '-')}
              {isFolder && d.itemCount != null && renderRow('Contains', `${d.itemCount} items`)}

              <div className="properties-divider" />

              {renderRow('Created', formatFullDate(d.created))}
              {renderRow('Modified', formatFullDate(d.modified))}
              {renderRow('Accessed', formatFullDate(d.accessed))}

              <div className="properties-divider" />

              <div className="detail-row detail-row--stacked">
                <span className="detail-label">Attributes</span>
                <div className="attribute-editor">
                  <label className="attribute-checkbox">
                    <input
                      type="checkbox"
                      checked={attributeDraft.readOnly}
                      onChange={(e) => setAttributeDraft((prev) => ({ ...prev, readOnly: e.target.checked }))}
                    />
                    Read-only
                  </label>
                  <label className="attribute-checkbox">
                    <input
                      type="checkbox"
                      checked={attributeDraft.hidden}
                      onChange={(e) => setAttributeDraft((prev) => ({ ...prev, hidden: e.target.checked }))}
                    />
                    Hidden
                  </label>
                  <button
                    className="properties-secondary-btn properties-secondary-btn--inline"
                    onClick={saveAttributes}
                    disabled={savingAttributes}
                  >
                    {savingAttributes ? 'Saving...' : 'Apply'}
                  </button>
                </div>
              </div>

              {renderActionButtons()}
            </>
          )}

          {!loading && activeTab === 'security' && (
            <>
              {renderRow('Owner', security?.owner || '-')}
              {renderRow('Group', security?.group || '-')}
              <div className="properties-divider" />
              <div className="properties-section-title">Access control</div>
              <div className="security-table-wrap">
                <table className="security-table">
                  <thead>
                    <tr>
                      <th>Principal</th>
                      <th>Rights</th>
                      <th>Type</th>
                      <th>Inherited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(security?.access || []).length > 0 ? (
                      security.access.map((entry, index) => (
                        <tr key={`${entry.IdentityReference || 'entry'}-${index}`}>
                          <td>{entry.IdentityReference || '-'}</td>
                          <td>{entry.FileSystemRights || '-'}</td>
                          <td>{entry.AccessControlType || '-'}</td>
                          <td>{entry.IsInherited ? 'Yes' : 'No'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" className="security-empty">No ACL entries available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="properties-note">
                Full ACL editing is available in the native Windows Properties dialog.
              </div>
              {renderActionButtons()}
            </>
          )}

          {!loading && activeTab === 'sharing' && (
            <>
              {renderRow('Network path', sharing?.isNetworkPath ? 'Yes' : 'No')}
              {renderRow('Shared name', sharing?.sharedName || '-')}
              {renderRow('Shared path', sharing?.sharedPath || '-')}
              <div className="properties-divider" />
              <div className="properties-section-title">Shares</div>
              {sharing?.shares?.length ? (
                <div className="chip-list">
                  {sharing.shares.map((share) => (
                    <div key={`${share.Name || share.Path}`} className="chip">
                      <strong>{share.Name || 'Share'}</strong>
                      <span>{share.Path || ''}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="properties-note">This item is not currently shared.</div>
              )}
              {renderActionButtons()}
            </>
          )}

          {!loading && activeTab === 'previousVersions' && (
            <>
              <div className="properties-section-title">Versions stored by IntelliFile</div>
              {loadingVersions && <div className="properties-loading">Loading versions...</div>}
              {!loadingVersions && versions.length === 0 && (
                <div className="properties-note">No previous versions were found for this item.</div>
              )}
              <div className="version-list">
                {versions.map((version) => (
                  <div key={version.version_id || version.timestamp} className="version-list-item">
                    <div className="version-list-main">
                      <div className="version-list-title">Version {version.version ?? version.version_id?.slice?.(0, 8) ?? '-'}</div>
                      <div className="version-list-meta">
                        {version.version_id || '-'}
                        {version.summary ? ` • ${version.summary}` : ''}
                      </div>
                    </div>
                    <div className="version-list-actions">
                      <button
                        className="properties-secondary-btn properties-secondary-btn--inline"
                        onClick={() => handleRestoreVersion(version)}
                        disabled={restoringVersionId === version.version_id}
                      >
                        {restoringVersionId === version.version_id ? 'Restoring...' : 'Restore'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!loading && activeTab === 'customize' && (
            <>
              <div className="properties-section-title">Folder customization</div>
              {isFolder ? (
                <>
                  <div className="customize-grid">
                    <div className="customize-card">
                      <div className="customize-card-label">Template</div>
                      <div className="customize-card-value">{selectedItem.name?.toLowerCase().includes('picture') ? 'Pictures' : selectedItem.name?.toLowerCase().includes('music') ? 'Music' : selectedItem.name?.toLowerCase().includes('video') ? 'Videos' : 'General items'}</div>
                    </div>
                    <div className="customize-card">
                      <div className="customize-card-label">Folder icon</div>
                      <div className="customize-card-value">{getFileIcon(selectedItem)}</div>
                    </div>
                  </div>
                  <div className="properties-note">
                    The full customize experience is available in the native Windows Properties dialog.
                  </div>
                </>
              ) : (
                <div className="properties-note">Customize is available for folders only.</div>
              )}
              {renderActionButtons()}
            </>
          )}

          {!loading && activeTab === 'location' && (
            <>
              {renderRow('Current path', <span className="detail-value path-value">{selectedItem.path}</span>)}
              {renderRow('Containing folder', <span className="detail-value path-value">{currentLocation || '-'}</span>)}
              {renderRow('Item name', selectedItem.name || '-')}
              <div className="properties-divider" />
              <div className="properties-note">
                Moving or changing the location of a folder is handled through the filesystem or native Windows dialog.
              </div>
              {renderActionButtons()}
            </>
          )}

          {!loading && activeTab === 'details' && (
            <>
              {renderRow('Name', selectedItem.name)}
              {renderRow('Full Path', <span className="detail-value path-value">{selectedItem.path}</span>)}
              {renderRow('Extension', d.ext || selectedItem.ext || '-')}
              {renderRow('Size (bytes)', d.size != null ? d.size.toLocaleString() : '-')}
              {renderRow('Size (human)', d.size != null ? formatFileSize(d.size) : '-')}
              {d.attributes && renderRow('Win Attributes', d.attributes)}
              {renderRow('Created', formatFullDate(d.created))}
              {renderRow('Modified', formatFullDate(d.modified))}
              {renderRow('Accessed', formatFullDate(d.accessed))}
            </>
          )}
        </div>

        <div className="properties-actions">
          <button className="properties-ok-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

export default PropertiesModal;
