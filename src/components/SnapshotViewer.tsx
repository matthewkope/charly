import { useEffect, useState } from "react";
import { CharlyLink, openCharlyLink, readCharlyLink } from "../api";

// Reads a clipped web page's saved snapshot and shows it in Charly's reader,
// like Zotero's Snapshot attachment. "Open original" opens the live page.
export default function SnapshotViewer({ path }: { path: string }) {
  const [data, setData] = useState<CharlyLink | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none">("loading");

  useEffect(() => {
    setStatus("loading");
    readCharlyLink(path)
      .then((d) => {
        setData(d);
        setStatus(d.snapshot ? "ready" : "none");
      })
      .catch(() => setStatus("none"));
  }, [path]);

  if (status === "loading") return <div className="viewer-msg">Loading snapshot…</div>;

  return (
    <div className="viewer snapshot-viewer">
      <div className="viewer-toolbar snapshot-bar">
        <span className="snapshot-site">{data?.site || data?.url || ""}</span>
        <button onClick={() => openCharlyLink(path).catch(() => {})}>Open original ↗</button>
      </div>
      {status === "ready" && data?.snapshot ? (
        <div className="snapshot-body">
          <article
            className="snapshot-article"
            // Snapshot HTML is built from escaped text + a fixed tag whitelist
            // in the backend (extract_snapshot), so it carries no scripts.
            dangerouslySetInnerHTML={{ __html: data.snapshot }}
          />
        </div>
      ) : (
        <div className="empty">
          <div className="empty-art">🔗</div>
          <p>
            No saved snapshot for this link.
            <br />
            Use “Open original” to view it in your browser.
          </p>
        </div>
      )}
    </div>
  );
}
