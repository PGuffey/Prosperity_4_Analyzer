import { INDICATORS, type IndicatorId } from "../lib/indicators";
import { useSelection } from "../store";
import { explorerZoom } from "../lib/chartSync";
import { descriptions } from "../lib/descriptions";

const ORDER: IndicatorId[] = [
  "microprice",
  "sma",
  "vwap",
  "spread",
  "imbalance",
  "returns",
  "zscore",
  "rolling_vol",
  "fixed_deviation", "sma_deviation", "ema_deviation", "microprice_gap",
];

export default function IndicatorPicker() {
  const enabled = useSelection((s) => s.enabledIndicators);
  const params = useSelection((s) => s.indicatorParams);
  const toggle = useSelection((s) => s.toggleIndicator);
  const setParam = useSelection((s) => s.setIndicatorParam);
  const layers = useSelection(s => s.chartLayers);
  const toggleLayer = useSelection(s => s.toggleChartLayer);

  return (
    <fieldset className="indicator-picker">
      <legend className="sr-only">Chart layers & indicators</legend>
      <div className="chart-controls">
        <span className="dim" title="The central price series. Starts alone for a clearer, lighter chart.">Mid price</span>
        {(["bid", "ask", "trades"] as const).map(key => (
          <label key={key} title={key === "trades" ? "Show executed trades as dots. Turning this off reduces drawing work." : `Show the best ${key}: the highest buying quote or lowest selling quote.`}>
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
            {key === "trades" ? "Trade dots" : `Best ${key}`}
          </label>
        ))}
        <button className="btn" onClick={() => explorerZoom.reset()} title="Show the full selected time range in the price chart and all indicators.">Reset zoom</button>
        <span className="dim">Drag any chart to zoom them together.</span>
      </div>
      <details className="indicator-disclosure">
      <summary>Indicators <span className="dim">{enabled.length} enabled</span></summary>
      <div className="indicator-list">
        {ORDER.map((id) => {
          const spec = INDICATORS[id];
          const on = enabled.includes(id);
          const winDefault = spec.params?.window;
          const winValue = params[id]?.window ?? winDefault;
          return (
            <label key={id} title={descriptions[id]} className={"indicator-item" + (on ? " active" : "")}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(id)}
              />
              <span className="indicator-label">{spec.label}</span>
              {spec.params?.reference != null && (
                <input type="number" className="indicator-window" aria-label="Reference price"
                  min={0.01} step="any" value={params[id]?.reference ?? spec.params.reference}
                  onChange={e => setParam(id, "reference", Number(e.target.value))}
                  title={descriptions.reference} />
              )}
              {winDefault != null && (
                <input
                  type="number"
                  className="indicator-window"
                  min={2}
                  step={10}
                  value={winValue ?? ""}
                  onChange={(e) =>
                    setParam(id, "window", Math.max(2, Number(e.target.value) || 0))
                  }
                  title={descriptions.window}
                  aria-label={`${spec.label} window`}
                />
              )}
            </label>
          );
        })}
      </div>
      </details>
    </fieldset>
  );
}
