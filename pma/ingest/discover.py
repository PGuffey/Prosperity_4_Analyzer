"""Walk `data/<season>/round_<N>/` and discover available raw CSV files."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from pma.core import paths

_PRICE_FILE = re.compile(r"^prices_round_(?P<round>-?\d+)_day_(?P<day>-?\d+)\.csv$")
_TRADE_FILE = re.compile(r"^trades_round_(?P<round>-?\d+)_day_(?P<day>-?\d+)\.csv$")


@dataclass(frozen=True, slots=True)
class RawFile:
    season: str
    round: int
    day: int
    kind: str  # "prices" or "trades"
    path: Path


def discover_seasons() -> list[str]:
    """Return season directories present under `data/` (excluding `processed`)."""
    root = paths.raw_root()
    if not root.exists():
        return []
    return sorted(
        p.name for p in root.iterdir() if p.is_dir() and p.name != "processed"
    )


def discover_files(season: str) -> list[RawFile]:
    """Return all raw CSV files for a season, sorted by (round, day, kind)."""
    season_dir = paths.season_dir(season)
    if not season_dir.exists():
        return []

    found: list[RawFile] = []
    for round_dir in sorted(season_dir.iterdir()):
        if not round_dir.is_dir() or not round_dir.name.startswith("round_"):
            continue
        for csv in sorted(round_dir.iterdir()):
            if not csv.is_file() or csv.suffix != ".csv":
                continue
            if m := _PRICE_FILE.match(csv.name):
                found.append(
                    RawFile(
                        season=season,
                        round=int(m["round"]),
                        day=int(m["day"]),
                        kind="prices",
                        path=csv,
                    )
                )
            elif m := _TRADE_FILE.match(csv.name):
                found.append(
                    RawFile(
                        season=season,
                        round=int(m["round"]),
                        day=int(m["day"]),
                        kind="trades",
                        path=csv,
                    )
                )

    return sorted(found, key=lambda r: (r.round, r.day, r.kind))
