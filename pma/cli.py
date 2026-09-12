"""Typer CLI: `pma <command>`."""

from __future__ import annotations

import typer

from pma.core import paths
from pma.ingest import discover, pipeline

app = typer.Typer(no_args_is_help=True, help="Prosperity Market Analyzer.")


@app.command()
def ingest(
    season: str | None = typer.Option(
        None, "--season", "-s", help="Season to ingest, e.g. prosperity_4."
    ),
    all_: bool = typer.Option(
        False, "--all", help="Ingest every season present under data/."
    ),
    force: bool = typer.Option(
        False, "--force", help="Re-write Parquet even if outputs exist."
    ),
) -> None:
    """CSV → Parquet for a season (or all seasons)."""
    paths.ensure_dirs()
    if all_:
        records = pipeline.ingest_all(force=force)
        for rec in records:
            pipeline.append_import_record(rec)
            _print_record(rec)
        return
    if season is None:
        typer.echo("Must pass --season SEASON or --all.", err=True)
        raise typer.Exit(code=2)
    rec = pipeline.ingest_season(season, force=force)
    pipeline.append_import_record(rec)
    _print_record(rec)


@app.command()
def list_seasons() -> None:
    """List seasons available under data/."""
    seasons = discover.discover_seasons()
    if not seasons:
        typer.echo("(no seasons found under data/)")
        return
    for s in seasons:
        typer.echo(s)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1"),
    port: int = typer.Option(8000),
    reload: bool = typer.Option(True, "--reload/--no-reload"),
) -> None:
    """Run the FastAPI dev server."""
    import uvicorn

    uvicorn.run("pma.api.main:app", host=host, port=port, reload=reload)


def _print_record(rec) -> None:
    typer.echo(
        f"[{rec.status}] {rec.season}: rounds={rec.rounds} "
        f"files={rec.files_processed} prices={rec.n_price_rows:,} trades={rec.n_trade_rows:,}"
    )
    if rec.notes:
        for line in rec.notes.splitlines():
            typer.echo(f"  {line}")


if __name__ == "__main__":
    app()
