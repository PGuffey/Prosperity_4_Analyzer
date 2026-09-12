export type Health = { status: string; version: string };

export type RoundCoverage = {
  season: string;
  round: number;
  days: number[];
  products: string[];
};

export type SeasonCoverage = { season: string; rounds: RoundCoverage[] };

export type DatasetsManifest = {
  seasons: SeasonCoverage[];
  generated_at: string | null;
};

export type PricesRange = {
  timestamp: number[];
  mid_price: (number | null)[];
  bid_price_1: (number | null)[];
  bid_volume_1: (number | null)[];
  ask_price_1: (number | null)[];
  ask_volume_1: (number | null)[];
};

export type TradesRange = {
  timestamp: number[];
  price: number[];
  quantity: number[];
  buyer: (string | null)[];
  seller: (string | null)[];
};

export type Orderbook = {
  timestamp: number;
  mid_price: number | null;
  spread: number | null;
  bids: [number, number][];
  asks: [number, number][];
};

export type DaySummary = {
  n_snapshots: number;
  t_min: number;
  t_max: number;
  mid_min: number | null;
  mid_max: number | null;
  mid_mean: number | null;
  mid_std: number | null;
  spread_mean: number | null;
  spread_min: number | null;
  spread_max: number | null;
  n_trades: number;
  volume: number;
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw await responseError(r);
  return r.json() as Promise<T>;
}

function qs(p: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) u.set(k, String(v));
  }
  return u.toString();
}

export type DayKey = {
  season: string;
  round: number;
  day: number;
  product: string;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await responseError(r);
  return r.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) throw await responseError(r);
}

