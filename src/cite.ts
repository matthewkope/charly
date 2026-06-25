// Self-contained citation + export formatters for bibliographic items.
// Built-in styles (APA/MLA/Chicago) are hand-rolled approximations — no CSL
// engine dependency, so no relicensing is required. A full citeproc/CSL engine
// can be layered on later for the long tail of styles.
import { Creator, Item } from "./api";

export type CitationStyle = "apa" | "mla" | "chicago";
export type ExportFormat = "bibtex" | "ris" | "csljson";

const f = (item: Item, ...keys: string[]): string => {
  for (const k of keys) {
    const v = item.fields[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
};

const authorsOf = (item: Item): Creator[] =>
  item.creators.filter((c) => (c.creatorType || "author") === "author");

const title = (item: Item) => f(item, "title");
const year = (item: Item) => (f(item, "date", "issued", "year").match(/\d{4}/) ?? [""])[0];
const container = (item: Item) =>
  f(item, "publicationTitle", "bookTitle", "proceedingsTitle", "encyclopediaTitle", "blogTitle", "websiteTitle");
const pages = (item: Item) => f(item, "pages");
const doi = (item: Item) => f(item, "DOI");
const url = (item: Item) => f(item, "url");

const initials = (first: string) =>
  first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(" ");

const last = (c: Creator) => (c.last || c.first || "").trim();
const firstName = (c: Creator) => (c.first || "").trim();

// ---- Built-in citation styles -------------------------------------------

function apaAuthors(cr: Creator[]): string {
  const names = cr.map((c) => (firstName(c) ? `${last(c)}, ${initials(firstName(c))}` : last(c)));
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

function mlaAuthors(cr: Creator[]): string {
  if (cr.length === 0) return "";
  const head = `${last(cr[0])}${firstName(cr[0]) ? `, ${firstName(cr[0])}` : ""}`;
  if (cr.length === 1) return head;
  if (cr.length === 2) return `${head}, and ${firstName(cr[1])} ${last(cr[1])}`.trim();
  return `${head}, et al`;
}

function chicagoAuthors(cr: Creator[]): string {
  if (cr.length === 0) return "";
  const head = `${last(cr[0])}${firstName(cr[0]) ? `, ${firstName(cr[0])}` : ""}`;
  const rest = cr.slice(1).map((c) => `${firstName(c)} ${last(c)}`.trim());
  return [head, ...rest].join(", and ");
}

function dot(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

export function formatCitation(item: Item, style: CitationStyle): string {
  const cr = authorsOf(item);
  const t = title(item);
  const y = year(item);
  const c = container(item);
  const p = pages(item);
  const vol = f(item, "volume");
  const iss = f(item, "issue");
  const link = doi(item) ? `https://doi.org/${doi(item)}` : url(item);

  if (style === "apa") {
    const parts = [dot(apaAuthors(cr)), y ? `(${y}).` : "", dot(t)];
    if (c) {
      let cont = c;
      if (vol) cont += `, ${vol}`;
      if (iss) cont += `(${iss})`;
      if (p) cont += `, ${p}`;
      parts.push(dot(cont));
    }
    if (link) parts.push(link);
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  if (style === "mla") {
    const parts = [dot(mlaAuthors(cr)), t ? `“${dot(t)}”` : ""];
    const cont: string[] = [];
    if (c) cont.push(c);
    if (vol) cont.push(`vol. ${vol}`);
    if (iss) cont.push(`no. ${iss}`);
    if (y) cont.push(y);
    if (p) cont.push(`pp. ${p}`);
    if (cont.length) parts.push(dot(cont.join(", ")));
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  // chicago (author-date)
  const parts = [dot(chicagoAuthors(cr)), y ? `${y}.` : "", t ? `“${dot(t)}”` : ""];
  if (c) {
    let cont = c;
    if (vol) cont += ` ${vol}`;
    if (iss) cont += ` (${iss})`;
    if (p) cont += `: ${p}`;
    parts.push(dot(cont));
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function formatBibliography(items: Item[], style: CitationStyle): string {
  return items
    .map((it) => formatCitation(it, style))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("\n\n");
}

// ---- Machine-readable export --------------------------------------------

function citeKey(item: Item): string {
  const a = authorsOf(item)[0];
  const name = (a ? last(a) : title(item).split(/\s+/)[0] || "ref").replace(/[^A-Za-z0-9]/g, "");
  const word = (title(item).split(/\s+/).find((w) => w.length > 3) ?? "").replace(/[^A-Za-z0-9]/g, "");
  return `${name}${year(item)}${word}`.toLowerCase() || "ref";
}

const BIB_TYPE: Record<string, string> = {
  journalArticle: "article",
  book: "book",
  bookSection: "incollection",
  conferencePaper: "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  manuscript: "unpublished",
};

export function toBibTeX(item: Item): string {
  const type = BIB_TYPE[item.itemType] ?? "misc";
  const rows: [string, string][] = [];
  const add = (k: string, v: string) => v && rows.push([k, v]);
  add("author", authorsOf(item).map((c) => `${last(c)}, ${firstName(c)}`.replace(/, $/, "")).join(" and "));
  add("title", title(item));
  add("year", year(item));
  add(item.itemType === "bookSection" ? "booktitle" : "journal", container(item));
  add("volume", f(item, "volume"));
  add("number", f(item, "issue"));
  add("pages", pages(item).replace(/-/g, "--"));
  add("publisher", f(item, "publisher"));
  add("address", f(item, "place"));
  add("edition", f(item, "edition"));
  add("doi", doi(item));
  add("url", url(item));
  add("isbn", f(item, "ISBN"));
  add("abstract", f(item, "abstractNote"));
  const body = rows.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${citeKey(item)},\n${body}\n}`;
}

const RIS_TYPE: Record<string, string> = {
  journalArticle: "JOUR",
  book: "BOOK",
  bookSection: "CHAP",
  conferencePaper: "CONF",
  thesis: "THES",
  report: "RPRT",
  webpage: "ELEC",
};

export function toRIS(item: Item): string {
  const lines: string[] = [`TY  - ${RIS_TYPE[item.itemType] ?? "GEN"}`];
  const add = (tag: string, v: string) => v && lines.push(`${tag}  - ${v}`);
  authorsOf(item).forEach((c) => add("AU", `${last(c)}, ${firstName(c)}`.replace(/, $/, "")));
  add("TI", title(item));
  add("PY", year(item));
  add("T2", container(item));
  add("VL", f(item, "volume"));
  add("IS", f(item, "issue"));
  const [sp, ep] = pages(item).split(/[-–]/);
  add("SP", (sp ?? "").trim());
  add("EP", (ep ?? "").trim());
  add("PB", f(item, "publisher"));
  add("DO", doi(item));
  add("UR", url(item));
  add("SN", f(item, "ISBN", "ISSN"));
  add("AB", f(item, "abstractNote"));
  lines.push("ER  - ");
  return lines.join("\n");
}

const CSL_TYPE: Record<string, string> = {
  journalArticle: "article-journal",
  book: "book",
  bookSection: "chapter",
  conferencePaper: "paper-conference",
  thesis: "thesis",
  report: "report",
  webpage: "webpage",
  blogPost: "post-weblog",
  magazineArticle: "article-magazine",
  newspaperArticle: "article-newspaper",
};

export function toCSL(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: citeKey(item),
    type: CSL_TYPE[item.itemType] ?? "document",
  };
  if (title(item)) out.title = title(item);
  const auth = authorsOf(item).map((c) => ({ family: last(c), given: firstName(c) }));
  if (auth.length) out.author = auth;
  if (container(item)) out["container-title"] = container(item);
  if (year(item)) out.issued = { "date-parts": [[Number(year(item))]] };
  for (const [k, key] of [
    ["volume", "volume"],
    ["issue", "issue"],
    ["page", "pages"],
    ["publisher", "publisher"],
    ["DOI", "DOI"],
    ["URL", "url"],
    ["abstract", "abstractNote"],
    ["ISBN", "ISBN"],
  ] as const) {
    const v = f(item, key);
    if (v) out[k] = v;
  }
  return out;
}

export function exportItems(items: Item[], format: ExportFormat): string {
  if (format === "bibtex") return items.map(toBibTeX).join("\n\n");
  if (format === "ris") return items.map(toRIS).join("\n");
  return JSON.stringify(items.map(toCSL), null, 2);
}
