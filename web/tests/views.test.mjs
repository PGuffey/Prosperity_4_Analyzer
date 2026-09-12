import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Render existing views with React; TypeScript compiles in memory for these tests.
const require = createRequire(import.meta.url);
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ResultsOverall = require("../src/components/hypothesis/ResultsOverall.tsx").default;
const EventWindow = require("../src/components/EventWindow.tsx").default;
const { useSelection } = require("../src/store.ts");
const TradeTape = require("../src/components/TradeTape.tsx").default;
const IndicatorPicker = require("../src/components/IndicatorPicker.tsx").default;
const HypothesisEditor = require("../src/components/hypothesis/HypothesisEditor.tsx").default;
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const QuoteScenario = require("../src/components/synthetic/QuoteScenario.tsx").default;
const Workspace = require("../src/components/Workspace.tsx").default;

test("workspace provides a keyboard-accessible scrolling canvas without replacing panel children", () => {
  const html = renderToStaticMarkup(React.createElement(Workspace,
    { name: "Explorer workspace", minHeight: 1080 }, React.createElement("div", { id: "saved-panel-group" })));
  assert.match(html, /role="region" aria-label="Explorer workspace" tabindex="0"/);
  assert.match(html, /class="workspace-canvas" style="--workspace-height:1080px"/);
  assert.match(html, /id="saved-panel-group"/);
});

test("quote setup edits displayed bids and asks, not executions", () => {
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() },
    React.createElement(QuoteScenario, { manifest: { run_id: "testdata", name: "Test", n_snapshots: 10 }, onCreated() {} })));
  assert.match(html, /Create copy with quotes/);
  assert.match(html, /Export selected dataset/);
  assert.match(html, /Exact bids and asks from CSV/);
  assert.match(html, /not executions/);
  assert.doesNotMatch(html, /Trade probability|Buy probability/);
  assert.match(html, /one artificial day/);
});

test("presets stay compact and reference signals explain their chosen price", () => {
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() },
    React.createElement(HypothesisEditor, {
      initial: { indicator: "fixed_deviation", indicator_params: { reference: 12345 } },
      onRun() {}, onSave() {},
    })));
  assert.match(html, /aria-label="Presets"/);
  assert.match(html, /<option value="" selected="">None — choose a preset/);
  assert.match(html, /Below the weighted average/);
  assert.match(html, /Reference price/);
  assert.match(html, /value="12345"/);
  assert.match(html, /10000 is only an example/);
  assert.doesNotMatch(html, /What does this signal mean|Presets fill the fields/);
  assert.doesNotMatch(html, /preset-pill|Start with an example/);
});

test("no events shows an explanation instead of misleading zero-percent statistics", () => {
  const html = renderToStaticMarkup(React.createElement(ResultsOverall, {
    result: { overall: { count: 0, warnings: ["No future price available"] } },
  }));
  assert.match(html, /No future price available/);
  assert.doesNotMatch(html, /0\.000%/);
});
test("event window uses the chart window and interpolated percentiles", () => {
  const initial = useSelection.getInitialState();
  const original = { event: initial.event, indicatorParams: initial.indicatorParams };
  initial.event = { indicator: "zscore", op: ">", threshold: 0, horizon: 1 };
  initial.indicatorParams = { zscore: { window: 2 } };
  try {
    const mids = [100, 110, 121, 145.2];
    const prices = { timestamp: [0, 100, 200, 300], mid_price: mids,
      bid_price_1: mids.map(m => m - 1), ask_price_1: mids.map(m => m + 1),
      bid_volume_1: [3, 3, 3, 3], ask_volume_1: [1, 1, 1, 1] };
    const html = renderToStaticMarkup(React.createElement(EventWindow, { prices }));
    assert.match(html, /2 of 2/);
    assert.match(html, /15\.000%/);
    assert.match(html, /11\.000% \/ 19\.000%/);
  } finally {
    Object.assign(initial, original);
  }
});
test("scope changes normalize days and clear the old order-book cursor", () => {
  useSelection.getState().set({ cursorT: 500 });
  useSelection.getState().set({ days: [2, 0, 2, 1] });
  assert.deepEqual(useSelection.getState().days, [0, 1, 2]);
  assert.equal(useSelection.getState().cursorT, null);
});

for (const multiDay of [false, true]) for (const ids of [false, true]) {
  test(`tape columns agree: multiday=${multiDay}, ids=${ids}`, () => {
    const initial = useSelection.getInitialState(), oldDays = initial.days;
    initial.days = multiDay ? [-1, 0] : [0];
    try {
      const html = renderToStaticMarkup(React.createElement(TradeTape, { trades: {
        timestamp: [100], price: [123], quantity: [7], buyer: [ids ? "Buyer" : null], seller: [null],
      } }));
      const header = html.match(/class="tape-head([^"]*)"/)[1];
      const row = html.match(/class="tape-row([^"]*)"/)[1];
      assert.equal(row, header);
      assert.equal(row.includes("multiday"), multiDay);
      assert.equal(row.includes("with-ids"), ids);
    } finally { initial.days = oldDays; }
  });
}
test("chart defaults are light and controls have explanations", () => {
  assert.deepEqual(useSelection.getInitialState().chartLayers, { bid: false, ask: false, trades: false });
  const html = renderToStaticMarkup(React.createElement(IndicatorPicker));
  assert.match(html, /Trade dots/); assert.match(html, /Reset zoom/);
  assert.match(html, /top-level volume/); assert.match(html, /title=/);
  assert.match(html, /<details class="indicator-disclosure">/);
  assert.match(html, /enabled/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /aria-label="Mid SMA window"/);
});
