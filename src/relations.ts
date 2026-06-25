// Portable "related items" store, kept in a sidecar file at
// `<library>/.charly/relations.json`. The file is an object mapping an
// item path -> array of related item paths. Relations are bidirectional:
// adding a↔b stores b under a AND a under b; removing drops both directions.
//
// Reads tolerate a missing/corrupt file (→ {}). Writes reuse the existing
// `write_text_file` Rust command, so no new backend is required.
import { readFileBytes, writeTextFile } from "./api";

/** itemPath -> related itemPaths. */
export type RelationsMap = Record<string, string[]>;

function relationsPath(library: string): string {
  return `${library}/.charly/relations.json`;
}

/** Load the relations map for a library. Missing/corrupt file → {}. */
export async function loadRelations(library: string): Promise<RelationsMap> {
  try {
    const bytes = await readFileBytes(relationsPath(library));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Defensively coerce to a clean RelationsMap of string[].
    const out: RelationsMap = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        out[key] = val.filter((v): v is string => typeof v === "string");
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function saveRelations(library: string, map: RelationsMap): Promise<void> {
  // Drop any empty entries so the file stays tidy.
  const clean: RelationsMap = {};
  for (const [key, val] of Object.entries(map)) {
    if (val.length) clean[key] = val;
  }
  await writeTextFile(relationsPath(library), JSON.stringify(clean, null, 2));
}

/** The related item paths for a single item (empty array if none). */
export async function getRelated(library: string, path: string): Promise<string[]> {
  const map = await loadRelations(library);
  return map[path] ?? [];
}

function link(map: RelationsMap, from: string, to: string): void {
  const list = map[from] ?? [];
  if (!list.includes(to)) list.push(to);
  map[from] = list;
}

function unlink(map: RelationsMap, from: string, to: string): void {
  const list = map[from];
  if (!list) return;
  map[from] = list.filter((p) => p !== to);
}

/** Relate two items (bidirectional). No-op for a self-relation or missing paths. */
export async function addRelation(library: string, a: string, b: string): Promise<void> {
  if (!a || !b || a === b) return;
  const map = await loadRelations(library);
  link(map, a, b);
  link(map, b, a);
  await saveRelations(library, map);
}

/** Remove a relation between two items (bidirectional). */
export async function removeRelation(library: string, a: string, b: string): Promise<void> {
  if (!a || !b) return;
  const map = await loadRelations(library);
  unlink(map, a, b);
  unlink(map, b, a);
  await saveRelations(library, map);
}
