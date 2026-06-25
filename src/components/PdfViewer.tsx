import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { getHighlights, Highlight, HlRect, readFileBytes, saveHighlights } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const COLORS = [
  { name: "Yellow", value: "#ffd54f" },
  { name: "Green", value: "#aed581" },
  { name: "Blue", value: "#4fc3f7" },
  { name: "Pink", value: "#f06292" },
];

interface PageRef {
  num: number;
  wrap: HTMLDivElement;
  hl: HTMLDivElement;
}

export default function PdfViewer({
  path,
  library,
  onHighlightsChange,
  targetPage,
  targetNonce,
  navOpen,
  onToggleNav,
}: {
  path: string;
  library?: string | null;
  /** Whether this tab is currently visible (accepted for compatibility). */
  active?: boolean;
  /** Notified whenever the highlight set loads or changes (for the nav pane). */
  onHighlightsChange?: (highlights: Highlight[]) => void;
  /** Scroll the document to this 1-based page; bump `targetNonce` to re-trigger. */
  targetPage?: number | null;
  targetNonce?: number;
  /** Left notes pane open state + toggle (rendered as a toolbar icon). */
  navOpen?: boolean;
  onToggleNav?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<PageRef[]>([]);
  const highlightsRef = useRef<Highlight[]>([]);
  const pendingRef = useRef<Highlight[] | null>(null);

  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [color, setColor] = useState(COLORS[0].value);
  const [fab, setFab] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const [pageField, setPageField] = useState("1");

  useEffect(() => {
    highlightsRef.current = highlights;
    onHighlightsChange?.(highlights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  // Scroll to a page requested by the nav pane (TOC / thumbnail / highlight).
  useEffect(() => {
    if (!targetPage) return;
    const pr = pagesRef.current.find((p) => p.num === targetPage);
    pr?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPage, targetNonce]);

  // Track the current page from the scroll position.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onScroll = () => {
      const top = c.getBoundingClientRect().top;
      let cur = 1;
      for (const pr of pagesRef.current) {
        if (pr.wrap.getBoundingClientRect().top - top <= 100) cur = pr.num;
        else break;
      }
      setCurPage(cur);
    };
    c.addEventListener("scroll", onScroll);
    return () => c.removeEventListener("scroll", onScroll);
  }, []);

  // Reflect the current page in the input (unless the user is mid-edit).
  useEffect(() => setPageField(String(curPage)), [curPage]);

  const goToPage = (n: number) => {
    if (!Number.isFinite(n)) {
      setPageField(String(curPage));
      return;
    }
    const clamped = Math.max(1, Math.min(numPages || 1, Math.floor(n)));
    pagesRef.current
      .find((p) => p.num === clamped)
      ?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Load saved highlights for this document.
  useEffect(() => {
    if (!library) {
      setHighlights([]);
      return;
    }
    getHighlights(library, path).then(setHighlights).catch(() => setHighlights([]));
  }, [library, path]);

  const persist = (next: Highlight[]) => {
    setHighlights(next);
    highlightsRef.current = next;
    if (library) saveHighlights(library, path, next).catch(() => {});
    paint();
  };

  const removeHighlight = (id: string) => persist(highlightsRef.current.filter((h) => h.id !== id));

  const updateNote = (id: string, note: string) =>
    persist(highlightsRef.current.map((h) => (h.id === id ? { ...h, note } : h)));

  function paint() {
    for (const pr of pagesRef.current) {
      pr.hl.innerHTML = "";
      const w = pr.wrap.clientWidth;
      const h = pr.wrap.clientHeight;
      for (const hlt of highlightsRef.current) {
        if (hlt.page !== pr.num) continue;
        const noted = hlt.note.trim().length > 0;
        hlt.rects.forEach((r, i) => {
          const div = document.createElement("div");
          div.className = `hl-rect${noted ? " noted" : ""}`;
          div.style.left = `${r.x * w}px`;
          div.style.top = `${r.y * h}px`;
          div.style.width = `${r.w * w}px`;
          div.style.height = `${r.h * h}px`;
          div.style.background = hlt.color;
          div.title = noted ? "Click to view note" : "Click to add a note";
          div.onclick = (ev) => setEditing({ id: hlt.id, x: ev.clientX, y: ev.clientY });
          pr.hl.appendChild(div);
          // Place a small note badge on the first rect of an annotated highlight.
          if (noted && i === 0) {
            const badge = document.createElement("div");
            badge.className = "hl-note-badge";
            badge.textContent = "📝";
            badge.style.left = `${r.x * w}px`;
            badge.style.top = `${r.y * h}px`;
            badge.onclick = (ev) => setEditing({ id: hlt.id, x: ev.clientX, y: ev.clientY });
            pr.hl.appendChild(badge);
          }
        });
      }
    }
  }

  // Render the document: canvas + selectable text layer + highlight layer.
  useEffect(() => {
    let cancelled = false;
    let doc: pdfjsLib.PDFDocumentProxy | null = null;

    (async () => {
      setStatus("loading");
      try {
        const data = await readFileBytes(path);
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        pagesRef.current = [];

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });

          const wrap = document.createElement("div");
          wrap.className = "pdf-page-wrap";
          wrap.style.width = `${viewport.width}px`;
          wrap.style.height = `${viewport.height}px`;
          wrap.style.setProperty("--scale-factor", String(scale));
          wrap.style.setProperty("--total-scale-factor", String(scale));
          wrap.dataset.page = String(n);

          const canvas = document.createElement("canvas");
          canvas.className = "pdf-canvas";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");
          wrap.appendChild(canvas);

          const textDiv = document.createElement("div");
          textDiv.className = "textLayer";
          wrap.appendChild(textDiv);

          const hl = document.createElement("div");
          hl.className = "hl-layer";
          wrap.appendChild(hl);

          container.appendChild(wrap);

          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;

          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: await page.getTextContent(),
            container: textDiv,
            viewport,
          });
          await textLayer.render();

          pagesRef.current.push({ num: n, wrap, hl });
        }
        if (!cancelled) {
          setNumPages(doc.numPages);
          setCurPage(1);
          setStatus("ready");
          paint();
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, scale]);

  // Repaint overlays whenever highlights change or the page is re-rendered.
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, status, scale]);

  // Turn a text selection into a pending highlight + show the floating action.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || !sel.rangeCount || !text) {
        setFab(null);
        pendingRef.current = null;
        return;
      }
      const rects = Array.from(sel.getRangeAt(0).getClientRects());
      const byPage = new Map<number, HlRect[]>();
      let last: DOMRect | null = null;
      for (const cr of rects) {
        if (cr.width < 1 || cr.height < 1) continue;
        for (const pr of pagesRef.current) {
          const wr = pr.wrap.getBoundingClientRect();
          const cx = cr.left + cr.width / 2;
          const cy = cr.top + cr.height / 2;
          if (cx >= wr.left && cx <= wr.right && cy >= wr.top && cy <= wr.bottom) {
            const arr = byPage.get(pr.num) ?? [];
            arr.push({
              x: (cr.left - wr.left) / wr.width,
              y: (cr.top - wr.top) / wr.height,
              w: cr.width / wr.width,
              h: cr.height / wr.height,
            });
            byPage.set(pr.num, arr);
            last = cr;
            break;
          }
        }
      }
      if (byPage.size === 0) {
        setFab(null);
        return;
      }
      const made: Highlight[] = [];
      byPage.forEach((r, page) => {
        made.push({
          id: `${Date.now()}-${page}-${Math.round(Math.random() * 1e6)}`,
          page,
          color,
          text,
          note: "",
          rects: r,
        });
      });
      pendingRef.current = made;
      if (last) setFab({ x: last.right, y: last.bottom });
    };

    const onScroll = () => {
      setFab(null);
      setEditing(null);
      pendingRef.current = null;
    };

    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("scroll", onScroll);
    };
  }, [color]);

  const confirmHighlight = () => {
    const made = pendingRef.current;
    if (!made) return;
    const pos = fab;
    persist([...highlightsRef.current, ...made]);
    window.getSelection()?.removeAllRanges();
    setFab(null);
    pendingRef.current = null;
    // Immediately offer a note for the new highlight, like Kindle.
    const last = made[made.length - 1];
    if (pos) setEditing({ id: last.id, x: pos.x, y: pos.y });
  };

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        {onToggleNav && (
          <>
            <button
              className="icon-btn"
              onClick={onToggleNav}
              title={navOpen ? "Hide notes pane" : "Show notes pane"}
              aria-label="Toggle notes pane"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            </button>
            <span className="tool-sep" />
          </>
        )}
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}>−</button>
        <span className="zoom-label">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>+</button>
        <span className="tool-sep" />
        <span className="hl-label">Highlight</span>
        {COLORS.map((c) => (
          <button
            key={c.value}
            className={`swatch${color === c.value ? " active" : ""}`}
            style={{ background: c.value }}
            title={c.name}
            onClick={() => setColor(c.value)}
          />
        ))}
        <div className="page-finder">
          <button
            className="page-btn"
            onClick={() => goToPage(curPage - 1)}
            disabled={curPage <= 1}
            title="Previous page"
          >
            ‹
          </button>
          <input
            className="page-input"
            value={pageField}
            inputMode="numeric"
            onChange={(e) => setPageField(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToPage(Number(pageField));
            }}
            onBlur={() => goToPage(Number(pageField))}
            aria-label="Go to page"
          />
          <span className="page-total">/ {numPages || "…"}</span>
          <button
            className="page-btn"
            onClick={() => goToPage(curPage + 1)}
            disabled={numPages > 0 && curPage >= numPages}
            title="Next page"
          >
            ›
          </button>
        </div>
      </div>
      {status === "loading" && <div className="viewer-msg">Loading PDF…</div>}
      {status === "error" && <div className="viewer-msg error">Couldn’t open PDF: {error}</div>}
      <div ref={containerRef} className="pdf-pages" />
      {fab && (
        <button
          className="hl-fab"
          style={{ left: fab.x + 4, top: fab.y + 6 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={confirmHighlight}
        >
          🖍 Highlight
        </button>
      )}
      {editing &&
        (() => {
          const h = highlights.find((x) => x.id === editing.id);
          if (!h) return null;
          return (
            <HighlightNote
              key={h.id}
              hl={h}
              x={editing.x}
              y={editing.y}
              onSave={(note) => {
                updateNote(h.id, note);
                setEditing(null);
              }}
              onRemove={() => {
                removeHighlight(h.id);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          );
        })()}
    </div>
  );
}

function HighlightNote({
  hl,
  x,
  y,
  onSave,
  onRemove,
  onClose,
}: {
  hl: Highlight;
  x: number;
  y: number;
  onSave: (note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(hl.note);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Keep the popover within the viewport.
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y + 8, window.innerHeight - 220);

  return (
    <div className="hl-note-pop" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="hl-note-quote" style={{ borderColor: hl.color }}>
        {hl.text.length > 240 ? `${hl.text.slice(0, 240)}…` : hl.text}
      </div>
      <textarea
        ref={ref}
        className="hl-note-area"
        placeholder="Add a note…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(note);
        }}
      />
      <div className="hl-note-actions">
        <button className="danger-text" onClick={onRemove} title="Delete highlight">
          🗑 Delete
        </button>
        <div className="hl-note-right">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(note)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
