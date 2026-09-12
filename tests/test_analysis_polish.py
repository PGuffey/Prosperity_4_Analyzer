"""Small examples that catch misleading results in the existing analysis tools."""

import numpy as np
import polars as pl
import pytest
from fastapi.testclient import TestClient

from pma.analysis import hypothesis as h
from pma.analysis import saved_hypotheses
from pma.analysis.indicators import signal_expr
from pma.api.main import app
from pma.synthetic import generators, library


def frame(mids, days=None):
    """Make a tiny market with a two-unit spread and positive book pressure."""
    return pl.DataFrame({
        "product": ["TEST"] * len(mids), "day": days or [0] * len(mids),
        "timestamp": list(range(len(mids))), "mid_price": mids,
        "bid_price_1": [m - 1 if m is not None else None for m in mids],
        "ask_price_1": [m + 1 if m is not None else None for m in mids],
        "bid_volume_1": [3] * len(mids), "ask_volume_1": [1] * len(mids),
    }).with_columns(pl.col("mid_price").cast(pl.Float64))


def request(**kwargs):
    return h.HypothesisRequest(**({"season": "test", "round": 1, "days": [0, 1],
        "products": ["TEST"], "indicator": "imbalance", "op": ">", "threshold": 0,
        "horizon": 1, "bootstrap_iters": 20} | kwargs))


def test_continuity_and_last_day_comparison(monkeypatch):
    monkeypatch.setattr(h, "_fetch_frame", lambda _: frame([100., 110., 121., 133.1], [0, 0, 1, 1]))
    result = h.run_hypothesis(request())
    assert result["overall"]["count"] == 3
    assert result["overall"]["signal_rate"] == 1
    assert result["overall"]["mean"] == pytest.approx(.1)
    assert result["per_day"][0]["count"] == 2
    assert result["ios_split"]["in_sample"]["count"] == 1
    assert result["ios_split"]["out_of_sample"]["count"] == 1


@pytest.mark.parametrize("indicator,params,count", [
    ("fixed_deviation", {"reference": 100}, 2),
    ("sma_deviation", {"window": 2}, 2),
    ("ema_deviation", {"window": 2}, 2),
    ("microprice_gap", {}, 3),
])
def test_new_signals_run_through_full_analysis(monkeypatch, indicator, params, count):
    monkeypatch.setattr(h, "_fetch_frame", lambda _: frame([100., 110., 121., 133.1], [0, 0, 1, 1]))
    result = h.run_hypothesis(request(indicator=indicator, indicator_params=params))
    assert result["overall"]["count"] == count
    assert result["overall"]["mean"] == pytest.approx(.1)


def test_indicators_carry_history_without_crossing_products():
    a = frame([100., 110., 120., None, 130., 140.], [0, 0, 1, 1, 1, 1])
    b = frame([200., 220.]).with_columns(pl.lit("OTHER").alias("product"))
    values = pl.concat([a, b]).with_columns(signal_expr("sma", {"window": 2}).alias("s"))["s"].to_list()
    assert values == [None, 105., 115., None, None, 135., None, 210.]
    returns = a.with_columns(signal_expr("returns").alias("s"))["s"].to_list()
    assert returns[3:5] == [None, None]


@pytest.mark.parametrize("indicator", ["spread", "imbalance", "microprice", "returns", "sma", "zscore", "rolling_vol"])
def test_each_indicator_handles_missing_prices(indicator):
    f = frame([100., 101., None, 103., 105., 104.])
    values = f.with_columns(signal_expr(indicator, {"window": 2}).alias("s"))["s"].drop_nulls().to_numpy()
    assert np.isfinite(values).all()


def test_bootstrap_matches_seeded_reference():
    returns = np.linspace(-.1, .2, 12_000)
    rng = np.random.default_rng(7)
    means = returns[rng.integers(0, len(returns), size=(45, len(returns)))].mean(axis=1)
    assert h._bootstrap_ci(returns, 45, 7) == pytest.approx(np.percentile(means, [2.5, 97.5]))


def test_synthetic_request_keeps_playback_order_and_input(monkeypatch):
    monkeypatch.setattr(h, "_fetch_frame", lambda _: frame([100., 110., 121., 133.1], [1, 1, 0, 0]))
    req = request(synthetic_id="abcdef", days=[99])
    result = h.run_hypothesis(req)
    assert req.days == [99]
    assert result["overall"]["mean"] == pytest.approx(.1)
    assert result["ios_split"] is None


