"""Tiny generated markets keep ingestion tests independent of private competition data."""

import csv

import pytest

from pma.core import store
from pma.ingest.csv_loader import PRICE_SCHEMA, TRADE_SCHEMA
from pma.ingest.pipeline import ingest_season


@pytest.fixture
def competition_sample(tmp_path, monkeypatch):
    """Build three artificial days in a temporary root, never the user's data folder."""
    monkeypatch.setenv("PMA_ROOT", str(tmp_path))
    raw = tmp_path / "data" / "prosperity_4" / "round_1"
    raw.mkdir(parents=True)
    for day in [-2, -1, 0]:
        with (raw / f"prices_round_1_day_{day}.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(PRICE_SCHEMA), delimiter=";")
            writer.writeheader()
            for timestamp in range(0, 6000, 100):
                row = dict.fromkeys(PRICE_SCHEMA, "")
                mid = 100 + (timestamp // 100) % 7
                row.update(day=day, timestamp=timestamp, product="INTARIAN_PEPPER_ROOT",
                           bid_price_1=mid - 1, bid_volume_1=10, ask_price_1=mid + 1,
                           ask_volume_1=12, mid_price=mid, profit_and_loss=0)
                writer.writerow(row)
        with (raw / f"trades_round_1_day_{day}.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(TRADE_SCHEMA), delimiter=";")
            writer.writeheader()
            writer.writerow(dict(timestamp=100, buyer="", seller="",
                                 symbol="INTARIAN_PEPPER_ROOT", currency="SEASHELLS",
                                 price=100, quantity=2))
    store.fetch_day_summary.cache_clear()
    assert ingest_season("prosperity_4").status == "ok"
    yield
    store.fetch_day_summary.cache_clear()
