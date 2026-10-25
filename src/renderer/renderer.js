const $ = (id) => document.getElementById(id);
const items = new Map(); // id -> { path, format, li, chips, status, bar, supported }
let outDir = null;
let defaultDir = '';
let nextId = 1;
let running = false;

const baseName = (p) => p.split(/[\\/]/).pop();
const pad = (n) => String(n).padStart(2, '0');

api.defaultOut().then((d) => { defaultDir = d; outDir = d; setOut(d); });
api.hasLibreOffice().then((has) => { if (has) $('loNote').textContent = ' Office files work too.'; });

function setOut(dir) {
  $('outLabel').textContent = dir;
  $('outLabel').title = dir;
  $('outReset').hidden = dir === defaultDir;
}

async function addPaths(paths) {
  for (const p of paths) {
    if ([...items.values()].some((i) => i.path === p)) continue;
    const targets = await api.targets(p);
    const id = nextId++;
    const ext = p.split('.').pop().toLowerCase();
    const li = document.createElement('li');

    const num = Object.assign(document.createElement('div'), { className: 'badge', textContent: ext.slice(0, 4) });
    const info = Object.assign(document.createElement('div'), { className: 'info' });
    const name = Object.assign(document.createElement('div'), { className: 'name', textContent: baseName(p), title: p });
    const status = Object.assign(document.createElement('div'), { className: 'status' });
    info.append(name, status);
    const rm = Object.assign(document.createElement('button'), { className: 'x', textContent: '×', title: 'Remove' });
    const fmt = Object.assign(document.createElement('div'), { className: 'fmt' });
    const bar = Object.assign(document.createElement('div'), { className: 'bar', innerHTML: '<i></i>' });

    const item = { path: p, ext, targets, format: targets[0], li, chips: [], status, bar: bar.firstChild, supported: targets.length > 0, num };

    if (targets.length) {
      fmt.append(Object.assign(document.createElement('span'), { className: 'from', textContent: ext }),
                 Object.assign(document.createElement('span'), { className: 'to', textContent: '→' }));
      for (const t of targets) {
        const chip = Object.assign(document.createElement('button'), { className: 'chip' + (t === item.format ? ' on' : ''), textContent: t });
        chip.onclick = () => setFormat(item, t);
        item.chips.push(chip);
        fmt.append(chip);
      }
      status.textContent = 'Ready';
    } else {
      status.textContent = `Can't convert .${ext} files`;
      status.classList.add('err');
    }

    rm.onclick = () => { api.cancel(id); items.delete(id); li.remove(); refresh(); };
    li.append(num, info, rm, fmt, bar);
    $('list').append(li);
    items.set(id, item);
  }
  refresh();
}

const VIDEO_EXT = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', '3gp'];

function setFormat(item, t) {
  item.format = t;
  item.chips.forEach((c) => c.classList.toggle('on', c.textContent === t));
}

// "Set all to" shortcuts: formats every file can become, plus a one-click video -> MP3.
function renderBulk() {
  const bulk = $('bulk');
  bulk.replaceChildren();
  const ok = [...items.values()].filter((i) => i.supported);
  const videos = ok.filter((i) => VIDEO_EXT.includes(i.ext) && i.targets.includes('mp3'));
  const common = ok.length > 1 ? ok[0].targets.filter((t) => ok.every((i) => i.targets.includes(t))) : [];
  if (!videos.length && !common.length) { bulk.hidden = true; return; }
  const add = (label, onclick, cls = 'chip') => bulk.append(Object.assign(document.createElement('button'), { className: cls, textContent: label, onclick }));
  if (videos.length) {
    add(`${videos.length > 1 ? 'All videos' : 'Video'} → MP3`, () => videos.forEach((i) => setFormat(i, 'mp3')), 'chip shortcut');
  }
  if (common.length) {
    bulk.append(Object.assign(document.createElement('span'), { className: 'blabel', textContent: 'Set all to' }));
    common.forEach((t) => add(t, () => ok.forEach((i) => setFormat(i, t))));
  }
  bulk.hidden = running;
}

function refresh() {
  renderBulk();
  const all = [...items.values()];
  const ready = all.filter((i) => i.supported).length;
  $('go').disabled = running || !ready;
  $('goN').textContent = ready ? ` ${ready} file${ready > 1 ? 's' : ''}` : '';
  $('clear').disabled = running || !all.length;
  $('empty').classList.toggle('hide', all.length > 0);
  $('count').textContent = all.length ? `${all.length} file${all.length > 1 ? 's' : ''}` : '';
}

api.onProgress(({ id, progress }) => {
  const it = items.get(id);
  if (it) it.bar.style.width = `${Math.round(progress * 100)}%`;
});

$('go').onclick = async () => {
  running = true;
  refresh();
  for (const [id, it] of items) {
    if (!it.supported) continue;
    it.chips.forEach((c) => (c.disabled = true));
    it.li.classList.remove('done');
    it.status.className = 'status';
    it.status.textContent = 'Converting…';
    it.bar.style.width = '0';
    const res = await api.convert({ id, input: it.path, format: it.format, outDir });
    it.chips.forEach((c) => (c.disabled = false));
    if (res.ok) {
      it.bar.style.width = '100%';
      it.li.classList.add('done');
      it.status.className = 'status ok';
      it.status.textContent = `Saved ${baseName(res.output)}`;
      it.status.append(Object.assign(document.createElement('button'), {
        className: 'link', textContent: 'Show', onclick: () => api.reveal(res.output),
      }));
    } else {
      it.bar.style.width = '0';
      it.status.className = 'status err';
      it.status.textContent = res.error;
    }
  }
  running = false;
  refresh();
};

$('clear').onclick = () => {
  for (const id of items.keys()) api.cancel(id);
  items.clear();
  $('list').innerHTML = '';
  refresh();
};

const browse = async () => addPaths(await api.pickFiles());
$('drop').onclick = browse;
$('drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') browse(); };
$('openBtn').onclick = () => api.openFolder(outDir || defaultDir);
$('outBtn').onclick = async () => {
  const dir = await api.pickFolder();
  if (!dir) return;
  outDir = dir;
  setOut(dir);
};
$('outReset').onclick = () => { outDir = defaultDir; setOut(defaultDir); };

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
