import type { ComputedIndicators } from "../lib/useIndicators";
import SubChart from "./SubChart";
import { descriptions } from "../lib/descriptions";

type Props = {
  xs: readonly number[];
  indicators: ComputedIndicators;
};

const SUBCHART_COLOR: Record<keyof ComputedIndicators, string> = {
  fixed_deviation: "#38bdf8",
  sma_deviation: "#fbbf24",
  ema_deviation: "#fb923c",
  microprice_gap: "#2dd4bf",
  microprice: "",
  sma: "",
  vwap: "",
  spread: "#5ac8fa",
  imbalance: "#4dd0a3",
  returns: "#facc15",
  zscore: "#f97316",
  rolling_vol: "#c084fc",
};

const ZERO_LINE: Partial<Record<keyof ComputedIndicators, boolean>> = {
  fixed_deviation: true,
  sma_deviation: true,
  ema_deviation: true,
  microprice_gap: true,
  imbalance: true,
  returns: true,
  zscore: true,
};

const ORDER: (keyof ComputedIndicators)[] = [
  "fixed_deviation", "sma_deviation", "ema_deviation", "microprice_gap",
  "spread",
  "imbalance",
  "returns",
  "zscore",
  "rolling_vol",
];

const LABEL: Partial<Record<keyof ComputedIndicators, string>> = {
  fixed_deviation: "mid − reference (price units)",
  sma_deviation: "mid − SMA (price units)",
  ema_deviation: "mid − EMA (price units)",
  microprice_gap: "microprice − mid (price units)",
  spread: "spread",
  imbalance: "OB imbalance",
  returns: "returns",
  zscore: "mid z-score",
  rolling_vol: "rolling vol",
};

export default function SubCharts({ xs, indicators }: Props) {
  const visible = ORDER.filter((id) => indicators[id] != null);
  if (visible.length === 0) {
    return <p className="empty">Enable an indicator above to populate.</p>;
  }
  return (
    <div className="subcharts">
      {visible.map((id) => (
        <SubChart
          key={id}
          xs={xs}
          ys={indicators[id]!}
          label={LABEL[id] ?? id}
          description={descriptions[id]}
          color={SUBCHART_COLOR[id]}
          zeroLine={ZERO_LINE[id]}
        />
      ))}
    </div>
  );
}
