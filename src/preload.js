const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pathFor: (file) => webUtils.getPathForFile(file),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFolders: () => ipcRenderer.invoke('pick-folders'),
  inspectPaths: (paths) => ipcRenderer.invoke('inspect-paths', paths),
  convertBatch: (job) => ipcRenderer.invoke('convert-batch', job),
  onBatchProgress: (cb) => ipcRenderer.on('batch-progress', (_e, d) => cb(d)),
  targets: (p) => ipcRenderer.invoke('targets', p),
  isRaw: (p) => ipcRenderer.invoke('is-raw', p),
  hasLibreOffice: () => ipcRenderer.invoke('has-libreoffice'),
  convert: (job) => ipcRenderer.invoke('convert', job),
  cancel: (id) => ipcRenderer.send('cancel', id),
  defaultOut: () => ipcRenderer.invoke('default-out'),
  openFolder: (d) => ipcRenderer.invoke('open-folder', d),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
});
