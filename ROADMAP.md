# Charly Roadmap

Charly is a local-first, folder-based reference manager — a free/open-source alternative to
Zotero. This roadmap is the high-level view; for the detailed Zotero-parity gap analysis and
sequenced work (with effort estimates and reusable libraries), see
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## ✅ Shipped

- Choose a library folder (local or cloud-synced); folder-tree sidebar mirroring disk
- Import PDFs/EPUBs; create/rename/move-to-Trash folders and items
- In-app PDF reader **with highlights, per-highlight notes, colors, and TOC/thumbnail nav**
- EPUB reader
- **Zotero-style bibliographic items** — item types, per-type fields, creators, attachments
- **Identifier/DOI lookup** to auto-fill citation data
- Tags + notes (portable sidecar files); tag filter bar
- 3-pane item list + inspector + item editor
- Filename search (collapsible)
- Drag-and-drop of files **and** web links into the library
- **Browser extension** — capture the page/PDF/link on screen into a chosen folder
  (`extension/`, via a localhost clip server)

## ▶ Next up (see IMPLEMENTATION_PLAN.md for detail)

**Decisions to lock first:** (1) add a rebuildable SQLite sidecar index for collections/search;
(2) relicense to AGPL-3.0 so the CSL citation engine can be bundled.

- **Phase 1 (no backend):** citations & bibliographies (citeproc-js/citation.js), BibTeX/RIS/
  CSL-JSON export + import, Reports, retrieve-PDF-metadata, reading state, list sorting
- **Phase 2 (index):** many-to-many collections, saved/smart searches, duplicate detection,
  full-text search, related items
- **Phase 3:** rich-text note editor, area/ink annotations, citations-in-notes
- **Phase 4:** RSS/Atom feeds

## Descoped / local substitutes

- Word-processor plugins → RTF/Markdown round-trip (full Word/LibreOffice/Docs parity is XL)
- Group libraries → shared cloud folder
- Hosted sync server + public profiles → folder-in-iCloud/Dropbox + cloud-conflict detection;
  static-site export for "My Publications"
