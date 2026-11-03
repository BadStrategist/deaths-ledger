"""Generator for the 105 world-first card templates, the sample cards and cards/README.md.

    python3 scraper/card_templates.py              # fetch missing art, then write everything
    python3 scraper/card_templates.py --no-fetch   # offline: use cached art, draw an emblem where none
    python3 scraper/card_templates.py --only 99-attack,kc-91
    python3 scraper/card_templates.py --contact docs/screenshots/world-first-cards.png   # grid of 20 examples

Writes (repo root):
  cards/art/<slug>.png      category art, cached from the OSRS Wiki (sources in cards/art/sources.json)
  cards/firsts/<id>.png     one template per first: background, art, eyebrow, title, footer
  cards/examples/<id>.png   each template with the sample claimant "Iron Ridley"
  cards/README.md           every id, its title and its X post text

Art comes from the OSRS Wiki API (User-Agent "DeathToll/1.0 (+https://deathtoll.gg)"): skill icons
for 99s, the lead image of each boss/raid page, the master clue scroll; the trophy and grave art
already in site/assets/art (also from the wiki) for totals and deaths. A first whose art cannot be
fetched gets a drawn medallion instead, so the generator never fails for want of a picture; run it
again with network access and it fills the gaps (only missing art is fetched).

scraper/cards.py also calls build_template() at post time if a template file is ever missing.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cards  # noqa: E402
from cards import (ART_BOX, ART_CENTER, BG, BLOOD, CLAIM_LABEL_Y, COL_X0, COL_X1, DIVIDER_Y, EYEBROW_Y, GOLD,  # noqa: E402
                   GOLD_DIM, H, LINE, MUTED, PANEL, PARCHMENT, TITLE_BOX, W, fit, font, pil, place)

ROOT = cards.ROOT
CARDS_DIR = os.path.join(ROOT, "cards")
ART_DIR = os.path.join(CARDS_DIR, "art")
SITE_ART = os.path.join(ROOT, "site", "assets", "art")
USER_AGENT = "DeathToll/1.0 (+https://deathtoll.gg)"
WIKI_API = "https://oldschool.runescape.wiki/api.php"
SAMPLE_NAME = "Iron Ridley"
SAMPLE_SEEN = "2026-11-04T11:42:00Z"

# Wiki page titles to try for a table's art, in order, where the hiscore name is not the best page.
PAGE_TITLES = {
    "Chambers of Xeric": ["Great Olm", "Chambers of Xeric"],
    "Chambers of Xeric: Challenge Mode": ["Great Olm", "Chambers of Xeric"],
    "Theatre of Blood": ["Verzik Vitur", "Theatre of Blood"],
    "Theatre of Blood: Hard Mode": ["Verzik Vitur", "Theatre of Blood"],
    "Tombs of Amascut": ["Tumeken's Warden", "Tombs of Amascut"],
    "Tombs of Amascut: Expert Mode": ["Elidinis' Warden", "Tumeken's Warden", "Tombs of Amascut"],
    "Barrows Chests": ["Barrows brothers", "Barrows"],
    "Lunar Chests": ["Perilous Moons", "Lunar Chest"],
    "Mimic": ["The Mimic"],
    "Nightmare": ["The Nightmare"],
    "The Gauntlet": ["Crystalline Hunllef", "The Gauntlet"],
    "The Corrupted Gauntlet": ["Corrupted Hunllef", "The Corrupted Gauntlet"],
    "The Royal Titans": ["Royal Titans", "The Royal Titans"],
    "Wintertodt": ["Wintertodt"],
    "Spindel": ["Spindel"],
}
CLUE_FILES = ["Clue scroll (master) detail.png", "Clue scroll (master).png", "Reward casket (master) detail.png"]
CATEGORY_TAG = {"total": "Total level", "99": "Skill", "raid": "Raid", "boss": "Boss", "clue": "Treasure Trails",
                "death": "The fallen"}


# ---------- the 105 firsts ----------

def catalog():
    """Every world first as {id, cat, label, title}, in page order (mirrors firsts.py)."""
    import firsts
    from hiscores import SKILLS
    out = []
    for t in firsts.TOTALS + [firsts.MAX_TOTAL]:
        label = "Max total level" if t == firsts.MAX_TOTAL else f"{t:,} total level"
        out.append({"id": f"total-{t}", "cat": "total", "label": label,
                    "title": "Max Total Level" if t == firsts.MAX_TOTAL else f"{t:,} Total Level"})
    for s in SKILLS:
        out.append({"id": f"99-{s.lower()}", "cat": "99", "label": f"99 {s}", "title": f"99 {s}", "skill": s})
    for t in sorted({**firsts.RAIDS, **firsts.BOSSES, **firsts.CLUES}):
        cat = "raid" if t in firsts.RAIDS else "clue" if t in firsts.CLUES else "boss"
        name = firsts.RAIDS.get(t) or firsts.CLUES.get(t) or firsts.BOSSES[t]
        out.append({"id": f"kc-{t}", "cat": cat, "label": name, "title": name})
    for t in firsts.DEATH_TOTALS + [firsts.MAX_TOTAL]:
        mx = t == firsts.MAX_TOTAL
        out.append({"id": f"death-{t}", "cat": "death",
                    "label": "First maxed player to fall" if mx else f"First {t:,}+ total to fall",
                    "title": "Maxed Player to Fall" if mx else f"{t:,}+ Total to Fall"})
    return out


def max_total():
    import firsts
    return firsts.MAX_TOTAL


def sample_first(c, mt=None, names=None):
    """A claimed first for previews and tests."""
    mt = mt or max_total()
    n = int(c["id"].rsplit("-", 1)[-1]) if c["cat"] in ("total", "death") else 0
    value = {"total": n, "99": 13034431, "raid": 5, "boss": 5, "clue": 3,
             "death": min(mt, n + 12) if n != mt else mt}[c["cat"]]
    return {"id": c["id"], "cat": c["cat"], "label": c["label"], "names": names or [SAMPLE_NAME],
            "value": value, "seen": SAMPLE_SEEN, "headline": True}


# ---------- art ----------

def _slug(c):
    if c["cat"] == "99":
        return f"skill-{c['skill'].lower()}"
    if c["cat"] == "clue":
        return "clue-master"
    return "".join(ch if ch.isalnum() else "-" for ch in c["label"].lower()).strip("-").replace("--", "-")


def _get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
    return body if binary else json.loads(body.decode("utf-8"))


def _api(**params):
    return _get(WIKI_API + "?" + urllib.parse.urlencode({"action": "query", "format": "json", "redirects": 1, **params}))


def wiki_file_url(name):
    d = _api(titles=f"File:{name}", prop="imageinfo", iiprop="url")
    for p in (d.get("query") or {}).get("pages", {}).values():
        info = p.get("imageinfo") or []
        if info and info[0].get("url"):
            return info[0]["url"]
    return None


def wiki_page_image(title):
    d = _api(titles=title, prop="pageimages", piprop="original")
    for p in (d.get("query") or {}).get("pages", {}).values():
        src = (p.get("original") or {}).get("source")
        if src:
            return src
    return None


def art_candidates(c):
    """Yields ('local', path) or ('file', wiki file name) or ('page', wiki page title)."""
    if c["cat"] == "total":
        yield "local", os.path.join(SITE_ART, "trophy.png")
    elif c["cat"] == "death":
        yield "local", os.path.join(SITE_ART, "Death.webp" if c["id"] == f"death-{max_total()}" else "Grave.webp")
    elif c["cat"] == "99":
        yield "file", f"{c['skill']} icon (detail).png"
        yield "file", f"{c['skill']} icon.png"
    elif c["cat"] == "clue":
        for f in CLUE_FILES:
            yield "file", f
    else:
        for t in PAGE_TITLES.get(c["label"], [c["label"]]):
            yield "page", t


# Art the owner doesn't want on cards: the Fractured Archive's only Wiki image is its logo, which
# carries Jagex's Old School RuneScape trademark. Those cards keep the drawn medallion.
NO_ART = {"the-fractured-archive"}


def get_art(c, fetch=True, log=print):
    """Returns (RGBA image or None, source string). Cached art wins; fetches only what is missing."""
    global _offline
    P = pil()
    slug = _slug(c)
    if slug in NO_ART:
        return None, None
    cached = os.path.join(ART_DIR, f"{slug}.png")
    for kind, ref in art_candidates(c):
        if kind == "local":
            if os.path.exists(ref):
                return P.Image.open(ref).convert("RGBA"), "local:" + os.path.relpath(ref, ROOT)
            continue
        if os.path.exists(cached):
            return P.Image.open(cached).convert("RGBA"), _sources().get(slug, "cache")
        if not fetch or _offline:
            break
        try:
            url = wiki_file_url(ref) if kind == "file" else wiki_page_image(ref)
            if not url:
                continue
            import io
            im = P.Image.open(io.BytesIO(_get(url, binary=True)))
            im.load()
            im = im.convert("RGBA")
            if max(im.size) > 640:
                im.thumbnail((640, 640), P.Image.LANCZOS)
            os.makedirs(ART_DIR, exist_ok=True)
            im.save(cached, optimize=True)
            src = _sources()
            src[slug] = url
            _save_sources(src)
            log(f"  art {slug} <- {url}")
            return im, url
        except Exception as e:  # noqa: BLE001
            log(f"  art {slug}: {kind} {ref!r} failed: {type(e).__name__}: {e}"[:200])
            if isinstance(e, (urllib.error.URLError, OSError)) and not isinstance(e, urllib.error.HTTPError):
                _offline = True   # the wiki is unreachable: stop trying for the rest of this run
                break
    return None, None


_SRC = None
_offline = False


def _sources():
    global _SRC
    if _SRC is None:
        try:
            with open(os.path.join(ART_DIR, "sources.json"), encoding="utf-8") as f:
                _SRC = json.load(f)
        except (OSError, ValueError):
            _SRC = {}
    return _SRC


def _save_sources(src):
    os.makedirs(ART_DIR, exist_ok=True)
    with open(os.path.join(ART_DIR, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(dict(sorted(src.items())), f, indent=1)


# ---------- drawing ----------

def _glow(P, center, radius, color, strength):
    """A soft radial glow, drawn small and scaled up (fast, no banding worth noticing)."""
    s = 8
    m = P.Image.new("L", (W // s, H // s), 0)
    cx, cy, r = center[0] / s, center[1] / s, radius / s
    P.ImageDraw.Draw(m).ellipse((cx - r, cy - r, cx + r, cy + r), fill=int(255 * strength))
    m = m.filter(P.ImageFilter.GaussianBlur(r / 2.2)).resize((W, H), P.Image.BICUBIC)
    return P.Image.new("RGB", (W, H), color), m


def _background(P, cat):
    img = P.Image.new("RGB", (W, H), BG)
    # Panel with a vertical gradient, like the site's card.
    pw, ph = W - 80, H - 80
    grad = P.Image.linear_gradient("L").resize((pw, ph))
    top, bottom = P.Image.new("RGB", (pw, ph), PANEL), P.Image.new("RGB", (pw, ph), (11, 9, 15))
    img.paste(P.Image.composite(bottom, top, grad), (40, 40))
    for center, radius, color, strength in (((1420, 90), 760, (78, 52, 140), 0.55),
                                            (ART_CENTER, 400, BLOOD if cat == "death" else GOLD, 0.24),
                                            ((1300, 900), 600, (40, 28, 70), 0.35)):
        col, m = _glow(P, center, radius, color, strength)
        inner = P.Image.new("L", (W, H), 0)
        P.ImageDraw.Draw(inner).rectangle((42, 42, W - 43, H - 43), fill=255)
        img.paste(col, (0, 0), P.ImageChops.multiply(m, inner))
    d = P.ImageDraw.Draw(img)
    d.rectangle((40, 40, W - 41, H - 41), outline=GOLD_DIM, width=2)
    d.rectangle((50, 50, W - 51, H - 51), outline=(36, 31, 44), width=1)
    return img


def _fit_art(P, art):
    w, h = art.size
    if max(w, h) <= 96:   # pixel art (inventory/skill icons): whole-number nearest-neighbour scale
        k = max(1, int(ART_BOX * 0.8 // max(w, h)))
        return art.resize((w * k, h * k), P.Image.NEAREST)
    k = min(ART_BOX / w, ART_BOX / h, 3.0)
    return art.resize((max(1, round(w * k)), max(1, round(h * k))), P.Image.LANCZOS)


def _medallion(P, c):
    """Fallback art when the wiki image is unavailable: a gold medallion with the first's initials."""
    size = 400
    m = P.Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = P.ImageDraw.Draw(m)
    d.ellipse((8, 8, size - 8, size - 8), fill=(24, 20, 30, 255), outline=GOLD, width=10)
    d.ellipse((34, 34, size - 34, size - 34), outline=GOLD_DIM, width=4)
    if c["cat"] == "99":
        initials = "99"
    else:
        words = [w for w in c["title"].replace(":", " ").replace("-", " ").replace("'", "").split()
                 if w[:1].isalpha() and w.lower() not in ("the", "of", "to")]
        initials = "".join(w[0] for w in words[:2]).upper() or "?"
    f = font("cinzel-black", 150)
    xy, _ = place(d, initials, f, (60, 60, size - 60, size - 60), align="center")
    d.text(xy, initials, font=f, fill=GOLD)
    return m


