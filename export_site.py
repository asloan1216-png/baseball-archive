"""
Export snapshots.db to a static JSON dataset under docs/data/.

Outputs:
  docs/data/dates.json                      -- all snapshot dates, ascending
  docs/data/manifest.json                   -- sources with labels and metrics
  docs/data/{date}/{source}.json            -- per-metric leaderboards for that day
  docs/data/players/{player_id}.json        -- per-player time-series across all sources

Idempotent: re-runs overwrite all files cleanly.
"""
import json
import shutil
import sqlite3
from collections import defaultdict
from pathlib import Path

from db import DB_PATH
from labels import LOWER_IS_BETTER, metric_label, source_label

OUT = Path(__file__).parent / "docs" / "data"

# How many of the most-recent distinct snapshot dates to publish.
# data/raw/ is never touched — increase this and re-export to restore older dates.
SITE_DAYS = 90


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    # Remove all previously generated subdirectories under docs/data/ so stale
    # files (renamed player ids, removed players, dropped dates) don't linger.
    # Only subdirectories are deleted; root files (dates.json, manifest.json)
    # are overwritten below and don't need pre-clearing.
    if OUT.exists():
        for child in OUT.iterdir():
            if child.is_dir():
                shutil.rmtree(child)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # --- dates.json ---
    # All dates in the DB, ascending; then cap to the most recent SITE_DAYS for
    # publication. data/raw/ and the DB are never touched by this trim.
    all_dates = [r[0] for r in conn.execute(
        "SELECT DISTINCT snapshot_date FROM metrics ORDER BY snapshot_date"
    )]
    dates = all_dates[-SITE_DAYS:]
    write_json(OUT / "dates.json", dates)
    print(f"dates.json  ({len(dates)} of {len(all_dates)} dates, window={SITE_DAYS})")

    # --- manifest.json ---
    source_metrics: dict[str, set] = {}
    for row in conn.execute("SELECT DISTINCT source, metric FROM metrics ORDER BY source, metric"):
        source_metrics.setdefault(row["source"], set()).add(row["metric"])

    sources_obj = {}
    for src, metrics in sorted(source_metrics.items()):
        metric_list = sorted(
            [{"key": m, "label": metric_label(m)} for m in metrics],
            key=lambda x: x["label"],
        )
        src_lower = [m for m in metrics if m in LOWER_IS_BETTER]
        sources_obj[src] = {
            "label": source_label(src),
            "metrics": metric_list,
            "lower_is_better": sorted(src_lower),
        }

    write_json(OUT / "manifest.json", {"sources": sources_obj})
    print(f"manifest.json  ({len(sources_obj)} sources)")

    # --- docs/data/{date}/{source}.json ---
    # Pull player_id too; build per-player series data in the same pass.
    #
    # player_data[player_id] = {
    #   "name": <most recent name>,
    #   "team": <most recent team>,
    #   "series": { source: { metric: [[date, value], ...] } }
    # }
    player_data: dict[str, dict] = {}

    file_count = 0
    for date in dates:  # already trimmed to SITE_DAYS
        sources_for_date = [r[0] for r in conn.execute(
            "SELECT DISTINCT source FROM metrics WHERE snapshot_date=? ORDER BY source",
            (date,),
        )]
        for src in sources_for_date:
            rows = conn.execute(
                "SELECT player_id, player_name, team, metric, value FROM metrics "
                "WHERE snapshot_date=? AND source=? AND value IS NOT NULL",
                (date, src),
            ).fetchall()

            # Group by metric for the leaderboard file.
            by_metric: dict[str, list] = {}
            for r in rows:
                by_metric.setdefault(r["metric"], []).append({
                    "id":    r["player_id"],
                    "name":  r["player_name"],
                    "team":  r["team"],
                    "value": r["value"],
                })

                # Accumulate per-player series (skip blank ids).
                pid = r["player_id"]
                if not pid:
                    continue
                if pid not in player_data:
                    player_data[pid] = {"name": r["player_name"], "team": r["team"], "series": {}}
                else:
                    # Keep the most recent snapshot's name/team (dates are ascending).
                    player_data[pid]["name"] = r["player_name"]
                    player_data[pid]["team"] = r["team"]

                player_data[pid]["series"] \
                    .setdefault(src, {}) \
                    .setdefault(r["metric"], []) \
                    .append([date, r["value"]])

            # Sort each metric descending by value.
            payload = {
                m: sorted(players, key=lambda p: (p["value"] is None, p["value"] or 0), reverse=True)
                for m, players in by_metric.items()
            }

            write_json(OUT / date / f"{src}.json", payload)
            file_count += 1

    print(f"{file_count} date/source files written")

    # --- docs/data/players/{player_id}.json ---
    # Series lists are already in ascending date order because we iterated dates ascending.
    # player_data was built only from dates already in site_dates, so no extra
    # filtering is needed — every point here is already within the window.
    players_dir = OUT / "players"
    player_count = 0
    for pid, data in player_data.items():
        write_json(players_dir / f"{pid}.json", {
            "id":     pid,
            "name":   data["name"],
            "team":   data["team"],
            "series": data["series"],
        })
        player_count += 1

    print(f"{player_count} player files written")
    conn.close()


if __name__ == "__main__":
    main()
