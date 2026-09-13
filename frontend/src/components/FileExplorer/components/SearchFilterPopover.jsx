import React, { useState, useEffect, useRef } from 'react';
import {
  MdClose,
  MdFolderOpen,
  MdOutlineCalendarMonth,
  MdOutlineDateRange,
  MdOutlineDescription,
  MdSearch,
  MdRefresh,
  MdTune,
} from 'react-icons/md';
import { selectDirectory } from '../../../services/searchService';
import {
  FILE_TYPE_CONFIG,
  DATE_PRESETS,
  convertFiltersToSearchPayload,
  getDefaultFilters,
  hasActiveFilters,
  hasSearchableFilters,
  getActiveFilterChips,
} from '../../../utils/searchFiltersHelper';

export {
  FILE_TYPE_CONFIG,
  DATE_PRESETS,
  convertFiltersToSearchPayload,
  getDefaultFilters,
  hasActiveFilters,
  hasSearchableFilters,
  getActiveFilterChips,
};

function formatDateDisplay(isoDate) {
  if (!isoDate) return 'dd-mm-yyyy';
  const parts = String(isoDate).split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

const SearchFilterPopover = React.memo(function SearchFilterPopover({
  filters,
  currentPath,
  currentFolders,
  onApply,
  onReset,
  onClose,
}) {
  const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
  const defaultScope = isHome ? 'entire' : 'current';

  const [draft, setDraft] = useState(() => ({
    fileType: filters?.fileType || 'all',
    customExtension: filters?.customExtension || '',
    datePreset: filters?.datePreset || 'all',
    dateFrom: filters?.dateFrom || '',
    dateTo: filters?.dateTo || '',
    folderScope: filters?.folderScope || defaultScope,
    specificFolder: filters?.specificFolder || '',
  }));

  useEffect(() => {
    setDraft({
      fileType: filters?.fileType || 'all',
      customExtension: filters?.customExtension || '',
      datePreset: filters?.datePreset || 'all',
      dateFrom: filters?.dateFrom || '',
      dateTo: filters?.dateTo || '',
      folderScope: filters?.folderScope || defaultScope,
      specificFolder: filters?.specificFolder || '',
    });
  }, [filters, defaultScope]);

  const [discoveredFolders, setDiscoveredFolders] = useState(() => currentFolders || []);

  useEffect(() => {
    if (currentFolders && currentFolders.length > 0) {
      setDiscoveredFolders(currentFolders);
      return;
    }
    if (currentPath && currentPath.toLowerCase() !== 'home' && window.electron?.listDirectory) {
      let isMounted = true;
      window.electron.listDirectory(currentPath).then((res) => {
        if (isMounted && res?.items) {
          const dirs = res.items.filter((i) => (i.type === 'folder' || i.isDirectory) && !i.protected);
          setDiscoveredFolders(dirs);
        }
      }).catch((e) => console.warn('Failed to dynamically list folders:', e));
      return () => { isMounted = false; };
    } else {
      setDiscoveredFolders([]);
    }
  }, [currentPath, currentFolders]);

  const popoverRef = useRef(null);
  const dateFromInputRef = useRef(null);
  const dateToInputRef = useRef(null);

  const openDatePicker = (inputRef) => {
    if (inputRef?.current) {
      try {
        if (typeof inputRef.current.showPicker === 'function') {
          inputRef.current.showPicker();
        } else {
          inputRef.current.focus();
        }
      } catch (err) {
        try {
          inputRef.current.focus();
        } catch (_) {}
      }
    }
  };

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const handleClickOutside = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        !e.target.closest?.('.search-filter-btn')
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handlePickFolder = async () => {
    try {
      const selected = await selectDirectory();
      if (selected) {
        setDraft((prev) => ({
          ...prev,
          folderScope: 'specific',
          specificFolder: selected,
        }));
      }
    } catch (err) {
      console.warn('Folder selection dialog failed:', err);
    }
  };

  const handleApply = (e) => {
    e?.preventDefault();
    onApply(draft);
  };

  const handleReset = (e) => {
    e?.preventDefault();
    const blank = getDefaultFilters(currentPath);
    setDraft(blank);
    onReset(blank);
  };

  const isCurrentFolderAvailable = currentPath && currentPath.toLowerCase() !== 'home';
  const currentFolderDisplayName = currentPath
    ? currentPath.split('\\').pop() || currentPath.split('/').pop() || currentPath
    : 'Home';

  const getSelectedScopeValue = () => {
    if (draft.folderScope === 'entire') return 'entire';
    if (draft.folderScope === 'current') return 'current';
    if (draft.folderScope === 'specific') {
      if (draft.specificFolder && discoveredFolders.some((f) => f.path === draft.specificFolder)) {
        return `subfolder:${draft.specificFolder}`;
      }
      return 'specific';
    }
    return defaultScope;
  };

  const handleScopeSelectChange = (e) => {
    const val = e.target.value;
    if (val === 'entire') {
      setDraft((prev) => ({ ...prev, folderScope: 'entire', specificFolder: '' }));
    } else if (val === 'current') {
      setDraft((prev) => ({ ...prev, folderScope: 'current', specificFolder: '' }));
    } else if (val.startsWith('subfolder:')) {
      const subPath = val.slice('subfolder:'.length);
      setDraft((prev) => ({ ...prev, folderScope: 'specific', specificFolder: subPath }));
    } else if (val === 'specific') {
      setDraft((prev) => ({ ...prev, folderScope: 'specific' }));
    }
  };

  const isFilterModified = hasActiveFilters(draft, currentPath);

  return (
    <div className="search-filter-popover" ref={popoverRef}>
      <div className="filter-popover-header">
        <div className="filter-popover-title">
          <div className="filter-title-icon-badge">
            <MdTune className="filter-header-icon" />
          </div>
          <span className="filter-title-text">Search Filters</span>
          {isFilterModified && (
            <span className="filter-active-pill">Custom active</span>
          )}
        </div>
        <button
          type="button"
          className="filter-close-btn"
          onClick={onClose}
          title="Close filter panel"
          aria-label="Close"
        >
          <MdClose />
        </button>
      </div>

      <form onSubmit={handleApply} className="filter-popover-body">
        {/* 1. File Type Selection */}
        <div className="filter-group">
          <div className="filter-group-header">
            <label className="filter-label" htmlFor="filter-file-type">
              <MdOutlineDescription className="filter-icon-inline" /> File type
            </label>
          </div>
          <div className="filter-control">
            <select
              id="filter-file-type"
              className="filter-select"
              value={draft.fileType}
              onChange={(e) => setDraft({ ...draft, fileType: e.target.value })}
            >
              {Object.entries(FILE_TYPE_CONFIG).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
            {draft.fileType === 'custom' && (
              <div className="filter-custom-ext-wrapper">
                <span className="filter-custom-ext-prefix">.</span>
                <input
                  type="text"
                  className="filter-input-custom-ext"
                  placeholder="log, json, py..."
                  value={draft.customExtension.replace(/^\./, '')}
                  onChange={(e) => setDraft({ ...draft, customExtension: e.target.value.trim() })}
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>

        {/* 2. Date Range Selection */}
        <div className="filter-group">
          <div className="filter-group-header">
            <label className="filter-label">
              <MdOutlineDateRange className="filter-icon-inline" /> Date modified
            </label>
          </div>
          <div className="filter-control date-control-group">
            <select
              className="filter-select"
              value={draft.datePreset}
              onChange={(e) => setDraft({ ...draft, datePreset: e.target.value })}
            >
              {DATE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>

            <div className="filter-date-inputs">
              <div
                className="date-input-field"
                onClick={() => openDatePicker(dateFromInputRef)}
              >
                <span className="date-sublabel">From</span>
                <div className="date-input-row">
                  <span className={`date-display-text ${draft.dateFrom ? 'has-value' : 'is-placeholder'}`}>
                    {formatDateDisplay(draft.dateFrom)}
                  </span>
                  <div className="date-actions-inline">
                    {draft.dateFrom && (
                      <button
                        type="button"
                        className="date-clear-single-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraft({ ...draft, dateFrom: '', datePreset: 'custom' });
                        }}
                        title="Clear from date"
                        aria-label="Clear from date"
                      >
                        <MdClose />
                      </button>
                    )}
                    <MdOutlineCalendarMonth className="date-field-calendar-icon" />
                  </div>
                  <input
                    ref={dateFromInputRef}
                    id="filter-date-from"
                    type="date"
                    className="filter-date-native-input"
                    value={draft.dateFrom}
                    tabIndex={0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        dateFrom: e.target.value,
                        datePreset: 'custom',
                      })
                    }
                  />
                </div>
              </div>
              <div
                className="date-input-field"
                onClick={() => openDatePicker(dateToInputRef)}
              >
                <span className="date-sublabel">To</span>
                <div className="date-input-row">
                  <span className={`date-display-text ${draft.dateTo ? 'has-value' : 'is-placeholder'}`}>
                    {formatDateDisplay(draft.dateTo)}
                  </span>
                  <div className="date-actions-inline">
                    {draft.dateTo && (
                      <button
                        type="button"
                        className="date-clear-single-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraft({ ...draft, dateTo: '', datePreset: 'custom' });
                        }}
                        title="Clear to date"
                        aria-label="Clear to date"
                      >
                        <MdClose />
                      </button>
                    )}
                    <MdOutlineCalendarMonth className="date-field-calendar-icon" />
                  </div>
                  <input
                    ref={dateToInputRef}
                    id="filter-date-to"
                    type="date"
                    className="filter-date-native-input"
                    value={draft.dateTo}
                    tabIndex={0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        dateTo: e.target.value,
                        datePreset: 'custom',
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Folder Scope Selection */}
        <div className="filter-group">
          <div className="filter-group-header">
            <label className="filter-label" htmlFor="filter-folder-scope">
              <MdFolderOpen className="filter-icon-inline" /> Location
            </label>
          </div>
          <div className="filter-control">
            <select
              id="filter-folder-scope"
              className="filter-select"
              value={getSelectedScopeValue()}
              onChange={handleScopeSelectChange}
            >
              {isCurrentFolderAvailable && (
                <option value="current">
                  📁 Current Folder ({currentFolderDisplayName})
                </option>
              )}
              <option value="entire">🌐 Entire Computer</option>
              {discoveredFolders.length > 0 && (
                <optgroup label={`Subfolders in ${currentFolderDisplayName} (${discoveredFolders.length})`}>
                  {discoveredFolders.map((folder) => (
                    <option key={folder.path} value={`subfolder:${folder.path}`}>
                      📂 {folder.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="specific">🔍 Browse other folder...</option>
            </select>

            {draft.folderScope === 'specific' && (
              <div className="specific-folder-picker">
                <input
                  type="text"
                  className="specific-folder-input"
                  placeholder="Select or paste folder path..."
                  value={draft.specificFolder}
                  onChange={(e) => setDraft({ ...draft, specificFolder: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-browse-folder"
                  onClick={handlePickFolder}
                  title="Browse folder on computer"
                >
                  <MdFolderOpen /> Browse...
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="filter-popover-footer">
          <button
            type="button"
            className="filter-btn-reset"
            onClick={handleReset}
            title="Reset filters to default"
          >
            <MdRefresh /> Reset
          </button>
          <button
            type="submit"
            className="filter-btn-apply"
            title="Search with active filters"
          >
            <MdSearch /> Apply &amp; Search
          </button>
        </div>
      </form>
    </div>
  );
});

export default SearchFilterPopover;
