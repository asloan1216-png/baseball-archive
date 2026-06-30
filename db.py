"""
SQLite storage. One tall/normalized table makes every stat queryable the same way:

    metrics(snapshot_date, source, season, player_id, player_name, team, metric, value)

"What did the OPS leaderboard look like on 2026-06-01?" becomes:
    SELECT player_name, value FROM metrics
    WHERE snapshot_date='2026-06-01' AND metric='ops'
    ORDER BY value DESC;

The DB is rebuildable at any time from data/raw/ (see `collect.py --rebuild`),
so it is treated as a derived artifact and git-ignored. The raw files are the
durable archive.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "snapshots.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics (
    snapshot_date TEXT    NOT NULL,
    source        TEXT    NOT NULL,
    season        INTEGER,
    player_id     TEXT    NOT NULL,
    player_name   TEXT,
    team          TEXT,
    metric        TEXT    NOT NULL,
    value         REAL,
    PRIMARY KEY (snapshot_date, source, player_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_metrics_lookup ON metrics (snapshot_date, source, metric);
CREATE INDEX IF NOT EXISTS idx_metrics_player ON metrics (player_id, metric, snapshot_date);

-- One row per source per day: did the pull succeed, how many rows, any error.
CREATE TABLE IF NOT EXISTS runs (
    snapshot_date TEXT NOT NULL,
    source        TEXT NOT NULL,
    fetched_at    TEXT NOT NULL,
    status        TEXT NOT NULL,   -- 'ok' or 'error'
    rows          INTEGER,
    message       TEXT,
    PRIMARY KEY (snapshot_date, source)
);
"""


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def upsert_metrics(conn, rows):
    """rows: iterable of (snapshot_date, source, season, player_id,
                          player_name, team, metric, value)"""
    conn.executemany(
        "INSERT OR REPLACE INTO metrics "
        "(snapshot_date, source, season, player_id, player_name, team, metric, value) "
        "VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )


def record_run(conn, snapshot_date, source, status, n_rows, message=""):
    conn.execute(
        "INSERT OR REPLACE INTO runs "
        "(snapshot_date, source, fetched_at, status, rows, message) "
        "VALUES (?,?,datetime('now'),?,?,?)",
        (snapshot_date, source, status, n_rows, message),
    )
