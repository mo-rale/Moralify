# Changelog

## 1.1.2

- Fixed conversions staying on "Converting..." forever on PCs where Windows' Documents folder points to a folder that no longer exists (for example a removed OneDrive folder). The default output folder now falls back to a Documents folder in your user profile.
- Any failure now shows an error on the file's card, and the Convert button always comes back.
- A progress bar with a percentage on every card. Folders show "N of M", the overall percentage and the file being converted.
- Code signing groundwork for the release workflow (SignPath); installers stay unsigned until it is approved.

## 1.1.1

- New Moralify logo: a new app and installer icon, the full logo on the start screen (it follows the light or dark theme) and a banner in the README.
- The header shows only the icon until you add files, so the name is never repeated.

## 1.1.0

A large update to the first release (1.0.0): Moralify is a free, open source Windows app that converts audio, video, pictures and documents on your own computer.

**Converting**
- Audio (mp3, wav, ogg, flac, aac, m4a, opus, wma) and video (mp4, mkv, webm, avi, mov, plus GIF and audio-only output).
- Pictures (png, jpg, webp, bmp, gif, tiff) and iPhone HEIC/HEIF photos.
- Camera RAW (CR3, CR2, NEF, ARW, DNG and more): converts the camera's built-in preview by default, or develops the real sensor data with LibRaw.
- Documents: docx, Markdown, HTML and text to PDF/HTML/text, and Office files when LibreOffice is installed.
- PDF to pictures (one per page), and several pictures into one PDF.

**Working with many files**
- Drop or add a whole folder; choose the file types and the output format; subfolders are included and the folder layout is kept.
- Picture options: JPG/WEBP quality, maximum size and a "Compress for email" preset.
- A Stop button, per-file progress, and never overwriting existing files.

**The app**
- Claude-inspired interface that follows the Windows light or dark theme.
- "Convert with Moralify" in the Explorer right-click menu for supported files and folders.
- Remembers your output folder and the last format chosen for each file type.
- Windows installer with a terms page, install-folder choice and uninstaller.
