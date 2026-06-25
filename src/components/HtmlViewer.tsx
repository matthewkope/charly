import { useEffect, useState } from "react";
import { readFileBytes } from "../api";

// Renders a saved .html file (e.g. a web-page Snapshot attachment) in a
// sandboxed iframe — no scripts run, images/styles load from the original site.
export default function HtmlViewer({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(false);
    readFileBytes(path)
      .then((b) => {
        if (!cancelled) setHtml(new TextDecoder().decode(b));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <div className="viewer-msg error">Couldn’t open this snapshot.</div>;
  if (html === null) return <div className="viewer-msg">Loading snapshot…</div>;
  return (
    <div className="viewer">
      <iframe className="snapshot-frame" sandbox="" srcDoc={html} title="Snapshot" />
    </div>
  );
}
