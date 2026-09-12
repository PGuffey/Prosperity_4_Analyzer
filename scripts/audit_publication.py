"""Check release files without printing secret values; optionally export without Git history."""

from __future__ import annotations

import argparse
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = {
    ".gitignore", ".python-version", "README.md", "PUBLISHING.md",
    "SYNTHETIC_EXPORT.md", "pyproject.toml", "LICENSE", "LICENSE.md",
    "web/.gitignore", "web/index.html", "web/package.json", "web/pnpm-lock.yaml",
    "web/tsconfig.json", "web/vite.config.ts",
}
PUBLIC_DIRS = ("pma/", "tests/", "web/src/", "web/tests/", "scripts/")
PRIVATE_DIRS = ("data/", "metadata/", "workspaces/", ".claude/", ".codex/", ".agents/")
PRIVATE_DOCS = {
    "HANDOFF.md", "IMPLEMENTATION_DOCUMENT.md", "PROJECT_OVERVIEW_AND_ROADMAP.md",
    "BASKET_ANALYSIS_PLAN.md", "UI_GUIDE.md", "UI_POLISH_PLAN.md", "CHANGELOG.md",
    "PUBLICATION_AUDIT.md",
}
PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"),
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "GitHub token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"),
    "service key": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}"),
    "credential assignment": re.compile(
        rb'''(?i)(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']'''
    ),
    "personal home path": re.compile(rb"(?:[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+|/(?:Users|home)/[A-Za-z0-9._-]+)"),
}


def git(*args: str, data: bytes | None = None) -> bytes:
    """Use repository rules, without depending on a developer's global ignore file."""
    result = subprocess.run(
        ["git", "-c", "core.excludesFile=", *args], cwd=ROOT,
        input=data, capture_output=True, check=False,
    )
    if result.returncode not in (0, 1) or (result.returncode and args[0] != "check-ignore"):
        raise RuntimeError(f"Git command failed: {args[0]}")
    return result.stdout


def release_files() -> list[str]:
    """Exclude ignored files even if the old repository still tracks them."""
    names = set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode().split("\0")) - {""}
    ignored = set(git("check-ignore", "--no-index", "-z", "--stdin",
                      data="\0".join(sorted(names)).encode() + b"\0").decode().split("\0"))
    return sorted(name for name in names - ignored if (ROOT / name).is_file())


def findings(data: bytes) -> list[str]:
    """Report categories only; values must never appear in audit output."""
    return [label for label, pattern in PATTERNS.items() if pattern.search(data)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="Also inspect reachable Git blobs; old private files fail this check")
    parser.add_argument("--export", action="store_true", help="Write exports/public-source.zip, without .git or ignored files")
    args = parser.parse_args()
    names = release_files()
    errors = []
    for name in names:
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            errors.append(f"{name}: symlink/outside repository")
            continue
        if name not in PUBLIC_FILES and not name.startswith(PUBLIC_DIRS):
            errors.append(f"{name}: unexpected release path; review before adding to allowlist")
        errors.extend(f"{name}: {label}" for label in findings(path.read_bytes()))
    print(f"Reviewed {len(names)} release files (working tree, repository ignore rules, explicit path allowlist).")
    if args.history:
        objects = git("rev-list", "--objects", "--all").decode().splitlines()
        for entry in objects:
            oid, _, name = entry.partition(" ")
            if git("cat-file", "-t", oid).strip() != b"blob":
                continue
            if name.startswith(PRIVATE_DIRS) or name in PRIVATE_DOCS or name.endswith(".tsbuildinfo"):
                errors.append(f"history:{name}: excluded material remains in old history")
            errors.extend(f"history:{name}: {label}" for label in findings(git("cat-file", "blob", oid)))
    for error in errors:
        print(error)
    if errors:
        print("FAIL: review findings before publishing. No archive created.")
        return 1
    print("PASS: no pattern matches or unexpected release paths. Manual review is still required.")
    print("Old Git history is NOT included in an export. Do not push the old repository as the clean release.")
    if args.export:
        destination = ROOT / "exports" / "public-source.zip"
        if destination.parent.is_symlink():
            raise RuntimeError("Refusing a symlinked export directory")
        destination.parent.mkdir(exist_ok=True)
        # Exclusive creation protects a previously reviewed release archive.
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in names:
                archive.write(ROOT / name, name)
        print("Created exports/public-source.zip. Unpack into an empty folder for a NEW repository.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
