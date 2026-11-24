#!/usr/bin/env python3
"""Map a plate: sheet cells, strips, bars, and the fields a page may print in.

The progress plates (05, 06, 07) are painted, not laid out, so every rectangle a
page prints into has to be READ off the picture and then LOOKED AT. This script
is the second layer of `prog_measure.py`: it takes a short map file (a list of
probes, one line each), and for every probe it

  * finds the cell / card / button / strip the probe sits in, by walking the
    plate's brightness profile out from the probe until the profile turns —
    which is where that rectangle's border is;
  * reports the rectangle, the flat paint in its middle (what the page wipes it
    with) and whether the paint is actually flat (a high deviation means the
    probe landed on art or on a sample glyph);
  * draws every rectangle it found onto the plate, numbered, as a PNG.

The PNG is the deliverable: it is what a person checks before any number here
becomes a constant in a page. A rectangle nobody looked at is not evidence.

The map file format (one probe per line, '#' starts a comment):

    name  x,y        a point inside the rectangle of interest
    name  x0,y0,x1,y1  an explicit box instead (used for fields, not cells)

    python3 tools/design/plate_map.py 05 tools/design/maps/05.map --draw /tmp/m05.png
    python3 tools/design/plate_map.py 06 tools/design/maps/06.map --json /tmp/m06.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(ROOT, "docs", "design", "refs", "winterfest")
PLATES = {"05": "05-battlepass.png", "06": "06-missions.png", "07": "07-achievements.png"}

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
except OSError:  # pragma: no cover - a box without a font still shows the rectangle
    FONT = ImageFont.load_default()


def load(key: str) -> np.ndarray:
    return np.asarray(Image.open(os.path.join(REF, PLATES[key])).convert("RGB"), dtype=np.float32)


def lum(a: np.ndarray) -> np.ndarray:
    return a.mean(axis=2)


def row_edges(a: np.ndarray, y: int, thresh: float, x0: int = 0, x1: int | None = None) -> list[int]:
    """Edges on one scanline of a painted plate: a depth-N run of dark, or fast ink.

    Depth is the half-length, so N = 2 is a 3 px run. On the plates a cell's
    border and a cell's sample art are BOTH bright after compositing, so no
    brightness test can separate them; what does is the trace each one leaves
    along the middle of a row — the border touches the scanline as a thin dashes
    of near-background or a streak of fast ink, the art and the sample text
    touch it as a wide bright mass. So an edge is a DARK run of exactly 1-3 px
    or a run whose derivative is far above the row's own spread. The result is a
    DRAFT to check on the PNG: nothing here knows what the rectangle is.
    """
    hi = lum(a)
    x1 = len(hi[0]) if x1 is None else x1
    prof = hi[max(0, y - 1):y + 2, x0:x1].mean(axis=0)
    base = float(np.percentile(prof, 75))
    spread = float(np.percentile(prof, 90) - np.percentile(prof, 10))
    edges = []
    for i in range(3, len(prof) - 3):
        # depth 2: a dark pixel with a dark neighbour, still under the fill
        if prof[i] <= base - max(14.0, spread * 0.45) and prof[i] <= prof[i - 1] and prof[i] <= prof[i + 1]:
            edges.append(x0 + i)
            continue
        # fast ink: a sharp rise or fall
        d = abs(float(prof[i + 1]) - float(prof[i - 1]))
        if d >= max(26.0, spread * 0.75):
            edges.append(x0 + i)
    return merge_near(edges, 3)


def merge_near(idx: list[int], gap: int) -> list[int]:
    out: list[int] = []
    for i in idx:
        if out and i - out[-1] <= gap:
            out[-1] = (out[-1] + i) // 2
        else:
            out.append(i)
    return out


def walk_out(a: np.ndarray, x: int, y: int, axis: str, limit: int, step: float = 34.0) -> int:
    """Walk from a probe towards `limit` until the plate's line JUMP is crossed.

    A hand-painted plate's structure is its LINES: the light rim of a card, the
    snow cap, the frame of a cell. They are 30-120 levels brighter than the paint
    around them, while the paint itself, its gradients and its snow are a few
    levels. So an edge is the first pixel more than `step` above the probe's own
    paint — which is the answer to "where is the line", and the reason this tool
    reports RECTANGLES (inside the lines) and not fields: a field is a page's
    decision about what to print, and it is checked on the PNG, not here.
    """
    hi = lum(a)
    if axis == "x":
        prof = hi[max(0, y - 2):y + 3, :].mean(axis=0)
        start = x
    else:
        prof = hi[:, max(0, x - 2):x + 3].mean(axis=1)
        start = y
    n = len(prof)
    ref = float(np.median(prof[max(0, start - 3):start + 4]))
    direction = 1 if limit > start else -1
    i = start + direction
    while i != limit + direction:
        if prof[i] >= ref + step:
            return i - direction
        i += direction
    return limit


def rect_from(a: np.ndarray, x: int, y: int) -> dict:
    """The rectangle a probe sits inside, by walking to the lines on each side."""
    x0 = walk_out(a, x, y, "x", 0)
    x1 = walk_out(a, x, y, "x", a.shape[1] - 1)
    y0 = walk_out(a, x, y, "y", 0)
    y1 = walk_out(a, x, y, "y", a.shape[0] - 1)
    return {"x": int(x0), "y": int(y0), "w": int(x1 - x0 + 1), "h": int(y1 - y0 + 1)}


def paint(a: np.ndarray, box: dict) -> dict:
    """The paint in the middle of a box, and how flat it is."""
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    mx, my = max(2, w // 8), max(2, h // 4)
    mid = a[y + my:y + h - my, x + mx:x + w - mx]
    if mid.size == 0:
        mid = a[max(0, y):max(1, y + h), max(0, x):max(1, x + w)]
    px = mid.reshape(-1, 3)
    return {
        "med": [int(v) for v in np.median(px, axis=0)],
        "mean": [int(v) for v in px.mean(axis=0)],
        "dev": round(float(px.std(axis=0).max()), 1)
    }


def read_map(path: str) -> list[tuple[str, str]]:
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            out.append((parts[0], parts[1]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plate", choices=sorted(PLATES))
    ap.add_argument("map")
    ap.add_argument("--draw", help="where to write the annotated PNG")
    ap.add_argument("--json", help="where to write the rectangles as JSON")
    ap.add_argument("--step", type=float, default=9.0, help="the brightness jump that is a border")
    args = ap.parse_args()
    a = load(args.plate)
    im = Image.fromarray(a.astype(np.uint8)).copy()
    d = ImageDraw.Draw(im)
    result = {}
    print(f"{'name':<16} {'x':>5} {'y':>5} {'w':>5} {'h':>5}  fill            dev")
    for name, spec in read_map(args.map):
        nums = [int(v) for v in spec.split(",")]
        if len(nums) == 4:
            box = {"x": nums[0], "y": nums[1], "w": nums[2] - nums[0], "h": nums[3] - nums[1]}
        else:
            box = rect_from(a, nums[0], nums[1])
        fill = paint(a, box)
        result[name] = {"box": box, "fill": fill["med"], "dev": fill["dev"]}
        print(f"{name:<16} {box['x']:5d} {box['y']:5d} {box['w']:5d} {box['h']:5d}  "
              f"{str(fill['med']):<15} {fill['dev']:.1f}")
        d.rectangle([box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]],
                    outline=(255, 0, 255), width=2)
        d.text((box["x"] + 3, max(0, box["y"] - 13)), name, fill=(0, 255, 255), font=FONT)
    if args.draw:
        im.save(args.draw)
        print("wrote " + args.draw)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1)
        print("wrote " + args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
