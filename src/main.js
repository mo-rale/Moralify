const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { convert, targetsFor, findSoffice } = require('./converters');
const { isRaw } = require('./raw');

let win;
const jobs = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5',
    autoHideMenuBar: true,
    center: true,
    title: 'Moralify',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pick-folders', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose folders to convert', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('targets', (_e, filePath) => targetsFor(path.extname(filePath).slice(1)));
ipcMain.handle('is-raw', (_e, filePath) => isRaw(path.extname(filePath).slice(1)));
ipcMain.handle('has-libreoffice', () => !!findSoffice());
const defaultOut = () => path.join(app.getPath('documents'), 'Moralify');
ipcMain.handle('default-out', () => defaultOut());
ipcMain.handle('open-folder', async (_e, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

/** A name that never overwrites an existing file or one already promised to another file in this run. */
function uniqueOutput(dir, base, format, reserved) {
  let output = path.join(dir, `${base}.${format}`);
  for (let n = 1; fs.existsSync(output) || reserved.has(output.toLowerCase()); n++) output = path.join(dir, `${base} (${n}).${format}`);
  reserved.add(output.toLowerCase());
  return output;
}

// ---- folders ----
const MAX_FILES = 20000;
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information']);
const supportedCache = new Map();
const isSupported = (ext) => {
  if (!supportedCache.has(ext)) supportedCache.set(ext, targetsFor(ext).length > 0);
  return supportedCache.get(ext);
};

/** Every file Moralify can convert inside a folder (subfolders included). `rel` always uses "/". */
function scanFolder(root) {
  const files = [];
  let ignored = 0;
  let truncated = false;
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const ent of entries) {
      if (truncated) return;
      if (ent.isSymbolicLink() || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase())) walk(full, r);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).slice(1).toLowerCase();
        if (ext && isSupported(ext)) {
          files.push({ path: full, rel: r, ext });
          if (files.length >= MAX_FILES) truncated = true;
        } else {
          ignored++;
        }
      }
    }
  };
  walk(root, '');
  return { root, name: path.basename(root) || root, files, ignored, truncated };
}

ipcMain.handle('inspect-paths', (_e, paths) => paths.map((p) => {
  try {
    return fs.statSync(p).isDirectory() ? { type: 'dir', ...scanFolder(p) } : { type: 'file', path: p };
  } catch {
    return { type: 'file', path: p };
  }
}));

ipcMain.handle('convert', async (e, { id, input, format, outDir }) => {
  const dir = outDir || defaultOut();
  const base = path.basename(input, path.extname(input));
  // Never overwrite the source or an existing file.
  const output = uniqueOutput(dir, base, format, new Set());
  const signal = { cancelled: false };
  jobs.set(id, signal);
  try {
    await convert({
      input, output, signal,
      onProgress: (p) => e.sender.send('progress', { id, progress: p }),
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    jobs.delete(id);
  }
});

// ---- batch: convert a whole list of files (a folder) into one output folder, keeping the subfolder layout ----
const LIGHT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'ico', 'avif', 'heic'];
ipcMain.handle('convert-batch', async (e, { id, files, format, outDir, rootName }) => {
  const root = path.join(outDir || defaultOut(), String(rootName || 'Converted').replace(/[<>:"/\\|?*]/g, '_'));
  const job = { cancelled: false, kills: new Set(), kill() { this.kills.forEach((k) => k()); } };
  jobs.set(id, job);
  const reserved = new Set();
  const failed = [];
  let done = 0;
  let next = 0;
  // Small pictures convert fast enough to run side by side; everything else one at a time.
  const light = LIGHT.includes(format) && files.every((f) => LIGHT.includes(f.ext));
  const send = () => { try { e.sender.send('batch-progress', { id, done, failed: failed.length, total: files.length }); } catch { /* window closed */ } };

  const worker = async () => {
    while (!job.cancelled) {
      const f = files[next++];
      if (!f) return;
      const signal = { cancelled: false };
      const kill = () => { signal.cancelled = true; if (signal.kill) signal.kill(); };
      job.kills.add(kill);
      try {
        const sub = path.dirname(f.rel.split('/').join(path.sep));
        const dir = sub === '.' ? root : path.join(root, sub);
        const output = uniqueOutput(dir, path.basename(f.path, path.extname(f.path)), format, reserved);
        await convert({ input: f.path, output, signal, onProgress: () => {} });
        done++;
      } catch (err) {
        if (!job.cancelled) failed.push({ path: f.path, error: err.message });
      } finally {
        job.kills.delete(kill);
        send();
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: light ? 3 : 1 }, worker));
    return { ok: true, done, failed, cancelled: job.cancelled, outDir: root };
  } finally {
    jobs.delete(id);
  }
});

ipcMain.on('cancel', (_e, id) => {
  const job = jobs.get(id);
  if (job) {
    job.cancelled = true;
    if (job.kill) job.kill();
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
