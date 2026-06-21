# Charly Roadmap

Charly is a local-first, folder-based reference manager. This roadmap tracks where it's
going beyond the initial MVP.

## ✅ Phase 1 — MVP (current)

- [x] Choose a library folder (local or cloud-synced)
- [x] Folder-tree sidebar mirroring the real filesystem
- [x] Import PDFs/EPUBs into any folder
- [x] Create folders/subfolders, rename, move-to-Trash
- [x] In-app PDF viewer (zoom) and EPUB reader
- [x] Filename search across the library

## Phase 2 — Better organizing & metadata

- [ ] Drag-and-drop to move files between folders (backend `move_entry` already exists)
- [ ] Extract metadata from PDFs (title, authors, DOI, year) and EPUB OPF
- [ ] DOI / arXiv lookup to auto-fill citation data
- [ ] Full-text search (index document contents, not just filenames)
- [ ] Tags and saved/smart collections (stored as sidecar files, keeping it folder-portable)
- [ ] Recently opened / reading list
- [ ] Reading state: remember last page/location per document

## Phase 3 — Sync & multi-device polish

- [ ] First-run guidance to place library in iCloud/Dropbox/Drive
- [ ] Conflict-aware handling of cloud sync collisions
- [ ] Optional: lightweight metadata cache that rebuilds from disk

## Phase 4 — Capture extension

- [ ] Browser extension: capture the paper/PDF currently on screen into a chosen folder
- [ ] Grab citation metadata from the page (publisher pages, Google Scholar, arXiv, PubMed)
- [ ] YouTube capture: scrub a video and extract studies/papers referenced (description +
      transcript parsing → DOI/title resolution → import)
- [ ] Native messaging bridge between the extension and the Charly desktop app

## Phase 5 — Nice-to-haves

- [ ] Annotations / highlights on PDFs
- [ ] Notes per document
- [ ] BibTeX / RIS / CSL export
- [ ] Dark mode polish and keyboard navigation
- [ ] Windows/Linux release builds + auto-update