/** Turn API validation failures into readable messages for the existing forms. */
async function responseError(r: Response): Promise<Error> {
  const body = await r.json().catch(() => null);
  const detail = body?.detail;
  const message = typeof detail === "string" ? detail : Array.isArray(detail)
    ? detail.map((d: { loc?: string[]; msg?: string }) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ")
    : `Request failed (${r.status}). Check that the API is running and try again.`;
  return new Error(message);
}

// ----- Hypothesis Checker -----

export type HypothesisOp = ">" | ">=" | "<" | "<=";

export type HypothesisRequest = {
  season: string;
  round: number;
  days: number[];
  products: string[];
  indicator: string;
  op: HypothesisOp;
  threshold: number;
  horizon: number;
  indicator_params?: Record<string, number>;
  bootstrap_iters?: number;
  seed?: number;
  synthetic_id?: string | null;
};

export type BreakdownRow = {
  count: number;
  hit_rate: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
};

export type HypothesisResult = {
  overall: BreakdownRow & {
    sample_size: number;
    signal_rate: number;
    ci_low: number;
    ci_high: number;
    warnings: string[];
  };
  per_day: (BreakdownRow & { day: number })[];
  per_product: (BreakdownRow & { product: string })[] | null;
  ios_split: {
    in_sample: BreakdownRow & { days: number[] };
    out_of_sample: BreakdownRow & { day: number };
  } | null;
  distribution: { edges: number[]; counts: number[] };
  hash: string;
};

export type SavedHypothesis = {
  slug: string;
  name: string;
  created_at: string;
  hypothesis: HypothesisRequest;
};

export type LogEntry = {
  id: number;
  created_at: string;
  hypothesis_hash: string;
  params: {
    indicator: string;
    op: HypothesisOp;
    threshold: number;
    horizon: number;
    indicator_params: Record<string, number>;
  };
  scope: {
    season: string;
    round: number;
    days: number[];
    products: string[];
  };
  n_events: number;
  sample_size: number;
  hit_rate: number;
  mean: number;
  ci_low: number;
  ci_high: number;
  warnings: string[];
};

// ----- Synthetic Data Lab -----

export type GeneratorParamSpec =
  | { type: "int"; default: number; min?: number; max?: number }
  | { type: "float"; default: number; min?: number; max?: number }
  | { type: "bool"; default: boolean }
  | { type: "enum"; default: string; options: string[] };

export type GeneratorMeta = {
  label: string;
  description: string;
  params: Record<string, GeneratorParamSpec>;
};

export type GenerateBody = {
  season: string;
  round: number;
  days: number[];
  product: string;
  generator: string;
  params: Record<string, number | string | boolean>;
  seed?: number;
  name?: string;
  notes?: string;
};

export type SyntheticManifest = {
  quotes?: { parent_run_id: string; mode: string } | null;
  trades?: { count: number; mode: string; parent_run_id?: string };
  run_id: string;
  name: string;
  created_at: string;
  source: { season: string; round: number; days: number[]; product: string };
  generator: { name: string; params: Record<string, unknown>; seed: number };
  n_snapshots: number;
  stats: {
    source: { mid_mean: number; mid_std: number; mid_min: number; mid_max: number; autocorr_lag1: number };
    synthetic: { mid_mean: number; mid_std: number; mid_min: number; mid_max: number; autocorr_lag1: number };
  };
  notes?: string | null;
};

export type SyntheticPrices = {
  timestamp: number[];
  mid_price: (number | null)[];
  bid_price_1: (number | null)[];
  bid_volume_1: (number | null)[];
  ask_price_1: (number | null)[];
  ask_volume_1: (number | null)[];
};

export const api = {
  customizeQuotes: (runId: string, body: { bid_distance: number; ask_distance: number; bid_size: number; ask_size: number; csv?: string }) =>
    post<SyntheticManifest>(`/api/synthetic/${runId}/quotes`, body),
  createSyntheticTrades: (runId: string, body: { probability?: number; buy_probability?: number; max_quantity?: number; seed?: number; csv?: string }) =>
    post<SyntheticManifest>(`/api/synthetic/${runId}/trades`, body),
  syntheticTrades: (runId: string) => get<{ count: number; rows: { snapshot: number; price: number; quantity: number; buyer: string; seller: string }[] }>(`/api/synthetic/${runId}/trades`),
  exportSynthetic: async (runId: string) => {
    const response = await fetch(`/api/synthetic/${runId}/export`);
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },
  analyzeBasket: (body: BasketRequest) => post<BasketResult>("/api/baskets/analyze", body),
  health: () => get<Health>("/api/health"),
  datasets: () => get<DatasetsManifest>("/api/datasets"),
  prices: (k: DayKey) =>
    get<PricesRange>(`/api/prices/range?${qs(k)}`),
  trades: (k: DayKey) =>
    get<TradesRange>(`/api/trades/range?${qs(k)}`),
  orderbook: (k: DayKey & { t: number }) =>
    get<Orderbook>(`/api/prices/orderbook?${qs(k)}`),
  summary: (k: DayKey) =>
    get<DaySummary>(`/api/summary/day?${qs(k)}`),

  testHypothesis: (req: HypothesisRequest) =>
    post<HypothesisResult>("/api/hypothesis/test", req),
  listSavedHypotheses: () => get<SavedHypothesis[]>("/api/hypothesis"),
  loadHypothesis: (slug: string) => get<SavedHypothesis>(`/api/hypothesis/${slug}`),
  saveHypothesis: (name: string, hypothesis: HypothesisRequest, overwriteSlug?: string) =>
    post<SavedHypothesis>("/api/hypothesis", {
      name,
      hypothesis,
      overwrite_slug: overwriteSlug ?? null,
    }),
  deleteHypothesis: (slug: string) => del(`/api/hypothesis/${slug}`),
  hypothesisLog: (limit = 20) => get<LogEntry[]>(`/api/hypothesis/log/recent?limit=${limit}`),

  syntheticGenerators: () => get<Record<string, GeneratorMeta>>("/api/synthetic/generators"),
  generateSynthetic: (body: GenerateBody) =>
    post<SyntheticManifest>("/api/synthetic/generate", body),
  listSynthetic: () => get<SyntheticManifest[]>("/api/synthetic"),
  syntheticManifest: (runId: string) =>
    get<SyntheticManifest>(`/api/synthetic/${runId}/manifest`),
  syntheticPrices: (runId: string) =>
    get<SyntheticPrices>(`/api/synthetic/${runId}/prices`),
  deleteSynthetic: (runId: string) => del(`/api/synthetic/${runId}`),
};

export type BasketRequest = { season: string; round: number; days: number[]; basket: string;
  components: { product: string; weight: number }[]; offset: number; threshold: number };
export type BasketResult = { request: BasketRequest; warnings: string[];
  series: { x: number[]; day: number[]; timestamp: number[]; basket_mid: (number | null)[];
    reference: (number | null)[]; residual: (number | null)[]; sell_gap: (number | null)[];
    buy_gap: (number | null)[]; sell_size: (number | null)[]; buy_size: (number | null)[] };
  summary: { snapshots: number; matched: number; missing: number; mean: number | null; std: number | null;
    above: number; below: number; sell_opportunities: number; buy_opportunities: number } };
