"""Customize displayed bids and asks; never generate executions."""
from __future__ import annotations

import csv
import io
import math
import uuid

import polars as pl
from pydantic import BaseModel, Field, model_validator

from pma.synthetic import library


class QuoteSettings(BaseModel):
    bid_distance: float = Field(default=1, ge=0, le=1e6, allow_inf_nan=False)
    ask_distance: float = Field(default=1, ge=0, le=1e6, allow_inf_nan=False)
    bid_size: int = Field(default=10, ge=1, le=100000, strict=True)
    ask_size: int = Field(default=10, ge=1, le=100000, strict=True)
    csv: str | None = Field(default=None, max_length=5_000_000)

    @model_validator(mode="after")
    def positive_spread(self) -> QuoteSettings:
        if self.csv is None and self.bid_distance + self.ask_distance <= 0:
            raise ValueError("At least one quote distance must be greater than zero")
        return self


def customize(frame: pl.DataFrame, settings: QuoteSettings) -> pl.DataFrame:
    """Apply offsets or explicit CSV rows; recompute mid from the resulting quotes."""
    rows = frame.to_dicts()
    edits = {}
    if settings.csv is not None:
        text = settings.csv.lstrip("\ufeff")
        if not text.strip() or len(text.encode()) > 5_000_000:
            raise ValueError("Provide a quote CSV no larger than 5 MB")
        reader = csv.DictReader(io.StringIO(text), delimiter=";" if ";" in text.splitlines()[0] else ",")
        columns = ["snapshot", "bid_price", "bid_size", "ask_price", "ask_size"]
        if set(reader.fieldnames or []) != set(columns) or len(reader.fieldnames or []) != len(columns):
            raise ValueError("CSV needs snapshot,bid_price,bid_size,ask_price,ask_size columns")
        for line, row in enumerate(reader, 2):
            try:
                index, bid, bv, ask, av = (int(row[k]) for k in columns)
                if None in row or not 0 <= index < len(rows) or index in edits or line > 100001:
                    raise ValueError()
                if not 0 < bid < ask <= 10**12 or not (1 <= bv <= 100000 and 1 <= av <= 100000):
                    raise ValueError()
                edits[index] = (bid, bv, ask, av)
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError(f"Invalid quote row {line}: use unique snapshot indexes, positive integer prices/sizes, and bid < ask") from exc
        if not edits:
            raise ValueError("Quote CSV contains no rows")
    else:
        for index, row in enumerate(rows):
            mid = row["mid_price"]
            if mid is None or not math.isfinite(mid):
                continue  # Do not invent a price anchor in a missing snapshot.
            bid, ask = math.floor(mid - settings.bid_distance), math.ceil(mid + settings.ask_distance)
            if not 0 < bid < ask <= 10**12:
                raise ValueError(f"Quote distances produce invalid prices at snapshot {index}")
            edits[index] = (bid, settings.bid_size, ask, settings.ask_size)
    if not edits:
        raise ValueError("No valid mid prices to customize")
    for index, (bid, bv, ask, av) in edits.items():
        rows[index].update(bid_price_1=bid, bid_volume_1=bv, ask_price_1=ask,
                           ask_volume_1=av, mid_price=(bid + ask) / 2)
    # Preserve column types and stored playback order (including shuffled days).
    return pl.DataFrame(rows, schema={**frame.schema, "mid_price": pl.Float64,
        "bid_price_1": pl.Float64, "ask_price_1": pl.Float64}, strict=False)


def create_variant(run_id: str, settings: QuoteSettings) -> dict:
    """Save a new book-only copy; do not carry a now-misaligned legacy trade tape."""
    manifest, frame = library.load_manifest(run_id), library.load_frame(run_id)
    if manifest is None or frame is None:
        raise ValueError("Synthetic dataset not found")
    changed = customize(frame, settings)
    return library.save(uuid.uuid4().hex[:12], name=f"{manifest['name']} · custom quotes",
        source=manifest["source"], generator=manifest["generator"]["name"],
        params=manifest["generator"]["params"], seed=manifest["generator"]["seed"],
        df=changed, source_stats=manifest["stats"]["source"], notes=manifest.get("notes"),
        quote_metadata={"parent_run_id": run_id, "mode": "csv" if settings.csv is not None else "distances",
                        **settings.model_dump(exclude={"csv"})})
