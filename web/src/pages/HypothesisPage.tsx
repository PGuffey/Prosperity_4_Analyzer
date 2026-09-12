import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel, Separator } from "react-resizable-panels";
import { api, type HypothesisRequest, type HypothesisResult, type SavedHypothesis } from "../api";
import { useSelection } from "../store";
import HypothesisEditor from "../components/hypothesis/HypothesisEditor";
import ResultsOverall from "../components/hypothesis/ResultsOverall";
import ResultsBreakdown from "../components/hypothesis/ResultsBreakdown";
import SavedLibrary from "../components/hypothesis/SavedLibrary";
import HistoryLog from "../components/hypothesis/HistoryLog";
import PanelShell from "../components/PanelShell";
import PersistedGroup from "../components/PersistedGroup";
import Workspace from "../components/Workspace";

export default function HypothesisPage() {
  const qc = useQueryClient();
  const [result, setResult] = useState<HypothesisResult | null>(null);
  const [lastRun, setLastRun] = useState<HypothesisRequest | null>(null);
  const [editorInitial, setEditorInitial] = useState<Partial<HypothesisRequest> | null>(null);

  const testMut = useMutation({
    onMutate: (req) => { setResult(null); setLastRun(req); },
    mutationFn: (req: HypothesisRequest) => api.testHypothesis(req),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["hypothesis-log"] });
    },
  });

  const saveMut = useMutation({
    mutationFn: ({ name, req }: { name: string; req: HypothesisRequest }) =>
      api.saveHypothesis(name, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-hypotheses"] }),
  });

  const onLoad = (h: SavedHypothesis) => {
    // Sync the global Selectors to the saved hypothesis's scope so the editor's
    // product universe (and the visible "current product / all products" picker)
    // matches what was saved.
    useSelection.getState().set({
      season: h.hypothesis.season,
      round: h.hypothesis.round,
      days: [...h.hypothesis.days].sort((a, b) => a - b),
      product: h.hypothesis.products[0] ?? null,
    });
    setEditorInitial(h.hypothesis);
  };

  return (
    <>
    <header className="signal-intro">
      <h2>Signal Tests</h2>
      <p>When a condition appears, what tends to happen next?</p>
    </header>
    <Workspace name="Signal Tests workspace" className="signal-workspace" minHeight={840}>
      <PersistedGroup orientation="horizontal" id="pma-signal-tests-v2">
            <PanelShell id="signal-editor" title="Test setup" defaultSize={33} minSize={24}>
              <HypothesisEditor
                initial={editorInitial}
                onRun={(req) => testMut.mutate(req)}
                onSave={(name, req) => saveMut.mutate({ name, req })}
                busy={testMut.isPending}
              />
              {testMut.error && <p className="error" role="alert">Run failed: {testMut.error.message}</p>}
              {saveMut.error && <p className="error" role="alert">Save failed: {saveMut.error.message}</p>}
              {saveMut.isSuccess && <p role="status">Saved to the library.</p>}
              <details className="test-notes"><summary>How to read this test</summary><p>History continues across selected days. Look ahead counts snapshots. Results measure mid-price movement, without simulating trades or final fair-value settlement.</p></details>
            </PanelShell>
            <Separator className="resize-v" />
        <Panel id="signal-results" defaultSize={45} minSize={30}>
          <PersistedGroup orientation="vertical" id="pma-signal-results-v2">
            <PanelShell
              id="signal-overall"
              title="Output"
              meta={result ? `${result.overall.count.toLocaleString()} events` : null}
              defaultSize={40}
              minSize={25}
            >
              {lastRun && <p className="run-context">Last run: {lastRun.synthetic_id ? `synthetic ${lastRun.synthetic_id}` : `${lastRun.season} · R${lastRun.round} · days ${lastRun.days.join(", ")} · ${lastRun.products.length === 1 ? lastRun.products[0] : `${lastRun.products.length} products`}`}<br />{lastRun.indicator} {lastRun.op} {lastRun.threshold} → {lastRun.horizon} snapshots{Object.entries(lastRun.indicator_params ?? {}).map(([key, value]) => ` · ${key}: ${value}`).join("")}</p>}
              <ResultsOverall result={result} />
            </PanelShell>
            <Separator className="resize-h" />
            <PanelShell
              id="signal-breakdown"
              title="Compare outcomes"
              defaultSize={60}
              minSize={15}
            >
              <ResultsBreakdown result={result} />
            </PanelShell>
          </PersistedGroup>
        </Panel>
        <Separator className="resize-v" />
        <Panel id="signal-rail" defaultSize={22} minSize={16}>
          <PersistedGroup orientation="vertical" id="pma-signal-rail-v2">
            <PanelShell id="signal-library" title="Saved tests" defaultSize={40} minSize={10}>
              <SavedLibrary onLoad={onLoad} />
            </PanelShell>
            <Separator className="resize-h" />
            <PanelShell id="signal-log" title="Recent runs" defaultSize={60} minSize={15}>
              <HistoryLog />
            </PanelShell>
          </PersistedGroup>
        </Panel>
      </PersistedGroup>
    </Workspace>
    </>
  );
}
