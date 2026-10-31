const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isRaw, extractPreviews } = require('./raw');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma'];
const VIDEO = ['mp4', 'mkv', 'webm', 'avi', 'mov'];
const IMAGE = ['png', 'jpg', 'webp', 'bmp', 'gif', 'tiff'];
const OFFICE = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'];
const TEXTDOC = ['txt', 'md', 'html', 'htm'];

const INPUT_ALIASES = { jpeg: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', oga: 'ogg', mpeg: 'mpg' };
const norm = (ext) => INPUT_ALIASES[ext] || ext;

function findSoffice() {
  const candidates = [
    process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'LibreOffice', 'program', 'soffice.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
    '/usr/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** Output formats offered for an input extension. */
function targetsFor(inputExt) {
  const ext = norm(inputExt.toLowerCase());
  const soffice = findSoffice();
  const without = (list) => list.filter((f) => f !== ext);
  if (AUDIO.includes(ext) || ['mpg', 'amr', 'aiff', 'ac3'].includes(ext)) return without(AUDIO);
  if (VIDEO.includes(ext) || ['flv', 'wmv', 'm4v', 'mpg', '3gp'].includes(ext)) {
    return [...without(VIDEO), 'gif', ...AUDIO];
  }
  if (IMAGE.includes(ext) || ['ico', 'avif', 'heic'].includes(ext)) return [...without(IMAGE), 'pdf'];
  if (isRaw(ext)) return [...IMAGE, 'pdf']; // camera RAW: converts the embedded JPEG preview
  if (ext === 'pdf') return soffice ? ['png'] : [];
  if (ext === 'docx') return soffice ? ['pdf', 'html', 'txt', 'odt', 'rtf'] : ['pdf', 'html', 'txt'];
  if (ext === 'md') return ['pdf', 'html', 'txt'];
  if (ext === 'html') return ['pdf', 'txt'];
  if (ext === 'txt') return ['pdf', 'html'];
  if (OFFICE.includes(ext)) return soffice ? without(['pdf', 'docx', 'odt', 'rtf', 'txt', 'html']) : [];
  return [];
}

function runFfmpeg(args, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let duration = 0;
    let tail = '';
    const toSec = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);
    child.stderr.on('data', (buf) => {
      const text = buf.toString();
      tail = (tail + text).slice(-2000);
      const d = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (d) duration = toSec(d[1], d[2], d[3]);
      const t = [...text.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)].pop();
      if (t && duration) onProgress(Math.min(0.99, toSec(t[1], t[2], t[3]) / duration));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (signal && signal.cancelled) return reject(new Error('Cancelled'));
      const line = tail.trim().split(/\r?\n/).pop();
      reject(new Error(`ffmpeg failed: ${line}`));
    });
    if (signal) signal.kill = () => child.kill();
  });
}

const IMAGE_OUT = ['jpg', 'png', 'webp', 'bmp', 'tiff', 'gif'];

/**
 * Picture-output settings: quality (JPG/WEBP) and the longest side in px (never enlarges).
 * FFmpeg already leaves EXIF/GPS data out of every picture it writes, so there is no separate option for that.
 * Returns the extra ffmpeg arguments; `vf` is the resize filter, if any.
 */
function imageSettings(outExt, opts) {
  const q = Math.min(100, Math.max(1, Math.round(Number(opts.quality) || 95)));
  const max = Math.round(Number(opts.maxSize) || 0);
  const vf = max > 0 ? `scale=w=min(iw\\,${max}):h=min(ih\\,${max}):force_original_aspect_ratio=decrease` : null;
  const out = [];
  if (outExt === 'jpg') out.push('-q:v', String(Math.round(31 - (q / 100) * 29))); // 100 -> 2 (best) ... 1 -> 31 (smallest)
  if (outExt === 'webp') out.push('-quality', String(q));
  return { vf, out };
}

function ffmpegArgsFor(input, output, outExt, inputIsVideo, opts = {}) {
  const a = ['-i', input];
  if (!inputIsVideo && IMAGE_OUT.includes(outExt)) { // picture -> picture, with the user's quality / size / metadata settings
    const { vf, out } = imageSettings(outExt, opts);
    a.push('-frames:v', '1');
    if (outExt === 'gif') a.push('-vf', vf || 'scale=iw:-1', '-loop', '0');
    else if (vf) a.push('-vf', vf);
    a.push(...out, output);
    return a;
  }
  switch (outExt) {
    case 'mp3': a.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2'); break;
    case 'ogg': a.push('-vn', '-c:a', 'libvorbis', '-q:a', '5'); break;
    case 'opus': a.push('-vn', '-c:a', 'libopus', '-b:a', '128k'); break;
    case 'aac': a.push('-vn', '-c:a', 'aac', '-b:a', '192k'); break;
    case 'm4a': a.push('-vn', '-c:a', 'aac', '-b:a', '192k'); break;
    case 'wma': a.push('-vn', '-c:a', 'wmav2', '-b:a', '192k'); break;
    case 'flac': a.push('-vn', '-c:a', 'flac'); break;
    case 'wav': a.push('-vn', '-c:a', 'pcm_s16le'); break;
    case 'mp4': case 'mov': a.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'); break;
    case 'webm': a.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-c:a', 'libopus'); break;
    case 'mkv': a.push('-c:v', 'libx264', '-c:a', 'aac'); break;
    case 'avi': a.push('-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame'); break;
    case 'gif':
      a.push('-vf', inputIsVideo ? 'fps=12,scale=480:-1:flags=lanczos' : 'scale=iw:-1', '-loop', '0');
      break;
    case 'jpg': a.push('-frames:v', '1', '-q:v', '2'); break;
    case 'png': case 'bmp': case 'tiff': case 'webp': a.push('-frames:v', '1'); break;
    default: break;
  }
  a.push(output);
  return a;
}

