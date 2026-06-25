import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
  ext: string;
}

export const SUPPORTED_EXTS = ["pdf", "epub"] as const;
export type SupportedExt = (typeof SUPPORTED_EXTS)[number];

export function isSupported(ext: string): ext is SupportedExt {
  return (SUPPORTED_EXTS as readonly string[]).includes(ext);
}

export const getLibrary = () => invoke<string | null>("get_library");
export const setLibrary = (path: string) => invoke<void>("set_library", { path });
export const listDir = (path: string) => invoke<Entry[]>("list_dir", { path });
export const createFolder = (parent: string, name: string) =>
  invoke<string>("create_folder", { parent, name });
export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });
export const deleteEntry = (path: string) => invoke<void>("delete_entry", { path });
export const moveEntry = (path: string, destDir: string) =>
  invoke<string>("move_entry", { path, destDir });
export const importFiles = (targetDir: string, sources: string[]) =>
  invoke<string[]>("import_files", { targetDir, sources });
export const searchLibrary = (root: string, query: string) =>
  invoke<Entry[]>("search", { root, query });

/** Read a document's raw bytes for in-app rendering. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return new Uint8Array(buf);
}

/** Native folder picker. Returns the chosen path, or null if cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

/** Native multi-file picker for PDFs/EPUBs. */
export async function pickDocuments(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ---- Tags & notes --------------------------------------------------------

export interface ItemMeta {
  title: string;
  tags: string[];
  note: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface FileInfo {
  modified_ms: number;
  size: number;
}

export const getItemMeta = (library: string, path: string) =>
  invoke<ItemMeta>("get_item_meta", { library, path });
export const setItemTags = (library: string, path: string, tags: string[]) =>
  invoke<void>("set_item_tags", { library, path, tags });
export const setItemNote = (library: string, path: string, note: string) =>
  invoke<void>("set_item_note", { library, path, note });
export const setItemTitle = (library: string, path: string, title: string) =>
  invoke<void>("set_item_title", { library, path, title });
export const fileInfo = (path: string) => invoke<FileInfo>("file_info", { path });

/** A file row for the item-list home view. */
export interface FileItem {
  name: string;
  path: string;
  ext: string;
  title: string; // alias; empty → fall back to filename
  creator: string;
  modified_ms: number;
  size: number;
}

export const listItems = (library: string, folder: string) =>
  invoke<FileItem[]>("list_items", { library, folder });
/** Every file in the library (recursive) — for "All Items"/"Recently Added". */
export const libraryItems = (library: string) =>
  invoke<FileItem[]>("library_items", { library });

/** A trashed item recorded in the library's .charly/Trash. */
export interface TrashEntry {
  name: string;
  trash_name: string;
  origin: string;
  deleted_ms: number;
}
export const trashItem = (library: string, path: string) =>
  invoke<void>("trash_item", { library, path });
export const listTrash = (library: string) => invoke<TrashEntry[]>("list_trash", { library });
export const restoreTrash = (library: string, trashName: string) =>
  invoke<string>("restore_trash", { library, trashName });
export const emptyTrash = (library: string) => invoke<void>("empty_trash", { library });

// ---- Saved searches (rule-based virtual collections) ---------------------

export interface SearchRule {
  field: "title" | "tag" | "type";
  op: "contains" | "is";
  value: string;
}
export interface SavedSearch {
  id: string;
  name: string;
  match: "all" | "any";
  rules: SearchRule[];
}
export const listSavedSearches = (library: string) =>
  invoke<SavedSearch[]>("list_saved_searches", { library });
export const saveSavedSearch = (library: string, search: SavedSearch) =>
  invoke<SavedSearch[]>("save_saved_search", { library, search });
export const deleteSavedSearch = (library: string, id: string) =>
  invoke<SavedSearch[]>("delete_saved_search", { library, id });
export const runSavedSearch = (library: string, search: SavedSearch) =>
  invoke<FileItem[]>("run_saved_search", { library, search });
export const listAllTags = (library: string) =>
  invoke<TagCount[]>("list_all_tags", { library });
export const findByTag = (library: string, tag: string) =>
  invoke<Entry[]>("find_by_tag", { library, tag });

/** Open an external URL in the user's default browser. */
export const openExternal = (url: string) => openUrl(url);

/** Open a local file in the OS default application (e.g. a saved report). */
export const openFilePath = (path: string) => openPath(path);

/** Write a UTF-8 text file (e.g. a generated report). */
export const writeTextFile = (path: string, contents: string) =>
  invoke<void>("write_text_file", { path, contents });

/** Native "Save As" dialog. Returns the chosen path, or null if cancelled. */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  return result ?? null;
}

/** Local clip server port (mirrors CLIP_PORT in src-tauri/src/lib.rs). */
const CLIP_PORT = 8765;

/**
 * Clip a dropped/added URL into the library through the local clip server —
 * the same endpoint the browser extension posts to. The backend fetches the
 * page metadata, saves a `.charlylink` (or downloads a PDF), and emits a
 * `clip-added` event so the open window refreshes itself.
 *
 * @param folder Library-relative folder; "" = library root, omit for "Inbox".
 */
export async function clipLink(url: string, folder = ""): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${CLIP_PORT}/clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, folder }),
  });
  if (!res.ok) {
    let msg = `Couldn’t save link (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(msg);
  }
}

/** Metadata stored in a `.charlylink` sidecar by the browser extension. */
export interface CharlyLink {
  url?: string;
  title?: string;
  site?: string;
  description?: string;
  kind?: string; // "webpage" | "youtube"
  image?: string; // remote cover/thumbnail URL
}

/** Read and parse a `.charlylink` sidecar file. */
export async function readCharlyLink(path: string): Promise<CharlyLink> {
  const bytes = await readFileBytes(path);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Read a `.charlylink` sidecar (saved by the browser extension) and open its URL. */
export async function openCharlyLink(path: string): Promise<void> {
  const data = await readCharlyLink(path);
  if (data?.url) await openUrl(data.url);
}

// ---- PDF highlights ------------------------------------------------------

/** A highlight rectangle in page-normalized coords (0..1). */
export interface HlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  page: number; // 1-based page number
  color: string;
  text: string;
  note: string; // Kindle-style annotation attached to the highlight
  rects: HlRect[];
}

export const getHighlights = (library: string, path: string) =>
  invoke<Highlight[]>("get_highlights", { library, path });
export const saveHighlights = (library: string, path: string, highlights: Highlight[]) =>
  invoke<void>("save_highlights", { library, path, highlights });

// ---- Bibliographic items (Zotero-style records) --------------------------

export interface Creator {
  first: string;
  last: string;
  creatorType: string;
}

export interface Item {
  itemType: string;
  fields: Record<string, string>;
  creators: Creator[];
  attachments: string[]; // relative filenames in the item's folder
  dateAdded: string; // unix seconds (string)
  dateModified: string;
}

/** Result of an identifier (DOI) lookup — merge into a new/existing item. */
export interface FetchedItem {
  itemType: string;
  fields: Record<string, string>;
  creators: Creator[];
}

export const createItem = (dir: string, itemType: string, title: string) =>
  invoke<string>("create_item", { dir, itemType, title });
export const getItem = (path: string) => invoke<Item>("get_item", { path });
export const saveItem = (path: string, item: Item) => invoke<void>("save_item", { path, item });
export const attachToItem = (path: string, sources: string[]) =>
  invoke<Item>("attach_to_item", { path, sources });
export const fetchIdentifier = (identifier: string) =>
  invoke<FetchedItem>("fetch_identifier", { identifier });
