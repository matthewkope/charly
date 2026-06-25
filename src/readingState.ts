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
