import { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import ePub from "epubjs";
import { Entry, readCharlyLink, readFileBytes } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type State = "loading" | "ready" | "none";

function coverIcon(ext: string): string {
  if (ext === "pdf") return "📕";
  if (ext === "epub") return "📗";
  if (ext === "charlylink") return "🔗";
  return "📄";
}

// Render a small preview image for an item: the link's thumbnail, a PDF's
// first page, or an EPUB's cover. Falls back to a glyph when none is available.
// `onInfo` reports facts discovered while loading (e.g. a PDF's page count).
export default function Cover({
  entry,
  className,
  onInfo,
}: {
  entry: Entry;
  className?: string;
  onInfo?: (info: { pages?: number }) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    let revoke: string | null = null;
    setState("loading");
    setSrc(null);

    (async () => {
      try {
        if (entry.ext === "charlylink") {
          const meta = await readCharlyLink(entry.path);
          if (cancelled) return;
          if (meta.image) {
            setSrc(meta.image);
            setState("ready");
          } else {
            setState("none");
          }
        } else if (entry.ext === "pdf") {
          const data = await readFileBytes(entry.path);
          if (cancelled) return;
          const doc = await pdfjsLib.getDocument({ data }).promise;
          if (!cancelled) onInfo?.({ pages: doc.numPages });
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 480 / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
          }
          doc.destroy();
          if (cancelled) return;
          setSrc(ctx ? canvas.toDataURL("image/jpeg", 0.82) : null);
          setState(ctx ? "ready" : "none");
        } else if (entry.ext === "epub") {
          const bytes = await readFileBytes(entry.path);
          if (cancelled) return;
          const book = ePub(bytes.buffer as ArrayBuffer);
          const url = await book.coverUrl();
          if (cancelled) return;
          if (url) {
            revoke = url;
            setSrc(url);
            setState("ready");
          } else {
            setState("none");
          }
        } else {
          setState("none");
        }
      } catch {
        if (!cancelled) setState("none");
      }
    })();

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [entry.path, entry.ext]);

  return (
    <div className={className}>
      {state === "ready" && src ? (
        <img src={src} alt="" onError={() => setState("none")} />
      ) : state === "loading" ? (
        <div className="cover-loading" />
      ) : (
        <div className="cover-fallback">{coverIcon(entry.ext)}</div>
      )}
    </div>
  );
}
