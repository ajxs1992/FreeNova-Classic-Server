#!/usr/bin/env python3
"""Generate the FreeNova Battle Pass skill icons ("Vault Plate" style).

Scope
-----
Writes exactly 14 files under ``web-panel/assets/bp`` (filenames are stable):

    skill_multi_jump.png   skill_spawn_hp.png      skill_spawn_armor.png
    skill_vampire.png      skill_nimble.png        skill_featherfall.png
    skill_healthnade.png   skill_fast_sniper.png   skill_revive.png
    skill_laststand.png    skill_parachute.png     skill_awp_unlock.png
    skill_chat_color.png   star.png

Style contract
--------------
* 96x96 RGBA. Interior is opaque; only the 8px outer margin is transparent.
* Plate = 80x80 box at (8,8): outer 4px keyline ``#0B0F0E`` -> 6px frame band
  with a vertical gradient ``#39423D -> #232A27`` -> 60x60 field ``#121716``.
* Emblem box is 48x48, centred in the field, minimum stroke 6px.
* ``star.png`` is the bare gold star: same canvas, no plate.
* Output must land in 6-20KB per file with 14 distinct hashes.

Emblems (from the BP perk palette)
----------------------------------
    multi_jump    3 chevrons      #2FD07A
    spawn_hp      heart           #FF6B7A
    spawn_armor   shield          #6CC5FF / #4FA6E8
    vampire       blood drop      #FF4D6E
    nimble        streaks         #3DFF9E
    featherfall   feather         #DCE9F5
    healthnade    grenade         #56D98F
    fast_sniper   crosshair       #2BE7E7   (NOT a license card)
    revive        paddles         #74E7C8
    laststand     shield + heart  #FFA34E / #FF6B7A
    parachute     canopy          #8FD4FF / #5AA9E8
    awp_unlock    license card    #F2C14E   (NOT a crosshair)
    chat_color    2-tone bubble   #5BC8FF / #FF7AD9
    star          gold star       gradient, no plate

Pure local Python + Pillow. No network, no paid APIs, no secrets, no renderer
changes. Output is byte-deterministic: re-running always yields identical PNGs.

Usage
-----
    python scripts/gen_bp_skills.py            # write the 14 icons
    python scripts/gen_bp_skills.py --check    # verify only, write nothing
"""

from __future__ import annotations

import hashlib
import io
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw

# --------------------------------------------------------------------------
# geometry / palette
# --------------------------------------------------------------------------

SIZE = 96          # output canvas
SS = 4             # supersample factor for anti-aliased masks
MARGIN = 8         # transparent outer margin -> plate box is (8,8)-(87,87)

KEYLINE = (11, 15, 14)        # #0B0F0E  outer 4px keyline
FRAME_TOP = (57, 66, 61)      # #39423D  frame gradient top
FRAME_BOT = (35, 42, 39)      # #232A27  frame gradient bottom
FIELD = (18, 23, 22)          # #121716  plate field

PLATE = (8, 8, 87, 87)        # 80x80 silhouette, radius 10
FRAME = (12, 12, 83, 83)      # 72x72 gradient band, radius 7
FIELD_BOX = (18, 18, 77, 77)  # 60x60 field, radius 4
EMBLEM = (24, 24, 72, 72)     # 48x48 emblem box (6px gutter inside field)

MIN_B, MAX_B = 6 * 1024, 20 * 1024

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "bp")


# --------------------------------------------------------------------------
# low-level drawing helpers (all coordinates are given in 96x96 space)
# --------------------------------------------------------------------------

