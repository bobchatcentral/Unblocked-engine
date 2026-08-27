const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseSaveLocation: (defaultName) => ipcRenderer.invoke('choose-save-location', defaultName),
  startCrawl: (options) => ipcRenderer.invoke('start-crawl', options),
  saveFile: (filePath, contents) => ipcRenderer.invoke('save-file', { filePath, contents }),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  onLog: (callback) => ipcRenderer.on('crawl-log', (_event, msg) => callback(msg)),
});
