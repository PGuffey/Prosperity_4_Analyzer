"""Optional market-trade scenarios and portable CSV bundles, not strategy fills."""
from __future__ import annotations

import csv
import io
import json
import math
import re
import uuid
import zipfile

import numpy as np
import polars as pl

from pma.synthetic import library

SCHEMA = {"snapshot": pl.Int64, "price": pl.Int64, "quantity": pl.Int64,
          "buyer": pl.String, "seller": pl.String}


def empty_trades() -> pl.DataFrame:
    return pl.DataFrame(schema=SCHEMA)


def quote(row: dict, side: str) -> tuple[int, int] | None:
    """Round bids down and asks up to whole ticks; never invent absent liquidity."""
    price, volume = row.get(f"{side}_price_1"), row.get(f"{side}_volume_1")
    if price is None or volume is None or not math.isfinite(price) or not math.isfinite(volume):
        return None
    price = math.floor(price) if side == "bid" else math.ceil(price)
    volume = math.floor(volume)
    return (price, volume) if 0 < price <= 10**12 and 0 < volume <= 10**9 else None


def generate_trades(frame: pl.DataFrame, probability: float, buy_probability: float,
                    max_quantity: int, seed: int) -> pl.DataFrame:
    """At most one sampled print per snapshot; depth is a cap, not a queue model."""
    if not all(math.isfinite(p) and 0 <= p <= 1 for p in (probability, buy_probability)):
        raise ValueError("Trade probabilities must be between zero and one")
    if isinstance(max_quantity, bool) or not isinstance(max_quantity, int) or not 1 <= max_quantity <= 100000:
        raise ValueError("Maximum quantity must be a whole number between 1 and 100000")
    if seed < 0:
        raise ValueError("Seed must be non-negative")
    rng = np.random.default_rng(seed)
    rows = []
    for index, row in enumerate(frame.iter_rows(named=True)):
        if rng.random() >= probability:
            continue
        buy = rng.random() < buy_probability
        book = quote(row, "ask" if buy else "bid")
        if book is None:
            continue
        price, depth = book
        rows.append({"snapshot": index, "price": price,
                     "quantity": int(rng.integers(1, min(depth, max_quantity) + 1)),
                     "buyer": "SYN_BUYER" if buy else "SYN_MAKER",
                     "seller": "SYN_MAKER" if buy else "SYN_SELLER"})
    return pl.DataFrame(rows, schema=SCHEMA) if rows else empty_trades()


def import_trades(text: str, frame: pl.DataFrame) -> pl.DataFrame:
    """Custom prints use playback snapshot indexes, unambiguous even after day shuffling."""
    if len(text.encode("utf-8")) > 5_000_000:
        raise ValueError("Trade CSV must be at most 5 MB")
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")), delimiter=";" if ";" in text.splitlines()[0] else ",") if text.strip() else None
    if reader is None or not {"snapshot", "price", "quantity"}.issubset(reader.fieldnames or []):
        raise ValueError("CSV needs snapshot,price,quantity columns; buyer and seller are optional")
    fields = reader.fieldnames or []
    if len(set(fields)) != len(fields):
        raise ValueError("CSV column names must not be repeated")
    rows = []
    for line, row in enumerate(reader, 2):
        if line > 100001:
            raise ValueError("Trade CSV must contain at most 100000 rows")
        try:
            if None in row:
                raise ValueError()
            snapshot, price, quantity = (int(row[k]) for k in ("snapshot", "price", "quantity"))
            if not 0 <= snapshot < frame.height or not 1 <= price <= 10**12 or not 1 <= quantity <= 100000:
                raise ValueError()
            buyer, seller = row.get("buyer") or "CUSTOM_BUYER", row.get("seller") or "CUSTOM_SELLER"
            if any(not re.fullmatch(r"[A-Za-z0-9_ .-]{1,80}", name) or name[0] in "=-" for name in (buyer, seller)):
                raise ValueError()
            rows.append(dict(snapshot=snapshot, price=price, quantity=quantity, buyer=buyer, seller=seller))
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f"Invalid CSV row {line}: use a valid snapshot, positive integer price/quantity and simple participant names") from exc
    if not rows:
        raise ValueError("CSV contains no trade rows")
    return pl.DataFrame(rows, schema=SCHEMA).sort("snapshot", maintain_order=True)


