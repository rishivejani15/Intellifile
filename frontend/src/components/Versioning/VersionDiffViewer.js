import React, { useEffect } from 'react';
import { parseDiff, Diff, Hunk, Header } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import './versioning.css';

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

    return (
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
                                    </div>
                                    <div className="diff-details scrollable">
                                        <h5>Document Flow:</h5>
                                        <div className="para-list">
                                            {diffText.para_diff?.map((p, idx) => (
                                                <div key={idx} className={`para-item ${p.type === 'added' ? 'line-added' : p.type === 'removed' ? 'line-removed' : 'line-equal'}`}>
                                                    {p.text || <em className="empty-para">(Empty paragraph)</em>}
                                                </div>
                                            ))}
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
                                                            <td className="val-old">{change.old_value ?? <em className="null-val">empty</em>}</td>
                                                            <td className="val-new">{change.new_value ?? <em className="null-val">empty</em>}</td>
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
    );
};

export default VersionDiffViewer;
