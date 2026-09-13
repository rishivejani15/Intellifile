export const FILE_TYPE_CONFIG = {
  all: { label: 'Any type', extensions: [] },
  pdf: { label: 'PDF Documents (.pdf)', extensions: ['.pdf'] },
  documents: {
    label: 'Documents (.docx, .doc, .txt, .pdf, .md)',
    extensions: ['.pdf', '.docx', '.doc', '.txt', '.md', '.rtf', '.odt'],
  },
  images: {
    label: 'Images (.png, .jpg, .svg, .webp)',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'],
  },
  spreadsheets: {
    label: 'Spreadsheets (.xlsx, .csv, .xls)',
    extensions: ['.xlsx', '.xls', '.csv', '.ods'],
  },
  presentations: {
    label: 'Presentations (.pptx, .ppt)',
    extensions: ['.pptx', '.ppt', '.odp'],
  },
  code: {
    label: 'Code & Scripts (.js, .py, .json, .ts...)',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.html', '.css', '.json', '.xml', '.sql', '.sh', '.bat'],
  },
  audio: {
    label: 'Audio (.mp3, .wav, .flac)',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
  },
  video: {
    label: 'Video (.mp4, .mkv, .mov)',
    extensions: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm'],
  },
  archives: {
    label: 'Archives (.zip, .rar, .7z)',
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'],
  },
  custom: { label: 'Custom extension...', extensions: [] },
};

export const DATE_PRESETS = [
  { id: 'all', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'past7', label: 'Past 7 days' },
  { id: 'past30', label: 'Past 30 days' },
  { id: 'this_year', label: 'This year' },
  { id: 'custom', label: 'Custom range' },
];

export function convertFiltersToSearchPayload(filters, currentPath) {
  if (!filters) {
    return { extensions: null, dateFrom: null, dateTo: null, folderScope: null };
  }

  // 1. Resolve extensions
  let extensions = null;
  if (filters.fileType === 'custom' && filters.customExtension) {
    let ext = filters.customExtension.trim().toLowerCase();
    if (ext) {
      if (!ext.startsWith('.')) ext = '.' + ext;
      extensions = [ext];
    }
  } else if (filters.fileType && filters.fileType !== 'all') {
    const config = FILE_TYPE_CONFIG[filters.fileType];
    if (config && config.extensions.length > 0) {
      extensions = config.extensions;
    }
  }

  // 2. Resolve dates (seconds timestamp)
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const tomorrowMidnight = todayMidnight + 86400;

  let dateFrom = null;
  let dateTo = null;

  if (filters.datePreset === 'today') {
    dateFrom = todayMidnight;
    dateTo = tomorrowMidnight;
  } else if (filters.datePreset === 'past7') {
    dateFrom = todayMidnight - 7 * 86400;
    dateTo = tomorrowMidnight;
  } else if (filters.datePreset === 'past30') {
    dateFrom = todayMidnight - 30 * 86400;
    dateTo = tomorrowMidnight;
  } else if (filters.datePreset === 'this_year') {
    dateFrom = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
    dateTo = tomorrowMidnight;
  } else if (filters.datePreset === 'custom' || filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) {
      const parts = filters.dateFrom.split('-');
      if (parts.length === 3) {
        dateFrom = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime() / 1000;
      }
    }
    if (filters.dateTo) {
      const parts = filters.dateTo.split('-');
      if (parts.length === 3) {
        dateTo = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime() / 1000 + 86400;
      }
    }
  }

  // 3. Resolve folder scope
  let folderScope = null;
  if (filters.folderScope === 'current') {
    folderScope = currentPath && currentPath.toLowerCase() !== 'home' ? currentPath : null;
  } else if (filters.folderScope === 'specific' && filters.specificFolder) {
    folderScope = filters.specificFolder;
  }

  return {
    extensions,
    dateFrom,
    dateTo,
    folderScope,
  };
}

export function getDefaultFilters(currentPath) {
  const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
  return {
    fileType: 'all',
    customExtension: '',
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    folderScope: isHome ? 'entire' : 'current',
    specificFolder: '',
  };
}

export function hasSearchableFilters(filters) {
  if (!filters) return false;
  if (filters.fileType && filters.fileType !== 'all') return true;
  if (filters.datePreset && filters.datePreset !== 'all') return true;
  if (Boolean(filters.dateFrom || filters.dateTo)) return true;
  if (filters.folderScope === 'specific' && Boolean(filters.specificFolder)) return true;
  return false;
}

export function hasActiveFilters(filters, currentPath = null) {
  if (!filters) return false;
  if (filters.fileType && filters.fileType !== 'all') return true;
  if (filters.datePreset && filters.datePreset !== 'all') return true;
  if (filters.dateFrom || filters.dateTo) return true;
  if (filters.folderScope === 'specific' && filters.specificFolder) return true;

  if (currentPath !== null && currentPath !== undefined) {
    const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
    if (!isHome && filters.folderScope === 'entire') return true;
    if (isHome && filters.folderScope === 'current') return true;
  } else {
    if (filters.folderScope === 'current') return true;
  }
  return false;
}

export function getActiveFilterChips(filters, currentPath = null) {
  if (!filters) return [];
  const chips = [];

  // 1. File Type
  if (filters.fileType && filters.fileType !== 'all') {
    if (filters.fileType === 'custom') {
      const ext = filters.customExtension ? `.${filters.customExtension.replace(/^\./, '')}` : 'Custom';
      chips.push({
        key: 'fileType',
        label: `Type: ${ext}`,
        type: 'fileType',
      });
    } else if (FILE_TYPE_CONFIG[filters.fileType]) {
      chips.push({
        key: 'fileType',
        label: `Type: ${FILE_TYPE_CONFIG[filters.fileType].label.split(' ')[0]}`,
        type: 'fileType',
      });
    }
  }

  // 2. Date
  if (filters.datePreset && filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
    const presetObj = DATE_PRESETS.find((p) => p.id === filters.datePreset);
    chips.push({
      key: 'date',
      label: `Date: ${presetObj?.label || filters.datePreset}`,
      type: 'date',
    });
  } else if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom || '...';
    const to = filters.dateTo || '...';
    chips.push({
      key: 'date',
      label: `Date: ${from} – ${to}`,
      type: 'date',
    });
  }

  // 3. Folder scope
  const isHome = !currentPath || String(currentPath).toLowerCase() === 'home';
  if (filters.folderScope === 'specific' && filters.specificFolder) {
    const folderName = filters.specificFolder.split('\\').pop() || filters.specificFolder.split('/').pop() || filters.specificFolder;
    chips.push({
      key: 'folderScope',
      label: `In: ${folderName}`,
      type: 'folderScope',
    });
  } else if (!isHome && filters.folderScope === 'entire') {
    chips.push({
      key: 'folderScope',
      label: 'In: Entire Computer',
      type: 'folderScope',
    });
  } else if (isHome && filters.folderScope === 'current') {
    chips.push({
      key: 'folderScope',
      label: 'In: Home only',
      type: 'folderScope',
    });
  }

  return chips;
}

