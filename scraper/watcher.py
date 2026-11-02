"""Watches for the data sources Hardcore Worlds will add, so the site switches over by itself.

- Hiscores: reads every mode linked from the main hiscore page and probes likely names.
- Prices: probes likely routes on the OSRS Wiki real-time price API.
- Worlds: reports world types that did not exist before launch.

Writes data/watcher.json. `hiscore_mode` in it is what the graveyard uses when config mode is "auto".
"""
import json
import os
import re

from common import Http, load_config, now_ms, read_json, write_json, iso

HISCORE_INDEX = "https://secure.runescape.com/m=hiscore_oldschool/overall"
RANKING_JSON = "https://secure.runescape.com/m={mode}/ranking.json?table=0&category=0&size=1"
PRICES = "https://prices.runescape.wiki/api/v1/{route}/latest?id=2"


def mode_exists(http, mode):
    status, body = http.get(RANKING_JSON.format(mode=mode), follow_redirects=False)
    if status != 200:
        return False
    try:
        return isinstance(json.loads(body), list)
    except json.JSONDecodeError:
        return False


def pick_hardcore_mode(modes):
    for m in modes:
        if "hardcore" in m and "ironman" not in m:
            return m
    return None


def run(http=None, world_types=None):
    cfg = load_config()
    http = http or Http(delay=0.5)
    now = now_ms()
    prev = read_json("watcher.json", {})
    events = prev.get("events", [])
    first_seen = {e["what"] for e in events}

    def event(what, detail):
        if what not in first_seen:
            events.append({"t": iso(now), "what": what, "detail": detail})
            first_seen.add(what)

    # --- hiscores ---
    status, body = http.get(HISCORE_INDEX)
    # Reachability check from wherever this runs: the graveyard is useless if these fail.
    probe = {"index": status, "index_via": "direct"}
    if status == 403:
        # GitHub's servers get a 403 here. Page 1 of the main rankings links every hiscore table
        # too, and the Cloudflare relay (worker/, GET /hs) can fetch it.
        relay, key = cfg["hiscore"].get("relay"), os.environ.get("LEDGER_RELAY_KEY")
        if relay and key:
            status, body = http.get(f"{relay.rstrip('/')}/hs?mode=hiscore_oldschool&table=0&page=1",
                                    headers={"X-Ledger-Key": key})
            probe.update(index=status, index_via="relay")
    for name, url in (("ranking_json", RANKING_JSON.format(mode="hiscore_oldschool")),
                      ("page", "https://secure.runescape.com/m=hiscore_oldschool/overall?table=0&page=2")):
        s, b = http.get(url, follow_redirects=False)
        probe[name] = s
        probe[name + "_head"] = b[:160]
    linked = sorted(set(re.findall(r"m=(hiscore_oldschool[a-z_]*)", body))) if status == 200 else []
    new_modes = [m for m in linked if m not in cfg["hiscore"]["known_modes"]]
    probed = [m for m in cfg["hiscore"]["candidate_modes"] if mode_exists(http, m)]
    for m in new_modes + probed:
        event(f"hiscore:{m}", f"New hiscore table found: {m}")
    hc_mode = pick_hardcore_mode(new_modes + probed) or prev.get("hiscore_mode")

    # --- prices ---
    price_route = prev.get("price_route")
    for route in cfg["prices"]["candidate_routes"]:
        s, b = http.get(PRICES.format(route=route))
        if s == 200 and '"data"' in b:
            price_route = route
            event(f"prices:{route}", f"Wiki price feed found: /api/v1/{route}")
            break

    # --- world types ---
    new_types = sorted(set(world_types or []) - set(cfg["population"]["known_world_types"]))
    for t in new_types:
        event(f"worldtype:{t}", f"New world type on the world list: {t}")

    out = {
        "checked": iso(now),
        "hiscore_index_ok": status == 200,
        "hiscore_probe": probe,
        "hiscore_modes_linked": linked,
        "new_hiscore_modes": new_modes,
        "hiscore_mode": hc_mode,
        "price_route": price_route,
        "new_world_types": new_types,
        "events": events[-200:],
    }
    write_json("watcher.json", out)
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
