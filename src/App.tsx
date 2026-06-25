import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clipLink,
  createFolder,
  createItem,
  deleteEntry,
  Entry,
  FileItem,
  findByTag,
  getLibrary,
  importFiles,
  isSupported,
  libraryItems,
  listAllTags,
  openCharlyLink,
  readCharlyLink,
  pickDocuments,
  pickFolder,
  renameEntry,
  searchLibrary,
  setLibrary,
  TagCount,
  trashItem,
  SavedSearch,
  listSavedSearches,
  saveSavedSearch,
  deleteSavedSearch,
  runSavedSearch,
} from "./api";
import Tree from "./components/Tree";
import DocReader from "./components/DocReader";
import EpubViewer from "./components/EpubViewer";
import Inspector from "./components/Inspector";
import ItemEditor from "./components/ItemEditor";
import ItemList from "./components/ItemList";
import TagSelector from "./components/TagSelector";
import BibliographyButton from "./components/BibliographyButton";
import ReportButton from "./components/ReportButton";
import TrashView from "./components/TrashView";
import FeedView from "./components/FeedView";
import SavedSearchModal from "./components/SavedSearchModal";
import SnapshotViewer from "./components/SnapshotViewer";
import HtmlViewer from "./components/HtmlViewer";
import PromptModal, { PromptState } from "./components/PromptModal";
import { ALL_TYPES, COMMON_TYPES } from "./itemTypes";
import { retrievePdfMetadata } from "./pdfMeta";
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
  if (ext === "charlyitem") return "📄";
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
  const [version, setVersion] = useState(0);
  const [metaVersion, setMetaVersion] = useState(0);
  const [tabs, setTabs] = useState<Entry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [inspected, setInspected] = useState<Entry | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // The folder whose contents fill the item-list "home" view (null = library root).
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  // Special virtual views ("All Items" / "Recently Added") override the folder view.
  const [specialView, setSpecialView] = useState<"all" | "recent" | "trash" | "feeds" | null>(
    null,
  );
  const [libItems, setLibItems] = useState<FileItem[] | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSearch, setActiveSearch] = useState<SavedSearch | null>(null);
  const [searchItems, setSearchItems] = useState<FileItem[] | null>(null);
  const [searchModal, setSearchModal] = useState<{ initial: SavedSearch | null } | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<Entry[]>([]);
  const [itemMenu, setItemMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(290);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // dragenter/dragleave fire for every nested element; count depth so the
  // overlay only clears when the cursor truly leaves the window.
  const dragDepth = useRef(0);
  const sidebarWidthRef = useRef(290);
  // Holds the latest chooseLibrary so the (once-subscribed) menu listener can
  // call it without re-subscribing every render.
  const chooseLibraryRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const bumpMeta = useCallback(() => setMetaVersion((v) => v + 1), []);

  // Charly defaults to a light theme regardless of the OS appearance.
  useEffect(() => {
    getCurrentWindow().setTheme("light").catch(() => {});
  }, []);

  useEffect(() => {
    getLibrary()
      .then((p) => setLib(p))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const close = () => {
      setMenu(null);
      setItemMenu(false);
    };
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

  // Native menu "File ▸ Open Folder…" → choose the library folder.
  useEffect(() => {
    const un = listen("menu:open-folder", () => chooseLibraryRef.current());
    return () => {
      un.then((off) => off());
    };
  }, []);

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
    setCurrentFolder(path);
    refresh();
  };
  chooseLibraryRef.current = chooseLibrary;

  // Single click: select/inspect the item, and open readable docs in a tab.
  // Links are NOT navigated here — that needs a double-click (see activateEntry).
  const openEntry = (entry: Entry) => {
    if (entry.is_dir) return;
    setInspected(entry);
    setInspectorOpen(true);
    if (
      isSupported(entry.ext) ||
      entry.ext === "charlyitem" ||
      entry.ext === "html" ||
      entry.ext === "htm"
    ) {
      setTabs((prev) => (prev.some((t) => t.path === entry.path) ? prev : [...prev, entry]));
      setActivePath(entry.path);
    }
  };

  // Single click in the tree / item list: just select + inspect (no tab).
  // Opening into a tab requires a double-click (see activateEntry).
  const selectItem = (entry: Entry) => {
    setInspected(entry);
    setInspectorOpen(true);
  };

  // Select a folder in the tree → show its contents in the home item list.
  const selectFolder = (entry: Entry) => {
    setCurrentFolder(entry.path);
    setActivePath(null);
    setSpecialView(null);
    setActiveSearch(null);
    setQuery("");
    setTagFilter(null);
  };

  // Open a special virtual view (All Items / Recently Added / Trash).
  const openSpecial = (v: "all" | "recent" | "trash" | "feeds") => {
    setSpecialView(v);
    setActiveSearch(null);
    setActivePath(null);
    setQuery("");
    setTagFilter(null);
  };

  const goLibraryRoot = () => {
    setSpecialView(null);
    setActiveSearch(null);
    setCurrentFolder(library);
    setActivePath(null);
    setQuery("");
    setTagFilter(null);
  };

  // Open a saved search → show its matches in the home item list.
  const openSavedSearch = (s: SavedSearch) => {
    setActiveSearch(s);
    setSpecialView(null);
    setActivePath(null);
    setQuery("");
    setTagFilter(null);
  };

  // Load every library file when a special view is active.
  useEffect(() => {
    if (!library || specialView === null || specialView === "trash" || specialView === "feeds") {
      setLibItems(null);
      return;
    }
    libraryItems(library).then(setLibItems).catch(() => setLibItems([]));
  }, [library, specialView, version, metaVersion]);

  // Load the saved-search list.
  useEffect(() => {
    if (!library) return;
    listSavedSearches(library).then(setSavedSearches).catch(() => setSavedSearches([]));
  }, [library, version]);

  // Run the active saved search (and re-run when the library changes).
  useEffect(() => {
    if (!library || !activeSearch) {
      setSearchItems(null);
      return;
    }
    runSavedSearch(library, activeSearch).then(setSearchItems).catch(() => setSearchItems([]));
  }, [library, activeSearch, version, metaVersion]);

  const persistSearch = async (s: SavedSearch) => {
    if (!library) return;
    try {
      const list = await saveSavedSearch(library, s);
      setSavedSearches(list);
      if (activeSearch?.id === s.id) setActiveSearch(s);
      setSearchModal(null);
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t save search", kind: "error" });
    }
  };

  const removeSearch = async (id: string) => {
    if (!library) return;
    const list = await deleteSavedSearch(library, id);
    setSavedSearches(list);
    if (activeSearch?.id === id) {
      setActiveSearch(null);
      goLibraryRoot();
    }
  };

  const specialItems =
    specialView === "recent"
      ? [...(libItems ?? [])].sort((a, b) => b.modified_ms - a.modified_ms).slice(0, 50)
      : specialView === "all"
        ? (libItems ?? [])
        : null;

  // What the center item list shows: a saved search wins, else a special view.
  const overrideItems = activeSearch ? (searchItems ?? []) : specialItems;

  // Drag the sidebar's right edge to resize; drag it narrow to collapse it.
  // Pointer capture guarantees we still get the release even if the cursor
  // leaves the window, so the drag can't get stuck.
  const startResize = (el: HTMLElement, pointerId: number, startX: number) => {
    const startW = sidebarWidthRef.current;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(60, Math.min(560, startW + (ev.clientX - startX)));
      sidebarWidthRef.current = w;
      setSidebarWidth(w);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (sidebarWidthRef.current < 140) {
        setSidebarCollapsed(true);
        sidebarWidthRef.current = 290;
        setSidebarWidth(290);
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  // Create a new bibliographic item of the chosen type and open it.
  const newItem = async (itemType: string) => {
    if (!library) return;
    try {
      const path = await createItem(library, itemType, "");
      const entry: Entry = {
        name: path.split("/").pop() ?? path,
        path,
        is_dir: false,
        ext: "charlyitem",
      };
      setTabs((prev) => [...prev, entry]);
      setActivePath(path);
      setInspected(entry);
      refresh();
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t create item", kind: "error" });
    }
  };

  // Open an arbitrary path (e.g. an item's attached PDF) in a tab.
  const openPath = (p: string, name: string) => {
    const ext = (p.split(".").pop() ?? "").toLowerCase();
    openEntry({ name, path: p, is_dir: false, ext });
  };

  // Double click / explicit activation. A clipped web page with a saved
  // snapshot opens in a Charly reader tab; YouTube/other links open in the
  // browser; documents open in a tab.
  const activateEntry = async (entry: Entry) => {
    if (entry.is_dir) return;
    if (entry.ext === "charlylink") {
      try {
        const data = await readCharlyLink(entry.path);
        if (data.snapshot) {
          setTabs((prev) => (prev.some((t) => t.path === entry.path) ? prev : [...prev, entry]));
          setActivePath(entry.path);
          setInspected(entry);
          return;
        }
      } catch {
        /* fall through to opening the original */
      }
      openCharlyLink(entry.path).catch(() => {});
      return;
    }
    openEntry(entry);
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
          // PDFs: try to auto-create a bibliographic item from their DOI; any
          // PDF without a DOI (and all other files) falls back to a plain import.
          const pdfs = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
          const rest = paths.filter((p) => !p.toLowerCase().endsWith(".pdf"));
          for (const pdf of pdfs) {
            const created = await retrievePdfMetadata(library, pdf).catch(() => false);
            if (!created) rest.push(pdf);
          }
          if (rest.length) await importFiles(library, rest);
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

  // Default delete → recoverable library Trash (.charly/Trash).
  const doDelete = async (entry: Entry) => {
    if (!library) return;
    const ok = await confirm(`Move “${entry.name}” to Charly’s Trash?`, {
      title: "Move to Trash",
      kind: "warning",
    });
    if (!ok) return;
    await trashItem(library, entry.path);
    closeTab(entry.path);
    if (inspected?.path === entry.path) setInspected(null);
    refresh();
    bumpMeta();
  };

  // Optional → macOS system Trash (right-click menu).
  const doSystemDelete = async (entry: Entry) => {
    const ok = await confirm(`Move “${entry.name}” to the macOS Trash?`, {
      title: "Delete to system Trash",
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
        !isSupported(e.ext) && e.ext !== "charlylink" && e.ext !== "charlyitem"
          ? " unsupported"
          : ""
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
      <header className="topbar" data-tauri-drag-region>
        <div className="tabbar" role="tablist">
          <div
            role="tab"
            aria-selected={activePath === null}
            className={`tab home-tab${activePath === null ? " active" : ""}`}
            onClick={() => setActivePath(null)}
            title="Library home"
          >
            <span className="tab-icon">🏠</span>
            <span className="tab-label">{baseName(currentFolder ?? library)}</span>
          </div>
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
              <span className="tab-icon">{fileIcon(t.ext)}</span>
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
        </div>
      </header>

      <div className="body">
        {activePath === null && sidebarCollapsed && (
          <button
            className="sidebar-reopen"
            onClick={() => setSidebarCollapsed(false)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            ›
          </button>
        )}
        {activePath === null && !sidebarCollapsed && (
        <aside
          className="sidebar"
          style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
        >
          <div className="sidebar-toolbar">
            <button
              className="icon-btn"
              onClick={() => askNewFolder(library)}
              title="New folder"
              aria-label="New folder"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
            <div className={`toolbar-search${searchOpen || query ? " open" : ""}`}>
              {searchOpen || query ? (
                <input
                  className="sidebar-search"
                  placeholder="Search…"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!query) setSearchOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      setSearchOpen(false);
                    }
                  }}
                />
              ) : (
                <button
                  className="icon-btn"
                  onClick={() => setSearchOpen(true)}
                  title="Search"
                  aria-label="Search"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="special-views">
            <button
              className={`special-row${specialView === null && !tagFilter && results === null ? " active" : ""}`}
              onClick={goLibraryRoot}
            >
              <span className="special-icon">🏛</span> My Library
            </button>
            <button
              className={`special-row${specialView === "recent" ? " active" : ""}`}
              onClick={() => openSpecial("recent")}
            >
              <span className="special-icon">🕐</span> Recently Added
            </button>
            <button
              className={`special-row${specialView === "all" ? " active" : ""}`}
              onClick={() => openSpecial("all")}
            >
              <span className="special-icon">📚</span> All Items
            </button>
            <button
              className={`special-row${specialView === "feeds" ? " active" : ""}`}
              onClick={() => openSpecial("feeds")}
            >
              <span className="special-icon">📡</span> Feeds
            </button>
            <button
              className={`special-row${specialView === "trash" ? " active" : ""}`}
              onClick={() => openSpecial("trash")}
            >
              <span className="special-icon">🗑</span> Trash
            </button>
          </div>
          <div className="saved-searches">
            <div className="saved-head">
              <span>Saved Searches</span>
              <button
                className="saved-add"
                title="New saved search"
                onClick={() => setSearchModal({ initial: null })}
              >
                +
              </button>
            </div>
            {savedSearches.map((s) => (
              <div
                key={s.id}
                className={`special-row saved-row${activeSearch?.id === s.id ? " active" : ""}`}
                onClick={() => openSavedSearch(s)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSearchModal({ initial: s });
                }}
                title="Click to run · right-click to edit"
              >
                <span className="special-icon">🔍</span>
                <span className="saved-name">{s.name}</span>
                <button
                  className="saved-x"
                  title="Delete saved search"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSearch(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="sidebar-scroll">
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
                selectedFolder={currentFolder ?? library}
                onSelect={selectItem}
                onSelectFolder={selectFolder}
                onActivate={activateEntry}
                onContext={(entry, x, y) => setMenu({ entry, x, y })}
              />
            )}
          </div>
          <TagSelector
            tags={tags}
            active={tagFilter}
            onToggle={(t) => setTagFilter((cur) => (cur === t ? null : t))}
          />
        </aside>
        )}
        {activePath === null && !sidebarCollapsed && (
          <div
            className="sidebar-resizer"
            onPointerDown={(e) => {
              e.preventDefault();
              startResize(e.currentTarget, e.pointerId, e.clientX);
            }}
            title="Drag to resize · drag fully left to hide"
          />
        )}

        <div className="main-col">
        <main className="content">
          {activePath === null && (
            <div className="home">
              <div className="list-toolbar">
                <span className="list-folder">
                  {activeSearch
                    ? `🔍 ${activeSearch.name}`
                    : specialView === "all"
                      ? "All Items"
                      : specialView === "recent"
                        ? "Recently Added"
                        : specialView === "trash"
                          ? "Trash"
                          : specialView === "feeds"
                            ? "Feeds"
                            : baseName(currentFolder ?? library)}
                </span>
                <BibliographyButton library={library} folder={currentFolder ?? library} />
                <ReportButton
                  library={library}
                  folder={currentFolder ?? library}
                  folderName={baseName(currentFolder ?? library)}
                />
                <div className="newitem-wrap">
                  <button
                    className="icon-btn"
                    title="New item"
                    aria-label="New item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setItemMenu((o) => !o);
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
                      <path d="M14 3v5h5" />
                      <line x1="11.5" y1="11" x2="11.5" y2="17" />
                      <line x1="8.5" y1="14" x2="14.5" y2="14" />
                    </svg>
                  </button>
                  {itemMenu && (
                    <div className="newitem-menu" onClick={(e) => e.stopPropagation()}>
                      {COMMON_TYPES.map((t) => (
                        <button
                          key={`c-${t.key}`}
                          onClick={() => {
                            setItemMenu(false);
                            newItem(t.key);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                      <div className="menu-sep" />
                      {ALL_TYPES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => {
                            setItemMenu(false);
                            newItem(t.key);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {specialView === "feeds" ? (
                <FeedView
                  library={library}
                  folder={
                    currentFolder && currentFolder !== library
                      ? currentFolder.slice(library.length).replace(/^[/\\]+/, "")
                      : ""
                  }
                  onChanged={() => {
                    refresh();
                    bumpMeta();
                  }}
                />
              ) : specialView === "trash" ? (
                <TrashView
                  library={library}
                  version={version}
                  onChanged={() => {
                    refresh();
                    bumpMeta();
                  }}
                />
              ) : (
                <ItemList
                  library={library}
                  folder={currentFolder ?? library}
                  version={version}
                  selectedPath={inspected?.path ?? null}
                  override={overrideItems}
                  emptyText={
                    activeSearch
                      ? "No items match this search."
                      : specialView
                        ? "Nothing here yet."
                        : "This folder has no documents yet."
                  }
                  onSelect={selectItem}
                  onOpen={activateEntry}
                  onContext={(entry, x, y) => setMenu({ entry, x, y })}
                />
              )}
            </div>
          )}
          <div className={`doc-area${activePath ? "" : " hidden"}`}>
            <div className="tab-stack">
              {tabs.map((t) => (
                <div key={t.path} className={`tab-panel${t.path === activePath ? "" : " hidden"}`}>
                  {t.ext === "pdf" ? (
                    <DocReader path={t.path} active={t.path === activePath} library={library} />
                  ) : t.ext === "charlyitem" ? (
                    <ItemEditor path={t.path} library={library} onOpenPath={openPath} />
                  ) : t.ext === "charlylink" ? (
                    <SnapshotViewer path={t.path} />
                  ) : t.ext === "html" || t.ext === "htm" ? (
                    <HtmlViewer path={t.path} />
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

        {inspectorOpen && inspected && (
          <Inspector
            key={inspected.path}
            library={library}
            entry={inspected}
            allTags={tags.map((t) => t.tag)}
            onClose={() => setInspectorOpen(false)}
            onChanged={bumpMeta}
            onOpenItem={openPath}
          />
        )}
        </div>

        <aside className="info-rail">
          <button
            className={`rail-btn${inspectorOpen ? " active" : ""}`}
            title="Info"
            aria-label="Toggle info panel"
            onClick={() => setInspectorOpen((o) => !o)}
          >
            ⓘ
          </button>
          <button
            className="rail-btn"
            title="Tags"
            aria-label="Tags"
            onClick={() => inspected && setInspectorOpen(true)}
          >
            🏷
          </button>
          <button
            className="rail-btn"
            title="Notes"
            aria-label="Notes"
            onClick={() => inspected && setInspectorOpen(true)}
          >
            🗒
          </button>
        </aside>
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          onImport={doImport}
          onNewFolder={askNewFolder}
          onInspect={(entry) => setInspected(entry)}
          onRename={askRename}
          onDelete={doDelete}
          onSystemDelete={doSystemDelete}
        />
      )}

      {prompt && <PromptModal state={prompt} onClose={() => setPrompt(null)} />}

      {searchModal && (
        <SavedSearchModal
          initial={searchModal.initial}
          onSave={persistSearch}
          onClose={() => setSearchModal(null)}
        />
      )}
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
  onSystemDelete,
}: {
  menu: MenuState;
  onImport: (dir: string) => void;
  onNewFolder: (parent: string) => void;
  onInspect: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onSystemDelete: (entry: Entry) => void;
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
      {entry.ext === "charlylink" && (
        <>
          <button onClick={() => openCharlyLink(entry.path).catch(() => {})}>
            View online ↗
          </button>
          <div className="menu-sep" />
        </>
      )}
      <button onClick={() => onInspect(entry)}>Tags &amp; notes…</button>
      <button onClick={() => onRename(entry)}>Rename…</button>
      <button className="danger" onClick={() => onDelete(entry)}>
        Move to Trash
      </button>
      <button onClick={() => onSystemDelete(entry)}>Delete to macOS Trash…</button>
    </div>
  );
}
