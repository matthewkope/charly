import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  addSource,
  deletePerson,
  importPersonPdfs,
  joinPath,
  openExternal,
  Person,
  pickPdfs,
  removeSource,
  setPhotoFromLink,
  Source,
  updatePerson,
} from "../api";
import LocalImage from "./LocalImage";
import PromptModal, { PromptState } from "./PromptModal";
import PdfViewer from "./PdfViewer";

export default function PersonView({
  person,
  onChange,
  onDelete,
}: {
  person: Person;
  onChange: (p: Person) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [summary, setSummary] = useState(person.summary);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPdf, setOpenPdf] = useState<{ path: string; title: string } | null>(null);

  // Reset editable fields when switching person.
  useEffect(() => {
    setName(person.name);
    setSummary(person.summary);
    setOpenPdf(null);
  }, [person.dir]);

  const saveFields = async () => {
    if (name === person.name && summary === person.summary) return;
    try {
      onChange(await updatePerson(person.dir, name.trim() || person.name, summary));
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t save", kind: "error" });
    }
  };

  const askPhoto = () =>
    setPrompt({
      title: "Set photo from a link",
      initial: "",
      placeholder: "https://… (homepage, profile, article)",
      confirmLabel: "Fetch photo",
      onConfirm: async (link) => {
        if (!link.trim()) return;
        setBusy("Fetching photo…");
        try {
          onChange(await setPhotoFromLink(person.dir, link.trim()));
        } catch (e) {
          await confirm(String(e), { title: "Couldn’t fetch photo", kind: "error" });
        } finally {
          setBusy(null);
        }
      },
    });

  const askAddLink = () =>
    setPrompt({
      title: "Add a link",
      initial: "",
      placeholder: "Paste a paper, article, or YouTube URL",
      confirmLabel: "Add",
      onConfirm: async (link) => {
        if (!link.trim()) return;
        setBusy("Fetching link…");
        try {
          onChange(await addSource(person.dir, link.trim()));
        } catch (e) {
          await confirm(String(e), { title: "Couldn’t add link", kind: "error" });
        } finally {
          setBusy(null);
        }
      },
    });

  const importPdf = async () => {
    const files = await pickPdfs();
    if (files.length === 0) return;
    setBusy("Importing…");
    try {
      onChange(await importPersonPdfs(person.dir, files));
    } catch (e) {
      await confirm(String(e), { title: "Couldn’t import", kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleSource = (s: Source) => {
    if (s.kind === "pdf" && s.file) {
      setOpenPdf({ path: joinPath(person.dir, s.file), title: s.title });
    } else if (s.url) {
      openExternal(s.url);
    }
  };

  const dropSource = async (s: Source) => {
    const ok = await confirm(`Remove “${s.title}” from ${person.name}?`, {
      title: "Remove",
      kind: "warning",
    });
    if (!ok) return;
    onChange(await removeSource(person.dir, s.id));
  };

  const removePerson = async () => {
    const ok = await confirm(`Move ${person.name}'s profile to the Trash?`, {
      title: "Delete person",
      kind: "warning",
    });
    if (ok) {
      await deletePerson(person.dir);
      onDelete();
    }
  };

  if (openPdf) {
    return (
      <div className="viewer">
        <div className="viewer-toolbar">
          <button onClick={() => setOpenPdf(null)}>‹ Back to profile</button>
          <span className="zoom-label" style={{ minWidth: 0 }}>
            {openPdf.title}
          </span>
        </div>
        <PdfViewer key={openPdf.path} path={openPdf.path} />
      </div>
    );
  }

  return (
    <div className="person">
      <div className="person-header">
        <div className="avatar-wrap" onClick={askPhoto} title="Set photo from a link">
          {person.photo ? (
            <LocalImage path={joinPath(person.dir, person.photo)} className="avatar" alt={person.name} />
          ) : (
            <div className="avatar avatar-empty">{initials(person.name)}</div>
          )}
          <div className="avatar-edit">✎</div>
        </div>
        <div className="person-meta">
          <input
            className="person-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveFields}
          />
          <textarea
            className="person-summary"
            placeholder="Add a brief summary…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={saveFields}
            rows={3}
          />
        </div>
        <button className="ghost person-delete" onClick={removePerson} title="Delete person">
          🗑
        </button>
      </div>

      <div className="person-toolbar">
        <button className="primary" onClick={askAddLink}>
          + Add link
        </button>
        <button onClick={importPdf}>Import PDF</button>
        {busy && <span className="busy">{busy}</span>}
      </div>

      <div className="sources">
        {person.sources.length === 0 ? (
          <div className="sources-empty">
            No resources yet. Add a paper, article, or YouTube link.
          </div>
        ) : (
          person.sources.map((s) => (
            <SourceCard key={s.id} person={person} source={s} onOpen={handleSource} onRemove={dropSource} />
          ))
        )}
      </div>

      {prompt && <PromptModal state={prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}

function SourceCard({
  person,
  source,
  onOpen,
  onRemove,
}: {
  person: Person;
  source: Source;
  onOpen: (s: Source) => void;
  onRemove: (s: Source) => void;
}) {
  const badge =
    source.kind === "youtube" ? "YouTube" : source.kind === "pdf" ? "PDF" : source.site ?? "Web";

  return (
    <div className={`card card-${source.kind}`} onClick={() => onOpen(source)}>
      <div className="card-thumb">
        {source.thumb ? (
          <LocalImage path={joinPath(person.dir, source.thumb)} className="thumb-img" />
        ) : (
          <div className="thumb-placeholder">{source.kind === "pdf" ? "📕" : "🔗"}</div>
        )}
        {source.kind === "youtube" && <div className="play-badge">▶</div>}
      </div>
      <div className="card-body">
        <div className="card-badge">{badge}</div>
        <div className="card-title">{source.title}</div>
        {source.description && <div className="card-desc">{source.description}</div>}
      </div>
      <button
        className="card-remove"
        title="Remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(source);
        }}
      >
        ×
      </button>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
