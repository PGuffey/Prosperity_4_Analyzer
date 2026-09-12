"""On-disk storage for synthetic datasets.

Layout:
    data/processed/synthetic/<run_id>/
        manifest.json
        prices.parquet
        trades.parquet  (optional market prints indexed by playback snapshot)

`run_id` is a short hash of scope, generator parameters, and seed. Regeneration
replaces the same run's files; it is not a fingerprint of source-file contents.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from pma.core import paths

_ID_OK = re.compile(r"^[a-z0-9_-]{6,32}$")


def _root() -> Path:
    p = paths.synthetic_root()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _run_dir(run_id: str) -> Path:
    if not _ID_OK.match(run_id):
        raise ValueError(f"invalid run_id: {run_id!r}")
    return _root() / run_id


def make_run_id(source: dict, generator: str, params: dict, seed: int) -> str:
    blob = {
        "source": {
            "season": source.get("season"),
            "round": source.get("round"),
            "days": sorted(source.get("days", [])),
            "product": source.get("product"),
        },
        "generator": generator,
        "params": params,
        "seed": seed,
    }
    h = hashlib.sha256(json.dumps(blob, sort_keys=True).encode()).hexdigest()
    return h[:12]


def compute_stats(df: pl.DataFrame) -> dict[str, float]:
    mid = df.get_column("mid_price").to_numpy().astype(float)
    finite = mid[np.isfinite(mid)]
    if finite.size == 0:
        return {"mid_mean": 0.0, "mid_std": 0.0, "mid_min": 0.0, "mid_max": 0.0, "autocorr_lag1": 0.0}
    if finite.size > 1:
        # Lag-1 autocorrelation of returns; defensive against constant series.
        ret = np.diff(finite)
        if ret.size >= 3 and np.std(ret[:-1]) > 0 and np.std(ret[1:]) > 0:
            ac = float(np.corrcoef(ret[:-1], ret[1:])[0, 1])
        else:
            ac = 0.0
    else:
        ac = 0.0
    return {
        "mid_mean": float(np.mean(finite)),
        "mid_std": float(np.std(finite)),
        "mid_min": float(np.min(finite)),
        "mid_max": float(np.max(finite)),
        "autocorr_lag1": ac,
    }


def save(
    run_id: str,
    *,
    name: str,
    source: dict,
    generator: str,
    params: dict,
    seed: int,
    df: pl.DataFrame,
    source_stats: dict,
    notes: str | None = None,
    trades: pl.DataFrame | None = None,
    trade_metadata: dict | None = None,
    quote_metadata: dict | None = None,
) -> dict[str, Any]:
    """Persist the synthetic frame and its manifest. Overwrites if `run_id` exists."""
    out_dir = _run_dir(run_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    df.write_parquet(out_dir / "prices.parquet", compression="zstd")
    if trades is not None:
        trades.write_parquet(out_dir / "trades.parquet", compression="zstd")

    manifest = {
        "run_id": run_id,
        "name": name,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": source,
        "generator": {"name": generator, "params": params, "seed": seed},
        "n_snapshots": df.height,
        "stats": {
            "source": source_stats,
            "synthetic": compute_stats(df),
        },
        "notes": notes,
        "quotes": quote_metadata,
        "trades": {"count": trades.height if trades is not None else 0,
                   "mode": "none", **(trade_metadata or {})},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def list_all() -> list[dict]:
    """List every synthetic dataset's manifest, newest first."""
    out: list[dict] = []
    if not _root().exists():
        return out
    for run_dir in _root().iterdir():
        if not run_dir.is_dir():
            continue
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            out.append(json.loads(manifest_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    out.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return out


def load_manifest(run_id: str) -> dict | None:
    p = _run_dir(run_id) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_frame(run_id: str) -> pl.DataFrame | None:
    p = _run_dir(run_id) / "prices.parquet"
    if not p.exists():
        return None
    return pl.read_parquet(p)


def delete(run_id: str) -> bool:
    d = _run_dir(run_id)
    if not d.exists():
        return False
    shutil.rmtree(d)
    return True


def load_trades(run_id: str) -> pl.DataFrame:
    """Old price-only scenarios have an empty tape, not missing fabricated trades."""
    from pma.synthetic.trade_data import empty_trades

    manifest = load_manifest(run_id)
    path = _run_dir(run_id) / "trades.parquet"
    if not manifest or manifest.get("trades", {}).get("mode", "none") == "none" or not path.exists():
        return empty_trades()
    return pl.read_parquet(path)