/** Render HTML to PDF using a hidden Electron window. */
async function htmlToPdf(html, output) {
  const { BrowserWindow } = require('electron');
  const tmp = path.join(os.tmpdir(), `fc-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    fs.writeFileSync(output, pdf);
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrapHtml = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Segoe UI,Arial,sans-serif;line-height:1.5;max-width:800px;margin:0 auto;padding:24px;color:#111}
img{max-width:100%}pre,code{background:#f3f3f3;border-radius:4px}pre{padding:10px;overflow:auto}
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}
</style></head><body>${body}</body></html>`;

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function toHtml(input, ext) {
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    return wrapHtml((await mammoth.convertToHtml({ path: input })).value);
  }
  const text = fs.readFileSync(input, 'utf8');
  if (ext === 'md') {
    const { marked } = require('marked');
    return wrapHtml(marked.parse(text));
  }
  if (ext === 'html') return text;
  return wrapHtml(`<pre style="white-space:pre-wrap;background:none">${esc(text)}</pre>`);
}

function runSoffice(input, outExt, output) {
  const soffice = findSoffice();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-lo-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-lop-'));
  const filter = outExt === 'txt' ? 'txt:Text' : outExt;
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, [
      `-env:UserInstallation=file:///${profile.replace(/\\/g, '/')}`,
      '--headless', '--convert-to', filter, '--outdir', dir, input,
    ], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      try {
        const made = fs.readdirSync(dir)[0];
        if (!made) throw new Error(`LibreOffice conversion failed. ${err.trim()}`);
        fs.copyFileSync(path.join(dir, made), output);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(profile, { recursive: true, force: true });
      }
    });
  });
}

/** Camera RAW -> picture, by converting the largest JPEG preview stored inside the RAW file. */
async function convertRaw(input, output, outExt, onProgress, signal, opts = {}) {
  const previews = extractPreviews(input);
  if (!previews.length) throw new Error('No preview image found inside this RAW file.');
  let lastError;
  for (const pv of previews.slice(0, 3)) { // fall back to the next one if a candidate will not decode
    const tmp = path.join(os.tmpdir(), `fc-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    fs.writeFileSync(tmp, pv.bytes);
    try {
      if (outExt === 'jpg' && !opts.custom) fs.copyFileSync(tmp, output); // already a JPEG: no re-compression
      else if (outExt === 'pdf') await htmlToPdf(wrapHtml(`<img src="${encodeURI('file:///' + tmp.replace(/\\/g, '/'))}" style="max-width:100%;max-height:260mm">`), output);
      else await runFfmpeg(ffmpegArgsFor(tmp, output, outExt, false, opts), onProgress, signal);
      return;
    } catch (e) {
      lastError = e;
      if (signal && signal.cancelled) throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  throw lastError;
}

async function convert({ input, output, onProgress, signal, opts = {} }) {
  const inExt = norm(path.extname(input).slice(1).toLowerCase());
  const outExt = path.extname(output).slice(1).toLowerCase();
  fs.mkdirSync(path.dirname(output), { recursive: true });

  if (isRaw(inExt)) {
    await convertRaw(input, output, outExt, onProgress, signal, opts);
    onProgress(1);
    return;
  }

  const isMedia = AUDIO.includes(inExt) || VIDEO.includes(inExt) || IMAGE.includes(inExt) ||
    ['ico', 'avif', 'heic', 'flv', 'wmv', 'm4v', 'mpg', '3gp', 'amr', 'aiff', 'ac3'].includes(inExt);

  if (isMedia && outExt === 'pdf') {
    const url = 'file:///' + input.replace(/\\/g, '/');
    await htmlToPdf(wrapHtml(`<img src="${encodeURI(url)}" style="max-width:100%;max-height:260mm">`), output);
  } else if (isMedia) {
    const isVideo = !AUDIO.includes(inExt) && !IMAGE.includes(inExt);
    await runFfmpeg(ffmpegArgsFor(input, output, outExt, isVideo, opts), onProgress, signal);
  } else if (inExt === 'pdf' && outExt === 'png') {
    throw new Error('PDF to image is not supported yet.');
  } else if (OFFICE.includes(inExt) && !(inExt === 'docx' && ['html', 'txt'].includes(outExt)) &&
    !(inExt === 'docx' && outExt === 'pdf' && !findSoffice())) {
    // docx -> pdf prefers LibreOffice: it keeps headers, images and fonts, unlike the HTML fallback.
    if (!findSoffice()) throw new Error('This conversion needs LibreOffice installed.');
    await runSoffice(input, outExt, output);
  } else if (TEXTDOC.includes(inExt) || inExt === 'docx') {
    const html = await toHtml(input, inExt);
    if (outExt === 'pdf') await htmlToPdf(html, output);
    else if (outExt === 'html') fs.writeFileSync(output, html);
    else if (outExt === 'txt') fs.writeFileSync(output, inExt === 'txt' ? fs.readFileSync(input) : htmlToText(html));
    else throw new Error(`Unsupported conversion: ${inExt} to ${outExt}`);
  } else {
    throw new Error(`Unsupported conversion: ${inExt} to ${outExt}`);
  }
  onProgress(1);
}

module.exports = { convert, targetsFor, findSoffice };
