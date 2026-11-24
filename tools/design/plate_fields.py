#!/usr/bin/env python3
"""Where a page may print on a plate, and which plate sample each field cleans.

A Winterfest plate is a painting. It has no DOM, no CSS box and no layout tree,
so a page cannot ask the picture where its cards are — it has to read them off
and then LOOK at what it read. Two tools do that, in that order:

`plate_map.py`     the rectangles: a probe point per rectangle, walked out to its
                   border; the paint in the middle (what the page wipes it with);
                   the result drawn on the plate, numbered, as a PNG.
`plate_census.py`  (test_plate_census.mjs) the samples: an OCR pass over the same
                   picture giving every glyph box the plate's own design prints.

and this script is the join: for a map file it reports, per rectangle, which
sample glyph boxes sit inside it (so the page knows it is covering a sample and
must print its own value there), which sit outside it (so the page must not
cover them by accident), and how flat the paint is (so a field is only placed on
paint that is actually one colour).

    python3 tools/design/plate_fields.py 05 tools/design/maps/05.map --draw /tmp/f05.png
    python3 tools/design/plate_fields.py 07 tools/design/maps/07.map --json /tmp/f07.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import plate_map as pm  # noqa: E402  (the walk + paint functions, one implementation)

ROOT = pm.ROOT
REF = pm.REF
PLATES = pm.PLATES

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
except OSError:  # pragma: no cover
    FONT = ImageFont.load_default()


def ocr_boxes(plate: str) -> list[dict]:
    """The plate's sample glyph boxes, from test_plate_census.mjs's own OCR pass.

    The census writes them to a JSON file; running node is the only way to get
    them without a second OCR implementation, and a second implementation would
    be a second truth. If node or tesseract is missing this returns [] and the
    report says so — the rectangles are still measured, only the sample/field
    join is skipped.
    """
    import subprocess
    out = os.path.join("/tmp", f"plate-census-{plate}.json")
    script = f"""
import {{ OCR_BOXES_FOR }} from {json.dumps(os.path.join(ROOT, "web-panel", "test_plate_census.mjs"))}
const boxes = await OCR_BOXES_FOR({json.dumps(plate)})
process.stdout.write(JSON.stringify(boxes || []))
"""
    try:
        res = subprocess.run(["node", "--input-type=module", "-e", script],
                             capture_output=True, text=True, timeout=180)
        if res.returncode != 0:
            print(f"  (ocr unavailable for {plate}: {res.stderr.strip().splitlines()[-1:]})")
            return []
        data = json.loads(res.stdout or "[]")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1)
        return data
    except Exception as exc:  # pragma: no cover - environment, not logic
        print(f"  (ocr unavailable for {plate}: {exc})")
        return []


def hits(box: dict, words: list[dict]) -> list[dict]:
    x0, y0 = box["x"], box["y"]
    x1, y1 = x0 + box["w"], y0 + box["h"]
    out = []
    for w in words:
        cx, cy = w["x"] + w["w"] / 2, w["y"] + w["h"] / 2
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            out.append(w)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plate", choices=sorted(PLATES))
    ap.add_argument("map")
    ap.add_argument("--draw")
    ap.add_argument("--json")
    args = ap.parse_args()
    a = pm.load(args.plate)
    words = ocr_boxes(args.plate)
    im = Image.fromarray(a.astype(np.uint8)).copy()
    d = ImageDraw.Draw(im)
    rows = []
    print(f"{'name':<14} {'box':<26} {'fill':<16} {'dev':>5}  samples inside")
    for name, spec in pm.read_map(args.map):
        nums = [int(v) for v in spec.split(",")]
        box = ({"x": nums[0], "y": nums[1], "w": nums[2] - nums[0], "h": nums[3] - nums[1]}
               if len(nums) == 4 else pm.rect_from(a, nums[0], nums[1]))
        fill = pm.paint(a, box)
        inside = hits(box, words)
        rows.append({"name": name, "box": box, "fill": fill["med"], "dev": fill["dev"],
                     "samples": [w["text"] for w in inside]})
        print(f"{name:<14} {str(box):<26} {str(fill['med']):<16} {fill['dev']:5.1f}  "
              + ", ".join(inside and [w['text'] for w in inside] or []))
        d.rectangle([box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]],
                    outline=(255, 0, 255), width=2)
        d.text((box["x"] + 3, max(0, box["y"] - 13)), name, fill=(0, 255, 255), font=FONT)
    for w in words:
        d.rectangle([w["x"], w["y"], w["x"] + w["w"], w["y"] + w["h"]], outline=(255, 255, 0))
    if args.draw:
        im.save(args.draw)
        print("wrote " + args.draw)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1)
        print("wrote " + args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
