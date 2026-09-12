"""Pydantic models for the data model and metadata files."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DayCoverage(BaseModel):
    season: str
    round: int
    day: int
    prices_csv: str
    trades_csv: str
    n_price_rows: int | None = None
    n_trade_rows: int | None = None
    products: list[str] = Field(default_factory=list)


class RoundCoverage(BaseModel):
    season: str
    round: int
    days: list[int]
    products: list[str] = Field(default_factory=list)


class SeasonCoverage(BaseModel):
    season: str
    rounds: list[RoundCoverage]


class DatasetsManifest(BaseModel):
    """`metadata/datasets.json` — what data is available, indexed for the UI."""

    seasons: list[SeasonCoverage] = Field(default_factory=list)
    generated_at: str | None = None


class ProductMeta(BaseModel):
    """One row in `metadata/products.json`."""

    name: str
    season: str
    family: str | None = None
    rounds: list[int] = Field(default_factory=list)
    days: dict[int, list[int]] = Field(default_factory=dict)  # round -> days
    position_limit: int | None = None
    conversion_rule: dict | None = None  # season-specific; opaque blob


class ProductsManifest(BaseModel):
    products: list[ProductMeta] = Field(default_factory=list)


class ImportRecord(BaseModel):
    """`metadata/imports.json` — append-only audit log of ingest runs."""

    started_at: str
    finished_at: str
    season: str
    rounds: list[int]
    files_processed: int
    n_price_rows: int
    n_trade_rows: int
    status: Literal["ok", "partial", "failed"]
    notes: str | None = None


class ImportsLog(BaseModel):
    runs: list[ImportRecord] = Field(default_factory=list)
