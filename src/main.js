const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const { convert, targetsFor, findSoffice } = require('./converters');

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

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('targets', (_e, filePath) => targetsFor(path.extname(filePath).slice(1)));
ipcMain.handle('has-libreoffice', () => !!findSoffice());
const defaultOut = () => path.join(app.getPath('documents'), 'Moralify');
ipcMain.handle('default-out', () => defaultOut());
ipcMain.handle('open-folder', async (_e, dir) => {
  require('fs').mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('convert', async (e, { id, input, format, outDir }) => {
  const dir = outDir || defaultOut();
  const base = path.basename(input, path.extname(input));
  let output = path.join(dir, `${base}.${format}`);
  // Never overwrite the source or an existing file.
  for (let n = 1; require('fs').existsSync(output); n++) output = path.join(dir, `${base} (${n}).${format}`);
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

ipcMain.on('cancel', (_e, id) => {
  const job = jobs.get(id);
  if (job) {
    job.cancelled = true;
    if (job.kill) job.kill();
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
