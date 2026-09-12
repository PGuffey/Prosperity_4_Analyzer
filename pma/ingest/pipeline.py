"""End-to-end ingest: walk raw CSVs, validate, convert to Parquet, update manifests."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

import polars as pl

from pma.core import manifest, paths
from pma.core.schema import (
    DatasetsManifest,
    ImportRecord,
    ProductMeta,
    ProductsManifest,
    RoundCoverage,
    SeasonCoverage,
)
from pma.ingest import csv_loader, parquet_writer, validate
from pma.ingest.discover import RawFile, discover_files, discover_seasons


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def ingest_season(season: str, *, force: bool = False) -> ImportRecord:
    """Ingest all raw CSVs for a season. Skips files whose Parquet output exists unless `force`."""
    started_at = _now()
    files = discover_files(season)
    if not files:
        return ImportRecord(
            started_at=started_at,
            finished_at=_now(),
            season=season,
            rounds=[],
            files_processed=0,
            n_price_rows=0,
            n_trade_rows=0,
            status="failed",
            notes=f"no raw files under data/{season}/",
        )

    # group by (round, day) so we can pair prices+trades for cross-validation
    grouped: dict[tuple[int, int], dict[str, RawFile]] = defaultdict(dict)
    for f in files:
        grouped[(f.round, f.day)][f.kind] = f

    rounds_seen: set[int] = set()
    n_price_rows = 0
    n_trade_rows = 0
    files_processed = 0
    notes: list[str] = []

    # season-wide product coverage
    product_rounds: dict[str, set[int]] = defaultdict(set)
    product_days: dict[str, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))

    # datasets manifest accumulator
    days_by_round: dict[int, set[int]] = defaultdict(set)
    products_by_round: dict[int, set[str]] = defaultdict(set)

    for (round_n, day), kinds in sorted(grouped.items()):
        rounds_seen.add(round_n)
        days_by_round[round_n].add(day)

        prices_df: pl.DataFrame | None = None
        trades_df: pl.DataFrame | None = None

        if pf := kinds.get("prices"):
            out = paths.processed_prices_dir(season, round_n, day) / "data.parquet"
            if out.exists() and not force:
                notes.append(f"skip (exists): {pf.path.name}")
            else:
                prices_df = csv_loader.load_prices(pf.path)
                for sev, msg in validate.validate_prices(prices_df):
                    notes.append(f"[{sev}] {pf.path.name}: {msg}")
                parquet_writer.write_prices(prices_df, season, round_n, day)
                n_price_rows += prices_df.height
                files_processed += 1
            # always update products coverage from CSV (cheap; reload if needed)
            if prices_df is None:
                prices_df = csv_loader.load_prices(pf.path)
            for prod in prices_df.get_column("product").unique().to_list():
                product_rounds[prod].add(round_n)
                product_days[prod][round_n].add(day)
                products_by_round[round_n].add(prod)

        if tf := kinds.get("trades"):
            out = paths.processed_trades_dir(season, round_n, day) / "data.parquet"
            if out.exists() and not force:
                notes.append(f"skip (exists): {tf.path.name}")
            else:
                trades_df = csv_loader.load_trades(tf.path)
                for sev, msg in validate.validate_trades(trades_df, prices_df):
                    notes.append(f"[{sev}] {tf.path.name}: {msg}")
                parquet_writer.write_trades(trades_df, season, round_n, day)
                n_trade_rows += trades_df.height
                files_processed += 1

    _update_datasets_manifest(season, days_by_round, products_by_round)
    _update_products_manifest(season, product_rounds, product_days)

    return ImportRecord(
        started_at=started_at,
        finished_at=_now(),
        season=season,
        rounds=sorted(rounds_seen),
        files_processed=files_processed,
        n_price_rows=n_price_rows,
        n_trade_rows=n_trade_rows,
        status="ok",
        notes="\n".join(notes) if notes else None,
    )


def _update_datasets_manifest(
    season: str,
    days_by_round: dict[int, set[int]],
    products_by_round: dict[int, set[str]],
) -> None:
    manifest_m: DatasetsManifest = manifest.load_datasets()
    # remove any existing entry for this season
    manifest_m.seasons = [s for s in manifest_m.seasons if s.season != season]
    rounds = [
        RoundCoverage(
            season=season,
            round=r,
            days=sorted(days_by_round[r]),
            products=sorted(products_by_round.get(r, set())),
        )
        for r in sorted(days_by_round)
    ]
    manifest_m.seasons.append(SeasonCoverage(season=season, rounds=rounds))
    manifest_m.generated_at = _now()
    manifest.save_datasets(manifest_m)


def _update_products_manifest(
    season: str,
    product_rounds: dict[str, set[int]],
    product_days: dict[str, dict[int, set[int]]],
) -> None:
    products_m: ProductsManifest = manifest.load_products()
    # drop existing entries for this season; re-add fresh
    products_m.products = [p for p in products_m.products if p.season != season]
    for name in sorted(product_rounds):
        products_m.products.append(
            ProductMeta(
                name=name,
                season=season,
                rounds=sorted(product_rounds[name]),
                days={r: sorted(days) for r, days in product_days[name].items()},
            )
        )
    manifest.save_products(products_m)


def ingest_all(*, force: bool = False) -> list[ImportRecord]:
    return [ingest_season(s, force=force) for s in discover_seasons()]


def append_import_record(rec: ImportRecord) -> None:
    log = manifest.load_imports()
    log.runs.append(rec)
    manifest.save_imports(log)
