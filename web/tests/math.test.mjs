import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Compile pure TypeScript helpers in memory; no additional test dependencies.
async function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const indicators = await load("../src/lib/indicators.ts");
const signalFixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/signal_tools.json", import.meta.url), "utf8"));
const { summarize } = await load("../src/lib/summary.ts");
const { createZoomGroup, lowerBound } = await load("../src/lib/chartSync.ts");
const market = mids => ({ timestamp: mids.map((_, i) => i), mid_price: mids,
  bid_price_1: mids.map(m => m == null ? null : m - 1),
  ask_price_1: mids.map(m => m == null ? null : m + 1),
  bid_volume_1: mids.map(() => 3), ask_volume_1: mids.map(() => 1) });
const trades = { timestamp: [], price: [], quantity: [], buyer: [], seller: [] };
for (const sample of signalFixture.cases) {
  test(`${sample.id} matches backend fixture including gaps and warmup`, () => {
    assert.deepEqual(indicators.deviationSeries(market(signalFixture.mids), sample.id, sample.params), sample.expected);
  });
}

test("rolling windows require complete history and recover after gaps", () => {
  const values = [100, 110, 120, null, 130, 140];
  assert.deepEqual(indicators.rollingMean(values, 2), [null, 105, 115, null, null, 135]);
  const std = indicators.rollingStd(values, 2);
  assert.deepEqual(std.map(v => v == null ? v : Number(v.toFixed(6))),
    [null, 7.071068, 7.071068, null, null, 7.071068]);
});
test("returns do not invent a move through a missing price", () => {
  assert.deepEqual(indicators.returns(market([100, 110, null, 120])), [null, .1, null, null]);
});
test("combined summary includes movement between days and excludes missing books", () => {
  const s = summarize(market([100, 100, null, 200, 200]), trades);
  assert.equal(s.mid_mean, 150);
  assert.ok(Math.abs(s.mid_std - Math.sqrt(10000 / 3)) < 1e-10);
  assert.equal(s.spread_mean, 2);
  assert.equal(s.n_snapshots, 5);
});
test("empty summary stays blank and changing product changes values", () => {
  assert.equal(summarize(market([]), trades).mid_mean, null);
  assert.equal(summarize(market([30, 50]), trades).mid_mean, 40);
  assert.equal(summarize(market([100, 200]), trades).mid_mean, 150);
});
test("empty liquidity has no imbalance or microprice", () => {
  const p = { ...market([100]), bid_volume_1: [0], ask_volume_1: [0] };
  assert.deepEqual(indicators.imbalance1(p), [null]);
  assert.deepEqual(indicators.microprice(p), [null]);
});

test("zoom travels both ways without loops and survives a new chart", () => {
  const group = createZoomGroup(), xs = [0, 100, 200, 300];
  let updates = 0;
  const makePlot = () => ({ scales: { x: { min: 0, max: 300 } }, setScale(key, range) {
    assert.ok(++updates < 20, "zoom should not loop");
    this.scales[key] = { ...range }; group.publish(this, key);
  } });
  const price = makePlot(), imbalance = makePlot();
  group.register(price, xs); group.register(imbalance, xs);
  price.setScale("x", { min: 100, max: 200 });
  assert.deepEqual(imbalance.scales.x, price.scales.x);
  imbalance.setScale("x", { min: 120, max: 180 });
  assert.deepEqual(price.scales.x, imbalance.scales.x);
  const newLayer = makePlot(); group.register(newLayer, xs);
  assert.deepEqual(newLayer.scales.x, { min: 120, max: 180 });
  group.reset();
  assert.deepEqual(price.scales.x, { min: 0, max: 300 });
  assert.deepEqual(imbalance.scales.x, price.scales.x);
});
test("new data resets zoom and detached charts stop receiving updates", () => {
  const group = createZoomGroup();
  const first = { scales: { x: { min: 0, max: 100 } }, setScale(_, range) { this.scales.x = range; } };
  group.register(first, [0, 100]);
  first.scales.x = { min: 20, max: 30 }; group.publish(first, "x"); group.remove(first);
  const next = { scales: { x: { min: 500, max: 900 } }, setScale(_, range) { this.scales.x = range; } };
  group.register(next, [500, 900]); group.reset();
  assert.deepEqual(next.scales.x, { min: 500, max: 900 });
  assert.deepEqual(first.scales.x, { min: 20, max: 30 });
});
test("visible-trade lookup handles duplicates, empty data and outside ranges", () => {
  assert.equal(lowerBound([], 20), 0);
  assert.equal(lowerBound([10, 20, 20, 30], 20), 1);
  assert.equal(lowerBound([10, 20, 30], 40), 3);
  assert.equal(lowerBound([10, 20, 30], 0), 0);
});
