import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type HypothesisOp, type HypothesisRequest, type SyntheticManifest } from "../../api";
import { useSelection } from "../../store";
import { descriptions } from "../../lib/descriptions";

const INDICATORS: { id: string; label: string; window?: number }[] = [
  { id: "fixed_deviation", label: "Mid − reference" },
  { id: "sma_deviation", label: "Mid − SMA", window: 100 },
  { id: "ema_deviation", label: "Mid − EMA", window: 100 },
  { id: "microprice_gap", label: "Microprice − mid" },
  { id: "spread", label: "Spread" },
  { id: "imbalance", label: "OB imbalance" },
  { id: "returns", label: "Returns" },
  { id: "zscore", label: "Mid z-score", window: 500 },
  { id: "rolling_vol", label: "Rolling vol", window: 50 },
];

type Scope = "this" | "round" | "custom" | "synthetic";

type Preset = {
  id: string;
  name: string;
  description: string;
  indicator: string;
  op: HypothesisOp;
  threshold: number;
  horizon: number;
  window?: number;
  reference?: number;
  scope: Scope;
};

const PRESETS: Preset[] = [
  { id: "below-reference", name: "Below a reference price", description: "Inspect moves after mid falls below a reference. Set the reference for your product first.", indicator: "fixed_deviation", reference: 10000, op: "<", threshold: -5, horizon: 10, scope: "this" },
  { id: "below-sma", name: "Below the recent average", description: "Inspect moves after mid is five price units below its trailing average.", indicator: "sma_deviation", window: 100, op: "<", threshold: -5, horizon: 10, scope: "this" },
  { id: "below-ema", name: "Below the weighted average", description: "Inspect moves after mid is five price units below its EMA.", indicator: "ema_deviation", window: 100, op: "<", threshold: -5, horizon: 10, scope: "this" },
  { id: "microprice-pressure", name: "Positive microprice pressure", description: "Inspect moves when microprice is above mid.", indicator: "microprice_gap", op: ">", threshold: 0, horizon: 10, scope: "this" },
  {
    id: "bullish-book",
    name: "Bullish Book Pressure",
    description: "Strong bid-side depth predicts upward movement.",
    indicator: "imbalance",
    op: ">",
    threshold: 0.5,
    horizon: 10,
    scope: "this",
  },
  {
    id: "bearish-book",
    name: "Bearish Book Pressure",
    description: "Strong ask-side pressure predicts downward movement.",
    indicator: "imbalance",
    op: "<",
    threshold: -0.5,
    horizon: 10,
    scope: "this",
  },
  {
    id: "oversold-reversion",
    name: "Oversold Reversion",
    description: "Mid 2σ below its 500-tick mean rebounds within 50 ticks.",
    indicator: "zscore",
    op: "<",
    threshold: -2,
    horizon: 50,
    window: 500,
    scope: "round",
  },
  {
    id: "overbought-reversion",
    name: "Overbought Reversion",
    description: "Mid 2σ above its 500-tick mean reverts within 50 ticks.",
    indicator: "zscore",
    op: ">",
    threshold: 2,
    horizon: 50,
    window: 500,
    scope: "round",
  },
  {
    id: "sharp-drop-rebound",
    name: "Sharp Drop Rebound",
    description: "Single-tick return below -0.1% reverts within 10 ticks.",
    indicator: "returns",
    op: "<",
    threshold: -0.001,
    horizon: 10,
    scope: "round",
  },
];

type Props = {
  /** Initial form values (from a loaded saved hypothesis, optional). */
  initial?: Partial<HypothesisRequest> | null;
  /** Called when user hits Run with a valid request. */
  onRun: (req: HypothesisRequest) => void;
  /** Called when user hits Save. */
  onSave: (name: string, req: HypothesisRequest) => void;
  /** True while a test is in flight; disables Run. */
  busy?: boolean;
};

