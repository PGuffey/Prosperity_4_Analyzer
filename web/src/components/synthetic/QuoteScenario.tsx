import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type SyntheticManifest } from "../../api";

/** Customize displayed liquidity, not market executions. */
export default function QuoteScenario({ manifest, onCreated }: { manifest: SyntheticManifest; onCreated: (m: SyntheticManifest) => void }) {
  const [bidDistance, setBidDistance] = useState(1);
  const [askDistance, setAskDistance] = useState(1);
  const [bidSize, setBidSize] = useState(10);
  const [askSize, setAskSize] = useState(10);
  const [custom, setCustom] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState("");
  const preview = useQuery({ queryKey: ["synthetic-prices", manifest.run_id], queryFn: () => api.syntheticPrices(manifest.run_id) });
  const create = useMutation({ mutationFn: () => api.customizeQuotes(manifest.run_id, {
    bid_distance: bidDistance, ask_distance: askDistance, bid_size: bidSize, ask_size: askSize,
    ...(custom ? { csv } : {}),
  }), onSuccess: onCreated });
  const download = useMutation({ mutationFn: () => api.exportSynthetic(manifest.run_id), onSuccess: blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `synthetic-${manifest.run_id}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  return <section className="quote-scenario">
    <p>Selected dataset: <strong>{manifest.name}</strong></p>
    <label>Quote setup<select value={custom ? "csv" : "distances"} onChange={e => setCustom(e.target.value === "csv")}>
      <option value="distances">Distances from the current mid</option><option value="csv">Exact bids and asks from CSV</option>
    </select></label>
    {custom ? <>
      <p className="dim">Columns: snapshot,bid_price,bid_size,ask_price,ask_size. Snapshot is the zero-based playback row (0–{manifest.n_snapshots - 1}). Only listed rows change. Use positive whole prices/sizes, with bid below ask.</p>
      <input aria-label="Custom quote CSV" type="file" accept=".csv,text/csv" onChange={async e => {
        const file = e.target.files?.[0]; setFileError(""); setCsv("");
        if (!file) return;
        if (file.size > 5_000_000) { setFileError("Choose a CSV no larger than 5 MB."); return; }
        try { setCsv(await file.text()); } catch { setFileError("Could not read that file."); }
      }} />
      <textarea aria-label="Quote CSV contents" rows={5} value={csv} placeholder={"snapshot,bid_price,bid_size,ask_price,ask_size\n0,9999,10,10001,15"} onChange={e => setCsv(e.target.value)} />
    </> : <>
      <div className="quote-fields">
        <label title="Bid = current mid minus this distance, rounded down to a whole tick.">Bid distance<input type="number" min={0} step="any" value={bidDistance} onChange={e => setBidDistance(Number(e.target.value))} /></label>
        <label title="Ask = current mid plus this distance, rounded up to a whole tick.">Ask distance<input type="number" min={0} step="any" value={askDistance} onChange={e => setAskDistance(Number(e.target.value))} /></label>
        <label title="Units available at the best bid.">Bid size<input type="number" min={1} max={100000} step={1} value={bidSize} onChange={e => setBidSize(Number(e.target.value))} /></label>
        <label title="Units available at the best ask.">Ask size<input type="number" min={1} max={100000} step={1} value={askSize} onChange={e => setAskSize(Number(e.target.value))} /></label>
      </div>
      <p className="dim">Applies to every valid snapshot. Missing mid prices remain unchanged.</p>
    </>}
    <p className="dim">Mid is recalculated halfway between the new bid and ask. Unequal distances can shift it. This creates quoted liquidity, not executions.</p>
    <button className="btn primary" disabled={create.isPending || (custom && !csv.trim())} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create copy with quotes"}</button>
    <button className="btn" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? "Preparing…" : "Export selected dataset"}</button>
    <p className="dim">The original stays unchanged. The new copy has no executed-trade tape. Export uses one artificial day and level-1 books; no conversion or settlement values are added.</p>
    {!!manifest.trades?.count && <p className="warn">This older dataset includes {manifest.trades.count} market prints. Exporting it keeps them; creating a quote copy excludes them.</p>}
    <details><summary>Preview selected quotes (first 8 snapshots)</summary>
      {preview.isPending ? <p>Loading…</p> : preview.data && <div className="quote-preview"><table><thead><tr><th>Snapshot</th><th>Bid</th><th>Size</th><th>Ask</th><th>Size</th></tr></thead><tbody>
        {preview.data.timestamp.slice(0, 8).map((_, i) => <tr key={i}><td>{i}</td><td>{preview.data.bid_price_1[i] ?? "—"}</td><td>{preview.data.bid_volume_1[i] ?? "—"}</td><td>{preview.data.ask_price_1[i] ?? "—"}</td><td>{preview.data.ask_volume_1[i] ?? "—"}</td></tr>)}
      </tbody></table></div>}
    </details>
    {(create.error || download.error || preview.error || fileError) && <p className="error" role="alert">{fileError || create.error?.message || download.error?.message || preview.error?.message}</p>}
  </section>;
}
