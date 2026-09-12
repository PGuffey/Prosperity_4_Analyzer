import pytest

from pma.core import store

pytestmark = pytest.mark.usefixtures("competition_sample")

SEASON = "prosperity_4"


def test_invalid_season_rejected() -> None:
    with pytest.raises(ValueError):
        store.fetch_prices_range("not-a-season", 1, 0, "ASH_COATED_OSMIUM")


def test_prices_range_returns_columns() -> None:
    d = store.fetch_prices_range(SEASON, 1, 0, "INTARIAN_PEPPER_ROOT")
    assert "timestamp" in d
    assert "mid_price" in d
    assert len(d["timestamp"]) == len(d["mid_price"]) > 0
    # Ordered
    assert d["timestamp"] == sorted(d["timestamp"])


def test_prices_range_filters_by_time() -> None:
    d = store.fetch_prices_range(
        SEASON, 1, 0, "INTARIAN_PEPPER_ROOT", t_from=0, t_to=1000
    )
    assert max(d["timestamp"]) <= 1000
    assert min(d["timestamp"]) >= 0


def test_orderbook_at_returns_levels() -> None:
    snap = store.fetch_orderbook_at(SEASON, 1, 0, "INTARIAN_PEPPER_ROOT", 0)
    assert snap is not None
    assert snap["timestamp"] == 0
    assert isinstance(snap["bids"], list)
    assert isinstance(snap["asks"], list)


def test_orderbook_missing_timestamp_returns_none() -> None:
    assert store.fetch_orderbook_at(SEASON, 1, 0, "INTARIAN_PEPPER_ROOT", 99_999_999) is None


def test_trades_range() -> None:
    d = store.fetch_trades_range(SEASON, 1, 0, "INTARIAN_PEPPER_ROOT")
    assert "timestamp" in d
    assert len(d["timestamp"]) == len(d["price"]) == len(d["quantity"])


def test_day_summary_keys() -> None:
    s = store.fetch_day_summary(SEASON, 1, 0, "INTARIAN_PEPPER_ROOT")
    for k in (
        "n_snapshots", "t_min", "t_max", "mid_min", "mid_max",
        "mid_mean", "mid_std", "spread_mean", "spread_min", "spread_max",
        "n_trades", "volume",
    ):
        assert k in s
    assert s["n_snapshots"] > 0
    assert s["t_min"] <= s["t_max"]
