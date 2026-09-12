# Prosperity Market Analyzer

A local research workbench for the IMC Prosperity simulated trading competition.
Explore market data, investigate signals and compare synthetic scenarios without
turning the analysis workflow into a strategy backtester.

Independent community project; not affiliated with or endorsed by IMC.

## Features

- **Explorer:** price charts, optional indicators, synchronized zoom, order-book
  inspection, event-window statistics and a virtualized trade tape.
- **Signal Tests:** editable presets, conditional future-price responses,
  bootstrap intervals, product/day breakdowns and saved tests.
- **Baskets:** manually weighted relationships, synchronized comparison charts,
  residuals and displayed bid/ask gaps with available quoted size.
- **Synthetic:** five price-series transformations, comparison previews,
  customizable quoted bids/asks and limited CSV export for backtesting elsewhere.

Panel workspaces are resizable and scrollable. Layouts are saved in your browser.
Only the navigation stays visible when the page scrolls.

## Run locally

Requires Python 3.12+, Node.js 22+ and pnpm. Run commands from the repository root
unless noted otherwise.

```sh
python -m venv .venv
# Windows PowerShell:
.venv/Scripts/Activate.ps1
# macOS/Linux instead: source .venv/bin/activate
python -m pip install -e ".[dev]"
```

Install frontend dependencies:

```sh
cd web
pnpm install --frozen-lockfile
cd ..
```

### Competition data

If you want to use other data. Ensure its formatted like Prosperity data and place the CSVs in this layout:

```text
data/<season>/round_<N>/prices_round_<N>_day_<D>.csv
data/<season>/round_<N>/trades_round_<N>_day_<D>.csv
```

For example, the season folder can be `prosperity_4`. Then run:

```sh
pma ingest --all
```

This builds local Parquet files and metadata. Re-run ingestion when adding data;
use `--force` only when you intend to regenerate existing outputs.

Start two terminals:

```sh
# Terminal 1, repository root (Python environment activated)
pma serve
```

```sh
# Terminal 2
cd web
pnpm dev
```

Open <http://localhost:5173>. Vite forwards `/api` requests to the Python service
on port 8000. Keep the API on localhost: it is a personal, unauthenticated tool,
not a public multi-user service.

## Interpreting results

Prosperity's synthetic markets can contain deliberately persistent patterns.
The analyzer helps inspect those patterns; it does not guarantee future outcomes.
Signal results measure mid-price responses, not executed profits, fills or
end-of-event fair-value settlement. Selected days are processed in order, with
indicator history continuing across them; horizons count snapshots.

Basket quote gaps exclude conversion rules, costs and fill uncertainty. A positive
gap is not automatically a usable arbitrage. Synthetic quotes are displayed
liquidity, not executed trades. See [synthetic export limitations](SYNTHETIC_EXPORT.md).

## Development checks

```sh
python -m pytest -q
python -m ruff check pma tests
python -m mypy pma
python scripts/audit_publication.py
cd web
pnpm test
pnpm typecheck
pnpm build
```

The publication audit is a heuristic check, not a guarantee that no secret exists.
Review the release file list before publishing. See [publication notes](PUBLISHING.md).

## Structure

- `pma/`: Python ingestion, analysis, synthetic-data tools and FastAPI service.
- `web/`: React, TypeScript and Vite interface.
- `tests/` and `web/tests/`: regression tests and small test fixtures.
- `scripts/`: local publication checks and clean source export.

## GitHub Pages status

The current analyzer **cannot run on GitHub Pages alone**. Its Python service
performs ingestion, analysis and persistence. Being open source does not remove
that runtime requirement. A browser-only version would need those operations
moved into browser-compatible code with local file import/storage.

No live Pages deployment is configured. The full analyzer currently runs locally;
see [publication notes](PUBLISHING.md) for the browser-only migration outline.
