# 📚 Charly

A simple, **folder-based** home for your research papers, books, and PDFs — a lightweight, local-first alternative to Zotero.

Charly points at a folder you choose. The folders and files you see in the app **are** the real folders and files on disk — there's no hidden database to corrupt or lock you in. Put that folder in iCloud Drive, Dropbox, or Google Drive and your whole library syncs across devices for free.

## Features (MVP)

- **Pick a library folder** — anywhere on disk, including a synced cloud folder.
- **Folder-tree sidebar** — browse your library exactly as it's organized on disk.
- **Import** PDFs and EPUBs into any folder (files are copied in; originals untouched).
- **Organize** — create folders/subfolders, rename, and move items to Trash.
- **Read in-app** — built-in PDF viewer (zoom) and EPUB reader (paginated).
- **Search** — instant filename search across the whole library.

## Tech stack

- [Tauri 2](https://tauri.app) (Rust) — native desktop shell, filesystem access
- React 19 + TypeScript + Vite — UI
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [epub.js](https://github.com/futurepress/epub.js/) — EPUB rendering

## Develop

```bash
npm install
npm run tauri dev      # run the app in development
npm run tauri build    # produce a distributable app bundle
```

Requires Node.js and a Rust toolchain (`rustup`).

## How it works

The library root is stored in the app config dir (`config.json`). All other state lives on
the filesystem itself — your folder structure is the source of truth. Sync is delegated to
whatever cloud provider syncs the chosen folder.

## Browser extension — Clip to Charly

Charly ships with a browser extension that saves the page you're reading, or any
link, straight into a folder of your library. PDFs download as real files;
web pages and videos are saved as portable `.charlylink` sidecar files.

While Charly is running it exposes a localhost-only endpoint (`127.0.0.1:8765`)
that the extension talks to — nothing leaves your machine. See
[`extension/README.md`](./extension/README.md) for install and usage.

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md). Highlights:

- Metadata extraction (title/author/DOI) + full-text search
- Drag-and-drop organizing
- Tags & smart collections
- ✅ **Browser extension**: capture the page/link currently on screen
- **YouTube capture**: extract studies/citations referenced in a video

## License

MIT
