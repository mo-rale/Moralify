const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const jobs = new Map(); // webContents id -> running job
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  ipcMain.on('pdf-ready', (e) => { const j = jobs.get(e.sender.id); if (j) j.start(); });
  ipcMain.handle('pdf-page', (e, { index, total, buffer }) => {
    const j = jobs.get(e.sender.id);
    if (!j) return;
    const name = `${j.base}-${String(index).padStart(Math.max(3, String(total).length), '0')}.${j.ext}`;
    fs.writeFileSync(path.join(j.folder, name), Buffer.from(buffer));
    j.onProgress(index / total);
  });
  ipcMain.on('pdf-done', (e, n) => { const j = jobs.get(e.sender.id); if (j) j.finish(null, n); });
  ipcMain.on('pdf-fail', (e, m) => { const j = jobs.get(e.sender.id); if (j) j.finish(new Error(m)); });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Render every page of `input` into `folder` as PNG, JPG or WEBP files. Resolves with the page count. */
function renderPdf({ input, folder, ext, quality = 95, maxSize = 0, onProgress = () => {}, signal }) {
  wire();
  return new Promise((resolve, reject) => {
    fs.mkdirSync(folder, { recursive: true });
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    const id = win.webContents.id;
    const job = {
      folder, ext, onProgress, base: path.basename(input, path.extname(input)),
      start: () => win.webContents.send('pdf-job', {
        data: new Uint8Array(fs.readFileSync(input)), mime: MIME[ext], quality: Math.min(1, Math.max(0.05, quality / 100)), scale: 2, maxSize,
      }),
      finish: (err, n) => {
        jobs.delete(id);
        if (!win.isDestroyed()) win.destroy();
        if (err) reject(err); else resolve(n);
      },
    };
    jobs.set(id, job);
    if (signal) signal.kill = () => job.finish(new Error('Cancelled'));
    win.webContents.on('render-process-gone', () => job.finish(new Error('The PDF renderer stopped unexpectedly.')));
    win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => { if (isMainFrame) job.finish(new Error(`The PDF renderer could not start (${desc}).`)); });
    const watchdog = setTimeout(() => job.finish(new Error('The PDF renderer did not start.')), 20000); // never hang forever
    const started = job.start;
    job.start = () => { clearTimeout(watchdog); started(); };
    const finished = job.finish;
    job.finish = (err, n) => { clearTimeout(watchdog); finished(err, n); };
    win.loadFile(path.join(__dirname, 'render.html')).catch((e) => job.finish(e));
  });
}

module.exports = { renderPdf };
