const $ = (id) => document.getElementById(id);
const items = new Map(); // id -> file item { path, ext, targets, format, li, chips, status, bar, supported } or folder item { group: true, ... }
let outDir = null;
let defaultDir = '';
let nextId = 1;
let running = false;
let stopRequested = false;

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const baseName = (p) => p.split(/[\\/]/).pop();
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const NORM = { jpeg: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', oga: 'ogg' };
const norm = (e) => NORM[e] || e;
const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// ---------- picture options (quality / max size), remembered between sessions ----------
const OPT_KEY = 'moralify.pictureOptions';
const SIZES = [0, 3840, 1920, 1280, 800];
let pic = { quality: 95, maxSize: 0, rawMode: 'preview' };
let hasLibraw = false;
try {
  const saved = JSON.parse(localStorage.getItem(OPT_KEY) || '{}');
  if (saved.quality >= 40 && saved.quality <= 100) pic.quality = Math.round(saved.quality);
  if (SIZES.includes(saved.maxSize)) pic.maxSize = saved.maxSize;
  if (saved.rawMode === 'full' || saved.rawMode === 'preview') pic.rawMode = saved.rawMode;
} catch { /* storage unavailable: use the defaults */ }
const picOpts = () => ({ quality: pic.quality, maxSize: pic.maxSize, custom: pic.quality !== 95 || pic.maxSize > 0, rawMode: hasLibraw ? pic.rawMode : 'preview' });
const rawText = () => (hasLibraw && pic.rawMode === 'full'
  ? 'Ready · develops the full RAW data (slower, neutral look)'
  : 'Ready · converts the photo’s built-in preview, not the full RAW data');
function refreshRawStatus() {
  for (const i of items.values()) {
    if (i.group || !i.raw || !i.status.textContent.startsWith('Ready')) continue;
    i.readyText = rawText();
    i.status.textContent = i.readyText;
  }
}
function setPic(next) {
  pic = { ...pic, ...next };
  try { localStorage.setItem(OPT_KEY, JSON.stringify(pic)); } catch { /* ignore */ }
  renderOpts();
  refreshRawStatus();
}
function renderOpts() {
  $('qual').value = pic.quality;
  $('qualVal').textContent = `${pic.quality}%`;
  $('optsSum').textContent = `· Quality ${pic.quality}% · ${pic.maxSize ? `max ${pic.maxSize} px` : 'original size'}`;
  $('rawModes').replaceChildren(...[['preview', 'Camera preview'], ['full', 'Develop']].map(([m, label]) => el('button', { type: 'button', className: 'chip' + (m === pic.rawMode ? ' on' : ''), textContent: label, onclick: () => setPic({ rawMode: m }) })));
  $('sizes').replaceChildren(...SIZES.map((n) => el('button', { type: 'button', className: 'chip' + (n === pic.maxSize ? ' on' : ''), textContent: n ? `${n} px` : 'Original', onclick: () => setPic({ maxSize: n }) })));
}

// ---------- remembered choices: last output folder, and the last format picked for each file type ----------
const FMT_KEY = 'moralify.lastFormats';
const OUT_KEY = 'moralify.outDir';
let lastFormats = {};
try { lastFormats = JSON.parse(localStorage.getItem(FMT_KEY) || '{}') || {}; } catch { lastFormats = {}; }
const remember = (key, value) => { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* ignore */ } };

api.defaultOut().then((d) => {
  defaultDir = d;
  let saved = null;
  try { saved = localStorage.getItem(OUT_KEY); } catch { /* ignore */ }
  outDir = saved || d;
  setOut(outDir);
});
api.onOpenPaths((paths) => addPaths(paths)); // files or folders sent by "Convert with Moralify" in Explorer
api.hasLibreOffice().then((has) => { if (has) $('loNote').textContent = ' Office files work too.'; });

function setOut(dir) {
  $('outLabel').textContent = dir;
  $('outLabel').title = dir;
  $('outReset').hidden = dir === defaultDir;
}


