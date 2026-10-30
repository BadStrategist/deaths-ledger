"""Population snapshot from RuneLite's public world list (the data the world hopper uses).

Writes data/population.json:
  latest  - per-world counts for Hardcore worlds right now
  history - [ms, hardcore_total, all_worlds_total], full resolution for a few days,
            then thinned to one point per hour.
"""
import json
import re

from common import Http, load_config, now_ms, read_json, write_json, iso

BOOTSTRAP = "https://static.runelite.net/bootstrap.json"
WORLDS = "https://api.runelite.net/runelite-{v}/worlds.js"


def fetch_worlds(http):
    status, body = http.get(BOOTSTRAP)
    if status != 200:
        raise RuntimeError(f"bootstrap.json -> {status}")
    version = json.loads(body)["version"]
    status, body = http.get(WORLDS.format(v=version))
    if status != 200:
        raise RuntimeError(f"worlds.js -> {status}")
    return json.loads(body)["worlds"]


def is_hardcore(world, cfg):
    types = set(world.get("types", []))
    if types & set(cfg["hardcore_world_types"]):
        return True
    return bool(re.search(cfg["hardcore_activity_regex"], world.get("activity") or ""))


def thin(history, now, cfg):
    """Keep every point for `history_days_full`, then one per hour, drop past `history_days_hourly`."""
    full_cut = now - cfg["history_days_full"] * 86400000
    drop_cut = now - cfg["history_days_hourly"] * 86400000
    out, seen_hours = [], set()
    for p in history:
        t = p[0]
        if t < drop_cut:
            continue
        if t >= full_cut:
            out.append(p)
            continue
        hour = t // 3600000
        if hour not in seen_hours:
            seen_hours.add(hour)
            out.append(p)
    return out


def run(http=None):
    cfg = load_config()["population"]
    http = http or Http(delay=0.2)
    worlds = fetch_worlds(http)
    now = now_ms()

    hc = [w for w in worlds if is_hardcore(w, cfg)]
    hc_total = sum(max(w.get("players", 0), 0) for w in hc)
    all_total = sum(max(w.get("players", 0), 0) for w in worlds)

    pop = read_json("population.json", {"history": []})
    history = pop.get("history", [])
    history.append([now, hc_total if hc else None, all_total])
    history = thin(history, now, cfg)

    hc_points = [p[1] for p in history if p[1] is not None]
    pop = {
        "updated": iso(now),
        "hardcore_worlds_listed": bool(hc),
        "hardcore_total": hc_total if hc else None,
        "all_worlds_total": all_total,
        "peak_hardcore": max(hc_points) if hc_points else None,
        "worlds": sorted(
            [{"id": w["id"], "players": w.get("players", 0), "region": w.get("region"),
              "activity": w.get("activity"), "types": w.get("types", [])} for w in hc],
            key=lambda w: -w["players"]),
        "history": history,
    }
    write_json("population.json", pop, compact=True)
    # The watcher reads the raw type list to spot new world types.
    return {"world_types": sorted({t for w in worlds for t in w.get("types", [])}),
            "worlds": worlds, "hardcore_count": len(hc)}


if __name__ == "__main__":
    r = run()
    print(f"worlds ok: {len(r['worlds'])} worlds, {r['hardcore_count']} hardcore, types={r['world_types']}")
