const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { convert, targetsFor, findSoffice, findLibraw, mergeImagesToPdf } = require('./converters');
const { isRaw } = require('./raw');

let win;
const jobs = new Map();

// One window only: "Convert with Moralify" in Explorer starts the app with the file or folder as an argument,
// and a second launch hands its arguments to the window that is already open.
const pathsFromArgs = (argv) => argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && path.resolve(a) !== path.resolve(app.getAppPath()) && fs.existsSync(a));
const sendPaths = (paths) => { if (paths.length && win && !win.isDestroyed()) win.webContents.send('open-paths', paths); };
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    sendPaths(pathsFromArgs(argv));
  });
}

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
  win.webContents.once('did-finish-load', () => sendPaths(pathsFromArgs(process.argv)));
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
ipcMain.handle('has-libraw', () => !!findLibraw());
// Where converted files go by default: a "Moralify" folder inside Documents. Windows can point the Documents
// folder at a place that no longer exists (for example a OneDrive folder that was removed), and then Electron
// throws, so fall back to a real Documents folder in the user's profile, and finally to the profile itself.
const defaultOut = () => {
  const candidates = [];
  try { candidates.push(app.getPath('documents')); } catch { /* Documents is not available */ }
  candidates.push(path.join(os.homedir(), 'Documents'));
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  return path.join(candidates.find(isDir) || os.homedir(), 'Moralify');
};
ipcMain.handle('default-out', () => defaultOut());
ipcMain.handle('open-folder', async (_e, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

/** A name that never overwrites an existing file or one already promised to another file in this run. */
function uniqueOutput(dir, base, format, reserved, asFolder = false) {
  // `asFolder`: the result is a folder named like the output file without its extension (PDF -> pictures)
  const taken = (p) => fs.existsSync(p) || reserved.has(p.toLowerCase()) || (asFolder && fs.existsSync(p.slice(0, -(format.length + 1))));
  let output = path.join(dir, `${base}.${format}`);
  for (let n = 1; taken(output); n++) output = path.join(dir, `${base} (${n}).${format}`);
  reserved.add(output.toLowerCase());
  return output;
}
const PDF_PICTURE = ['png', 'jpg', 'webp'];
const makesFolder = (input, format) => path.extname(input).toLowerCase() === '.pdf' && PDF_PICTURE.includes(format);

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

ipcMain.handle('convert', async (e, { id, input, format, outDir, opts }) => {
  const signal = { cancelled: false };
  jobs.set(id, signal);
  let output;
  try {
    const dir = outDir || defaultOut();
    const base = path.basename(input, path.extname(input));
    // Never overwrite the source or an existing file.
    output = uniqueOutput(dir, base, format, new Set(), makesFolder(input, format));
    const r = await convert({
      input, output, signal, opts,
      onProgress: (p) => e.sender.send('progress', { id, progress: p }),
    });
    return { ok: true, output: (r && r.output) || output, note: r && r.note };
  } catch (err) {
    if (output) fs.rmSync(output, { force: true }); // never leave a half-written file behind
    return { ok: false, error: err.message };
  } finally {
    jobs.delete(id);
  }
});

// ---- batch: convert a whole list of files (a folder) into one output folder, keeping the subfolder layout ----
const LIGHT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'ico', 'avif']; // HEIC and RAW load whole photos in memory: one at a time
ipcMain.handle('convert-batch', async (e, { id, files, format, outDir, rootName, opts }) => {
  const root = path.join(outDir || defaultOut(), String(rootName || 'Converted').replace(/[<>:"/\\|?*]/g, '_'));
  const job = { cancelled: false, kills: new Set(), kill() { this.kills.forEach((k) => k()); } };
  jobs.set(id, job);
  const reserved = new Set();
  const failed = [];
  let done = 0;
  let next = 0;
  // Small pictures convert fast enough to run side by side; everything else one at a time.
  const light = LIGHT.includes(format) && files.every((f) => LIGHT.includes(f.ext));
  const partial = new Map();   // file number -> how far the file being converted has got (0..1)
  const inflight = new Map();  // file number -> its name
  let lastSent = 0;
  const send = (force = true) => {
    const now = Date.now();
    if (!force && now - lastSent < 200) return;
    lastSent = now;
    const part = [...partial.values()].reduce((a, b) => a + b, 0);
    const fraction = Math.min(1, (done + failed.length + part) / files.length);
    const current = [...inflight.values()][0] || '';
    try { e.sender.send('batch-progress', { id, done, failed: failed.length, total: files.length, fraction, current }); } catch { /* window closed */ }
  };

  const worker = async () => {
    while (!job.cancelled) {
      const i = next++;
      const f = files[i];
      if (!f) return;
      const signal = { cancelled: false };
      const kill = () => { signal.cancelled = true; if (signal.kill) signal.kill(); };
      job.kills.add(kill);
      let output;
      try {
        const sub = path.dirname(f.rel.split('/').join(path.sep));
        const dir = sub === '.' ? root : path.join(root, sub);
        output = uniqueOutput(dir, path.basename(f.path, path.extname(f.path)), format, reserved, makesFolder(f.path, format));
        inflight.set(i, path.basename(f.path));
        send();
        await convert({ input: f.path, output, signal, opts, onProgress: (p) => { partial.set(i, p); send(false); } });
        done++;
      } catch (err) {
        if (output) fs.rmSync(output, { force: true });
        if (!job.cancelled) failed.push({ path: f.path, error: err.message });
      } finally {
        partial.delete(i);
        inflight.delete(i);
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

ipcMain.handle('merge-pdf', async (_e, { files, outDir, name, opts }) => {
  const dir = outDir || defaultOut();
  fs.mkdirSync(dir, { recursive: true });
  const output = uniqueOutput(dir, String(name || 'Merged images').replace(/[<>:"/\\|?*]/g, '_'), 'pdf', new Set());
  try {
    const r = await mergeImagesToPdf(files, output, opts || {});
    return { ok: true, output: r.output, note: r.note };
  } catch (err) {
    fs.rmSync(output, { force: true });
    return { ok: false, error: err.message };
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
