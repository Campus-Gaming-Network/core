#!/usr/bin/env python3
"""Build data/schools_seed.csv from College Scorecard institution CSV.

Source: https://collegescorecard.ed.gov/data/
Default input: data/Schools_2025_26.csv

Usage:
  python3 scripts/build_schools_seed.py
  python3 scripts/build_schools_seed.py --input data/Schools_2025_26.csv --output data/schools_seed.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if value in ("", "NA", "NULL", "PrivacySuppressed"):
        return None
    return value


def slugify(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in normalized if not unicodedata.combining(c))
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "school"


def normalize_url(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not url:
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url


def build_rows(reader: csv.DictReader) -> list[dict]:
    slug_counts: dict[str, int] = {}
    rows: list[dict] = []

    for raw in reader:
        if clean(raw.get("CURROPER")) != "1":
            continue

        name = clean(raw.get("INSTNM"))
        if not name:
            continue

        base = slugify(name)
        count = slug_counts.get(base, 0) + 1
        slug_counts[base] = count
        slug = base if count == 1 else f"{base}-{count}"

        rows.append(
            {
                "unitid": clean(raw.get("UNITID")),
                "name": name,
                "alias": clean(raw.get("ALIAS")),
                "slug": slug,
                "city": clean(raw.get("CITY")),
                "state": clean(raw.get("STABBR")),
                "zip": clean(raw.get("ZIP")),
                "website_url": normalize_url(clean(raw.get("INSTURL"))),
                "latitude": clean(raw.get("LATITUDE")),
                "longitude": clean(raw.get("LONGITUDE")),
                "is_main_campus": clean(raw.get("MAIN")) == "1",
                "num_branches": clean(raw.get("NUMBRANCH")),
            }
        )

    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=ROOT / "data" / "Schools_2025_26.csv",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "data" / "schools_seed.csv",
    )
    args = parser.parse_args()

    with args.input.open(newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        rows = build_rows(reader)

    if not rows:
        raise SystemExit("no rows produced; check input file")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    main_campuses = sum(1 for row in rows if row["is_main_campus"])
    with_coords = sum(1 for row in rows if row["latitude"] and row["longitude"])
    print(
        f"wrote {args.output} rows={len(rows)} "
        f"main={main_campuses} with_coords={with_coords}"
    )


if __name__ == "__main__":
    main()
