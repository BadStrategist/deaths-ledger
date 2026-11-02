"""World firsts on Hardcore Worlds (data/firsts.json): the first players seen at 1000/1500/2000 total,
maxed, 99 in each skill, and on each boss and raid hiscore.

"First" means first spotted: the pipeline looks every ~10 minutes, so a first is the player (or players,
when several qualified between two looks) found when the threshold was first met. Boss and raid tables
only list a player after the hiscores' minimum kill count, so those firsts are "first on the boss
hiscores", not first kill. Jagex-confirmed firsts can be pinned with a source link in
site/assets/firsts-verified.json; the page shows those as verified.

Totals and 99s come from hiscores.json (already fetched this run). Boss tables are polled in rotation,
a few per run, and a table stops being polled once its first is claimed.
"""
import json

from common import Http, iso, load_config, now_ms, read_json, write_json
from hiscores import SKILLS, num

TOTALS = [1000, 1500, 2000]
MAX_TOTAL = 99 * len(SKILLS)
RAIDS = {31: "Chambers of Xeric", 32: "Chambers of Xeric: Challenge Mode", 76: "Theatre of Blood",
         77: "Theatre of Blood: Hard Mode", 80: "Tombs of Amascut", 81: "Tombs of Amascut: Expert Mode"}
# Hiscore activity table ids 20-91 (category=1), as listed by index_lite.json in late 2026.
BOSSES = {20: "Abyssal Sire", 21: "Alchemical Hydra", 22: "Amoxliatl", 23: "Araxxor", 24: "Artio",
          25: "Barrows Chests", 26: "Brutus", 27: "Bryophyta", 28: "Callisto", 29: "Calvar'ion", 30: "Cerberus",
          33: "Chaos Elemental", 34: "Chaos Fanatic", 35: "Commander Zilyana", 36: "Corporeal Beast",
          37: "Crazy Archaeologist", 38: "Dagannoth Prime", 39: "Dagannoth Rex", 40: "Dagannoth Supreme",
          41: "Deranged Archaeologist", 42: "Doom of Mokhaiotl", 43: "Duke Sucellus", 44: "General Graardor",
          45: "Giant Mole", 46: "Grotesque Guardians", 47: "Hespori", 48: "Kalphite Queen", 49: "King Black Dragon",
          50: "Kraken", 51: "Kree'Arra", 52: "K'ril Tsutsaroth", 53: "Lunar Chests", 54: "Mad Angel",
          55: "Maggot King", 56: "Mimic", 57: "Nex", 58: "Nightmare", 59: "Phosani's Nightmare", 60: "Obor",
          61: "Phantom Muspah", 62: "Sarachnis", 63: "Scorpia", 64: "Scurrius", 65: "Shellbane Gryphon",
          66: "Skotizo", 67: "Sol Heredit", 68: "Spindel", 69: "Tempoross", 70: "The Gauntlet",
          71: "The Corrupted Gauntlet", 72: "The Hueycoatl", 73: "The Leviathan", 74: "The Royal Titans",
          75: "The Whisperer", 78: "The Fractured Archive", 79: "Thermonuclear Smoke Devil", 82: "TzKal-Zuk",
          83: "TzTok-Jad", 84: "Vardorvis", 85: "Venenatis", 86: "Vet'ion", 87: "Vorkath", 88: "Wintertodt",
          89: "Yama", 90: "Zalcano", 91: "Zulrah"}
# Firsts worth a post on X; the rest only go on the page.
HEADLINE_BOSSES = {82, 83, 67, 57, 36, 58, 59, 71, 70, 87, 91, 21, 89, 23, 84, 75, 73, 43, 42, 66}
TABLES_PER_RUN = 16
NAMES_KEPT = 5


def _claim(firsts, fid, cat, label, rows, value_key, now, headline):
    if fid in firsts or not rows:
        return False
    rows = sorted(rows, key=lambda r: -(r.get(value_key) or 0))[:NAMES_KEPT]
    firsts[fid] = {"id": fid, "cat": cat, "label": label, "names": [r["name"] for r in rows],
                   "value": rows[0].get(value_key), "seen": iso(now), "headline": headline}
    return True


def run(http=None, watcher=None, now=None):
    now = now or now_ms()
    st = read_json("firsts.json", {})
    firsts = st.get("firsts") or {}
    hs = read_json("hiscores.json", {})
    conf = load_config()
    mode = conf["hiscore"]["mode"] if conf["hiscore"]["mode"] != "auto" else (watcher or {}).get("hiscore_mode")
    if not mode or hs.get("status") != "live":
        write_json("firsts.json", {"status": "waiting", "updated": iso(now), "mode": None, "firsts": firsts,
                                   "cursor": st.get("cursor", 0), "max_total": MAX_TOTAL})
        return {"status": "waiting"}

    new = 0
    overall = [r for r in hs.get("overall") or [] if r.get("total")]
    for t in TOTALS + [MAX_TOTAL]:
        label = "Max total level" if t == MAX_TOTAL else f"{t:,} total level"
        new += _claim(firsts, f"total-{t}", "total", label, [r for r in overall if r["total"] >= t], "total", now, True)
    for skill, rows in (hs.get("skills") or {}).items():
        new += _claim(firsts, f"99-{skill.lower()}", "99", f"99 {skill}",
                      [r for r in rows if (r.get("level") or 0) >= 99], "xp", now, True)

    # Boss and raid tables in rotation; claimed tables drop out.
    http = http or Http(delay=conf["hiscore"]["request_delay_seconds"])
    open_tables = [t for t in sorted({**RAIDS, **BOSSES}) if f"kc-{t}" not in firsts]
    cursor = st.get("cursor", 0)
    polled = 0
    for i in range(min(TABLES_PER_RUN, len(open_tables))):
        t = open_tables[(cursor + i) % len(open_tables)]
        polled += 1
        try:
            rows = _activity(http, mode, t)
        except RuntimeError:
            continue
        rows = [{"name": r["name"], "kc": num(r["score"])} for r in rows if num(r["score"]) > 0]
        raid = t in RAIDS
        new += _claim(firsts, f"kc-{t}", "raid" if raid else "boss", RAIDS.get(t) or BOSSES[t], rows, "kc", now,
                      raid or t in HEADLINE_BOSSES)
    cursor = (cursor + polled) % max(1, len(open_tables))

    write_json("firsts.json", {"status": "live", "updated": iso(now), "mode": mode, "firsts": firsts,
                               "cursor": cursor, "max_total": MAX_TOTAL})
    return {"status": "live", "claimed": len(firsts), "new": new, "polled": polled}


ACTIVITY = "https://secure.runescape.com/m={mode}/ranking.json?table={table}&category=1&size=10"


def _activity(http, mode, table):
    status, body = http.get(ACTIVITY.format(mode=mode, table=table), follow_redirects=False)
    if status != 200:
        raise RuntimeError(f"ranking.json activity {table} -> HTTP {status}")
    return json.loads(body)


if __name__ == "__main__":
    print(run(watcher=read_json("watcher.json", {})))
