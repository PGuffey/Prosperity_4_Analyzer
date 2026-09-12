import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";

function pct(x: number, digits = 2): string {
  return (x * 100).toFixed(digits) + "%";
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function HistoryLog() {
  const q = useQuery({
    queryKey: ["hypothesis-log"],
    queryFn: () => api.hypothesisLog(20),
    refetchInterval: 5_000,
  });

  if (q.isLoading) return <p className="empty">…</p>;
  if (q.error) return <p className="error">Failed to load log.</p>;
  if (!q.data || q.data.length === 0) {
    return <p className="empty">No tests run yet.</p>;
  }

  return (
    <ul className="log-list">
      {q.data.map((entry) => (
        <li key={entry.id} className="log-item">
          <div className="log-head">
            <span className="log-time">{relTime(entry.created_at)}</span>
            <span className="log-events">{entry.n_events.toLocaleString()} ev</span>
          </div>
          <div className="log-params">
            {entry.params.indicator} {entry.params.op} {entry.params.threshold}
            {" · h="}
            {entry.params.horizon}
          </div>
          <div className="log-stats">
            <span className={entry.hit_rate >= 0.5 ? "pos" : "neg"}>
              hit {pct(entry.hit_rate, 1)}
            </span>
            {" · "}
            <span className={entry.mean >= 0 ? "pos" : "neg"}>
              {pct(entry.mean, 3)}
            </span>
            {" · "}
            <span className="log-scope">
              R{entry.scope.round} ·{" "}
              {entry.scope.products.length === 1
                ? entry.scope.products[0]
                : `${entry.scope.products.length} prod`}
            </span>
          </div>
          {entry.warnings.length > 0 && (
            <div className="log-warn">⚠ {entry.warnings.join(" · ")}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
