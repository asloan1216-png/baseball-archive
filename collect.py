"""
Daily collector.

Usage:
    python collect.py                 # snapshot today (default season = current year)
    python collect.py --date 2026-06-01 --season 2026
    python collect.py --rebuild       # wipe metrics table, re-parse everything in data/raw/

Design notes
------------
* Every source is fetched independently inside try/except. One broken endpoint
  records an 'error' in the `runs` table and the rest still run.
* The untouched response is written to data/raw/{date}/{source}.{ext} BEFORE
  parsing. That raw archive is the source of truth; the SQLite DB is derived
  from it and can be rebuilt at any time.
* Parsers take already-fetched *content* (a string), so the exact same code
  path is used live and during --rebuild.
"""
import argparse
import datetime as dt
import io
import json
import sys
from pathlib import Path

import pandas as pd
import requests

import db
from sources import SOURCES, RAW_EXT

RAW_DIR = Path(__file__).parent / "data" / "raw"
HEADERS = {"User-Agent": "mlb-stat-archive/1.0 (personal archival project)"}
TIMEOUT = 90


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def to_float(v):
    """Coerce a cell to float, or None. Handles '.305', '--', NaN, '', etc."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return None if f != f else f  # NaN check
    s = str(v).strip()
    if s in ("", "-", "--", "NA", "N/A", "nan", "None", "null"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _find_col(df, candidates):
    lower = {str(c).lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def _first_present(df, candidates):
    col = _find_col(df, candidates)
    if col is None:
        raise KeyError(f"none of {candidates} found in columns {list(df.columns)}")
    return col


def _clean_name(v):
    """'Judge, Aaron' -> 'Aaron Judge'. Leaves already-clean names alone."""
    s = str(v).strip()
    if "," in s:
        last, first = s.split(",", 1)
        return f"{first.strip()} {last.strip()}".strip()
    return s


def _resolve_name(df):
    """Return (cols_to_skip, fn(row)->name) handling Savant's name variants."""
    for c in df.columns:
        lc = str(c).lower().replace(" ", "")
        if "last_name" in lc and "first_name" in lc:
            return [c], (lambda r, c=c: _clean_name(r[c]))
    fn = _find_col(df, ["first_name", "name_first", "firstname"])
    ln = _find_col(df, ["last_name", "name_last", "lastname"])
    if fn and ln:
        return [fn, ln], (lambda r, fn=fn, ln=ln:
                          f"{str(r[fn]).strip()} {str(r[ln]).strip()}".strip())
    nc = _find_col(df, ["player_name", "name", "full_name", "name_common"])
    if nc:
        return [nc], (lambda r, nc=nc: str(r[nc]).strip())
    return [], (lambda r: None)


# --------------------------------------------------------------------------- #
# parsers  (content:str -> list of metric rows)
# --------------------------------------------------------------------------- #
def parse_savant_csv(content, snapshot_date, src, season):
    """Generic: every numeric column becomes a metric. Resilient to schema
    changes since we don't hardcode which columns exist."""
    df = pd.read_csv(io.StringIO(content))
    df.columns = [str(c).strip() for c in df.columns]
    if df.empty:
        return []

    id_col = _find_col(df, ["player_id", "mlb_id", "mlbam_id", "key_mlbam", "entity_id"])
    team_col = _find_col(df, ["team", "team_name", "parent_org", "team_abbrev", "team_id"])
    year_col = _find_col(df, ["year", "season", "yearid"])
    name_cols, name_fn = _resolve_name(df)

    skip = set(filter(None, [id_col, team_col, year_col])) | set(name_cols)
    rows = []
    for _, r in df.iterrows():
        pname = name_fn(r)
        pid = str(r[id_col]) if id_col else None
        pid = pid if pid not in (None, "nan", "") else (pname or "unknown")
        team = str(r[team_col]) if team_col else None
        for col in df.columns:
            if col in skip:
                continue
            val = to_float(r[col])
            if val is None:
                continue
            rows.append((snapshot_date, src["name"], season, pid, pname, team,
                         col.lower(), val))
    return rows


def parse_mlb_json(content, snapshot_date, src, season):
    """Flatten the MLB Stats API splits; every numeric stat field -> metric."""
    data = json.loads(content)
    stats = data.get("stats", [])
    if not stats:
        return []
    rows = []
    for split in stats[0].get("splits", []):
        player = split.get("player", {}) or {}
        team = split.get("team", {}) or {}
        stat = split.get("stat", {}) or {}
        pid = str(player.get("id") or player.get("fullName") or "unknown")
        pname = player.get("fullName")
        tname = team.get("name")
        for k, v in stat.items():
            fv = to_float(v)
            if fv is None:
                continue
            rows.append((snapshot_date, src["name"], season, pid, pname, tname,
                         k.lower(), fv))
    return rows


def parse_war_csv(content, snapshot_date, src, season):
    """WAR is saved as a slim CSV: player_id, player_name, team, value."""
    df = pd.read_csv(io.StringIO(content))
    if df.empty:
        return []
    metric = src["war_metric"]
    rows = []
    for _, r in df.iterrows():
        val = to_float(r.get("value"))
        if val is None:
            continue
        raw_pid = str(r.get("player_id") or r.get("player_name") or "unknown")
        pid = str(int(float(raw_pid))) if raw_pid.endswith(".0") else raw_pid
        rows.append((snapshot_date, src["name"], season, pid,
                     r.get("player_name"), r.get("team"), metric, val))
    return rows


