"""One pipeline run: population -> watcher -> hiscores -> graveyard -> X posts.

Each step is isolated: one failing never stops the others. Results go to data/status.json
(the site's Data watcher page shows them). Exits 1 if any step failed, so the failure is
visible in GitHub Actions, while the workflow still publishes whatever succeeded.
"""
import sys
import traceback

import graveyard
import hiscores
import population
import watcher
import xposts
from common import now_ms, iso, read_json, write_json


def step(name, fn, results):
    started = now_ms()
    try:
        out = fn()
        results[name] = {"ok": True, "at": iso(started), "ms": now_ms() - started}
        return out
    except Exception as e:  # noqa: BLE001 - every failure must be recorded, never fatal
        traceback.print_exc()
        results[name] = {"ok": False, "at": iso(started), "ms": now_ms() - started,
                         "error": f"{type(e).__name__}: {e}"[:300]}
        return None


def main():
    results = {}
    pop = step("population", population.run, results)
    w = step("watcher", lambda: watcher.run(world_types=(pop or {}).get("world_types")), results)
    if w is None:
        w = read_json("watcher.json", {})
    step("hiscores", lambda: hiscores.run(watcher=w), results)
    g = step("graveyard", lambda: graveyard.run(watcher=w), results)
    step("xposts", xposts.run, results)

    status = read_json("status.json", {})
    status["last_run"] = iso(now_ms())
    status["steps"] = results
    if g:
        status["graveyard"] = g
    for name, r in results.items():
        if r["ok"]:
            status.setdefault("last_ok", {})[name] = r["at"]
    write_json("status.json", status)
    print(status)
    return 0 if all(r["ok"] for r in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
