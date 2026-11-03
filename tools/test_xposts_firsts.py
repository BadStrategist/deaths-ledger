"""World-first posts on X, end to end, without ever touching X.

    python3 tools/test_xposts_firsts.py

Runs scraper/xposts.py against a fake firsts.json (every category, single and shared claims, one
too old to post) in a temporary data dir with a temporary config:
  * dry run: every world first produces post text and a 1600x900 card; nothing is sent.
  * "live" with send() and upload_media() replaced by fakes: max 3 posts a run, 40 world firsts a day,
    the rest queued to the next day, each first posted once, nothing more than 7 days late.
  * a card or upload failure still posts, text only.
send/upload_media are swapped for fakes before anything runs, and the X_* keys are fake, so a
bug here can never post.
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

TMP = tempfile.mkdtemp(prefix="dt-xtest-")
os.environ["LEDGER_DATA_DIR"] = os.path.join(TMP, "data")
os.environ["LEDGER_CONFIG"] = os.path.join(TMP, "config.json")
for k in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"):
    os.environ.pop(k, None)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scraper"))

import card_templates as ct  # noqa: E402
import cards  # noqa: E402
import xposts  # noqa: E402
from common import iso, read_json, write_json  # noqa: E402

MIN = 60000
LAUNCH = int(datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc).timestamp() * 1000)
MT = ct.max_total()


def _never(*a, **k):
    raise AssertionError("tried to reach X")


xposts.send = _never
xposts.upload_media = _never
xposts.whoami = _never


class FakeHttp:
    def get(self, *a, **k):
        return 0, ""


def config(dry):
    with open(os.environ["LEDGER_CONFIG"], "w") as f:
        json.dump({"x": {"dry_run": dry, "launch_at": "2026-11-04T11:00:00Z", "scheduled": []}}, f)


def first(fid, names, seen_ms, value=None):
    c = next(c for c in ct.catalog() if c["id"] == fid)
    f = ct.sample_first(c, MT, names=names)
    f["seen"] = iso(seen_ms)
    if value is not None:
        f["value"] = value
    return f


def write_firsts(fs):
    write_json("firsts.json", {"status": "live", "max_total": MT, "firsts": {f["id"]: f for f in fs}})


def reset():
    for name in ("xposts.json", "firsts.json"):
        try:
            os.remove(os.path.join(os.environ["LEDGER_DATA_DIR"], name))
        except FileNotFoundError:
            pass


BANNED = ("#", "http", "://", ".gg", "hiscore", "wiki", "api.", "runescape.com", "json", "@")


class WorldFirstPosts(unittest.TestCase):
    def setUp(self):
        reset()
        self.sent, self.uploads = [], []

    def fake_live(self, upload_ok=True):
        def upload(path, keys):
            self.uploads.append(path)
            self.assertTrue(os.path.exists(path))
            return (True, 200, f"m{len(self.uploads)}") if upload_ok else (False, 400, "bad image")

        def send(text, keys, media_ids=None):
            self.sent.append((text, media_ids))
            return True, 201, f"t{len(self.sent)}"
        xposts.upload_media, xposts.send = upload, send
        for k in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"):
            os.environ[k] = "fake"

    def tearDown(self):
        xposts.upload_media = xposts.send = _never
        for k in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"):
            os.environ.pop(k, None)

    def test_dry_run_every_category(self):
        config(dry=True)
        t0 = LAUNCH + 6 * 60 * MIN
        fs = [first("total-1000", ["Iron Ridley"], t0 - 50 * MIN),
              first(f"total-{MT}", ["Iron Ridley", "Second Guy"], t0 - 49 * MIN),
              first("99-attack", ["WWWWWWWWWWWW"], t0 - 48 * MIN),
              first("99-sailing", ["A", "B", "C"], t0 - 47 * MIN),
              first("kc-78", ["Iron Ridley"], t0 - 46 * MIN),           # raid: The Fractured Archive
              first("kc-91", ["Iron Ridley"], t0 - 45 * MIN),           # boss: Zulrah
              first("kc-25", ["Iron Ridley"], t0 - 44 * MIN),           # boss with its own wording
              first("kc-13", ["Iron Ridley"], t0 - 43 * MIN),           # master clue
              first("death-1500", ["Iron Ridley"], t0 - 42 * MIN, 1512),
              first(f"death-{MT}", ["Iron Ridley", "Fell Too"], t0 - 41 * MIN),
              first("kc-83", ["Too Late"], t0 - 8 * 24 * 60 * MIN)]      # 8 days old: never posts
        write_firsts(fs)
        posts = []
        for i in range(10):
            r = xposts.run(now=t0 + i * 10 * MIN, http=FakeHttp())
            self.assertTrue(r["mode"].startswith("dry run"))
            out = read_json("xposts.json", {})["outbox"]
            new = out[len(posts):]
            self.assertLessEqual(len(new), 3, "max_per_run")
            posts += new
        keys = [p["key"] for p in posts]
        self.assertEqual(sorted(keys), sorted(f"wf-{f['id']}" for f in fs[:-1]))
        self.assertEqual(len(keys), len(set(keys)), "a first posted twice")
        self.assertEqual(keys, [f"wf-{f['id']}" for f in fs[:-1]], "oldest first")
        for p in posts:
            self.assertEqual(p["kind"], "world-first")
            self.assertTrue(p["text"] and len(p["text"]) <= 280, p)
            for b in BANNED:
                self.assertNotIn(b, p["text"].lower(), f"{p['key']}: {b!r} in post text")
            self.assertTrue(p["card"], f"{p['key']}: no card")
            path = os.path.join(cards.tempfile.gettempdir(), "deathtoll-cards", p["card"])
            self.assertTrue(os.path.exists(path))
            self.assertEqual(cards.pil().Image.open(path).size, (1600, 900))
        texts = {p["key"]: p["text"] for p in posts}
        self.assertIn("First spotted together.", texts["wf-99-sailing"])
        self.assertIn("A, B and C", texts["wf-99-sailing"])
        self.assertIn("They fell together.", texts[f"wf-death-{MT}"])
        self.assertIn("The Fractured Archive", texts["wf-kc-78"])
        self.assertIn("looted the Barrows chests", texts["wf-kc-25"])
        self.assertIn("1,512", texts["wf-death-1500"])

    def test_every_first_has_text(self):
        for c in ct.catalog():
            t = xposts.world_first_text(ct.sample_first(c, MT), MT)
            self.assertIn("Iron Ridley", t, c["id"])
            self.assertLessEqual(len(t), 280)
            for b in BANNED:
                self.assertNotIn(b, t.lower(), c["id"])
            five = xposts.world_first_text(ct.sample_first(c, MT, names=["WWWWWWWWWWWW"] * 5), MT)
            self.assertLessEqual(len(five), 280, c["id"])

    def test_live_caps_and_queue(self):
        config(dry=False)
        self.fake_live()
        start = LAUNCH + 20 * MIN
        cat = [c for c in ct.catalog() if c["cat"] in ("99", "boss")][:60]
        write_firsts([first(c["id"], ["Iron Ridley"], start - (60 - i) * MIN) for i, c in enumerate(cat)])
        per_day, t = {}, start
        while t < start + 3 * 24 * 60 * MIN:
            before = len(self.sent)
            xposts.run(now=t, http=FakeHttp())
            self.assertLessEqual(len(self.sent) - before, 3, "max_per_run")
            day = datetime.fromtimestamp(t / 1000, tz=timezone.utc).date()
            per_day[day] = per_day.get(day, 0) + len(self.sent) - before
            t += 10 * MIN
        self.assertEqual(len(self.sent), 60, "every first posts once")
        self.assertEqual(len({s[0] for s in self.sent}), 60)
        self.assertTrue(all(v <= 40 for v in per_day.values()), per_day)
        self.assertEqual(sorted(per_day.values(), reverse=True)[:2], [40, 20], "40 on launch day, the rest next day")
        self.assertTrue(all(media for _, media in self.sent), "every post carried its card")
        self.assertEqual(len(self.uploads), 60)

    def test_upload_failure_posts_text_only(self):
        config(dry=False)
        self.fake_live(upload_ok=False)
        t = LAUNCH + 60 * MIN
        write_firsts([first("kc-91", ["Iron Ridley"], t - MIN)])
        xposts.run(now=t, http=FakeHttp())
        self.assertEqual(len(self.sent), 1)
        self.assertIsNone(self.sent[0][1])
        sent = read_json("xposts.json", {})["sent"]
        self.assertFalse(sent[-1]["media"])

    def test_card_failure_posts_text_only(self):
        config(dry=False)
        self.fake_live()
        real = cards.render_first_card
        cards.render_first_card = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            t = LAUNCH + 60 * MIN
            write_firsts([first("99-attack", ["Iron Ridley"], t - MIN), first("kc-13", ["Iron Ridley"], t - MIN)])
            xposts.run(now=t, http=FakeHttp())
        finally:
            cards.render_first_card = real
        self.assertEqual(len(self.sent), 2)
        self.assertTrue(all(m is None for _, m in self.sent))
        self.assertEqual(self.uploads, [])

    def test_pillow_missing_posts_text_only(self):
        config(dry=False)
        self.fake_live()
        real = cards.pil
        cards.pil = lambda: None
        try:
            t = LAUNCH + 60 * MIN
            write_firsts([first("death-1000", ["Iron Ridley"], t - MIN, 1004)])
            xposts.run(now=t, http=FakeHttp())
        finally:
            cards.pil = real
        self.assertEqual(len(self.sent), 1)
        self.assertIsNone(self.sent[0][1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
