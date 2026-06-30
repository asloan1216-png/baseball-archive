# MLB Stat Archive

Snapshots MLB leaderboards **as displayed on each day** and keeps them forever.
Sites like Baseball Savant and FanGraphs recompute their models (Statcast
updates, WAR formula changes, park factors) and overwrite history — so there's
no way to know what a leaderboard *said* on a past date. This archives that,
going forward, one snapshot per day.

## What it captures (v1)

| Source file | What | Notes |
|---|---|---|
| `savant_xstats_batter` / `_pitcher` | Statcast expected stats (xwOBA, xBA, xSLG, …) | The stuff that gets retro-revised |
| `savant_oaa_fielder` | Outs Above Average | Fielding, model-dependent |
| `mlb_hitting` / `mlb_pitching` | Box-stat leaders (OPS, OBP, SLG, AVG, HR, RBI, SB, ERA, WHIP, K…) | Official MLB Stats API, free |
| `fg_war_*` / `bref_war_*` | fWAR + bWAR | Via `pybaseball`; the fragile ones, isolated |

Every **numeric column** from each source is stored, so you can build any
leaderboard later, not just the ones above.

## How it works

```
daily cron (GitHub Actions)
   └─ collect.py
        ├─ fetch each source  ──► data/raw/{date}/{source}.{csv|json}   (durable archive, committed to git)
        └─ parse ──► data/snapshots.db  (SQLite, git-ignored, rebuildable)
```

`data/raw/` is the source of truth. `snapshots.db` is derived and can be
rebuilt anytime with `python collect.py --rebuild`, so a parsing bug never
costs you data.

The DB is one tall table:

```sql
metrics(snapshot_date, source, season, player_id, player_name, team, metric, value)
```

so every stat is queried the same way:

```sql
SELECT player_name, value FROM metrics
WHERE snapshot_date='2026-06-01' AND metric='ops'
ORDER BY value DESC;
```

## Setup

```bash
pip install -r requirements.txt

# take a snapshot for today
python collect.py

# or backfill-label a specific date / season
python collect.py --date 2026-06-01 --season 2026
```

Then inspect it:

```bash
python query.py runs                              # did every source succeed?
python query.py metrics savant_xstats_batter      # list available metrics
python query.py top 2026-06-01 mlb_hitting ops 15 # top-15 OPS that day
python query.py player 592450 fwar                # one player's fWAR over time
```

**Run `python query.py runs` after your first collect** — it shows the status
of each source. Savant endpoint query-params change occasionally; if one shows
`error`, the raw file still saved nothing to lose, and you just adjust that
source's URL in `sources.py`.

## Daily automation

`.github/workflows/daily.yml` runs the collector every morning on GitHub's
servers (your computer doesn't need to be on) and commits the new `data/raw/`
snapshot back to the repo. Push this repo to GitHub and it starts on the next
scheduled run; you can also trigger it manually from the **Actions** tab.

The cron is `30 13 * * *` (UTC) ≈ 9:30am ET during the season. Adjust if you
want a different capture time. Because Savant numbers are season-to-date,
each snapshot is "the value as shown that morning."

## Adding a stat

Add a dict to `SOURCES` in `sources.py`. For most Savant leaderboards that's
just a new `savant_csv` entry with the CSV URL (add `&csv=true`). No parser
changes needed — every numeric column is picked up automatically.

## Notes / limits

- **Forward-only.** Today is the earliest snapshot you can ever have; the past
  is already overwritten on the source sites.
- **WAR sources are the fragile ones.** They depend on `pybaseball` scraping
  FanGraphs / Baseball Reference, which can break or rate-limit. They're
  isolated, so a failure there never affects the Savant / MLB core.
- Be a good citizen: this hits each endpoint once a day. Don't crank the
  frequency up.
