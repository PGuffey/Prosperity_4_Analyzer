"""FastAPI app for the analyzer backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pma import __version__
from pma.api.routes import (
    baskets,
    datasets,
    health,
    hypothesis,
    prices,
    products,
    summary,
    synthetic,
    trades,
)

app = FastAPI(title="Prosperity Market Analyzer", version=__version__)

# Permissive CORS for local dev. Tighten before exposing beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(datasets.router)
app.include_router(products.router)
app.include_router(prices.router)
app.include_router(trades.router)
app.include_router(summary.router)
app.include_router(hypothesis.router)
app.include_router(synthetic.router)
app.include_router(baskets.router)
