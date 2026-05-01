const ipcRenderer = window.electron?.ipcRenderer;

export const saveVersion = async (filePath, oldContent, newContent) => {
    return await ipcRenderer.invoke('save-version', { filePath, oldContent, newContent });
};

export const getVersions = async (filePath) => {
    return await ipcRenderer.invoke('get-versions', filePath);
};

export const restoreVersion = async (filePath, versionId) => {
    return await ipcRenderer.invoke('restore-version', { filePath, versionId });
};

export const compareVersions = async (filePath, versionA, versionB) => {
    return await ipcRenderer.invoke('compare-versions', { filePath, versionA, versionB });
};

export const saveFile = async (filePath, content) => {
    return await ipcRenderer.invoke('save-file', filePath, content);
};

export const runSmartCleanup = async (filePath) => {
    return await ipcRenderer.invoke('smart-cleanup', filePath);
};
