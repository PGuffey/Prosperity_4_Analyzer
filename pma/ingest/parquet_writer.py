"""Write Polars frames out as partitioned Parquet under `data/processed/`."""

from __future__ import annotations

import polars as pl

from pma.core import paths


def write_prices(df: pl.DataFrame, season: str, round_n: int, day: int) -> int:
    """Write a prices frame to its partition. Returns row count written."""
    out_dir = paths.processed_prices_dir(season, round_n, day)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "data.parquet"
    df.write_parquet(out, compression="zstd", statistics=True)
    return df.height


def write_trades(df: pl.DataFrame, season: str, round_n: int, day: int) -> int:
    out_dir = paths.processed_trades_dir(season, round_n, day)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "data.parquet"
    df.write_parquet(out, compression="zstd", statistics=True)
    return df.height