async function addPaths(paths) {
  const found = await api.inspectPaths(paths);
  for (const f of found) {
    if (f.type === 'dir') await addFolder(f);
    else await addFile(f.path);
  }
  refresh();
}

// ---------- single files ----------
async function addFile(p) {
  if ([...items.values()].some((i) => i.path === p)) return;
  const targets = await api.targets(p);
  const id = nextId++;
  const ext = p.split('.').pop().toLowerCase();
  const li = document.createElement('li');

  const num = el('div', { className: 'badge', textContent: ext.slice(0, 4) });
  const info = el('div', { className: 'info' });
  const name = el('div', { className: 'name', textContent: baseName(p), title: p });
  const status = el('div', { className: 'status' });
  info.append(name, status);
  const rm = el('button', { className: 'x', textContent: '×', title: 'Remove' });
  const fmt = el('div', { className: 'fmt' });
  const bar = el('div', { className: 'bar', innerHTML: '<i></i>' });

  const item = { path: p, ext, targets, format: targets.includes(lastFormats[ext]) ? lastFormats[ext] : targets[0], li, chips: [], status, bar: bar.firstChild, supported: targets.length > 0, num };

  if (targets.length) {
    fmt.append(el('span', { className: 'from', textContent: ext }), el('span', { className: 'to', textContent: '→' }));
    for (const t of targets) {
      const chip = el('button', { className: 'chip' + (t === item.format ? ' on' : ''), textContent: t });
      chip.onclick = () => setFormat(item, t);
      item.chips.push(chip);
      fmt.append(chip);
    }
    item.raw = await api.isRaw(p);
    item.readyText = item.raw ? rawText() : 'Ready';
    status.textContent = item.readyText;
  } else {
    status.textContent = `Can't convert .${ext} files`;
    status.classList.add('err');
  }

  rm.onclick = () => { api.cancel(id); items.delete(id); li.remove(); refresh(); };
  li.append(num, info, rm, fmt, bar);
  $('list').append(li);
  items.set(id, item);
}

const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'ico', 'avif', 'heic', 'heif'];
const VIDEO_EXT = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', '3gp'];

function setFormat(item, t, keep = true) {
  item.format = t;
  if (keep) { lastFormats[item.ext] = t; remember(FMT_KEY, lastFormats); }
  if (item.merge) { item.merge = false; item.status.textContent = item.readyText; } // picking a format by hand leaves the merge group
  item.chips.forEach((c) => c.classList.toggle('on', c.textContent === t));
}

// ---------- folders (batch) ----------
const targetCache = new Map();
async function targetsOfExt(ext) {
  if (!targetCache.has(ext)) targetCache.set(ext, await api.targets(`x.${ext}`));
  return targetCache.get(ext);
}

async function addFolder(info) {
  if ([...items.values()].some((i) => i.group && i.root === info.root)) return;
  const id = nextId++;
  const targetsByExt = {};
  for (const f of info.files) { const e = norm(f.ext); if (!targetsByExt[e]) targetsByExt[e] = await targetsOfExt(e); }
  const g = {
    group: true, id, root: info.root, name: info.name, files: info.files, ignored: info.ignored, truncated: info.truncated,
    targetsByExt, include: new Set(Object.keys(targetsByExt)), recursive: true, format: null, supported: info.files.length > 0,
    li: document.createElement('li'),
  };
  g.status = el('div', { className: 'status' });
  g.bar = el('div', { className: 'bar', innerHTML: '<i></i>' });
  g.body = el('div', { className: 'gbody' });
  const rm = el('button', { className: 'x', textContent: '×', title: 'Remove' });
  rm.onclick = () => { api.cancel(id); items.delete(id); g.li.remove(); refresh(); };
  g.li.append(
    el('div', { className: 'badge', innerHTML: FOLDER_ICON }),
    el('div', { className: 'info' }, el('div', { className: 'name', textContent: info.name, title: info.root }), g.status),
    rm, g.body, g.bar,
  );
  $('list').append(g.li);
  items.set(id, g);
  renderGroup(g);
}

