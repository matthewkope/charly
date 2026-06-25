import { useEffect, useState } from "react";
import { CharlyLink, openCharlyLink, readCharlyLink, readFileBytes } from "../api";

function dirOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

// Renders a clipped web page's locally-saved snapshot inside Charly — like
// Zotero's Snapshot. The full page HTML is shown in a sandboxed iframe (no
// scripts), with images/styles resolving against the original site.
export default function SnapshotViewer({ path }: { path: string }) {
  const [data, setData] = useState<CharlyLink | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setHtml(null);
    (async () => {
      try {
        const d = await readCharlyLink(path);
        if (cancelled) return;
        setData(d);
        if (d.snapshot) {
          const bytes = await readFileBytes(`${dirOf(path)}/${d.snapshot}`);
          if (cancelled) return;
          setHtml(new TextDecoder().decode(bytes));
          setStatus("ready");
        } else {
          setStatus("none");
        }
      } catch {
        if (!cancelled) setStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="viewer snapshot-viewer">
      <div className="viewer-toolbar snapshot-bar">
        <span className="snapshot-site">{data?.site || data?.url || ""}</span>
        <button onClick={() => openCharlyLink(path).catch(() => {})}>Open original ↗</button>
      </div>
      {status === "loading" && <div className="viewer-msg">Loading snapshot…</div>}
      {status === "ready" && html ? (
        <iframe
          className="snapshot-frame"
          // Sandboxed with no allow-scripts: the page's own JS can't run, but
          // images and stylesheets still load. Safe to show clipped content.
          sandbox=""
          srcDoc={html}
          title={data?.title || "Snapshot"}
        />
      ) : status === "none" ? (
        <div className="empty">
          <div className="empty-art">🔗</div>
          <p>
            No saved snapshot for this link.
            <br />
            Use “Open original” to view it in your browser.
          </p>
        </div>
      ) : null}
    </div>
  );
}
