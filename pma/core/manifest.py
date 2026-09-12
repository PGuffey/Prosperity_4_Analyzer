"""Read and write the JSON manifests under `metadata/`."""

from __future__ import annotations

from pathlib import Path

from pma.core import paths
from pma.core.schema import DatasetsManifest, ImportsLog, ProductsManifest


def _load(path: Path, model_cls):
    if not path.exists():
        return model_cls()
    return model_cls.model_validate_json(path.read_text(encoding="utf-8"))


def _save(path: Path, model) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(model.model_dump_json(indent=2), encoding="utf-8")


def datasets_path() -> Path:
    return paths.metadata_root() / "datasets.json"


def products_path() -> Path:
    return paths.metadata_root() / "products.json"


def imports_path() -> Path:
    return paths.metadata_root() / "imports.json"


def load_datasets() -> DatasetsManifest:
    return _load(datasets_path(), DatasetsManifest)


def save_datasets(m: DatasetsManifest) -> None:
    _save(datasets_path(), m)


def load_products() -> ProductsManifest:
    return _load(products_path(), ProductsManifest)


def save_products(m: ProductsManifest) -> None:
    _save(products_path(), m)


def load_imports() -> ImportsLog:
    return _load(imports_path(), ImportsLog)


def save_imports(m: ImportsLog) -> None:
    _save(imports_path(), m)
