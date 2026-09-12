from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pma.analysis import hypothesis as engine
from pma.analysis import hypothesis_log, saved_hypotheses

router = APIRouter(prefix="/api/hypothesis", tags=["hypothesis"])


class HypothesisBody(BaseModel):
    season: str
    round: int
    days: list[int] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    indicator: str
    op: Literal[">", ">=", "<", "<="]
    threshold: float = Field(allow_inf_nan=False)
    horizon: int = Field(ge=1, le=1_000_000)
    indicator_params: dict = Field(default_factory=dict)
    bootstrap_iters: int = Field(default=1000, ge=1, le=10_000)
    seed: int = Field(default=0, ge=0)
    synthetic_id: str | None = None


class SaveBody(BaseModel):
    name: str
    hypothesis: HypothesisBody
    overwrite_slug: str | None = None


@router.post("/test")
def test_hypothesis(body: HypothesisBody) -> dict:
    # Synthetic runs derive days/products from the dataset itself; for real
    # runs, both are required.
    if body.synthetic_id is None and (not body.days or not body.products):
        raise HTTPException(status_code=400, detail="days and products must be non-empty")
    try:
        req = engine.HypothesisRequest(
            season=body.season,
            round=body.round,
            days=body.days,
            products=body.products,
            indicator=body.indicator,
            op=body.op,
            threshold=body.threshold,
            horizon=body.horizon,
            indicator_params=body.indicator_params,
            bootstrap_iters=body.bootstrap_iters,
            seed=body.seed,
            synthetic_id=body.synthetic_id,
        )
        result = engine.run_hypothesis(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Auto-log every test run (best-effort; don't fail the request on log errors).
    try:
        hypothesis_log.append(body.model_dump(), result)
    except Exception:
        logging.getLogger(__name__).exception("Could not save hypothesis run to history")
        result["overall"]["warnings"].append("Run completed, but could not be saved to history.")
    return result


@router.get("")
def list_saved() -> list[dict]:
    return saved_hypotheses.list_all()


@router.get("/{slug}")
def load_saved(slug: str) -> dict:
    doc = saved_hypotheses.load(slug)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"no saved hypothesis: {slug}")
    return doc


@router.post("")
def save_hypothesis(body: SaveBody) -> dict:
    return saved_hypotheses.save(
        body.name, body.hypothesis.model_dump(), overwrite_slug=body.overwrite_slug
    )


@router.delete("/{slug}")
def delete_saved(slug: str) -> dict:
    ok = saved_hypotheses.delete(slug)
    if not ok:
        raise HTTPException(status_code=404, detail=f"no saved hypothesis: {slug}")
    return {"deleted": slug}


@router.get("/log/recent")
def recent_log(limit: int = 20) -> list[dict]:
    return hypothesis_log.recent(limit=max(1, min(200, limit)))
