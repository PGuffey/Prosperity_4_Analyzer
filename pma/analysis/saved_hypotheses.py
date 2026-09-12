"""JSON-file CRUD for saved hypotheses.

One file per hypothesis under `workspaces/saved_hypotheses/<slug>.json`.
Hand-editable; the API just reads and writes.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from pma.core import paths

_SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _dir() -> Path:
    d = paths.workspaces_root() / "saved_hypotheses"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    s = s[:64] if s else "hypothesis"
    if not _SLUG_OK.match(s):
        s = "hypothesis"
    return s


def _path(slug: str) -> Path:
    if not _SLUG_OK.match(slug):
        raise ValueError(f"invalid slug: {slug!r}")
    return _dir() / f"{slug}.json"


def list_all() -> list[dict]:
    out: list[dict] = []
    for f in sorted(_dir().glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
            doc["slug"] = f.stem
            out.append(doc)
        except (json.JSONDecodeError, OSError):
            continue
    return out


def load(slug: str) -> dict | None:
    p = _path(slug)
    if not p.exists():
        return None
    doc = json.loads(p.read_text(encoding="utf-8"))
    doc["slug"] = slug
    return doc


def save(name: str, hypothesis: dict, *, overwrite_slug: str | None = None) -> dict:
    slug = overwrite_slug or _slugify(name)
    # Make sure a fresh save doesn't collide with an existing slug.
    if not overwrite_slug:
        i = 1
        base = slug
        while _path(slug).exists():
            i += 1
            suffix = f"-{i}"
            slug = f"{base[:64 - len(suffix)]}{suffix}"
    doc = {
        "name": name,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "hypothesis": hypothesis,
    }
    _path(slug).write_text(json.dumps(doc, indent=2), encoding="utf-8")
    doc["slug"] = slug
    return doc


def delete(slug: str) -> bool:
    p = _path(slug)
    if not p.exists():
        return False
    p.unlink()
    return True
