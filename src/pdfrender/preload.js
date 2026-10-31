const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfApi', {
  ready: () => ipcRenderer.send('pdf-ready'),
  onJob: (cb) => ipcRenderer.on('pdf-job', (_e, job) => cb(job)),
  page: (p) => ipcRenderer.invoke('pdf-page', p),
  done: (n) => ipcRenderer.send('pdf-done', n),
  fail: (m) => ipcRenderer.send('pdf-fail', m),
});
