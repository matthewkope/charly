import { useEffect, useMemo, useState } from "react";
import { Entry, FileItem, listItems } from "../api";
import CoverThumb from "./CoverThumb";

function icon(ext: string): string {
  if (ext === "pdf") return "📕";
  if (ext === "epub") return "📗";
  if (ext === "charlylink") return "🔗";
  if (ext === "charlyitem") return "📄";
  return "📄";
}

function typeLabel(ext: string): string {
  if (ext === "pdf") return "PDF";
  if (ext === "epub") return "EPUB";
  if (ext === "charlylink") return "Link";
  if (ext === "charlyitem") return "Item";
  return ext ? ext.toUpperCase() : "File";
}

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

function asEntry(it: FileItem): Entry {
  return { name: it.name, path: it.path, is_dir: false, ext: it.ext };
}

type ColKey = "title" | "type" | "creator" | "modified" | "size";

interface ColumnDef {
  key: ColKey;
  label: string;
  numeric?: boolean;
  fixed?: boolean; // Title can't be hidden
  width: number; // default px
  text: (it: FileItem) => string;
  sortVal: (it: FileItem) => string | number;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "title",
    label: "Title",
    fixed: true,
    width: 360,
    text: (it) => it.title || it.name,
    sortVal: (it) => (it.title || it.name).toLowerCase(),
  },
  { key: "type", label: "Type", width: 80, text: (it) => typeLabel(it.ext), sortVal: (it) => it.ext },
  {
    key: "creator",
    label: "Creator",
    width: 170,
    text: (it) => it.creator,
    sortVal: (it) => it.creator.toLowerCase(),
  },
  {
    key: "modified",
    label: "Modified",
    numeric: true,
    width: 120,
    text: (it) => fmtDate(it.modified_ms),
    sortVal: (it) => it.modified_ms,
  },
  { key: "size", label: "Size", numeric: true, width: 80, text: (it) => fmtSize(it.size), sortVal: (it) => it.size },
];

const VIS_KEY = "charly.itemcols.visible.v1";
const WIDTH_KEY = "charly.itemcols.width.v1";
const SORT_KEY = "charly.itemcols.sort.v1";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Zotero-style center list with sortable, resizable, and pickable columns.
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
  override?: FileItem[] | null;
  emptyText?: string;
  onSelect: (entry: Entry) => void;
  onOpen: (entry: Entry) => void;
  onContext: (entry: Entry, x: number, y: number) => void;
}) {
  const [loadedItems, setLoadedItems] = useState<FileItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [visible, setVisible] = useState<Record<ColKey, boolean>>(() =>
    loadJSON(VIS_KEY, { title: true, type: false, creator: true, modified: true, size: false }),
  );
  const [widths, setWidths] = useState<Record<string, number>>(() => loadJSON(WIDTH_KEY, {}));
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 }>(() =>
    loadJSON(SORT_KEY, { key: "title", dir: 1 }),
  );
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => localStorage.setItem(VIS_KEY, JSON.stringify(visible)), [visible]);
  useEffect(() => localStorage.setItem(WIDTH_KEY, JSON.stringify(widths)), [widths]);
  useEffect(() => localStorage.setItem(SORT_KEY, JSON.stringify(sort)), [sort]);

  useEffect(() => {
    if (override) return;
    setLoaded(false);
    listItems(library, folder)
      .then(setLoadedItems)
      .catch(() => setLoadedItems([]))
      .finally(() => setLoaded(true));
  }, [library, folder, version, override]);

  // Close the column picker on any outside click.
  useEffect(() => {
    if (!picker) return;
    const close = () => setPicker(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [picker]);

  const raw = override ?? loadedItems;
  const isLoaded = override ? true : loaded;

  const items = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
    const titleCol = COLUMNS[0]; // Title — the secondary tie-breaker
    const compare = (c: ColumnDef, a: FileItem, b: FileItem) => {
      const av = c.sortVal(a);
      const bv = c.sortVal(b);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    };
    return [...raw].sort((a, b) => {
      const primary = compare(col, a, b);
      if (primary !== 0) return primary * sort.dir;
      // Tie-break by Title, then path — always ascending, for stable ordering.
      if (col.key !== "title") {
        const t = compare(titleCol, a, b);
        if (t !== 0) return t;
      }
      return a.path.localeCompare(b.path);
    });
  }, [raw, sort]);

  const shownCols = COLUMNS.filter((c) => c.fixed || visible[c.key]);
  const widthOf = (c: ColumnDef) => widths[c.key] ?? c.width;

  const toggleSort = (key: ColKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));

  const startResize = (key: ColKey, startX: number, startW: number, pointerId: number, el: HTMLElement) => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(50, Math.round(startW + (ev.clientX - startX)));
      setWidths((m) => ({ ...m, [key]: w }));
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  return (
    <div className="itemlist">
      <div
        className="itemlist-head"
        onContextMenu={(e) => {
          e.preventDefault();
          setPicker({ x: e.clientX, y: e.clientY });
        }}
      >
        {shownCols.map((c) => (
          <span
            key={c.key}
            className={`col-cell col-${c.key}${c.numeric ? " num" : ""}`}
            style={c.fixed ? { flex: 1, minWidth: 120 } : { width: widthOf(c) }}
            onClick={() => toggleSort(c.key)}
            title="Click to sort · right-click for columns"
          >
            <span className="col-label">{c.label}</span>
            {sort.key === c.key && <span className="col-sort">{sort.dir === 1 ? "▲" : "▼"}</span>}
            {!c.fixed && (
              <span
                className="col-resize"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startResize(c.key, e.clientX, widthOf(c), e.pointerId, e.currentTarget);
                }}
              />
            )}
          </span>
        ))}
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
              title={it.ext === "charlylink" ? "Double-click to open in browser" : "Double-click to open"}
            >
              {shownCols.map((c) => (
                <span
                  key={c.key}
                  className={`col-cell col-${c.key}${c.numeric ? " num" : ""}`}
                  style={c.fixed ? { flex: 1, minWidth: 120 } : { width: widthOf(c) }}
                >
                  {c.key === "title" ? (
                    <>
                      {it.ext === "pdf" ? (
                        <CoverThumb path={it.path} fallback={icon(it.ext)} />
                      ) : (
                        <span className="item-icon">{icon(it.ext)}</span>
                      )}
                      <span className="item-title-text">{c.text(it)}</span>
                    </>
                  ) : (
                    <span className="cell-text">{c.text(it)}</span>
                  )}
                </span>
              ))}
            </div>
          ))
        )}
      </div>

      {picker && (
        <div
          className="col-picker"
          style={{ top: picker.y, left: picker.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {COLUMNS.filter((c) => !c.fixed).map((c) => (
            <button
              key={c.key}
              onClick={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))}
            >
              <span className="col-check">{visible[c.key] ? "✓" : ""}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
