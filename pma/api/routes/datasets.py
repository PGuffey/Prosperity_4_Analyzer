from __future__ import annotations

from fastapi import APIRouter

from pma.core import manifest
from pma.core.schema import DatasetsManifest

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("")
def list_datasets() -> DatasetsManifest:
    return manifest.load_datasets()