PARSERS = {
    "savant_csv": parse_savant_csv,
    "mlb_json": parse_mlb_json,
    "war": parse_war_csv,
}


# --------------------------------------------------------------------------- #
# fetchers  (network -> content:str that the parser above understands)
# --------------------------------------------------------------------------- #
def fetch_savant_csv(src, season):
    url = src["url"].format(year=season)
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def fetch_mlb_json(src, season):
    url = ("https://statsapi.mlb.com/api/v1/stats?stats=season"
           f"&group={src['group']}&season={season}&sportId=1"
           "&playerPool=qualified&limit=5000")
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def _slim(df, id_col, name_col, team_col, war_col):
    out = pd.DataFrame({
        "player_id": df[id_col].astype("Int64").astype(str) if id_col in df else "",
        "player_name": df[name_col] if name_col in df else "",
        "team": df[team_col] if team_col in df else "",
        "value": pd.to_numeric(df[war_col], errors="coerce"),
    })
    return out.dropna(subset=["value"])


def _slim_bref(df, season):
    ycol = _first_present(df, ["year_ID", "year", "yearID"])
    df = df[df[ycol].astype(str) == str(season)]
    idc = _find_col(df, ["mlb_ID", "player_ID", "mlbID"])
    namec = _first_present(df, ["name_common", "name", "Name"])
    teamc = _find_col(df, ["team_ID", "team", "Team"])
    warc = _first_present(df, ["WAR", "war"])
    out = pd.DataFrame({
        "player_id": (df[idc].apply(lambda v: str(int(float(v))) if pd.notna(v) and str(v).endswith(".0") else str(v)) if idc else df[namec].astype(str)),
        "player_name": df[namec],
        "team": (df[teamc] if teamc else ""),
        "value": pd.to_numeric(df[warc], errors="coerce"),
    }).dropna(subset=["value"])
    # Baseball Reference splits multi-team seasons into stints; sum to season WAR.
    return out.groupby(["player_id", "player_name"], as_index=False).agg(
        {"team": "last", "value": "sum"})


def fetch_war(src, season):
    """Returns the slim CSV text that parse_war_csv expects."""
    import pybaseball as pyb  # imported lazily so core works without it
    key = src["pyb"]
    if key == "bat_fg":
        out = _slim(pyb.batting_stats(season, qual=1), "IDfg", "Name", "Team", "WAR")
    elif key == "pit_fg":
        out = _slim(pyb.pitching_stats(season, qual=1), "IDfg", "Name", "Team", "WAR")
    elif key == "bat_bref":
        out = _slim_bref(pyb.bwar_bat(return_all=True), season)
    elif key == "pit_bref":
        out = _slim_bref(pyb.bwar_pitch(return_all=True), season)
    else:
        raise ValueError(f"unknown pyb key {key}")
    return out.to_csv(index=False)


FETCHERS = {
    "savant_csv": fetch_savant_csv,
    "mlb_json": fetch_mlb_json,
    "war": fetch_war,
}


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #
def raw_path(snapshot_date, src):
    return RAW_DIR / snapshot_date / f"{src['name']}.{RAW_EXT[src['kind']]}"


def collect(snapshot_date, season):
    conn = db.connect()
    for src in SOURCES:
        name = src["name"]
        try:
            content = FETCHERS[src["kind"]](src, season)
            path = raw_path(snapshot_date, src)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

            rows = PARSERS[src["kind"]](content, snapshot_date, src, season)
            db.upsert_metrics(conn, rows)
            db.record_run(conn, snapshot_date, name, "ok", len(rows))
            print(f"  ok    {name:24s} {len(rows):6d} rows")
        except Exception as e:  # noqa: BLE001 - isolate per-source failures
            db.record_run(conn, snapshot_date, name, "error", 0, str(e)[:500])
            print(f"  ERROR {name:24s} {e}", file=sys.stderr)
        conn.commit()
    conn.close()


def rebuild():
    """Re-parse every file in data/raw/ into a fresh metrics table."""
    conn = db.connect()
    conn.execute("DELETE FROM metrics")
    by_name = {s["name"]: s for s in SOURCES}
    total = 0
    for date_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        snapshot_date = date_dir.name
        season = int(snapshot_date[:4])
        for f in sorted(date_dir.iterdir()):
            src = by_name.get(f.stem)
            if not src:
                continue
            content = f.read_text(encoding="utf-8")
            rows = PARSERS[src["kind"]](content, snapshot_date, src, season)
            db.upsert_metrics(conn, rows)
            total += len(rows)
        conn.commit()
        print(f"  rebuilt {snapshot_date}")
    conn.close()
    print(f"done: {total} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=dt.date.today().isoformat(),
                    help="snapshot date YYYY-MM-DD (default: today)")
    ap.add_argument("--season", type=int, default=dt.date.today().year)
    ap.add_argument("--rebuild", action="store_true",
                    help="rebuild the DB from data/raw/ instead of fetching")
    args = ap.parse_args()

    if args.rebuild:
        rebuild()
    else:
        print(f"snapshot {args.date} (season {args.season})")
        collect(args.date, args.season)


if __name__ == "__main__":
    main()
