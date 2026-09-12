from __future__ import annotations

from fastapi import APIRouter

from pma.core import manifest
from pma.core.schema import ProductsManifest

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("")
def list_products(season: str | None = None) -> ProductsManifest:
    m = manifest.load_products()
    if season:
        m.products = [p for p in m.products if p.season == season]
    return m
