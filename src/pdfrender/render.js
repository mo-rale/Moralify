// Runs inside a hidden window: renders every page of a PDF with pdf.js and sends each one back as an image.
import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import { WorkerMessageHandler } from '../../node_modules/pdfjs-dist/build/pdf.worker.mjs';

globalThis.pdfjsWorker = { WorkerMessageHandler }; // run pdf.js's worker code on this thread: no separate Worker to load
const assets = new URL('../../node_modules/pdfjs-dist/', import.meta.url).href;
const MAX_SIDE = 8192; // keep every canvas inside what Chromium can allocate

window.pdfApi.onJob(async (job) => {
  try {
    const pdf = await pdfjs.getDocument({
      data: job.data,
      isEvalSupported: false,
      cMapUrl: assets + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: assets + 'standard_fonts/',
      wasmUrl: assets + 'wasm/',
    }).promise;
    const total = pdf.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const longest = Math.max(base.width, base.height);
      let scale = job.maxSize ? job.maxSize / longest : job.scale;
      scale = Math.min(scale, MAX_SIDE / longest);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, job.mime, job.quality));
      await window.pdfApi.page({ index: n, total, buffer: await blob.arrayBuffer() });
      page.cleanup();
    }
    window.pdfApi.done(total);
  } catch (e) {
    window.pdfApi.fail(e && e.name === 'PasswordException' ? 'This PDF is password-protected.' : String((e && e.message) || e));
  }
});
window.pdfApi.ready();
