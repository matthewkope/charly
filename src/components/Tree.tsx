import { useEffect, useState } from "react";
import { Entry, isSupported, listDir } from "../api";

interface NodeProps {
  entry: Entry;
  depth: number;
  version: number;
  selectedPath: string | null;
  onSelect: (entry: Entry) => void;
  onContext: (entry: Entry, x: number, y: number) => void;
}

function fileIcon(ext: string): string {
  if (ext === "pdf") return "📕";
  if (ext === "epub") return "📗";
  return "📄";
}

function TreeNode({ entry, depth, version, selectedPath, onSelect, onContext }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);

  useEffect(() => {
    if (entry.is_dir && expanded) {
      listDir(entry.path).then(setChildren).catch(() => setChildren([]));
    }
  }, [entry.path, entry.is_dir, expanded, version]);

  const isSelected = selectedPath === entry.path;
  const indent = { paddingLeft: 8 + depth * 14 };

  const handleClick = () => {
    if (entry.is_dir) {
      setExpanded((e) => !e);
    } else {
      onSelect(entry);
    }
  };

  return (
    <>
      <div
        className={`tree-row${isSelected ? " selected" : ""}${
          !entry.is_dir && !isSupported(entry.ext) ? " unsupported" : ""
        }`}
        style={indent}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(entry, e.clientX, e.clientY);
        }}
        title={entry.name}
      >
        <span className="tree-icon">
          {entry.is_dir ? (expanded ? "📂" : "📁") : fileIcon(entry.ext)}
        </span>
        <span className="tree-label">{entry.name}</span>
      </div>
      {entry.is_dir && expanded && children?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          version={version}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContext={onContext}
        />
      ))}
    </>
  );
}

interface TreeProps {
  root: string;
  version: number;
  selectedPath: string | null;
  onSelect: (entry: Entry) => void;
  onContext: (entry: Entry, x: number, y: number) => void;
}

export default function Tree({ root, version, selectedPath, onSelect, onContext }: TreeProps) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    listDir(root).then(setEntries).catch(() => setEntries([]));
  }, [root, version]);

  if (entries.length === 0) {
    return <div className="tree-empty">This folder is empty. Import documents or create a folder.</div>;
  }

  return (
    <div className="tree">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          version={version}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContext={onContext}
        />
      ))}
    </div>
  );
}
