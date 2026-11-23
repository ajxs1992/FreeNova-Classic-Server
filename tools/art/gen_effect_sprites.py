#!/usr/bin/env python3
"""tools/art/gen_effect_sprites.py - draw the Winterfest kill/death/spawn effect sprites.

Everything here is *generated*: no clip art, no downloaded pack, no licence to
name. The output is committed twice, on purpose:

    thirdparty/winterfest-assets/effects-src/*.png   the RGBA frame strips (source)
    game-server/cstrike/sprites/winterfest/*.spr     what a client downloads

so a released sprite is reproducible from this file alone, in this repo, with no
network. `tools/art/mksprite.py` turns the PNGs into the .spr (and documents the
container format it verified against retail sprites).

Design rules the drawing follows (docs/WINTERFEST-COSMETICS.md §10):

* 64x64 for the burst effects, 96x96 for the ones a player is meant to read from
  their own feet (a death imprint, a spawn ring). The owner's panel is 780 px
  wide and older clients run 640x480, so the shape has to be legible small: one
  big silhouette, a bright core, no thin detail.
* 4x supersampled, then downscaled: the edges stay soft in an 8-bit indexed
  sprite (255 colours, index 255 transparent) instead of going jaggy.
* every frame keeps the same silhouette family - these play for half a second at
  range, and a shape that changes completely reads as a flicker.

Usage
-----
    python3 tools/art/gen_effect_sprites.py            # PNG strips + .spr
    python3 tools/art/gen_effect_sprites.py --png-only  # just the source strips
    python3 tools/art/gen_effect_sprites.py --only wf_ring
    python3 tools/art/gen_effect_sprites.py --list
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover
    print("gen_effect_sprites: Pillow is required", file=sys.stderr)
    raise SystemExit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_DIR = os.path.join(ROOT, "thirdparty", "winterfest-assets", "effects-src")
SPR_DIR = os.path.join(ROOT, "game-server", "cstrike", "sprites", "winterfest")
MKSPRITE = os.path.join(ROOT, "tools", "art", "mksprite.py")

SS = 4  # supersample factor

SNOW = (236, 246, 255)
SNOW_COLD = (150, 205, 255)
ICE = (176, 226, 255)
ICE_CORE = (255, 255, 255)
BAUBLE_RED = (196, 28, 44)
BAUBLE_DARK = (120, 14, 26)
GOLD = (246, 198, 92)
BOX_RED = (176, 26, 38)
RIBBON = (250, 206, 96)
AURORA_GREEN = (128, 255, 198)
AURORA_VIOLET = (168, 138, 255)


# ---------------------------------------------------------------------------
# drawing helpers
# ---------------------------------------------------------------------------
def canvas(width, height):
    return Image.new("RGBA", (width * SS, height * SS), (0, 0, 0, 0))


def puff(radius_px, colour, power=1.6, alpha=255):
    """A soft round particle: alpha falls off from the centre, no hard edge."""
    r = max(1, int(radius_px))
    size = r * 2 + 1
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            dx = (x - r) / r
            dy = (y - r) / r
            d = math.hypot(dx, dy)
            if d >= 1.0:
                continue
            falloff = (1.0 - d) ** power
            px[x, y] = (colour[0], colour[1], colour[2], int(max(0, min(255, falloff * alpha))))
    return img


def blit(base, particle, cx, cy):
    base.alpha_composite(particle, (int(cx - particle.width / 2), int(cy - particle.height / 2)))


def glow(img, radius):
    """Blur a copy under the art so a bright core bleeds into the dark."""
    blurred = img.filter(ImageFilter.GaussianBlur(radius * SS))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(blurred)
    out.alpha_composite(img)
    return out


def ring(base, cx, cy, radius, thickness, colour, alpha=255):
    draw = ImageDraw.Draw(base)
    steps = 90
    for i in range(steps):
        a0 = 2 * math.pi * i / steps
        a1 = 2 * math.pi * (i + 1) / steps
        draw.polygon(
            [
                (cx + math.cos(a0) * (radius - thickness), cy + math.sin(a0) * (radius - thickness)),
                (cx + math.cos(a0) * (radius + thickness), cy + math.sin(a0) * (radius + thickness)),
                (cx + math.cos(a1) * (radius + thickness), cy + math.sin(a1) * (radius + thickness)),
                (cx + math.cos(a1) * (radius - thickness), cy + math.sin(a1) * (radius - thickness)),
            ],
            fill=(colour[0], colour[1], colour[2], alpha),
        )


def shard(base, cx, cy, angle, length, width, colour, alpha=255):
    draw = ImageDraw.Draw(base)
    ca, sa = math.cos(angle), math.sin(angle)
    # a sliver with the point outward and a flat base at the centre
    tipx, tipy = cx + ca * length, cy + sa * length
    bx, by = cx, cy
    perpx, perpy = -sa * width, ca * width
    draw.polygon(
        [(tipx, tipy), (bx + perpx, by + perpy), (bx - perpx, by - perpy)],
        fill=(colour[0], colour[1], colour[2], alpha),
    )


def pct(frames, index):
    return index / float(max(1, frames - 1))


def fade(alpha, t, power=1.0):
    return int(max(0, min(255, alpha * (1.0 - t) ** power)))


# ---------------------------------------------------------------------------
# the effects
# ---------------------------------------------------------------------------
def snowpuff(index, frames, size):
    """A cold 360-degree snow burst: 8 fat puffs thrown out of a white flash."""
    img = canvas(size, size)
    c = size / 2.0
    t = pct(frames, index)
    if index <= 1:
        blit(img, puff(size * 0.32 * SS, ICE_CORE, 1.2, 210 * (1.0 - index / 2.2)), c * SS, c * SS)
    count = 8
    for i in range(count):
        angle = 2 * math.pi * i / count + 0.26 * index
        radius = (3 + 12 * t) * SS * (1.0 + 0.10 * (i % 3))
        r = max(3.0, (10.2 - 2.2 * t) * SS)
        cx = c * SS + math.cos(angle) * radius
        cy = c * SS + math.sin(angle) * radius * 0.86
        colour = SNOW if i % 3 else SNOW_COLD
        blit(img, puff(r, colour, 1.35, fade(245, t, 0.7)), cx, cy)
    # a thin expanding shock of frost keeps the burst from reading as fog
    ring(img, c * SS, c * SS, (6 + 24 * t) * SS, max(0.6, (2.2 - 1.7 * t)) * SS, SNOW_COLD, fade(110, t, 1.4))
    return img


def bauble(index, frames, size):
    """A red bauble: it holds, it cracks, then it bursts into gold-edged shards."""
    img = canvas(size, size)
    c = size / 2.0
    cx = cy = c * SS
    draw = ImageDraw.Draw(img)
    t = pct(frames, index)
    boom = 4  # frame index where it lets go
    if index < boom:
        grow = 0.55 + 0.45 * (index / float(boom))
        r = 15 * SS * grow
        draw.ellipse([cx - r, cy - r * 0.96, cx + r, cy + r * 0.96], fill=BAUBLE_RED + (255,))
        draw.ellipse([cx - r * 0.62, cy - r * 0.72, cx - r * 0.10, cy - r * 0.20],
                     fill=(255, 236, 236, 210))  # highlight
        draw.ellipse([cx - r * 0.34, cy + r * 0.24, cx + r * 0.46, cy + r * 0.80],
                     fill=BAUBLE_DARK + (150,))  # shaded belly
        caph = r * 0.42
        draw.rectangle([cx - r * 0.16, cy - r - caph, cx + r * 0.16, cy - r], fill=GOLD + (255,))
        # the crack: two strokes that deepen as it goes
        if index >= 2:
            w = max(1, int(0.9 * SS))
            draw.line([(cx - r * 0.1, cy - r * 0.5), (cx + r * 0.22, cy - r * 0.1), (cx + r * 0.05, cy + r * 0.35)],
                      fill=(255, 255, 255, 220), width=w)
            draw.line([(cx + r * 0.22, cy - r * 0.1), (cx + r * 0.55, cy + r * 0.10)],
                      fill=(255, 255, 255, 190), width=w)
        if index == boom - 1:
            blit(img, puff(13 * SS, (255, 255, 255), 1.4, 170), cx, cy)
    else:
        bt = (index - boom) / float(max(1, frames - boom - 1))
        for i in range(9):
            angle = 2 * math.pi * i / 9 + 0.14
            dist = (5 + 22 * bt) * SS * (1.0 + 0.12 * (i % 2))
            sx = cx + math.cos(angle) * dist
            sy = cy + math.sin(angle) * dist * 0.92
            colour = GOLD if i % 3 == 0 else BAUBLE_RED
            shard(img, sx, sy, angle + 0.9 * bt, (12.0 - 4.0 * bt) * SS, max(1.2, (3.6 - 1.8 * bt) * SS),
                  colour, fade(245, bt, 0.45))
        blit(img, puff((9 + 12 * bt) * SS, (255, 245, 225), 1.7, fade(190, bt, 1.2)), cx, cy)
        ring(img, cx, cy, (6 + 26 * bt) * SS, max(0.6, 2.0 * SS * (1 - bt)), GOLD, fade(90, bt, 1.2))
    return img


def gift(index, frames, size):
    """A parcel that shrinks, then pops: ribbon curl, gold star, sparkle."""
    img = canvas(size, size)
    c = size / 2.0
    cx = cy = c * SS
    draw = ImageDraw.Draw(img)
    t = pct(frames, index)
    squeeze = 3  # last frame drawn as a box
    if index <= squeeze:
        k = 1.0 - 0.45 * (index / float(squeeze + 1))     # pulls inward
        w = 24 * SS * k
        h = 20 * SS * k
        draw.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], fill=BOX_RED + (255,))
        draw.rectangle([cx - w * 0.10, cy - h / 2, cx + w * 0.10, cy + h / 2], fill=RIBBON + (255,))
        draw.rectangle([cx - w / 2, cy - h * 0.12, cx + w / 2, cy + h * 0.12], fill=RIBBON + (255,))
        bow = 4.6 * SS * k
        draw.ellipse([cx - bow * 2.0, cy - h / 2 - bow, cx - bow * 0.1, cy - h / 2 + bow * 0.4], fill=RIBBON + (245,))
        draw.ellipse([cx + bow * 0.1, cy - h / 2 - bow, cx + bow * 2.0, cy - h / 2 + bow * 0.4], fill=RIBBON + (245,))
        if index == squeeze:
            blit(img, puff(15 * SS, (255, 255, 255), 1.5, 170), cx, cy)
    else:
        bt = (index - squeeze - 1) / float(max(1, frames - squeeze - 2))
        # the star: eight long points, and they hold their shape as it fades
        for i in range(8):
            angle = 2 * math.pi * i / 8 + 0.2
            shard(img, cx, cy, angle, (10 + 22 * bt) * SS, max(1.1, (3.4 - 1.9 * bt)) * SS, GOLD,
                  fade(250, bt, 0.4))
        for i in range(8):
            angle = 2 * math.pi * i / 8 + 0.6
            dist = (7 + 18 * bt) * SS
            blit(img, puff(max(1.5, (4.6 - 2.2 * bt) * SS), SNOW, 1.4, fade(235, bt, 0.7)),
                 cx + math.cos(angle) * dist, cy + math.sin(angle) * dist * 0.9)
        blit(img, puff((10 + 14 * bt) * SS, (255, 250, 232), 1.6, fade(200, bt, 1.0)), cx, cy)
        ring(img, cx, cy, (8 + 28 * bt) * SS, max(0.6, 2.2 * SS * (1 - bt)), GOLD, fade(100, bt, 1.2))
    return img


def snowangel(index, frames, size):
    """The imprint the dying player leaves: wings swept out of the snow."""
    img = canvas(size, size)
    c = size / 2.0
    cx = cy = c * SS
    draw = ImageDraw.Draw(img)
    t = pct(frames, index)
    grow = 0.45 + 0.55 * t
    alpha = fade(235, t, 0.8)
    span = 40 * SS * grow
    # two wings, raised at the tips, and a body between them
    for direction in (-1, 1):
        pts = []
        for i in range(24):
            u = i / 23.0
            x = cx + direction * span * u
            y = cy + (6 * SS * grow) * u - (14 * SS * grow) * (u ** 1.7)
            pts.append((x, y - 5 * SS * grow * (1 - u)))
        for i in range(23, -1, -1):
            u = i / 23.0
            x = cx + direction * span * u
            y = cy + (6 * SS * grow) * u - (14 * SS * grow) * (u ** 1.7)
            pts.append((x, y + 5 * SS * grow * (1 - u) + 3 * SS * grow))
        draw.polygon(pts, fill=SNOW + (alpha,))
    body_h = 16 * SS * grow
    draw.ellipse([cx - 4.6 * SS * grow, cy - body_h * 0.55, cx + 4.6 * SS * grow, cy + body_h * 0.75],
                 fill=SNOW + (alpha,))
    draw.ellipse([cx - 3.4 * SS * grow, cy - body_h * 0.92, cx + 3.4 * SS * grow, cy - body_h * 0.40],
                 fill=SNOW + (alpha,))
    blit(img, puff(9 * SS * (1.0 - 0.5 * t), SNOW_COLD, 1.6, fade(120, t, 1.4)), cx, cy)
    return img


def ring_aurora(index, frames, size):
    """A spawn ring: green inside, violet outside, opening out and thinning."""
    img = canvas(size, size)
    c = size / 2.0
    cx = cy = c * SS
    t = pct(frames, index)
    radius = (14 + 30 * t) * SS
    thick = max(0.7, (2.4 - 1.8 * t)) * SS
    alpha = fade(240, t, 0.9)
    ring(img, cx, cy, radius, thick, AURORA_VIOLET, alpha)
    ring(img, cx, cy, radius * 0.86, thick * 1.15, AURORA_GREEN, int(alpha * 0.85))
    blit(img, puff((12 - 6 * t) * SS, (225, 255, 245), 1.7, fade(150, t, 1.5)), cx, cy)
    return img


def iceshard(index, frames, size):
    """Ice: shards stabbing up out of the corpse under a white flare."""
    img = canvas(size, size)
    c = size / 2.0
    cx = cy = c * SS
    t = pct(frames, index)
    if index <= 1:
        blit(img, puff((10 + 4 * index) * SS, ICE_CORE, 1.3, 210 - 40 * index), cx, cy)
    for i in range(7):
        angle = -math.pi / 2 + (i - 3) * 0.34
        length = (8 + 26 * t) * SS * (1.0 - 0.10 * abs(i - 3))
        width = max(1.1, (3.4 - 1.9 * t)) * SS
        shard(img, cx + (i - 3) * 2.2 * SS, cy + 6 * SS, angle, length, width, ICE, fade(245, t, 0.55))
        shard(img, cx + (i - 3) * 2.2 * SS, cy + 6 * SS, angle, length * 0.72, width * 0.5, ICE_CORE,
              fade(230, t, 0.55))
    ring(img, cx, cy + 4 * SS, (5 + 22 * t) * SS, max(0.6, 1.9 * SS * (1 - t)), SNOW_COLD, fade(120, t, 1.3))
    return img


EFFECTS = [
    # name, size, frames, drawer, one line for the doc
    ("wf_snowpuff", 64, 6, snowpuff, "cold snow burst: twelve puffs thrown out of a white flash"),
    ("wf_bauble", 64, 8, bauble, "a red bauble holds, cracks, then bursts into gold-edged shards"),
    ("wf_gift", 64, 7, gift, "a parcel squeezes shut and pops into a gold eight-point star"),
    ("wf_snowangel", 96, 6, snowangel, "wing and body imprint spreading in the snow where you fell"),
    ("wf_ring", 96, 5, ring_aurora, "green-inside/violet-outside ring opening at your feet"),
    ("wf_iceshard", 64, 6, iceshard, "seven ice shards stab up out of the ground under a white flare"),
]


def build_strip(size, frames, drawer):
    strip = Image.new("RGBA", (size * frames, size), (0, 0, 0, 0))
    for i in range(frames):
        big = drawer(i, frames, size)
        big = glow(big, 0.6)
        small = big.resize((size, size), Image.LANCZOS)
        strip.paste(small, (i * size, 0))
    return strip


def main(argv=None):
    ap = argparse.ArgumentParser(description="Draw and optionally pack the Winterfest effect sprites.")
    ap.add_argument("--only", nargs="*", default=[], help="effect names (default: all)")
    ap.add_argument("--png-only", action="store_true", help="write the source strips, skip the .spr")
    ap.add_argument("--spr-only", action="store_true", help="pack from the existing strips, skip drawing")
    ap.add_argument("--list", action="store_true", help="print the effect table and exit")
    args = ap.parse_args(argv)

    if args.list:
        for name, size, frames, _, note in EFFECTS:
            print(f"{name:14s} {size}x{size} {frames} frame(s)  {note}")
        return 0

    os.makedirs(SRC_DIR, exist_ok=True)
    os.makedirs(SPR_DIR, exist_ok=True)
    wanted = [e for e in EFFECTS if not args.only or e[0] in args.only]
    if not wanted:
        print(f"gen_effect_sprites: nothing matched {args.only}", file=sys.stderr)
        return 2

    for name, size, frames, drawer, _ in wanted:
        sheet = os.path.join(SRC_DIR, name + "-sheet.png")
        spr = os.path.join(SPR_DIR, name + ".spr")
        if not args.spr_only:
            strip = build_strip(size, frames, drawer)
            strip.save(sheet, optimize=True)
            print(f"{name}: {size}x{size} x{frames} -> {os.path.relpath(sheet, ROOT)} "
                  f"({os.path.getsize(sheet)} B)")
        if args.png_only:
            continue
        if not os.path.exists(sheet):
            print(f"gen_effect_sprites: {sheet} is missing (run without --spr-only)", file=sys.stderr)
            return 2
        subprocess.run(
            [sys.executable, MKSPRITE, spr, "--strip", sheet, "--frames", str(frames), "--quiet"],
            check=True,
        )
        print(f"{name}: packed {os.path.relpath(spr, ROOT)} ({os.path.getsize(spr)} B)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
