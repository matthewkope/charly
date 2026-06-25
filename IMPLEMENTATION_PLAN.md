# Charly → Zotero-parity Implementation Plan

Charly is a local-first, **folder-based** reference manager — a free/open-source alternative
to Zotero. This document maps Zotero's feature set (scanned from the official docs) against
what Charly already does, and lays out a sequenced plan for closing the gap.

Effort tags: **S** (days) · **M** (1–2 weeks) · **L** (weeks) · **XL** (its own project).

---

## Two decisions to make first

Everything below hangs on two upfront choices.

### Decision 1 — Folder purity vs. a rebuildable index

Charly's pitch is "the folders on disk **are** the data — no database to corrupt or lock you
in." But several core Zotero features cannot be served from directory walks:

- **Collections are many-to-many** — one paper can live in many collections at once. A file
  can only be in one folder.
- **Saved/smart searches, duplicate detection, and full-text search** all require **indexed
  metadata**, not filesystem scans.

**Recommendation:** keep files on disk as the canonical store, but add a **SQLite sidecar
index** as the source of truth for membership and search — and make it **fully rebuildable
from disk** (sidecar `.json`/`.charlyitem` files remain authoritative for per-item data). This
preserves the "no lock-in / nothing to corrupt" promise (delete the index, it regenerates)
while unlocking ~5 major features. Keep the index **outside** the cloud-synced folder to avoid
sync churn/corruption.

> If you'd rather stay purely folder-based, that's a legitimate differentiator — but it caps
> collections at single-membership and limits search. The rest of this plan assumes the index.

### Decision 2 — Relicense to AGPL-3.0

The only practical citation engine is **citeproc-js** (the reference CSL implementation),
licensed **AGPLv3 / CPAL**. Bundling it into a distributed app triggers AGPL copyleft.
Charly is currently **MIT**. To ship citations as FOSS, plan to **relicense Charly to
AGPL-3.0** (what Zotero itself uses) or isolate the engine behind a process boundary. Settle
this before building Phase 1's citation work.

---

## Current state — already implemented ✅

From the codebase and commit history, Charly already covers a large slice of Zotero:

- **Library & files:** folder-tree library, import PDFs/EPUBs, create/rename/move/trash,
  drag-and-drop of files **and** web links.
- **Reader:** in-app PDF reader (pdf.js) with **highlights + per-highlight notes + colors +
  TOC/thumbnail/highlight navigation**; EPUB reader.
- **Bibliographic items:** Zotero-style item types (common + full list), per-type fields,
  creators, attachments (`createItem`/`getItem`/`saveItem`/`attachToItem`).
- **Identifier lookup:** DOI/identifier → item metadata (`fetchIdentifier`).
- **Organizing:** tags + notes (portable sidecars), tag filter bar.
- **UI:** 3-pane Zotero-style item list + inspector + item editor; collapsible search.
- **Capture:** "Clip to Charly" browser extension → web pages/PDFs/links into the library via
  a localhost clip server.

This already matches Zotero's item model, attachments, basic reader/annotation, and a capture
path. The plan below is the *remaining* gap.

---

## Phase 1 — High value, low cost, no architecture change (ship first)

All client-side; no backend, no index required.

| Feature | Effort | Reuse / notes |
|---|---|---|
| **Citations & bibliography** — Quick Copy (drag-to-cite), "Create Bibliography from Items", in-text vs. full-reference | **S–M** | `citeproc-js` + `citation.js`; bundle a curated CSL subset (APA, MLA, Chicago, IEEE, Vancouver, Nature) from `citation-style-language/styles` + `/locales`. ⚠️ AGPL (Decision 2) |
| **Export** — BibTeX / RIS / CSL-JSON | **S** | `@citation-js/plugin-bibtex`, `-ris` |
| **Standard-format import** — RIS / BibTeX / CSL-JSON → items | **M** | symmetric with export; BibTeX is the messy one |
| **Reports** — read-only HTML overview of selected items/collection | **S** | template over existing item/note/tag data; Save-as-HTML + Print |
| **Retrieve PDF metadata** — drop a PDF → auto-create parent item + attach + rename | **M** | Rust PDF text extract → DOI regex → reuse `fetchIdentifier`/CrossRef; DOI-first MVP |
| **Reading state** — remember last page/location per document | **S** | sidecar |
| **Sorting** — item-list column sort + secondary sort | **S–M** | type-correct keys (dates as epoch, creators as "Last, F.") |

