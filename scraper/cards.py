"""World-first cards: the 1600x900 image attached to each world-first post on X.

Each first has a template at cards/firsts/<id>.png (repo root), made by scraper/card_templates.py:
background, category art, "WORLD FIRST" eyebrow, the first's title and the footer. This module
draws the claim on top: the name(s), a value line and a date line, each fitted inside its own box.

    render_first_card(first, max_total) -> path to a PNG, or None

Robustness rule: a card is a nice-to-have. Any failure (Pillow missing and not installable, a
missing font or template, odd data) returns None and the post goes out as text only. Nothing in
here may raise into the pipeline.

Pillow is imported lazily. If it is missing, `python3 -m pip install --user pillow==PILLOW_VERSION`
runs once per process (with --break-system-packages as a second try, for PEP 668 Pythons such as
the GitHub runner's); if that fails too, cards are skipped for the rest of the run.
"""
import importlib
import os
import subprocess
import sys
import tempfile
import traceback
from datetime import datetime, timezone

PILLOW_VERSION = "12.3.0"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
TEMPLATE_DIR = os.path.join(ROOT, "cards", "firsts")

W, H = 1600, 900
# Palette (the site's): near-black, panel, gold, parchment, muted lavender text.
BG = (7, 6, 11)
PANEL = (27, 24, 32)
GOLD = (255, 152, 31)
GOLD_DIM = (122, 92, 40)
PARCHMENT = (233, 219, 184)
MUTED = (157, 147, 176)
LINE = (58, 50, 66)
BLOOD = (196, 48, 48)

# Layout. The right-hand column holds all text; the art sits on the left.
COL_X0, COL_X1 = 720, 1520
EYEBROW_Y = 104
TITLE_BOX = (COL_X0, 162, COL_X1, 322)          # template: the first's title, up to two lines
TAG_BOX = (COL_X0, 330, COL_X1, 374)            # template: "Hardcore Worlds · Boss"
DIVIDER_Y = 402
CLAIM_LABEL_Y = 424                             # template: "CLAIMED BY"
NAME_BOX = (COL_X0, 462, COL_X1, 588)           # card: the name(s)
VALUE_BOX = (COL_X0, 600, COL_X1, 662)          # card: "Total level 2,000"
DATE_BOX = (COL_X0, 670, COL_X1, 720)           # card: "First spotted Wed 4 Nov 2026 · 11:42 UTC"
CLAIM_BOXES = (NAME_BOX, VALUE_BOX, DATE_BOX)   # left blank in every template
ART_CENTER, ART_BOX = (380, 466), 470

NAME_MAX, NAME_MIN = 112, 24
VALUE_SIZE, DATE_SIZE = 58, 42

_pil = None          # the PIL namespace once imported
_pil_failed = False  # import + one install attempt both failed: stop trying this process
_fonts = {}


# ---------- Pillow ----------

def pil():
    """Returns a namespace with Image, ImageDraw, ImageFont, ImageFilter, ImageChops, or None."""
    global _pil, _pil_failed
    if _pil is not None or _pil_failed:
        return _pil
    try:
        _pil = _import_pil()
        return _pil
    except ImportError:
        pass
    for extra in ([], ["--break-system-packages"]):
        try:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "--user", "--quiet", "--disable-pip-version-check",
                                *extra, f"pillow=={PILLOW_VERSION}"], capture_output=True, text=True, timeout=120)
            if r.returncode == 0:
                break
            print(f"cards: pip install pillow failed ({r.returncode}): {(r.stderr or '')[-300:]}")
        except Exception as e:  # noqa: BLE001
            print(f"cards: pip install pillow failed: {e}")
    try:
        import site
        site.addsitedir(site.getusersitepackages())   # the user site may not have existed at startup
        importlib.invalidate_caches()
        _pil = _import_pil()
    except Exception as e:  # noqa: BLE001
        print(f"cards: Pillow unavailable, cards disabled for this run: {e}")
        _pil_failed = True
    return _pil


def _import_pil():
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

    class P:
        pass
    p = P()
    p.Image, p.ImageDraw, p.ImageFont, p.ImageFilter, p.ImageChops = Image, ImageDraw, ImageFont, ImageFilter, ImageChops
    return p


def font(kind, size):
    """kind: cinzel-black, cinzel-bold, vt323, silk, silk-bold."""
    key = (kind, size)
    if key in _fonts:
        return _fonts[key]
    P = pil()
    files = {"cinzel-black": "Cinzel-Variable.ttf", "cinzel-bold": "Cinzel-Variable.ttf", "vt323": "VT323-Regular.ttf",
             "silk": "Silkscreen-Regular.ttf", "silk-bold": "Silkscreen-Bold.ttf"}
    f = P.ImageFont.truetype(os.path.join(FONT_DIR, files[kind]), size)
    if kind.startswith("cinzel"):
        try:
            f.set_variation_by_axes([900 if kind == "cinzel-black" else 700])
        except Exception:  # noqa: BLE001 - FreeType without variation support: regular weight still reads fine
            pass
    _fonts[key] = f
    return f


# ---------- text ----------

def clean_name(n):
    return " ".join(str(n or "").replace(" ", " ").replace("_", " ").split()) or "?"


def names_text(names):
    """'A', 'A & B', 'A, B +1'."""
    names = [clean_name(n) for n in names or []] or ["?"]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} & {names[1]}"
    return f"{names[0]}, {names[1]} +{len(names) - 2}"


def _n(v):
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return None


