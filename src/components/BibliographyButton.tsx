import { useEffect, useState } from "react";
import { getItem, Item, listItems } from "../api";
import { CitationStyle, formatBibliography } from "../cite";

const STYLES: { key: CitationStyle; label: string }[] = [
  { key: "apa", label: "APA" },
  { key: "mla", label: "MLA" },
  { key: "chicago", label: "Chicago" },
];

// Copies a formatted bibliography of the current folder's bibliographic items.
export default function BibliographyButton({
  library,
  folder,
}: {
  library: string;
  folder: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const run = async (style: CitationStyle) => {
    setOpen(false);
    setBusy(true);
    setMsg(null);
    try {
      const files = await listItems(library, folder);
      const itemPaths = files.filter((f) => f.ext === "charlyitem");
      if (itemPaths.length === 0) {
        setMsg("No items here");
        return;
      }
      const records = (
        await Promise.all(itemPaths.map((f) => getItem(f.path).catch(() => null)))
      ).filter((r): r is Item => r !== null);
      await navigator.clipboard.writeText(formatBibliography(records, style));
      setMsg(`Copied ${records.length} (${style.toUpperCase()})`);
    } catch {
      setMsg("Couldn’t build bibliography");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 1800);
    }
  };

  return (
    <div className="cite-wrap">
      <button
        className="icon-btn cite-folder-btn"
        title="Copy a bibliography of this folder's items"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {busy ? "…" : "Cite ▾"}
      </button>
      {open && (
        <div className="cite-menu" onClick={(e) => e.stopPropagation()}>
          {STYLES.map((s) => (
            <button key={s.key} onClick={() => run(s.key)}>
              Copy bibliography ({s.label})
            </button>
          ))}
        </div>
      )}
      {msg && <span className="cite-copied">{msg}</span>}
    </div>
  );
}
