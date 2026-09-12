"""DuckDB-backed query layer over the partitioned Parquet store.

Single long-lived connection per process. Queries use parameterized SQL; the
parquet glob path is constructed from a whitelisted season name to avoid SQL
injection on the only non-parameterizable input.
"""

from __future__ import annotations

import re
from functools import lru_cache

import duckdb
import polars as pl

from pma.core import paths
from pma.ingest.discover import discover_seasons

_SEASON_OK = re.compile(r"^[a-z0-9_]+$")

_con: duckdb.DuckDBPyConnection | None = None


def conn() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect()
    return _con


def _validate_season(season: str) -> None:
    if not _SEASON_OK.match(season):
        raise ValueError(f"invalid season name: {season!r}")
    if season not in discover_seasons():
        raise ValueError(f"unknown season: {season!r}")


def _prices_glob(season: str) -> str:
    return (paths.processed_root() / season / "prices" / "**" / "*.parquet").as_posix()


def _trades_glob(season: str) -> str:
    return (paths.processed_root() / season / "trades" / "**" / "*.parquet").as_posix()


# ---------- prices ----------

PRICE_RANGE_COLS = (
    "timestamp",
    "mid_price",
    "bid_price_1", "bid_volume_1",
    "ask_price_1", "ask_volume_1",
)


def fetch_prices_range(
    season: str,
    round_n: int,
    day: int,
    product: str,
    t_from: int | None = None,
    t_to: int | None = None,
    include_levels_2_3: bool = False,
) -> dict[str, list]:
    """Return columnar arrays for chart rendering.

    `mid_price` is NULL'd out when both book sides are empty (Prosperity encodes
    these "no-book" rows as `mid_price = 0.0`, which would otherwise drop the
    chart to zero).
    """
    _validate_season(season)
    cols = list(PRICE_RANGE_COLS)
    if include_levels_2_3:
        cols += [
            "bid_price_2", "bid_volume_2",
            "bid_price_3", "bid_volume_3",
            "ask_price_2", "ask_volume_2",
            "ask_price_3", "ask_volume_3",
        ]

    # Replace mid_price with a NULL-aware variant in the projection.
    select_cols = [
        "CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL ELSE mid_price END AS mid_price"
        if c == "mid_price"
        else c
        for c in cols
    ]

    where = ["round = ?", "day = ?", "product = ?"]
    params: list = [round_n, day, product]
    if t_from is not None:
        where.append("timestamp >= ?")
        params.append(t_from)
    if t_to is not None:
        where.append("timestamp <= ?")
        params.append(t_to)
    sql = (
        f"SELECT {', '.join(select_cols)} "
        f"FROM read_parquet('{_prices_glob(season)}', hive_partitioning=true) "
        f"WHERE {' AND '.join(where)} ORDER BY timestamp"
    )
    tbl = conn().cursor().execute(sql, params).to_arrow_table()
    return {c: tbl[c].to_pylist() for c in cols}


def fetch_orderbook_at(
    season: str, round_n: int, day: int, product: str, t: int
) -> dict | None:
    """Return a full L3 snapshot at exactly timestamp `t`, or None if absent."""
    _validate_season(season)
    sql = (
        "SELECT timestamp, mid_price, "
        "bid_price_1, bid_volume_1, bid_price_2, bid_volume_2, bid_price_3, bid_volume_3, "
        "ask_price_1, ask_volume_1, ask_price_2, ask_volume_2, ask_price_3, ask_volume_3 "
        f"FROM read_parquet('{_prices_glob(season)}', hive_partitioning=true) "
        "WHERE round = ? AND day = ? AND product = ? AND timestamp = ?"
    )
    row = conn().cursor().execute(sql, [round_n, day, product, t]).fetchone()
    if row is None:
        return None
    (
        ts, mid,
        b1p, b1v, b2p, b2v, b3p, b3v,
        a1p, a1v, a2p, a2v, a3p, a3v,
    ) = row
    bids = [[p, v] for p, v in [(b1p, b1v), (b2p, b2v), (b3p, b3v)] if p is not None]
    asks = [[p, v] for p, v in [(a1p, a1v), (a2p, a2v), (a3p, a3v)] if p is not None]
    spread = (a1p - b1p) if (a1p is not None and b1p is not None) else None
    return {"timestamp": ts, "mid_price": mid, "spread": spread, "bids": bids, "asks": asks}


