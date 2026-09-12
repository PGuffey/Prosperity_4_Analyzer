from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from pma.core import store

router = APIRouter(prefix="/api/prices", tags=["prices"])


@router.get("/range")
def prices_range(
    season: str,
    round: int,
    day: int,
    product: str,
    t_from: int | None = None,
    t_to: int | None = None,
    levels: bool = Query(False, description="Include L2 and L3 book levels."),
) -> dict[str, list]:
    try:
        return store.fetch_prices_range(
            season, round, day, product, t_from, t_to, include_levels_2_3=levels
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/orderbook")
def orderbook_at(
    season: str,
    round: int,
    day: int,
    product: str,
    t: int,
) -> dict:
    try:
        snap = store.fetch_orderbook_at(season, round, day, product, t)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if snap is None:
        raise HTTPException(status_code=404, detail="no snapshot at that timestamp")
    return snap
