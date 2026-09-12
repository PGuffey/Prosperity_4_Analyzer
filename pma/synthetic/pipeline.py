"""Orchestrate a generator run: load source → run generator → persist."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import polars as pl

from pma.core import store
from pma.synthetic import library
from pma.synthetic.generators import GENERATOR_METADATA, GENERATORS


@dataclass
class GenerateRequest:
    season: str
    round: int
    days: list[int]
    product: str
    generator: str
    params: dict = field(default_factory=dict)
    seed: int = 0
    name: str | None = None
    notes: str | None = None


def generate(req: GenerateRequest) -> dict:
    if req.generator not in GENERATORS:
        raise ValueError(f"unknown generator: {req.generator!r}")
    if not req.days or not req.product:
        raise ValueError("days and product are required")
    if req.seed < 0:
        raise ValueError("seed must be non-negative")
    for key, value in req.params.items():
        spec = GENERATOR_METADATA[req.generator]["params"].get(key)
        if spec is None:
            raise ValueError(f"unknown generator parameter: {key}")
        kind = spec["type"]
        if kind == "enum" and value not in spec["options"]:
            raise ValueError(f"{key} must be one of {spec['options']}")
        if kind == "bool" and not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
        if kind in ("int", "float"):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{key} must be a finite number")
            if kind == "int" and (not isinstance(value, int) or value > 100_000):
                raise ValueError(f"{key} must be a whole number no greater than 100000")
            if value < spec.get("min", 0):
                raise ValueError(f"{key} must be at least {spec.get('min', 0)}")

    fn = GENERATORS[req.generator]
    source_frame = store.fetch_prices_frame(
        req.season, req.round, req.days, [req.product]
    )
    if source_frame.is_empty():
        raise ValueError("no source data for that (season, round, days, product)")

    source_stats = library.compute_stats(source_frame)
    synthetic = fn(source_frame, req.params, req.seed)
    synthetic = synthetic.with_columns(pl.col(pl.Float64).fill_nan(None))
    for column in ("mid_price", "bid_price_1", "ask_price_1"):
        if synthetic[column].is_infinite().any():
            raise ValueError("generated prices overflowed; use a smaller parameter value")

    source_dict = {
        "season": req.season,
        "round": req.round,
        "days": sorted(req.days),
        "product": req.product,
    }
    run_id = library.make_run_id(source_dict, req.generator, req.params, req.seed)
    name = req.name or f"{req.generator} · {req.product} · R{req.round}"
    return library.save(
        run_id,
        name=name,
        source=source_dict,
        generator=req.generator,
        params=req.params,
        seed=req.seed,
        df=synthetic,
        source_stats=source_stats,
        notes=req.notes,
    )
