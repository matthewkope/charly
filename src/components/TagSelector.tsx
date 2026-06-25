import { useMemo, useState } from "react";
import { TagCount } from "../api";

// Zotero-style tag selector pinned at the bottom of the collections pane: a
// scrollable tag cloud above a "Filter Tags" field. Clicking a tag filters the
// library by it; clicking it again clears the filter.
export default function TagSelector({
  tags,
  active,
  onToggle,
}: {
  tags: TagCount[];
  active: string | null;
  onToggle: (tag: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? tags.filter((t) => t.tag.toLowerCase().includes(f)) : tags;
    return [...list].sort((a, b) => a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()));
  }, [tags, filter]);

  return (
    <div className="tag-selector">
      <div className="tag-cloud">
        {shown.length === 0 ? (
          <div className="tag-empty">No tags to display</div>
        ) : (
          shown.map((t) => (
            <button
              key={t.tag}
              className={`tag-chip${active === t.tag ? " active" : ""}`}
              onClick={() => onToggle(t.tag)}
              title={`${t.count} item${t.count === 1 ? "" : "s"}`}
            >
              {t.tag}
            </button>
          ))
        )}
      </div>
      <input
        className="tag-filter"
        placeholder="Filter Tags"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
    </div>
  );
}
