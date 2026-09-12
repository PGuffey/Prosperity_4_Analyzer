"""Read-only basket relationship analysis."""
from fastapi import APIRouter, HTTPException

from pma.analysis.baskets import BasketRequest, analyze

router = APIRouter(prefix="/api/baskets", tags=["baskets"])


@router.post("/analyze")
def analyze_basket(body: BasketRequest) -> dict:
    try:
        return analyze(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
