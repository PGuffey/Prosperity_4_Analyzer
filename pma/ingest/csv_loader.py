"""Load Prosperity CSV files into typed Polars DataFrames.

Both prices and trades use semicolon-separated CSVs. Schema as documented in
IMPLEMENTATION_DOCUMENT.md §3.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

PRICE_SCHEMA = {
    "day": pl.Int32,
    "timestamp": pl.Int64,
    "product": pl.Utf8,
    "bid_price_1": pl.Float64,
    "bid_volume_1": pl.Int64,
    "bid_price_2": pl.Float64,
    "bid_volume_2": pl.Int64,
    "bid_price_3": pl.Float64,
    "bid_volume_3": pl.Int64,
    "ask_price_1": pl.Float64,
    "ask_volume_1": pl.Int64,
    "ask_price_2": pl.Float64,
    "ask_volume_2": pl.Int64,
    "ask_price_3": pl.Float64,
    "ask_volume_3": pl.Int64,
    "mid_price": pl.Float64,
    "profit_and_loss": pl.Float64,
}

TRADE_SCHEMA = {
    "timestamp": pl.Int64,
    "buyer": pl.Utf8,
    "seller": pl.Utf8,
    "symbol": pl.Utf8,
    "currency": pl.Utf8,
    "price": pl.Float64,
    "quantity": pl.Int64,
}


def load_prices(csv: Path) -> pl.DataFrame:
    return pl.read_csv(
        csv,
        separator=";",
        schema_overrides=PRICE_SCHEMA,
        null_values=[""],
        infer_schema_length=0,
    )


def load_trades(csv: Path) -> pl.DataFrame:
    return pl.read_csv(
        csv,
        separator=";",
        schema_overrides=TRADE_SCHEMA,
        null_values=[""],
        infer_schema_length=0,
    )
