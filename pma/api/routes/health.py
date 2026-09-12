from __future__ import annotations

from fastapi import APIRouter

from pma import __version__

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
