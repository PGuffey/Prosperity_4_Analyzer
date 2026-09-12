import { useState } from "react";
import type { HypothesisResult, BreakdownRow } from "../../api";
import DistributionChart from "./DistributionChart";
import { descriptions } from "../../lib/descriptions";

type Tab = "perDay" | "perProduct" | "ios" | "dist";

function StatsHeader({ label }: { label: string }) {
  return <tr>
    <th>{label}</th><th className="num" title={descriptions.count}>Events</th>
    <th className="num" title={descriptions.hit_rate}>Price rose</th>
    <th className="num" title={descriptions.mean}>Mean</th>
    <th className="num" title={descriptions.median}>Median</th>
    <th className="num" title={descriptions.percentiles}>P10 / P90</th>
  </tr>;
}

function pct(x: number, digits = 3): string {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(digits) + "%";
}

function statRow(r: BreakdownRow, head: string) {
  return (
    <tr key={head}>
      <td>{head}</td>
      <td className="num">{r.count.toLocaleString()}</td>
      <td className={"num " + (r.hit_rate >= 0.5 ? "pos" : "neg")}>{pct(r.hit_rate, 1)}</td>
      <td className={"num " + (r.mean >= 0 ? "pos" : "neg")}>{pct(r.mean)}</td>
      <td className="num">{pct(r.median)}</td>
      <td className="num dim">{pct(r.p10)} / {pct(r.p90)}</td>
    </tr>
  );
}

export default function ResultsBreakdown({ result }: { result: HypothesisResult | null }) {
  const [tab, setTab] = useState<Tab>("perDay");
  if (!result) return null;

  const hasPerProduct = result.per_product != null && result.per_product.length > 1;
  const hasIos = result.ios_split != null;
  const activeTab = (tab === "ios" && !hasIos) || (tab === "perProduct" && !hasPerProduct) ? "perDay" : tab;

  return (
    <div className="breakdown">
      <div className="tabs">
        <button
          className={"tab" + (activeTab === "perDay" ? " active" : "")}
          onClick={() => setTab("perDay")}
        >Per day</button>
        {hasPerProduct && (
          <button
            className={"tab" + (activeTab === "perProduct" ? " active" : "")}
            onClick={() => setTab("perProduct")}
          >Per product</button>
        )}
        {hasIos && (
          <button
            className={"tab" + (activeTab === "ios" ? " active" : "")}
            onClick={() => setTab("ios")}
            title={descriptions.split}
          >Earlier / last day</button>
        )}
        <button
          className={"tab" + (activeTab === "dist" ? " active" : "")}
          onClick={() => setTab("dist")}
          title={descriptions.distribution}
        >Distribution</button>
      </div>

      <div className="tab-body">
        {activeTab === "perDay" && (
          <table className="breakdown-table">
            <thead>
              <StatsHeader label="Day" />
            </thead>
            <tbody>
              {result.per_day.map((d) => statRow(d, `day ${d.day}`))}
            </tbody>
          </table>
        )}
        {activeTab === "perProduct" && hasPerProduct && (
          <table className="breakdown-table">
            <thead>
              <StatsHeader label="Product" />
            </thead>
            <tbody>
              {result.per_product!.map((p) => statRow(p, p.product))}
            </tbody>
          </table>
        )}
        {activeTab === "ios" && hasIos && (
          <table className="breakdown-table">
            <thead>
              <StatsHeader label="Split" />
            </thead>
            <tbody>
              {statRow(result.ios_split!.in_sample, `IS · days ${result.ios_split!.in_sample.days.join(",")}`)}
              {statRow(result.ios_split!.out_of_sample, `OOS · day ${result.ios_split!.out_of_sample.day}`)}
            </tbody>
          </table>
        )}
        {activeTab === "dist" && (
          <DistributionChart
            edges={result.distribution.edges}
            counts={result.distribution.counts}
          />
        )}
      </div>
    </div>
  );
}