def mask_of(fn) -> Image.Image:
    """Rasterise ``fn(draw, scale)`` at SSx and downsample to a smooth mask."""
    m = Image.new("L", (SIZE * SS, SIZE * SS), 0)
    fn(ImageDraw.Draw(m), SS)
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def stamp(img: Image.Image, fn, color, alpha: int = 255, clip=None) -> Image.Image:
    """Composite a solid ``color`` through the shape mask ``fn``.

    ``fn`` is either a ``draw`` callback or a pre-rasterised ``L`` mask.
    """
    m = fn if isinstance(fn, Image.Image) else mask_of(fn)
    if clip is not None:
        cm = clip if isinstance(clip, Image.Image) else mask_of(clip)
        m = ImageChops.multiply(m, cm)
    if alpha != 255:
        m = m.point(lambda v: v * alpha // 255)
    layer = Image.new("RGBA", (SIZE, SIZE), tuple(color) + (255,))
    layer.putalpha(m)
    return Image.alpha_composite(img, layer)


def rotated_mask(fn, angle, center):
    """Rasterise ``fn`` then rotate it about ``center`` (degrees, CCW)."""
    return mask_of(fn).rotate(angle, resample=Image.BICUBIC, center=center)


def stamp_grad(img: Image.Image, grad: Image.Image, clip_fn) -> Image.Image:
    """Composite a prebuilt RGB(A) gradient through a shape mask."""
    layer = grad.copy()
    layer.putalpha(mask_of(clip_fn))
    return Image.alpha_composite(img, layer)


def stroke(draw, pts, w, k, close: bool = False) -> None:
    """Polyline with round caps and round joints (min stroke is 6px)."""
    xy = [(x * k, y * k) for x, y in pts]
    if close:
        xy = xy + [xy[0]]
    draw.line(xy, fill=255, width=max(1, int(round(w * k))), joint="curve")
    r = (w * k) / 2.0
    for x, y in xy:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=255)


def poly(draw, pts, k) -> None:
    draw.polygon([(x * k, y * k) for x, y in pts], fill=255)


def rrect(draw, box, radius, k) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([x0 * k, y0 * k, x1 * k, y1 * k],
                           radius=radius * k, fill=255)


def vgradient(top, bottom, y0=PLATE[1], y1=PLATE[3]) -> Image.Image:
    im = Image.new("RGBA", (SIZE, SIZE))
    px = im.load()
    span = float(y1 - y0)
    rows = []
    for y in range(SIZE):
        t = min(1.0, max(0.0, (y - y0) / span))
        rows.append(tuple(int(round(top[i] + (bottom[i] - top[i]) * t))
                          for i in range(3)) + (255,))
    for y in range(SIZE):
        c = rows[y]
        for x in range(SIZE):
            px[x, y] = c
    return im


