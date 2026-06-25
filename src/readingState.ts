// Remember the last-read page per document, keyed by absolute path.
// Local/per-machine (localStorage), matching how the item list persists its
// column prefs. Cheap and dependency-free; can move to a synced sidecar later.
const KEY = "charly.reading.v1";

type PageMap = Record<string, number>;

function load(): PageMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as PageMap;
  } catch {
    return {};
  }
}

/** Saved 1-based page for a document, or null if none/invalid. */
export function getReadingPage(path: string): number | null {
  const p = load()[path];
  return typeof p === "number" && p > 0 ? p : null;
}

/** Record the last-read 1-based page for a document. */
export function setReadingPage(path: string, page: number): void {
  if (!path || !(page > 0)) return;
  const m = load();
  if (m[path] === page) return;
  m[path] = page;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

// EPUBs don't have stable page numbers; epub.js identifies a location with a
// CFI string. Stored separately from the page map (different value type).
const EPUB_KEY = "charly.reading.epub.v1";

type LocMap = Record<string, string>;

function loadLoc(): LocMap {
  try {
    return JSON.parse(localStorage.getItem(EPUB_KEY) || "{}") as LocMap;
  } catch {
    return {};
  }
}

/** Saved EPUB CFI for a document, or null if none/invalid. */
export function getReadingLoc(path: string): string | null {
  const c = loadLoc()[path];
  return typeof c === "string" && c.length > 0 ? c : null;
}

/** Record the last-read EPUB CFI for a document. */
export function setReadingLoc(path: string, cfi: string): void {
  if (!path || !cfi) return;
  const m = loadLoc();
  if (m[path] === cfi) return;
  m[path] = cfi;
  try {
    localStorage.setItem(EPUB_KEY, JSON.stringify(m));
  } catch {
    /* storage full / unavailable — ignore */
  }
}
