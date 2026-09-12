import pytest

from pma.ingest import csv_loader
from pma.ingest.discover import discover_files

pytestmark = pytest.mark.usefixtures("competition_sample")


def _first(kind: str):
    return next(f for f in discover_files("prosperity_4") if f.kind == kind and f.round == 1)


def test_load_prices_schema() -> None:
    f = _first("prices")
    df = csv_loader.load_prices(f.path)
    assert df.height > 0
    assert {"day", "timestamp", "product", "mid_price"} <= set(df.columns)


def test_load_trades_schema() -> None:
    f = _first("trades")
    df = csv_loader.load_trades(f.path)
    assert {"timestamp", "symbol", "price", "quantity"} <= set(df.columns)
