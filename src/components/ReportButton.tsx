import { useState } from "react";
import {
  getItem,
  getItemMeta,
  listItems,
  openFilePath,
  pickSavePath,
  writeTextFile,
  type Creator,
} from "../api";
import { buildReportHtml, type ReportRow } from "../report";

// Human-readable date from unix seconds (string) or milliseconds (number).
function fmtDate(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const ms = typeof value === "number" ? value : Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString();
}

function fmtCreators(creators: Creator[]): string {
  return creators
    .map((c) => [c.last, c.first].filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
}

// Bibliographic fields worth surfacing in a report, in display order.
const FIELD_LABELS: [string, string][] = [
  ["publicationTitle", "Publication"],
  ["bookTitle", "Book"],
  ["date", "Date"],
  ["publisher", "Publisher"],
  ["volume", "Volume"],
  ["issue", "Issue"],
  ["pages", "Pages"],
  ["DOI", "DOI"],
  ["ISBN", "ISBN"],
  ["url", "URL"],
  ["abstractNote", "Abstract"],
];

/** "Generate Report" — builds a standalone HTML report of the folder's items. */
export default function ReportButton({
  library,
  folder,
  folderName,
}: {
  library: string;
  folder: string;
  folderName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const files = await listItems(library, folder);
      if (files.length === 0) {
        setMsg("No items here");
        return;
      }

      const rows: ReportRow[] = await Promise.all(
        files.map(async (f): Promise<ReportRow> => {
          // Tags + note live in the meta index for every file type.
          const meta = await getItemMeta(library, f.path).catch(() => null);

          if (f.ext === "charlyitem") {
            const item = await getItem(f.path).catch(() => null);
            if (item) {
              return {
                title: item.fields.title || f.title || f.name,
                itemType: item.itemType,
                creators: fmtCreators(item.creators),
                fields: FIELD_LABELS.map(([k, label]) => [label, item.fields[k] ?? ""]),
                tags: meta?.tags ?? [],
                note: meta?.note ?? "",
                attachments: item.attachments,
                dateAdded: fmtDate(item.dateAdded),
              };
            }
          }

          // Plain document (PDF/EPUB/link) — report what we know.
          return {
            title: f.title || f.name,
            itemType: f.ext.toUpperCase(),
            creators: f.creator,
            tags: meta?.tags ?? [],
            note: meta?.note ?? "",
            dateAdded: fmtDate(f.modified_ms),
          };
        }),
      );

      const title = `${folderName} — Report`;
      const html = buildReportHtml(title, new Date().toLocaleString(), rows);

      const dest = await pickSavePath(`${folderName} report.html`);
      if (!dest) {
        setMsg(null);
        return; // user cancelled
      }
      await writeTextFile(dest, html);
      // Best-effort: open the saved report; a failure here doesn't undo the save.
      await openFilePath(dest).catch(() => {});
      setMsg(`Report saved (${rows.length})`);
    } catch {
      setMsg("Couldn’t build report");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2000);
    }
  };

  return (
    <div className="cite-wrap">
      <button
        className="icon-btn cite-folder-btn"
        title="Generate an HTML report of this folder's items"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          run();
        }}
      >
        {busy ? "…" : "Report"}
      </button>
      {msg && <span className="cite-copied">{msg}</span>}
    </div>
  );
}