# ---------- trades ----------

def fetch_trades_range(
    season: str,
    round_n: int,
    day: int,
    product: str,
    t_from: int | None = None,
    t_to: int | None = None,
) -> dict[str, list]:
    _validate_season(season)
    where = ["round = ?", "day = ?", "symbol = ?"]
    params: list = [round_n, day, product]
    if t_from is not None:
        where.append("timestamp >= ?")
        params.append(t_from)
    if t_to is not None:
        where.append("timestamp <= ?")
        params.append(t_to)
    sql = (
        "SELECT timestamp, price, quantity, buyer, seller "
        f"FROM read_parquet('{_trades_glob(season)}', hive_partitioning=true) "
        f"WHERE {' AND '.join(where)} ORDER BY timestamp"
    )
    tbl = conn().cursor().execute(sql, params).to_arrow_table()
    return {c: tbl[c].to_pylist() for c in ["timestamp", "price", "quantity", "buyer", "seller"]}


# ---------- price frame (Polars) — shared by hypothesis + synthetic engines ----------

def fetch_prices_frame(
    season: str,
    round_n: int,
    days: list[int],
    products: list[str],
) -> pl.DataFrame:
    """Load prices for multiple (day, product) combinations as a Polars frame.

    Returns columns: product, day, timestamp, mid_price, bid_price_1, bid_volume_1,
    ask_price_1, ask_volume_1. `mid_price` is NULL where both book sides are empty
    (Prosperity's no-book encoding).
    """
    _validate_season(season)
    sql = (
        "SELECT product, day, timestamp, "
        "  CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL "
        "       ELSE mid_price END AS mid_price, "
        "  bid_price_1, bid_volume_1, ask_price_1, ask_volume_1 "
        f"FROM read_parquet('{_prices_glob(season)}', hive_partitioning=true) "
        "WHERE round = ? AND day IN ? AND product IN ? "
        "ORDER BY product, day, timestamp"
    )
    arrow = (
        conn().cursor()
        .execute(sql, [round_n, days, products])
        .to_arrow_table()
    )
    return pl.from_arrow(arrow)  # type: ignore[return-value]


# ---------- summary ----------

@lru_cache(maxsize=256)
def fetch_day_summary(season: str, round_n: int, day: int, product: str) -> dict:
    _validate_season(season)
    # Exclude rows where both book sides are empty (encoded as mid_price=0).
    sql = (
        "WITH cleaned AS ("
        "  SELECT timestamp, bid_price_1, ask_price_1, mid_price "
        f"  FROM read_parquet('{_prices_glob(season)}', hive_partitioning=true) "
        "  WHERE round = ? AND day = ? AND product = ?"
        ") "
        "SELECT "
        "  COUNT(*) AS n_snapshots, "
        "  MIN(timestamp) AS t_min, "
        "  MAX(timestamp) AS t_max, "
        "  MIN(CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL ELSE mid_price END) AS mid_min, "
        "  MAX(CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL ELSE mid_price END) AS mid_max, "
        "  AVG(CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL ELSE mid_price END) AS mid_mean, "
        "  stddev_samp(CASE WHEN bid_price_1 IS NULL AND ask_price_1 IS NULL THEN NULL ELSE mid_price END) AS mid_std, "
        "  AVG(ask_price_1 - bid_price_1) AS spread_mean, "
        "  MIN(ask_price_1 - bid_price_1) AS spread_min, "
        "  MAX(ask_price_1 - bid_price_1) AS spread_max "
        "FROM cleaned"
    )
    row = conn().cursor().execute(sql, [round_n, day, product]).fetchone()
    keys = (
        "n_snapshots", "t_min", "t_max",
        "mid_min", "mid_max", "mid_mean", "mid_std",
        "spread_mean", "spread_min", "spread_max",
    )
    assert row is not None  # Aggregate queries return one row even for an empty scope.
    summary = dict(zip(keys, row, strict=True))

    trade_sql = (
        "SELECT COUNT(*) AS n_trades, SUM(quantity) AS volume "
        f"FROM read_parquet('{_trades_glob(season)}', hive_partitioning=true) "
        "WHERE round = ? AND day = ? AND symbol = ?"
    )
    trow = conn().cursor().execute(trade_sql, [round_n, day, product]).fetchone()
    assert trow is not None
    summary["n_trades"] = trow[0]
    summary["volume"] = trow[1] or 0
    return summary
