import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";

type Props = { edges: number[]; counts: number[] };

export default function DistributionChart({ edges, counts }: Props) {
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
    if (!wrapRef.current || !size || edges.length < 2) return;
    const el = wrapRef.current;

    // Use bin centers as x values for a bar-like step look.
    const centers: number[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      centers.push((edges[i] + edges[i + 1]) / 2);
    }

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
          values: (_u, vals) =>
            vals.map((v) => (v * 100).toFixed(2) + "%"),
        },
        {
          stroke: "#8b95a3",
          grid: { stroke: "#1f2630", width: 1 },
          ticks: { stroke: "#1f2630" },
          size: 50,
        },
      ],
      series: [
        { label: "ret" },
        {
          label: "count",
          stroke: "#5ac8fa",
          fill: "rgba(90, 200, 250, 0.35)",
          width: 1,
          paths: uPlot.paths.bars
            ? uPlot.paths.bars({ size: [0.95, 50] })
            : undefined,
          points: { show: false },
        },
      ],
      hooks: {
        draw: [
          (u) => {
            // Vertical line at 0 (positive vs negative returns).
            const x0 = u.valToPos(0, "x", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "#3a4654";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0, u.bbox.top);
            ctx.lineTo(x0, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };

    plotRef.current = new uPlot(opts, [centers, counts as number[]], el);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [edges, counts, size?.w, size?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (edges.length < 2) return <p className="empty">No data to plot.</p>;
  return <div ref={wrapRef} className="dist-chart" />;
}
