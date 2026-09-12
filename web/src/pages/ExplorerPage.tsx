import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQueries } from "@tanstack/react-query";
import { Panel, Separator } from "react-resizable-panels";
import { api, type PricesRange, type TradesRange } from "../api";
import { summarize } from "../lib/summary";
import { DAY_TS_SPAN, fromSyntheticT, useSelection } from "../store";
import IndicatorPicker from "../components/IndicatorPicker";
import PriceChart from "../components/PriceChart";
import OrderBookPanel from "../components/OrderBookPanel";
import SummaryPanel from "../components/SummaryPanel";
import TradeTape from "../components/TradeTape";
import SubCharts from "../components/SubCharts";
import EventWindow, { useEventCount } from "../components/EventWindow";
import PanelShell from "../components/PanelShell";
import PersistedGroup from "../components/PersistedGroup";
import Workspace from "../components/Workspace";
import { useComputedIndicators } from "../lib/useIndicators";

const EMPTY_PRICES: PricesRange = {
  timestamp: [], mid_price: [], bid_price_1: [], bid_volume_1: [], ask_price_1: [], ask_volume_1: [],
};
const EMPTY_TRADES: TradesRange = {
  timestamp: [], price: [], quantity: [], buyer: [], seller: [],
};

function ChartPanelBody({ prices, trades, indicators, anyError, ready, merged }: {
  prices: PricesRange;
  trades: TradesRange;
  indicators: ReturnType<typeof useComputedIndicators>;
  anyError: boolean;
  ready: boolean;
  merged: unknown;
}) {
  return (
    <div className="chart-wrap">
      {!ready && <p className="empty">Pick a season, round, day, and product.</p>}
      {ready && !merged && !anyError && <p className="empty">Loading…</p>}
      {anyError && <p className="error">Failed to load data.</p>}
      {merged != null && <PriceChart prices={prices} trades={trades} indicators={indicators} />}
    </div>
  );
}

function OrderBookMeta() {
  const { days, cursorT } = useSelection();
  if (cursorT == null || days.length === 0) return null;
  const { dayIndex, rawT } = fromSyntheticT(cursorT);
  const day = days[dayIndex];
  return <>day {day ?? "?"} • t {rawT}</>;
}

function EventMeta({ prices }: { prices: PricesRange }) {
  const count = useEventCount(prices);
  return <>{count.toLocaleString()} matches</>;
}

