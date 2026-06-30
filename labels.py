"""
Human-readable labels for the website's dropdowns.

    metric_label(raw_key)   -> e.g. "est_woba" -> "xwOBA", "homeruns" -> "HR"
    source_label(src_name)  -> e.g. "mlb_hitting" -> "Hitting — box stats"

Anything not in the dicts below falls back to a prettified version of the raw
key (underscores -> spaces, title-cased), so the site still works if a new
column appears before it's been added here. Add the nice name later at leisure.

LOWER_IS_BETTER lists rate stats whose leaderboard conventionally sorts
ascending (best ERA first, etc.) so the UI can pick the right default sort.
It only sets the default — the page still has a manual sort toggle.

Metric keys are lowercase because collect.py lowercases every column/field.
"""

SOURCE_LABELS = {
    "mlb_hitting": "Hitting — box stats",
    "mlb_pitching": "Pitching — box stats",
    "savant_xstats_batter": "Expected stats — batters",
    "savant_xstats_pitcher": "Expected stats — pitchers",
    "savant_oaa_fielder": "Outs Above Average — fielders",
    "fg_war_batting": "fWAR — batters",
    "fg_war_pitching": "fWAR — pitchers",
    "bref_war_batting": "bWAR — batters",
    "bref_war_pitching": "bWAR — pitchers",
}

METRIC_LABELS = {
    # --- WAR ---
    "fwar": "fWAR",
    "bwar": "bWAR",

    # --- Savant expected stats ---
    # diff columns are named "est_X_minus_X", i.e. xStat − Stat
    "pa": "PA",
    "bip": "BIP",
    "ba": "BA",
    "est_ba": "xBA",
    "est_ba_minus_ba_diff": "xBA − BA",
    "slg": "SLG",
    "est_slg": "xSLG",
    "est_slg_minus_slg_diff": "xSLG − SLG",
    "woba": "wOBA",
    "est_woba": "xwOBA",
    "est_woba_minus_woba_diff": "xwOBA − wOBA",

    # --- Savant OAA (exact columns vary; fallback covers any extras) ---
    "outs_above_average": "OAA",
    "fielding_runs_prevented": "Fielding Runs Prevented",
    "actual_success_rate": "Success Rate",
    "estimated_success_rate": "Est. Success Rate",
    "attempts": "Attempts",

    # --- MLB box: hitting ---
    "ops": "OPS",
    "obp": "OBP",
    "avg": "AVG",
    "homeruns": "HR",
    "rbi": "RBI",
    "runs": "R",
    "hits": "H",
    "doubles": "2B",
    "triples": "3B",
    "stolenbases": "SB",
    "caughtstealing": "CS",
    "baseonballs": "BB",
    "strikeouts": "SO",
    "atbats": "AB",
    "plateappearances": "PA",
    "totalbases": "TB",
    "babip": "BABIP",
    "hitbypitch": "HBP",
    "intentionalwalks": "IBB",
    "groundintodoubleplay": "GIDP",
    "sacflies": "SF",
    "sacbunts": "SH",
    "gamesplayed": "G",
    "groundoutstoairouts": "GO/AO",
    "groundouts": "GO",
    "airouts": "AO",
    "atbatsperhomerun": "AB/HR",
    "stolenbasepercentage": "SB%",
    "leftonbase": "LOB",
    "numberofpitches": "Pitches",

    # --- MLB box: pitching ---
    "era": "ERA",
    "whip": "WHIP",
    "wins": "W",
    "losses": "L",
    "saves": "SV",
    "saveopportunities": "SVO",
    "holds": "HLD",
    "blownsaves": "BS",
    "inningspitched": "IP",
    "earnedruns": "ER",
    "battersfaced": "BF",
    "gamesstarted": "GS",
    "completegames": "CG",
    "shutouts": "SHO",
    "wildpitches": "WP",
    "hitbatsmen": "HB",
    "balks": "BK",
    "strikepercentage": "Strike %",
    "winpercentage": "Win %",
    "strikeoutwalkratio": "K/BB",
    "strikeoutsper9inn": "K/9",
    "walksper9inn": "BB/9",
    "hitsper9inn": "H/9",
    "homerunsper9": "HR/9",
}

# Rate stats where a lower value is better -> leaderboard defaults to ascending.
LOWER_IS_BETTER = {
    "era", "whip", "walksper9inn", "hitsper9inn", "homerunsper9",
}


def _prettify(raw: str) -> str:
    return str(raw).replace("_", " ").title()


def metric_label(raw: str) -> str:
    return METRIC_LABELS.get(raw, _prettify(raw))


def source_label(name: str) -> str:
    return SOURCE_LABELS.get(name, _prettify(name))
