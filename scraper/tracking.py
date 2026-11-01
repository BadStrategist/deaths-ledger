"""Tracked players: deaths found by polling known players one at a time.

The personal lookup (index_lite.json) answers from GitHub's servers even where the ranking
pages are blocked, and it carries Jagex's death record (time, world, tile). So every run:

  1. pulls the names visitors asked to track on the site (Cloudflare Worker, config tracking.api),
  2. adds a slice of the official top-50 tables (all skills and activities, round-robin),
  3. looks up as many tracked players as the time budget allows, longest-unchecked first.

A death record newer than deaths_since is a death. A player who disappears from the hiscores
twice in a row has fallen (or banished, if they turn up on the main hiscores with their XP).
An XP drop with no death record is a reset.
"""
import json
import time

RANKING = "https://secure.runescape.com/m={mode}/ranking.json?table={table}&category={cat}&size=50"
TABLES = [(0, t) for t in range(25)] + [(1, t) for t in range(111)]   # skills, then activities


def run(http, mode, st, add_death, since, now, deadline, cfg):
    import graveyard as g   # late import: graveyard imports this module
    tr = st.setdefault("tracked", {})   # key -> {name, src, checked, seen, xp, total, misses, death_logged}
    out = {"tracked": 0, "added": 0, "checked": 0, "deaths": 0, "errors": 0}

    # 1. names visitors asked for
    api = (cfg.get("api") or "").rstrip("/")
    if api:
        status, body = http.get(api + "/names")
        if status == 200:
            for name in json.loads(body).get("names", []):
                k = g.key(name)
                if k not in tr:
                    tr[k] = {"name": name, "src": "site", "checked": 0}
                    out["added"] += 1
                else:
                    tr[k]["src"] = "site"
        else:
            out["errors"] += 1

    # 2. a slice of the top-50 tables
    per = cfg.get("seed_tables_per_run", 10)
    cur = st.get("seed_cursor", 0)
    for i in range(per):
        cat, table = TABLES[(cur + i) % len(TABLES)]
        status, body = http.get(RANKING.format(mode=mode, table=table, cat=cat))
        if status != 200 or not body.lstrip().startswith("["):
            continue
        for r in json.loads(body):
            k = g.key(r["name"])
            if k not in tr:
                tr[k] = {"name": r["name"], "src": "top50", "checked": 0}
                out["added"] += 1
    st["seed_cursor"] = (cur + per) % len(TABLES)

    # 3. poll, never-checked first
    stop = min(deadline, time.monotonic() + cfg.get("budget_seconds", 300))
    strikes = 0
    for k in sorted(tr, key=lambda k: tr[k].get("checked", 0)):
        if time.monotonic() > stop or strikes >= 5:
            break
        p = tr[k]
        site = p.get("src") == "site"
        try:
            player = g.fetch_player(http, mode, p["name"])
        except RuntimeError:
            out["errors"] += 1
            strikes += 1          # several failures in a row: Jagex is struggling, stop for this run
            continue
        strikes = 0
        out["checked"] += 1
        p["checked"] = now

        if player is None:                       # not on the hiscores (now)
            if p.get("xp"):
                p["misses"] = p.get("misses", 0) + 1
                if p["misses"] >= 2 and p.pop("death_logged", False):
                    p.update(xp=0, total=0, misses=0)    # the transfer after a death we already have
                elif p["misses"] >= 2:
                    banished = g.on_main_game(http, p["name"], p["xp"])
                    add_death(p["name"], {"fate": "banished" if banished else "fallen", "time": now,
                                          "time_exact": False, "window_start": p.get("seen"),
                                          "total": p.get("total"), "xp": p["xp"], "tracked": site})
                    out["deaths"] += 1
                    p.update(xp=0, total=0, misses=0)
            continue

        info = g.details(player)
        p["misses"] = 0
        died = info.get("death_time")
        if died and died >= since and st["skulls"].get(k) != died:
            st["skulls"][k] = died
            p["death_logged"] = True
            add_death(p["name"], {"fate": "died", "time": died, "time_exact": True, "tracked": site,
                                  **{x: y for x, y in info.items() if x != "death_time"}})
            out["deaths"] += 1
        elif p.get("xp") and (info.get("xp") or 0) < p["xp"]:
            if not p.pop("death_logged", False):       # else: the reset after a death we already have
                add_death(p["name"], {"fate": "reset", "time": now, "time_exact": False,
                                      "window_start": p.get("seen"), "total": p.get("total"),
                                      "xp": p["xp"], "tracked": site})
                out["deaths"] += 1
        p.update(xp=info.get("xp"), total=info.get("total"), seen=now)

    out["tracked"] = len(tr)
    out["unchecked"] = sum(1 for p in tr.values() if not p.get("checked"))
    return out
