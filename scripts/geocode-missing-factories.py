#!/usr/bin/env python3
"""Lookup factory pins on Google Maps (Morbi area) and dump CSV."""
from __future__ import annotations

import csv
import json
import re
import time
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

NAMES = Path("/Users/bhaumikbhut/Downloads/CUSTOMER_LIST_missing_factories.txt")
OUT_CSV = Path("/Users/bhaumikbhut/Downloads/CUSTOMER_LIST_missing_google_maps.csv")
OUT_JSON = Path("/Users/bhaumikbhut/Downloads/CUSTOMER_LIST_missing_google_maps.json")
PROGRESS = Path("/Users/bhaumikbhut/Downloads/CUSTOMER_LIST_missing_google_maps.progress.json")

MORBI = (22.8167, 70.8333)
LAT_MIN, LAT_MAX = 20.5, 24.5
LNG_MIN, LNG_MAX = 69.5, 73.5


def haversine_km(a, b) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    x = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    )
    return 2 * r * asin(sqrt(x))


def extract_coords(url: str):
    # Prefer !3dLAT!4dLNG (place pin) then @LAT,LNG
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", url)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None


def load_progress():
    if PROGRESS.exists():
        return json.loads(PROGRESS.read_text())
    return {}


def save_progress(data: dict):
    PROGRESS.write_text(json.dumps(data, indent=2))


def main():
    names = [n.strip() for n in NAMES.read_text().splitlines() if n.strip()]
    done = load_progress()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            locale="en-IN",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        for i, name in enumerate(names, 1):
            if name in done and done[name].get("status") in (
                "found",
                "outside_morbi",
                "not_found",
                "no_coords",
            ):
                print(f"[{i}/{len(names)}] skip {name}")
                continue

            if "HIMATNAGAR" in name.upper() or "ORIENTAL CARBON" in name.upper():
                query = f"{name} Gujarat"
            else:
                query = f"{name} Morbi Gujarat"
            url = f"https://www.google.com/maps/search/{quote(query)}"
            status = "not_found"
            lat = lng = None
            final = ""
            title = ""
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                # Single hit often auto-opens /place/; list results stay on /search/
                for _ in range(24):
                    time.sleep(0.35)
                    final = page.url
                    coords = extract_coords(final)
                    if coords:
                        lat, lng = coords
                        break

                title = page.title()

                if lat is None:
                    # Click first place in results panel
                    clicked = False
                    for sel in (
                        'a[href*="/maps/place/"]',
                        'div[role="feed"] a[href*="/maps/place/"]',
                        'div[role="article"]',
                    ):
                        try:
                            loc = page.locator(sel).first
                            if loc.count() == 0:
                                continue
                            loc.click(timeout=2500)
                            clicked = True
                            break
                        except Exception:
                            continue
                    if clicked:
                        for _ in range(20):
                            time.sleep(0.3)
                            final = page.url
                            coords = extract_coords(final)
                            if coords:
                                lat, lng = coords
                                break
                        title = page.title()

                if lat is None:
                    # Last resort: scrape HTML for !3dLAT!4dLNG
                    html = page.content()
                    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", html)
                    if m:
                        lat, lng = float(m.group(1)), float(m.group(2))
                        final = page.url

                if lat is not None and lng is not None:
                    if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
                        status = "found"
                    else:
                        status = "outside_morbi"
                else:
                    status = "no_coords"
            except Exception as e:
                status = "error"
                final = str(e)

            row = {
                "name": name,
                "status": status,
                "lat": lat,
                "lng": lng,
                "km_from_morbi": (
                    round(haversine_km(MORBI, (lat, lng)), 1)
                    if lat is not None and lng is not None
                    else None
                ),
                "maps_title": title,
                "maps_url": final if str(final).startswith("http") else url,
                "query": query,
            }
            done[name] = row
            save_progress(done)
            print(
                f"[{i}/{len(names)}] {status:14} {name[:42]:42} "
                f"{lat} {lng}",
                flush=True,
            )
            time.sleep(0.35)

        browser.close()

    rows = [done[n] for n in names if n in done]
    with OUT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "name",
                "status",
                "lat",
                "lng",
                "km_from_morbi",
                "maps_title",
                "maps_url",
                "query",
            ],
        )
        w.writeheader()
        w.writerows(rows)
    OUT_JSON.write_text(json.dumps(rows, indent=2))

    found = sum(1 for r in rows if r["status"] == "found")
    outside = sum(1 for r in rows if r["status"] == "outside_morbi")
    missing = len(rows) - found - outside
    print("\nSUMMARY")
    print("found_morbi_area", found)
    print("outside_morbi", outside)
    print("missing_or_error", missing)
    print("csv", OUT_CSV)
    print("json", OUT_JSON)


if __name__ == "__main__":
    main()