def save_variant(run_id: str, trades: pl.DataFrame, metadata: dict) -> dict:
    """Create a new library item; never replace the source tape or price scenario."""
    manifest, frame = library.load_manifest(run_id), library.load_frame(run_id)
    if manifest is None or frame is None:
        raise ValueError("Synthetic dataset not found")
    new_id = uuid.uuid4().hex[:12]
    return library.save(new_id, name=f"{manifest['name']} · {metadata['mode']} trades",
        source=manifest["source"], generator=manifest["generator"]["name"],
        params=manifest["generator"]["params"], seed=manifest["generator"]["seed"],
        df=frame, source_stats=manifest["stats"]["source"], notes=manifest.get("notes"),
        trades=trades, trade_metadata={**metadata, "parent_run_id": run_id})


def csv_text(header: list[str], rows: list[list], delimiter: str = ";") -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, delimiter=delimiter, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue()


def export_bundle(run_id: str) -> bytes:
    """Export one continuous playback day with explicit tick/depth limitations."""
    manifest, frame = library.load_manifest(run_id), library.load_frame(run_id)
    if manifest is None or frame is None:
        raise ValueError("Synthetic dataset not found")
    product = manifest["source"]["product"]
    if not re.fullmatch(r"[A-Za-z0-9_]{1,100}", product):
        raise ValueError("Product name is not safe for this CSV format")
    round_n = int(manifest["source"]["round"])
    header = ["day", "timestamp", "product"]
    for side in ("bid", "ask"):
        for level in (1, 2, 3):
            header += [f"{side}_price_{level}", f"{side}_volume_{level}"]
    header += ["mid_price", "profit_and_loss"]
    prices, grid = [], []
    for index, row in enumerate(frame.iter_rows(named=True)):
        bid, ask = quote(row, "bid"), quote(row, "ask")
        if bid is None and ask is None:
            raise ValueError(f"Snapshot {index} has no exportable book. Regenerate or repair missing/non-positive prices first")
        if bid and ask and bid[0] > ask[0]:
            raise ValueError(f"Snapshot {index} has a crossed book")
        sides = [book[0] for book in (bid, ask) if book is not None]
        mid = sum(sides) / len(sides)
        prices.append([0, index * 100, product, *(bid or ("", "")), "", "", "", "",
                       *(ask or ("", "")), "", "", "", "", mid, 0])
        grid.append([index, row["day"], row["timestamp"], index * 100])
    trades = library.load_trades(run_id)
    tape = [[r["snapshot"] * 100, r["buyer"], r["seller"], product, "SEASHELLS", r["price"], r["quantity"]]
            for r in trades.iter_rows(named=True)]
    instructions = (
        "PMA synthetic scenario — NOT recorded market data or strategy fills.\n"
        "Export uses one artificial day 0 in stored playback order, timestamp = snapshot * 100.\n"
        "Original day/time mapping is in snapshot_map.csv. This does not assert an official event length.\n"
        "Only level 1 is available; levels 2/3 are empty. Bids round down, asks up; volumes floor to units.\n"
        "Mid is recomputed from the exported book. Custom trades keep supplied whole-tick prices.\n"
        "No conversion observations or settlement values are supplied. Use a compatible single-product trader.\n"
        "Generated trades are independent sampled prints; they do not model queue priority or bot behavior.\n"
        "Extract to a separate folder. With kevin-fu1's backtester, use:\n"
        f"python -m prosperity4bt path/to/trader.py {round_n}-0 --data path/to/extracted --no-vis\n"
        "Pass the explicit day; default available-day lists may not include this synthetic day.\n"
        "Reader/CLI schema checked; a complete strategy run is not certified by this export.\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"round{round_n}/prices_round_{round_n}_day_0.csv", csv_text(header, prices))
        archive.writestr(f"round{round_n}/trades_round_{round_n}_day_0.csv", csv_text(
            ["timestamp", "buyer", "seller", "symbol", "currency", "price", "quantity"], tape))
        archive.writestr("snapshot_map.csv", csv_text(["snapshot", "source_day", "source_timestamp", "export_timestamp"], grid, ","))
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr("README.txt", instructions)
    return buffer.getvalue()
