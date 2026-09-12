"""Polars expressions for each indicator.

These mirror the frontend's TS implementations but operate on Polars
DataFrames grouped by product so a single query can evaluate the
same indicator across many days and products at once.
"""

from __future__ import annotations

import math

import polars as pl

IndicatorId = str  # "spread" | "imbalance" | "returns" | "zscore" | "rolling_vol" | "microprice"

DEFAULT_WINDOWS = {
    "zscore": 500,
    "rolling_vol": 50,
    "sma": 100,
    "sma_deviation": 100,
    "ema_deviation": 100,
}


def _by_group() -> list[str]:
    return ["product"]


def signal_expr(name: IndicatorId, params: dict | None = None) -> pl.Expr:
    """Return a Polars expression that computes the named indicator series.

    The expression is intended to be added via `.with_columns()` on a frame
    in playback order; history continues across selected days per product.
    """
    p = params or {}
    if name == "fixed_deviation":
        reference = p.get("reference")
        if (isinstance(reference, bool) or not isinstance(reference, (int, float))
                or not math.isfinite(reference) or reference <= 0):
            raise ValueError("reference must be a finite positive price")
        return pl.col("mid_price").cast(pl.Float64) - reference
    if name == "microprice_gap":
        return signal_expr("microprice") - pl.col("mid_price")
    if name in DEFAULT_WINDOWS:
        w = p.get("window", DEFAULT_WINDOWS[name])
        if isinstance(w, bool) or not isinstance(w, int) or not 2 <= w <= 100_000:
            raise ValueError("window must be a whole number between 2 and 100000")
    if name == "spread":
        return (pl.col("ask_price_1") - pl.col("bid_price_1")).cast(pl.Float64)

    if name == "sma_deviation":
        return pl.col("mid_price") - signal_expr("sma", p)
    if name == "ema_deviation":
        # Use only past/current observations; missing prices do not advance the EMA.
        mid = pl.col("mid_price").cast(pl.Float64)
        baseline = mid.ewm_mean(span=w, adjust=False, min_samples=w, ignore_nulls=True)
        return mid - baseline.over(_by_group())

    if name == "imbalance":
        bv = pl.col("bid_volume_1").cast(pl.Float64)
        av = pl.col("ask_volume_1").cast(pl.Float64)
        return pl.when(bv + av > 0).then((bv - av) / (bv + av)).otherwise(None)

    if name == "microprice":
        bp = pl.col("bid_price_1").cast(pl.Float64)
        ap = pl.col("ask_price_1").cast(pl.Float64)
        bv = pl.col("bid_volume_1").cast(pl.Float64)
        av = pl.col("ask_volume_1").cast(pl.Float64)
        return pl.when(bv + av > 0).then((ap * bv + bp * av) / (bv + av)).otherwise(None)

    if name == "returns":
        m = pl.col("mid_price")
        prev = m.shift(1).over(_by_group())
        return pl.when(prev > 0).then((m - prev) / prev).otherwise(None)

    if name == "zscore":
        w = int(p.get("window", DEFAULT_WINDOWS["zscore"]))
        m = pl.col("mid_price").cast(pl.Float64)
        mean = m.rolling_mean(window_size=w).over(_by_group())
        std = m.rolling_std(window_size=w).over(_by_group())
        return ((m - mean) / std).fill_nan(None)

    if name == "rolling_vol":
        w = int(p.get("window", DEFAULT_WINDOWS["rolling_vol"]))
        r = signal_expr("returns")
        return r.rolling_std(window_size=w).over(_by_group())

    if name == "sma":
        w = int(p.get("window", DEFAULT_WINDOWS["sma"]))
        return pl.col("mid_price").cast(pl.Float64).rolling_mean(window_size=w).over(_by_group())

    raise ValueError(f"unknown indicator: {name!r}")


SUPPORTED_INDICATORS: tuple[IndicatorId, ...] = (
    "fixed_deviation",
    "sma_deviation",
    "ema_deviation",
    "microprice_gap",
    "spread",
    "imbalance",
    "microprice",
    "returns",
    "zscore",
    "rolling_vol",
    "sma",
)
