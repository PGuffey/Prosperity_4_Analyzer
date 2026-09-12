"""Hypothesis evaluation engine.

Given a signal predicate, scope, and future-return horizon, evaluate against
the partitioned Parquet store and return overall + per-day + per-product
breakdowns, an in-sample / out-of-sample split when applicable, a bootstrap
confidence interval on the mean future return, and a distribution histogram.

All heavy lifting is Polars; bootstrap and percentiles use NumPy.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field, replace
from typing import Literal

import numpy as np
import polars as pl

from pma.analysis.indicators import SUPPORTED_INDICATORS, signal_expr
from pma.core import store

Op = Literal[">", ">=", "<", "<="]
_OP_TO_PL = {
    ">": pl.Expr.gt,
    ">=": pl.Expr.ge,
    "<": pl.Expr.lt,
    "<=": pl.Expr.le,
}

_SEASON_OK = re.compile(r"^[a-z0-9_]+$")


@dataclass
class HypothesisRequest:
    season: str
    round: int
    days: list[int]
    products: list[str]
    indicator: str
    op: Op
    threshold: float
    horizon: int
    indicator_params: dict = field(default_factory=dict)
    bootstrap_iters: int = 1000
    seed: int = 0
    # If set, the hypothesis is evaluated against a saved synthetic dataset
    # (loaded from `data/processed/synthetic/<id>/prices.parquet`) instead of
    # the season/round/day/product partition above. The other scope fields are
    # still recorded for logging/breadcrumbs.
    synthetic_id: str | None = None


def canonical_hash(req: HypothesisRequest) -> str:
    """Stable hash of the hypothesis for the log / dedup key."""
    blob = {
        "analysis_version": 2,
        "season": req.season,
        "round": req.round,
        "days": sorted(req.days),
        "products": sorted(req.products),
        "indicator": req.indicator,
        "op": req.op,
        "threshold": req.threshold,
        "horizon": req.horizon,
        "indicator_params": req.indicator_params,
        "synthetic_id": req.synthetic_id,
    }
    return hashlib.md5(json.dumps(blob, sort_keys=True).encode()).hexdigest()


def _fetch_frame(req: HypothesisRequest) -> pl.DataFrame:
    """Load the prices needed for evaluation as a single Polars frame.

    When `synthetic_id` is set, the saved synthetic dataset is loaded instead.
    Synthetic frames don't carry product/day columns; we inject them from the
    manifest's source so the engine's per-(product, day) operators still work.
    """
    if req.synthetic_id is not None:
        # Late import to avoid circular dependency.
        from pma.synthetic import library as syn_lib
        m = syn_lib.load_manifest(req.synthetic_id)
        frame = syn_lib.load_frame(req.synthetic_id)
        if m is None or frame is None:
            raise ValueError(f"unknown synthetic dataset: {req.synthetic_id!r}")
        if "product" not in frame.columns:
            frame = frame.with_columns(pl.lit(m["source"]["product"]).alias("product"))
        if "day" not in frame.columns:
            frame = frame.with_columns(pl.lit(int(m["source"]["days"][0])).alias("day"))
        return frame

    if not _SEASON_OK.match(req.season):
        raise ValueError(f"invalid season: {req.season!r}")
    return store.fetch_prices_frame(req.season, req.round, req.days, req.products)


def _compute_event_columns(
    frame: pl.DataFrame, req: HypothesisRequest
) -> pl.DataFrame:
    """Measure selected snapshots in playback order, carrying history across days."""
    horizon = max(1, int(req.horizon))
    sig = signal_expr(req.indicator, req.indicator_params)

    frame = frame.with_columns([
        sig.alias("__signal"),
        pl.col("mid_price").shift(-horizon).over("product").alias("__mid_future"),
        pl.col("day").shift(-horizon).over("product").alias("__future_day"),
    ])
    frame = frame.with_columns([
        ((pl.col("__mid_future") - pl.col("mid_price")) / pl.col("mid_price"))
        .alias("__future_return")
    ])

    # Event: signal valid AND passes op AND future return valid.
    op_fn = _OP_TO_PL[req.op]
    cond = (
        pl.col("__signal").is_finite()
        & op_fn(pl.col("__signal"), req.threshold)
        & pl.col("__future_return").is_finite()
        & (pl.col("mid_price") > 0)
    )
    frame = frame.with_columns(cond.alias("__event"))
    return frame


def _aggregate(frame: pl.DataFrame, mask: pl.Expr | None = None) -> dict:
    """Compute summary stats over the rows where `__event` is true.

    If `mask` is given it's AND-ed with the event predicate (used for breakdowns).
    """
    f = frame
    if mask is not None:
        f = f.filter(mask)
    f = f.filter(pl.col("__event"))
    n = f.height
    if n == 0:
        return _empty_summary(n)

    returns = f.get_column("__future_return").to_numpy()
    hit_rate = float((returns > 0).mean())
    mean = float(returns.mean())
    median = float(np.median(returns))
    p10 = float(np.percentile(returns, 10))
    p90 = float(np.percentile(returns, 90))
    return {
        "count": n,
        "hit_rate": hit_rate,
        "mean": mean,
        "median": median,
        "p10": p10,
        "p90": p90,
    }


def _empty_summary(n: int) -> dict:
    return {
        "count": n,
        "hit_rate": 0.0,
        "mean": 0.0,
        "median": 0.0,
        "p10": 0.0,
        "p90": 0.0,
    }


def _bootstrap_ci(returns: np.ndarray, iters: int, seed: int) -> tuple[float, float]:
    if returns.size == 0:
        return (0.0, 0.0)
    rng = np.random.default_rng(seed)
    n = returns.size
    # Keep temporary arrays small while preserving the seeded sampling order.
    batch = max(1, 250_000 // n)
    means = np.empty(iters)
    for start in range(0, iters, batch):
        stop = min(start + batch, iters)
        idx = rng.integers(0, n, size=(stop - start, n))
        means[start:stop] = returns[idx].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def _histogram(returns: np.ndarray, bins: int = 30) -> dict:
    if returns.size == 0:
        return {"edges": [], "counts": []}
    low, high = float(returns.min()), float(returns.max())
    # Almost-identical returns need a nonzero display range for distinct bins.
    if high - low < 1e-12 * max(1.0, abs(low), abs(high)):
        pad = max(1e-9, abs(low) * 1e-6)
        low, high = low - pad, high + pad
    counts, edges = np.histogram(returns, bins=bins, range=(low, high))
    return {"edges": edges.tolist(), "counts": counts.tolist()}


def run_hypothesis(req: HypothesisRequest) -> dict:
    """Evaluate a market response; no fills or terminal settlement are simulated."""
    req = replace(req, days=sorted(set(req.days)), products=sorted(set(req.products)))
    if req.op not in _OP_TO_PL:
        raise ValueError("unsupported comparison operator")
    if not np.isfinite(req.threshold):
        raise ValueError("threshold must be finite")
    if not isinstance(req.horizon, int) or not 1 <= req.horizon <= 1_000_000:
        raise ValueError("horizon must be a whole number between 1 and 1000000")
    if not isinstance(req.bootstrap_iters, int) or not 1 <= req.bootstrap_iters <= 10_000:
        raise ValueError("bootstrap iterations must be between 1 and 10000")
    if req.seed < 0:
        raise ValueError("seed must be non-negative")
    if req.indicator not in SUPPORTED_INDICATORS:
        raise ValueError(f"unsupported indicator: {req.indicator!r}")
    signal_expr(req.indicator, req.indicator_params)

    frame = _fetch_frame(req)
    # For synthetic runs, override the requested days/products to whatever the
    # synthetic frame actually contains so breakdowns are honest.
    if req.synthetic_id is not None and not frame.is_empty():
        req.days = sorted(int(d) for d in frame.get_column("day").unique().to_list())
        req.products = sorted(frame.get_column("product").unique().to_list())
    if frame.is_empty():
        return {
            "overall": _empty_summary(0)
                | {"sample_size": 0, "signal_rate": 0.0, "ci_low": 0.0, "ci_high": 0.0, "warnings": ["no data in scope"]},
            "per_day": [],
            "per_product": None,
            "ios_split": None,
            "distribution": {"edges": [], "counts": []},
            "hash": canonical_hash(req),
        }

    # Real data uses calendar order. Synthetic frames already carry playback order.
    if req.synthetic_id is None:
        frame = frame.sort(["product", "day", "timestamp"])
    frame = frame.with_columns(pl.col(pl.Float64).fill_nan(None))
    frame = _compute_event_columns(frame, req)

    # Overall.
    overall = _aggregate(frame)
    sample_size = frame.filter(
        pl.col("__signal").is_finite()
        & pl.col("__future_return").is_finite()
        & (pl.col("mid_price") > 0)
    ).height
    signal_rate = (overall["count"] / sample_size) if sample_size else 0.0
    returns_all = (
        frame.filter(pl.col("__event")).get_column("__future_return").to_numpy()
        if overall["count"] > 0
        else np.array([], dtype=float)
    )
    ci_low, ci_high = _bootstrap_ci(returns_all, req.bootstrap_iters, req.seed)
    hist = _histogram(returns_all)

    warnings: list[str] = []
    if overall["count"] == 0:
        warnings.append("no matching events with a valid future price; try a shorter horizon or different threshold")
    if any(b - a != 1 for a, b in zip(req.days, req.days[1:], strict=False)):
        warnings.append("selected days contain gaps; horizons count available snapshots only")
    if 0 < overall["count"] < 30:
        warnings.append("low sample count (< 30 events)")
    if overall["count"] >= 30 and (ci_low <= 0 <= ci_high):
        warnings.append("95% CI on mean crosses zero")

    # Per-day breakdown.
    per_day: list[dict] = []
    for d in sorted(req.days):
        s = _aggregate(frame, pl.col("day") == d)
        per_day.append({"day": int(d), **s})

    # Per-product breakdown (only meaningful when scope has multiple products).
    per_product: list[dict] | None = None
    if len(req.products) > 1:
        per_product = []
        for prod in sorted(req.products):
            s = _aggregate(frame, pl.col("product") == prod)
            per_product.append({"product": prod, **s})

    # IS/OOS split — IS = all-but-last day, OOS = last day.
    ios_split: dict | None = None
    if len(req.days) >= 2 and req.synthetic_id is None:
        sorted_days = sorted(req.days)
        oos_day = sorted_days[-1]
        is_days = sorted_days[:-1]
        # Do not let an earlier-day outcome look into the last-day comparison.
        is_summary = _aggregate(frame, pl.col("day").is_in(is_days) & pl.col("__future_day").is_in(is_days))
        oos_summary = _aggregate(frame, pl.col("day") == oos_day)
        ios_split = {
            "in_sample": {"days": is_days, **is_summary},
            "out_of_sample": {"day": oos_day, **oos_summary},
        }
        if (
            is_summary["count"] >= 10 and oos_summary["count"] >= 10
            and (
                np.sign(is_summary["mean"]) != np.sign(oos_summary["mean"])
                or abs(is_summary["hit_rate"] - oos_summary["hit_rate"]) > 0.15
            )
        ):
            warnings.append("IS / OOS divergence (signal may not generalize)")

    return {
        "overall": {
            **overall,
            "sample_size": sample_size,
            "signal_rate": signal_rate,
            "ci_low": ci_low,
            "ci_high": ci_high,
            "warnings": warnings,
        },
        "per_day": per_day,
        "per_product": per_product,
        "ios_split": ios_split,
        "distribution": hist,
        "hash": canonical_hash(req),
    }
