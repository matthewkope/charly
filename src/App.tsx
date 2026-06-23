import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  clipLink,
  createFolder,
  deleteEntry,
  Entry,
  findByTag,
  getLibrary,
  importFiles,
  isSupported,
  listAllTags,
  openCharlyLink,
  pickDocuments,
  pickFolder,
  renameEntry,
  searchLibrary,
  setLibrary,
  TagCount,
} from "./api";
import Tree from "./components/Tree";
import DocReader from "./components/DocReader";
import EpubViewer from "./components/EpubViewer";
import Inspector from "./components/Inspector";
import PromptModal, { PromptState } from "./components/PromptModal";
import "./App.css";

interface MenuState {
  entry: Entry;
  x: number;
  y: number;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function fileIcon(ext: string): string {
  if (ext === "epub") return "📗";
  if (ext === "charlylink") return "🔗";
  return "📕";
}

// Finder drags expose dropped files as `file://` URIs in the drag payload.
function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let p = uri.slice("file://".length);
  if (p.startsWith("localhost")) p = p.slice("localhost".length);
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

// A drag carries something we can handle when it includes files or text/URLs.
function dragHasPayload(dt: DataTransfer): boolean {
  return Array.from(dt.types).some(
    (t) => t === "Files" || t === "text/uri-list" || t === "text/plain",
  );
}

export default function App() {
  const [library, setLib] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [version, setVersion] = useState(0);
  const [metaVersion, setMetaVersion] = useState(0);
  const [tabs, setTabs] = useState<Entry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [inspected, setInspected] = useState<Entry | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // dragenter/dragleave fire for every nested element; count depth so the
  // overlay only clears when the cursor truly leaves the window.
  const dragDepth = useRef(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const bumpMeta = useCallback(() => setMetaVersion((v) => v + 1), []);

  useEffect(() => {
    getLibrary()
      .then((p) => setLib(p))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // The browser extension writes clips straight to disk; refresh the tree and
  // tags when the backend signals a new clip arrived.
  useEffect(() => {
    const un = listen("clip-added", () => {
      refresh();
      bumpMeta();
    });
    return () => {
      un.then((off) => off());
    };
  }, [refresh, bumpMeta]);

  // Keep the tag list fresh as the library and metadata change.
  useEffect(() => {
    if (!library) return;
    listAllTags(library).then(setTags).catch(() => setTags([]));
  }, [library, version, metaVersion]);

  // Reload the active tag filter's matches.
  useEffect(() => {
    if (!library || !tagFilter) {
      setTagResults([]);
      return;
    }
    findByTag(library, tagFilter).then(setTagResults).catch(() => setTagResults([]));
  }, [library, tagFilter, version, metaVersion]);

  // Debounced filename search.
  useEffect(() => {
    if (!library) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const id = setTimeout(() => {
      searchLibrary(library, q).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [query, library, version]);

  const chooseLibrary = async () => {
    const path = await pickFolder("Choose your Charly library folder");
    if (!path) return;
    await setLibrary(path);
    setLib(path);
    setTabs([]);
    setActivePath(null);
    setInspected(null);
    setTagFilter(null);
    refresh();
  };

  // Single click: select/inspect the item, and open readable docs in a tab.
  // Links are NOT navigated here — that needs a double-click (see activateEntry).
  const openEntry = (entry: Entry) => {
    if (entry.is_dir) return;
    setInspected(entry);
    if (isSupported(entry.ext)) {
      setTabs((prev) => (prev.some((t) => t.path === entry.path) ? prev : [...prev, entry]));
      setActivePath(entry.path);
    }
  };

  // Double click / explicit activation: open a link in the browser.
  const activateEntry = (entry: Entry) => {
    if (entry.is_dir) return;
    if (entry.ext === "charlylink") {
      openCharlyLink(entry.path).catch(() => {});
    } else {
      openEntry(entry);
    }
  };

  const focusTab = (entry: Entry) => {
    setActivePath(entry.path);
    setInspected(entry);
  };

  const closeTab = (path: string) => {
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (activePath === path) {
      setActivePath(next.length ? next[Math.min(idx, next.length - 1)].path : null);
    }
  };

  // "+" tab: pick PDFs/EPUBs from anywhere and open them in new tabs.
  const openNewTab = async () => {
    const files = await pickDocuments();
    if (files.length === 0) return;
    const opened: Entry[] = files.map((p) => ({
      name: p.split("/").pop() ?? p,
      path: p,
      is_dir: false,
      ext: (p.split(".").pop() ?? "").toLowerCase(),
    }));
    setTabs((prev) => {
      const merged = [...prev];
      for (const e of opened) if (!merged.some((t) => t.path === e.path)) merged.push(e);
      return merged;
    });
    const last = opened[opened.length - 1];
    setActivePath(last.path);
    setInspected(last);
  };

  const doImport = async (targetDir: string) => {
    const files = await pickDocuments();
    if (files.length === 0) return;
    await importFiles(targetDir, files);
    refresh();
  };

  // Handle a drag-and-drop: copy dropped files into the library root and save
  // dropped web links as `.charlylink` items via the clip server.
  const handleDrop = useCallback(
    async (dt: DataTransfer) => {
      if (!library) return;
      const text = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
      const lines = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"));

      const paths: string[] = [];
      const links: string[] = [];
      for (const line of lines) {
        const fp = fileUriToPath(line);
        if (fp) paths.push(fp);
        else if (/^https?:\/\//i.test(line)) links.push(line);
      }
      // Fallback for webviews that surface dropped files only as File objects.
      if (paths.length === 0 && dt.files.length) {
        for (const f of Array.from(dt.files)) {
          const p = (f as unknown as { path?: string }).path;
          if (p) paths.push(p);
        }
      }
      if (paths.length === 0 && links.length === 0) return;

      try {
        if (paths.length) {
          await importFiles(library, paths);
          refresh();
        }
        // The clip server emits `clip-added`, which refreshes the tree for us.
        for (const url of links) await clipLink(url, "");
      } catch (e) {
        await confirm(String(e), { title: "Couldn’t add the dropped item", kind: "error" });
      }
    },
    [library, refresh],
  );

  const askNewFolder = (parent: string) => {
    setPrompt({
      title: "New folder",
      initial: "",
      confirmLabel: "Create",
      onConfirm: async (name) => {
        if (!name.trim()) return;
        try {
          await createFolder(parent, name);
          refresh();
        } catch (e) {
          await confirm(String(e), { title: "Couldn’t create folder", kind: "error" });
        }
      },
    });
  };

  const askRename = (entry: Entry) => {
    setPrompt({
      title: `Rename “${entry.name}”`,
      initial: entry.name,
      confirmLabel: "Rename",
      onConfirm: async (name) => {
        try {
          const newPath = await renameEntry(entry.path, name);
          setTabs((prev) =>
            prev.map((t) => (t.path === entry.path ? { ...t, path: newPath, name } : t)),
          );
          setActivePath((cur) => (cur === entry.path ? newPath : cur));
          setInspected((cur) =>
            cur?.path === entry.path ? { ...cur, path: newPath, name } : cur,
          );
          refresh();
          bumpMeta();
        } catch (e) {
          await confirm(String(e), { title: "Couldn’t rename", kind: "error" });
        }
      },
    });
  };

  const doDelete = async (entry: Entry) => {
    const ok = await confirm(`Move “${entry.name}” to the Trash?`, {
      title: "Delete",
      kind: "warning",
    });
    if (!ok) return;
    await deleteEntry(entry.path);
    closeTab(entry.path);
    if (inspected?.path === entry.path) setInspected(null);
    refresh();
    bumpMeta();
  };

  if (!ready) return <div className="boot">Loading…</div>;

  if (!library) {
    return (
      <div className="welcome">
        <h1>📚 Charly</h1>
        <p className="tagline">A simple, folder-based home for your papers, books, and PDFs.</p>
        <button className="primary" onClick={chooseLibrary}>
          Choose library folder
        </button>
        <p className="hint">
          Tip: pick a folder inside iCloud Drive, Dropbox, or Google Drive and your library
          syncs across devices automatically.
        </p>
      </div>
    );
  }

  const renderRow = (e: Entry) => (
    <div
      key={e.path}
      className={`tree-row${inspected?.path === e.path || activePath === e.path ? " selected" : ""}${
        !isSupported(e.ext) && e.ext !== "charlylink" ? " unsupported" : ""
      }`}
      onClick={() => openEntry(e)}
      onDoubleClick={() => activateEntry(e)}
      title={e.ext === "charlylink" ? "Double-click to open in browser" : e.name}
      onContextMenu={(ev) => {
        ev.preventDefault();
        setMenu({ entry: e, x: ev.clientX, y: ev.clientY });
      }}
    >
      <span className="tree-icon">{fileIcon(e.ext)}</span>
      <span className="tree-label">{e.name}</span>
    </div>
  );

  return (
    <div
      className="app"
      onContextMenu={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        if (!dragHasPayload(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!dragHasPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        void handleDrop(e.dataTransfer);
      }}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-art">⬇️</div>
            <div className="drop-title">Drop to add to Charly</div>
            <div className="drop-sub">PDFs, EPUBs, or web links</div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div
          className="brand"
          role="button"
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={() => setSidebarOpen((o) => !o)}
        >
          📚 Charly
        </div>
        <input
          className="search"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tabbar" role="tablist">
          {tabs.map((t) => (
            <div
              key={t.path}
              role="tab"
              aria-selected={t.path === activePath}
              className={`tab${t.path === activePath ? " active" : ""}`}
              onClick={() => focusTab(t)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(t.path);
              }}
              title={t.path}
            >
              <span className="tab-icon">{t.ext === "epub" ? "📗" : "📕"}</span>
              <span className="tab-label">{t.name}</span>
              <button
                className="tab-close"
                aria-label={`Close ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.path);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button className="tab-new" title="Open a document in a new tab" onClick={openNewTab}>
            +
          </button>
        </div>
        <div className="topbar-actions">
          <button onClick={() => doImport(library)}>Import</button>
          <button onClick={() => askNewFolder(library)}>New Folder</button>
          <button className="ghost" onClick={chooseLibrary} title={library}>
            {baseName(library)} ▾
          </button>
        </div>
      </header>

      <div className="body">
        {sidebarOpen && (
        <aside className="sidebar">
          {tags.length > 0 && (
            <div className="tagbar">
              {tags.map((t) => (
                <button
                  key={t.tag}
                  className={`tag-pill${tagFilter === t.tag ? " active" : ""}`}
                  onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                >
                  {t.tag} <span className="tag-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          {tagFilter ? (
            <div className="search-results">
              <div className="search-head filter-head">
                🏷 {tagFilter}
                <button className="clear-filter" onClick={() => setTagFilter(null)}>
                  ×
                </button>
              </div>
              {tagResults.length === 0 ? (
                <div className="tree-empty">Nothing tagged “{tagFilter}”.</div>
              ) : (
                tagResults.map(renderRow)
              )}
            </div>
          ) : results !== null ? (
            <div className="search-results">
              <div className="search-head">
                {results.length} result{results.length === 1 ? "" : "s"}
              </div>
              {results.map(renderRow)}
            </div>
          ) : (
            <Tree
              root={library}
              version={version}
              selectedPath={inspected?.path ?? activePath}
              onSelect={openEntry}
              onActivate={activateEntry}
              onContext={(entry, x, y) => setMenu({ entry, x, y })}
            />
          )}
        </aside>
        )}

        <main className="content">
          <div className="doc-area">
            <div className="tab-stack">
              {tabs.map((t) => (
                <div key={t.path} className={`tab-panel${t.path === activePath ? "" : " hidden"}`}>
                  {t.ext === "pdf" ? (
                    <DocReader path={t.path} active={t.path === activePath} library={library} />
                  ) : (
                    <EpubViewer path={t.path} />
                  )}
                </div>
              ))}
              {tabs.length === 0 && (
                <div className="tab-panel">
                  <div className="empty">
                    <div className="empty-art">📖</div>
                    <p>Select a PDF or EPUB from the sidebar, or click + to open one.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>

        {inspected && (
          <Inspector
            key={inspected.path}
            library={library}
            entry={inspected}
            allTags={tags.map((t) => t.tag)}
            onClose={() => setInspected(null)}
            onChanged={bumpMeta}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          onImport={doImport}
          onNewFolder={askNewFolder}
          onInspect={(entry) => setInspected(entry)}
          onRename={askRename}
          onDelete={doDelete}
        />
      )}

      {prompt && <PromptModal state={prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}

function ContextMenu({
  menu,
  onImport,
  onNewFolder,
  onInspect,
  onRename,
  onDelete,
}: {
  menu: MenuState;
  onImport: (dir: string) => void;
  onNewFolder: (parent: string) => void;
  onInspect: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}) {
  const { entry, x, y } = menu;
  return (
    <div className="context-menu" style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
      {entry.is_dir && (
        <>
          <button onClick={() => onImport(entry.path)}>Import into folder…</button>
          <button onClick={() => onNewFolder(entry.path)}>New subfolder…</button>
          <div className="menu-sep" />
        </>
      )}
      <button onClick={() => onInspect(entry)}>Tags &amp; notes…</button>
      <button onClick={() => onRename(entry)}>Rename…</button>
      <button className="danger" onClick={() => onDelete(entry)}>
        Move to Trash
      </button>
    </div>
  );
}
