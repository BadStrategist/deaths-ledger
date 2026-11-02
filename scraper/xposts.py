"""Automatic posts to X (@osrsdeathtoll) from the ledger's own data.

Runs after the graveyard step. Every post has a dedupe key kept in xposts.json (state branch),
so a post goes out once no matter how many runs see the same event. Text only, no links:
X charges ~13x more for a post with a URL, and deathtoll.gg is in the bio.

Dry run (the default, and whenever the four X_* secrets are missing): nothing is sent; the posts
it would have made land in xposts.json "outbox" so they can be read first.
Go live: set config x.dry_run to false and add the secrets X_API_KEY, X_API_SECRET,
X_ACCESS_TOKEN, X_ACCESS_SECRET (an app with Read and Write on the @osrsdeathtoll account).

Posts never name where the data comes from.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from common import Http, iso, load_config, now_ms, read_json, write_json

POST_URL = "https://api.x.com/2/tweets"
GE_API = "https://prices.runescape.wiki/api/v1/osrs/"
HOUR = 3600000
DAY = 24 * HOUR
DEFAULTS = {
    "dry_run": True,
    "launch_at": "2026-11-04T11:30:00Z",
    "max_per_run": 3,
    "max_per_day": 24,
    "big_death_min_total": 1500,
    "big_deaths_per_day": 8,
    "record_min_total": 200,
    "record_cooldown_minutes": 45,
    "death_milestones": [1, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000],
    "peak_min_players": 1000,
    "peak_step": 0.05,
    "peak_cooldown_hours": 6,
    "daily_recap_hour_utc": 0,
    "ge_post_hour_utc": 17,
    "ge_min_price": 1000000,
}


# ---------- text helpers ----------

def gp(n):
    for div, suf in ((1e9, "b"), (1e6, "m"), (1e3, "k")):
        if n >= div:
            v = n / div
            return (f"{v:.2f}".rstrip("0").rstrip(".") if v < 10 else f"{v:.1f}".rstrip("0").rstrip(".")) + suf
    return str(int(n))


def num(n):
    return f"{int(n):,}"


def best_skill(d):
    sk = d.get("top_skills") or []
    return f"{sk[0][1]} {sk[0][0]}" if sk else None


def death_line(d):
    bits = [f"total level {num(d['total'])}"]
    if d.get("combat"):
        bits.append(f"combat {d['combat']}")
    s = best_skill(d)
    if s:
        bits.append(s)
    return ", ".join(bits)


def cap(s):
    return s[:1].upper() + s[1:]


def ordinal(n):
    return f"{n:,}" + ("th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


# ---------- what to post ----------

def candidates(g, pop, st, cfg, now, http):
    """Yields (key, text, kind) in priority order. Keys already in st["done"] are skipped later."""
    out = []
    live = g.get("status") == "live"
    deaths = [d for d in (g.get("deaths") or []) if d.get("fate") == "died" and d.get("time")]
    recent = [d for d in deaths if now - d["time"] < 2 * DAY]
    launch = _ms(cfg["launch_at"])

    if live and deaths:
        first = min(deaths, key=lambda d: d["time"])
        out.append(("first-death", f"The first grave on Hardcore Worlds belongs to {first['name']}.\n\n"
                    f"{cap(death_line(first))}. One life. Death is patient.", "first"))

        # New highest total ever lost, at most one per cooldown; always the current top.
        top = max(deaths, key=lambda d: d.get("total") or 0)
        rec = st.get("record_total") or 0
        cool = (now - (st.get("record_at") or 0)) >= cfg["record_cooldown_minutes"] * 60000
        record_key = None
        if (top.get("total") or 0) > rec and top["total"] >= cfg["record_min_total"] and cool and top is not first:
            record_key = f"big-{top['name'].lower()}|{top.get('run', 1)}"
            out.append((f"record-{top['total']}", f"New record: the highest total level lost on Hardcore Worlds is now "
                        f"{num(top['total'])}.\n\n{top['name']} has fallen ({death_line(top)}).", "record"))

        # Big deaths: each one once, biggest first, a daily cap so a bad hour can't flood the feed.
        for d in sorted(recent, key=lambda d: -(d.get("total") or 0)):
            if (d.get("total") or 0) < cfg["big_death_min_total"]:
                break
            if f"big-{d['name'].lower()}|{d.get('run', 1)}" == record_key:
                continue   # the record post already covers this grave
            boss = d.get("top_boss")
            tail = f" {boss[1]:,} {boss[0]} kills." if boss and boss[1] else ""
            out.append((f"big-{d['name'].lower()}|{d.get('run', 1)}",
                        f"{d['name']} has fallen on Hardcore Worlds.\n\n{cap(death_line(d))}.{tail}\n\nThe ledger remembers.", "big"))

    if live:
        total = (g.get("counts") or {}).get("all_time") or 0
        hit = [m for m in cfg["death_milestones"] if m > 1 and total >= m]
        if hit:
            m = hit[-1]
            out.append((f"milestone-{m}", f"{num(m)} graves on Hardcore Worlds.\n\nThe {ordinal(m)} grave just went up. Death is patient.", "milestone"))

        # Deaths in the first hour, posted once the hour is over.
        if launch and launch + HOUR <= now < launch + 6 * HOUR:
            n = sum(1 for d in deaths if launch <= d["time"] < launch + HOUR)
            if n:
                out.append(("first-hour", f"{num(n)} {'player' if n == 1 else 'players'} died in the first hour of Hardcore Worlds.\n\nOne life. They spent it fast.", "first-hour"))

        # Daily recap of the last 24 hours, once per UTC day at the configured hour.
        day = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
        if day.hour == cfg["daily_recap_hour_utc"] and now - launch > 6 * HOUR:
            last24 = [d for d in deaths if now - d["time"] < DAY]
            if last24:
                hi = max(last24, key=lambda d: d.get("total") or 0)
                out.append((f"recap-{day:%Y-%m-%d}", f"The last 24 hours on Hardcore Worlds:\n\n"
                            f"☠ {num(len(last24))} fell\n⬆ Highest total lost: {num(hi['total'])} ({hi['name']})\n"
                            f"⚰ {num(total)} graves in all", "recap"))

    # Player count: a new all-time peak, at least peak_step above the last posted one.
    hc = (pop or {}).get("hardcore_total")
    st["peak_seen"] = max(st.get("peak_seen") or 0, hc or 0, (pop or {}).get("peak_hardcore") or 0)
    if hc and hc >= cfg["peak_min_players"] and hc >= st["peak_seen"]:
        last = st.get("peak_posted") or 0
        cool = now - (st.get("peak_at") or 0) >= cfg["peak_cooldown_hours"] * HOUR
        if hc >= last * (1 + cfg["peak_step"]) and cool:
            out.append((f"peak-{hc}", f"{num(hc)} players are on Hardcore Worlds right now. A new high.\n\nEvery one of them has one life.", "peak"))

    # GE: the most expensive item that actually traded in the latest hour, once a day.
    day = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
    key = f"ge-{day:%Y-%m-%d}"
    if day.hour == cfg["ge_post_hour_utc"] and key not in st["done"]:
        txt = ge_post(http, cfg)
        if txt:
            out.append((key, txt, "ge"))
    return out


def ge_post(http, cfg):
    s1, hour = http.get(GE_API + "1h")
    s2, mapping = http.get(GE_API + "mapping")
    if s1 != 200 or s2 != 200:
        return None
    names = {str(m["id"]): m["name"] for m in json.loads(mapping) if m.get("name")}
    rows = []
    for iid, a in (json.loads(hour).get("data") or {}).items():
        for price, vol in ((a.get("avgHighPrice"), a.get("highPriceVolume")), (a.get("avgLowPrice"), a.get("lowPriceVolume"))):
            if price and vol and price >= cfg["ge_min_price"] and iid in names:
                rows.append((price, names[iid]))
    if not rows:
        return None
    rows.sort(reverse=True)
    seen, top = set(), []
    for price, name in rows:
        if name not in seen:
            seen.add(name)
            top.append((price, name))
        if len(top) == 3:
            break
    lines = "\n".join(f"{i}. {n}: {gp(p)} gp" for i, (p, n) in enumerate(top, 1))
    return f"Most expensive items sold on the Grand Exchange in the last hour:\n\n{lines}\n\nOne mistake and it's someone else's."


# ---------- sending ----------

def _ms(s):
    try:
        return int(datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
    except (TypeError, ValueError):
        return 0


def _keys():
    k = [os.environ.get(n) for n in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET")]
    return k if all(k) else None


def _pct(s):
    return urllib.parse.quote(str(s), safe="~-._")


def sign(method, url, params, consumer_secret, token_secret):
    """OAuth 1.0a HMAC-SHA1. The JSON body is not signed (only form bodies are)."""
    pairs = sorted((_pct(k), _pct(v)) for k, v in params.items())
    base = "&".join([method, _pct(url), _pct("&".join(f"{k}={v}" for k, v in pairs))])
    key = f"{_pct(consumer_secret)}&{_pct(token_secret)}".encode()
    return base64.b64encode(hmac.new(key, base.encode(), hashlib.sha1).digest()).decode()


def send(text, keys):
    """POST /2/tweets with OAuth 1.0a user context. Returns (ok, status, detail)."""
    ck, cs, tk, ts = keys
    oauth = {"oauth_consumer_key": ck, "oauth_nonce": secrets.token_hex(16), "oauth_signature_method": "HMAC-SHA1",
             "oauth_timestamp": str(int(time.time())), "oauth_token": tk, "oauth_version": "1.0"}
    oauth["oauth_signature"] = sign("POST", POST_URL, oauth, cs, ts)
    auth = "OAuth " + ", ".join(f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth.items()))
    req = urllib.request.Request(POST_URL, data=json.dumps({"text": text}).encode(), method="POST",
                                 headers={"Authorization": auth, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, r.status, json.loads(r.read().decode() or "{}").get("data", {}).get("id")
    except urllib.error.HTTPError as e:
        return False, e.code, e.read().decode("utf-8", "replace")[:300]
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, 0, str(e)[:300]


def run(now=None, http=None):
    cfg = {**DEFAULTS, **(load_config().get("x") or {})}
    now = now or now_ms()
    st = read_json("xposts.json", {})
    st.setdefault("done", {})
    st.setdefault("outbox", [])
    st.setdefault("sent", [])
    keys = _keys()
    dry = cfg["dry_run"] or not keys
    g = read_json("graveyard.json", {})
    pop = read_json("population.json", {})

    today = datetime.fromtimestamp(now / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    sent_today = [s for s in st["sent"] if s["day"] == today]
    big_today = sum(1 for s in sent_today if s["kind"] == "big")
    made = []
    for key, text, kind in candidates(g, pop, st, cfg, now, http or Http()):
        if key in st["done"]:
            continue
        if len(made) >= cfg["max_per_run"] or len(sent_today) + len(made) >= cfg["max_per_day"]:
            break
        if kind == "big" and big_today >= cfg["big_deaths_per_day"]:
            continue
        if dry:
            ok, status, detail = True, None, "dry run"
        else:
            ok, status, detail = send(text, keys)
            if not ok and not (status == 403 and "duplicate" in str(detail).lower()):  # duplicate = already out
                print(f"xposts: send failed {status} {detail}")
                if status in (401, 402, 403, 429):
                    break   # bad keys, out of credit, or rate-limited: try again next run
                continue
        st["done"][key] = now
        made.append({"key": key, "kind": kind, "day": today, "at": iso(now), "text": text,
                     "dry": dry, "status": status, "id": detail if ok and not dry else None})
        if kind == "big":
            big_today += 1
        if kind == "first":
            first = min((d for d in g["deaths"] if d.get("fate") == "died" and d.get("time")), key=lambda d: d["time"])
            st["record_total"] = max(st.get("record_total") or 0, first.get("total") or 0)
        if kind == "record":
            st["record_total"] = int(key.split("-")[1])
            st["record_at"] = now
            for d in g["deaths"]:
                if d.get("total") == st["record_total"]:
                    st["done"].setdefault(f"big-{d['name'].lower()}|{d.get('run', 1)}", now)
        if kind == "peak":
            st["peak_posted"] = int(key.split("-")[1])
            st["peak_at"] = now

    st["sent"] = [s for s in st["sent"] if now - _ms(s["at"]) < 7 * DAY] + [m for m in made if not m["dry"]]
    st["outbox"] = (st["outbox"] + [m for m in made if m["dry"]])[-60:]
    st["done"] = {k: v for k, v in st["done"].items() if now - v < 30 * DAY or not k.startswith(("big-", "record-", "peak-"))}
    st["last_run"] = iso(now)
    st["mode"] = "dry run" + ("" if keys else " (no X keys)") if dry else "live"
    write_json("xposts.json", st)
    return {"mode": st["mode"], "posted": len(made)}


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
