"""Synthetic-data generators.

Each generator takes a Polars source DataFrame (columns: product, day,
timestamp, mid_price, bid_price_1, bid_volume_1, ask_price_1, ask_volume_1),
a params dict, and a seed, and returns a synthetic DataFrame with the same
schema.

Design choices:
- Generators operate per (product, day) partition where it matters; multi-day
  sources are handled inside each generator (the only one that uses cross-day
  context is `day_shuffle_spline`).
- Bid/ask move with the synthetic mid, preserving each observed side's offset.
- Volumes are preserved row-for-row; we're modeling alternative price paths,
  not alternative liquidity.
- Price generators carry only price+volume columns. Optional market trades are
  added separately by trade_data.py as a new library variant.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import polars as pl
from scipy.interpolate import CubicSpline

GeneratorFn = Callable[[pl.DataFrame, dict, int], pl.DataFrame]


# ---------- helpers ----------

def _replace_mid(df: pl.DataFrame, new_mid: np.ndarray) -> pl.DataFrame:
    """Move prices while keeping each book side's original distance from mid."""
    old_mid = df.get_column("mid_price").to_numpy().astype(float)
    # Preserve each side independently, including books with only one side.
    new_bid = new_mid + df.get_column("bid_price_1").to_numpy().astype(float) - old_mid
    new_ask = new_mid + df.get_column("ask_price_1").to_numpy().astype(float) - old_mid
    return df.with_columns([
        pl.Series("mid_price", new_mid).fill_nan(None),
        pl.Series("bid_price_1", new_bid).fill_nan(None),
        pl.Series("ask_price_1", new_ask).fill_nan(None),
    ])


def _per_partition(
    df: pl.DataFrame, fn: Callable[[pl.DataFrame, np.random.Generator], pl.DataFrame], rng: np.random.Generator
) -> pl.DataFrame:
    """Apply `fn` to each (product, day) partition independently, preserving order."""
    parts: list[pl.DataFrame] = []
    for (_prod, _day), grp in df.group_by(["product", "day"], maintain_order=True):
        parts.append(fn(grp.sort("timestamp"), rng))
    return pl.concat(parts, how="vertical_relaxed")


def _stitch_day_boundaries(df: pl.DataFrame) -> pl.DataFrame:
    """Per-product, shift each day so its first finite mid equals the previous
    day's last finite mid. Preserves within-day shape; eliminates day-boundary
    discontinuities introduced by per-partition generators.

    Source-data day jumps are also smoothed away — synthetic data flows
    continuously across day boundaries, which is usually what you want when the
    point is to test signals on a longer continuous series."""
    parts: list[pl.DataFrame] = []
    for (_prod,), prod_grp in df.group_by(["product"], maintain_order=True):
        days = sorted(prod_grp.get_column("day").unique().to_list())
        if len(days) <= 1:
            parts.append(prod_grp)
            continue

        prev_last: float | None = None
        per_day: list[pl.DataFrame] = []
        for d in days:
            day_grp = prod_grp.filter(pl.col("day") == d).sort("timestamp")
            mid = day_grp.get_column("mid_price").to_numpy().astype(float)
            finite = mid[~np.isnan(mid)]
            if finite.size == 0:
                per_day.append(day_grp)
                continue
            first_finite = float(finite[0])
            shift = 0.0 if prev_last is None else (prev_last - first_finite)
            if shift != 0.0:
                day_grp = day_grp.with_columns([
                    pl.col("mid_price") + shift,
                    pl.col("bid_price_1") + shift,
                    pl.col("ask_price_1") + shift,
                ])
            # Recompute last finite mid after shift.
            new_mid = day_grp.get_column("mid_price").to_numpy().astype(float)
            new_finite = new_mid[~np.isnan(new_mid)]
            prev_last = float(new_finite[-1]) if new_finite.size > 0 else prev_last
            per_day.append(day_grp)

        parts.append(pl.concat(per_day, how="vertical_relaxed"))
    return pl.concat(parts, how="vertical_relaxed")


# ---------- generators ----------

def inversion(df: pl.DataFrame, params: dict, seed: int) -> pl.DataFrame:
    """Reflect mid around its rolling mean, or reverse time.

    params:
      mode: "reflect" (default) or "reverse"
      window: int (rolling window for reflect mode; default 200)
    """
    mode = params.get("mode", "reflect")
    if mode == "reverse":
        # Reverse rows within each (product, day) — timestamps stay (sequence preserved).
        def reverse_part(grp: pl.DataFrame, _rng) -> pl.DataFrame:
            ts = grp.get_column("timestamp").to_numpy()
            n = grp.height
            # Reverse the value columns but keep timestamps in original order.
            reversed_idx = np.arange(n)[::-1]
            cols = {}
            for c in grp.columns:
                if c in ("timestamp", "product", "day"):
                    cols[c] = grp.get_column(c)
                else:
                    cols[c] = pl.Series(c, grp.get_column(c).to_numpy()[reversed_idx])
            cols["timestamp"] = pl.Series("timestamp", ts)
            return pl.DataFrame(cols)
        rng = np.random.default_rng(seed)
        return _stitch_day_boundaries(_per_partition(df, reverse_part, rng))

    # Reflection mode.
    window = max(2, int(params.get("window", 200)))

    def reflect_part(grp: pl.DataFrame, _rng) -> pl.DataFrame:
        mid = grp.get_column("mid_price").to_numpy().astype(float)
        # Rolling mean (centered would be nicer but trailing is simpler & avoids edge NaN).
        rolling = (
            pl.Series(mid).fill_nan(None).rolling_mean(window_size=window, min_samples=1).to_numpy()
        )
        new_mid = 2.0 * rolling - mid
        return _replace_mid(grp, new_mid)

    return _stitch_day_boundaries(_per_partition(df, reflect_part, np.random.default_rng(seed)))


