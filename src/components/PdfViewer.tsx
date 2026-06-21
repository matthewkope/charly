import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readFileBytes } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfViewer({ path }: { path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

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

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.className = "pdf-page";
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
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
  }, [path, scale]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}>
          −
        </button>
        <span className="zoom-label">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>
          +
        </button>
      </div>
      {status === "loading" && <div className="viewer-msg">Loading PDF…</div>}
      {status === "error" && <div className="viewer-msg error">Couldn’t open PDF: {error}</div>}
      <div ref={containerRef} className="pdf-pages" />
    </div>
  );
}
