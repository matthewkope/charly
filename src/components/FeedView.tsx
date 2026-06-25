import { useCallback, useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  addFeed,
  Feed,
  FeedItem,
  fetchFeed,
  listFeeds,
  openExternal,
  removeFeed,
  saveFeedItem,
} from "../api";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium" });
}

// The Feeds view: subscribe to RSS/Atom feeds, browse a feed's items, and
// save an item into the library as a `.charlylink`.
export default function FeedView({
  library,
  folder,
  onChanged,
}: {
  library: string;
  folder: string; // library-relative folder to save into ("" = root)
  onChanged: () => void;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const reloadFeeds = useCallback(() => {
    listFeeds(library)
      .then((fs) => {
        setFeeds(fs);
        setSelected((cur) => cur ?? fs[0]?.url ?? null);
      })
      .catch(() => setFeeds([]));
  }, [library]);

  useEffect(reloadFeeds, [reloadFeeds]);

  // Load the selected feed's items whenever the selection changes.
  useEffect(() => {
    if (!selected) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    setSaved(new Set());
    fetchFeed(selected)
      .then(setItems)
      .catch(async (err) => {
        setItems([]);
        await confirm(String(err), { title: "Couldn’t load feed", kind: "error" });
      })
      .finally(() => setLoadingItems(false));
  }, [selected]);

  const add = async () => {
    const u = url.trim();
    if (!u || adding) return;
    setAdding(true);
    try {
      const fs = await addFeed(library, u);
      setFeeds(fs);
      setUrl("");
      setSelected(u);
    } catch (err) {
      await confirm(String(err), { title: "Couldn’t add feed", kind: "error" });
    } finally {
      setAdding(false);
    }
  };

  const remove = async (f: Feed) => {
    const ok = await confirm(`Unsubscribe from “${f.title}”?`, {
      title: "Remove feed",
      kind: "warning",
    });
    if (!ok) return;
    const fs = await removeFeed(library, f.url);
    setFeeds(fs);
    if (selected === f.url) setSelected(fs[0]?.url ?? null);
  };

  const save = async (item: FeedItem) => {
    if (!item.link) return;
    try {
      await saveFeedItem(library, folder, item.link, item.title);
      setSaved((s) => new Set(s).add(item.link));
      onChanged();
    } catch (err) {
      await confirm(String(err), { title: "Couldn’t save item", kind: "error" });
    }
  };

  return (
    <div className="itemlist feedview">
      <div className="trash-toolbar">
        <input
          className="sidebar-search"
          style={{ flex: 1 }}
          type="text"
          placeholder="Add a feed URL (RSS or Atom)…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button onClick={add} disabled={!url.trim() || adding}>
          {adding ? "Adding…" : "Add feed"}
        </button>
      </div>
      <div className="feedview-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          className="feed-list"
          style={{ width: 220, minWidth: 220, overflowY: "auto", borderRight: "1px solid var(--border, #ddd)" }}
        >
          {feeds.length === 0 ? (
            <div className="itemlist-empty">No feeds yet.</div>
          ) : (
            feeds.map((f) => (
              <div
                key={f.url}
                className={`special-row${selected === f.url ? " active" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <button
                  className="special-row"
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none" }}
                  onClick={() => setSelected(f.url)}
                  title={f.url}
                >
                  <span className="special-icon">📡</span> {f.title}
                </button>
                <button
                  className="trash-restore"
                  title="Unsubscribe"
                  onClick={() => remove(f)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
        <div className="itemlist-body" style={{ flex: 1, overflowY: "auto" }}>
          {!selected ? (
            <div className="itemlist-empty">Add a feed to get started.</div>
          ) : loadingItems ? (
            <div className="itemlist-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="itemlist-empty">No items in this feed.</div>
          ) : (
            items.map((item, i) => (
              <div key={item.link || i} className="item-row" style={{ alignItems: "flex-start" }}>
                <span className="col-cell" style={{ flex: 1, minWidth: 120, flexDirection: "column", alignItems: "flex-start" }}>
                  <span className="item-title-text">
                    <span className="item-icon">🔗</span>{" "}
                    {item.link ? (
                      <a
                        href={item.link}
                        onClick={(e) => {
                          e.preventDefault();
                          openExternal(item.link);
                        }}
                      >
                        {item.title || item.link}
                      </a>
                    ) : (
                      item.title || "(untitled)"
                    )}
                  </span>
                  {item.summary && (
                    <span className="trash-hint" style={{ marginTop: 2 }}>
                      {item.summary.slice(0, 240)}
                      {item.summary.length > 240 ? "…" : ""}
                    </span>
                  )}
                </span>
                <span className="col-cell num" style={{ width: 110 }}>
                  {fmtDate(item.published)}
                </span>
                <span className="col-cell" style={{ width: 130 }}>
                  <button
                    className="trash-restore"
                    onClick={() => save(item)}
                    disabled={!item.link || saved.has(item.link)}
                  >
                    {saved.has(item.link) ? "Saved ✓" : "Save to library"}
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
