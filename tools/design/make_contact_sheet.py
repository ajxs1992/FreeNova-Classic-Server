#!/usr/bin/env python3
"""Render one contact sheet of every unique reference screenshot.

    python3 tools/design/make_contact_sheet.py

Writes docs/design/renders/contact-sheet.png. Standard library + Pillow only.
The references are only ever read.
"""

from __future__ import annotations

import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GALLERY = os.path.join(ROOT, "docs", "design", "gallery")
REF_DIR = os.path.join(ROOT, "docs", "design", "refs", "winterfest")
OUT = os.path.join(ROOT, "docs", "design", "renders", "contact-sheet.png")

COLS = 4
CELL_W = 620
SHOT_W = 584
SHOT_H = 328
LABEL_H = 54
MARGIN = 28
GAP = 18
HEADER_H = 96

BG = (11, 16, 48)
CARD = (13, 20, 48)
BORDER = (42, 61, 110)
TEXT = (238, 242, 255)
MUTED = (159, 176, 208)
GOLD = (245, 196, 81)
GREEN = (63, 191, 111)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def main() -> None:
    with open(os.path.join(GALLERY, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    refs = [r for r in manifest["refs"] if not r["duplicate_of"]]
    refs.sort(key=lambda r: r["id"])

    rows = (len(refs) + COLS - 1) // COLS
    width = MARGIN * 2 + COLS * CELL_W + (COLS - 1) * GAP
    height = HEADER_H + rows * (SHOT_H + LABEL_H) + (rows - 1) * GAP + MARGIN
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, 26), "Winterfest panel \u2014 reference contact sheet", font=font(34), fill=TEXT)
    draw.text(
        (MARGIN, 66),
        f"{len(refs)} unique references  \u00b7  {manifest['counts']['elements']} inventoried elements  "
        f"\u00b7  {manifest['counts']['new_pages']} new routes  \u00b7  "
        f"02-profile-v2.png is a byte-identical duplicate and is left out",
        font=font(15),
        fill=MUTED,
    )

    for i, ref in enumerate(refs):
        col, row = i % COLS, i // COLS
        x = MARGIN + col * (CELL_W + GAP)
        y = HEADER_H + row * (SHOT_H + LABEL_H + GAP)
        draw.rounded_rectangle(
            [x, y, x + CELL_W, y + SHOT_H + LABEL_H],
            radius=14, fill=CARD, outline=BORDER, width=1,
        )
        with Image.open(os.path.join(REF_DIR, os.path.basename(ref["image"]))) as im:
            im = im.convert("RGB")
            thumb = im.copy()
            thumb.thumbnail((SHOT_W, SHOT_H), Image.LANCZOS)
            px = x + (CELL_W - thumb.width) // 2
            py = y + 6 + (SHOT_H - thumb.height) // 2
            sheet.paste(thumb, (px, py))

        label_y = y + SHOT_H + 8
        draw.text((x + 14, label_y), f"{ref['id'].split('-')[0]}  {ref['title']}",
                  font=font(17), fill=TEXT)
        status = ref["status"]
        colour = GREEN if status == "exists" else GOLD
        draw.text((x + 14, label_y + 24),
                  f"{ref['route']}   \u00b7   {ref['width']}\u00d7{ref['height']}   \u00b7   "
                  f"{ref['bytes'] / 1048576:.2f} MB",
                  font=font(13), fill=MUTED)
        pill = draw.textbbox((0, 0), status, font=font(12))
        pw = pill[2] - pill[0] + 18
        draw.rounded_rectangle(
            [x + CELL_W - pw - 12, label_y + 2, x + CELL_W - 12, label_y + 22],
            radius=10, outline=colour, width=1,
        )
        draw.text((x + CELL_W - pw - 3, label_y + 5), status, font=font(12), fill=colour)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, "PNG", optimize=True)
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({width}x{height}, {os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
