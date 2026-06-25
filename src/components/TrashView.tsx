import { useCallback, useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { emptyTrash, listTrash, restoreTrash, TrashEntry } from "../api";

function icon(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "📕";
  if (n.endsWith(".epub")) return "📗";
  if (n.endsWith(".charlylink")) return "🔗";
  if (n.endsWith(".charlyitem")) return "📄";
  return "📄";
}

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// The library Trash: list trashed items with Restore and Empty Trash.
export default function TrashView({
  library,
  version,
  onChanged,
}: {
  library: string;
  version: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    setLoaded(false);
    listTrash(library)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, [library]);

  useEffect(reload, [reload, version]);

  const restore = async (e: TrashEntry) => {
    try {
      await restoreTrash(library, e.trash_name);
      reload();
      onChanged();
    } catch (err) {
      await confirm(String(err), { title: "Couldn’t restore", kind: "error" });
    }
  };

  const empty = async () => {
    if (items.length === 0) return;
    const ok = await confirm(`Permanently delete ${items.length} item(s)? This can't be undone.`, {
      title: "Empty Trash",
      kind: "warning",
    });
    if (!ok) return;
    await emptyTrash(library);
    reload();
    onChanged();
  };

  return (
    <div className="itemlist">
      <div className="trash-toolbar">
        <span className="trash-hint">Items here are recoverable. Restore returns them to their original folder.</span>
        <button className="danger" onClick={empty} disabled={items.length === 0}>
          Empty Trash
        </button>
      </div>
      <div className="itemlist-body">
        {loaded && items.length === 0 ? (
          <div className="itemlist-empty">Trash is empty.</div>
        ) : (
          items.map((e) => (
            <div key={e.trash_name} className="item-row trash-row">
              <span className="col-cell" style={{ flex: 1, minWidth: 120 }}>
                <span className="item-icon">{icon(e.name)}</span>
                <span className="item-title-text">{e.name}</span>
              </span>
              <span className="col-cell num" style={{ width: 150 }}>
                {fmtDate(e.deleted_ms)}
              </span>
              <span className="col-cell" style={{ width: 90 }}>
                <button className="trash-restore" onClick={() => restore(e)}>
                  Restore
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
