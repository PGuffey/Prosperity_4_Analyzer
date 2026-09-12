"""Filesystem layout. Single source of truth for project paths.

Layout (relative to project root):
    data/<season>/round_<N>/{prices,trades}_round_<N>_day_<D>.csv     raw
    data/processed/<season>/{prices,trades}/season=.../round=.../day=.../data.parquet
    data/processed/synthetic/<run_id>/{prices,trades,manifest.json}
    metadata/{datasets,products,imports}.json
    workspaces/{saved_views,saved_hypotheses,saved_signals}/
    workspaces/hypothesis_log.sqlite
"""

from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    env = os.environ.get("PMA_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[2]


def raw_root() -> Path:
    return project_root() / "data"


def processed_root() -> Path:
    return project_root() / "data" / "processed"


def synthetic_root() -> Path:
    return processed_root() / "synthetic"


def metadata_root() -> Path:
    return project_root() / "metadata"


def workspaces_root() -> Path:
    return project_root() / "workspaces"


def season_dir(season: str) -> Path:
    return raw_root() / season


def round_dir(season: str, round_n: int) -> Path:
    return season_dir(season) / f"round_{round_n}"


def processed_prices_dir(season: str, round_n: int, day: int) -> Path:
    return (
        processed_root()
        / season
        / "prices"
        / f"season={season}"
        / f"round={round_n}"
        / f"day={day}"
    )


def processed_trades_dir(season: str, round_n: int, day: int) -> Path:
    return (
        processed_root()
        / season
        / "trades"
        / f"season={season}"
        / f"round={round_n}"
        / f"day={day}"
    )


def hypothesis_log_db() -> Path:
    return workspaces_root() / "hypothesis_log.sqlite"


def ensure_dirs() -> None:
    """Create the directory tree if it doesn't exist."""
    for p in [
        processed_root(),
        synthetic_root(),
        metadata_root(),
        workspaces_root(),
        workspaces_root() / "saved_views",
        workspaces_root() / "saved_hypotheses",
        workspaces_root() / "saved_signals",
    ]:
        p.mkdir(parents=True, exist_ok=True)
