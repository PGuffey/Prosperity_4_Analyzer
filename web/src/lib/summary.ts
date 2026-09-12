import type { DaySummary, PricesRange, TradesRange } from "../api";

/** Summarize loaded rows, including variation between days and missing books. */
export function summarize(prices: PricesRange, trades: TradesRange): DaySummary {
  function stats(values: (number | null)[]) {
    let n = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity;
    for (const v of values) {
      if (v == null || !Number.isFinite(v)) continue;
      n++;
      const delta = v - mean;
      mean += delta / n;
      m2 += delta * (v - mean);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return { mean: n ? mean : null, min: n ? min : null, max: n ? max : null,
      std: n > 1 ? Math.sqrt(m2 / (n - 1)) : null };
  }
  const mid = stats(prices.mid_price);
  const spread = stats(prices.ask_price_1.map((a, i) => {
    const b = prices.bid_price_1[i];
    return a != null && b != null ? a - b : null;
  }));
  return {
    n_snapshots: prices.timestamp.length,
    t_min: prices.timestamp[0] ?? 0,
    t_max: prices.timestamp.at(-1) ?? 0,
    mid_min: mid.min, mid_max: mid.max, mid_mean: mid.mean, mid_std: mid.std,
    spread_min: spread.min, spread_max: spread.max, spread_mean: spread.mean,
    n_trades: trades.timestamp.length, volume: trades.quantity.reduce((a, b) => a + b, 0),
  };
}