@pytest.mark.parametrize("override", [{"bootstrap_iters": 0}, {"seed": -1}, {"horizon": 0}, {"indicator_params": {"window": 0}, "indicator": "sma"}])
def test_bad_parameters_return_readable_errors(override):
    body = vars(request(**override))
    with TestClient(app) as client:
        response = client.post("/api/hypothesis/test", json=body)
    assert response.status_code in (400, 422)
    assert response.json()["detail"]


def test_log_failure_is_visible(monkeypatch):
    from pma.api.routes import hypothesis as route
    monkeypatch.setattr(h, "_fetch_frame", lambda _: frame([100., 101.]))
    def fail(*_):
        raise OSError("disk unavailable")
    monkeypatch.setattr(route.hypothesis_log, "append", fail)
    with TestClient(app) as client:
        response = client.post("/api/hypothesis/test", json=vars(request()))
    assert response.status_code == 200
    assert any("history" in w for w in response.json()["overall"]["warnings"])


@pytest.mark.parametrize("name", list(generators.GENERATORS))
def test_generators_repeat_and_preserve_shape(name):
    f = frame([100. + i % 7 for i in range(40)])
    fn = generators.GENERATORS[name]
    a, b = fn(f, {}, 3), fn(f, {}, 3)
    assert a.equals(b)
    assert a.height == f.height
    assert (a["bid_price_1"] <= a["ask_price_1"]).all()


def test_vol_scaling_recovers_after_missing_price():
    f = frame([None, 100., 110., None, 120.])
    out = generators.drift_vol_scaling(f, {"vol_factor": 1}, 0)
    assert out["mid_price"].to_list() == pytest.approx([None, 100., 110., None, 120.])


@pytest.mark.parametrize("mids", [[100.], [100., 101., 103.], [100., 101., 102., 104.]])
def test_short_synthetic_stats_are_json_safe(mids):
    assert all(np.isfinite(v) for v in library.compute_stats(frame(mids)).values())


def test_long_saved_name_can_be_saved_twice(tmp_path, monkeypatch):
    monkeypatch.setenv("PMA_ROOT", str(tmp_path))
    a = saved_hypotheses.save("a" * 100, {})
    b = saved_hypotheses.save("a" * 100, {})
    assert a["slug"] != b["slug"]
    assert len(b["slug"]) <= 64
    assert len(saved_hypotheses.list_all()) == 2


def test_synthetic_generate_fetch_and_delete(tmp_path, monkeypatch):
    from pma.core import store
    monkeypatch.setenv("PMA_ROOT", str(tmp_path))
    monkeypatch.setattr(store, "fetch_prices_frame", lambda *_: frame([100., 110., None, 120.]))
    with TestClient(app) as client:
        response = client.post("/api/synthetic/generate", json={
            "season": "test", "round": 1, "days": [0], "product": "TEST",
            "generator": "drift_vol_scaling", "params": {"vol_factor": 1},
        })
        assert response.status_code == 200
        run_id = response.json()["run_id"]
        prices = client.get(f"/api/synthetic/{run_id}/prices")
        assert prices.status_code == 200
        assert prices.json()["mid_price"] == pytest.approx([100., 110., None, 120.])
        assert client.delete(f"/api/synthetic/{run_id}").status_code == 200
        assert client.get(f"/api/synthetic/{run_id}/prices").status_code == 404


@pytest.mark.parametrize("params", [{"sigma": -1}, {"relative": "false"}, {"unknown": 2}])
def test_invalid_generator_parameters(params):
    with TestClient(app) as client:
        response = client.post("/api/synthetic/generate", json={
            "season": "test", "round": 1, "days": [0], "product": "TEST",
            "generator": "noise_injection", "params": params,
        })
    assert response.status_code == 400


def test_supplied_market_all_hypothesis_indicators(competition_sample):
    """Exercise every signal against generated multi-day CSV data without logging."""
    for indicator in ("spread", "imbalance", "microprice", "returns", "sma", "zscore", "rolling_vol"):
        result = h.run_hypothesis(request(
            season="prosperity_4", round=1, days=[-2, -1, 0],
            products=["INTARIAN_PEPPER_ROOT"], indicator=indicator,
            indicator_params={"window": 20},
        ))
        assert result["overall"]["sample_size"] > 0
        assert np.isfinite(result["overall"]["mean"])
        assert len(result["per_day"]) == 3
