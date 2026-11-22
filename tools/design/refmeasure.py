#!/usr/bin/env python3
"""Measure geometry and palette from the Winterfest reference screenshots.

Standard library + Pillow only.  Nothing here writes to the reference images:
every function crops a copy in memory.

The reference set is a set of dark, glassy mockups.  Flat-colour and
"find the card background" heuristics fail on them (cards and page background
are within a few levels of each other and every surface has a gradient), so the
measurements below use *edge structure* instead:

  * a vertical card border is a near-continuous 1-3 px column of horizontal
    gradient running the height of the card, so it produces a high per-column
    coverage in a difference mask;
  * a column pair only counts as a card when the rectangle between them also
    shows a long horizontal edge (the card's top or bottom border) spanning
    most of its width -- text and icon edges never span a whole card.

Everything that cannot be pinned down this way is reported with
``estimated: true`` rather than invented.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from statistics import median

from PIL import Image, ImageChops, ImageFilter

# Difference threshold (0-255) for "there is an edge here".
EDGE = 20
# Per-column coverage (0-255 after averaging) a column needs to be a boundary
# peak, as a fraction of the strongest peak in the same band.
PEAK_FRACTION = 0.55
# How much of a candidate rectangle's width must be covered by a single row of
# horizontal edges before the rectangle is accepted as a card.
CARD_ROW_COVERAGE = 0.65


# --------------------------------------------------------------------------
# low level helpers
# --------------------------------------------------------------------------

def open_ref(path: str) -> Image.Image:
    """Open a reference image into RGB, without modifying the file."""
    with Image.open(path) as im:
        return im.convert("RGB")


def _col_profile(im: Image.Image, box: tuple[int, int, int, int]) -> list[int]:
    """Per-column coverage (0..255) of horizontal edges inside ``box``."""
    x0, y0, x1, y1 = box
    band = im.crop((x0, y0, max(x0 + 1, x1), max(y0 + 1, y1))).convert("L")
    dx = ImageChops.difference(band, ImageChops.offset(band, 1, 0))
    mask = dx.point(lambda v: 255 if v > EDGE else 0)
    return list(mask.resize((mask.width, 1), Image.BOX).get_flattened_data())


def _row_profile(im: Image.Image, box: tuple[int, int, int, int]) -> list[int]:
    """Per-row coverage (0..255) of vertical edges inside ``box``."""
    x0, y0, x1, y1 = box
    band = im.crop((x0, y0, max(x0 + 1, x1), max(y0 + 1, y1))).convert("L")
    dy = ImageChops.difference(band, ImageChops.offset(band, 0, 1))
    mask = dy.point(lambda v: 255 if v > EDGE else 0)
    return list(mask.resize((1, mask.height), Image.BOX).get_flattened_data())


def _mask(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    band = im.crop((x0, y0, max(x0 + 1, x1), max(y0 + 1, y1))).convert("L")
    return ImageChops.difference(band, ImageChops.offset(band, 1, 0)).point(
        lambda v: 255 if v > EDGE else 0
    )


def _runs(values: list[int], limit: int = 4) -> list[list[int]]:
    """Group ascending integers into runs no more than ``limit`` apart."""
    runs: list[list[int]] = []
    for v in values:
        if runs and v - runs[-1][-1] <= limit:
            runs[-1].append(v)
        else:
            runs.append([v])
    return runs


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------

def sidebar_width(im: Image.Image) -> dict:
    """Right edge of the sidebar, searched in the only place it can be.

    The sidebar is a solid panel from x=0; its right border is the single
    strongest near-vertical line in the strip x=180..520 (18 %-31 % of a
    1672 px frame).  The 14 px gutter after it is flat, so the border stands
    out even on art-heavy pages.
    """
    w, h = im.size
    lo, hi = int(w * 0.10), int(w * 0.34)
    prof = _col_profile(im, (lo, int(h * 0.12), hi, int(h * 0.92)))
    # Ignore the first/last two columns: the crop edge itself is an "edge".
    trimmed = prof[2:-2]
    if not trimmed:
        return {"px": None, "estimated": True, "confidence": 0.0}
    peak = max(trimmed)
    if peak < 60:
        return {"px": None, "estimated": True, "confidence": 0.0}
    x = lo + 2 + trimmed.index(peak)
    peers = sorted(trimmed, reverse=True)[1:6]
    second = peers[0] if peers else 0
    conf = round(1.0 - (second / peak if peak else 0.0), 2)
    return {
        "px": x,
        "share_of_width": round(100.0 * x / w, 1),
        "estimated": False,
        "confidence": conf,
    }


@dataclass
class Band:
    y0: int
    y1: int
    intervals: list[tuple[int, int]] = field(default_factory=list)
    peaks: list[int] = field(default_factory=list)
    gutters: list[tuple[int, int]] = field(default_factory=list)


def _row_coverage(im: Image.Image, x0: int, x1: int, y0: int, y1: int) -> list[int]:
    """Per-row fraction of columns in [x0,x1) that carry a horizontal edge."""
    mask = _mask(im, (x0, y0, x1, y1))
    return list(mask.resize((1, mask.height), Image.BOX).get_flattened_data())


def content_columns(im: Image.Image, y_center: int, height: int = 110) -> Band:
    """Detect the content columns crossing a horizontal band at ``y_center``.

    Card borders were tried first and rejected: these mockups draw a border on
    inner panels too, so "peak pairs" report nested boxes, not the page's
    columns.  The gutter between two columns, however, is unambiguous: a run of
    columns with almost no edge coverage, fenced on both sides by a strong
    border.  The columns are the spans between those gutters, so the reported
    x-boundaries are the *card* edges the implementer needs.

    The band position is chosen per page (``probe`` in reference_notes.json)
    and reported with every result, because a band through the gap between two
    card rows measures nothing useful.
    """
    w, h = im.size
    y0 = max(0, y_center - height // 2)
    y1 = min(h, y_center + height // 2)
    sidebar = sidebar_width(im)["px"] or int(w * 0.18)
    x_start = sidebar + 8
    x_end = w - 6
    prof = _col_profile(im, (x_start, y0, x_end, y1))
    band = Band(y0=y0, y1=y1)
    if not prof:
        return band

    ordered = sorted(prof)
    q99 = ordered[int(len(ordered) * 0.99)] if ordered else 0
    strong = max(q99 * 0.6, 70)

    low_runs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(prof):
        is_low = v <= 22
        if is_low and start is None:
            start = i
        elif not is_low and start is not None:
            low_runs.append((start, i - 1))
            start = None
    if start is not None:
        low_runs.append((start, len(prof) - 1))

    def fenced(a: int, b: int) -> bool:
        lo, hi = max(0, a - 8), min(len(prof) - 1, b + 8)
        left = any(prof[j] >= strong for j in range(lo, a))
        right = any(prof[j] >= strong for j in range(b + 1, hi + 1))
        return left and right

    gutters = [(x_start + a, x_start + b) for a, b in low_runs if (b - a + 1) >= 8 and fenced(a, b)]
    band.gutters = gutters
    band.peaks = [x_start + i for i, v in enumerate(prof) if v >= strong]

    edges = [x_start] + [x for pair in gutters for x in pair] + [x_end]
    for i in range(0, len(edges) - 1, 2):
        a, b = edges[i], edges[i + 1]
        if b - a >= 120:
            band.intervals.append((a, b))
    return band


def top_bar(im: Image.Image) -> dict:
    """Height of the empty strip under the top bar's controls.

    The top bar does not draw a full-width border, so the strip is found from
    the *absence* of edges: the row band between the currency pills and the
    hero (or the page title) is the only place in the upper third where a run
    of rows has almost no edges at all across the content width.  The measured
    value is where that gap ends and content resumes.
    """
    w, h = im.size
    side = sidebar_width(im)["px"] or int(w * 0.18)
    x0, x1 = min(w - 2, side + 14), w - 12
    y1 = int(h * 0.25)
    band = im.crop((x0, 0, x1, y1)).convert("L")
    dx = ImageChops.difference(band, ImageChops.offset(band, 1, 0))
    dy = ImageChops.difference(band, ImageChops.offset(band, 0, 1))
    mask = ImageChops.lighter(dx, dy).point(lambda v: 255 if v > 18 else 0)
    rows = list(mask.resize((1, mask.height), Image.BOX).get_flattened_data())

    runs: list[tuple[int, int]] = []
    i = 30
    while i < len(rows):
        if rows[i] < 18:
            j = i
            while j + 1 < len(rows) and rows[j + 1] < 18:
                j += 1
            if j - i >= 3:
                runs.append((i, j))
            i = j + 1
        else:
            i += 1
    # The last flat band before the content proper; content resumption is the
    # row right after it.
    height = runs[-1][1] + 1 if runs else None
    return {
        "height_px": height,
        "gaps": [[a, b] for a, b in runs],
        "estimated": True,
        "note": "height = where the edge-free strip under the currency pills ends",
    }


def _hlines(im: Image.Image, box: tuple[int, int, int, int], min_run: int = 800) -> list[tuple[int, int, int]]:
    """Detect long horizontal borders: (y, x_start, length).

    The run-length test is what separates a hero's border from text: a text
    line breaks every few pixels, this one does not.
    """
    x0, y0, x1, y1 = box
    band = im.crop(box).convert("L")
    mask = ImageChops.difference(band, ImageChops.offset(band, 0, 1)).point(
        lambda v: 255 if v > 18 else 0
    )
    for d in (1, 2, 3):
        mask = ImageChops.lighter(mask, ImageChops.offset(mask, d, 0))
        mask = ImageChops.lighter(mask, ImageChops.offset(mask, -d, 0))
    w, h = mask.size
    data = mask.tobytes()
    hits = []
    for y in range(h):
        row = data[y * w:(y + 1) * w]
        best = max(row.split(b"\x00"), key=len)
        if len(best) >= min_run:
            start = row.find(best)
            hits.append((y0 + y, x0 + start, len(best)))
    merged: list[list[tuple[int, int, int]]] = []
    for t in hits:
        if merged and t[0] - merged[-1][-1][0] <= 3:
            merged[-1].append(t)
        else:
            merged.append([t])
    return [(g[0][0], g[-1][0], max(t[2] for t in g)) for g in merged]


def hero_band(im: Image.Image, top_bar_bottom: int | None) -> dict:
    """The full-bleed artwork strip under the top bar, if the page has one.

    The hero is a rounded rectangle whose top border is a long, continuous,
    near-horizontal line -- unlike anything in the art above or the cards below
    (a card border is only as wide as its column).  So: the first long
    horizontal line under the top bar is the hero's top edge, and the next one
    120-420 px lower is its bottom edge.  When the bottom border is hidden
    behind the first card row the height is reported as ``null`` rather than
    guessed.
    """
    w, h = im.size
    side = sidebar_width(im)["px"] or int(w * 0.18)
    boxes = (side + 8, 30, w - 8, int(h * 0.55))
    lines = _hlines(im, boxes, min_run=700)
    # The hero's top border has to sit just under the top bar; a long line
    # lower down is a row of cards or a banner, not the hero's edge.
    tops = [ln for ln in lines if 40 <= ln[0] <= 145]
    if not tops:
        # The page still has art under the top bar; we just cannot see its top
        # border. Anchor the hero where the top bar measurably ends.
        return {"top_border_y": top_bar_bottom, "bottom_border_y": None, "height_px": None,
                "top_border_source": "top-bar" if top_bar_bottom else None,
                "estimated": True,
                "note": "hero top anchored at the measured top bar height; no long horizontal border found"}
    top_y = tops[0][0]
    bottom_y = None
    for y, _x, _len in lines:
        if 120 <= y - top_y <= 420:
            bottom_y = y
            break
    return {
        "top_border_y": top_y,
        "bottom_border_y": bottom_y,
        "top_border_source": "detected",
        "height_px": (bottom_y - top_y) if bottom_y else None,
        "estimated": bottom_y is None,
        "note": ("hero top and bottom borders measured" if bottom_y
                 else "hero top border measured; bottom border not separable from the first card row"),
    }


def card_radius(im: Image.Image, band: Band) -> dict:
    """Corner radius of the first card in ``band`` (estimated +-2 px).

    Finds the card's top border (the first row inside a 140 px window above the
    band whose horizontal edge spans at least half the card), then walks the
    top-left corner: the border's first lit column moves left as the curve
    flattens, and the row where it stops moving is the radius.
    """
    for (a, b) in band.intervals:
        if b - a < 150:
            continue
        y_lo = max(0, band.y0 - 140)
        rows = _row_coverage(im, a, b, y_lo, band.y1)
        hits = [y_lo + i for i, v in enumerate(rows) if v >= 0.5 * 255]
        if not hits:
            continue
        top = hits[0]

        def corner(left_side: bool) -> int | None:
            if left_side:
                box = (max(0, a - 2), top, min(im.size[0], a + 44), min(im.size[1], top + 34))
            else:
                box = (max(0, b - 44), top, min(im.size[0], b + 2), min(im.size[1], top + 34))
            mask = _mask(im, box)
            pix = mask.load()
            offsets = []
            for dy in range(mask.height):
                found = None
                for dx in range(mask.width):
                    x = dx if left_side else mask.width - 1 - dx
                    if pix[x, dy] > 0:
                        found = dx
                        break
                offsets.append(found)
            known = [o for o in offsets if o is not None]
            if not known:
                return None
            straight = min(known)
            for dy, off in enumerate(offsets):
                if off is not None and off - straight <= 1:
                    return dy
            return None

        left_r, right_r = corner(True), corner(False)
        # Both corners must agree, or the "radius" is a glow artefact on one side.
        if left_r and right_r and abs(left_r - right_r) <= 2 and left_r >= 6:
            return {"px": left_r, "estimated": True, "card_x": [a, b], "top_y": top,
                    "left_corner": left_r, "right_corner": right_r}
    return {"px": None, "estimated": True, "card_x": None, "top_y": None}


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------

def palette(im: Image.Image, box: tuple[int, int, int, int], colours: int = 6) -> list[dict]:
    """Most common colours in a band, as hex + share of the band's pixels.

    Quantised to 32 buckets with a median cut (no dithering) and reported as the
    bucket centroid, because the references are gradients and the raw exact
    colours are almost all unique.  Shares therefore add up to <= 100 % of the
    32 buckets, not of every pixel.
    """
    x0, y0, x1, y1 = box
    x1 = min(x1, im.width)
    y1 = min(y1, im.height)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return []
    crop = im.crop((x0, y0, x1, y1))
    scale = min(1.0, 480.0 / max(crop.size))
    if scale < 1.0:
        crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))), Image.BOX)
    q = crop.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    pal = q.getpalette() or []
    out = []
    for count, index in sorted(counts, reverse=True)[:colours]:
        r, g, b = pal[index * 3: index * 3 + 3]
        out.append({"hex": "#%02x%02x%02x" % (r, g, b), "share": round(100.0 * count / total, 1)})
    return out


# --------------------------------------------------------------------------
# whole reference
# --------------------------------------------------------------------------

def measure(path: str, probes: dict | None = None) -> dict:
    """Measure one reference image.

    ``probes`` names the two horizontal bands in which the columns are counted,
    as fractions of the image height (the pages have different card rows, so
    the same fraction lands on a card on one page and in a gap on another).
    """
    probes = probes or {}
    upper_frac = float(probes.get("upper", 0.58))
    lower_frac = float(probes.get("lower", 0.90))
    height = int(probes.get("band_height", 110))

    im = open_ref(path)
    w, h = im.size
    side = sidebar_width(im)
    top = top_bar(im)
    upper = content_columns(im, int(h * upper_frac), height)
    lower = content_columns(im, int(h * lower_frac), height)
    hero = hero_band(im, top.get("height_px"))
    if hero.get("top_border_source") == "detected":
        # The hero's own top border is the most reliable "top bar height" the
        # page offers: it is the line the content frame starts at.
        top["height_px"] = hero["top_border_y"]
        top["note"] = "height = hero top border measured by the long-line detector"

    content_x = min(w - 1, (side["px"] or int(w * 0.18)) + 14)
    footer_h = max(60, int(h * 0.075))
    hero_top = hero["top_border_y"]
    hero_bottom = hero["bottom_border_y"]
    # Without a hero bottom border the content band starts under the top bar;
    # the palette then includes some art, which is stated in the matrix.
    main_y0 = min(h - 1, ((hero_bottom or top.get("height_px") or 0) + 4))
    main_y1 = max(main_y0 + 4, h - footer_h)

    bands = {
        "top_bar": (content_x, 0, w, max(8, top.get("height_px") or int(h * 0.09))),
        "sidebar": (0, int(h * 0.10), side["px"] or int(w * 0.18), h - 8),
        "main": (content_x, main_y0, w, main_y1),
        "footer": (0, h - footer_h, w, h),
    }
    doc_hero = probes.get("hero_doc") or {}
    if doc_hero.get("top") and doc_hero.get("bottom"):
        bands["hero"] = (content_x, int(doc_hero["top"]), w, int(doc_hero["bottom"]))
    elif hero_top is not None and hero_bottom is not None:
        bands["hero"] = (content_x, hero_top, w, hero_bottom)
    # With no bottom border there is no defensible hero band, so none is
    # sampled: inventing one would move the card row into the hero's palette.

    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()

    def band_dict(band: Band, frac: float) -> dict:
        return {
            "probe_fraction": frac,
            "y_band": [band.y0, band.y1],
            "count": len(band.intervals),
            "intervals": [[a, b] for a, b in band.intervals],
            "gutters": [[a, b] for a, b in band.gutters],
            "estimated": True,
        }

    return {
        "file": os.path.basename(path),
        "width": w,
        "height": h,
        "bytes": os.path.getsize(path),
        "sha256": digest,
        "geometry": {
            "sidebar": side,
            "top_bar": top,
            "hero": hero,
            "columns_upper": band_dict(upper, upper_frac),
            "columns_lower": band_dict(lower, lower_frac),
            "card_radius": card_radius(im, upper if upper.intervals else lower),
        },
        "palette": {name: palette(im, box) for name, box in bands.items()},
        "palette_bands": {name: list(box) for name, box in bands.items()},
        "palette_hero_sampled": "hero" in bands,
        "palette_note": "median-cut quantised to 32 buckets per band, no dithering",
    }
