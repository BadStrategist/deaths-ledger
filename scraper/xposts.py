"""Automatic posts to X (@osrsdeathtoll) from the ledger's own data.

Runs after the graveyard step. Every post has a dedupe key kept in xposts.json (state branch),
so a post goes out once no matter how many runs see the same event. Text only (plus a card image on world firsts), no links:
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
MEDIA_URL = "https://api.x.com/2/media/upload"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GE_API = "https://prices.runescape.wiki/api/v1/{route}/"
HOUR = 3600000
DAY = 24 * HOUR
DEFAULTS = {
    "dry_run": True,
    "launch_at": "2026-11-04T11:30:00Z",
    "max_per_run": 3,
    "max_per_day": 60,
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
    "world_firsts_per_day": 40,
    "world_first_max_late_days": 7,
    "leader_hour_utc": 20,
    "place_hour_utc": 21,
    "place_min_deaths": 10,
    "deadliest_hour_min": 25,
    "deadliest_hour_cooldown_hours": 6,
    "reset_milestones": [100, 500, 1000, 2500, 5000, 10000, 25000, 50000],
}
REGIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "assets", "map-regions.json")


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


def names_line(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def est(ms):
    """'7pm' style hour in US Eastern (the main audience); falls back to UTC if no tz database."""
    try:
        from zoneinfo import ZoneInfo
        t, zone = datetime.fromtimestamp(ms / 1000, tz=ZoneInfo("America/New_York")), "ET"
    except Exception:  # noqa: BLE001
        t, zone = datetime.fromtimestamp(ms / 1000, tz=timezone.utc), "UTC"
    h = t.hour % 12 or 12
    return f"{h}{'am' if t.hour < 12 else 'pm'}", zone, t


def region_name(loc, regions):
    if not loc or not loc.get("on_map"):
        return None
    return regions.get(str(((loc["x"] >> 6) << 8) | (loc["y"] >> 6)))


def ordinal(n):
    return f"{n:,}" + ("th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


# ---------- world-first post text ----------

SKILL_LINES = {
    "Attack": "Every swing made on one life.", "Defence": "Hit after hit. Never broken.",
    "Strength": "All that power, and one life to lose it.", "Hitpoints": "All that health. Still only one life.",
    "Ranged": "Every arrow loosed on one life.", "Prayer": "The gods are listening. So is Death.",
    "Magic": "Every spell cast on one life.", "Cooking": "Thousands of meals. Never the last one.",
    "Woodcutting": "The trees fell. They didn't.", "Fletching": "Every bow strung on one life.",
    "Fishing": "The water took nothing.", "Firemaking": "Every log burned. Never got burned.",
    "Crafting": "Every piece made on one life.", "Smithing": "Forged on one life.",
    "Mining": "Deep in the dark. Still breathing.", "Herblore": "Every potion brewed on one life.",
    "Agility": "Every ledge, every log. Never slipped.", "Thieving": "Every pocket picked. Death never caught them.",
    "Slayer": "Every task, every monster. Still standing.", "Farming": "Patient work on one life.",
    "Runecraft": "Through the Abyss and back. One life.", "Hunter": "The hunter, never the hunted.",
    "Construction": "Built on one life.", "Sailing": "The sea couldn't claim them.",
}
# How a boss first reads when "has slain X" is wrong.
BOSS_DEEDS = {
    "Barrows Chests": "looted the Barrows chests", "Lunar Chests": "looted the Lunar Chests",
    "Tempoross": "subdued Tempoross", "Wintertodt": "subdued the Wintertodt", "Zalcano": "brought down Zalcano",
    "Hespori": "cut down Hespori", "Mimic": "slain the Mimic", "Nightmare": "slain the Nightmare",
    "The Gauntlet": "completed The Gauntlet", "The Corrupted Gauntlet": "completed The Corrupted Gauntlet",
}


def world_first_text(f, max_total=None):
    """Short, dramatic post text for a claimed world first. No hashtags, no links, no data sources."""
    names = [" ".join(str(n).replace("\u00a0", " ").split()) for n in f.get("names") or []] or ["?"]
    who, many = names_line(names), len(names) > 1
    has = "have" if many else "has"
    cat, label, fid = f.get("cat"), f.get("label") or "", f.get("id") or ""
    if cat == "total" and fid == f"total-{max_total}":
        text = f"World first: {who} {has} maxed on Hardcore Worlds.\n\nEvery skill 99. One life. Never died."
    elif cat == "total":
        text = f"World first: {who} {has} reached {label} on Hardcore Worlds.\n\nOne life, still standing."
    elif cat == "99":
        skill = label.split(" ", 1)[-1]
        text = f"World first {label} on Hardcore Worlds: {who}.\n\n{SKILL_LINES.get(skill, 'One life. Never dropped.')}"
    elif cat == "death" and fid == f"death-{max_total}":
        text = f"The first maxed player has fallen on Hardcore Worlds: {who}.\n\nEvery skill 99. One life. Gone."
    elif cat == "death":
        text = f"{label} on Hardcore Worlds: {who}, total level {num(f.get('value') or 0)}.\n\nDeath is patient."
    elif cat == "clue":
        text = f"World first master clue on Hardcore Worlds: {who}.\n\nEvery step, every riddle, every risk. One life."
    elif cat == "raid":
        text = f"World first: {who} {has} conquered {label} on Hardcore Worlds.\n\nOne life in. Out alive."
    else:
        text = f"World first: {who} {has} {BOSS_DEEDS.get(label, 'slain ' + label)} on Hardcore Worlds.\n\nOne life. No second attempt."
    if many:
        text += "\n\nThey fell together." if cat == "death" else "\n\nFirst spotted together."
    return text


def world_first_card(f, max_total):
    """The card for a world first, or None. Never raises: a missing card means a text-only post."""
    try:
        import cards
        return cards.render_first_card(f, max_total)
    except Exception as e:  # noqa: BLE001
        print(f"xposts: card failed for {f.get('id')}: {type(e).__name__}: {e}")
        return None


# ---------- what to post ----------

def candidates(g, pop, st, cfg, now, http):
    """Yields (key, text, kind) in priority order. Keys already in st["done"] are skipped later."""
    out = []
    # Scheduled posts from config (countdown etc.). Only ones the owner approved; each one fires once,
    # at its time, or on its trigger; never more than 3 hours late, so a stalled pipeline can't post stale hype.
    for sp in cfg.get("scheduled") or []:
        if not sp.get("approved") or not sp.get("key") or not sp.get("text"):
            continue
        at = _ms(sp.get("at"))
        if sp.get("on") == "worlds_listed":
            # Fires when the HC worlds appear in the world list, or at fallback_at if the world-type
            # guess never matches (Jagex's label is unknown until launch); at most 3h after the fallback.
            fb = _ms(sp.get("fallback_at"))
            listed = bool((pop or {}).get("hardcore_worlds_listed")) and (not at or now >= at)
            due = listed or (bool(fb) and now >= fb)
            fresh = not fb or now - fb < 3 * HOUR or listed and now - at < 12 * HOUR
        else:
            due, fresh = bool(at) and now >= at, bool(at) and now - at < 3 * HOUR
        if due and fresh:
            out.append((f"sched-{sp['key']}", sp["text"], "scheduled"))
    live = g.get("status") == "live"
    deaths = [d for d in (g.get("deaths") or []) if d.get("time")]
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

        # Daily recap, once per UTC day at the configured hour. Every grave counts: a reset,
        # a move to the main game and an unconfirmed transfer all began with a death.
        day = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
        if day.hour == cfg["daily_recap_hour_utc"] and now - launch > 6 * HOUR:
            last24 = [d for d in deaths if now - d["time"] < DAY]
            if last24:
                hi = max(last24, key=lambda d: d.get("total") or 0)
                since = now - launch
                head = (f"The first {int(since // HOUR)} hours on Hardcore Worlds:" if since < DAY
                        else "The last 24 hours on Hardcore Worlds:")
                lines = [head, "", f"⚰ {num(len(last24))} graves",
                         f"⬆ Highest total at a grave: {num(hi.get('total') or 0)} ({hi['name']})"]
                if since >= DAY:
                    lines.append(f"⚰ {num(total)} in all")
                out.append((f"recap-{day:%Y-%m-%d}", "\n".join(lines), "recap"))

    if live:
        counts = g.get("counts") or {}
        # Deadliest hour so far: once the hour is over, when it beats the last one posted.
        dh = counts.get("deadliest_hour")
        if dh and dh.get("deaths", 0) >= cfg["deadliest_hour_min"]:
            start = _ms(dh["start"])
            cool = now - (st.get("dh_at") or 0) >= cfg["deadliest_hour_cooldown_hours"] * HOUR
            if start + HOUR <= now and dh["deaths"] > (st.get("dh_posted") or 0) and cool:
                a, zone, t = est(start)
                b, _, _ = est(start + HOUR)
                out.append((f"dh-{dh['deaths']}", f"Deadliest hour on Hardcore Worlds so far: {num(dh['deaths'])} deaths "
                            f"between {a} and {b} {zone} on {t:%a %d %b}.", "deadliest-hour"))
        # Resets: players who died and started again.
        hit = [m for m in cfg["reset_milestones"] if (counts.get("resets") or 0) >= m]
        if hit:
            out.append((f"resets-{hit[-1]}", f"{num(hit[-1])} players have already died on Hardcore Worlds and started again.\n\n"
                        "One life. Then another.", "resets"))
        # Deadliest place of the last 24 hours, once a day.
        day = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
        if day.hour == cfg["place_hour_utc"] and now - launch > 12 * HOUR:
            try:
                regions = json.load(open(REGIONS_FILE, encoding="utf-8")).get("regions") or {}
            except (OSError, ValueError):
                regions = {}
            tally = {}
            for d in deaths:
                if now - d["time"] < DAY:
                    name = region_name(d.get("location"), regions)
                    if name:
                        tally[name] = tally.get(name, 0) + 1
            if tally:
                name, n = max(tally.items(), key=lambda kv: kv[1])
                if n >= cfg["place_min_deaths"]:
                    out.append((f"place-{day:%Y-%m-%d}", f"Deadliest place on Hardcore Worlds today: {name}.\n\n"
                                f"{num(n)} graves there in the last 24 hours.", "place"))
        # Highest total still alive, once a day.
        hs = read_json("hiscores.json", {})
        if day.hour == cfg["leader_hour_utc"] and hs.get("status") == "live":
            top = [r for r in hs.get("overall") or [] if r.get("total")]
            alive = [r for r in top if not r.get("dead")]
            if alive:
                dead = sum(1 for r in top if r.get("dead"))
                tail = f"\n\n{dead} of the top {len(top)} have already died." if dead else ""
                out.append((f"leader-{day:%Y-%m-%d}", f"Highest total still alive on Hardcore Worlds: {alive[0]['name']}, "
                            f"total level {num(alive[0]['total'])}.{tail}", "leader"))

    # World firsts (firsts.py): every one of them, oldest first, never more than world_first_max_late_days late.
    # run() attaches each one's card (cards.py); the daily world_firsts_per_day cap queues the rest.
    fs = read_json("firsts.json", {})
    if fs.get("status") == "live":
        late = cfg["world_first_max_late_days"] * DAY
        for f in sorted((fs.get("firsts") or {}).values(), key=lambda f: f.get("seen") or ""):
            if not f.get("id") or not f.get("names") or now - _ms(f.get("seen")) > late:
                continue
            out.append((f"wf-{f['id']}", world_first_text(f, fs.get("max_total")), "world-first"))

    # Player count: a new all-time peak, at least peak_step above the last posted one.
    hc = (pop or {}).get("hardcore_total")
    st["peak_seen"] = max(st.get("peak_seen") or 0, hc or 0, (pop or {}).get("peak_hardcore") or 0)
    if hc and hc >= cfg["peak_min_players"] and hc >= st["peak_seen"]:
        last = st.get("peak_posted") or 0
        cool = now - (st.get("peak_at") or 0) >= cfg["peak_cooldown_hours"] * HOUR
        if hc >= last * (1 + cfg["peak_step"]) and cool:
            out.append((f"peak-{hc}", f"{num(hc)} players are on Hardcore Worlds right now. A new high.\n\nEvery one of them has one life.", "peak"))

    # GE: the most expensive items that actually traded in the latest hour, once a day. Only on the
    # Hardcore Worlds price feed (set by the watcher once it exists): main-game prices are never posted.
    route = (read_json("watcher.json", {}) or {}).get("price_route")
    day = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
    key = f"ge-{day:%Y-%m-%d}"
    if route and day.hour == cfg["ge_post_hour_utc"] and key not in st["done"]:
        txt = ge_post(http, cfg, route)
        if txt:
            out.append((key, txt, "ge"))
    return out


def ge_post(http, cfg, route):
    base = GE_API.format(route=route)
    s1, hour = http.get(base + "1h")
    s2, mapping = http.get(base + "mapping")
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
    return f"Most expensive items sold on the Hardcore Worlds Grand Exchange in the last hour:\n\n{lines}\n\nOne mistake and it's someone else's."


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


def _oauth_header(method, url, keys):
    ck, cs, tk, ts = keys
    oauth = {"oauth_consumer_key": ck, "oauth_nonce": secrets.token_hex(16), "oauth_signature_method": "HMAC-SHA1",
             "oauth_timestamp": str(int(time.time())), "oauth_token": tk, "oauth_version": "1.0"}
    oauth["oauth_signature"] = sign(method, url, oauth, cs, ts)
    return "OAuth " + ", ".join(f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth.items()))


def upload_media(path, keys):
    """Uploads an image (multipart; the body is not part of the OAuth signature). Posts nothing.
    Returns (ok, status, media_id_or_detail)."""
    with open(path, "rb") as f:
        data = f.read()
    boundary = "----dt" + secrets.token_hex(12)
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    crlf = "\r\n"
    body = (f"--{boundary}{crlf}Content-Disposition: form-data; name=\"media_category\"{crlf}{crlf}tweet_image{crlf}"
            f"--{boundary}{crlf}Content-Disposition: form-data; name=\"media\"; filename=\"{os.path.basename(path)}\"{crlf}"
            f"Content-Type: {mime}{crlf}{crlf}").encode() + data + f"{crlf}--{boundary}--{crlf}".encode()
    req = urllib.request.Request(MEDIA_URL, data=body, method="POST", headers={
        "Authorization": _oauth_header("POST", MEDIA_URL, keys), "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode() or "{}")
            mid = (d.get("data") or {}).get("id") or d.get("media_id_string")
            return bool(mid), r.status, mid or str(d)[:300]
    except urllib.error.HTTPError as e:
        return False, e.code, e.read().decode("utf-8", "replace")[:300]
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, 0, str(e)[:300]


def send(text, keys, media_ids=None):
    """POST /2/tweets with OAuth 1.0a user context. Returns (ok, status, detail)."""
    ck, cs, tk, ts = keys
    oauth = {"oauth_consumer_key": ck, "oauth_nonce": secrets.token_hex(16), "oauth_signature_method": "HMAC-SHA1",
             "oauth_timestamp": str(int(time.time())), "oauth_token": tk, "oauth_version": "1.0"}
    oauth["oauth_signature"] = sign("POST", POST_URL, oauth, cs, ts)
    auth = "OAuth " + ", ".join(f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth.items()))
    payload = {"text": text}
    if media_ids:
        payload["media"] = {"media_ids": media_ids}
    req = urllib.request.Request(POST_URL, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Authorization": auth, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, r.status, json.loads(r.read().decode() or "{}").get("data", {}).get("id")
    except urllib.error.HTTPError as e:
        return False, e.code, e.read().decode("utf-8", "replace")[:300]
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, 0, str(e)[:300]


def whoami(keys):
    """GET /2/users/me: proves the keys work without posting anything."""
    url = "https://api.x.com/2/users/me"
    ck, cs, tk, ts = keys
    oauth = {"oauth_consumer_key": ck, "oauth_nonce": secrets.token_hex(16), "oauth_signature_method": "HMAC-SHA1",
             "oauth_timestamp": str(int(time.time())), "oauth_token": tk, "oauth_version": "1.0"}
    oauth["oauth_signature"] = sign("GET", url, oauth, cs, ts)
    auth = "OAuth " + ", ".join(f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth.items()))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": auth}), timeout=30) as r:
            return r.status, json.loads(r.read().decode()).get("data", {}).get("username")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


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
    wf_today = sum(1 for s in sent_today if s["kind"] == "world-first")
    made = []
    images = {f"sched-{sp['key']}": sp["image"] for sp in cfg.get("scheduled") or [] if sp.get("image")}
    fs = read_json("firsts.json", {})
    wf = {f"wf-{f['id']}": f for f in (fs.get("firsts") or {}).values() if f.get("id")}
    for key, text, kind in candidates(g, pop, st, cfg, now, http or Http()):
        if key in st["done"]:
            continue
        if len(made) >= cfg["max_per_run"] or len(sent_today) + len(made) >= cfg["max_per_day"]:
            break
        if kind == "big" and big_today >= cfg["big_deaths_per_day"]:
            continue
        if kind == "world-first" and wf_today >= cfg["world_firsts_per_day"]:
            continue
        image = os.path.join(ROOT, images[key]) if key in images else None
        card = None
        if kind == "world-first" and key in wf:
            image = card = world_first_card(wf[key], fs.get("max_total"))   # None: text only
        if dry:
            ok, status, detail = True, None, "dry run" + (f" (+image {os.path.basename(image)})" if image else "")
        else:
            media = None
            if image:
                try:
                    mok, mstatus, mid = upload_media(image, keys)
                except Exception as e:  # noqa: BLE001 - an unreadable image must not stop the post
                    mok, mstatus, mid = False, 0, f"{type(e).__name__}: {e}"
                if not mok:
                    print(f"xposts: image upload failed {mstatus} {mid}; posting text only")
                else:
                    media = [mid]
            ok, status, detail = send(text, keys, media)
            if not ok and not (status == 403 and "duplicate" in str(detail).lower()):  # duplicate = already out
                print(f"xposts: send failed {status} {detail}")
                if status in (401, 402, 403, 429):
                    break   # bad keys, out of credit, or rate-limited: try again next run
                continue
        st["done"][key] = now
        made.append({"key": key, "kind": kind, "day": today, "at": iso(now), "text": text,
                     "dry": dry, "status": status, "id": detail if ok and not dry else None})
        if kind == "world-first":
            made[-1]["card"] = os.path.basename(card) if card else None
            if not dry:
                made[-1]["media"] = bool(media)
        if kind == "big":
            big_today += 1
        if kind == "world-first":
            wf_today += 1
        if kind == "deadliest-hour":
            st["dh_posted"] = int(key.split("-")[1])
            st["dh_at"] = now
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
    import sys
    if "--check" in sys.argv:
        k = _keys()
        print("keys present:", bool(k))
        if k:
            print("users/me ->", *whoami(k))
            img = os.path.join(ROOT, "site", "assets", "social", "world-firsts.png")
            if "--media" in sys.argv and os.path.exists(img):
                print("media upload (nothing is posted) ->", *upload_media(img, k))
    else:
        print(json.dumps(run(), indent=1))
