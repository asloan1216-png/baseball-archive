"""
Quick look at what's archived. Examples:

    python query.py runs                       # latest pull status per source
    python query.py dates                       # which dates are archived
    python query.py metrics savant_xstats_batter
    python query.py top 2026-06-01 mlb_hitting ops 15
    python query.py player 592450 fwar          # one player's metric over time
"""
import sys
import db


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    conn = db.connect()
    cmd = args[0]

    if cmd == "runs":
        for row in conn.execute(
            "SELECT snapshot_date, source, status, rows, substr(message,1,60) "
            "FROM runs ORDER BY snapshot_date DESC, source LIMIT 40"):
            print(f"{row[0]}  {row[1]:24s} {row[2]:5s} {row[3]:6} {row[4] or ''}")

    elif cmd == "dates":
        for row in conn.execute(
            "SELECT snapshot_date, COUNT(*) FROM metrics GROUP BY snapshot_date "
            "ORDER BY snapshot_date"):
            print(f"{row[0]}  {row[1]:8d} rows")

    elif cmd == "metrics":
        source = args[1]
        for row in conn.execute(
            "SELECT DISTINCT metric FROM metrics WHERE source=? ORDER BY metric",
            (source,)):
            print(row[0])

    elif cmd == "top":
        date, source, metric = args[1], args[2], args[3]
        n = int(args[4]) if len(args) > 4 else 10
        q = ("SELECT player_name, team, value FROM metrics "
             "WHERE snapshot_date=? AND source=? AND metric=? "
             "ORDER BY value DESC LIMIT ?")
        for i, row in enumerate(conn.execute(q, (date, source, metric, n)), 1):
            print(f"{i:3d}. {row[0]:24s} {row[1] or '':5s} {row[2]}")

    elif cmd == "player":
        pid, metric = args[1], args[2]
        for row in conn.execute(
            "SELECT snapshot_date, value FROM metrics "
            "WHERE player_id=? AND metric=? ORDER BY snapshot_date", (pid, metric)):
            print(f"{row[0]}  {row[1]}")

    else:
        print(__doc__)
    conn.close()


if __name__ == "__main__":
    main()
