export async function searchFiles(query) {
    const response = await window.intellifile.search(query);
    return response.results || [];
}

export async function indexDevice() {
    const response = await window.intellifile.indexDevice();
    return response;
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