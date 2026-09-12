import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SavedHypothesis } from "../../api";

type Props = {
  onLoad: (h: SavedHypothesis) => void;
};

export default function SavedLibrary({ onLoad }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["saved-hypotheses"], queryFn: api.listSavedHypotheses });

  if (q.isLoading) return <p className="empty">…</p>;
  if (q.error) return <p className="error">Failed to load library.</p>;
  if (!q.data || q.data.length === 0) {
    return <p className="empty">No saved hypotheses yet.</p>;
  }

  return (
    <ul className="saved-list">
      {q.data.map((h) => (
        <li key={h.slug} className="saved-item">
          <button className="link" onClick={() => onLoad(h)}>
            {h.name}
          </button>
          <span className="saved-meta">
            {h.hypothesis.indicator} {h.hypothesis.op} {h.hypothesis.threshold}
            {" · h="}
            {h.hypothesis.horizon}
            {" · "}
            {h.hypothesis.products.length} prod
          </span>
          <button
            className="del-btn"
            title="Delete"
            onClick={async () => {
              if (!confirm(`Delete "${h.name}"?`)) return;
              await api.deleteHypothesis(h.slug);
              qc.invalidateQueries({ queryKey: ["saved-hypotheses"] });
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
