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
  cancelDownloadNative: async (videoId) => {
    return await ipcRenderer.invoke('cancel-download-native', videoId);
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
  scanLocalMusicFiles: async (customDirs) => {
    return await ipcRenderer.invoke('scan-local-music-files', customDirs);
  },
  getLocalMusicFolders: async () => {
    return await ipcRenderer.invoke('get-local-music-folders');
  },
  addLocalMusicFolder: async () => {
    return await ipcRenderer.invoke('add-local-music-folder');
  },
  removeLocalMusicFolder: async (dir) => {
    return await ipcRenderer.invoke('remove-local-music-folder', dir);
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
  },
  playYouTubeTrack: async (videoId, startTime = 0, volume = 1) => {
    return await ipcRenderer.invoke('play-yt-track', { videoId, startTime, volume });
  },
  pauseYouTubeTrack: async () => {
    return await ipcRenderer.invoke('pause-yt-track');
  },
  resumeYouTubeTrack: async (volume) => {
    return await ipcRenderer.invoke('resume-yt-track', volume);
  },
  seekYouTubeTrack: async (seconds) => {
    return await ipcRenderer.invoke('seek-yt-track', seconds);
  },
  setYouTubeVolume: async (volume) => {
    return await ipcRenderer.invoke('set-yt-volume', volume);
  },
  stopYouTubeTrack: async () => {
    return await ipcRenderer.invoke('stop-yt-track');
  },
  onYouTubeStateUpdate: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('yt-player-state-update', listener);
    return () => ipcRenderer.removeListener('yt-player-state-update', listener);
  },
  onBgAudioFFT: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('bg-audio-fft-event', listener);
    return () => ipcRenderer.removeListener('bg-audio-fft-event', listener);
  },
  openYoutubeSignIn: async () => {
    return await ipcRenderer.invoke('open-youtube-signin');
  },
  signOutYoutube: async () => {
    return await ipcRenderer.invoke('sign-out-youtube');
  },
  getYoutubeAuthState: async () => {
    return await ipcRenderer.invoke('get-youtube-auth-state');
  },
  onYoutubeAuthStateChanged: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('youtube-auth-state-changed', listener);
    return () => ipcRenderer.removeListener('youtube-auth-state-changed', listener);
  }
});

