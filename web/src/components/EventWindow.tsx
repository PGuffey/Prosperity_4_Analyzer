import { useMemo } from "react";
import type { PricesRange } from "../api";
import {
  imbalance1,
  deviationSeries,
  type IndicatorParams,
  microprice,
  returns as returnsSeries,
  rollingMean,
  rollingVol,
  rollingZScore,
  spread,
  type IndicatorId,
} from "../lib/indicators";
import { useSelection, type EventOp } from "../store";
import { descriptions } from "../lib/descriptions";

type Props = { prices: PricesRange };

const CANDIDATES: { id: IndicatorId; label: string }[] = [
  { id: "fixed_deviation", label: "Mid − reference" },
  { id: "sma_deviation", label: "Mid − SMA" },
  { id: "ema_deviation", label: "Mid − EMA" },
  { id: "microprice_gap", label: "Microprice − mid" },
  { id: "spread", label: "Spread" },
  { id: "imbalance", label: "OB imbalance" },
  { id: "returns", label: "Returns" },
  { id: "zscore", label: "Mid z-score" },
  { id: "rolling_vol", label: "Rolling vol" },
];

function evaluateSeries(p: PricesRange, id: IndicatorId, params: Partial<Record<IndicatorId, IndicatorParams>>): (number | null)[] {
  switch (id) {
    case "fixed_deviation":
    case "sma_deviation":
    case "ema_deviation":
    case "microprice_gap":
      return deviationSeries(p, id, params[id]);
    case "spread":
      return spread(p);
    case "imbalance":
      return imbalance1(p);
    case "returns":
      return returnsSeries(p);
    case "zscore":
      return rollingZScore(p.mid_price, params.zscore?.window ?? 500);
    case "rolling_vol":
      return rollingVol(returnsSeries(p), params.rolling_vol?.window ?? 50);
    case "microprice":
      return microprice(p);
    case "sma":
      return rollingMean(p.mid_price, params.sma?.window ?? 100);
    default:
      return new Array(p.timestamp.length).fill(null);
  }
}

function passes(op: EventOp, v: number, th: number): boolean {
  switch (op) {
    case ">":
      return v > th;
    case ">=":
      return v >= th;
    case "<":
      return v < th;
    case "<=":
      return v <= th;
  }
}

function quantile(arr: number[], q: number): number {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = q * (sorted.length - 1);
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export default function EventWindow({ prices }: Props) {
  const event = useSelection((s) => s.event);
  const params = useSelection((s) => s.indicatorParams);
  const set = useSelection((s) => s.set);

  const result = useMemo(() => {
    const sig = evaluateSeries(prices, event.indicator, params);
    const mid = prices.mid_price;
    const n = mid.length;
    const horizon = Math.max(1, event.horizon);
    const futureReturns: number[] = [];
    let hits = 0;
    let nonNullSig = 0;

    for (let i = 0; i < n - horizon; i++) {
      const v = sig[i];
      if (v == null || !Number.isFinite(v)) continue;
      const m0 = mid[i];
      const m1 = mid[i + horizon];
      if (m0 == null || m1 == null || m0 <= 0 || !Number.isFinite(m0) || !Number.isFinite(m1)) continue;
      nonNullSig++;
      if (!passes(event.op, v, event.threshold)) continue;
      const fr = (m1 - m0) / m0;
      futureReturns.push(fr);
      if (fr > 0) hits++;
    }

    const count = futureReturns.length;
    let mean = 0, median = 0, p10 = 0, p90 = 0;
    if (count) {
      for (const r of futureReturns) mean += r;
      mean /= count;
      median = quantile(futureReturns, 0.5);
      p10 = quantile(futureReturns, 0.1);
      p90 = quantile(futureReturns, 0.9);
    }
    const hitRate = count ? hits / count : 0;
    const signalRate = nonNullSig ? count / nonNullSig : 0;

    return { count, mean, median, p10, p90, hitRate, signalRate, sampleSize: nonNullSig };
  }, [prices, event, params]);

  const lowSample = result.count > 0 && result.count < 30;

  return (
    <>
      <div className="event-form">
        <label>
          <span title={descriptions[event.indicator]}>Signal</span>
          <select
            value={event.indicator}
            onChange={(e) => set({ event: { ...event, indicator: e.target.value as IndicatorId } })}
          >
            {CANDIDATES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          Op
          <select
            value={event.op}
            onChange={(e) => set({ event: { ...event, op: e.target.value as EventOp } })}
          >
            <option value=">">&gt;</option>
            <option value=">=">&ge;</option>
            <option value="<">&lt;</option>
            <option value="<=">&le;</option>
          </select>
        </label>
        <label>
          <span title={descriptions.threshold}>Threshold</span>
          <input
            type="number"
            step="0.01"
            value={event.threshold}
            onChange={(e) => set({ event: { ...event, threshold: Number(e.target.value) || 0 } })}
          />
        </label>
        <label>
          <span title={descriptions.horizon}>Horizon (snapshots)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={event.horizon}
            onChange={(e) => set({ event: { ...event, horizon: Math.max(1, Number(e.target.value) || 1) } })}
          />
        </label>
      </div>
      <p className="dim">Across selected days; uses the chart's indicator windows and reference price.</p>

      {result.count === 0 ? (
        <p className="empty">no matches in scope</p>
      ) : (
        <dl className="kv">
          <dt title={descriptions.signal_rate}>Sample</dt>
          <dd>
            {result.count.toLocaleString()} of {result.sampleSize.toLocaleString()} (
            {(result.signalRate * 100).toFixed(1)}%)
          </dd>
          <dt title={descriptions.hit_rate}>Hit rate (&gt;0)</dt>
          <dd>{(result.hitRate * 100).toFixed(1)}%</dd>
          <dt title={descriptions.mean}>Mean return</dt>
          <dd>{(result.mean * 100).toFixed(3)}%</dd>
          <dt title={descriptions.median}>Median</dt>
          <dd>{(result.median * 100).toFixed(3)}%</dd>
          <dt title={descriptions.percentiles}>P10 / P90</dt>
          <dd>
            {(result.p10 * 100).toFixed(3)}% / {(result.p90 * 100).toFixed(3)}%
          </dd>
        </dl>
      )}
      {lowSample && (
        <p className="warn">Low sample count — bootstrap & out-of-day checks recommended.</p>
      )}
    </>
  );
}

/** Expose the live result so the panel header can show "N matches". */
export function useEventCount(prices: PricesRange): number {
  const event = useSelection((s) => s.event);
  const params = useSelection((s) => s.indicatorParams);
  return useMemo(() => {
    const sig = evaluateSeries(prices, event.indicator, params);
    const mid = prices.mid_price;
    const horizon = Math.max(1, event.horizon);
    let count = 0;
    for (let i = 0; i < mid.length - horizon; i++) {
      const v = sig[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (!passes(event.op, v, event.threshold)) continue;
      const m0 = mid[i];
      const m1 = mid[i + horizon];
      if (m0 == null || m1 == null || m0 <= 0 || !Number.isFinite(m0) || !Number.isFinite(m1)) continue;
      count++;
    }
    return count;
  }, [prices, event, params]);
}
