import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useSelection } from "../store";
import { explorerZoom } from "../lib/chartSync";

type Props = {
  /** X-axis values (same grid as the main chart). */
  xs: readonly number[];
  /** Y-axis values aligned to xs. Nulls become gaps. */
  ys: readonly (number | null)[];
  label: string;
  description?: string;
  color: string;
  /** Draw a horizontal zero line (useful for returns / z-score / imbalance). */
  zeroLine?: boolean;
  /** Number of decimal places to show for the cursor value. */
  digits?: number;
  comparison?: { ys: readonly (number | null)[]; label: string; color: string };
  zoomGroup?: typeof explorerZoom;
  syncKey?: string;
  showXAxis?: boolean;
};

const COLORS = {
  grid: "#1f2630",
  axis: "#8b95a3",
  zero: "#3a4654",
};

/** Binary-search the nearest index of `target` in a sorted readonly array. */
function nearestIndex(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  // Decide whether to bias to lo-1 if it's closer.
  if (lo > 0 && Math.abs(xs[lo - 1] - target) < Math.abs(xs[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

function fmtValue(v: number | null | undefined, digits: number): string {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) < 0.01 && v !== 0) {
    // Use scientific for very small numbers so they remain readable.
    return v.toExponential(2);
  }
  return v.toFixed(digits);
}

export default function SubChart({ xs, ys, label, description, color, zeroLine, digits = 4,
  comparison, zoomGroup = explorerZoom, syncKey = "pma-explorer", showXAxis = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const setCursorT = useSelection((s) => s.set);
  const cursorT = useSelection((s) => s.cursorT);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Live value at cursor, for the header readout.
  const cursorValue = useMemo<number | null>(() => {
    if (cursorT == null || xs.length === 0) return null;
    const i = nearestIndex(xs, cursorT);
    const v = ys[i];
    return typeof v === "number" ? v : null;
  }, [cursorT, xs, ys]);

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

    const data: uPlot.AlignedData = [
      xs as number[],
      ys as number[],
    ];
    if (comparison) data.push(comparison.ys as number[]);

    const opts: uPlot.Options = {
      width: size.w,
      height: size.h,
      pxAlign: false,
      cursor: { drag: { x: true, y: false }, focus: { prox: 30 }, sync: { key: syncKey, scales: ["x", null] } },
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        { show: showXAxis, stroke: COLORS.axis, grid: { stroke: COLORS.grid } },
        {
          stroke: COLORS.axis,
          grid: { stroke: COLORS.grid, width: 1 },
          ticks: { stroke: COLORS.grid },
          size: 72,
        },
      ],
      series: [
        { label: "t" },
        { label, stroke: color, width: 1, points: { show: false } },
      ],
      hooks: zeroLine
        ? {
            draw: [
              (u) => {
                const y0 = u.valToPos(0, "y", true);
                const ctx = u.ctx;
                ctx.save();
                ctx.strokeStyle = COLORS.zero;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(u.bbox.left, y0);
                ctx.lineTo(u.bbox.left + u.bbox.width, y0);
                ctx.stroke();
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
                const x = (u.data[0] as readonly number[])[idx];
                setCursorT({ cursorT: typeof x === "number" ? x : null });
              },
            ],
          }
        : {
            setCursor: [
              (u) => {
                const idx = u.cursor.idx;
                if (idx == null) {
                  setCursorT({ cursorT: null });
                  return;
                }
                const x = (u.data[0] as readonly number[])[idx];
                setCursorT({ cursorT: typeof x === "number" ? x : null });
              },
            ],
          },
    };

    opts.hooks = { ...opts.hooks,
      ready: [u => zoomGroup.register(u, xs)],
      setScale: [zoomGroup.publish], destroy: [zoomGroup.remove],
    };
    if (comparison) opts.series.push({ label: comparison.label, stroke: comparison.color, width: 1, points: { show: false } });
    plotRef.current = new uPlot(opts, data, el);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [xs, ys, label, color, zeroLine, comparison, zoomGroup, syncKey, showXAxis, !!size]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="subchart">
      <header className="subchart-header">
        <span className="subchart-name help" title={description} tabIndex={0} style={{ color }}>
          {label}
        </span>
        <span className="subchart-value">{fmtValue(cursorValue, digits)}</span>
      </header>
      <div ref={wrapRef} className="subchart-canvas" />
    </div>
  );
}
