import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Entry,
  FileItem,
  fileInfo,
  getItemMeta,
  libraryItems,
  openCharlyLink,
  setItemNote,
  setItemTags,
  setItemTitle,
} from "../api";
import { addRelation, getRelated, removeRelation } from "../relations";
import Cover from "./Cover";
import NoteEditor from "./NoteEditor";

function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

export default function Inspector({
  library,
  entry,
  allTags,
  onClose,
  onChanged,
  onOpenItem,
}: {
  library: string;
  entry: Entry;
  allTags: string[];
  onClose: () => void;
  onChanged: () => void;
  onOpenItem?: (path: string, name: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState("");
  const [pages, setPages] = useState<number | null>(null);
  const [info, setInfo] = useState<{ modified_ms: number; size: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Related items: paths from the sidecar store, resolved to library items
  // for title/name display. `items` is loaded once for both the related-row
  // labels and the "Add related…" picker.
  const [related, setRelated] = useState<string[]>([]);
  const [items, setItems] = useState<FileItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickFilter, setPickFilter] = useState("");

  useEffect(() => {
    setLoaded(false);
    setPages(null);
    setInfo(null);
    getItemMeta(library, entry.path)
      .then((m) => {
        setTitle(m.title);
        setTags(m.tags);
        setNote(m.note);
      })
      .finally(() => setLoaded(true));
    fileInfo(entry.path).then(setInfo).catch(() => setInfo(null));
  }, [library, entry.path]);

  useEffect(() => {
    setPicking(false);
    setPickFilter("");
    getRelated(library, entry.path).then(setRelated).catch(() => setRelated([]));
    libraryItems(library).then(setItems).catch(() => setItems([]));
  }, [library, entry.path]);

  const refreshRelated = () =>
    getRelated(library, entry.path).then(setRelated).catch(() => setRelated([]));

  const labelFor = (path: string): string => {
    const it = items.find((i) => i.path === path);
    if (it) return it.title || stem(it.name);
    return stem(path.split("/").pop() ?? path);
  };

  const addRelated = async (path: string) => {
    setPicking(false);
    setPickFilter("");
    try {
      await addRelation(library, entry.path, path);
      await refreshRelated();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t add related item", kind: "error" });
    }
  };

  const removeRelated = async (path: string) => {
    try {
      await removeRelation(library, entry.path, path);
      await refreshRelated();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t remove related item", kind: "error" });
    }
  };

  // Candidates for the picker: every library item except this one and ones
  // already related, filtered by the inline search box.
  const candidates = items.filter((i) => {
    if (i.path === entry.path || related.includes(i.path)) return false;
    const q = pickFilter.trim().toLowerCase();
    if (!q) return true;
    return (i.title || i.name).toLowerCase().includes(q);
  });

  const persistTitle = async () => {
    try {
      await setItemTitle(library, entry.path, title);
      onChanged();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t save title", kind: "error" });
    }
  };

  const persistTags = async (next: string[]) => {
    setTags(next);
    try {
      await setItemTags(library, entry.path, next);
      onChanged();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t save tags", kind: "error" });
    }
  };

  const addTag = (raw: string) => {
    const t = raw.trim();
    setDraft("");
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    persistTags([...tags, t]);
  };

  const removeTag = (t: string) => persistTags(tags.filter((x) => x !== t));

  const persistNote = async (html: string) => {
    setNote(html);
    try {
      await setItemNote(library, entry.path, html);
      onChanged();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t save note", kind: "error" });
    }
  };

  const suggestions = allTags.filter(
    (t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()),
  );

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-icon">{entry.is_dir ? "📁" : icon(entry.ext)}</span>
        <span className="inspector-kind">{kindLabel(entry.ext)}</span>
        <button className="inspector-close" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </div>

      <Cover key={entry.path} entry={entry} className="inspector-cover" onInfo={(i) => setPages(i.pages ?? null)} />

      <div className="inspector-section">
        <input
          className="inspector-title"
          value={title}
          placeholder={stem(entry.name)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={persistTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          title="A friendly title — an alias; the file on disk keeps its real name"
        />

        <dl className="detail-list">
          <div className="detail-row">
            <dt>Filename</dt>
            <dd title={entry.name}>{entry.name}</dd>
          </div>
          {pages !== null && (
            <div className="detail-row">
              <dt>Pages</dt>
              <dd>{pages}</dd>
            </div>
          )}
          <div className="detail-row">
            <dt>Modified</dt>
            <dd>{info ? formatDate(info.modified_ms) : "—"}</dd>
          </div>
          {info && info.size > 0 && (
            <div className="detail-row">
              <dt>Size</dt>
              <dd>{formatSize(info.size)}</dd>
            </div>
          )}
        </dl>
      </div>

      {entry.ext === "charlylink" && (
        <div className="inspector-section">
          <button
            className="primary inspector-open"
            onClick={() => openCharlyLink(entry.path).catch(() => {})}
          >
            Open link ↗
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="inspector-loading">Loading…</div>
      ) : (
        <>
          <div className="inspector-section">
            <div className="inspector-label">Tags</div>
            <div className="chips">
              {tags.map((t) => (
                <span className="chip" key={t}>
                  {t}
                  <button className="chip-x" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>
                    ×
                  </button>
                </span>
              ))}
              {tags.length === 0 && <span className="chips-empty">No tags yet</span>}
            </div>
            <input
              className="tag-input"
              list="tag-suggestions"
              placeholder="Add a tag and press Enter"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(draft);
                } else if (e.key === "Backspace" && !draft && tags.length) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              onBlur={() => draft && addTag(draft)}
            />
            <datalist id="tag-suggestions">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="inspector-section">
            <div className="inspector-label">Related</div>
            <div className="chips">
              {related.map((p) => (
                <span className="chip" key={p}>
                  <button
                    className="chip-link"
                    onClick={() => onOpenItem?.(p, p.split("/").pop() ?? p)}
                    title={p}
                  >
                    {labelFor(p)}
                  </button>
                  <button
                    className="chip-x"
                    onClick={() => removeRelated(p)}
                    aria-label={`Remove ${labelFor(p)}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {related.length === 0 && <span className="chips-empty">No related items yet</span>}
            </div>
            {picking ? (
              <>
                <input
                  className="tag-input"
                  placeholder="Search items to relate…"
                  value={pickFilter}
                  autoFocus
                  onChange={(e) => setPickFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setPicking(false);
                      setPickFilter("");
                    }
                  }}
                />
                <div className="related-picker">
                  {candidates.slice(0, 50).map((i) => (
                    <button
                      key={i.path}
                      className="related-option"
                      onClick={() => addRelated(i.path)}
                      title={i.path}
                    >
                      {i.title || stem(i.name)}
                    </button>
                  ))}
                  {candidates.length === 0 && (
                    <div className="chips-empty">No matching items</div>
                  )}
                </div>
              </>
            ) : (
              <button className="related-add" onClick={() => setPicking(true)}>
                + Add related…
              </button>
            )}
          </div>

          <div className="inspector-section inspector-note">
            <div className="inspector-label">Note</div>
            <NoteEditor docKey={entry.path} value={note} onChange={persistNote} />
          </div>
        </>
      )}
    </aside>
  );
}

function icon(ext: string): string {
  if (ext === "pdf") return "📕";
  if (ext === "epub") return "📗";
  if (ext === "charlylink") return "🔗";
  return "📄";
}

function kindLabel(ext: string): string {
  if (ext === "pdf") return "PDF";
  if (ext === "epub") return "EPUB";
  if (ext === "charlylink") return "Link";
  return ext ? ext.toUpperCase() : "File";
}
