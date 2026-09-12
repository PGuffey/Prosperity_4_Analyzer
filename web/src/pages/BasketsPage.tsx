import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { api, type BasketRequest } from "../api";
import { useSelection } from "../store";
import SubChart from "../components/SubChart";
import { createZoomGroup } from "../lib/chartSync";

const fmt = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function BasketsPage() {
  const { season, round, days, product } = useSelection(useShallow(s => ({ season: s.season, round: s.round, days: s.days, product: s.product })));
  // Reset the setup on market changes, but never on cursor movement.
  return <BasketSetup key={`${season}:${round}`} season={season} round={round} days={days} product={product} />;
}

function BasketSetup({ season, round, days, product }: { season: string | null; round: number | null; days: number[]; product: string | null }) {
  const coverage = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
  const products = coverage.data?.seasons.find(s => s.season === season)?.rounds.find(r => r.round === round)?.products ?? [];
  const [basket, setBasket] = useState(product ?? "");
  const [legs, setLegs] = useState([{ product: "", weight: 1 }]);
  const [offset, setOffset] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const result = useMutation({ mutationFn: (req: BasketRequest) => api.analyzeBasket(req) });
  const zoom = useMemo(createZoomGroup, []);
  const data = result.data;
  const comparison = useMemo(() => data ? { ys: data.series.reference, label: "Reference", color: "#c084fc" } : undefined, [data]);
  const cursor = useSelection(s => s.cursorT);
  const index = data && cursor != null ? Math.max(0, Math.min(data.series.x.length - 1, Math.round(cursor))) : null;
  const ready = season && round != null && days.length && products.includes(basket) && legs.every(l => products.includes(l.product) && Number.isInteger(l.weight) && l.weight > 0)
    && new Set([basket, ...legs.map(l => l.product)]).size === legs.length + 1 && Number.isFinite(offset) && Number.isFinite(threshold) && threshold >= 0;
  return <div className="basket-page" role="region" aria-label="Basket analysis workspace" tabIndex={0}>
    <h2>Basket analysis</h2>
    <p className="dim">Define a relationship and inspect where prices separate. This does not simulate a trading strategy.</p>
    <section className="basket-setup">
      <label>Basket<select value={basket} onChange={e => setBasket(e.target.value)}><option value="">Choose product…</option>{products.map(p => <option key={p}>{p}</option>)}</select></label>
      {legs.map((leg, i) => <div className="basket-leg" key={i}>
        <label>Component {i + 1}<select value={leg.product} onChange={e => setLegs(cur => cur.map((l, n) => n === i ? { ...l, product: e.target.value } : l))}>
          <option value="">Choose product…</option>{products.filter(p => p !== basket).map(p => <option key={p}>{p}</option>)}
        </select></label>
        <label title="Whole units of this component per basket unit.">Weight<input type="number" min={1} max={10000} step={1} value={leg.weight} onChange={e => setLegs(cur => cur.map((l, n) => n === i ? { ...l, weight: Number(e.target.value) } : l))} /></label>
        <button className="btn" aria-label={`Remove component ${i + 1}`} disabled={legs.length === 1} onClick={() => setLegs(cur => cur.filter((_, n) => n !== i))}>Remove</button>
      </div>)}
      <div className="basket-actions">
        <button className="btn" disabled={legs.length >= 8} onClick={() => setLegs(cur => [...cur, { product: "", weight: 1 }])}>Add component</button>
        <label title="Constant added to the weighted component mids. Not treated as cash received or a conversion fee.">Reference offset<input type="number" step="any" value={offset} onChange={e => setOffset(Number(e.target.value))} /></label>
        <label title="Count residuals above +threshold and below −threshold, in price units.">Gap threshold<input type="number" min={0} step="any" value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label>
        <button className="btn primary" disabled={!ready || result.isPending} onClick={() => result.mutate({ season: season!, round: round!, days, basket, components: legs, offset, threshold })}>{result.isPending ? "Analyzing…" : "Analyze relationship"}</button>
      </div>
    </section>
    {coverage.error && <p className="error">{coverage.error.message}</p>}
    {result.error && <p className="error" role="alert">{result.error.message}</p>}
    {data && <section>
      <p className="run-context">Output: {data.request.basket} − ({data.request.components.map(l => `${l.weight} × ${l.product}`).join(" + ")} + {data.request.offset}) · R{data.request.round} · days {data.request.days.join(", ")}</p>
      <div className="basket-stats">
        <span title="Snapshots with valid mids for every leg, out of the union of observed timestamps.">Matched: {data.summary.matched.toLocaleString()} / {data.summary.snapshots.toLocaleString()}</span>
        <span title="Average basket mid minus your weighted reference.">Mean gap: {fmt(data.summary.mean)}</span>
        <span title="Sample standard deviation of matched residuals, in price units.">Gap fluctuation: {fmt(data.summary.std)}</span>
        <span title="Counts over all matched snapshots; not independent trading opportunities.">Above +{data.request.threshold}: {data.summary.above} · Below −{data.request.threshold}: {data.summary.below}</span>
      </div>
      {data.warnings.map(w => <p className="dim" key={w}>{w}</p>)}
      <button className="btn" onClick={() => zoom.reset()}>Reset zoom</button>
      <p className="dim">Drag any chart to zoom all. X axis = ordered snapshot index; hover for day/time.</p>
      <p aria-live="polite">{index != null ? `Day ${data.series.day[index]} · timestamp ${data.series.timestamp[index]} · sell gap ${fmt(data.series.sell_gap[index])} / size ${fmt(data.series.sell_size[index])} · buy gap ${fmt(data.series.buy_gap[index])} / size ${fmt(data.series.buy_size[index])}` : "Hover a chart to inspect quoted gaps and available whole-basket size."}</p>
      <div className="basket-charts">
        <SubChart xs={data.series.x} ys={data.series.basket_mid} comparison={comparison} label="Basket (white) / reference (purple)" color="#d8dde3" description="Reference = offset + weighted component mids." zoomGroup={zoom} syncKey="pma-baskets" showXAxis />
        <SubChart xs={data.series.x} ys={data.series.residual} label="Residual (price units)" color="#fbbf24" description="Basket mid minus reference. Missing legs stay blank." zeroLine zoomGroup={zoom} syncKey="pma-baskets" showXAxis />
        <SubChart xs={data.series.x} ys={data.series.sell_gap} label="Sell basket / buy components" color="#4dd0a3" description="Basket bid minus weighted component asks, before costs. Hover for size." zeroLine zoomGroup={zoom} syncKey="pma-baskets" showXAxis />
        <SubChart xs={data.series.x} ys={data.series.buy_gap} label="Buy basket / sell components" color="#5ac8fa" description="Weighted component bids minus basket ask, before costs. Hover for size." zeroLine zoomGroup={zoom} syncKey="pma-baskets" showXAxis />
      </div>
      <p className="dim">Positive quoted gaps with at least one basket of displayed size: sell {data.summary.sell_opportunities}, buy {data.summary.buy_opportunities} snapshots. Simultaneous fills are not guaranteed. No conversion rule is assumed.</p>
    </section>}
  </div>;
}
