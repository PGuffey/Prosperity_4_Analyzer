import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel, Separator } from "react-resizable-panels";
import { api, type GenerateBody, type SyntheticManifest, type SyntheticPrices } from "../api";
import { useSelection } from "../store";
import PanelShell from "../components/PanelShell";
import PersistedGroup from "../components/PersistedGroup";
import Workspace from "../components/Workspace";
import GeneratorForm from "../components/synthetic/GeneratorForm";
import PreviewChart from "../components/synthetic/PreviewChart";
import StatsComparison from "../components/synthetic/StatsComparison";
import SyntheticLibrary from "../components/synthetic/SyntheticLibrary";
import QuoteScenario from "../components/synthetic/QuoteScenario";

const EMPTY: SyntheticPrices = {
  timestamp: [], mid_price: [], bid_price_1: [], bid_volume_1: [],
  ask_price_1: [], ask_volume_1: [],
};

export default function SyntheticPage() {
  const qc = useQueryClient();
  const { season, round, days, product } = useSelection();
  const [active, setActive] = useState<SyntheticManifest | null>(null);
  const [showQuotes, setShowQuotes] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [quoteNotice, setQuoteNotice] = useState("");
  useEffect(() => {
    if (showQuotes) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showQuotes]);

  const ready = season != null && round != null && days.length > 0 && product != null;

  // Source price series for preview. We compute the merged-by-day series ourselves to
  // match the chart's expectations.
  const sourceQ = useQuery({
    queryKey: ["synthetic-source", season, round, days.join(","), product],
    queryFn: async () => {
      const promises = days.map((d) =>
        api.prices({ season: season!, round: round!, day: d, product: product! })
      );
      const parts = await Promise.all(promises);
      const merged: SyntheticPrices = {
        timestamp: [], mid_price: [], bid_price_1: [], bid_volume_1: [],
        ask_price_1: [], ask_volume_1: [],
      };
      parts.forEach((p, idx) => {
        const offset = idx * 1_000_000;
        for (let i = 0; i < p.timestamp.length; i++) {
          merged.timestamp.push(p.timestamp[i] + offset);
          merged.mid_price.push(p.mid_price[i]);
          merged.bid_price_1.push(p.bid_price_1[i]);
          merged.bid_volume_1.push(p.bid_volume_1[i]);
          merged.ask_price_1.push(p.ask_price_1[i]);
          merged.ask_volume_1.push(p.ask_volume_1[i]);
        }
      });
      return merged;
    },
    enabled: ready,
  });

  // Synthetic series for the active manifest.
  const synthQ = useQuery({
    queryKey: ["synthetic-prices", active?.run_id],
    queryFn: () => api.syntheticPrices(active!.run_id),
    enabled: active != null,
  });

  const genMut = useMutation({
    mutationFn: (body: GenerateBody) => api.generateSynthetic(body),
    onSuccess: (m) => {
      setActive(m);
      qc.invalidateQueries({ queryKey: ["synthetic-list"] });
      qc.invalidateQueries({ queryKey: ["synthetic-prices", m.run_id] });
    },
  });

  // When the user picks one in the library, also sync the global Selectors so the
  // source side-by-side comes from the right (season, round, days, product).
  const onLibrarySelect = (m: SyntheticManifest) => {
    useSelection.getState().set({
      season: m.source.season,
      round: m.source.round,
      days: [...m.source.days].sort((a, b) => a - b),
      product: m.source.product,
    });
    setActive(m);
  };

  // Clear active when the user changes scope manually (so we don't show a misaligned overlay).
  useEffect(() => {
    if (!active) return;
    const sameScope =
      active.source.season === season &&
      active.source.round === round &&
      active.source.product === product &&
      JSON.stringify([...active.source.days].sort()) === JSON.stringify([...days].sort());
    if (!sameScope) setActive(null);
  }, [season, round, days, product, active]);

  const source = sourceQ.data ?? null;
  const synthetic = synthQ.data ?? null;

  // Synthetic data lacks day metadata; if we want to align it x-wise with the
  // source we just trust their indexes match.
  const synthAligned: SyntheticPrices | null = useMemo(() => {
    if (!synthetic) return null;
    if (!source) return synthetic;
    return {
      ...synthetic,
      timestamp: source.timestamp.slice(0, synthetic.timestamp.length),
    };
  }, [synthetic, source]);

  return (
    <>
    <div className="synthetic-toolbar">
      <span>Synthetic data</span>
      <button className="btn" onClick={() => { setQuoteNotice(""); setShowQuotes(true); }}>Bids, asks & export</button>
    </div>
    <dialog ref={dialog} className="quote-dialog" aria-labelledby="quote-dialog-title" onCancel={() => setShowQuotes(false)} onClose={() => setShowQuotes(false)}>
      <header><h2 id="quote-dialog-title">Bids, asks & export</h2><button className="btn" autoFocus onClick={() => setShowQuotes(false)}>Close</button></header>
      {quoteNotice && <p role="status">{quoteNotice}</p>}
      {active ? <QuoteScenario key={active.run_id} manifest={active} onCreated={m => {
        setActive(current => current?.run_id === m.quotes?.parent_run_id ? m : current);
        setQuoteNotice("Quote copy created and selected. You can export it below.");
        qc.invalidateQueries({ queryKey: ["synthetic-list"] });
      }} /> : <p>Select a dataset from the Synthetic Library or generate one first.</p>}
    </dialog>
    <Workspace name="Synthetic workspace">
      <PersistedGroup orientation="horizontal" id="pma-horizontal-synthetic">
        <Panel id="main-col" defaultSize={70} minSize={30}>
          <PersistedGroup orientation="vertical" id="pma-main-synthetic">
            <PanelShell
              id="generator"
              title="Generator"
              meta={active ? <span className="syn-badge">SYN · {active.run_id}</span> : null}
              defaultSize={32}
              minSize={10}
            >
              <GeneratorForm
                onGenerate={(b) => genMut.mutate(b)}
                busy={genMut.isPending}
              />
              {genMut.error ? (
                <p className="error">Generate failed: {(genMut.error as Error).message}</p>
              ) : null}
            </PanelShell>
            <Separator className="resize-h" />
            <PanelShell
              id="preview"
              title="Source vs Synthetic"
              meta={
                active
                  ? `${active.n_snapshots.toLocaleString()} rows`
                  : "preview"
              }
              defaultSize={48}
              minSize={15}
            >
              {(sourceQ.error || synthQ.error) && <p className="error" role="alert">Preview failed: {(sourceQ.error ?? synthQ.error)?.message}</p>}
              {!ready && <p className="empty">Pick a season, round, day, and product.</p>}
              {(sourceQ.isLoading || synthQ.isLoading) && <p className="empty">Loading preview…</p>}
              <PreviewChart source={source} synthetic={synthAligned ?? EMPTY} />
            </PanelShell>
            <Separator className="resize-h" />
            <PanelShell
              id="stats"
              title="Stats Comparison"
              defaultSize={20}
              minSize={8}
            >
              <StatsComparison manifest={active} />
            </PanelShell>
          </PersistedGroup>
        </Panel>
        <Separator className="resize-v" />
        <Panel id="rail" defaultSize={30} minSize={15}>
          <PanelShell id="library" title="Synthetic Library" defaultSize={100} minSize={20}>
            <SyntheticLibrary onSelect={onLibrarySelect} selectedRunId={active?.run_id ?? null} />
          </PanelShell>
        </Panel>
      </PersistedGroup>
    </Workspace>
    </>
  );
}
