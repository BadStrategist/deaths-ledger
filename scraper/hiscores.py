"""Top-50 Hardcore Worlds hiscores for the site's Hiscores page (data/hiscores.json).

Uses only endpoints that answer from GitHub runners: ranking.json (top 50 per table) and
index_lite.json (one per overall top-50 player, for total level and death status).
Schema: docs/hiscores-schema.md (site side).
"""
from common import Http, load_config, now_ms, read_json, write_json, iso
import json
import urllib.parse

RANKING = "https://secure.runescape.com/m={mode}/ranking.json?table={table}&category=0&size=50"
PLAYER = "https://secure.runescape.com/m={mode}/index_lite.json?player={name}"
SKILLS = ["Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic", "Cooking",
          "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting", "Smithing", "Mining",
          "Herblore", "Agility", "Thieving", "Slayer", "Farming", "Runecraft", "Hunter",
          "Construction", "Sailing"]  # hiscore table ids 1..24


def level_for(xp):
    """OSRS level from XP (1-99)."""
    points, lvl = 0, 1
    for n in range(1, 99):
        points += int(n + 300 * 2 ** (n / 7))
        if points // 4 > xp:
            break
        lvl = n + 1
    return lvl


def num(s):
    return int(str(s).replace(",", "")) if str(s).replace(",", "").isdigit() else 0


def ranking(http, mode, table):
    status, body = http.get(RANKING.format(mode=mode, table=table), follow_redirects=False)
    if status != 200:
        raise RuntimeError(f"ranking.json table {table} -> HTTP {status}")
    return json.loads(body)


def run(http=None, watcher=None):
    conf = load_config()
    mode = conf["hiscore"]["mode"] if conf["hiscore"]["mode"] != "auto" else (watcher or {}).get("hiscore_mode")
    now = now_ms()
    if not mode:
        write_json("hiscores.json", {"status": "waiting", "updated": iso(now), "mode": None,
                                     "overall": [], "skills": {}, "notes": None})
        return {"status": "waiting"}
    http = http or Http(delay=conf["hiscore"]["request_delay_seconds"])

    overall = []
    for r in ranking(http, mode, 0):
        status, body = http.get(PLAYER.format(mode=mode, name=urllib.parse.quote(r["name"])))
        total, dead, died_at = None, False, None
        if status == 200 and not body.lstrip().startswith("<"):
            o = next((s for s in json.loads(body).get("skills", []) if s.get("name") == "Overall"), {})
            total = o.get("level")
            death = o.get("death")
            if death:
                dead = True
                ts = death.get("timeStamp")
                died_at = iso(ts) if ts and ts > 0 else None
        overall.append({"rank": num(r["rank"]), "name": r["name"], "total": total,
                        "xp": num(r["score"]), "dead": dead, "died_at": died_at})

    dead_names = {p["name"] for p in overall if p["dead"]}
    skills = {}
    for table, name in enumerate(SKILLS, start=1):
        try:
            rows = ranking(http, mode, table)
        except RuntimeError:
            continue  # one missing table never blanks the page
        skills[name] = [{"rank": num(r["rank"]), "name": r["name"], "level": level_for(num(r["score"])),
                         "xp": num(r["score"]), "dead": r["name"] in dead_names} for r in rows]

    write_json("hiscores.json", {
        "status": "live", "updated": iso(now), "mode": mode, "overall": overall, "skills": skills,
        "notes": "Top 50 per table. In skill tables, 'dead' is only known for players also in the overall top 50."})
    return {"status": "live", "overall": len(overall), "skills": len(skills), "requests": http.requests}


if __name__ == "__main__":
    print(run(watcher=read_json("watcher.json", {})))
