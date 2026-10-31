// Downloads the official LibRaw Windows build (the RAW development engine) into vendor/libraw/.
// Runs automatically before `npm start` and `npm run dist`. Nothing is downloaded if the files are already there.
// Without LibRaw Moralify still works: RAW files are then converted from their built-in JPEG preview.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = '0.22.3';
const URL_ZIP = `https://www.libraw.org/data/LibRaw-${VERSION}-Win64.zip`;
const SHA256 = '4e2213a0b10e32199a30b9114a61376cdb40f94df861262b4a6dca659701276b';
const OUT = path.join(__dirname, '..', 'vendor', 'libraw');
const KEEP = [['bin/dcraw_emu.exe', 'dcraw_emu.exe'], ['bin/libraw.dll', 'libraw.dll'], ['LICENSE.LGPL', 'LICENSE.LGPL'], ['LICENSE.CDDL', 'LICENSE.CDDL'], ['COPYRIGHT', 'COPYRIGHT']];

function download(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, file, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  if (process.platform !== 'win32') { console.log('LibRaw: Windows build only, skipping.'); return; }
  if (fs.existsSync(path.join(OUT, 'dcraw_emu.exe')) && fs.existsSync(path.join(OUT, 'libraw.dll'))) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libraw-'));
  try {
    console.log(`LibRaw ${VERSION}: downloading the official Windows build from libraw.org ...`);
    const zip = path.join(tmp, 'libraw.zip');
    await download(URL_ZIP, zip);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (hash !== SHA256) throw new Error(`checksum mismatch (got ${hash})`);
    // Windows' own bsdtar reads zip files (a different `tar` earlier on PATH, such as Git's, may not)
    execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp], { stdio: 'ignore' });
    const root = path.join(tmp, `LibRaw-${VERSION}`);
    fs.mkdirSync(OUT, { recursive: true });
    for (const [from, to] of KEEP) fs.copyFileSync(path.join(root, from), path.join(OUT, to));
    console.log('LibRaw ready in vendor/libraw');
  } catch (e) {
    console.warn(`LibRaw could not be downloaded (${e.message}). Moralify will convert RAW previews instead.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
