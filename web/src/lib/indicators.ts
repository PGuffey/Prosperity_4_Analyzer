/**
 * Pure client-side indicators computed from PricesRange / TradesRange.
 * All functions return `(number | null)[]` aligned to the input price grid.
 * Null is used for "not enough data yet" (warm-up region of rolling windows)
 * or when an input is null.
 */

import type { PricesRange, TradesRange } from "../api";

type N = (number | null)[];
type NumArr = readonly (number | null)[];

// ---------- price-grid indicators ----------

export function spread(p: PricesRange): N {
  const out: N = new Array(p.timestamp.length).fill(null);
  for (let i = 0; i < out.length; i++) {
    const b = p.bid_price_1[i];
    const a = p.ask_price_1[i];
    if (b != null && a != null) out[i] = a - b;
  }
  return out;
}

export function microprice(p: PricesRange): N {
  const out: N = new Array(p.timestamp.length).fill(null);
  for (let i = 0; i < out.length; i++) {
    const b = p.bid_price_1[i];
    const a = p.ask_price_1[i];
    const bv = p.bid_volume_1[i];
    const av = p.ask_volume_1[i];
    if (b != null && a != null && bv != null && av != null && bv + av > 0) {
      out[i] = (a * bv + b * av) / (bv + av);
    }
  }
  return out;
}

export function imbalance1(p: PricesRange): N {
  // (bid_vol - ask_vol) / (bid_vol + ask_vol), -1..+1
  const out: N = new Array(p.timestamp.length).fill(null);
  for (let i = 0; i < out.length; i++) {
    const bv = p.bid_volume_1[i];
    const av = p.ask_volume_1[i];
    if (bv != null && av != null && bv + av > 0) {
      out[i] = (bv - av) / (bv + av);
    }
  }
  return out;
}

export function returns(p: PricesRange): N {
  const out: N = new Array(p.timestamp.length).fill(null);
  for (let i = 1; i < out.length; i++) {
    const prev = p.mid_price[i - 1];
    const curr = p.mid_price[i];
    if (prev != null && curr != null && prev > 0) {
      out[i] = (curr - prev) / prev;
    }
  }
  return out;
}

export function rollingMean(values: NumArr, window: number): N {
  const n = values.length;
  const out: N = new Array(n).fill(null);
  if (window <= 0) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v != null) {
      sum += v;
      count++;
    }
    if (i >= window) {
      const prev = values[i - window];
      if (prev != null) {
        sum -= prev;
        count--;
      }
    }
    if (count === window) out[i] = sum / count;
  }
  return out;
}

export function rollingStd(values: NumArr, window: number): N {
  // Sample stddev over the rolling window (count > 1).
  const n = values.length;
  const out: N = new Array(n).fill(null);
  if (window <= 1) return out;
  for (let i = window - 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    if (count !== window) continue;
    const mean = sum / count;
    let ss = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (v != null) ss += (v - mean) * (v - mean);
    }
    out[i] = Math.sqrt(ss / (count - 1));
  }
  return out;
}

export function rollingZScore(values: NumArr, window: number): N {
  const mean = rollingMean(values, window);
  const std = rollingStd(values, window);
  const out: N = new Array(values.length).fill(null);
  for (let i = 0; i < out.length; i++) {
    const v = values[i];
    const m = mean[i];
    const s = std[i];
    if (v != null && m != null && s != null && s > 0) {
      out[i] = (v - m) / s;
    }
  }
  return out;
}

export function rollingVol(values: NumArr, window: number): N {
  // Convenience alias: rolling stddev of (typically) returns.
  return rollingStd(values, window);
}

/** Trades-aligned VWAP, projected onto the price grid by carrying the last
 *  known VWAP forward. Cumulative across the visible window. */
export function vwapOnPriceGrid(p: PricesRange, t: TradesRange): N {
  const n = p.timestamp.length;
  const out: N = new Array(n).fill(null);
  let cumNum = 0;
  let cumDen = 0;
  let ti = 0;
  let lastVwap: number | null = null;
  for (let i = 0; i < n; i++) {
    const ts = p.timestamp[i];
    while (ti < t.timestamp.length && t.timestamp[ti] <= ts) {
      cumNum += t.price[ti] * t.quantity[ti];
      cumDen += t.quantity[ti];
      ti++;
    }
    if (cumDen > 0) lastVwap = cumNum / cumDen;
    out[i] = lastVwap;
  }
  return out;
}

// ---------- catalog metadata ----------

/** Past/current EMA. Gaps stay blank and do not advance its observation count. */
export function ema(values: NumArr, window: number): N {
  let level: number | null = null;
  let count = 0;
  const alpha = 2 / (window + 1);
  return values.map(value => {
    if (value == null || !Number.isFinite(value) || window < 2) return null;
    level = level == null ? value : alpha * value + (1 - alpha) * level;
    return ++count >= window ? level : null;
  });
}

export type IndicatorParams = { window?: number; reference?: number };

/** Price-unit differences shared by Explorer and its event analysis. */
export function deviationSeries(p: PricesRange, id: IndicatorId, params: IndicatorParams = {}): N {
  const window = params.window ?? 100;
  const baseline = id === "sma_deviation" ? rollingMean(p.mid_price, window)
    : id === "ema_deviation" ? ema(p.mid_price, window)
    : id === "microprice_gap" ? microprice(p) : null;
  return p.mid_price.map((mid, i) => {
    const base = baseline ? baseline[i] : params.reference ?? 10000;
    if (mid == null || base == null || !Number.isFinite(mid) || !Number.isFinite(base)) return null;
    if (id === "fixed_deviation" && base <= 0) return null;
    return id === "microprice_gap" ? base - mid : mid - base;
  });
}

export type IndicatorId =
  | "fixed_deviation"
  | "sma_deviation"
  | "ema_deviation"
  | "microprice_gap"
  | "microprice"
  | "sma"
  | "vwap"
  | "spread"
  | "imbalance"
  | "returns"
  | "zscore"
  | "rolling_vol";

export type IndicatorKind = "overlay" | "subchart";

export type IndicatorSpec = {
  id: IndicatorId;
  label: string;
  kind: IndicatorKind;
  /** Optional param name -> default value (window). */
  params?: IndicatorParams;
};

export const INDICATORS: Record<IndicatorId, IndicatorSpec> = {
  fixed_deviation: { id: "fixed_deviation", label: "Mid − reference", kind: "subchart", params: { reference: 10000 } },
  sma_deviation: { id: "sma_deviation", label: "Mid − SMA", kind: "subchart", params: { window: 100 } },
  ema_deviation: { id: "ema_deviation", label: "Mid − EMA", kind: "subchart", params: { window: 100 } },
  microprice_gap: { id: "microprice_gap", label: "Microprice − mid", kind: "subchart" },
  microprice: { id: "microprice", label: "Microprice", kind: "overlay" },
  sma: { id: "sma", label: "Mid SMA", kind: "overlay", params: { window: 100 } },
  vwap: { id: "vwap", label: "VWAP", kind: "overlay" },
  spread: { id: "spread", label: "Spread", kind: "subchart" },
  imbalance: { id: "imbalance", label: "OB imbalance", kind: "subchart" },
  returns: { id: "returns", label: "Returns", kind: "subchart" },
  zscore: { id: "zscore", label: "Mid z-score", kind: "subchart", params: { window: 500 } },
  rolling_vol: {
    id: "rolling_vol",
    label: "Rolling vol",
    kind: "subchart",
    params: { window: 50 },
  },
};
