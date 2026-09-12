"""Validation checks per IMPLEMENTATION_DOCUMENT.md §11.

Each check returns a list of (severity, message) tuples. Severity is one of
`info`, `warn`, `error`. The ingest pipeline aggregates these into the import log.
"""

from __future__ import annotations

from typing import Literal

import polars as pl

Severity = Literal["info", "warn", "error"]
Finding = tuple[Severity, str]


def validate_prices(df: pl.DataFrame) -> list[Finding]:
    findings: list[Finding] = []

    if df.is_empty():
        findings.append(("error", "prices: empty file"))
        return findings

    required = {"day", "timestamp", "product", "bid_price_1", "ask_price_1", "mid_price"}
    missing = required - set(df.columns)
    if missing:
        findings.append(("error", f"prices: missing required columns: {sorted(missing)}"))
        return findings

    n = df.height
    dup = df.select(["day", "timestamp", "product"]).is_duplicated().sum()
    if dup:
        findings.append(("warn", f"prices: {dup}/{n} duplicate (day, timestamp, product) rows"))

    # Crossed books
    crossed = df.filter(
        pl.col("bid_price_1").is_not_null()
        & pl.col("ask_price_1").is_not_null()
        & (pl.col("bid_price_1") >= pl.col("ask_price_1"))
    ).height
    if crossed:
        findings.append(("warn", f"prices: {crossed} crossed-book rows (bid_1 >= ask_1)"))

    # Negative spread (redundant with crossed, but flagging if mid_price < bid or > ask)
    bad_mid = df.filter(
        pl.col("mid_price").is_not_null()
        & pl.col("bid_price_1").is_not_null()
        & pl.col("ask_price_1").is_not_null()
        & (
            (pl.col("mid_price") < pl.col("bid_price_1"))
            | (pl.col("mid_price") > pl.col("ask_price_1"))
        )
    ).height
    if bad_mid:
        findings.append(("warn", f"prices: {bad_mid} rows where mid_price is outside [bid_1, ask_1]"))

    # Empty book sides
    empty_bid = df.filter(pl.col("bid_price_1").is_null()).height
    empty_ask = df.filter(pl.col("ask_price_1").is_null()).height
    if empty_bid:
        findings.append(("info", f"prices: {empty_bid} rows with no bid_1"))
    if empty_ask:
        findings.append(("info", f"prices: {empty_ask} rows with no ask_1"))

    return findings


def validate_trades(df: pl.DataFrame, prices: pl.DataFrame | None = None) -> list[Finding]:
    findings: list[Finding] = []

    if df.is_empty():
        findings.append(("info", "trades: empty file (some days have no trades — usually fine)"))
        return findings

    required = {"timestamp", "symbol", "price", "quantity"}
    missing = required - set(df.columns)
    if missing:
        findings.append(("error", f"trades: missing required columns: {sorted(missing)}"))
        return findings

    n = df.height
    nonpositive = df.filter(pl.col("quantity") <= 0).height
    if nonpositive:
        findings.append(("warn", f"trades: {nonpositive}/{n} rows with non-positive quantity"))

    # Trades outside visible book at same timestamp — only if prices given
    if prices is not None and not prices.is_empty():
        joined = df.join(
            prices.select(["timestamp", "product", "bid_price_1", "ask_price_1"]),
            left_on=["timestamp", "symbol"],
            right_on=["timestamp", "product"],
            how="left",
        )
        outside = joined.filter(
            pl.col("bid_price_1").is_not_null()
            & pl.col("ask_price_1").is_not_null()
            & (
                (pl.col("price") < pl.col("bid_price_1"))
                | (pl.col("price") > pl.col("ask_price_1"))
            )
        ).height
        if outside:
            findings.append(
                ("info", f"trades: {outside}/{n} rows outside visible [bid_1, ask_1] at their timestamp")
            )

    return findings
