import type { DaySummary } from "../api";
import { descriptions } from "../lib/descriptions";

type Props = { summary?: DaySummary };

function fmt(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return "—";
  return Number(x).toFixed(digits);
}

export default function SummaryPanel({ summary }: Props) {
  if (!summary) return <p className="empty">…</p>;
  return (
    <dl className="kv">
      <dt title={descriptions.n_snapshots}>Snapshots</dt><dd>{summary.n_snapshots.toLocaleString()}</dd>
      <dt title={descriptions.n_trades}>Trades</dt><dd>{summary.n_trades.toLocaleString()}</dd>
      <dt title={descriptions.volume}>Volume</dt><dd>{summary.volume.toLocaleString()}</dd>
      <dt title={descriptions.mid_range}>Mid range</dt>
      <dd>{fmt(summary.mid_min)} — {fmt(summary.mid_max)}</dd>
      <dt title={descriptions.mid_mean}>Mid mean</dt><dd>{fmt(summary.mid_mean)}</dd>
      <dt title={descriptions.mid_std}>Mid std</dt><dd>{fmt(summary.mid_std, 4)}</dd>
      <dt title={descriptions.spread_mean}>Spread mean</dt><dd>{fmt(summary.spread_mean, 3)}</dd>
      <dt title={descriptions.spread_range}>Spread range</dt>
      <dd>{fmt(summary.spread_min)} — {fmt(summary.spread_max)}</dd>
    </dl>
  );
}
