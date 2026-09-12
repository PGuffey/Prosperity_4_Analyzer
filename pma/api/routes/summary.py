from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pma.core import store

router = APIRouter(prefix="/api/summary", tags=["summary"])


@router.get("/day")
def day_summary(season: str, round: int, day: int, product: str) -> dict:
    try:
        return store.fetch_day_summary(season, round, day, product)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
