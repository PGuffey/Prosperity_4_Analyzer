"""SQLite-backed append-only log of every hypothesis test run."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from pma.core import paths

_DDL = """
CREATE TABLE IF NOT EXISTS hypothesis_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    hypothesis_hash TEXT NOT NULL,
    params TEXT NOT NULL,         -- JSON: indicator, op, threshold, horizon, indicator_params
    scope TEXT NOT NULL,          -- JSON: season, round, days, products
    n_events INTEGER NOT NULL,
    sample_size INTEGER NOT NULL,
    hit_rate REAL NOT NULL,
    mean REAL NOT NULL,
    ci_low REAL,
    ci_high REAL,
    warnings TEXT                 -- JSON list
);
CREATE INDEX IF NOT EXISTS idx_hyplog_created ON hypothesis_log(created_at);
CREATE INDEX IF NOT EXISTS idx_hyplog_hash    ON hypothesis_log(hypothesis_hash);
"""


def _db_path() -> Path:
    return paths.hypothesis_log_db()


def _conn() -> sqlite3.Connection:
    _db_path().parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(_db_path())
    con.row_factory = sqlite3.Row
    con.executescript(_DDL)
    return con


def append(request: dict, result: dict) -> int:
    """Record one test run. Returns new row id."""
    overall = result.get("overall", {})
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO hypothesis_log "
            "(created_at, hypothesis_hash, params, scope, n_events, sample_size, "
            " hit_rate, mean, ci_low, ci_high, warnings) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                datetime.now(UTC).isoformat(timespec="seconds"),
                result.get("hash", ""),
                json.dumps({
                    "indicator": request.get("indicator"),
                    "op": request.get("op"),
                    "threshold": request.get("threshold"),
                    "horizon": request.get("horizon"),
                    "indicator_params": request.get("indicator_params", {}),
                }),
                json.dumps({
                    "season": request.get("season"),
                    "round": request.get("round"),
                    "days": request.get("days", []),
                    "products": request.get("products", []),
                }),
                int(overall.get("count", 0)),
                int(overall.get("sample_size", 0)),
                float(overall.get("hit_rate", 0.0)),
                float(overall.get("mean", 0.0)),
                float(overall.get("ci_low", 0.0)),
                float(overall.get("ci_high", 0.0)),
                json.dumps(overall.get("warnings", [])),
            ),
        )
        return int(cur.lastrowid or 0)


def recent(limit: int = 20) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM hypothesis_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "created_at": r["created_at"],
                "hypothesis_hash": r["hypothesis_hash"],
                "params": json.loads(r["params"]),
                "scope": json.loads(r["scope"]),
                "n_events": r["n_events"],
                "sample_size": r["sample_size"],
                "hit_rate": r["hit_rate"],
                "mean": r["mean"],
                "ci_low": r["ci_low"],
                "ci_high": r["ci_high"],
                "warnings": json.loads(r["warnings"]) if r["warnings"] else [],
            })
        return out
