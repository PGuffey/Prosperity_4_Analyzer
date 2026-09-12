import pytest

from pma.ingest.discover import discover_files, discover_seasons

pytestmark = pytest.mark.usefixtures("competition_sample")


def test_discover_seasons_finds_prosperity_4() -> None:
    assert "prosperity_4" in discover_seasons()


def test_discover_files_round_1() -> None:
    files = [f for f in discover_files("prosperity_4") if f.round == 1]
    days = sorted({f.day for f in files})
    assert days == [-2, -1, 0]
    kinds = {(f.round, f.day, f.kind) for f in files}
    for d in [-2, -1, 0]:
        assert (1, d, "prices") in kinds
        assert (1, d, "trades") in kinds