def _paste_art(P, img, art):
    art = _fit_art(P, art)
    x = ART_CENTER[0] - art.width // 2
    y = ART_CENTER[1] - art.height // 2
    alpha = art.getchannel("A")
    shadow = P.Image.new("L", img.size, 0)
    shadow.paste(alpha.point(lambda a: int(a * 0.75)), (x, y + 18))
    shadow = shadow.filter(P.ImageFilter.GaussianBlur(16))
    img.paste((0, 0, 0), (0, 0), shadow)
    img.paste(art, (x, y), art)


def _wrap(d, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if cur and d.textlength(trial, font=f) > width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    return lines + [cur] if cur else lines


def plan_title(d, title):
    """Title lines: largest size where it wraps into at most two lines inside TITLE_BOX.
    Returns (font, [(text, xy, ink)])."""
    x0, y0, x1, y1 = TITLE_BOX
    for size in range(96, 38, -2):
        f = font("cinzel-black", size)
        lines = _wrap(d, title, f, x1 - x0)
        if len(lines) > 2:
            continue
        lead = round(size * 1.08)
        out, ok = [], True
        for i, line in enumerate(lines):
            xy, ink = place(d, line, f, (x0, y0 + i * lead, x1, y0 + i * lead + lead), valign="top")
            ok = ok and cards.fits(ink, TITLE_BOX)
            out.append((line, xy, ink))
        if ok:
            return f, out
    text, f, xy, ink = fit(d, title, "cinzel-black", TITLE_BOX, 40, 24, valign="top")
    return f, [(text, xy, ink)]


def _spaced(d, xy, text, f, fill, spacing):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing
    return x


def build_template(c, mt=None, fetch=True, log=print):
    """Draws the template for one first (an entry of catalog(), or a firsts.json first). Returns an RGB image."""
    P = pil()
    if "title" not in c:   # a first straight from firsts.json
        c = next((x for x in catalog() if x["id"] == c["id"]), None) or {**c, "title": c.get("label") or c["id"]}
    img = _background(P, c["cat"])
    art, _src = get_art(c, fetch=fetch, log=log) if c["cat"] in CATEGORY_TAG else (None, None)
    _paste_art(P, img, art if art is not None else _medallion(P, c))
    d = P.ImageDraw.Draw(img)

    # Eyebrow
    f = font("silk", 32)
    end = _spaced(d, (COL_X0, EYEBROW_Y), "WORLD FIRST", f, GOLD, 12)
    d.rectangle((end + 8, EYEBROW_Y + 15, end + 8 + 60, EYEBROW_Y + 17), fill=GOLD_DIM)

    # Title (a leading number, "99" or "2,000", in gold)
    # A short title sits centred, with its tag, between the eyebrow and the divider.
    f, lines = plan_title(d, c["title"])
    block = lines[-1][2][3] + 20 + 30 - lines[0][2][1]
    dy = max(0, round((EYEBROW_Y + 40 + DIVIDER_Y - 10) / 2 - block / 2 - lines[0][2][1]))
    lines = [(t, (xy[0], xy[1] + dy), (ink[0], ink[1] + dy, ink[2], ink[3] + dy)) for t, xy, ink in lines]
    bottom = TITLE_BOX[1]
    for i, (line, xy, ink) in enumerate(lines):
        head, _, rest = line.partition(" ")
        if i == 0 and any(ch.isdigit() for ch in head) and rest:
            d.text(xy, head, font=f, fill=GOLD)
            d.text((xy[0] + d.textlength(head + " ", font=f), xy[1]), rest, font=f, fill=PARCHMENT)
        else:
            d.text(xy, line, font=f, fill=PARCHMENT)
        bottom = max(bottom, ink[3])

    # Category tag under the title
    tag = f"Hardcore Worlds · {CATEGORY_TAG.get(c['cat'], 'World first')}"
    tf = font("vt323", 40)
    xy, _ = place(d, tag, tf, (COL_X0, bottom + 20, COL_X1, bottom + 20 + 40), valign="top")
    d.text(xy, tag, font=tf, fill=MUTED)

    # Divider and the claim label; the claim area below stays empty for cards.py
    d.line((COL_X0, DIVIDER_Y, COL_X1, DIVIDER_Y), fill=LINE, width=2)
    d.line((COL_X0, DIVIDER_Y, COL_X0 + 150, DIVIDER_Y), fill=GOLD, width=3)
    dx = COL_X0 + 162
    d.polygon(((dx, DIVIDER_Y - 7), (dx + 7, DIVIDER_Y), (dx, DIVIDER_Y + 7), (dx - 7, DIVIDER_Y)), fill=GOLD)
    _spaced(d, (COL_X0, CLAIM_LABEL_Y), "THE FALLEN" if c["cat"] == "death" else "CLAIMED BY", font("silk", 24), MUTED, 7)

    # Footer
    d.line((90, 770, W - 90, 770), fill=LINE, width=1)
    ff = font("silk", 40)
    xy, _ = place(d, "deathtoll.gg", ff, (COL_X0, 786, W - 90, 836), align="right")
    d.text(xy, "deathtoll.gg", font=ff, fill=GOLD)
    cf = font("vt323", 30)
    # owner: no Wiki credit line on cards  #     xy, _ = place(d, "Images via the OSRS Wiki", cf, (90, 790, 700, 832))
    # owner: no Wiki credit line on cards  #     d.text(xy, "Images via the OSRS Wiki", font=cf, fill=(110, 102, 124))
    return img


def save_png(img, path, colors=None):
    """Optimized PNG (full colour: the smooth panels compress to ~100 KB; pass colors to quantize)."""
    P = pil()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if colors:
        img = img.convert("RGB").quantize(colors=colors, method=P.Image.Quantize.MEDIANCUT,
                                          dither=P.Image.Dither.FLOYDSTEINBERG)
    img.save(path, optimize=True)


# ---------- CLI ----------

def readme(cat, mt):
    import xposts
    rows = ["# World-first cards", "",
            "One card per world first, attached to its post on X (@osrsdeathtoll) the moment it is claimed.", "",
            "- `firsts/<id>.png`: the template (background, art, title, footer). Made by `python3 scraper/card_templates.py`.",
            "- `examples/<id>.png`: the template with the sample claimant **Iron Ridley**, drawn by `scraper/cards.py`.",
            "- `art/`: category art cached from the OSRS Wiki (`art/sources.json` lists where each came from).",
            "", "At post time `scraper/cards.py` draws the real name(s), the value line and the date onto the template; "
            "if anything about the card fails the post goes out as text only.", "",
            f"## All {len(cat)} firsts and their post text", "",
            "Post text shown for a single claimant, Iron Ridley (`<br>` = blank line). With several, the names "
            "are joined (\"A, B and C\") and the post ends \"First spotted together.\" (deaths: \"They fell together.\"). "
            "The card shows them as \"A & B\" or \"A, B +1\".", "",
            "| id | card | post text |", "|---|---|---|"]
    for c in cat:
        text = xposts.world_first_text(sample_first(c, mt), mt).replace("\n\n", "<br>").replace("\n", "<br>").replace("|", "\\|")
        rows.append(f"| `{c['id']}` | [{c['title']}](examples/{c['id']}.png) | {text} |")
    return "\n".join(rows) + "\n"


CONTACT_IDS = ["total-2000", "total-2376", "99-attack", "99-slayer", "99-sailing", "kc-78", "kc-31", "kc-76",
               "kc-80", "kc-82", "kc-83", "kc-57", "kc-91", "kc-87", "kc-67", "kc-25", "kc-13", "death-1000",
               "death-2000", "death-2376"]


def contact_sheet(path, ids=CONTACT_IDS, cols=4, tile=(400, 225), gap=8):
    """A grid of example cards (for PR descriptions and quick review)."""
    P = pil()
    rows = (len(ids) + cols - 1) // cols
    sheet = P.Image.new("RGB", (cols * tile[0] + (cols + 1) * gap, rows * tile[1] + (rows + 1) * gap), BG)
    for i, fid in enumerate(ids):
        im = P.Image.open(os.path.join(CARDS_DIR, "examples", f"{fid}.png")).convert("RGB").resize(tile, P.Image.LANCZOS)
        sheet.paste(im, (gap + (i % cols) * (tile[0] + gap), gap + (i // cols) * (tile[1] + gap)))
    save_png(sheet, path)
    return path


def main(argv):
    if not pil():
        print("Pillow is required")
        return 1
    if "--contact" in argv:
        print(contact_sheet(argv[argv.index("--contact") + 1]))
        return 0
    fetch = "--no-fetch" not in argv
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    mt = max_total()
    cat = catalog()
    missing = []
    for c in cat:
        if only and c["id"] not in only:
            continue
        art, _ = get_art(c, fetch=fetch) if fetch else (None, None)
        if art is None and c["cat"] not in ("total", "death") and not os.path.exists(os.path.join(ART_DIR, f"{_slug(c)}.png")):
            missing.append(c["id"])
        tpl = build_template(c, mt, fetch=False)
        save_png(tpl, cards.template_path(c["id"]))
        ex = tpl.copy()
        cards.draw_claim(ex, sample_first(c, mt), mt)
        save_png(ex, os.path.join(CARDS_DIR, "examples", f"{c['id']}.png"), colors=256)
        print("wrote", c["id"])
    if not only:
        with open(os.path.join(CARDS_DIR, "README.md"), "w", encoding="utf-8") as f:
            f.write(readme(cat, mt))
    if missing:
        print(f"{len(missing)} firsts use the drawn medallion (no wiki art yet): {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
