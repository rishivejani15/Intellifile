export async function searchFiles(query) {
    const response = await window.intellifile.search(query);
    return response.results || [];
}

export async function indexFolder(folder) {
    const response = await window.intellifile.indexFolder(folder);
    return response;
}

export async function getSearchStatus() {
    const response = await window.intellifile.searchStatus();
    return response;
}