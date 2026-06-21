import { useEffect, useRef, useState } from "react";
// epub.js ships its own types but the default export typing is loose.
import ePub, { type Rendition } from "epubjs";
import { readFileBytes } from "../api";

export default function EpubViewer({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let book: ReturnType<typeof ePub> | null = null;

    (async () => {
      setStatus("loading");
      try {
        const bytes = await readFileBytes(path);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        book = ePub(bytes.buffer as ArrayBuffer);
        const rendition = book.renderTo(hostRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "auto",
        });
        renditionRef.current = rendition;
        await rendition.display();
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
      renditionRef.current?.destroy();
      renditionRef.current = null;
      book?.destroy();
    };
  }, [path]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button onClick={() => renditionRef.current?.prev()}>‹ Prev</button>
        <button onClick={() => renditionRef.current?.next()}>Next ›</button>
      </div>
      {status === "loading" && <div className="viewer-msg">Loading EPUB…</div>}
      {status === "error" && <div className="viewer-msg error">Couldn’t open EPUB: {error}</div>}
      <div ref={hostRef} className="epub-host" />
    </div>
  );
}
