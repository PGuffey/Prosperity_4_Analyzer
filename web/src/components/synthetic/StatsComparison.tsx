import type { SyntheticManifest } from "../../api";
import { descriptions } from "../../lib/descriptions";

type Props = { manifest: SyntheticManifest | null };

function fmt(x: number, digits = 2): string {
  if (!isFinite(x)) return "—";
  if (Math.abs(x) < 0.01 && x !== 0) return x.toExponential(2);
  return x.toFixed(digits);
}

function deltaPct(syn: number, src: number): string {
  if (src === 0 || !isFinite(src)) return "—";
  const d = (syn - src) / src * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(2) + "%";
}

export default function StatsComparison({ manifest }: Props) {
  if (!manifest) {
    return <p className="empty">Generate a dataset to see stats.</p>;
  }
  const { source, synthetic } = manifest.stats;
  const rows: { key: string; label: string; digits?: number }[] = [
    { key: "mid_mean", label: "Mid mean" },
    { key: "mid_std", label: "Mid std", digits: 3 },
    { key: "mid_min", label: "Mid min" },
    { key: "mid_max", label: "Mid max" },
    { key: "autocorr_lag1", label: "Return autocorr (lag 1)", digits: 4 },
  ];
  return (
    <table className="stats-comparison">
      <thead>
        <tr>
          <th></th>
          <th>Source</th>
          <th>Synthetic</th>
          <th className="dim">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = (source as Record<string, number>)[r.key];
          const y = (synthetic as Record<string, number>)[r.key];
          return (
            <tr key={r.key}>
              <td title={descriptions[r.key]}>{r.label}</td>
              <td className="num">{fmt(s, r.digits)}</td>
              <td className="num">{fmt(y, r.digits)}</td>
              <td className="num dim">{deltaPct(y, s)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
