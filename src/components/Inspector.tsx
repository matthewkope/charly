import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Entry,
  fileInfo,
  getItemMeta,
  openCharlyLink,
  setItemNote,
  setItemTags,
  setItemTitle,
} from "../api";
import Cover from "./Cover";

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
}: {
  library: string;
  entry: Entry;
  allTags: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState("");
  const [pages, setPages] = useState<number | null>(null);
  const [info, setInfo] = useState<{ modified_ms: number; size: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  const persistNote = async () => {
    try {
      await setItemNote(library, entry.path, note);
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

          <div className="inspector-section inspector-note">
            <div className="inspector-label">Note</div>
            <textarea
              className="note-area"
              placeholder="Write a note about this item…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={persistNote}
            />
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
