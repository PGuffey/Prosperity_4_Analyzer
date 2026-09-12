"""Basket arithmetic, quote direction, missing data and API validation."""
import polars as pl
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from pma.analysis import baskets
from pma.api.main import app


def request(**updates):
    return baskets.BasketRequest(**({"season": "test", "round": 1, "days": [0, 1],
        "basket": "B", "components": [{"product": "A", "weight": 2}], "offset": 2} | updates))


def market():
    rows = []
    for day, mid in [(0, 202.), (1, 210.)]:
        for product, price, depth in [("B", mid, 10), ("A", 100., 6)]:
            rows.append(dict(product=product, day=day, timestamp=0, mid_price=price,
                bid_price_1=price - 1, ask_price_1=price + 1, bid_volume_1=depth, ask_volume_1=depth))
    return pl.DataFrame(rows)


def test_identity_offset_quotes_and_size():
    result = baskets.analyze(request(), market())
    s = result["series"]
    assert s["reference"] == [202, 202]
    assert s["residual"] == [0, 8]
    assert s["sell_gap"] == [-1, 7]  # Offset is not subtracted as a fee.
    assert s["buy_gap"] == [-5, -13]
    assert s["sell_size"] == [3, 3]
    assert result["summary"]["sell_opportunities"] == 1
    assert result["summary"]["mean"] == 4


def test_exact_timestamp_alignment_does_not_fill_missing_legs():
    frame = market().filter(~((pl.col("product") == "A") & (pl.col("day") == 1)))
    result = baskets.analyze(request(days=[1, 0]), frame)
    assert result["series"]["day"] == [0, 1]
    assert result["series"]["residual"] == [0, None]
    assert result["series"]["sell_gap"] == [-1, None]
    assert result["summary"]["missing"] == 1


def test_no_depth_is_not_an_available_opportunity():
    frame = market().with_columns(pl.lit(0).alias("ask_volume_1"))
    result = baskets.analyze(request(), frame)
    assert result["series"]["sell_gap"] == [None, None]
    assert result["summary"]["sell_opportunities"] == 0


def test_duplicate_rows_are_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        baskets.analyze(request(), pl.concat([market(), market().head(1)]))


@pytest.mark.parametrize("updates", [
    {"components": [{"product": "B", "weight": 1}]},
    {"components": [{"product": "A", "weight": 0}]},
    {"components": [{"product": "A", "weight": 1.5}]},
    {"components": [{"product": "A", "weight": True}]},
    {"offset": float("inf")}, {"threshold": -1}, {"days": []},
])
def test_bad_relationships_are_rejected(updates):
    with pytest.raises(ValidationError):
        request(**updates)


def test_api_and_empty_scope(monkeypatch):
    monkeypatch.setattr(baskets.store, "fetch_prices_frame", lambda *args: market())
    with TestClient(app) as client:
        response = client.post("/api/baskets/analyze", json=request().model_dump())
        assert response.status_code == 200
        assert response.json()["series"]["residual"] == [0, 8]
        monkeypatch.setattr(baskets.store, "fetch_prices_frame", lambda *args: market().head(0))
        assert client.post("/api/baskets/analyze", json=request().model_dump()).status_code == 400
