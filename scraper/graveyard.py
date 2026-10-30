"""The Graveyard: finds Hardcore Worlds deaths from the official hiscores.

Two ways a death shows up, both handled:
  1. Skull rows. The Hardcore Ironman hiscores keep dead players with a skull whose
     tooltip holds the death time to the minute. If the Hardcore Worlds table does the
     same, every death is exact.
  2. Disappearances. If dead players are removed instead, a player who was ranked in
     the last full scan and is missing from two scans in a row, and whose personal
     lookup 404s, is recorded as fallen. If they come back with less XP it was a
     reset; if they come back with the same or more XP it was not a death and the
     record is removed.
  Separately, a ranked player whose XP went DOWN has reset (XP never drops otherwise).

For each new death, the personal JSON lookup adds world, exact tile, killer fields and
the stats at death.

Scans stop at the page where total level drops below the listing threshold, which rises
as the hiscores grow (config.json -> listing.scale_steps). The scan resumes across runs.
"""
import html
import json
import re
import time
import urllib.parse
from datetime import datetime, timezone

from common import Http, load_config, now_ms, read_json, write_json, iso

BASE = "https://secure.runescape.com/m={mode}"
PAGE = BASE + "/overall?table=0&page={page}"
PLAYER = BASE + "/index_lite.json?player={name}"
PER_PAGE = 25

# Dead players' rows carry an extra "personal-hiscores__row--dead" class.
ROW_RE = re.compile(r'<tr class="personal-hiscores__row( personal-hiscores__row--dead)?">(.*?)</tr>', re.S)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
NAME_RE = re.compile(r'<a href="hiscorepersonal\?user1=[^"]*">(.*?)</a>', re.S)
DEATH_RE = re.compile(r'class="hiscore-death"[^>]*title="Player died:\s*([^"]+?)\s*"')
TAG_RE = re.compile(r"<[^>]+>")

SKILLS_NOT_SHOWN = {"Overall"}
NOT_BOSSES = re.compile(r"(?i)clue|points|rank|rifts|collections|league|bounty|lms|soul wars|colosseum glory|grid")


# ---------------------------------------------------------------- parsing

def key(name):
    return re.sub(r"[\s_\- ]+", " ", name).strip().lower()


def num(s):
    s = TAG_RE.sub("", s).replace(",", "").strip()
    return int(s) if s.isdigit() else None


def parse_page(body):
    rows = []
    for dead_class, row in ROW_RE.findall(body):
        cells = CELL_RE.findall(row)
        m = NAME_RE.search(row)
        if not m:
            continue
        nums = [num(c) for c in cells if "hiscorepersonal" not in c]  # a name can be all digits
        nums = [n for n in nums if n is not None]
        if len(nums) < 3:
            continue
        name = html.unescape(TAG_RE.sub("", m.group(1))).replace(" ", " ").strip()
        d = DEATH_RE.search(row)
        died = None
        if d:
            try:
                died = int(datetime.strptime(d.group(1).strip(), "%d-%b-%Y %H:%M")
                           .replace(tzinfo=timezone.utc).timestamp() * 1000)
            except ValueError:
                died = 0  # skull present, unreadable time: still a death
        elif dead_class:
            died = 0
        rows.append({"rank": nums[0], "name": name, "total": nums[1], "xp": nums[2], "died": died})
    return rows


def fetch_page(http, mode, page):
    """Returns rows, or None when the page is past the end (the site then serves page 1)."""
    status, body = http.get(PAGE.format(mode=mode, page=page))
    if status != 200:
        raise RuntimeError(f"hiscore page {page} -> HTTP {status}")
    rows = parse_page(body)
    if not rows:
        return None
    if page > 1 and rows[0]["rank"] != (page - 1) * PER_PAGE + 1:
        return None
    return rows


def fetch_player(http, mode, name):
    status, body = http.get(PLAYER.format(mode=mode, name=urllib.parse.quote(name)))
    if status == 404 or (status == 200 and body.lstrip().startswith("<")):
        return None  # not on the hiscores
    if status != 200:
        raise RuntimeError(f"player lookup {name} -> HTTP {status}")
    return json.loads(body)


