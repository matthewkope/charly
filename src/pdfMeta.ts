// Retrieve bibliographic metadata for a PDF (Zotero-style "Retrieve Metadata").
// DOI-first: pull text from the first pages with pdf.js, find a DOI, then reuse
// the existing identifier lookup + item machinery. No backend changes needed.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  attachToItem,
  createItem,
  fetchIdentifier,
  getItem,
  readFileBytes,
  saveItem,
} from "./api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// A DOI: "10." then a registrant code, then a slash and the suffix.
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/;

/** Extract a DOI from the first few pages of a PDF, or null if none is found. */
export async function extractDoiFromPdf(path: string): Promise<string | null> {
  let doc: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const bytes = await readFileBytes(path);
    doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = Math.min(3, doc.numPages);
    let text = "";
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    const m = text.match(DOI_RE);
    if (!m) return null;
    return m[0].replace(/[.,;:)]+$/, ""); // trim trailing punctuation
  } catch {
    return null;
  } finally {
    doc?.destroy();
  }
}

/**
 * Try to turn a PDF into a populated bibliographic item: find its DOI, look up
 * the metadata, create a `.charlyitem` in `folder`, and attach the PDF to it.
 * Returns true if an item was created, false if no DOI / lookup failed (so the
 * caller can fall back to a plain import).
 */
export async function retrievePdfMetadata(folder: string, pdfPath: string): Promise<boolean> {
  const doi = await extractDoiFromPdf(pdfPath);
  if (!doi) return false;

  let fetched;
  try {
    fetched = await fetchIdentifier(doi);
  } catch {
    return false; // network/lookup failure → let caller import the file plainly
  }

  const title = fetched.fields.title || pdfPath.split("/").pop() || "Untitled";
  const itemPath = await createItem(folder, fetched.itemType, title);

  const item = await getItem(itemPath);
  item.fields = { ...item.fields, ...fetched.fields };
  item.creators = fetched.creators;
  await saveItem(itemPath, item);

  // Copies the PDF into the item's folder and records it as an attachment.
  await attachToItem(itemPath, [pdfPath]);
  return true;
}
