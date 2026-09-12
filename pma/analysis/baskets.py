"""Inspect a user-defined basket on exact shared timestamps, without simulating fills."""
from __future__ import annotations

import math
import statistics

import polars as pl
from pydantic import BaseModel, Field, model_validator

from pma.core import store


class BasketLeg(BaseModel):
    product: str = Field(min_length=1, max_length=100)
    weight: int = Field(ge=1, le=10000, strict=True)


class BasketRequest(BaseModel):
    season: str = Field(pattern=r"^[a-z0-9_]+$")
    round: int = Field(ge=0, le=100)
    days: list[int] = Field(min_length=1, max_length=20)
    basket: str = Field(min_length=1, max_length=100)
    components: list[BasketLeg] = Field(min_length=1, max_length=8)
    offset: float = Field(default=0, allow_inf_nan=False, ge=-1e12, le=1e12)
    threshold: float = Field(default=0, allow_inf_nan=False, ge=0, le=1e12)

    @model_validator(mode="after")
    def distinct_legs(self) -> BasketRequest:
        names = [self.basket, *(leg.product for leg in self.components)]
        if len(set(names)) != len(names):
            raise ValueError("Choose distinct products for the basket and each component")
        return self


def analyze(req: BasketRequest, frame: pl.DataFrame | None = None) -> dict:
    """Keep missing legs blank; quote gaps deliberately exclude the reference offset."""
    names = [req.basket, *(leg.product for leg in req.components)]
    if frame is None:
        frame = store.fetch_prices_frame(req.season, req.round, sorted(set(req.days)), names)
    rows: dict[tuple[int, int], dict[str, dict]] = {}
    for row in frame.iter_rows(named=True):
        if row["product"] not in names or row["day"] not in req.days:
            continue
        group = rows.setdefault((row["day"], row["timestamp"]), {})
        if row["product"] in group:
            raise ValueError("Duplicate product/day/timestamp rows; fix the source before comparing legs")
        group[row["product"]] = row
    if not rows:
        raise ValueError("No price data for this relationship and selection")

    def value(row: dict | None, key: str) -> float | None:
        v = row.get(key) if row else None
        return float(v) if v is not None and math.isfinite(v) and v > 0 else None

    keys = sorted(rows)
    series: dict[str, list] = {k: [] for k in (
        "x", "day", "timestamp", "basket_mid", "reference", "residual",
        "sell_gap", "buy_gap", "sell_size", "buy_size",
    )}
    for index, (day, timestamp) in enumerate(keys):
        group = rows[(day, timestamp)]
        basket = group.get(req.basket)
        legs = [(group.get(leg.product), leg.weight) for leg in req.components]
        mid = value(basket, "mid_price")
        mids = [value(row, "mid_price") for row, _ in legs]
        reference = req.offset + sum(m * leg.weight for m, leg in zip(mids, req.components, strict=True)
                                     if m is not None) if all(m is not None for m in mids) else None
        residual = mid - reference if mid is not None and reference is not None else None
        output = dict(x=index, day=day, timestamp=timestamp, basket_mid=mid,
                      reference=reference, residual=residual)
        for direction, side, other in (("sell", "bid", "ask"), ("buy", "ask", "bid")):
            price = value(basket, f"{side}_price_1")
            depth = value(basket, f"{side}_volume_1")
            leg_prices = [value(row, f"{other}_price_1") for row, _ in legs]
            leg_depths = [value(row, f"{other}_volume_1") for row, _ in legs]
            available = price is not None and depth is not None and all(
                v is not None for v in leg_prices + leg_depths)
            gap, size = None, None
            if available:
                assert price is not None and depth is not None
                total = sum(p * leg.weight for p, leg in zip(leg_prices, req.components, strict=True)
                            if p is not None)
                gap = price - total if direction == "sell" else total - price
                size = math.floor(min([depth] + [d / leg.weight for d, leg in
                    zip(leg_depths, req.components, strict=True) if d is not None]))
            output[f"{direction}_gap"] = gap
            output[f"{direction}_size"] = size
        for key in series:
            series[key].append(output[key])

    valid = [v for v in series["residual"] if v is not None]
    warnings = ["Quoted gaps exclude fees, conversion rules and the reference offset. Positive does not mean guaranteed arbitrage."]
    if len(valid) < len(keys):
        warnings.append("Some snapshots lack a valid price for every leg; gaps are not forward-filled.")
    return {"request": req.model_dump(), "series": series, "warnings": warnings, "summary": {
        "snapshots": len(keys), "matched": len(valid), "missing": len(keys) - len(valid),
        "mean": statistics.mean(valid) if valid else None,
        "std": statistics.stdev(valid) if len(valid) > 1 else None,
        "above": sum(v > req.threshold for v in valid),
        "below": sum(v < -req.threshold for v in valid),
        "sell_opportunities": sum(g is not None and g > 0 and s is not None and s >= 1
            for g, s in zip(series["sell_gap"], series["sell_size"], strict=True)),
        "buy_opportunities": sum(g is not None and g > 0 and s is not None and s >= 1
            for g, s in zip(series["buy_gap"], series["buy_size"], strict=True)),
    }}
