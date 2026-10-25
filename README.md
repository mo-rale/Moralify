# Moralify

A Windows desktop app that converts audio, video, image and document files. Everything runs on your machine; nothing is uploaded.

## Features

- Drag and drop files, or click to browse. Convert many files at once.
- Pick the output format per file.
- Per-file progress, with a "Show" link to the converted file.
- Converted files are saved to `Documents\Moralify` by default. You can change the folder in the app.
- Never overwrites: if a file exists, the new one is saved as `name (1).ext`.

## Supported conversions

| Input | Output |
| --- | --- |
| Audio: mp3, wav, ogg, flac, aac, m4a, opus, wma | the other audio formats |
| Video: mp4, mkv, webm, avi, mov | other video formats, GIF, or audio only |
| Images: png, jpg, webp, bmp, gif, tiff | other image formats, PDF |
| docx | pdf, html, txt |
| md | pdf, html, txt |
| html | pdf, txt |
| txt | pdf, html |

**With [LibreOffice](https://www.libreoffice.org/) installed** (detected automatically):
doc, xls, xlsx, ppt, pptx, odt, ods, odp and rtf can be converted to PDF and other document formats, and docx can also become odt or rtf.

**Not supported yet:** PDF to other formats.

## Install

Run `dist/Moralify Setup 1.0.0.exe`. It installs for the current user only and needs no admin rights.
The installer is not code-signed, so Windows SmartScreen may warn: click *More info*, then *Run anyway*.

## Develop

Requires Node.js.

```bash
npm install
npm start        # run the app
npm run dist     # build the Windows installer into dist/
```

## Project layout

```
src/
  main.js          Electron main process: window, dialogs, IPC
  preload.js       Safe bridge between UI and main process
  converters.js    Conversion logic (ffmpeg, mammoth, marked, LibreOffice)
  renderer/        UI (index.html, style.css, renderer.js)
```

## Built with

Electron, [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (audio, video, images), [mammoth](https://github.com/mwilliamson/mammoth.js) (docx), [marked](https://github.com/markedjs/marked) (Markdown). PDFs for documents are rendered with Electron's built-in printing.