**Why first:** citations + import/export close the most visible Zotero gaps and need no backend.

---

## Phase 2 — The index, then organizing depth (requires Decision 1)

| Feature | Effort | Notes |
|---|---|---|
| **SQLite sidecar index** (rebuildable from disk) — the foundation | **L** | `collections`, `collection_items`, `tags`, `item_tags`, `related`, FTS table |
| **Many-to-many collections** (item in multiple collections) | **L** | join table is source of truth; optionally mirror one "primary" collection as a real folder for browsing |
| **Saved / smart searches** | **L** | store criteria tree `{match, conditions[], options}` → compile to SQL; live re-run on demand |
| **Duplicate detection + merge** | **M** | match: same type + DOI/ISBN/normalized-title + year±1 + creator initial; merge unions collections/tags/relations onto a chosen master |
| **Full-text search** | **M–L** | extract text on import; SQLite **FTS5** or **tantivy**; index outside synced folder |
| **Related items** | **S** | undirected edge list, same-library only |

---

## Phase 3 — Notes & annotation depth

- **Rich-text note editor** — **TipTap/ProseMirror** in React; notes stored as HTML files +
  image assets in a subfolder. **M**
- **Area/image + ink annotations** in the reader (Charly has highlight + note today). **L**
- **Live citations inside notes** (custom node re-rendered per CSL style). **L–XL**

---

## Phase 4 — Discovery

- **RSS/Atom feeds** — subscribe, read/unread (local-only), "Save to Library". `feed-rs` +
  OPML import. **M** — genuinely easy, good standalone win.
- **Browser translator framework** (site-specific metadata scrapers) — **XL**. Charly's
  existing clip extension already covers the 80%; **descope** the full translator port.

---

## Explicitly out-of-scope / descope (server-side XLs)

These are not folder-sync features and are each their own project:

- **Word-processor plugins** (Word / LibreOffice / Google Docs) — multi-month native work per
  host. **Substitute:** RTF/Markdown round-trip, or target a single host. Still worth copying
  the "store citation payload as a field + Refresh re-renders the doc" pattern.
- **Group libraries** (roles/permissions/invites) — XL backend. **Substitute:** a shared cloud
  folder, with its limits documented.
- **Hosted sync server + public "My Publications" profiles** — XL. **Substitutes:** folder-in-
  iCloud/Dropbox already replaces solo sync for free — add **cloud-drive conflict detection**
  (surface `* conflicted copy *` files; last-writer-wins or a small merge UI) **S–L**; for
  publications, **static-site export** (HTML bibliography + optional PDFs) the user hosts
  themselves **M**.

---

## Recommended path

1. Lock **Decision 1 = add the rebuildable SQLite index** and **Decision 2 = relicense to
   AGPL-3.0**.
2. Ship **Phase 1** (citations, export, import, reports, PDF-metadata) — highest value-to-
   effort, all client-side.
3. Build the **index** and **Phase 2** organizing features.
4. Layer in **Phase 3/4** as desired; keep the server-side items descoped behind local
   substitutes.

## Reusable open-source

`citeproc-js` · `citation.js` (`@citation-js/*`) · CSL **styles** + **locales** repos
(`citation-style-language/*`) · `feed-rs` · `tantivy` / SQLite **FTS5** · TipTap (ProseMirror) ·
Zotero's published item↔CSL-variable mapping. **License watch:** citeproc-js is AGPLv3/CPAL.