// An option changed: the previous result no longer describes what Convert would do now.
function changed(g) {
  g.finished = false;
  g.li.classList.remove('done');
  g.bar.firstChild.style.width = '0';
  renderGroup(g);
  refresh();
}

const inScope = (g) => g.files.filter((f) => g.recursive || !f.rel.includes('/'));

function groupCounts(g) {
  const m = new Map();
  for (const f of inScope(g)) { const e = norm(f.ext); m.set(e, (m.get(e) || 0) + 1); }
  return m;
}

function groupTargets(g, counts) {
  const out = [];
  for (const [e] of counts) if (g.include.has(e)) for (const t of g.targetsByExt[e]) if (!out.includes(t)) out.push(t);
  return out;
}

/** What Convert will do: files turned into the chosen format, and files left alone. */
function groupPlan(g) {
  const todo = [], skipped = [];
  for (const f of inScope(g)) {
    const e = norm(f.ext);
    if (!g.include.has(e)) continue;
    if (e === g.format || !g.targetsByExt[e].includes(g.format)) skipped.push(f); else todo.push(f);
  }
  return { todo, skipped };
}

function renderGroup(g) {
  const counts = groupCounts(g);
  const targets = groupTargets(g, counts);
  if (!targets.includes(g.format)) g.format = targets[0] || null;
  const toggle = (label, on, fn) => el('button', { className: 'chip inc' + (on ? ' on' : ''), textContent: (on ? '✓ ' : '') + label, onclick: fn, disabled: g.running });
  const rows = [];

  const inc = el('div', { className: 'fmt' }, el('span', { className: 'lab', textContent: 'Include' }));
  for (const [e, n] of counts) {
    inc.append(toggle(`${e} ${n.toLocaleString()}`, g.include.has(e), () => { g.include.has(e) ? g.include.delete(e) : g.include.add(e); changed(g); }));
  }
  if (g.files.some((f) => f.rel.includes('/'))) {
    inc.append(toggle('Subfolders', g.recursive, () => { g.recursive = !g.recursive; changed(g); }));
  }
  rows.push(inc);

  if (targets.length) {
    const fmt = el('div', { className: 'fmt' }, el('span', { className: 'lab', textContent: 'Convert to' }));
    for (const t of targets) {
      fmt.append(el('button', { className: 'chip' + (t === g.format ? ' on' : ''), textContent: t, disabled: g.running, onclick: () => { g.format = t; changed(g); } }));
    }
    rows.push(fmt);
  }

  const { todo, skipped } = groupPlan(g);
  const bits = [`${plural(todo.length, 'file')} to convert`];
  if (skipped.length) bits.push(`${skipped.length.toLocaleString()} skipped (already ${g.format ? g.format.toUpperCase() : 'that format'} or can't become it)`);
  if (g.ignored) bits.push(`${plural(g.ignored, 'other file')} ignored`);
  rows.push(el('div', { className: 'sum', textContent: bits.join(' · ') }));
  g.body.replaceChildren(...rows);

  if (!g.running && !g.finished) {
    g.status.className = 'status';
    g.status.textContent = `${plural(inScope(g).length, 'file')} found` + (g.truncated ? ' (stopped at the first 20,000)' : '');
  }
}

