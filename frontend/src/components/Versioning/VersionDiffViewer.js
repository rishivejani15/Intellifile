import React from 'react';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import { useEffect } from 'react';
import 'react-diff-view/style/index.css';
import './versioning.css';

import ReactDOM from 'react-dom';
const VersionDiffViewer = ({ diffText, versionA, versionB, onClose }) => {
     useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    if (!diffText) return null;

    const files = typeof diffText === 'string' ? parseDiff(diffText) : [];

    return ReactDOM.createPortal(
        (
        <div className="diff-viewer-overlay">
            <div className="diff-viewer-container">
                <div className="diff-header">
                    <div className="diff-info">
                        <h3>Version Comparison</h3>
                        <p>Comparing <strong>{versionA}</strong> vs <strong>{versionB}</strong></p>
                    </div>
                    <button className="btn-close" onClick={onClose}>×</button>
                </div>

                <div className="diff-content">
                    {/* Check if it's a structured diff (Word/Excel) */}
                    {diffText && typeof diffText === 'object' && diffText.is_structured ? (
                        <div className="structured-diff">
                            {diffText.format === 'word' && (
                                <div className="word-diff">
                                    <h4>Word Document Changes</h4>
                                    <div className="diff-stats">
                                        <div className="stat-item added">+{diffText.para_diff?.filter(p => p.type === 'added').length || 0} Added</div>
                                        <div className="stat-item removed">-{diffText.para_diff?.filter(p => p.type === 'removed').length || 0} Removed</div>
                                        <div className="stat-item headings">{diffText.added_headings?.length || 0} New Headings</div>
                                        <div className={`stat-item tables ${diffText.table_delta < 0 ? 'removed' : 'added'}`}>
                                            {diffText.table_delta !== 0 ? `${diffText.table_delta > 0 ? '+' : ''}${diffText.table_delta} Tables` : 'No table changes'}
                                        </div>
                                        {diffText.image_stats && (diffText.image_stats.added > 0 || diffText.image_stats.removed > 0 || diffText.image_stats.modified > 0) && (
                                            <div className="stat-item images">
                                                🖼️ {diffText.image_stats.added > 0 ? `+${diffText.image_stats.added} ` : ''}
                                                {diffText.image_stats.removed > 0 ? `-${diffText.image_stats.removed} ` : ''}
                                                {diffText.image_stats.modified > 0 ? `~${diffText.image_stats.modified} ` : ''}
                                                Images
                                            </div>
                                        )}
                                    </div>
                                    <div className="diff-details scrollable">
                                        <h5>Document Flow:</h5>
                                        <div className="para-list">
                                            {diffText.para_diff?.map((p, idx) => {
                                                const isImage = p.element_type === 'image' || Boolean(p.image?.data_url || p.data_url || p.old_image?.data_url);
                                                if (isImage) {
                                                    if (p.type === 'modified') {
                                                        return (
                                                            <div key={idx} className="para-item line-modified diff-image-comparison">
                                                                <div className="diff-image-card old-image">
                                                                    <div className="diff-image-badge removed">Previous Image</div>
                                                                    {p.old_image?.data_url ? (
                                                                        <img src={p.old_image.data_url} alt="Previous graphic" className="diff-img" />
                                                                    ) : (
                                                                        <div className="diff-img-placeholder">[Previous Image: {p.old_image?.image_name || 'graphic'}]</div>
                                                                    )}
                                                                </div>
                                                                <div className="diff-image-arrow">➔</div>
                                                                <div className="diff-image-card new-image">
                                                                    <div className="diff-image-badge added">Updated Image</div>
                                                                    {p.new_image?.data_url ? (
                                                                        <img src={p.new_image.data_url} alt="Updated graphic" className="diff-img" />
                                                                    ) : (
                                                                        <div className="diff-img-placeholder">[Updated Image: {p.new_image?.image_name || 'graphic'}]</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    if (p.type === 'added') {
                                                        return (
                                                            <div key={idx} className="para-item line-added diff-image-block">
                                                                <div className="diff-image-badge added">+ Image Added</div>
                                                                {p.image?.data_url || p.data_url ? (
                                                                    <img src={p.image?.data_url || p.data_url} alt="Added graphic" className="diff-img" />
                                                                ) : (
                                                                    <div className="diff-img-placeholder">[Image Added: {p.image?.image_name || 'graphic'}]</div>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    if (p.type === 'removed') {
                                                        return (
                                                            <div key={idx} className="para-item line-removed diff-image-block">
                                                                <div className="diff-image-badge removed">- Image Removed</div>
                                                                {p.image?.data_url || p.data_url ? (
                                                                    <img src={p.image?.data_url || p.data_url} alt="Removed graphic" className="diff-img" />
                                                                ) : (
                                                                    <div className="diff-img-placeholder">[Image Removed: {p.image?.image_name || 'graphic'}]</div>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div key={idx} className="para-item line-equal diff-image-block">
                                                            {p.image?.data_url || p.data_url ? (
                                                                <img src={p.image?.data_url || p.data_url} alt="Document graphic" className="diff-img diff-img-equal" />
                                                            ) : (
                                                                <div className="diff-img-placeholder">[IMAGE: {p.image?.image_name || 'graphic'}]</div>
                                                            )}
                                                        </div>
                                                    );
                                                }
                                                if (p.type === 'modified') {
                                                    return (
                                                        <div key={idx} className="para-item line-modified">
                                                            <span className="diff-old">{p.old_text}</span>
                                                            <span className="diff-arrow">→</span>
                                                            <span className="diff-new">{p.new_text}</span>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div key={idx} className={`para-item ${p.type === 'added' ? 'line-added' : p.type === 'removed' ? 'line-removed' : 'line-equal'}`}>
                                                        {p.text}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {diffText.added_headings?.length > 0 && (
                                        <div className="detail-section">
                                            <h5>Added Headings:</h5>
                                            <ul>{diffText.added_headings.map((h, idx) => <li key={idx} className="line-added">{h}</li>)}</ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {diffText.format === 'excel' && (
                                <div className="excel-diff">
                                    <h4>Excel Spreadsheet Changes</h4>
                                    <div className="diff-stats">
                                        <div className="stat-item changed">{diffText.changed_cells_count || 0} Cells Modified</div>
                                        <div className="stat-item formulas">{diffText.formula_changes || 0} Formulas Changed</div>
                                        <div className="stat-item sheets-added">{diffText.added_sheets?.length || 0} Sheets Added</div>
                                        <div className="stat-item sheets-removed">{diffText.removed_sheets?.length || 0} Sheets Removed</div>
                                    </div>

                                    {diffText.changed_cells?.length > 0 && (
                                        <div className="detail-section scrollable">
                                            <h5>Cell Modifications:</h5>
                                            <table className="excel-diff-table">
                                                <thead>
                                                    <tr>
                                                        <th>Sheet</th>
                                                        <th>Cell</th>
                                                        <th>Old Value</th>
                                                        <th>New Value</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {diffText.changed_cells.map((change, idx) => (
                                                        <tr key={idx}>
                                                            <td>{change.sheet}</td>
                                                            <td className="cell-coord">{change.cell}</td>
                                                            <td className="val-old">{change.old_value}</td>
                                                            <td className="val-new">{change.new_value}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {diffText.removed_sheets?.length > 0 && (
                                        <div className="detail-section warning">
                                            <h5>⚠️ Sheets Deleted:</h5>
                                            <ul>{diffText.removed_sheets.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Standard Text Diff */
                        files.map(({ oldPath, newPath, hunks }, i) => (
                            <Diff key={i} viewType="split" hunks={hunks}>
                                {hunks => hunks.map(hunk => (
                                    <Hunk key={hunk.content} hunk={hunk} />
                                ))}
                            </Diff>
                        ))
                    )}
                </div>

                <div className="diff-footer">
                    <button className="btn-close-modal" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    ), document.body);
};

export default VersionDiffViewer;