export default function ExplorerPage() {
  const { season, round, days, product } = useSelection(useShallow(s => ({
    season: s.season, round: s.round, days: s.days, product: s.product,
  })));
  const ready = season != null && round != null && days.length > 0 && product != null;

  const priceQs = useQueries({
    combine: results => results.map(q => ({ data: q.data, error: q.error })),
    queries: ready
      ? days.map((d) => ({
          queryKey: ["prices", season, round, d, product],
          queryFn: () => api.prices({ season: season!, round: round!, day: d, product: product! }),
        }))
      : [],
  });
  const tradeQs = useQueries({
    combine: results => results.map(q => ({ data: q.data, error: q.error })),
    queries: ready
      ? days.map((d) => ({
          queryKey: ["trades", season, round, d, product],
          queryFn: () => api.trades({ season: season!, round: round!, day: d, product: product! }),
        }))
      : [],
  });

  const allPricesReady = priceQs.length > 0 && priceQs.every((q) => q.data);
  const allTradesReady = tradeQs.length > 0 && tradeQs.every((q) => q.data);
  const anyError = priceQs.some((q) => q.error) || tradeQs.some((q) => q.error);

  const merged = useMemo(() => {
    if (!allPricesReady || !allTradesReady) return null;
    const prices: PricesRange = {
      timestamp: [], mid_price: [], bid_price_1: [], bid_volume_1: [],
      ask_price_1: [], ask_volume_1: [],
    };
    const trades: TradesRange = {
      timestamp: [], price: [], quantity: [], buyer: [], seller: [],
    };
    priceQs.forEach((q, idx) => {
      const p = q.data!;
      const offset = idx * DAY_TS_SPAN;
      for (let i = 0; i < p.timestamp.length; i++) {
        prices.timestamp.push(p.timestamp[i] + offset);
        prices.mid_price.push(p.mid_price[i]);
        prices.bid_price_1.push(p.bid_price_1[i]);
        prices.bid_volume_1.push(p.bid_volume_1[i]);
        prices.ask_price_1.push(p.ask_price_1[i]);
        prices.ask_volume_1.push(p.ask_volume_1[i]);
      }
    });
    tradeQs.forEach((q, idx) => {
      const t = q.data!;
      const offset = idx * DAY_TS_SPAN;
      for (let i = 0; i < t.timestamp.length; i++) {
        trades.timestamp.push(t.timestamp[i] + offset);
        trades.price.push(t.price[i]);
        trades.quantity.push(t.quantity[i]);
        trades.buyer.push(t.buyer[i]);
        trades.seller.push(t.seller[i]);
      }
    });
    return { prices, trades };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPricesReady, allTradesReady, priceQs, tradeQs]);

  const combinedSummary = useMemo(
    () => merged ? summarize(merged.prices, merged.trades) : undefined, [merged],
  );

  const prices = merged?.prices ?? EMPTY_PRICES;
  const tradesData = merged?.trades ?? EMPTY_TRADES;
  const indicators = useComputedIndicators(prices, tradesData);

  return (
    <>
      <IndicatorPicker />
      <Workspace name="Explorer workspace" className="explorer-workspace" minHeight={1080}>
        <PersistedGroup orientation="vertical" id="pma-vertical-explorer">
          <Panel id="charts-row" defaultSize={78} minSize={20}>
            <PersistedGroup orientation="horizontal" id="pma-charts-row-explorer">
              <Panel id="charts-col" defaultSize={72} minSize={20}>
                <PersistedGroup orientation="vertical" id="pma-charts-col-explorer">
                  <PanelShell
                    id="chart"
                    title="Price chart"
                    meta={ready ? `${prices.timestamp.length.toLocaleString()} snapshots` : null}
                    defaultSize={72}
                    minSize={10}
                  >
                    <ChartPanelBody
                      prices={prices}
                      trades={tradesData}
                      indicators={indicators}
                      anyError={anyError}
                      ready={ready}
                      merged={merged}
                    />
                  </PanelShell>
                  <Separator className="resize-h" />
                  <PanelShell
                    id="subcharts"
                    title="Indicators"
                    defaultSize={28}
                    minSize={6}
                  >
                    <SubCharts xs={prices.timestamp} indicators={indicators} />
                  </PanelShell>
                </PersistedGroup>
              </Panel>
              <Separator className="resize-v" />
              <Panel id="side-col" defaultSize={28} minSize={12}>
                <PersistedGroup orientation="vertical" id="pma-side-col-explorer">
                  <PanelShell
                    id="summary"
                    title="Summary"
                    meta={`${days.length} day${days.length === 1 ? "" : "s"}`}
                    defaultSize={28}
                    minSize={6}
                  >
                    <SummaryPanel summary={combinedSummary} />
                  </PanelShell>
                  <Separator className="resize-h" />
                  <PanelShell
                    id="orderbook"
                    title="Order book"
                    meta={<OrderBookMeta />}
                    defaultSize={28}
                    minSize={6}
                  >
                    <OrderBookPanel />
                  </PanelShell>
                  <Separator className="resize-h" />
                  <PanelShell
                    id="eventwindow"
                    title="Event window"
                    meta={merged ? <EventMeta prices={prices} /> : null}
                    defaultSize={44}
                    minSize={8}
                  >
                    <EventWindow prices={prices} />
                  </PanelShell>
                </PersistedGroup>
              </Panel>
            </PersistedGroup>
          </Panel>
          <Separator className="resize-h" />
          <PanelShell
            id="tape"
            title="Trade tape"
            meta={merged ? `${tradesData.timestamp.length.toLocaleString()} total` : null}
            defaultSize={22}
            minSize={4}
          >
            {merged ? <TradeTape trades={tradesData} /> : <p className="empty">…</p>}
          </PanelShell>
        </PersistedGroup>
      </Workspace>
    </>
  );
}