export default function HypothesisEditor({ initial, onRun, onSave, busy }: Props) {
  const { season, round, days, product } = useSelection();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });

  const [indicator, setIndicator] = useState(initial?.indicator ?? "imbalance");
  const [op, setOp] = useState<HypothesisOp>(initial?.op ?? ">");
  const [threshold, setThreshold] = useState<number>(initial?.threshold ?? 0.5);
  const [horizon, setHorizon] = useState<number>(initial?.horizon ?? 10);
  const [window, setWindowSize] = useState<number>(initial?.indicator_params?.window ?? 500);
  const [scope, setScope] = useState<Scope>("this");
  const [customProducts, setCustomProducts] = useState<string[]>(
    initial?.products ?? (product ? [product] : []),
  );
  const [syntheticId, setSyntheticId] = useState<string | null>(initial?.synthetic_id ?? null);
  const [saveName, setSaveName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [reference, setReference] = useState(initial?.indicator_params?.reference ?? 10000);

  const syntheticListQ = useQuery({
    queryKey: ["synthetic-list"],
    queryFn: api.listSynthetic,
  });
  const syntheticOptions: SyntheticManifest[] = syntheticListQ.data ?? [];

  const seasonCov = datasets.data?.seasons.find((s) => s.season === season);
  const roundCov = seasonCov?.rounds.find((r) => r.round === round);
  const allProductsInRound = roundCov?.products ?? [];

  // Apply a loaded saved hypothesis to the form. Re-runs only when `initial`
  // changes — not on product changes — and waits for the round's product list
  // so it can pick the right scope.
  useEffect(() => {
    if (!initial) return;
    setSelectedPreset("");
    setIndicator(initial.indicator ?? "imbalance");
    setOp(initial.op ?? ">");
    setThreshold(initial.threshold ?? 0.5);
    setHorizon(initial.horizon ?? 10);
    setWindowSize(initial.indicator_params?.window ?? 500);
    setReference(initial.indicator_params?.reference ?? 10000);
    setSyntheticId(initial.synthetic_id ?? null);

    const savedProducts = initial.products ?? [];
    setCustomProducts(savedProducts.length > 0 ? savedProducts : product ? [product] : []);

    // Choose scope based on synthetic-id presence first, then products vs round.
    if (initial.synthetic_id) {
      setScope("synthetic");
    } else if (savedProducts.length === 0) {
      setScope("this");
    } else if (savedProducts.length === 1) {
      setScope("this");
    } else if (
      allProductsInRound.length > 0 &&
      savedProducts.length === allProductsInRound.length &&
      savedProducts.every((p) => allProductsInRound.includes(p))
    ) {
      setScope("round");
    } else {
      setScope("custom");
    }
    // We intentionally do NOT depend on `product`; reading allProductsInRound is fine
    // because by the time `initial` flips, the parent has also updated the global
    // selectors, so the round coverage has refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, allProductsInRound.length]);

  const spec = useMemo(() => INDICATORS.find((i) => i.id === indicator), [indicator]);
  const usesWindow = spec?.window != null;

  const products = useMemo(() => {
    if (scope === "this") return product ? [product] : [];
    if (scope === "round") return allProductsInRound;
    if (scope === "synthetic") return [];   // derived on the backend from the synthetic frame
    return customProducts;
  }, [scope, product, allProductsInRound, customProducts]);

  const canRun =
    !busy &&
    (indicator !== "fixed_deviation" || (Number.isFinite(reference) && reference > 0)) &&
    (scope === "synthetic"
      ? syntheticId != null
      : season != null && round != null && days.length > 0 && products.length > 0);

  const build = (): HypothesisRequest | null => {
    if (!canRun) return null;
    return {
      season: season ?? "",
      round: round ?? 0,
      days,
      products,
      indicator,
      op,
      threshold,
      horizon,
      indicator_params: indicator === "fixed_deviation" ? { reference } : usesWindow ? { window } : {},
      synthetic_id: scope === "synthetic" ? syntheticId : null,
    };
  };

  const applyPreset = (p: Preset) => {
    setSelectedPreset(p.id);
    setIndicator(p.indicator);
    setOp(p.op);
    setThreshold(p.threshold);
    setHorizon(p.horizon);
    if (p.window != null) setWindowSize(p.window);
    if (p.reference != null) setReference(p.reference);
    setScope(p.scope);
    if (p.scope === "custom" && customProducts.length === 0 && product) {
      setCustomProducts([product]);
    }
  };

  return (
    <div className="hypothesis-editor">
      <div className="presets">
        <label>Presets
          <select aria-label="Presets" value={selectedPreset} onChange={e => {
            const preset = PRESETS.find(p => p.id === e.target.value);
            if (preset) applyPreset(preset);
            else setSelectedPreset("");
          }}>
            <option value="">None — choose a preset…</option>
            {PRESETS.map(p => <option key={p.id} value={p.id} title={p.description}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span title={descriptions[indicator]}>Signal</span>
          <select value={indicator} onChange={(e) => {
            setIndicator(e.target.value);
            setWindowSize(INDICATORS.find(i => i.id === e.target.value)?.window ?? 100);
          }}>
            {INDICATORS.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select value={op} onChange={(e) => setOp(e.target.value as HypothesisOp)}>
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
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
          />
        </label>
        <label>
          <span title={descriptions.horizon}>Look ahead (snapshots)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={horizon}
            onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        {indicator === "fixed_deviation" && (
          <label><span title={descriptions.reference}>Reference price</span>
            <input type="number" min={0.01} step="any" value={reference}
              onChange={e => setReference(Number(e.target.value))} />
          </label>
        )}
        {usesWindow && (
          <label>
            <span title={descriptions.window}>Window</span>
            <input
              type="number"
              min={2}
              step={10}
              value={window}
              onChange={(e) => setWindowSize(Math.max(2, Number(e.target.value) || 2))}
            />
          </label>
        )}
      </div>

      {indicator === "fixed_deviation" && <p className="dim">Set the reference for your product; 10000 is only an example.</p>}
      {selectedPreset && <details className="signal-description">
        <summary>What does this signal mean?</summary>
        <p className="dim">{descriptions[indicator]} {indicator === "fixed_deviation" && descriptions.reference}</p>
      </details>}
      <fieldset className="scope-picker">
        <legend title={descriptions.scope}>Test on</legend>
        <div className="scope-radios">
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "this"}
              onChange={() => setScope("this")}
            />
            Current Product ({product ?? "—"})
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "round"}
              onChange={() => setScope("round")}
            />
            All Products ({allProductsInRound.length})
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "custom"}
              onChange={() => {
                setScope("custom");
                if (customProducts.length === 0 && product) {
                  setCustomProducts([product]);
                }
              }}
            />
            Custom Selection
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "synthetic"}
              onChange={() => {
                setScope("synthetic");
                if (!syntheticId && syntheticOptions[0]) {
                  setSyntheticId(syntheticOptions[0].run_id);
                }
              }}
            />
            Synthetic Dataset ({syntheticOptions.length})
          </label>
        </div>
        {scope === "synthetic" && (
          <div className="synthetic-picker">
            {syntheticOptions.length === 0 ? (
              <p className="empty">
                No synthetic datasets. Generate one on the <code>Synthetic</code> page.
              </p>
            ) : (
              <label className="synthetic-select">
                <span className="syn-badge">SYN</span>
                <select
                  value={syntheticId ?? ""}
                  onChange={(e) => setSyntheticId(e.target.value || null)}
                >
                  {syntheticOptions.map((m) => (
                    <option key={m.run_id} value={m.run_id}>
                      {m.name} — {m.generator.name} · R{m.source.round} {m.source.product}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {scope === "custom" && (
          <div className="custom-products">
            {allProductsInRound.map((p) => (
              <label key={p} className="custom-product">
                <input
                  type="checkbox"
                  checked={customProducts.includes(p)}
                  onChange={(e) => {
                    setCustomProducts((cur) =>
                      e.target.checked
                        ? [...cur, p]
                        : cur.filter((x) => x !== p),
                    );
                  }}
                />
                <span>{p}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="actions">
        <button
          className="btn primary"
          disabled={!canRun}
          onClick={() => {
            const req = build();
            if (req) onRun(req);
          }}
        >
          {busy ? "Testing…" : "Run test"}
        </button>
        <input
          type="text"
          placeholder="save as…"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          className="save-name"
        />
        <button
          className="btn"
          disabled={!saveName.trim() || !canRun}
          onClick={() => {
            const req = build();
            if (req && saveName.trim()) {
              onSave(saveName.trim(), req);
              setSaveName("");
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
