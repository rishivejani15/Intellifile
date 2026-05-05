export async function searchFiles(query) {
    const response = await window.intellifile.search(query);
    return response.results || [];
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