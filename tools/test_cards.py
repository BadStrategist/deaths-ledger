"""Card tests: every one of the 105 world-first cards, drawn with a 12-character name, a 1-character
name and three names, must keep every line of text inside its box (and inside the canvas).

    python3 tools/test_cards.py

Two checks per card: the layout plan (each line's ink box inside its slot), and the pixels (every
pixel the claim layer brightens lies inside the claim slots, so nothing spills onto the title, the
art or the footer). Also: every template title fits, and a broken card returns None instead of raising.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scraper"))

import card_templates as ct  # noqa: E402
import cards  # noqa: E402

LONG = "WWWWWWWWWWWW"            # 12 characters, the widest a name can be
NAME_SETS = {
    "12-char": [LONG],
    "1-char": ["W"],
    "3 names": [LONG, "Mmmmmmmmmmmm", "Wide Wide Ww"],
}


def union(boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


class CardLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert cards.pil(), "Pillow is required for the card tests"
        cls.cat = ct.catalog()
        cls.mt = ct.max_total()
        cls.templates = {}

    def template(self, c):
        if c["id"] not in self.templates:
            path = cards.template_path(c["id"])
            P = cards.pil()
            self.templates[c["id"]] = (P.Image.open(path).convert("RGB") if os.path.exists(path)
                                       else ct.build_template(c, self.mt, fetch=False).convert("RGB"))
        return self.templates[c["id"]]

    def test_catalog_has_105_unique_firsts(self):
        ids = [c["id"] for c in self.cat]
        self.assertEqual(len(ids), 105)
        self.assertEqual(len(set(ids)), 105)
        self.assertEqual({c["cat"] for c in self.cat}, {"total", "99", "raid", "boss", "clue", "death"})

    def test_every_template_exists_and_is_1600x900(self):
        for c in self.cat:
            path = cards.template_path(c["id"])
            self.assertTrue(os.path.exists(path), path)
            self.assertEqual(self.template(c).size, (1600, 900), c["id"])

    def test_every_title_fits(self):
        P = cards.pil()
        d = P.ImageDraw.Draw(P.Image.new("RGB", (8, 8)))
        for c in self.cat:
            f, lines = ct.plan_title(d, c["title"])
            self.assertLessEqual(len(lines), 2, c["id"])
            self.assertEqual(" ".join(t for t, _, _ in lines), c["title"], f"{c['id']}: title truncated")
            for _, _, ink in lines:
                self.assertTrue(cards.fits(ink, cards.TITLE_BOX), f"{c['id']}: title {ink} outside {cards.TITLE_BOX}")

    def test_no_text_overflows(self):
        P = cards.pil()
        allowed = cards.CLAIM_BOXES
        checked = 0
        for c in self.cat:
            for label, names in NAME_SETS.items():
                first = ct.sample_first(c, self.mt, names=names)
                with self.subTest(first=c["id"], names=label):
                    items = cards.plan_first_card(first, self.mt)
                    roles = {it["role"]: it for it in items}
                    self.assertEqual(set(roles), {"name", "value", "date"})
                    self.assertEqual(roles["name"]["text"], cards.names_text(names), "name was cut short")
                    for it in items:
                        self.assertTrue(cards.fits(it["ink"], it["box"]), f"{it['role']} {it['ink']} outside {it['box']}")
                        self.assertTrue(cards.fits(it["ink"], (0, 0, cards.W, cards.H)))
                        self.assertGreaterEqual(it["font"].size, 24, f"{it['role']} shrank too far")
                    # Pixels: whatever the claim layer brightens (text; the shadow only darkens) stays in the slots.
                    tpl = self.template(c)
                    card = tpl.copy()
                    cards.draw_claim(card, first, self.mt)
                    lighter = P.ImageChops.subtract(card, tpl).convert("L").point(lambda v: 255 if v > 24 else 0)
                    bbox = lighter.getbbox()
                    self.assertIsNotNone(bbox)
                    self.assertTrue(cards.fits(bbox, union(allowed)), f"drawn pixels {bbox} leave the claim area {union(allowed)}")
                    checked += 1
        self.assertEqual(checked, 105 * len(NAME_SETS))

    def test_names_text(self):
        self.assertEqual(cards.names_text(["A"]), "A")
        self.assertEqual(cards.names_text(["A", "B"]), "A & B")
        self.assertEqual(cards.names_text(["A", "B", "C"]), "A, B +1")
        self.assertEqual(cards.names_text(["A", "B", "C", "D", "E"]), "A, B +3")
        self.assertEqual(cards.names_text(["Iron Ridley"]), "Iron Ridley")

    def test_value_and_date_lines(self):
        f = {"id": "99-attack", "cat": "99", "value": 13034431, "seen": "2026-11-04T11:42:00Z"}
        self.assertEqual(cards.value_text(f), "13,034,431 XP")
        self.assertEqual(cards.date_text(f["seen"]), "First spotted Wed 4 Nov 2026 · 11:42 UTC")
        self.assertEqual(cards.value_text({"id": "total-2000", "cat": "total", "value": 2000}), "Total level 2,000")
        self.assertEqual(cards.value_text({"id": "kc-91", "cat": "boss", "value": 5}), "Kill count 5")
        self.assertEqual(cards.value_text({"id": "kc-31", "cat": "raid", "value": 5}), "Completions 5")
        self.assertEqual(cards.value_text({"id": "death-1500", "cat": "death", "value": 1512}), "Fell at 1,512 total")
        self.assertEqual(cards.value_text({"id": "kc-13", "cat": "clue", "value": 3}), "Master clues 3")

    def test_render_writes_a_png(self):
        c = next(x for x in self.cat if x["id"] == "kc-78")
        with tempfile.TemporaryDirectory() as d:
            path = cards.render_first_card(ct.sample_first(c, self.mt, names=["A", "B", "C"]), self.mt, out_dir=d)
            self.assertTrue(path and os.path.exists(path))
            P = cards.pil()
            self.assertEqual(P.Image.open(path).size, (1600, 900))
            self.assertLess(os.path.getsize(path), 5_000_000)

    def test_failures_return_none(self):
        self.assertIsNone(cards.render_first_card(None, 2376))                      # garbage in
        self.assertIsNone(cards.render_first_card({"cat": "boss"}, 2376))           # no id
        real = cards.pil
        try:
            cards.pil = lambda: None                                                 # no Pillow at all
            self.assertIsNone(cards.render_first_card(ct.sample_first(self.cat[0]), 2376))
        finally:
            cards.pil = real
        with tempfile.TemporaryDirectory() as d:                                     # corrupt template
            bad = os.path.join(d, "kc-91.png")
            with open(bad, "wb") as f:
                f.write(b"not a png")
            real_dir = cards.TEMPLATE_DIR
            try:
                cards.TEMPLATE_DIR = d
                self.assertIsNone(cards.render_first_card(ct.sample_first(self.cat[50]) | {"id": "kc-91"}, 2376))
            finally:
                cards.TEMPLATE_DIR = real_dir

    def test_missing_template_is_built_on_the_fly(self):
        with tempfile.TemporaryDirectory() as d:
            real_dir = cards.TEMPLATE_DIR
            try:
                cards.TEMPLATE_DIR = d   # empty: no templates at all
                path = cards.render_first_card(ct.sample_first(self.cat[0]), 2376, out_dir=d)
                self.assertTrue(path and os.path.exists(path))
            finally:
                cards.TEMPLATE_DIR = real_dir


if __name__ == "__main__":
    unittest.main(verbosity=2)
