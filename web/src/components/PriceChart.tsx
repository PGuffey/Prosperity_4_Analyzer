import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PricesRange, TradesRange } from "../api";
import { useSelection } from "../store";
import type { ComputedIndicators } from "../lib/useIndicators";
import { explorerZoom, lowerBound } from "../lib/chartSync";

type Props = {
  prices: PricesRange;
  trades: TradesRange;
  indicators: ComputedIndicators;
};

const COLORS = {
  mid: "#d8dde3",
  bid: "#4dd0a3",
  ask: "#ff7676",
  trade: "rgba(90, 200, 250, 0.85)",
  microprice: "#c084fc",
  sma: "#facc15",
  vwap: "#f97316",
  grid: "#1f2630",
  axis: "#8b95a3",
};

export default function PriceChart({ prices, trades, indicators }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const tradesRef = useRef<TradesRange>(trades);
  tradesRef.current = trades;
  const setCursorT = useSelection((s) => s.set);
  const layers = useSelection(s => s.chartLayers);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) {
        setSize((prev) =>
          prev && prev.w === r.width && prev.h === r.height
            ? prev
            : { w: r.width, h: r.height }
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (size && plotRef.current) {
      plotRef.current.setSize({ width: size.w, height: size.h });
    }
  }, [size]);

  useEffect(() => {
    if (!wrapRef.current || !size) return;
    const el = wrapRef.current;

    // Build series list dynamically based on which overlays are active.
    const series: uPlot.Series[] = [
      { label: "t" },
      { label: "mid", stroke: COLORS.mid, width: 1.5, points: { show: false } },
    ];
    const data: uPlot.AlignedData = [
      prices.timestamp,
      prices.mid_price as number[],
    ];
    if (layers.bid) {
      series.push({ label: "best bid", stroke: COLORS.bid, width: 1, points: { show: false } });
      data.push(prices.bid_price_1 as number[]);
    }
    if (layers.ask) {
      series.push({ label: "best ask", stroke: COLORS.ask, width: 1, points: { show: false } });
      data.push(prices.ask_price_1 as number[]);
    }

    if (indicators.microprice) {
      series.push({ label: "microprice", stroke: COLORS.microprice, width: 1, dash: [4, 4] });
      data.push(indicators.microprice as number[]);
    }
    if (indicators.sma) {
      series.push({ label: "sma", stroke: COLORS.sma, width: 1.2 });
      data.push(indicators.sma as number[]);
    }
    if (indicators.vwap) {
      series.push({ label: "vwap", stroke: COLORS.vwap, width: 1 });
      data.push(indicators.vwap as number[]);
    }

    for (const line of series.slice(1)) line.points = { show: false };
    const opts: uPlot.Options = {
      width: size.w,
      height: size.h,
      pxAlign: false,
      cursor: { drag: { x: true, y: false }, focus: { prox: 30 }, sync: { key: "pma-explorer", scales: ["x", null] } },
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        {
          stroke: COLORS.axis,
          grid: { stroke: COLORS.grid, width: 1 },
          ticks: { stroke: COLORS.grid },
        },
        {
          stroke: COLORS.axis,
          grid: { stroke: COLORS.grid, width: 1 },
          ticks: { stroke: COLORS.grid },
          size: 72,
        },
      ],
      series,
      hooks: {
        ready: [u => explorerZoom.register(u, prices.timestamp)],
        setScale: [explorerZoom.publish],
        destroy: [explorerZoom.remove],
        draw: [
          (u) => {
            const t = tradesRef.current;
            if (!layers.trades || !t || !t.timestamp.length) return;
            const ctx = u.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
            ctx.clip();
            ctx.fillStyle = COLORS.trade;
            const end = lowerBound(t.timestamp, (u.scales.x.max ?? Infinity) + 1);
            for (let i = lowerBound(t.timestamp, u.scales.x.min ?? -Infinity); i < end; i++) {
              const x = u.valToPos(t.timestamp[i], "x", true);
              const y = u.valToPos(t.price[i], "y", true);
              const r = Math.min(2 + Math.sqrt(t.quantity[i]), 6);
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null) {
              setCursorT({ cursorT: null });
              return;
            }
            const xs = u.data[0];
            const t = xs[idx];
            setCursorT({ cursorT: typeof t === "number" ? t : null });
          },
        ],
      },
    };

    plotRef.current = new uPlot(opts, data, el);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, !!size, indicators.microprice, indicators.sma, indicators.vwap, layers]);

  useEffect(() => {
    plotRef.current?.redraw(false, false);
  }, [trades]);

  return <div ref={wrapRef} className="chart" />;
}
