import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  createFolder,
  deleteEntry,
  Entry,
  getLibrary,
  importFiles,
  isSupported,
  pickDocuments,
  pickFolder,
  renameEntry,
  searchLibrary,
  setLibrary,
} from "./api";
import Tree from "./components/Tree";
import PdfViewer from "./components/PdfViewer";
import EpubViewer from "./components/EpubViewer";
import "./App.css";

interface MenuState {
  entry: Entry;
  x: number;
  y: number;
}

interface PromptState {
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export default function App() {
  const [library, setLib] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

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

  // Debounced search across the whole library.
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
    setSelected(null);
    refresh();
  };

  const openEntry = (entry: Entry) => {
    if (entry.is_dir) return;
    if (!isSupported(entry.ext)) return;
    setSelected(entry);
  };

  const doImport = async (targetDir: string) => {
    const files = await pickDocuments();
    if (files.length === 0) return;
    await importFiles(targetDir, files);
    refresh();
  };

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
          if (selected?.path === entry.path) {
            setSelected({ ...selected, path: newPath, name });
          }
          refresh();
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
    if (selected?.path === entry.path) setSelected(null);
    refresh();
  };

  if (!ready) return <div className="boot">Loading…</div>;

  // ---- First-run / library setup ----
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

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      <header className="topbar">
        <div className="brand">📚 Charly</div>
        <input
          className="search"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="topbar-actions">
          <button onClick={() => doImport(library)}>Import</button>
          <button onClick={() => askNewFolder(library)}>New Folder</button>
          <button className="ghost" onClick={chooseLibrary} title={library}>
            {baseName(library)} ▾
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          {results !== null ? (
            <div className="search-results">
              <div className="search-head">
                {results.length} result{results.length === 1 ? "" : "s"}
              </div>
              {results.map((r) => (
                <div
                  key={r.path}
                  className={`tree-row${selected?.path === r.path ? " selected" : ""}${
                    isSupported(r.ext) ? "" : " unsupported"
                  }`}
                  onClick={() => openEntry(r)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ entry: r, x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="tree-icon">{r.ext === "epub" ? "📗" : "📕"}</span>
                  <span className="tree-label">{r.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <Tree
              root={library}
              version={version}
              selectedPath={selected?.path ?? null}
              onSelect={openEntry}
              onContext={(entry, x, y) => setMenu({ entry, x, y })}
            />
          )}
        </aside>

        <main className="content">
          {selected ? (
            selected.ext === "pdf" ? (
              <PdfViewer key={selected.path} path={selected.path} />
            ) : (
              <EpubViewer key={selected.path} path={selected.path} />
            )
          ) : (
            <div className="empty">
              <div className="empty-art">📖</div>
              <p>Select a PDF or EPUB to start reading.</p>
            </div>
          )}
        </main>
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          onImport={doImport}
          onNewFolder={askNewFolder}
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
  onRename,
  onDelete,
}: {
  menu: MenuState;
  onImport: (dir: string) => void;
  onNewFolder: (parent: string) => void;
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
      <button onClick={() => onRename(entry)}>Rename…</button>
      <button className="danger" onClick={() => onDelete(entry)}>
        Move to Trash
      </button>
    </div>
  );
}

function PromptModal({ state, onClose }: { state: PromptState; onClose: () => void }) {
  const [value, setValue] = useState(state.initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    state.onConfirm(value);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{state.title}</h3>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
