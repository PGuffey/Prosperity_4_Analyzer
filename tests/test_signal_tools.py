"""Keep the analyzer's new price-unit signals consistent with its charts."""
import json
from pathlib import Path

import polars as pl
import pytest

from pma.analysis.indicators import signal_expr

FIXTURE = json.loads((Path(__file__).parent / "fixtures/signal_tools.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"])
def test_signal_chart_parity_and_product_isolation(case):
    mids = FIXTURE["mids"]
    data = pl.DataFrame({
        "product": ["A"] * len(mids), "day": [0, 0, 0, 1, 1],
        "mid_price": mids,
        "bid_price_1": [v - 1 if v is not None else None for v in mids],
        "ask_price_1": [v + 1 if v is not None else None for v in mids],
        "bid_volume_1": [3] * len(mids), "ask_volume_1": [1] * len(mids),
    })
    other = data.with_columns(pl.lit("B").alias("product"))
    result = pl.concat([data, other]).select(signal_expr(case["id"], case["params"]))
    assert result.to_series().to_list() == case["expected"] * 2


@pytest.mark.parametrize("reference", [None, True, 0, -1, float("nan"), float("inf"), "100"])
def test_reference_requires_explicit_positive_price(reference):
    with pytest.raises(ValueError, match="reference"):
        signal_expr("fixed_deviation", {"reference": reference})


@pytest.mark.parametrize("name", ["sma_deviation", "ema_deviation"])
@pytest.mark.parametrize("window", [1, 2.5, True, 100001])
def test_deviation_window_validation(name, window):
    with pytest.raises(ValueError, match="window"):
        signal_expr(name, {"window": window})
