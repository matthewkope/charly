import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

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

/** Native multi-file picker for PDFs only (person papers). */
export async function pickPdfs(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ---- People --------------------------------------------------------------

export interface Source {
  id: string;
  kind: "pdf" | "webpage" | "youtube";
  url: string | null;
  title: string;
  description: string | null;
  site: string | null;
  thumb: string | null; // relative to person dir
  file: string | null; // relative pdf filename
}

export interface Person {
  dir: string;
  name: string;
  summary: string;
  photo: string | null; // relative avatar filename
  sources: Source[];
}

export const listPeople = (library: string) => invoke<Person[]>("list_people", { library });
export const createPerson = (library: string, name: string) =>
  invoke<Person>("create_person", { library, name });
export const updatePerson = (dir: string, name: string, summary: string) =>
  invoke<Person>("update_person", { dir, name, summary });
export const deletePerson = (dir: string) => invoke<void>("delete_person", { dir });
export const removeSource = (dir: string, id: string) =>
  invoke<Person>("remove_source", { dir, id });
export const importPersonPdfs = (dir: string, sources: string[]) =>
  invoke<Person>("import_person_pdfs", { dir, sources });
export const setPhotoFromLink = (dir: string, link: string) =>
  invoke<Person>("set_photo_from_link", { dir, link });
export const addSource = (dir: string, link: string) =>
  invoke<Person>("add_source", { dir, link });

/** Join a person's folder with a relative file path. */
export function joinPath(dir: string, rel: string): string {
  return `${dir}/${rel}`;
}

/** Open an external URL in the user's default browser. */
export const openExternal = (url: string) => openUrl(url);
