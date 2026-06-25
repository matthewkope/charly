// Build a self-contained, printable HTML report from library items.
// Pure string templating — no DOM, no dependencies — so it can be saved to a
// standalone .html file (Zotero-style "Generate Report").

export interface ReportRow {
  title: string;
  itemType?: string;
  creators?: string; // pre-formatted, e.g. "Smith, Jane; Doe, John"
  fields?: [string, string][]; // label/value pairs (publication, DOI, …)
  tags?: string[];
  note?: string; // plain text; rendered with preserved line breaks
  attachments?: string[];
  dateAdded?: string; // already human-formatted
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowHtml(r: ReportRow): string {
  const parts: string[] = [];
  parts.push(`<h2 class="title">${esc(r.title || "Untitled")}</h2>`);

  const meta: string[] = [];
  if (r.itemType) meta.push(`<span class="type">${esc(r.itemType)}</span>`);
  if (r.creators) meta.push(esc(r.creators));
  if (meta.length) parts.push(`<p class="meta">${meta.join(" · ")}</p>`);

  if (r.fields && r.fields.length) {
    const rows = r.fields
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
      .join("");
    if (rows) parts.push(`<table class="fields">${rows}</table>`);
  }

  if (r.tags && r.tags.length) {
    parts.push(
      `<p class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</p>`,
    );
  }

  if (r.note && r.note.trim()) {
    parts.push(`<div class="note">${esc(r.note)}</div>`);
  }

  if (r.attachments && r.attachments.length) {
    parts.push(
      `<p class="attachments">📎 ${r.attachments.map((a) => esc(a)).join(", ")}</p>`,
    );
  }

  if (r.dateAdded) parts.push(`<p class="added">Added ${esc(r.dateAdded)}</p>`);

  return `<section class="item">${parts.join("\n")}</section>`;
}

const STYLE = `
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #1d1d1f; max-width: 820px; margin: 32px auto; padding: 0 20px; }
  header { border-bottom: 2px solid #e6e6ea; padding-bottom: 12px; margin-bottom: 8px; }
  header h1 { font-size: 22px; margin: 0 0 4px; }
  header .sub { color: #8a8a8f; font-size: 13px; }
  .item { padding: 16px 0; border-bottom: 1px solid #ececef; }
  .item .title { font-size: 16px; margin: 0 0 4px; }
  .item .meta { color: #555; margin: 0 0 8px; }
  .item .type { text-transform: capitalize; font-weight: 600; }
  table.fields { border-collapse: collapse; margin: 6px 0; width: 100%; }
  table.fields th { text-align: left; color: #8a8a8f; font-weight: 500; width: 130px;
                    vertical-align: top; padding: 2px 10px 2px 0; }
  table.fields td { padding: 2px 0; }
  .tags { margin: 8px 0 0; }
  .tag { background: #e8f0fe; color: #2f6fed; border-radius: 5px; padding: 1px 7px; font-size: 12px; }
  .note { white-space: pre-wrap; background: #f7f7f8; border-radius: 8px; padding: 10px 12px; margin: 8px 0 0; }
  .attachments, .added { color: #8a8a8f; font-size: 12.5px; margin: 8px 0 0; }
  @media print { body { margin: 0; max-width: none; } .item { break-inside: avoid; } }
`;

export function buildReportHtml(
  reportTitle: string,
  generatedOn: string,
  rows: ReportRow[],
): string {
  const body = rows.length
    ? rows.map(rowHtml).join("\n")
    : `<p class="sub">No items to report.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(reportTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>${esc(reportTitle)}</h1>
  <div class="sub">${rows.length} item${rows.length === 1 ? "" : "s"} · generated ${esc(generatedOn)}</div>
</header>
${body}
</body>
</html>`;
}