def day_shuffle_spline(df: pl.DataFrame, params: dict, seed: int) -> pl.DataFrame:
    """Permute days within each product; smooth the joins with a cubic spline.

    params:
      blend_window: int (number of rows on each side of the boundary smoothed; default 50)
    """
    blend = max(2, int(params.get("blend_window", 50)))
    rng = np.random.default_rng(seed)

    out_parts: list[pl.DataFrame] = []
    for (prod,), prod_grp in df.group_by(["product"], maintain_order=True):
        # Collect per-day frames sorted by day.
        days = sorted(prod_grp.get_column("day").unique().to_list())
        day_frames = {
            int(d): prod_grp.filter(pl.col("day") == d).sort("timestamp")
            for d in days
        }
        # Random permutation of days.
        perm = list(days)
        rng.shuffle(perm)

        # Concatenate with the *original* day order in metadata preserved per row.
        # We blend the last `blend` rows of day k with the first `blend` rows of day k+1
        # using a cubic spline whose endpoints match the surrounding rows exactly.
        blocks: list[pl.DataFrame] = [day_frames[perm[0]].clone()]
        for k in range(1, len(perm)):
            prev = blocks[-1]
            curr = day_frames[perm[k]].clone()

            n_prev = prev.height
            n_curr = curr.height
            if n_prev < blend + 1 or n_curr < blend + 1:
                blocks.append(curr)
                continue

            # Build spline anchors: a few points before the boundary on `prev`,
            # a few after the boundary on `curr`, with the boundary itself at x=0.
            anchor_count = 4
            x_anchor = np.array([-blend, -blend // 2, blend // 2, blend])
            prev_mid = prev.get_column("mid_price").to_numpy().astype(float)
            curr_mid = curr.get_column("mid_price").to_numpy().astype(float)
            y_anchor = np.array([
                prev_mid[n_prev - blend - 1],
                prev_mid[n_prev - blend // 2 - 1],
                curr_mid[blend // 2],
                curr_mid[blend - 1],
            ])
            # Drop NaNs from anchors (rare; just skip blend if any are NaN).
            if np.any(np.isnan(y_anchor)):
                blocks.append(curr)
                continue
            spline = CubicSpline(x_anchor, y_anchor)

            # Replace the last `blend` rows of prev with spline(x = -blend..-1).
            prev_new_mid = prev_mid.copy()
            prev_xs = np.arange(-blend, 0)
            prev_new_mid[n_prev - blend :] = spline(prev_xs)
            blocks[-1] = _replace_mid(prev, prev_new_mid)
            _ = anchor_count  # unused but kept for clarity

            # Replace the first `blend` rows of curr with spline(x = 0..blend-1).
            curr_new_mid = curr_mid.copy()
            curr_xs = np.arange(0, blend)
            curr_new_mid[:blend] = spline(curr_xs)
            curr = _replace_mid(curr, curr_new_mid)
            blocks.append(curr)

        # Reassemble: re-number timestamps so they're contiguous across the shuffled days.
        cat = pl.concat(blocks, how="vertical_relaxed")
        # Keep original day labels (so downstream can still group by day if needed).
        # But assign new sequential timestamps so the chart shows continuity.
        n = cat.height
        new_ts = np.arange(n, dtype=np.int64) * 100  # 100-tick spacing like Prosperity
        cat = cat.with_columns([
            pl.Series("timestamp", new_ts),
            pl.lit(prod).alias("product"),
        ])
        out_parts.append(cat)

    return pl.concat(out_parts, how="vertical_relaxed")


def block_bootstrap(df: pl.DataFrame, params: dict, seed: int) -> pl.DataFrame:
    """Resample contiguous blocks of *log returns* (not raw prices) and rebuild
    a price path by cumulating them. Bootstrapping prices directly creates a
    visible jump at every block boundary because block A ends at one source
    price and block B starts at a different source price. Bootstrapping
    returns keeps the path continuous: each block is a local sequence of
    incremental moves, and the rebuilt path stitches them onto wherever the
    last block left the price.

    params:
      block_size: int (number of contiguous returns per block; default 100)
    """
    block_size = max(2, int(params.get("block_size", 100)))

    def bootstrap_part(grp: pl.DataFrame, rng: np.random.Generator) -> pl.DataFrame:
        n = grp.height
        if n <= block_size:
            return grp
        mid = grp.get_column("mid_price").to_numpy().astype(float)

        # Log returns. No-book ticks (NaN mid) become NaN log, then 0-return so
        # the bootstrap walks past them without exploding.
        safe_mid = np.where(np.isnan(mid) | (mid <= 0), np.nan, mid)
        log_mid = np.log(safe_mid)
        first_finite_idx = int(np.argmax(~np.isnan(log_mid)))
        anchor = log_mid[first_finite_idx]
        ret = np.diff(log_mid, prepend=anchor)
        ret = np.where(np.isfinite(ret), ret, 0.0)

        # Sample n_blocks of consecutive returns; valid starts are 0..n-block_size.
        n_blocks = (n + block_size - 1) // block_size
        starts = rng.integers(0, n - block_size + 1, size=n_blocks)
        idx = np.concatenate([np.arange(s, s + block_size) for s in starts])[:n]
        new_returns = ret[idx]

        # Rebuild a continuous price path by cumulating returns from the anchor.
        new_log_mid = anchor + np.cumsum(new_returns)
        new_mid = np.exp(new_log_mid)

        # Preserve NaN positions from the source so no-book ticks remain blank.
        new_mid[np.isnan(mid)] = np.nan
        return _replace_mid(grp, new_mid)

    return _stitch_day_boundaries(_per_partition(df, bootstrap_part, np.random.default_rng(seed)))


def noise_injection(df: pl.DataFrame, params: dict, seed: int) -> pl.DataFrame:
    """Add Gaussian noise to mid.

    params:
      sigma: float (stddev in price units; default = 0.05 * source mid std)
      relative: bool (if true, sigma is multiplied by per-partition mid std; default true)
    """
    sigma_raw = float(params.get("sigma", 0.05))
    relative = bool(params.get("relative", True))

    def noise_part(grp: pl.DataFrame, rng: np.random.Generator) -> pl.DataFrame:
        mid = grp.get_column("mid_price").to_numpy().astype(float)
        scale = float(np.nanstd(mid)) * sigma_raw if relative else sigma_raw
        noise = rng.normal(0.0, scale, size=mid.size)
        new_mid = mid + noise
        return _replace_mid(grp, new_mid)

    return _per_partition(df, noise_part, np.random.default_rng(seed))


def drift_vol_scaling(df: pl.DataFrame, params: dict, seed: int) -> pl.DataFrame:
    """Scale the volatility of returns by a constant factor.

    params:
      vol_factor: float (multiplier on log returns; default 2.0)
    """
    factor = float(params.get("vol_factor", 2.0))

    def scale_part(grp: pl.DataFrame, _rng) -> pl.DataFrame:
        mid = grp.get_column("mid_price").to_numpy().astype(float)
        # Scale relative to the first valid price; gaps stay blank, later prices recover.
        valid = np.isfinite(mid) & (mid > 0)
        new_mid = np.full(mid.shape, np.nan)
        if valid.any():
            anchor = mid[valid][0]
            new_mid[valid] = np.exp(np.log(anchor) + factor * (np.log(mid[valid]) - np.log(anchor)))
        return _replace_mid(grp, new_mid)

    return _stitch_day_boundaries(_per_partition(df, scale_part, np.random.default_rng(seed)))


# ---------- catalog ----------

GENERATORS: dict[str, GeneratorFn] = {
    "inversion": inversion,
    "day_shuffle_spline": day_shuffle_spline,
    "block_bootstrap": block_bootstrap,
    "noise_injection": noise_injection,
    "drift_vol_scaling": drift_vol_scaling,
}

GENERATOR_METADATA: dict[str, dict] = {
    "inversion": {
        "label": "Inversion",
        "description": "Reflect mid around its rolling mean, or replay time backwards.",
        "params": {
            "mode": {"type": "enum", "options": ["reflect", "reverse"], "default": "reflect"},
            "window": {"type": "int", "default": 200, "min": 2},
        },
    },
    "day_shuffle_spline": {
        "label": "Day Shuffle + Spline",
        "description": "Permute selected days; cubic-spline the joins so day boundaries stay continuous.",
        "params": {
            "blend_window": {"type": "int", "default": 50, "min": 2},
        },
    },
    "block_bootstrap": {
        "label": "Block Bootstrap",
        "description": "Cuts the price series into chunks of N consecutive ticks and reassembles them in a random order. Within each chunk the prices stay intact (so short-term wiggles look real); across chunks the structure is scrambled. Use to test whether a signal depends on local patterns (it'll survive) vs. day-level path structure (it'll break).",
        "params": {
            "block_size": {"type": "int", "default": 100, "min": 2},
        },
    },
    "noise_injection": {
        "label": "Noise Injection",
        "description": "Add Gaussian noise to mid; sigma is relative to per-partition mid std by default.",
        "params": {
            "sigma": {"type": "float", "default": 0.05, "min": 0.0},
            "relative": {"type": "bool", "default": True},
        },
    },
    "drift_vol_scaling": {
        "label": "Volatility Scaling",
        "description": "Scale log-return magnitude by a constant factor; preserves direction.",
        "params": {
            "vol_factor": {"type": "float", "default": 2.0, "min": 0.0},
        },
    },
}
