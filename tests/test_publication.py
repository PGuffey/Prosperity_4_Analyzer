"""Publication scans report categories, not credential values."""

from scripts import audit_publication
from scripts.audit_publication import findings, release_files


def test_detects_credentials_without_echoing_values():
    fake = ("ghp_" + "x" * 36).encode()
    assert findings(fake) == ["GitHub token"]
    assert "personal home path" in findings(("C:" + "/Users/" + "example/project").encode())
    assert findings(b"ordinary public documentation") == []


def test_release_excludes_private_paths_even_when_tracked(tmp_path, monkeypatch):
    # Simulate Git's tracked/untracked list and ignore lookup without needing .git.
    monkeypatch.setattr(audit_publication, "ROOT", tmp_path)
    for name in ["README.md", "HANDOFF.md"]:
        (tmp_path / name).touch()
    def fake_git(*args, **kwargs):
        return b"README.md\0HANDOFF.md\0" if args[0] == "ls-files" else b"HANDOFF.md\0"
    monkeypatch.setattr(audit_publication, "git", fake_git)
    names = release_files()
    assert names == ["README.md"]
