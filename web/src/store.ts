import { create } from "zustand";
import type { IndicatorId } from "./lib/indicators";

export type EventOp = ">" | ">=" | "<" | "<=";

export type EventConfig = {
  indicator: IndicatorId;
  op: EventOp;
  threshold: number;
  /** Horizon in price-grid snapshots (e.g. 10 = 1000 ticks). */
  horizon: number;
};

type SelectionState = {
  chartLayers: { bid: boolean; ask: boolean; trades: boolean };
  toggleChartLayer: (key: "bid" | "ask" | "trades") => void;
  season: string | null;
  round: number | null;
  /** Selected days, sorted ascending; skipped days are not reconstructed. */
  days: number[];
  product: string | null;
  /** Currently hovered/active timestamp on the chart (synthetic when multi-day). */
  cursorT: number | null;

  /** Which indicators are visible on the chart / subcharts. */
  enabledIndicators: IndicatorId[];
  /** Per-indicator user-tuned params (window sizes). Falls back to spec defaults. */
  indicatorParams: Partial<Record<IndicatorId, { window?: number; reference?: number }>>;

  /** Event Window analysis configuration. */
  event: EventConfig;

  set: (patch: Partial<Omit<SelectionState, "set">>) => void;
  toggleIndicator: (id: IndicatorId) => void;
  setIndicatorParam: (id: IndicatorId, param: "window" | "reference", value: number) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  chartLayers: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pma-chart-layers") ?? "{}");
      return { bid: saved.bid === true, ask: saved.ask === true, trades: saved.trades === true };
    } catch { return { bid: false, ask: false, trades: false }; }
  })(),
  toggleChartLayer: (key) => set(state => {
    const chartLayers = { ...state.chartLayers, [key]: !state.chartLayers[key] };
    try { localStorage.setItem("pma-chart-layers", JSON.stringify(chartLayers)); } catch { /* Session controls still work if storage is unavailable. */ }
    return { chartLayers };
  }),
  season: null,
  round: null,
  days: [],
  product: null,
  cursorT: null,

  enabledIndicators: [],
  indicatorParams: {},

  event: { indicator: "imbalance", op: ">", threshold: 0.5, horizon: 10 },

  set: (patch) => set({
    ...patch,
    ...("days" in patch ? { days: [...new Set(patch.days)].sort((a, b) => a - b) } : {}),
    ...(["season", "round", "days", "product"].some(key => key in patch) ? { cursorT: null } : {}),
  }),
  toggleIndicator: (id) =>
    set((state) => ({
      enabledIndicators: state.enabledIndicators.includes(id)
        ? state.enabledIndicators.filter((x) => x !== id)
        : [...state.enabledIndicators, id],
    })),
  setIndicatorParam: (id, param, value) =>
    set((state) => ({
      indicatorParams: {
        ...state.indicatorParams,
        [id]: { ...(state.indicatorParams[id] ?? {}), [param]: value },
      },
    })),
}));

/** Span of synthetic timestamps allocated to each day in a multi-day view. */
export const DAY_TS_SPAN = 1_000_000;

/** Map a (day_index, raw_t) to a single synthetic chart x-coordinate. */
export const toSyntheticT = (dayIndex: number, rawT: number) =>
  dayIndex * DAY_TS_SPAN + rawT;

/** Decode a synthetic chart x back to (day_index, raw_t). */
export const fromSyntheticT = (
  syntheticT: number
): { dayIndex: number; rawT: number } => {
  const dayIndex = Math.floor(syntheticT / DAY_TS_SPAN);
  const rawT = syntheticT - dayIndex * DAY_TS_SPAN;
  return { dayIndex, rawT };
};
