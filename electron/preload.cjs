const { contextBridge, ipcRenderer } = require('electron');

let localProxyPort = 0;

ipcRenderer.on('set-proxy-port', (event, port) => {
  localProxyPort = port;
});

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getProxyPort: async () => {
    if (localProxyPort) return localProxyPort;
    return await ipcRenderer.invoke('get-proxy-port');
  },
  extractStreamUrl: async (videoId) => {
    return await ipcRenderer.invoke('extract-stream-url', videoId);
  },
  prefetchStreamUrls: async (videoIds) => {
    return await ipcRenderer.invoke('prefetch-stream-urls', videoIds);
  },
  getDefaultMusicDir: async () => {
    return await ipcRenderer.invoke('get-default-music-dir');
  },
  saveAudioToDisk: async (filename, arrayBuffer, targetDir) => {
    return await ipcRenderer.invoke('save-audio-to-disk', {
      filename,
      buffer: arrayBuffer,
      targetDir
    });
  },
  openFolder: async (folderPath) => {
    return await ipcRenderer.invoke('open-folder', folderPath);
  },
  selectDirectory: async () => {
    return await ipcRenderer.invoke('select-directory');
  },
  showItemInFolder: async (fullPath) => {
    return await ipcRenderer.invoke('show-item-in-folder', fullPath);
  },
  getGeniusLyrics: async (query) => {
    return await ipcRenderer.invoke('get-genius-lyrics', query);
  },
  downloadTrackNative: async (params) => {
    return await ipcRenderer.invoke('download-track-native', params);
  },
  deleteAudioFromDisk: async (params) => {
    return await ipcRenderer.invoke('delete-audio-from-disk', params);
  },
  checkAudioOnDisk: async (params) => {
    return await ipcRenderer.invoke('check-audio-on-disk', params);
  },
  getDiskAudioFiles: async (targetDir) => {
    return await ipcRenderer.invoke('get-disk-audio-files', targetDir);
  },
  onDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-progress-event', listener);
    return () => ipcRenderer.removeListener('download-progress-event', listener);
  },
  onDiskFolderChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('disk-music-folder-changed', listener);
    return () => ipcRenderer.removeListener('disk-music-folder-changed', listener);
  }
});
