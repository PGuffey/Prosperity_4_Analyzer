import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SyntheticPrices } from "../../api";

type Props = {
  source: SyntheticPrices | null;
  synthetic: SyntheticPrices | null;
};

export default function PreviewChart({ source, synthetic }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) {
        setSize((p) => (p && p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
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
    if (!source && !synthetic) return;
    const el = wrapRef.current;

    // X axis = max of source/synthetic length, in 100-tick steps starting at 0.
    const srcLen = source?.timestamp.length ?? 0;
    const synLen = synthetic?.timestamp.length ?? 0;
    const n = Math.max(srcLen, synLen);
    if (n === 0) return;
    const xs = source?.timestamp.length === n
      ? source!.timestamp
      : synthetic?.timestamp.length === n
        ? synthetic!.timestamp
        : Array.from({ length: n }, (_, i) => i * 100);

    const srcMid = source ? padTo(source.mid_price, n) : Array(n).fill(null);
    const synMid = synthetic ? padTo(synthetic.mid_price, n) : Array(n).fill(null);

    const opts: uPlot.Options = {
      width: size.w,
      height: size.h,
      pxAlign: false,
      cursor: { drag: { x: true, y: false }, focus: { prox: 30 } },
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        {
          stroke: "#8b95a3",
          grid: { stroke: "#1f2630", width: 1 },
          ticks: { stroke: "#1f2630" },
        },
        {
          stroke: "#8b95a3",
          grid: { stroke: "#1f2630", width: 1 },
          ticks: { stroke: "#1f2630" },
          size: 72,
        },
      ],
      series: [
        { label: "t" },
        { label: "source", stroke: "#d8dde3", width: 1 },
        { label: "synthetic", stroke: "#c084fc", width: 1.5 },
      ],
    };

    plotRef.current = new uPlot(opts, [xs as number[], srcMid as number[], synMid as number[]], el);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [source, synthetic, size?.w, size?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source && !synthetic) {
    return <p className="empty">Generate a synthetic dataset to compare.</p>;
  }

  return <div ref={wrapRef} className="preview-chart" />;
}

function padTo<T>(arr: T[], n: number): (T | null)[] {
  if (arr.length >= n) return arr.slice(0, n);
  const out: (T | null)[] = new Array(n);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  for (let i = arr.length; i < n; i++) out[i] = null;
  return out;
}
