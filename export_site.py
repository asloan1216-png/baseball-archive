"""
Export snapshots.db to a static JSON dataset under docs/data/.

Outputs:
  docs/data/dates.json               -- all snapshot dates, ascending
  docs/data/manifest.json            -- sources with labels and metrics
  docs/data/{date}/{source}.json     -- per-metric leaderboards for that day

Idempotent: re-runs overwrite all files cleanly.
"""
import json
import sqlite3
from pathlib import Path

from db import DB_PATH
from labels import LOWER_IS_BETTER, metric_label, source_label

OUT = Path(__file__).parent / "docs" / "data"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # --- dates.json ---
    dates = [r[0] for r in conn.execute(
        "SELECT DISTINCT snapshot_date FROM metrics ORDER BY snapshot_date"
    )]
    write_json(OUT / "dates.json", dates)
    print(f"dates.json  ({len(dates)} dates)")

    # --- manifest.json ---
    # Collect every (source, metric) pair that has ever been recorded.
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
    file_count = 0
    for date in dates:
        # Get every source that has data for this date.
        sources_for_date = [r[0] for r in conn.execute(
            "SELECT DISTINCT source FROM metrics WHERE snapshot_date=? ORDER BY source",
            (date,),
        )]
        for src in sources_for_date:
            rows = conn.execute(
                "SELECT player_name, team, metric, value FROM metrics "
                "WHERE snapshot_date=? AND source=? AND value IS NOT NULL",
                (date, src),
            ).fetchall()

            # Group by metric, collect player rows.
            by_metric: dict[str, list] = {}
            for r in rows:
                by_metric.setdefault(r["metric"], []).append(
                    {"name": r["player_name"], "team": r["team"], "value": r["value"]}
                )

            # Sort each metric descending by value.
            payload = {
                m: sorted(players, key=lambda p: (p["value"] is None, p["value"] or 0), reverse=True)
                for m, players in by_metric.items()
            }

            write_json(OUT / date / f"{src}.json", payload)
            file_count += 1

    print(f"{file_count} date/source files written")
    conn.close()


if __name__ == "__main__":
    main()
