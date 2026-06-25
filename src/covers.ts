// Render a small page-1 thumbnail for a PDF, used as a cover image in the item
// list. Results are cached in-module and in localStorage so repeat loads (and
// re-renders across sessions) are instant.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readFileBytes } from "./api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Target thumbnail width in CSS px; height follows the page aspect ratio.
const TARGET_WIDTH = 96;
const CACHE_PREFIX = "charly.cover.v1:";

// In-memory cache of path -> data URL (or null when rendering failed).
const memCache = new Map<string, string | null>();

/**
 * Return a page-1 PNG thumbnail (data URL) for the PDF at `path`, or null if it
 * can't be rendered. Caches results in-module and in localStorage.
 */
export async function getPdfCover(path: string): Promise<string | null> {
  // 1) In-memory cache (covers both success and known-failure).
  if (memCache.has(path)) return memCache.get(path) ?? null;

  // 2) localStorage cache.
  const lsKey = CACHE_PREFIX + path;
  try {
    const cached = localStorage.getItem(lsKey);
    if (cached) {
      memCache.set(path, cached);
      return cached;
    }
  } catch {
    /* localStorage may be unavailable — fall through to render */
  }

  // 3) Render page 1 to an offscreen canvas.
  let doc: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const bytes = await readFileBytes(path);
    doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      memCache.set(path, null);
      return null;
    }
    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    memCache.set(path, dataUrl);
    try {
      localStorage.setItem(lsKey, dataUrl);
    } catch {
      /* quota exceeded or unavailable — in-memory cache still applies */
    }
    return dataUrl;
  } catch {
    memCache.set(path, null); // remember the failure so we don't retry every render
    return null;
  } finally {
    doc?.destroy();
  }
}
