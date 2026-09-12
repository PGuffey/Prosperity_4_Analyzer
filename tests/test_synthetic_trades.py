"""Trade scenario safety, reproducibility and backtester CSV structure."""
import csv
import io
import zipfile

import polars as pl
import pytest
from fastapi.testclient import TestClient

from pma.api.main import app
from pma.synthetic import library, trade_data


def frame():
    return pl.DataFrame({"product": ["TEST"] * 4, "day": [1, 1, 0, 0],
        "timestamp": [0, 100, 200, 300], "mid_price": [100.5] * 4,
        "bid_price_1": [99.7] * 4, "ask_price_1": [101.2] * 4,
        "bid_volume_1": [2] * 4, "ask_volume_1": [3] * 4})


@pytest.fixture
def saved(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "_root", lambda: tmp_path)
    library.save("testdata", name="Test", source={"season": "test", "round": 1, "days": [0, 1], "product": "TEST"},
        generator="noise_injection", params={}, seed=0, df=frame(), source_stats={})
    return "testdata"


def test_generated_tape_is_reproducible_and_depth_capped():
    a = trade_data.generate_trades(frame(), 1, 1, 100, 7)
    assert a.equals(trade_data.generate_trades(frame(), 1, 1, 100, 7))
    assert a["price"].to_list() == [102] * 4
    assert a["quantity"].max() <= 3
    b = trade_data.generate_trades(frame(), 1, 0, 100, 7)
    assert b["price"].to_list() == [99] * 4
    assert b["quantity"].max() <= 2
    assert trade_data.generate_trades(frame(), 0, .5, 5, 0).height == 0
    missing = frame().with_columns(pl.lit(None).alias("ask_price_1"))
    assert trade_data.generate_trades(missing, 1, 1, 5, 0).height == 0


def test_custom_import_allows_multiple_prints_and_sorts():
    result = trade_data.import_trades("snapshot;price;quantity\n2;101;1\n0;100;2\n0;99;1", frame())
    assert result["snapshot"].to_list() == [0, 0, 2]
    assert result["quantity"].to_list() == [2, 1, 1]


@pytest.mark.parametrize("text", ["", "timestamp,price,quantity\n0,100,1", "snapshot,price,quantity",
    "snapshot,price,quantity\n4,100,1", "snapshot,price,quantity\n0,100,-1",
    "snapshot,price,quantity\n0,nan,1", "snapshot,price,quantity\n0,100.5,1",
    "snapshot,price,quantity,buyer\n0,100,1,=EVIL()"])
def test_invalid_custom_prints_fail_clearly(text):
    with pytest.raises(ValueError):
        trade_data.import_trades(text, frame())


def test_variant_preserves_original_and_export_schema(saved):
    tape = trade_data.generate_trades(frame(), 1, 1, 5, 0)
    variant = trade_data.save_variant(saved, tape, {"mode": "generated", "seed": 0})
    assert variant["run_id"] != saved
    assert library.load_trades(saved).height == 0
    assert library.load_trades(variant["run_id"]).equals(tape)
    assert library.load_frame(saved).equals(library.load_frame(variant["run_id"]))
    with zipfile.ZipFile(io.BytesIO(trade_data.export_bundle(variant["run_id"]))) as bundle:
        price_rows = list(csv.reader(io.StringIO(bundle.read("round1/prices_round_1_day_0.csv").decode()), delimiter=";"))
        assert len(price_rows[0]) == 17
        for i, row in enumerate(price_rows[1:]):
            assert len(row) == 17
            assert int(row[0]) == 0 and int(row[1]) == i * 100
            assert int(row[3]) == 99 and int(row[9]) == 102
            assert row[5:9] == [""] * 4 and row[11:15] == [""] * 4
            assert float(row[15]) == 100.5
        trades = list(csv.reader(io.StringIO(bundle.read("round1/trades_round_1_day_0.csv").decode()), delimiter=";"))
        assert len(trades[0]) == 7
        assert [int(row[0]) for row in trades[1:]] == [0, 100, 200, 300]
        assert all(int(row[5]) == 102 and int(row[6]) > 0 for row in trades[1:])
        mapping = bundle.read("snapshot_map.csv").decode()
        assert "0,1,0,0" in mapping and "2,0,200,200" in mapping


def test_trade_api_import_preview_export_and_validation(saved):
    with TestClient(app) as client:
        result = client.post(f"/api/synthetic/{saved}/trades", json={"csv": "snapshot,price,quantity\n0,100,2"})
        assert result.status_code == 200
        run_id = result.json()["run_id"]
        assert client.get(f"/api/synthetic/{run_id}/trades").json()["count"] == 1
        assert client.get(f"/api/synthetic/{run_id}/export").headers["content-type"] == "application/zip"
        assert client.post(f"/api/synthetic/{saved}/trades", json={"probability": 2}).status_code == 422
        assert client.post(f"/api/synthetic/{saved}/trades", json={"csv": "bad"}).status_code == 400


def test_export_rejects_unusable_books(saved):
    broken = frame().with_columns(pl.lit(None).alias("bid_price_1"), pl.lit(None).alias("ask_price_1"))
    library.save("broken1", name="Broken", source={"round": 1, "product": "TEST"},
        generator="noise_injection", params={}, seed=0, df=broken, source_stats={})
    with pytest.raises(ValueError, match="no exportable book"):
        trade_data.export_bundle("broken1")