MAIN_PLAYER = "https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player={name}"


def on_main_game(http, name, xp):
    """Transfer check: a character banished to the main game keeps its stats, so it shows up on
    the main hiscores with at least the XP it had on Hardcore Worlds. Display names are unique
    game-wide (to verify at launch), so the same name with that XP is the same character."""
    status, body = http.get(MAIN_PLAYER.format(name=urllib.parse.quote(name)))
    if status != 200 or body.lstrip().startswith("<"):
        return False
    overall = next((s for s in json.loads(body).get("skills", []) if s.get("name") == "Overall"), {})
    return (overall.get("xp") or 0) >= (xp or 0)


# ---------------------------------------------------------------- scan sizing

def last_page(http, mode, hint=1):
    """Last page that exists. Gallops up from the previous answer, then bisects."""
    lo = max(1, hint)
    if fetch_page(http, mode, lo) is None:
        lo = 1
        if fetch_page(http, mode, 1) is None:
            return 0
    hi = lo * 2
    while fetch_page(http, mode, hi) is not None:
        lo, hi = hi, hi * 2
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if fetch_page(http, mode, mid) is None:
            hi = mid
        else:
            lo = mid
    return lo


def cutoff_page(http, mode, pages, min_total):
    """Last page that still has a player at or above min_total (overall is sorted by total)."""
    if min_total <= 0 or pages == 0:
        return pages
    lo, hi = 1, pages
    first = fetch_page(http, mode, 1)
    if not first or first[0]["total"] < min_total:
        return 0
    while lo < hi:
        mid = (lo + hi + 1) // 2
        rows = fetch_page(http, mode, mid)
        if rows and rows[0]["total"] >= min_total:
            lo = mid
        else:
            hi = mid - 1
    return lo


def min_total_for(cfg, ranked):
    if cfg.get("min_total_override") is not None:
        return cfg["min_total_override"]
    m = 0
    for step in cfg["scale_steps"]:
        if ranked >= step["ranked_players"]:
            m = step["min_total"]
    return m


# ---------------------------------------------------------------- death details

def decode_location(v):
    if v is None or v < 0:
        return None
    x, y, plane = (v >> 14) & 0x3FFF, v & 0x3FFF, v >> 28
    # The real map (surface + underground) sits inside x 1000-4200, y 2400-13000. Instances are
    # placed far outside it, and some records carry junk like (1249, 1249): never plot those.
    return {"x": x, "y": y, "plane": plane, "on_map": 1000 <= x <= 4200 and 2400 <= y <= 13000}