def fit(pts, box):
    """Scale/translate a polygon into ``box`` preserving aspect ratio."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, y0, x1, y1 = box
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    s = min((x1 - x0) / w, (y1 - y0) / h)
    ox = x0 + ((x1 - x0) - w * s) / 2.0 - min(xs) * s
    oy = y0 + ((y1 - y0) - h * s) / 2.0 - min(ys) * s
    return [(x * s + ox, y * s + oy) for x, y in pts]


def scale_about(pts, s, cx, cy):
    return [(cx + (x - cx) * s, cy + (y - cy) * s) for x, y in pts]


# --------------------------------------------------------------------------
# emblem shape builders
# --------------------------------------------------------------------------

def heart_points(n=160):
    """Classic parametric heart (already in screen orientation)."""
    out = []
    for i in range(n):
        t = 2.0 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        out.append((x, -y))
    return out


def heart(box):
    return fit(heart_points(), box)


def shield_points():
    """Rounded-top shield with a pointed bottom, 44 wide x 44 tall."""
    return [(0, 0), (44, 0), (44, 16), (40, 28), (32, 38),
            (22, 44), (12, 38), (4, 28), (0, 16)]


def drop_points(n=72):
    """Teardrop: apex on top, tangent lines into a circle."""
    c, r, apex = (48.0, 56.0), 16.0, (48.0, 26.0)
    d = c[1] - apex[1]
    a = math.acos(r / d)
    right = (math.sin(a), -math.cos(a))
    phi_r = math.atan2(right[1], right[0])
    phi_l = math.pi - phi_r          # left tangent, sweeping through the base
    pts = [apex]
    for i in range(n + 1):
        phi = phi_r + (phi_l - phi_r) * i / n
        pts.append((c[0] + r * math.cos(phi), c[1] + r * math.sin(phi)))
    return pts


def star_points(r_out=37.0, r_in=16.5, cx=48.0, cy=51.0):
    pts = []
    for i in range(10):
        ang = math.radians(-90.0 + i * 36.0)
        rad = r_out if i % 2 == 0 else r_in
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    return pts


def feather_points(n=26):
    """Lens/leaf silhouette with a straight shaft: reads as a feather."""
    a0, a1 = (33.0, 70.0), (64.0, 28.0)
    dx, dy = a1[0] - a0[0], a1[1] - a0[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        w = 11.0 * math.sin(math.pi * t) ** 0.7
        bx, by = a0[0] + dx * t, a0[1] + dy * t
        left.append((bx + px * w, by + py * w))
        right.append((bx - px * w, by - py * w))
    return left + right[::-1]


def canopy_points(n=40):
    """Half-ellipse dome with a scalloped bottom edge."""
    cx, cy, rx, ry = 48.0, 52.0, 24.0, 24.0
    pts = []
    for i in range(n + 1):                      # top arc, left -> right
        phi = math.pi + math.pi * i / n         # 180deg -> 360deg (y down)
        pts.append((cx + rx * math.cos(phi), cy + ry * math.sin(phi)))
    for s in range(3):                          # three scallops, right -> left
        x0 = cx + rx - (2.0 * rx) * s / 3.0
        x1 = cx + rx - (2.0 * rx) * (s + 1) / 3.0
        for i in range(1, 9):
            t = i / 8.0
            pts.append((x0 + (x1 - x0) * t, cy + 6.0 * math.sin(math.pi * t)))
    return pts


# --------------------------------------------------------------------------
# emblem layers: name -> [(draw_fn, rgb, alpha, clip_or_None), ...]
# --------------------------------------------------------------------------

def _em_multi_jump(d, k):
    for apex in (27, 43, 59):
        stroke(d, [(29, apex + 13), (48, apex), (67, apex + 13)], 7, k)


def _em_spawn_hp(d, k):
    poly(d, heart(EMBLEM), k)


def _em_spawn_hp_hi(d, k):
    d.ellipse([33 * k, 34 * k, 47 * k, 44 * k], fill=255)


def _em_shield(d, k, box=EMBLEM):
    poly(d, fit(shield_points(), box), k)


def _shield_left(d, k):
    d.rectangle([0, 0, 48 * k, 96 * k], fill=255)


def _em_drop(d, k):
    poly(d, drop_points(), k)


def _em_drop_hi(d, k):
    d.ellipse([38 * k, 50 * k, 48 * k, 62 * k], fill=255)


def _em_nimble(d, k):
    for a, b in (((34, 36), (70, 28)), ((26, 52), (70, 44)), ((34, 68), (70, 60))):
        stroke(d, [a, b], 7, k)


def _em_feather(d, k):
    poly(d, feather_points(), k)


def _em_feather_shaft(d, k):
    stroke(d, [(33, 70), (48, 50), (64, 28)], 6, k)


def _em_healthnade(d, k):
    rrect(d, (31, 38, 65, 72), 15, k)          # body
    rrect(d, (43, 27, 53, 41), 3, k)           # neck
    stroke(d, [(51, 31), (63, 35), (65, 47)], 6, k)   # lever
    stroke(d, [(43, 31), (33, 26)], 6, k)             # pin


def _em_healthnade_dark(d, k):
    rrect(d, (43, 27, 53, 41), 3, k)
    stroke(d, [(51, 31), (63, 35), (65, 47)], 6, k)
    stroke(d, [(43, 31), (33, 26)], 6, k)


def _em_cross_h(d, k):
    d.rectangle([38 * k, 52 * k, 58 * k, 58 * k], fill=255)


def _em_cross_v(d, k):
    d.rectangle([45 * k, 45 * k, 51 * k, 65 * k], fill=255)


def _em_sniper(d, k):
    for a, b in (((48, 24), (48, 38)), ((48, 58), (48, 72)),
                 ((24, 48), (38, 48)), ((58, 48), (72, 48))):
        stroke(d, [a, b], 7, k)
    d.ellipse([43 * k, 43 * k, 53 * k, 53 * k], fill=255)


def _em_paddle_grip_l(d, k):
    rrect(d, (30, 36, 38, 52), 3, k)


def _em_paddle_plate_l(d, k):
    rrect(d, (25, 50, 43, 62), 3, k)


def _em_paddle_grip_r(d, k):
    rrect(d, (58, 36, 66, 52), 3, k)


def _em_paddle_plate_r(d, k):
    rrect(d, (53, 50, 71, 62), 3, k)


def _em_cable(d, k):
    stroke(d, [(30, 64), (48, 71), (66, 64)], 6, k)


# defibrillator paddles: grips lean apart, plates converge (16deg tilt)
_PAD_GL = rotated_mask(_em_paddle_grip_l, 16, (34, 50))
_PAD_PL = rotated_mask(_em_paddle_plate_l, 16, (34, 50))
_PAD_GR = rotated_mask(_em_paddle_grip_r, -16, (62, 50))
_PAD_PR = rotated_mask(_em_paddle_plate_r, -16, (62, 50))


def _em_laststand_shield(d, k):
    stroke(d, fit(shield_points(), EMBLEM), 7, k, close=True)


def _em_laststand_heart(d, k):
    poly(d, heart((37, 40, 59, 62)), k)


def _em_canopy(d, k):
    poly(d, canopy_points(), k)


def _canopy_left(d, k):
    d.rectangle([0, 0, 40 * k, 96 * k], fill=255)


def _canopy_mid(d, k):
    d.rectangle([48 * k, 0, 56 * k, 96 * k], fill=255)


def _em_canopy_lines(d, k):
    for a, b in (((28, 56), (48, 72)), ((40, 60), (48, 72)),
                 ((56, 60), (48, 72)), ((68, 56), (48, 72))):
        stroke(d, [a, b], 6, k)


def _em_card(d, k):
    rrect(d, (26, 32, 70, 64), 6, k)


def _em_card_photo(d, k):
    rrect(d, (31, 37, 45, 59), 3, k)


def _em_card_head(d, k):
    d.ellipse([35 * k, 40 * k, 41 * k, 46 * k], fill=255)
    rrect(d, (33, 48, 43, 58), 4, k)


def _em_card_line1(d, k):
    rrect(d, (49, 39, 66, 45), 3, k)


def _em_card_line2(d, k):
    rrect(d, (49, 50, 62, 56), 3, k)


def _em_bubble_back(d, k):
    rrect(d, (24, 24, 56, 46), 7, k)
    poly(d, [(30, 46), (30, 57), (40, 46)], k)


def _em_bubble_front(d, k):
    rrect(d, (44, 48, 72, 68), 7, k)
    poly(d, [(64, 68), (69, 72), (69, 68)], k)


LAYERS = {
    "multi_jump": [(_em_multi_jump, (47, 208, 122), 255, None)],            # #2FD07A
    "spawn_hp": [(_em_spawn_hp, (255, 107, 122), 255, None),                # #FF6B7A
                 (_em_spawn_hp_hi, (255, 165, 177), 130, _em_spawn_hp)],
    "spawn_armor": [(_em_shield, (79, 166, 232), 255, None),                # #4FA6E8
                    (lambda d, k: _em_shield(d, k), (127, 208, 255), 255,   # #7FD0FF
                     _shield_left)],
    "vampire": [(_em_drop, (255, 77, 110), 255, None),                      # #FF4D6E
                (_em_drop_hi, (255, 151, 169), 140, _em_drop)],
    "nimble": [(_em_nimble, (61, 255, 158), 255, None)],                    # #3DFF9E
    "featherfall": [(_em_feather, (220, 233, 245), 255, None),
                    (_em_feather_shaft, (159, 188, 210), 255, _em_feather)],
    "healthnade": [(_em_healthnade, (86, 217, 143), 255, None),             # #56D98F
                   (_em_healthnade_dark, (63, 191, 119), 255, None),
                   (_em_cross_h, (244, 255, 248), 255, _em_healthnade),
                   (_em_cross_v, (244, 255, 248), 255, _em_healthnade)],
    "fast_sniper": [(_em_sniper, (43, 231, 231), 255, None)],               # #2BE7E7
    "revive": [(_em_cable, (79, 184, 156), 255, None),                      # #4FB89C
               (_PAD_GL, (63, 191, 160), 255, None),                        # #3FBFA0
               (_PAD_GR, (63, 191, 160), 255, None),
               (_PAD_PL, (116, 231, 200), 255, None),                       # #74E7C8
               (_PAD_PR, (116, 231, 200), 255, None)],
    "laststand": [(_em_laststand_shield, (255, 163, 78), 255, None),        # #FFA34E
                  (_em_laststand_heart, (255, 107, 122), 255, None)],       # #FF6B7A
    "parachute": [(_em_canopy, (90, 169, 232), 255, None),                  # #5AA9E8
                  (lambda d, k: _em_canopy(d, k), (143, 212, 255), 255,     # #8FD4FF
                   _canopy_left),
                  (lambda d, k: _em_canopy(d, k), (143, 212, 255), 255,
                   _canopy_mid),
                  (_em_canopy_lines, (207, 231, 255), 255, None)],
    "awp_unlock": [(_em_card, (242, 193, 78), 255, None),                   # #F2C14E
                   (_em_card_photo, (185, 138, 23), 255, None),
                   (_em_card_head, (107, 82, 16), 255, _em_card_photo),
                   (_em_card_line1, (107, 82, 16), 255, _em_card),
                   (_em_card_line2, (107, 82, 16), 255, _em_card)],
    "chat_color": [(_em_bubble_back, (91, 200, 255), 255, None),            # #5BC8FF
                   (_em_bubble_front, (255, 122, 217), 255, None)],         # #FF7AD9
}

FILE_OF = {name: "skill_%s.png" % name for name in LAYERS}
FILE_OF["star"] = "star.png"
ALL_NAMES = list(LAYERS) + ["star"]


# --------------------------------------------------------------------------
# plate + icon assembly
# --------------------------------------------------------------------------

def build_plate(img: Image.Image) -> Image.Image:
    img = stamp(img, lambda d, k: rrect(d, PLATE, 10, k), KEYLINE)
    img = stamp_grad(img, vgradient(FRAME_TOP, FRAME_BOT),
                     lambda d, k: rrect(d, FRAME, 7, k))
    img = stamp(img, lambda d, k: rrect(d, FIELD_BOX, 4, k), FIELD)
    return grain(img)


def _noise(x: int, y: int) -> int:
    """Deterministic per-pixel hash -> -2..+2 (stable across runs/platforms)."""
    h = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h % 5) - 2


def grain(img: Image.Image, box=PLATE, floor: int = 255) -> Image.Image:
    """Sub-vision +/-2 grain over the opaque plate/star body.

    Keeps the plate flat colours inside their palette tolerance while giving
    the PNG enough texture to sit in the 6-20KB band. Emblems are stamped
    after this pass, so their palette colours stay exact.
    """
    px = img.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b, a = px[x, y]
            if a < floor:
                continue
            n = _noise(x, y)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)),
                        max(0, min(255, b + n)), a)
    return img


def build_icon(name: str) -> Image.Image:
    if name == "star":
        img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        pts = star_points()
        outline = scale_about(pts, 1.10, 48.0, 51.0)
        img = stamp(img, lambda d, k: poly(d, outline, k), (126, 90, 18))
        grad = vgradient((255, 228, 134), (224, 162, 30), 11, 83)
        img = stamp_grad(img, grad, lambda d, k: poly(d, pts, k))
        img = grain(img, box=PLATE, floor=250)
        return clip_margin(img)

    img = build_plate(Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)))
    for fn, color, alpha, clip in LAYERS[name]:
        img = stamp(img, fn, color, alpha, clip)
    return clip_margin(img)


def clip_margin(img: Image.Image) -> Image.Image:
    """Guarantee the 8px outer margin is exactly transparent."""
    px = img.load()
    lo, hi = MARGIN, SIZE - MARGIN - 1          # 8 .. 87 inclusive
    for y in range(SIZE):
        for x in range(SIZE):
            if x < lo or x > hi or y < lo or y > hi:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    return img


# --------------------------------------------------------------------------
# encode (size band 6-20KB) + verify
# --------------------------------------------------------------------------

def encode(img: Image.Image, level: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=level)
    return buf.getvalue()


def encode_in_band(img: Image.Image):
    sizes = {lv: len(encode(img, lv)) for lv in range(10)}
    ok = [lv for lv, s in sizes.items() if MIN_B <= s <= MAX_B]
    if ok:
        lv = max(ok)                              # best compression in band
        return encode(img, lv), lv, sizes, None
    lv = min(sizes, key=lambda l: abs(sizes[l] - (MIN_B + MAX_B) // 2))
    return encode(img, lv), lv, sizes, "out-of-band"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def downscale_metrics(path: str):
    im = Image.open(path).convert("RGBA")
    out = {}
    for s in (36, 18):
        r = im.resize((s, s), Image.LANCZOS)
        a = r.getchannel("A").load()
        rgb = r.convert("RGB").load()
        covered = 0
        ink = 0
        lo, hi = 999.0, -1.0
        for y in range(s):
            for x in range(s):
                if a[x, y] < 40:
                    continue
                covered += 1
                c = rgb[x, y]
                if max(abs(c[i] - FIELD[i]) for i in range(3)) > 30:
                    ink += 1
                lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
                lo = min(lo, lum)
                hi = max(hi, lum)
        out[s] = {
            "cover": covered / float(s * s),
            "ink": ink,
            "contrast": hi - lo,
            "sha": sha(r.tobytes())[:16],
        }
    return out


def verify(files):
    fails = []
    seen = {96: {}, 36: {}, 18: {}}
    print("%-24s %7s %-6s %-16s %s" % ("file", "bytes", "level", "sha256[:16]", "mode"))
    for name in ALL_NAMES:
        path = files[name]
        raw = open(path, "rb").read()
        im = Image.open(path)
        im.load()
        mode, size = im.mode, im.size
        lvl = next((lv for lv in range(10) if encode(im, lv) == raw), None)
        if lvl is None:
            fails.append("%s: bytes are not what this encoder produces" % name)
            lvl = "-"
        if not (MIN_B <= len(raw) <= MAX_B):
            fails.append("%s size %d not in %d-%d" % (name, len(raw), MIN_B, MAX_B))
        if mode != "RGBA" or size != (SIZE, SIZE):
            fails.append("%s is %s %s, want RGBA %dx%d" % (name, mode, size, SIZE, SIZE))

        a = im.convert("RGBA").load()
        if a[0, 0][3] != 0 or a[SIZE - 1, SIZE - 1][3] != 0 or a[4, 48][3] != 0:
            fails.append("%s: outer margin is not transparent" % name)
        if name != "star" and (a[48, 48][3] != 255 or a[14, 14][3] != 255):
            fails.append("%s: plate interior is not opaque" % name)
        if name == "star" and a[48, 51][3] != 255:
            fails.append("star: star body is not opaque")

        for s, h in ((96, sha(raw)[:16]),):
            if h in seen[96]:
                fails.append("%s duplicates %s" % (name, seen[96][h]))
            seen[96][h] = name
        print("%-24s %7d %-6s %-16s %s/%s" % (name, len(raw), lvl,
                                               sha(raw)[:16], mode,
                                               "%dx%d" % size))

        m = downscale_metrics(path)
        for s in (36, 18):
            h = m[s]["sha"]
            if h in seen[s]:
                fails.append("%s @%dpx duplicates %s" % (name, s, seen[s][h]))
            seen[s][h] = name
            if m[s]["ink"] < (14 if s == 18 else 40):
                fails.append("%s @%dpx emblem too weak (ink=%d)"
                             % (name, s, m[s]["ink"]))
            if m[s]["contrast"] < 45:
                fails.append("%s @%dpx contrast too low (%.1f)"
                             % (name, s, m[s]["contrast"]))
        print("    36px cover=%.2f ink=%-4d contrast=%-5.1f %s"
              % (m[36]["cover"], m[36]["ink"], m[36]["contrast"], m[36]["sha"]))
        print("    18px cover=%.2f ink=%-4d contrast=%-5.1f %s"
              % (m[18]["cover"], m[18]["ink"], m[18]["contrast"], m[18]["sha"]))

    if len(seen[96]) != len(ALL_NAMES):
        fails.append("only %d distinct hashes for %d files"
                     % (len(seen[96]), len(ALL_NAMES)))
    print("")
    for f in fails:
        print("FAIL " + f)
    print("OK   %d icons, all 96x96 RGBA, all hashes distinct, all in %d-%d bytes"
          % (len(ALL_NAMES), MIN_B, MAX_B) if not fails
          else "CHECK FINISHED WITH %d FAILURE(S)" % len(fails))
    return fails


def main(argv):
    check_only = "--check" in argv
    files = {n: os.path.join(OUT_DIR, FILE_OF[n]) for n in ALL_NAMES}

    missing = [n for n, p in files.items() if not os.path.exists(p)]
    if not check_only:
        for name in ALL_NAMES:
            img = build_icon(name)
            data, level, sizes, warn = encode_in_band(img)
            with open(files[name], "wb") as fh:
                fh.write(data)
            if warn:
                print("WARN %s compress_level=%d -> %d bytes (%s)"
                      % (name, level, len(data), warn))
    elif missing:
        print("missing: " + ", ".join(missing))
        return 1

    fails = verify(files)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
