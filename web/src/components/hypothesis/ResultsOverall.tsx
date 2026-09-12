import type { HypothesisResult } from "../../api";
import { descriptions } from "../../lib/descriptions";

function pct(x: number, digits = 3): string {
  return (x * 100).toFixed(digits) + "%";
}

export default function ResultsOverall({ result }: { result: HypothesisResult | null }) {
  if (!result) {
    return <p className="empty">Press Run to evaluate.</p>;
  }
  const o = result.overall;
  if (o.count === 0) return <p className="empty">{o.warnings.join(" ") || "No matching events with a future price."}</p>;
  return (
    <div className="overall">
      <div className="overall-row">
        <span className="overall-stat">
          <span className="lbl" title={descriptions.count}>Events</span>
          <span className="val">{o.count.toLocaleString()}</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.signal_rate}>Signal rate</span>
          <span className="val">{pct(o.signal_rate, 2)}</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.hit_rate}>Price rose</span>
          <span className={"val " + (o.hit_rate >= 0.5 ? "pos" : "neg")}>{pct(o.hit_rate, 1)}</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.mean}>Mean mid return</span>
          <span className={"val " + (o.mean >= 0 ? "pos" : "neg")}>{pct(o.mean)}</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.bootstrap}>95% bootstrap interval</span>
          <span className="val">[{pct(o.ci_low)}, {pct(o.ci_high)}]</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.median}>Median</span>
          <span className="val">{pct(o.median)}</span>
        </span>
        <span className="overall-stat">
          <span className="lbl" title={descriptions.percentiles}>P10 / P90</span>
          <span className="val">{pct(o.p10)} / {pct(o.p90)}</span>
        </span>
      </div>
      {o.warnings.length > 0 && (
        <ul className="warnings">
          {o.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
