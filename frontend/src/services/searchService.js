import { parseFolderSearchQuery } from '../utils/folderSearchParser';

export async function searchFiles(query, rootFolder = null, options = {}) {
    const trimmed = (query || '').trim();
    const folderInfo = options?.folderName ? { folderName: options.folderName } : parseFolderSearchQuery(query);
    const hasExtensions = Array.isArray(options?.extensions) && options.extensions.length > 0;
    const hasDate = (options?.dateFrom !== undefined && options?.dateFrom !== null) ||
                    (options?.dateTo !== undefined && options?.dateTo !== null);
    const hasFolder = Boolean(folderInfo?.folderName);

    if (!trimmed && !hasExtensions && !hasDate && !hasFolder) {
        return [];
    }

    const effectiveRoot = options?.rootFolder !== undefined ? options.rootFolder : (options?.folderScope !== undefined ? options.folderScope : rootFolder);
    const payload = {
        query: trimmed,
        folder_name: folderInfo ? folderInfo.folderName : null,
        folderName: folderInfo ? folderInfo.folderName : null,
        rootFolder: effectiveRoot || null,
        extensions: hasExtensions ? options.extensions : null,
        date_from: options?.dateFrom !== undefined ? options.dateFrom : null,
        date_to: options?.dateTo !== undefined ? options.dateTo : null,
        dateFrom: options?.dateFrom !== undefined ? options.dateFrom : null,
        dateTo: options?.dateTo !== undefined ? options.dateTo : null,
    };
    const response = await window.intellifile.search(payload);
    return response?.results || [];
}

export async function selectDirectory() {
    if (window.intellifile?.selectFolder) {
        return window.intellifile.selectFolder();
    }
    if (window.electron?.ipcRenderer) {
        return window.electron.ipcRenderer.invoke('dialog:select-folder');
    }
    return null;
}

export async function indexDevice(options = {}) {
    const response = await window.intellifile.indexDevice(options);
    return response;
}

export async function indexFolder(folderPath) {
    if (window.intellifile?.indexFolder) {
        return window.intellifile.indexFolder(folderPath);
    }
    return indexDevice();
}

export async function getSearchStatus() {
    const response = await window.intellifile.searchStatus();
    return response;
}

/**
 * Subscribe to real-time indexing progress.
 * Returns an unsubscribe function.
 */
export function onIndexProgress(callback) {
    if (window.intellifile?.onIndexProgress) {
        return window.intellifile.onIndexProgress(callback);
    }
    return () => {};
}

/**
 * Subscribe to indexing completion events.
 * Returns an unsubscribe function.
 */
export function onIndexComplete(callback) {
    if (window.intellifile?.onIndexComplete) {
        return window.intellifile.onIndexComplete(callback);
    }
    return () => {};
}