import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SyntheticManifest } from "../../api";

type Props = {
  onSelect: (m: SyntheticManifest) => void;
  selectedRunId?: string | null;
};

export default function SyntheticLibrary({ onSelect, selectedRunId }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["synthetic-list"], queryFn: api.listSynthetic });

  if (q.isLoading) return <p className="empty">…</p>;
  if (q.error) return <p className="error">Failed to load library.</p>;
  if (!q.data || q.data.length === 0) {
    return <p className="empty">No synthetic datasets yet.</p>;
  }

  return (
    <ul className="saved-list">
      {q.data.map((m) => (
        <li
          key={m.run_id}
          className={"saved-item" + (m.run_id === selectedRunId ? " selected" : "")}
        >
          <button className="link synth-link" onClick={() => onSelect(m)}>
            <span className="syn-badge">SYN</span>
            {m.name}
          </button>
          <span className="saved-meta">
            {m.generator.name} · R{m.source.round} {m.source.product}
          </span>
          <button
            className="del-btn"
            title="Delete"
            onClick={async (e) => {
              e.stopPropagation();
              if (!confirm(`Delete "${m.name}"?`)) return;
              await api.deleteSynthetic(m.run_id);
              qc.invalidateQueries({ queryKey: ["synthetic-list"] });
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
