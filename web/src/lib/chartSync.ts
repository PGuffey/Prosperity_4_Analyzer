/** Share the time range between Explorer charts without rerendering React on zoom. */
export function createZoomGroup() {
  type Plot = { scales: Record<string, { min?: number | null; max?: number | null }>; setScale: (key: string, range: { min: number; max: number }) => void };
  const plots = new Map<Plot, readonly number[]>();
  let grid: readonly number[] | null = null;
  let range: { min: number; max: number } | null = null;
  const apply = (plot: Plot) => {
    if (range && (plot.scales.x.min !== range.min || plot.scales.x.max !== range.max)) plot.setScale("x", range);
  };
  return {
    register(plot: Plot, xs: readonly number[]) {
      if (xs !== grid) { grid = xs; range = null; }
      plots.set(plot, xs);
      apply(plot);
    },
    remove(plot: Plot) { plots.delete(plot); },
    publish(plot: Plot, key: string) {
      if (key !== "x" || plots.get(plot) !== grid) return;
      const { min, max } = plot.scales.x;
      if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) return;
      if (range?.min === min && range?.max === max) return;
      range = { min, max };
      for (const [other, xs] of plots) if (other !== plot && xs === grid) apply(other);
    },
    reset() {
      if (!grid || grid.length < 2) return;
      range = { min: grid[0], max: grid[grid.length - 1] };
      for (const [plot, xs] of plots) if (xs === grid) apply(plot);
    },
  };
}

export const explorerZoom = createZoomGroup();

/** Find the first visible trade in logarithmic time rather than scanning the tape. */
export function lowerBound(xs: readonly number[], target: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