def value_text(first, max_total=None):
    cat, v = first.get("cat"), _n(first.get("value"))
    if cat == "total":
        if v is None:   # fall back to the threshold in the id
            v = _n(str(first.get("id", "")).rsplit("-", 1)[-1])
        return f"Total level {v}" if v else None
    if v is None:
        return None
    return {"99": f"{v} XP", "raid": f"Completions {v}", "boss": f"Kill count {v}",
            "clue": f"Master clues {v}", "death": f"Fell at {v} total"}.get(cat)


def date_text(seen):
    try:
        t = datetime.strptime(seen, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return f"First spotted {t:%a} {t.day} {t:%b %Y} · {t:%H:%M} UTC"


# ---------- fitting ----------

def text_box(draw, xy, text, f, spacing=0):
    if spacing:
        x, y = xy
        boxes = []
        for ch in text:
            b = draw.textbbox((x, y), ch, font=f)
            boxes.append(b)
            x += draw.textlength(ch, font=f) + spacing
        boxes = [b for b in boxes if b[2] > b[0]] or [(xy[0], xy[1], xy[0], xy[1])]
        return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return draw.textbbox(xy, text, font=f)


def place(draw, text, f, box, align="left", valign="center", spacing=0):
    """Position text so its ink box sits inside `box`. Returns (xy, ink_box)."""
    l, t, r, b = text_box(draw, (0, 0), text, f, spacing)
    w, h = r - l, b - t
    if align == "left":
        x = box[0] - l
    elif align == "right":
        x = box[2] - w - l
    else:
        x = box[0] + (box[2] - box[0] - w) / 2 - l
    if valign == "top":
        y = box[1] - t
    elif valign == "bottom":
        y = box[3] - h - t
    else:
        y = box[1] + (box[3] - box[1] - h) / 2 - t
    x, y = round(x), round(y)
    return (x, y), (x + l, y + t, x + r, y + b)


def fits(ink, box):
    return ink[0] >= box[0] and ink[1] >= box[1] and ink[2] <= box[2] and ink[3] <= box[3]


def fit(draw, text, kind, box, size, min_size, step=2, **kw):
    """Largest font size (down to min_size) whose ink fits the box; then ellipsis if it still does not."""
    while True:
        f = font(kind, size)
        xy, ink = place(draw, text, f, box, **kw)
        if fits(ink, box) or size <= min_size:
            break
        size = max(min_size, size - step)
    while not fits(ink, box) and len(text) > 2:
        text = text[:-2].rstrip() + "…"
        xy, ink = place(draw, text, f, box, **kw)
    return text, f, xy, ink


def plan_first_card(first, max_total=None, draw=None):
    """The claim layer: list of dicts {role, text, font, xy, ink, box, fill}. Used by render and the tests."""
    P = pil()
    draw = draw or P.ImageDraw.Draw(P.Image.new("RGB", (8, 8)))
    items = []
    t, f, xy, ink = fit(draw, names_text(first.get("names")), "cinzel-bold", NAME_BOX, NAME_MAX, NAME_MIN)
    items.append({"role": "name", "text": t, "font": f, "xy": xy, "ink": ink, "box": NAME_BOX,
                  "fill": PARCHMENT if first.get("cat") == "death" else GOLD})
    for role, text, size, box, fill in (("value", value_text(first, max_total), VALUE_SIZE, VALUE_BOX, PARCHMENT),
                                        ("date", date_text(first.get("seen")), DATE_SIZE, DATE_BOX, MUTED)):
        if text:
            t, f, xy, ink = fit(draw, text, "vt323", box, size, 22)
            items.append({"role": role, "text": t, "font": f, "xy": xy, "ink": ink, "box": box, "fill": fill})
    return items


# ---------- render ----------

def template_path(fid):
    return os.path.join(TEMPLATE_DIR, f"{fid}.png")


def load_template(first, max_total=None):
    P = pil()
    path = template_path(first["id"])
    if os.path.exists(path):
        return P.Image.open(path).convert("RGB")
    # No committed template (a first added later): build one now, without fetching art.
    import card_templates
    return card_templates.build_template(first, max_total, fetch=False).convert("RGB")


def draw_claim(img, first, max_total=None):
    P = pil()
    d = P.ImageDraw.Draw(img)
    items = plan_first_card(first, max_total, d)
    for it in items:
        if it["role"] == "name":   # soft shadow so the name lifts off the panel
            sh = P.Image.new("L", img.size, 0)
            P.ImageDraw.Draw(sh).text((it["xy"][0], it["xy"][1] + 6), it["text"], font=it["font"], fill=170)
            sh = sh.filter(P.ImageFilter.GaussianBlur(10))
            img.paste((0, 0, 0), (0, 0), sh)
        d.text(it["xy"], it["text"], font=it["font"], fill=it["fill"])
    return items


def render_first_card(first, max_total=None, out_dir=None):
    """Draws the card for a claimed first. Returns the PNG path, or None on any failure."""
    try:
        if not pil():
            return None
        img = load_template(first, max_total)
        draw_claim(img, first, max_total)
        out_dir = out_dir or os.path.join(tempfile.gettempdir(), "deathtoll-cards")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{first['id']}.png")
        img.save(path, optimize=True)
        if os.path.getsize(path) > 4_500_000:   # X's image limit is 5 MB
            path = path[:-4] + ".jpg"
            img.save(path, quality=92)
        return path
    except Exception:  # noqa: BLE001 - never crash the pipeline over a picture
        print("cards: render failed for", (first or {}).get("id"))
        traceback.print_exc()
        return None
