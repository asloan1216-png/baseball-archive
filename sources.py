"""
Definitions of every leaderboard we snapshot.

Each source has:
  name : unique id, used as the raw filename and the `source` value in the DB
  kind : how to fetch + parse it
           "savant_csv" -> GET a Baseball Savant CSV leaderboard
           "mlb_json"   -> GET the official MLB Stats API (JSON)
           "war"        -> pull WAR via the pybaseball library

Adding a new Savant leaderboard is usually just a new dict with a URL.
Endpoints occasionally change their query params; if a source starts failing,
check the `runs` table (see query.py) and adjust the URL here. The raw response
is always saved to data/raw/, so nothing is lost even if parsing needs tweaking.

{year} in a URL is filled in at runtime with the season.
"""

SOURCES = [
    # ---- Baseball Savant: the model-dependent stuff that gets retro-revised ----
    {
        "name": "savant_xstats_batter",
        "kind": "savant_csv",
        "url": "https://baseballsavant.mlb.com/leaderboard/expected_statistics"
               "?type=batter&year={year}&position=&team=&filterType=pa&min=q&csv=true",
    },
    {
        "name": "savant_xstats_pitcher",
        "kind": "savant_csv",
        "url": "https://baseballsavant.mlb.com/leaderboard/expected_statistics"
               "?type=pitcher&year={year}&position=&team=&filterType=pa&min=q&csv=true",
    },
    {
        "name": "savant_oaa_fielder",
        "kind": "savant_csv",
        "url": "https://baseballsavant.mlb.com/leaderboard/outs_above_average"
               "?type=Fielder&startYear={year}&endYear={year}&split=no&team="
               "&range=year&min=q&pos=&roles=&viz=show&csv=true",
    },

    # ---- Official MLB Stats API: box-stat leaders (free, no key) ----
    # One pull returns every qualified player with all box stats (OPS, OBP,
    # SLG, AVG, HR, RBI, SB, etc.), so any leaderboard can be derived later.
    {"name": "mlb_hitting",  "kind": "mlb_json", "group": "hitting"},
    {"name": "mlb_pitching", "kind": "mlb_json", "group": "pitching"},

    # ---- WAR via pybaseball (the fragile / ToS-sensitive ones) ----
    # Isolated so a failure here never affects the sources above.

    # FanGraphs WAR disabled: fangraphs.com returns 403 on automated requests and
    # blocks datacenter IPs entirely (including GitHub Actions). Re-enable if
    # FanGraphs changes their access policy or a supported API becomes available.
    # {"name": "fg_war_batting",   "kind": "war", "war_metric": "fwar", "pyb": "bat_fg"},
    # {"name": "fg_war_pitching",  "kind": "war", "war_metric": "fwar", "pyb": "pit_fg"},

    {"name": "bref_war_batting", "kind": "war", "war_metric": "bwar", "pyb": "bat_bref"},
    {"name": "bref_war_pitching","kind": "war", "war_metric": "bwar", "pyb": "pit_bref"},
]

# File extension used when saving the raw capture for each kind.
RAW_EXT = {"savant_csv": "csv", "mlb_json": "json", "war": "csv"}
