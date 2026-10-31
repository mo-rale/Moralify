const fs = require('fs');

// Camera RAW formats. Every one of them stores one or more ready-made JPEG previews next to the sensor
// data, which is what Moralify converts (a true RAW "development" needs a RAW engine such as LibRaw).
const RAW_EXT = [
  'cr3', 'cr2', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw',
  '3fr', 'erf', 'kdc', 'mrw', 'x3f', 'rwl', 'iiq',
];
const isRaw = (ext) => RAW_EXT.includes(String(ext).toLowerCase());

const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const SOF_OK = new Set([0xc0, 0xc1, 0xc2]); // baseline, extended, progressive. Lossless (SOF3) is not a preview.

/** Validate a JPEG that starts at `start` by walking its marker segments. Returns its size and end, or null. */
function readJpeg(buf, start) {
  let p = start + 2;
  let w = 0, h = 0, comps = 0, sof = -1;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    let m = buf[p + 1];
    while (m === 0xff && p + 2 < buf.length) { p++; m = buf[p + 1]; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9) return null; // EOI before any scan
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (!SOF_OK.has(m)) return null;
      sof = m; h = buf.readUInt16BE(p + 5); w = buf.readUInt16BE(p + 7); comps = buf[p + 9];
    }
    p += 2 + len;
    if (m !== 0xda) continue;
    // entropy-coded data: runs until the next real marker (progressive files have several scans)
    for (;;) {
      if (p + 1 >= buf.length) return null;
      if (buf[p] !== 0xff) { p++; continue; }
      const n = buf[p + 1];
      if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { p += 2; continue; }
      if (n === 0xff) { p++; continue; }
      if (n === 0xd9) {
        if (sof < 0 || w < 2 || h < 2 || (comps !== 1 && comps !== 3)) return null;
        return { start, end: p + 2, w, h };
      }
      break; // another marker segment (DHT, SOS ...): keep walking
    }
  }
  return null;
}

/** All valid embedded JPEG previews in a RAW file, largest picture first. */
function extractPreviews(file) {
  const buf = fs.readFileSync(file);
  const found = [];
  let i = buf.indexOf(SOI, 0);
  while (i !== -1) {
    const j = readJpeg(buf, i);
    if (j && j.w >= 100 && j.h >= 100) {
      found.push({ w: j.w, h: j.h, bytes: buf.subarray(j.start, j.end) });
      i = buf.indexOf(SOI, j.end); // thumbnails nested inside this JPEG's EXIF are not interesting
    } else {
      i = buf.indexOf(SOI, i + 3);
    }
  }
  return found.sort((a, b) => b.w * b.h - a.w * a.h || b.bytes.length - a.bytes.length);
}

module.exports = { RAW_EXT, isRaw, extractPreviews, readJpeg };
