import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Highlight, readFileBytes } from "../api";
import PdfViewer from "./PdfViewer";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Section = "contents" | "pages" | "highlights";

interface OutlineRow {
  title: string;
  page: number | null;
  depth: number;
}

// A PDF tab: the document plus a left nav pane (contents / pages / highlights).
export default function DocReader({
  path,
  library,
  active,
}: {
  path: string;
  library?: string | null;
  active: boolean;
}) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [nav, setNav] = useState<{ page: number; nonce: number } | null>(null);

  const goTo = (page: number) => setNav((n) => ({ page, nonce: (n?.nonce ?? 0) + 1 }));

  return (
    <div className="doc-reader">
      <DocNav path={path} highlights={highlights} activePage={nav?.page ?? null} onGoTo={goTo} />
      <PdfViewer
        path={path}
        library={library}
        active={active}
        onHighlightsChange={setHighlights}
        targetPage={nav?.page ?? null}
        targetNonce={nav?.nonce ?? 0}
      />
    </div>
  );
}

function DocNav({
  path,
  highlights,
  activePage,
  onGoTo,
}: {
  path: string;
  highlights: Highlight[];
  activePage: number | null;
  onGoTo: (page: number) => void;
}) {
  const [section, setSection] = useState<Section>("pages");
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [outline, setOutline] = useState<OutlineRow[]>([]);

  // Load the document (independently of the main viewer) for TOC + thumbnails.
  useEffect(() => {
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    (async () => {
      try {
        const data = await readFileBytes(path);
        if (cancelled) return;
        loaded = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          loaded.destroy();
          return;
        }
        setDoc(loaded);
        setOutline(await buildOutline(loaded));
      } catch {
        /* ignore — pane just shows empty states */
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [path]);

  const sortedHl = [...highlights].sort(
    (a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
  );

  return (
    <div className="doc-nav">
      <div className="doc-nav-tabs">
        <button
          className={section === "contents" ? "active" : ""}
          onClick={() => setSection("contents")}
          title="Table of contents"
        >
          Contents
        </button>
        <button
          className={section === "pages" ? "active" : ""}
          onClick={() => setSection("pages")}
          title="Page thumbnails"
        >
          Pages
        </button>
        <button
          className={section === "highlights" ? "active" : ""}
          onClick={() => setSection("highlights")}
          title="Saved highlights"
        >
          Notes{highlights.length ? ` (${highlights.length})` : ""}
        </button>
      </div>

      <div className="doc-nav-body">
        {section === "contents" &&
          (outline.length === 0 ? (
            <div className="doc-nav-empty">No table of contents in this document.</div>
          ) : (
            <ul className="toc">
              {outline.map((row, i) => (
                <li
                  key={i}
                  className={`toc-row${row.page && row.page === activePage ? " active" : ""}${
                    row.page ? "" : " toc-flat"
                  }`}
                  style={{ paddingLeft: 10 + row.depth * 14 }}
                  onClick={() => row.page && onGoTo(row.page)}
                  title={row.title}
                >
                  <span className="toc-title">{row.title}</span>
                  {row.page && <span className="toc-page">{row.page}</span>}
                </li>
              ))}
            </ul>
          ))}

        {section === "pages" &&
          (doc ? (
            <div className="thumbs">
              {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((p) => (
                <Thumb
                  key={p}
                  doc={doc}
                  page={p}
                  active={p === activePage}
                  onClick={() => onGoTo(p)}
                />
              ))}
            </div>
          ) : (
            <div className="doc-nav-empty">Loading pages…</div>
          ))}

        {section === "highlights" &&
          (sortedHl.length === 0 ? (
            <div className="doc-nav-empty">
              No highlights yet. Select text in the document to highlight it.
            </div>
          ) : (
            <ul className="hl-list">
              {sortedHl.map((h) => (
                <li
                  key={h.id}
                  className={`hl-item${h.page === activePage ? " active" : ""}`}
                  onClick={() => onGoTo(h.page)}
                >
                  <span className="hl-item-bar" style={{ background: h.color }} />
                  <div className="hl-item-body">
                    <div className="hl-item-head">
                      <span className="hl-item-page">Page {h.page}</span>
                    </div>
                    <div className="hl-item-text">{h.text}</div>
                    {h.note.trim() && <div className="hl-item-note">📝 {h.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}

// A single lazily-rendered page thumbnail (renders when scrolled into view).
function Thumb({
  doc,
  page,
  active,
  onClick,
}: {
  doc: pdfjsLib.PDFDocumentProxy;
  page: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || url) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        (async () => {
          try {
            const p = await doc.getPage(page);
            if (cancelled) return;
            const base = p.getViewport({ scale: 1 });
            const viewport = p.getViewport({ scale: 150 / base.width });
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext("2d");
            if (ctx) await p.render({ canvasContext: ctx, viewport }).promise;
            if (!cancelled) setUrl(canvas.toDataURL("image/jpeg", 0.7));
          } catch {
            /* leave skeleton */
          }
        })();
      },
      { root: el.closest(".doc-nav-body"), rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, page, url]);

  return (
    <button ref={ref} className={`thumb${active ? " active" : ""}`} onClick={onClick}>
      <span className="thumb-img">
        {url ? <img src={url} alt={`Page ${page}`} /> : <span className="thumb-skel" />}
      </span>
      <span className="thumb-num">{page}</span>
    </button>
  );
}

async function buildOutline(doc: pdfjsLib.PDFDocumentProxy): Promise<OutlineRow[]> {
  let raw: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>;
  try {
    raw = await doc.getOutline();
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  const rows: OutlineRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = async (items: any[], depth: number) => {
    for (const it of items) {
      let page: number | null = null;
      try {
        const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
        if (Array.isArray(dest) && dest[0]) {
          page = (await doc.getPageIndex(dest[0])) + 1;
        }
      } catch {
        /* unresolved destination — show the title without a page link */
      }
      rows.push({ title: it.title || "Untitled", page, depth });
      if (it.items?.length) await walk(it.items, depth + 1);
    }
  };
  await walk(raw, 0);
  return rows;
}