// "Set all to" shortcuts: formats every file can become, plus a one-click video -> MP3.
function renderBulk() {
  const bulk = $('bulk');
  bulk.replaceChildren();
  const ok = [...items.values()].filter((i) => !i.group && i.supported);
  const imgs = ok.filter((i) => IMG_EXT.includes(i.ext) || i.raw);
  const videos = ok.filter((i) => VIDEO_EXT.includes(i.ext) && i.targets.includes('mp3'));
  const common = ok.length > 1 ? ok[0].targets.filter((t) => ok.every((i) => i.targets.includes(t))) : [];
  if (!videos.length && !common.length && imgs.length < 2) { bulk.hidden = true; return; }
  const add = (label, onclick, cls = 'chip') => bulk.append(el('button', { className: cls, textContent: label, onclick }));
  if (imgs.length > 1) {
    add(`${imgs.length} images → one PDF`, () => imgs.forEach((i) => { setFormat(i, 'pdf', false); i.merge = true; i.status.textContent = 'Will be merged into one PDF'; }), 'chip shortcut');
  }
  if (videos.length) {
    add(`${videos.length > 1 ? 'All videos' : 'Video'} → MP3`, () => videos.forEach((i) => setFormat(i, 'mp3', false)), 'chip shortcut');
  }
  if (common.length) {
    bulk.append(el('span', { className: 'blabel', textContent: 'Set all to' }));
    common.forEach((t) => add(t, () => ok.forEach((i) => setFormat(i, t, false))));
  }
  bulk.hidden = running;
}

function refresh() {
  renderBulk();
  $('opts').hidden = !items.size;
  const all = [...items.values()];
  const ready = all.reduce((n, i) => n + (i.group ? groupPlan(i).todo.length : (i.supported ? 1 : 0)), 0);
  const folders = all.filter((i) => i.group).length;
  const fileCount = all.reduce((n, i) => n + (i.group ? inScope(i).length : 1), 0);
  $('go').hidden = running;
  $('stop').hidden = !running;
  $('go').disabled = running || !ready;
  $('goN').textContent = ready ? ` ${plural(ready, 'file')}` : '';
  $('clear').disabled = running || !all.length;
  $('empty').classList.toggle('hide', all.length > 0);
  $('count').textContent = all.length ? plural(fileCount, 'file') + (folders ? ` · ${plural(folders, 'folder')}` : '') : '';
}

api.onProgress(({ id, progress }) => {
  const it = items.get(id);
  if (it && !it.group) it.bar.style.width = `${Math.round(progress * 100)}%`;
});

api.onBatchProgress(({ id, done, failed, total }) => {
  const g = items.get(id);
  if (!g) return;
  g.status.textContent = `Converting… ${(done + failed).toLocaleString()} / ${total.toLocaleString()}` + (failed ? ` · ${failed} failed` : '');
  g.bar.firstChild.style.width = `${Math.round(((done + failed) / total) * 100)}%`;
});

async function runFolder(id, g) {
  const { todo } = groupPlan(g);
  if (!todo.length || !g.format) return;
  g.running = true; g.finished = false;
  renderGroup(g);
  g.li.classList.remove('done');
  g.status.className = 'status';
  g.status.textContent = `Converting… 0 / ${todo.length.toLocaleString()}`;
  g.bar.firstChild.style.width = '0';
  const res = await api.convertBatch({ id, files: todo.map((f) => ({ path: f.path, rel: f.rel, ext: f.ext })), format: g.format, outDir, rootName: g.name, opts: picOpts() });
  g.running = false; g.finished = true;
  renderGroup(g);
  const nf = res.failed.length;
  g.status.className = 'status ' + (nf ? 'err' : 'ok');
  g.status.title = res.failed.map((f) => `${baseName(f.path)}: ${f.error}`).join('\n').slice(0, 2000);
  g.status.textContent = (res.cancelled ? 'Stopped · ' : 'Done · ') + `${plural(res.done, 'file')} converted` + (nf ? ` · ${nf} failed (hover for details)` : '');
  if (!nf) g.li.classList.add('done');
  g.bar.firstChild.style.width = res.cancelled ? '0' : '100%';
  g.status.append(el('button', { className: 'link', textContent: 'Open folder', onclick: () => api.openFolder(res.outDir) }));
}