def details(player):
    """Stats at death + Jagex's death record (if present) from a personal JSON lookup."""
    if not player:
        return {}
    skills = player.get("skills", [])
    overall = next((s for s in skills if s.get("name") == "Overall"), {})
    # Best skills = highest level, then best rank, so a 99 the player is known for beats a 99 Hitpoints.
    top = sorted((s for s in skills if s.get("name") not in SKILLS_NOT_SHOWN and s.get("level", 0) > 1),
                 key=lambda s: (-s.get("level", 0), s["rank"] if s.get("rank", -1) > 0 else 10**9))[:3]
    bosses = sorted((a for a in player.get("activities", [])
                     if a.get("score", 0) > 0 and not NOT_BOSSES.search(a.get("name", ""))),
                    key=lambda a: -a["score"])
    combat = None
    lv = {s["name"]: max(s.get("level", 1), 1) for s in skills}
    if lv:
        base = 0.25 * (lv.get("Defence", 1) + lv.get("Hitpoints", 10) + lv.get("Prayer", 1) // 2)
        melee = 0.325 * (lv.get("Attack", 1) + lv.get("Strength", 1))
        rng = 0.325 * (lv.get("Ranged", 1) * 3 // 2)
        mag = 0.325 * (lv.get("Magic", 1) * 3 // 2)
        combat = int(base + max(melee, rng, mag))
    out = {
        "total": overall.get("level"),
        "xp": overall.get("xp"),
        "combat": combat,
        "top_skills": [[s["name"], s["level"]] for s in top],
        "top_boss": [bosses[0]["name"], bosses[0]["score"]] if bosses else None,
    }
    death = overall.get("death")
    if death:
        out["death_time"] = death.get("timeStamp")
        out["world"] = death.get("worldID") if (death.get("worldID") or 0) > 0 else None
        out["location"] = decode_location(death.get("location"))
        for k_src, k_dst in (("npcKiller", "npc_killer"), ("playerKiller", "player_killer"),
                             ("deathReason", "death_reason")):
            v = death.get(k_src)
            out[k_dst] = v if v not in (None, -1) else None
        out["location_text"] = death.get("locationDescription") or None
        out["death_text"] = death.get("deathDescription") or None
    return out


# ---------------------------------------------------------------- main

def fresh_state(mode):
    return {"mode": mode, "pages": 0, "ranked": 0, "min_total": 0,
            "cycle": None, "roster": {}, "skulls": {}, "pending": {}, "ghosts": {}, "runs": {}}


def run(http=None, watcher=None):
    conf = load_config()
    hcfg, lcfg = conf["hiscore"], conf["listing"]
    mode = hcfg["mode"] if hcfg["mode"] != "auto" else (watcher or {}).get("hiscore_mode")
    since = int(datetime.strptime(hcfg["deaths_since"], "%Y-%m-%dT%H:%M:%SZ")
                .replace(tzinfo=timezone.utc).timestamp() * 1000)
    now = now_ms()
    deaths = read_json("deaths.json", [])

    if not mode:
        publish(deaths, None, now, lcfg, status="waiting")
        return {"status": "waiting for the Hardcore Worlds hiscores"}

    http = http or Http(delay=hcfg["request_delay_seconds"])
    st = read_json("state.json", None)
    if not st or st.get("mode") != mode:
        st = fresh_state(mode)
    deadline = time.monotonic() + hcfg["run_budget_seconds"]
    by_key = {d["key"] + "|" + str(d["run"]): d for d in deaths}
    new_deaths = 0

    def add_death(name, rec):
        nonlocal new_deaths
        k = key(name)
        run_no = st["runs"].get(k, 0) + 1
        st["runs"][k] = run_no
        rec.update({"key": k, "name": name, "run": run_no})
        rec["notable"] = (rec.get("total") or 0) >= lcfg["notable_total"]
        deaths.append(rec)
        by_key[k + "|" + str(run_no)] = rec
        new_deaths += 1
        return rec

    # --- start a cycle: size the table and pick the cutoff ---
    if not st["cycle"]:
        st["pages"] = last_page(http, mode, st.get("pages") or 1)
        st["ranked"] = st["pages"] * PER_PAGE
        st["min_total"] = min_total_for(lcfg, st["ranked"])
        st["cycle"] = {"started": now, "page": 1,
                       "stop": cutoff_page(http, mode, st["pages"], st["min_total"]), "seen": {}}

    cyc = st["cycle"]
    while cyc["page"] <= cyc["stop"] and time.monotonic() < deadline:
        rows = fetch_page(http, mode, cyc["page"])
        if rows is None:
            break
        for r in rows:
            k = key(r["name"])
            if r["died"] is not None:
                if k not in st["skulls"]:
                    st["skulls"][k] = r["died"]
                    if r["died"] == 0 or r["died"] >= since:
                        info = details(fetch_player(http, mode, r["name"]))
                        add_death(r["name"], {
                            "fate": "died", "time": info.get("death_time") or r["died"] or now,
                            "time_exact": bool(info.get("death_time") or r["died"]),
                            "total": r["total"], "xp": r["xp"], **{x: y for x, y in info.items()
                                                                   if x not in ("total", "xp", "death_time")}})
                continue
            if r["total"] < st["min_total"] or k in cyc["seen"]:
                continue  # below the line, or already seen this scan (ranks shift while we page)
            cyc["seen"][k] = [r["name"], r["total"], r["xp"], now]
            old = st["roster"].get(k)
            ghost = st["ghosts"].get(k)
            if ghost:
                rec = by_key.get(ghost)
                if rec and r["xp"] < rec.get("xp", 0):
                    rec["fate"] = "reset"          # came back with less XP: it was a reset
                elif rec:
                    deaths.remove(rec)             # came back intact: not a death
                    st["runs"][k] = max(st["runs"].get(k, 1) - 1, 0)
                st["ghosts"].pop(k, None)
            elif old and r["xp"] < old[2]:
                add_death(r["name"], {"fate": "reset", "time": now, "time_exact": False,
                                      "window_start": old[3], "total": old[1], "xp": old[2]})
        cyc["page"] += 1

    # --- finish a cycle: who went missing? ---
    if cyc["page"] > cyc["stop"]:
        seen = cyc["seen"]
        for k, old in st["roster"].items():
            if k in seen or k in st["skulls"] or k in st["ghosts"] or old[1] < st["min_total"]:
                continue
            st["pending"].setdefault(k, {"old": old, "misses": 0})
        for k in list(st["pending"]):
            if k in seen or k in st["skulls"]:
                st["pending"].pop(k)
                continue
            p = st["pending"][k]
            p["misses"] += 1
            if p["misses"] < 2 or time.monotonic() > deadline + 300:
                continue
            name, total, xp, last_seen = p["old"]
            player = fetch_player(http, mode, name)
            if player is None:
                banished = on_main_game(http, name, xp)
                rec = add_death(name, {"fate": "banished" if banished else "fallen", "time": now,
                                       "time_exact": False, "window_start": last_seen,
                                       "total": total, "xp": xp})
                if not banished:
                    st["ghosts"][k] = k + "|" + str(rec["run"])  # may still turn out a reset or a transfer
            else:
                info = details(player)
                if (info.get("xp") or 0) < xp:
                    add_death(name, {"fate": "reset", "time": now, "time_exact": False,
                                     "window_start": last_seen, "total": total, "xp": xp})
                else:
                    seen[k] = [name, info.get("total"), info.get("xp"), now]  # still alive
            st["pending"].pop(k)
        # Still-unexplained disappearances: a transfer can show up on the main hiscores later.
        # Bounded per cycle so a big backlog never eats the run.
        for k, ghost in list(st["ghosts"].items())[:40]:
            rec = by_key.get(ghost)
            st["ghosts"].pop(k)
            if rec and rec["fate"] == "fallen" and on_main_game(http, rec["name"], rec.get("xp")):
                rec["fate"] = "banished"
            else:
                st["ghosts"][k] = ghost  # back of the queue: the next cycle checks others first
        st["roster"] = {k: v for k, v in seen.items()}
        st["cycle"] = None
        st["last_cycle_done"] = now

    deaths.sort(key=lambda d: -d["time"])
    write_json("deaths.json", deaths, compact=True)
    write_json("state.json", st, compact=True)
    publish(deaths, st, now, lcfg, status="live")
    return {"mode": mode, "pages": st["pages"], "stop": (st["cycle"] or {}).get("stop"),
            "min_total": st["min_total"], "new_deaths": new_deaths, "requests": http.requests,
            "cycle_page": (st["cycle"] or {}).get("page")}


def publish(deaths, st, now, lcfg, status):
    listed = [d for d in deaths if (d.get("total") or 0) >= ((st or {}).get("min_total") or 0)]
    day = now - 86400000
    hours = [0] * 24
    for d in listed:
        age = (now - d["time"]) // 3600000
        if 0 <= age < 24:
            hours[23 - age] += 1
    write_json("graveyard.json", {
        "updated": iso(now),
        "status": status,
        "mode": (st or {}).get("mode"),
        "ranked_players": (st or {}).get("ranked"),
        "min_total": (st or {}).get("min_total"),
        "last_full_scan": iso(st["last_cycle_done"]) if st and st.get("last_cycle_done") else None,
        "counts": {
            "today": sum(1 for d in listed if d["time"] >= day),
            "all_time": len(listed),
            "resets": sum(1 for d in listed if d["fate"] == "reset"),
            "highest_total": max((d.get("total") or 0 for d in listed), default=0),
        },
        "deaths_per_hour": hours,
        "deaths": [{k: v for k, v in d.items() if k != "key"} for d in listed[:400]],
    })


if __name__ == "__main__":
    import sys
    print(json.dumps(run(watcher=read_json("watcher.json", {})), indent=1))
