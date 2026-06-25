import { useState } from "react";
import { SavedSearch, SearchRule } from "../api";

const FIELDS: { key: SearchRule["field"]; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "tag", label: "Tag" },
  { key: "type", label: "Type" },
];
const OPS: { key: SearchRule["op"]; label: string }[] = [
  { key: "contains", label: "contains" },
  { key: "is", label: "is" },
];

function emptyRule(): SearchRule {
  return { field: "title", op: "contains", value: "" };
}

// Modal to create or edit a rule-based saved search.
export default function SavedSearchModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: SavedSearch | null;
  onSave: (s: SavedSearch) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [match, setMatch] = useState<"all" | "any">(initial?.match ?? "all");
  const [rules, setRules] = useState<SearchRule[]>(
    initial?.rules?.length ? initial.rules : [emptyRule()],
  );

  const setRule = (i: number, patch: Partial<SearchRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, emptyRule()]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  const save = () => {
    const clean = rules.filter((r) => r.value.trim());
    if (!name.trim()) return;
    onSave({
      id: initial?.id ?? `s-${Date.now()}`,
      name: name.trim(),
      match,
      rules: clean,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit Saved Search" : "New Saved Search"}</h3>
        <input
          className="search-name"
          placeholder="Search name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="search-match">
          Match
          <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of the following:
        </div>

        <div className="search-rules">
          {rules.map((r, i) => (
            <div className="search-rule" key={i}>
              <select value={r.field} onChange={(e) => setRule(i, { field: e.target.value as SearchRule["field"] })}>
                {FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value as SearchRule["op"] })}>
                {OPS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                placeholder={r.field === "type" ? "pdf, epub, charlylink…" : "value"}
                value={r.value}
                onChange={(e) => setRule(i, { value: e.target.value })}
              />
              <button
                className="rule-x"
                title="Remove rule"
                onClick={() => removeRule(i)}
                disabled={rules.length === 1}
              >
                ×
              </button>
            </div>
          ))}
          <button className="rule-add" onClick={addRule}>
            + Add rule
          </button>
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
