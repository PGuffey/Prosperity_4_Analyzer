from __future__ import annotations

import csv

import polars as pl
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from pma.synthetic import library, pipeline, quotes, trade_data
from pma.synthetic.generators import GENERATOR_METADATA

router = APIRouter(prefix="/api/synthetic", tags=["synthetic"])


@router.post("/{run_id}/quotes")
def create_quote_variant(run_id: str, body: quotes.QuoteSettings) -> dict:
    try:
        return quotes.create_variant(run_id, body)
    except (ValueError, csv.Error, pl.exceptions.PolarsError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class TradeBody(BaseModel):
    probability: float = Field(default=0.2, ge=0, le=1, allow_inf_nan=False)
    buy_probability: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)
    max_quantity: int = Field(default=5, ge=1, le=100000, strict=True)
    seed: int = Field(default=0, ge=0)
    csv: str | None = Field(default=None, max_length=5_000_000)


@router.post("/{run_id}/trades")
def create_trade_variant(run_id: str, body: TradeBody) -> dict:
    try:
        frame = library.load_frame(run_id)
        if frame is None:
            raise ValueError("Synthetic dataset not found")
        if body.csv is not None:
            trades = trade_data.import_trades(body.csv, frame)
            metadata = {"mode": "custom"}
        else:
            trades = trade_data.generate_trades(frame, body.probability, body.buy_probability, body.max_quantity, body.seed)
            metadata = {"mode": "generated", **body.model_dump(exclude={"csv"})}
        return trade_data.save_variant(run_id, trades, metadata)
    except (ValueError, csv.Error, pl.exceptions.PolarsError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{run_id}/trades")
def get_trade_preview(run_id: str) -> dict:
    try:
        if library.load_manifest(run_id) is None:
            raise ValueError("Synthetic dataset not found")
        trades = library.load_trades(run_id)
        return {"count": trades.height, "rows": trades.head(100).to_dicts()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{run_id}/export")
def export_synthetic(run_id: str) -> Response:
    try:
        data = trade_data.export_bundle(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="synthetic-{run_id}.zip"'})


class GenerateBody(BaseModel):
    season: str
    round: int
    days: list[int] = Field(default_factory=list)
    product: str
    generator: str
    params: dict = Field(default_factory=dict)
    seed: int = 0
    name: str | None = None
    notes: str | None = None


@router.get("/generators")
def list_generators() -> dict[str, dict]:
    return GENERATOR_METADATA


@router.post("/generate")
def generate(body: GenerateBody) -> dict:
    try:
        req = pipeline.GenerateRequest(
            season=body.season,
            round=body.round,
            days=body.days,
            product=body.product,
            generator=body.generator,
            params=body.params,
            seed=body.seed,
            name=body.name,
            notes=body.notes,
        )
        return pipeline.generate(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("")
def list_synthetic() -> list[dict]:
    return library.list_all()


@router.get("/{run_id}/manifest")
def get_manifest(run_id: str) -> dict:
    try:
        m = library.load_manifest(run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if m is None:
        raise HTTPException(status_code=404, detail=f"no synthetic dataset: {run_id}")
    return m


@router.get("/{run_id}/prices")
def get_prices(run_id: str) -> dict[str, list]:
    try:
        df = library.load_frame(run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if df is None:
        raise HTTPException(status_code=404, detail=f"no synthetic dataset: {run_id}")
    cols = ["timestamp", "mid_price", "bid_price_1", "bid_volume_1", "ask_price_1", "ask_volume_1"]
    df = df.with_columns(pl.col(pl.Float64).fill_nan(None))
    return {c: df.get_column(c).to_list() for c in cols if c in df.columns}


@router.delete("/{run_id}")
def delete_synthetic(run_id: str) -> dict:
    try:
        ok = library.delete(run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail=f"no synthetic dataset: {run_id}")
    return {"deleted": run_id}
