from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pma.core import store

router = APIRouter(prefix="/api/trades", tags=["trades"])


@router.get("/range")
def trades_range(
    season: str,
    round: int,
    day: int,
    product: str,
    t_from: int | None = None,
    t_to: int | None = None,
) -> dict[str, list]:
    try:
        return store.fetch_trades_range(season, round, day, product, t_from, t_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
