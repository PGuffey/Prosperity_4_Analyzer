"""Quote changes stay separate from executions and preserve the original scenario."""
import io
import zipfile

import polars as pl
import pytest
from fastapi.testclient import TestClient

from pma.api.main import app
from pma.synthetic import library, quotes, trade_data


def frame():
    return pl.DataFrame({"product": ["TEST"] * 3, "day": [1, 0, 0], "timestamp": [0, 100, 200],
        "mid_price": [100., 110., None], "bid_price_1": [99., 109., None],
        "ask_price_1": [101., 111., None], "bid_volume_1": [3, 3, 0], "ask_volume_1": [4, 4, 0]})


def test_distances_sizes_mid_and_missing_prices():
    result = quotes.customize(frame(), quotes.QuoteSettings(bid_distance=2, ask_distance=4, bid_size=7, ask_size=9))
    assert result["bid_price_1"].to_list() == [98, 108, None]
    assert result["ask_price_1"].to_list() == [104, 114, None]
    assert result["mid_price"].to_list() == [101, 111, None]
    assert result["bid_volume_1"].to_list() == [7, 7, 0]
    assert result["ask_volume_1"].to_list() == [9, 9, 0]
    assert result["day"].to_list() == [1, 0, 0]


def test_csv_changes_only_listed_rows_and_can_fill_explicit_missing_book():
    result = quotes.customize(frame(), quotes.QuoteSettings(csv="snapshot,bid_price,bid_size,ask_price,ask_size\n2,119,5,123,8"))
    assert result["mid_price"].to_list() == [100, 110, 121]
    assert result["ask_volume_1"].to_list() == [4, 4, 8]


@pytest.mark.parametrize("row", ["0,105,1,101,1", "0,100,0,101,1", "9,100,1,101,1", "0,nan,1,101,1", "0,100,1,101,1\n0,99,1,101,1"])
def test_invalid_csv_rejected(row):
    with pytest.raises(ValueError):
        quotes.customize(frame(), quotes.QuoteSettings(csv="snapshot,bid_price,bid_size,ask_price,ask_size\n" + row))


def test_new_quote_copy_drops_old_tape_without_changing_original(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "_root", lambda: tmp_path)
    source = frame().head(2)
    tape = trade_data.generate_trades(source, 1, 1, 1, 0)
    library.save("source1", name="Source", source={"round": 1, "product": "TEST"}, generator="noise_injection",
                 params={}, seed=0, df=source, source_stats={}, trades=tape, trade_metadata={"mode": "generated"})
    with TestClient(app) as client:
        response = client.post("/api/synthetic/source1/quotes", json={"bid_size": 7, "ask_size": 9})
        assert response.status_code == 200
        manifest = response.json()
        new_id = manifest["run_id"]
        assert manifest["quotes"]["parent_run_id"] == "source1"
        assert library.load_trades(new_id).height == 0
        assert library.load_trades("source1").equals(tape)
        assert library.load_frame("source1").equals(source)
        with zipfile.ZipFile(io.BytesIO(client.get(f"/api/synthetic/{new_id}/export").content)) as archive:
            assert len(archive.read("round1/trades_round_1_day_0.csv").splitlines()) == 1
        assert client.post("/api/synthetic/source1/quotes", json={"bid_size": -1}).status_code == 422
        assert client.post("/api/synthetic/source1/quotes", json={"bid_distance": 200}).status_code == 400
