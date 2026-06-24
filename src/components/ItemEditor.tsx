import { useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  attachToItem,
  Creator,
  fetchIdentifier,
  getItem,
  Item,
  pickDocuments,
  saveItem,
} from "../api";
import { ALL_TYPES, fieldsFor, FIELD_LABELS } from "../itemTypes";

function dirOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}
function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export default function ItemEditor({
  path,
  onOpenPath,
}: {
  path: string;
  library?: string | null;
  onOpenPath?: (path: string, name: string) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const itemRef = useRef<Item | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [ident, setIdent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  useEffect(() => {
    setStatus("loading");
    getItem(path)
      .then((it) => {
        setItem(it);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [path]);

  const persist = (next: Item) => {
    setItem(next);
    itemRef.current = next;
    saveItem(path, next).catch(() => {});
  };

  const saveCurrent = () => {
    if (itemRef.current) saveItem(path, itemRef.current).catch(() => {});
  };

  const setField = (key: string, value: string) =>
    setItem((prev) => (prev ? { ...prev, fields: { ...prev.fields, [key]: value } } : prev));

  const setCreator = (i: number, patch: Partial<Creator>) =>
    setItem((prev) =>
      prev
        ? { ...prev, creators: prev.creators.map((c, j) => (j === i ? { ...c, ...patch } : c)) }
        : prev,
    );

  const addCreator = () =>
    item && persist({ ...item, creators: [...item.creators, { first: "", last: "", creatorType: "author" }] });

  const removeCreator = (i: number) =>
    item && persist({ ...item, creators: item.creators.filter((_, j) => j !== i) });

  const changeType = (itemType: string) => item && persist({ ...item, itemType });

  const runFetch = async () => {
    if (!ident.trim() || !item) return;
    setBusy("Looking up…");
    try {
      const f = await fetchIdentifier(ident.trim());
      persist({
        ...item,
        itemType: f.itemType || item.itemType,
        fields: { ...item.fields, ...f.fields },
        creators: f.creators.length ? f.creators : item.creators,
      });
      setIdent("");
    } catch (e) {
      await confirm(String(e), { title: "Lookup failed", kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const attach = async () => {
    const files = await pickDocuments();
    if (files.length === 0) return;
    setBusy("Attaching…");
    try {
      setItem(await attachToItem(path, files));
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t attach", kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (status === "loading") return <div className="viewer-msg">Loading item…</div>;
  if (status === "error" || !item) return <div className="viewer-msg error">Couldn’t open item.</div>;

  const dir = dirOf(path);
  const title = item.fields.title?.trim() || baseName(path).replace(/\.charlyitem$/, "");

  return (
    <div className="item-editor">
      <div className="item-head">
        <span className="item-head-icon">📄</span>
        <h2 className="item-head-title">{title}</h2>
      </div>

      <div className="item-identifier">
        <input
          className="item-id-input"
          placeholder="Add by DOI (paste a DOI or a link with one)…"
          value={ident}
          onChange={(e) => setIdent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runFetch();
          }}
        />
        <button className="primary" onClick={runFetch} disabled={!ident.trim() || !!busy}>
          {busy === "Looking up…" ? "…" : "Fetch"}
        </button>
      </div>

      <div className="item-section-label">Info</div>
      <div className="item-fields">
        <div className="item-field">
          <label>Item Type</label>
          <select value={item.itemType} onChange={(e) => changeType(e.target.value)}>
            {ALL_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="item-field item-creators">
          <label>Creators</label>
          <div className="creator-list">
            {item.creators.length === 0 && <div className="creator-empty">No creators</div>}
            {item.creators.map((c, i) => (
              <div className="creator-row" key={i}>
                <input
                  className="creator-last"
                  placeholder="Last"
                  value={c.last}
                  onChange={(e) => setCreator(i, { last: e.target.value })}
                  onBlur={saveCurrent}
                />
                <input
                  className="creator-first"
                  placeholder="First"
                  value={c.first}
                  onChange={(e) => setCreator(i, { first: e.target.value })}
                  onBlur={saveCurrent}
                />
                <button className="creator-x" title="Remove" onClick={() => removeCreator(i)}>
                  ×
                </button>
              </div>
            ))}
            <button className="creator-add" onClick={addCreator}>
              + Add creator
            </button>
          </div>
        </div>

        {fieldsFor(item.itemType).map((key) => (
          <div className="item-field" key={key}>
            <label title={FIELD_LABELS[key] ?? key}>{FIELD_LABELS[key] ?? key}</label>
            <input
              value={item.fields[key] ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              onBlur={saveCurrent}
            />
          </div>
        ))}
      </div>

      <div className="item-section-label">Abstract</div>
      <textarea
        className="item-abstract"
        placeholder="Add abstract…"
        value={item.fields.abstractNote ?? ""}
        onChange={(e) => setField("abstractNote", e.target.value)}
        onBlur={saveCurrent}
      />

      <div className="item-section-label">
        Attachments{item.attachments.length ? ` (${item.attachments.length})` : ""}
        <button className="attach-btn" onClick={attach} disabled={!!busy}>
          + Attach PDF
        </button>
      </div>
      <div className="attach-list">
        {item.attachments.length === 0 && (
          <div className="creator-empty">No attachments yet.</div>
        )}
        {item.attachments.map((a) => (
          <button
            key={a}
            className="attach-row"
            onClick={() => onOpenPath?.(`${dir}/${a}`, a)}
            title={a}
          >
            <span className="attach-icon">{a.toLowerCase().endsWith(".pdf") ? "📕" : "📄"}</span>
            <span className="attach-name">{a}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
