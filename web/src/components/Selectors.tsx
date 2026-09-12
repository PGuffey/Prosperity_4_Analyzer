import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useSelection } from "../store";

export default function Selectors() {
  const { season, round, days, product, set } = useSelection(useShallow(s => ({
    season: s.season, round: s.round, days: s.days, product: s.product, set: s.set,
  })));
  const ds = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });

  const seasons = ds.data?.seasons ?? [];
  const seasonCov = seasons.find((s) => s.season === season);
  const rounds = seasonCov?.rounds ?? [];
  const roundCov = rounds.find((r) => r.round === round);
  const availableDays = roundCov?.days ?? [];
  const products = roundCov?.products ?? [];

  // Pick sensible defaults once data loads.
  useEffect(() => {
    if (!ds.data) return;
    if (!season && seasons[0]) {
      const s = seasons[0];
      const r = s.rounds[0];
      set({
        season: s.season,
        round: r?.round ?? null,
        days: r?.days[0] != null ? [r.days[0]] : [],
        product: r?.products[0] ?? null,
      });
    }
  }, [ds.data, season, seasons, set]);

  // Narrow downstream selections to valid values when round changes.
  useEffect(() => {
    if (seasonCov && !rounds.some(r => r.round === round)) {
      set({ round: rounds[0]?.round ?? null, days: [], product: null });
      return;
    }
    if (!roundCov) return;
    const validDays = days.filter((d) => availableDays.includes(d));
    if (validDays.length === 0 && availableDays[0] != null) {
      set({ days: [availableDays[0]] });
    } else if (validDays.length !== days.length) {
      set({ days: validDays });
    }
    if (product == null || !products.includes(product)) {
      set({ product: products[0] ?? null });
    }
  }, [seasonCov, rounds, round, roundCov, days, availableDays, product, products, set]);

  const productOptions = useMemo(
    () => products.map((p) => <option key={p} value={p}>{p}</option>),
    [products]
  );

  const toggleDay = (d: number) => {
    // Read from the store directly so back-to-back clicks don't see stale state.
    const current = useSelection.getState().days;
    const has = current.includes(d);
    let next = has ? current.filter((x) => x !== d) : [...current, d];
    next.sort((a, b) => a - b);
    if (next.length === 0) next = [d]; // keep at least one
    set({ days: next });
  };

  return (
    <div className="selectors">
      {ds.error && <p className="error" role="alert">Could not load datasets: {ds.error.message}</p>}
      {!ds.isLoading && !ds.error && seasons.length === 0 && <p className="empty">No datasets yet. Run pma ingest --all, then reload.</p>}
      <label>
        Season
        <select
          value={season ?? ""}
          onChange={(e) =>
            set({ season: e.target.value, round: null, days: [], product: null })
          }
        >
          {seasons.map((s) => (
            <option key={s.season} value={s.season}>{s.season}</option>
          ))}
        </select>
      </label>

      <label>
        Round
        <select
          value={round ?? ""}
          onChange={(e) =>
            set({ round: Number(e.target.value), days: [], product: null })
          }
        >
          {rounds.map((r) => (
            <option key={r.round} value={r.round}>Round {r.round}</option>
          ))}
        </select>
      </label>

      <fieldset className="days">
        <legend>Days</legend>
        <div className="day-toggles">
          {availableDays.map((d) => (
            <button
              key={d}
              type="button"
              className={"day-btn" + (days.includes(d) ? " active" : "")}
              onClick={() => toggleDay(d)}
              aria-pressed={days.includes(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>
      {days.some((d, i) => i > 0 && d !== days[i - 1] + 1) && (
        <p className="dim">Days skipped: horizons count selected snapshots only.</p>
      )}

      <label className="product-selector">
        Product
        <select
          value={product ?? ""}
          title={product ?? "Product"}
          onChange={(e) => set({ product: e.target.value })}
        >
          {productOptions}
        </select>
      </label>
    </div>
  );
}
