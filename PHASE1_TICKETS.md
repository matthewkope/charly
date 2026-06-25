# Phase 1 — Concrete tickets

Phase 1 of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md): high-value, client-side, no
index required. Suggested order is top-to-bottom; T1 and T2 unlock the most visible wins.

Conventions: backend = `#[tauri::command]` in `src-tauri/src/lib.rs` exposed via `src/api.ts`;
items are `.charlyitem` JSON files (`itemType`, `fields`, `creators`, `attachments`, dates).

---

## T0 — Relicense to AGPL-3.0  ·  S  ·  **DEFERRED**

**Status:** not needed yet. Citations use **hand-rolled APA/MLA/Chicago formatters**
(`src/cite.ts`, no CSL engine), so Charly **stays MIT**. Revisit this ticket only if/when we
adopt citeproc-js for the full CSL style library — at that point: replace `LICENSE` (MIT → AGPL-
3.0), set `"license"` in `package.json` + `src-tauri/Cargo.toml`, update README, add a
`THIRD_PARTY` note.

---

## T1 — Citation formatting  ·  M

**Status:** in progress as **hand-rolled APA/MLA/Chicago** formatters in `src/cite.ts` (no
citeproc / no AGPL). The CSL-engine version below is the *future* upgrade path, not the current
build.

**Goal:** turn a Charly item into formatted citations/bibliography.
- Add a JS module `src/cite/cslMap.ts`: `charlyItemToCSL(item: Item): CSLItem` — map our
  `itemType`/`fields`/`creators` to CSL-JSON variables (use Zotero's published item↔CSL map).
- Add `citeproc-js` (or `@citation-js/core`) as a dependency; create `src/cite/engine.ts`
  wrapping it: `format(items, styleId, locale, mode: "bibliography"|"citation"): string`.
- Bundle a curated CSL subset under `src-tauri/resources/csl/` (APA, MLA, Chicago author-date +
  note, IEEE, Vancouver, Nature) + the matching locales; load via Tauri resource path.
- **Done when:** given a `.charlyitem`, `format()` returns correct APA + MLA strings (unit-test
  with 3–4 fixture items: journal article, book, webpage).

## T2 — Quick Copy + "Create Bibliography"  ·  S–M  ·  depends T1

**Goal:** user-facing citation output.
- Context-menu actions on item-list selection: **Copy Citation** (⌘⇧A) and **Copy Bibliography**
  (⌘⇧C); a "Create Bibliography from Items…" modal to pick style + output (Citations/Bibliography)
  + format (Copy / HTML / RTF).
- Drag-to-cite: dragging item(s) into an external field drops a formatted reference; hold Shift
  → in-text citation. (Reuse the existing drag infrastructure.)
- Style picker reads the bundled CSL set; remember last-used style in config.
- **Done when:** selecting items and pressing ⌘⇧C puts a formatted bibliography on the clipboard.

---

## T3 — Export BibTeX / RIS / CSL-JSON  ·  S  ·  depends T1

**Goal:** interchange out.
- `src/cite/export.ts` using `@citation-js/plugin-bibtex` + `-ris`; CSL-JSON is the mapper output.
- "Export Items…" action → file save dialog (reuse `@tauri-apps/plugin-dialog`); write via a
  Rust `write_text_file` command (or existing file API).
- **Done when:** exporting a selection yields a valid `.bib`/`.ris`/`.json` that re-imports (T4).

## T4 — Import RIS / BibTeX / CSL-JSON  ·  M  ·  depends T1

**Goal:** interchange in (migration from other tools).
- Parse with `@citation-js` → CSL-JSON → inverse of `cslMap` → `.charlyitem` files written into
  the current folder (reuse `createItem`/`saveItem`).
- "File → Import…" picks a file; show a count + target-folder confirm. BibTeX is the messy case
  (LaTeX escapes, dialects) — lean on the library, accept best-effort.
- **Done when:** importing a 20-entry `.ris`/`.bib` creates 20 items with correct type/fields/creators.

---

## T5 — Reports  ·  S

**Goal:** read-only HTML overview of a selection/folder.
- Pure frontend: template selected items → an HTML document (metadata + child notes + tags +
  attachment info + date added); honor current sort.
- Open in a new window/tab; "Save as HTML" (write file) + browser/OS Print.
- **Done when:** "Generate Report" on a folder produces a saved, self-contained HTML file.

## T6 — Retrieve PDF metadata (DOI-first)  ·  M

**Goal:** drop a PDF → auto-create a parent item + attach + rename.
- New Rust command `extract_pdf_text(path, pages)` (e.g. `pdf-extract`/`lopdf`/pdfium) → first
  ~3 pages of text.
- Frontend: scan text for a DOI (regex) → call existing `fetchIdentifier` → `createItem` with
  returned fields → attach the PDF (`attachToItem`) → rename file from `{author}{year}{title}`.
- Wire into the existing drag-drop path for `.pdf`; batch + an "Undo" toast.
- **Done when:** dropping an academic PDF with a DOI creates a populated item with the PDF attached.

## T7 — Reading state (last location)  ·  S

**Goal:** reopen a document where you left off.
- Persist `{path → {page, scrollPct}}` in a sidecar (e.g. `.charly/reading-state.json`) or per-
  doc sidecar; the reader writes on scroll (debounced) and restores on open.
- Add a "Recently Read" virtual list in the sidebar.
- **Done when:** closing at page 40 and reopening lands on page 40.

## T8 — Item-list sorting  ·  S–M

**Goal:** sortable columns.
- Click column headers (Title / Creators / Date Added / Year) to toggle asc/desc; a secondary
  sort tiebreak; persist column/sort in config.
- Type-correct keys: dates as epoch, creators as normalized "Last, F.", years numeric.
- **Done when:** clicking "Creators" sorts by first creator's last name, stably.

---

### Dependency graph

```
T0 ─┬─ T1 ─┬─ T2
    │      ├─ T3
    │      └─ T4
T5, T6, T7, T8  (independent — can run in parallel, good worktree candidates)
```

T5–T8 are independent of the citation stack — ideal to hand to separate worktree sessions.
