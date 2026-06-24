import { useEffect, useState } from "react";
import { Entry, FileItem, listItems } from "../api";

function icon(ext: string): string {
  if (ext === "pdf") return "📕";
  if (ext === "epub") return "📗";
  if (ext === "charlylink") return "🔗";
  return "📄";
}

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function asEntry(it: FileItem): Entry {
  return { name: it.name, path: it.path, is_dir: false, ext: it.ext };
}

// Zotero-style center list: the selected folder's files as Title / Creator /
// Modified rows. Single-click selects (inspect); double-click opens.
export default function ItemList({
  library,
  folder,
  version,
  selectedPath,
  override,
  emptyText = "This folder has no documents yet.",
  onSelect,
  onOpen,
  onContext,
}: {
  library: string;
  folder: string;
  version: number;
  selectedPath: string | null;
  /** When set, render these rows instead of the folder's contents (search/tags). */
  override?: FileItem[] | null;
  emptyText?: string;
  onSelect: (entry: Entry) => void;
  onOpen: (entry: Entry) => void;
  onContext: (entry: Entry, x: number, y: number) => void;
}) {
  const [loadedItems, setLoadedItems] = useState<FileItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (override) return;
    setLoaded(false);
    listItems(library, folder)
      .then(setLoadedItems)
      .catch(() => setLoadedItems([]))
      .finally(() => setLoaded(true));
  }, [library, folder, version, override]);

  const items = override ?? loadedItems;
  const isLoaded = override ? true : loaded;

  return (
    <div className="itemlist">
      <div className="itemlist-head">
        <span className="col-title">Title</span>
        <span className="col-creator">Creator</span>
        <span className="col-date">Modified</span>
      </div>
      <div className="itemlist-body">
        {isLoaded && items.length === 0 ? (
          <div className="itemlist-empty">{emptyText}</div>
        ) : (
          items.map((it) => (
            <div
              key={it.path}
              className={`item-row${selectedPath === it.path ? " selected" : ""}`}
              onClick={() => onSelect(asEntry(it))}
              onDoubleClick={() => onOpen(asEntry(it))}
              onContextMenu={(e) => {
                e.preventDefault();
                onContext(asEntry(it), e.clientX, e.clientY);
              }}
              title={
                it.ext === "charlylink"
                  ? "Double-click to open in browser"
                  : "Double-click to open"
              }
            >
              <span className="col-title">
                <span className="item-icon">{icon(it.ext)}</span>
                <span className="item-title-text">{it.title || it.name}</span>
              </span>
              <span className="col-creator">{it.creator}</span>
              <span className="col-date">{fmtDate(it.modified_ms)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