async function runMerge(set) {
  set.forEach((i) => {
    i.chips.forEach((c) => (c.disabled = true));
    i.li.classList.remove('done');
    i.status.className = 'status';
    i.status.textContent = 'Merging…';
    i.bar.style.width = '0';
  });
  const res = await api.mergePdf({ files: set.map((i) => i.path), outDir, name: 'Merged images', opts: picOpts() });
  set.forEach((i) => {
    i.chips.forEach((c) => (c.disabled = false));
    if (res.ok) {
      i.bar.style.width = '100%';
      i.li.classList.add('done');
      i.status.className = 'status ok';
      i.status.textContent = `Merged into ${baseName(res.output)}`;
      i.status.append(el('button', { className: 'link', textContent: 'Show', onclick: () => api.reveal(res.output) }));
    } else {
      i.status.className = 'status err';
      i.status.textContent = res.error;
    }
  });
}

$('stop').onclick = () => {
  stopRequested = true;
  $('stop').disabled = true;
  $('stop').textContent = 'Stopping…';
  for (const id of items.keys()) api.cancel(id); // only jobs that are running react
};

$('go').onclick = async () => {
  running = true;
  stopRequested = false;
  $('stop').disabled = false;
  $('stop').textContent = 'Stop';
  refresh();
  const mergeSet = [...items.values()].filter((i) => !i.group && i.supported && i.merge && i.format === 'pdf');
  const doMerge = mergeSet.length > 1;
  for (const [id, it] of items) {
    if (stopRequested) break;
    if (doMerge && mergeSet.includes(it)) continue;
    if (it.group) { await runFolder(id, it); continue; }
    if (!it.supported) continue;
    it.chips.forEach((c) => (c.disabled = true));
    it.li.classList.remove('done');
    it.status.className = 'status';
    it.status.textContent = 'Converting…';
    it.bar.style.width = '0';
    const res = await api.convert({ id, input: it.path, format: it.format, outDir, opts: picOpts() });
    it.chips.forEach((c) => (c.disabled = false));
    if (res.ok) {
      it.bar.style.width = '100%';
      it.li.classList.add('done');
      it.status.className = 'status ok';
      it.status.textContent = `Saved ${baseName(res.output)}` + (res.note ? ` · ${res.note}` : '');
      it.status.append(el('button', { className: 'link', textContent: 'Show', onclick: () => api.reveal(res.output) }));
    } else {
      it.bar.style.width = '0';
      it.status.className = 'status err';
      it.status.textContent = res.error === 'Cancelled' ? 'Stopped' : res.error;
    }
  }
  if (doMerge && !stopRequested) await runMerge(mergeSet);
  running = false;
  refresh();
};

$('clear').onclick = () => {
  for (const id of items.keys()) api.cancel(id);
  items.clear();
  $('list').innerHTML = '';
  refresh();
};

$('qual').oninput = (e) => setPic({ quality: Number(e.target.value) });
$('emailPreset').onclick = () => setPic({ quality: 75, maxSize: 1600 });
$('optsReset').onclick = () => setPic({ quality: 95, maxSize: 0, rawMode: 'preview' });
api.hasLibraw().then((has) => { hasLibraw = has; $('rawRow').hidden = !has; renderOpts(); refreshRawStatus(); });
renderOpts();

const browse = async () => addPaths(await api.pickFiles());
$('drop').onclick = browse;
$('drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') browse(); };
$('folderBtn').onclick = async (e) => { e.stopPropagation(); const dirs = await api.pickFolders(); if (dirs.length) addPaths(dirs); };
$('folderBtn').onkeydown = (e) => e.stopPropagation();
$('openBtn').onclick = () => api.openFolder(outDir || defaultDir);
$('outBtn').onclick = async () => {
  const dir = await api.pickFolder();
  if (!dir) return;
  outDir = dir;
  setOut(dir);
  remember(OUT_KEY, dir);
};
$('outReset').onclick = () => {
  outDir = defaultDir;
  setOut(defaultDir);
  try { localStorage.removeItem(OUT_KEY); } catch { /* ignore */ }
};

for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); });
}
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('drop').classList.remove('over'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  addPaths([...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean));
});

refresh();
