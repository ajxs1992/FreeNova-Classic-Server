#!/usr/bin/env python3
"""Build the design gallery manifest and the specification matrix.

Inputs (all in this repository):
  docs/design/refs/winterfest/*.png      read-only reference screenshots
  tools/design/reference_notes.json      hand-read page identity + inventory
  tools/design/refmeasure.py             the geometry/palette measurement code

Outputs (both generated - never edit them by hand):
  docs/design/gallery/manifest.json      machine-readable spec for the gallery
  docs/design/gallery/manifest.js        the same data as a <script> for file://
  docs/design/SPEC-MATRIX.md             the human-readable matrix

The script is idempotent: running it twice on unchanged inputs produces the
same files apart from the ``generated_at`` stamp.  Run from anywhere:

    python3 tools/design/build_gallery.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refmeasure  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF_DIR = os.path.join(ROOT, "docs", "design", "refs", "winterfest")
GALLERY_DIR = os.path.join(ROOT, "docs", "design", "gallery")
NOTES = os.path.join(ROOT, "tools", "design", "reference_notes.json")
MATRIX = os.path.join(ROOT, "docs", "design", "SPEC-MATRIX.md")


# --------------------------------------------------------------------------
# inputs
# --------------------------------------------------------------------------

def load_notes() -> dict:
    with open(NOTES, encoding="utf-8") as fh:
        return json.load(fh)


def image_path(ref_file: str) -> str:
    return os.path.join(REF_DIR, ref_file)


def relative_image(ref_file: str) -> str:
    """Path as the gallery site needs it: relative, so file:// works."""
    return "../refs/winterfest/" + ref_file


def inventory_count(notes: dict, ref: dict) -> int:
    """How many on-screen things the page's inventory names."""
    n = 0
    for section in ref.get("sections", []):
        n += len(section.get("items", [])) + len(section.get("buttons", []))
        for table in section.get("tables", []):
            n += len(table.get("columns", []))
    n += len(ref.get("hero", {}).get("items", []))
    for extra in ref.get("hero", {}).get("lines", []):
        n += 1
    if ref.get("inherits_shell"):
        shell = notes.get("shell", {})
        n += sum(len(v) for v in shell.get("top_bar", {}).get("currency_pills", []))
        n += len(shell.get("top_bar", {}).get("icons", []))
        n += len(shell.get("top_bar", {}).get("profile_chip", []))
        for group in shell.get("sidebar", {}).get("groups", {}).values():
            n += len(group)
    return n


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build() -> tuple[dict, list[str]]:
    notes = load_notes()
    warnings: list[str] = []
    refs: list[dict] = []
    by_hash: dict[str, str] = {}
    listed = {ref["file"] for ref in notes["refs"]}

    # Every PNG in the reference directory belongs in the manifest, even if no
    # one read it: a file that is a byte-for-byte duplicate still has to be
    # flagged rather than silently dropped.
    extra_files = sorted(
        name for name in os.listdir(REF_DIR)
        if name.lower().endswith(".png") and name not in listed
    )

    for ref in notes["refs"]:
        path = image_path(ref["file"])
        if not os.path.exists(path):
            raise SystemExit(f"missing reference image: {path}")
        measured = refmeasure.measure(path, ref.get("probes"))
        digest = measured["sha256"]
        duplicate_of = by_hash.get(digest)
        if duplicate_of is None:
            by_hash[digest] = ref["id"]
        else:
            warnings.append(f"{ref['id']} is byte-identical to {duplicate_of}")

        entry = {
            "id": ref["id"],
            "title": ref["title"],
            "route": ref["route"][0],
            "routes": ref["route"],
            "status": ref["status"],
            "replaces": ref.get("replaces"),
            "active_nav": ref.get("active_nav"),
            "image": relative_image(ref["file"]),
            "thumb": "thumbs/" + ref["id"] + ".jpg",
            "width": measured["width"],
            "height": measured["height"],
            "bytes": measured["bytes"],
            "sha256": digest,
            "duplicate_of": duplicate_of,
            "summary": ref.get("summary", ""),
            "probes": ref.get("probes", {}),
            "geometry": measured["geometry"],
            "palette": measured["palette"],
            "palette_bands": measured["palette_bands"],
            "palette_hero_sampled": measured["palette_hero_sampled"],
            "palette_note": measured["palette_note"],
            "shell": {
                "inherits": bool(ref.get("inherits_shell")),
                "exceptions": ref.get("shell_exceptions", []),
            },
            "hero_inventory": ref.get("hero", {}),
            "hero_doc": ref.get("hero_doc"),
            "sections": ref.get("sections", []),
            "data_fields": [
                {"element": element, "source": source}
                for element, source in ref.get("data_fields", [])
            ],
            "blockers": ref.get("blockers", []),
            "ambiguous": ref.get("ambiguous", []),
            "source_doc": ref.get("source_doc"),
            "element_count": inventory_count(notes, ref),
        }
        refs.append(entry)

    for name in extra_files:
        path = image_path(name)
        measured = refmeasure.measure(path)
        digest = measured["sha256"]
        duplicate_of = by_hash.get(digest)
        ref_id = os.path.splitext(name)[0]
        if duplicate_of:
            warnings.append(f"{ref_id} is byte-identical to {duplicate_of}")
        else:
            by_hash[digest] = ref_id
            warnings.append(f"{ref_id} was not read by hand: it has measurements but no inventory")
        refs.append({
            "id": ref_id,
            "title": "Profile (duplicate copy)" if duplicate_of else ref_id,
            "route": "/profile",
            "routes": ["/profile"],
            "status": "exists",
            "replaces": None,
            "active_nav": "Profile",
            "image": relative_image(name),
            "thumb": "thumbs/" + ref_id + ".jpg",
            "width": measured["width"],
            "height": measured["height"],
            "bytes": measured["bytes"],
            "sha256": digest,
            "duplicate_of": duplicate_of,
            "summary": (
                "Byte-identical duplicate of 02-profile.png. Kept on disk and flagged; not a page of its own."
                if duplicate_of else "Not read by hand; measurements only."
            ),
            "probes": {},
            "geometry": measured["geometry"],
            "palette": measured["palette"],
            "palette_bands": measured["palette_bands"],
            "palette_hero_sampled": measured["palette_hero_sampled"],
            "palette_note": measured["palette_note"],
            "shell": {"inherits": True, "exceptions": []},
            "hero_inventory": {},
            "hero_doc": None,
            "sections": [],
            "data_fields": [],
            "blockers": [],
            "ambiguous": ["duplicate file" if duplicate_of else "unread by hand"],
            "source_doc": None,
            "element_count": 0,
        })

    refs.sort(key=lambda r: r["id"])

    unique = [r for r in refs if not r["duplicate_of"]]
    manifest = {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "tools/design/build_gallery.py",
        "reference_dir": "../refs/winterfest/",
        "counts": {
            "references": len(refs),
            "unique": len(unique),
            "duplicates": len(refs) - len(unique),
            "elements": sum(r["element_count"] for r in refs),
            "routes_mapped": len({r["route"] for r in refs}),
            "new_pages": sum(1 for r in refs if r["status"] == "new"),
            "existing_pages": sum(1 for r in refs if r["status"] == "exists"),
        },
        "shell": notes.get("shell", {}),
        "refs": refs,
    }
    return manifest, warnings


# --------------------------------------------------------------------------
# writers
# --------------------------------------------------------------------------

def write_manifest(manifest: dict) -> None:
    os.makedirs(GALLERY_DIR, exist_ok=True)
    path = os.path.join(GALLERY_DIR, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    js = os.path.join(GALLERY_DIR, "manifest.js")
    with open(js, "w", encoding="utf-8") as fh:
        fh.write("// generated by tools/design/build_gallery.py - do not edit\n")
        fh.write("window.GALLERY_MANIFEST = ")
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write(";\n")


def write_thumbs(manifest: dict) -> None:
    """Small JPEG previews so the index grid opens fast and works offline."""
    from PIL import Image

    out_dir = os.path.join(GALLERY_DIR, "thumbs")
    os.makedirs(out_dir, exist_ok=True)
    for ref in manifest["refs"]:
        src = os.path.join(REF_DIR, os.path.basename(ref["image"]))
        dst = os.path.join(GALLERY_DIR, ref["thumb"])
        with Image.open(src) as im:
            im = im.convert("RGB")
            width = 720
            if im.width > width:
                im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            im.save(dst, "JPEG", quality=82, optimize=True)


def md_escape(text: str) -> str:
    return str(text).replace("|", "\\|")


def geometry_hero(ref: dict) -> str:
    hero = ref["geometry"]["hero"]
    if hero["height_px"] is not None:
        return (f"{hero['height_px']} px ({hero['top_border_y']} to {hero['bottom_border_y']}) "
                "| long horizontal borders; measured")
    doc = ref.get("hero_doc")
    if doc:
        return (f"{doc['height_px']} px ({doc['top']} to {doc['bottom']}) "
                f"| from `{doc['source']}`; bottom border is not separable from the art")
    if hero.get("top_border_source") == "top-bar":
        return (f"top at {hero['top_border_y']} px (measured top bar) "
                "| bottom edge is art, not a line; height not separable - estimated")
    return "no separable bottom border | top border found, bottom joins the first card row; estimated"


def geometry_table(ref: dict) -> list[str]:
    g = ref["geometry"]
    side = g["sidebar"]
    top = g["top_bar"]
    hero = g["hero"]
    up = g["columns_upper"]
    low = g["columns_lower"]
    radius = g["card_radius"]
    lines = [
        "| measurement | value | how |",
        "| --- | --- | --- |",
        f"| sidebar width | {side['px']} px ({side['share_of_width']}% of width) | strongest vertical border in the left third; measured |",
        f"| top bar height | {top['height_px']} px | " +
        ("hero top border, long horizontal line detector; measured" if top.get("note", "").startswith("height = hero") else "edge-free strip under the pills; estimated") + " |",
        f"| hero | " + geometry_hero(ref) + " |",
        f"| columns at y {up['y_band'][0]}-{up['y_band'][1]} ({up['probe_fraction']:.0%} of height) | {up['count']}: " +
        (", ".join(f"{a}-{b}" for a, b in up["intervals"]) or "none detected") + " | card gutters; estimated |",
        f"| columns at y {low['y_band'][0]}-{low['y_band'][1]} ({low['probe_fraction']:.0%} of height) | {low['count']}: " +
        (", ".join(f"{a}-{b}" for a, b in low["intervals"]) or "none detected") + " | card gutters; estimated |",
        "| card radius | " + (f"{radius['px']} px | both top corners agree; estimated ±2 px"
                               if radius["px"] else
                               "not measurable | the border is a glow, not a crisp line; "
                               "`WINTERFEST-DASHBOARD.md` records ~14-18 px from the owner's read") + " |",
    ]
    return lines


def palette_table(ref: dict) -> list[str]:
    rows = ["| band | six most common colours (share) |", "| --- | --- |"]
    for band in ("top_bar", "sidebar", "hero", "main", "footer"):
        colours = ref["palette"].get(band)
        if not colours:
            if band == "hero":
                rows.append("| hero | not sampled - the hero's bottom edge is not separable from the art |")
            else:
                rows.append(f"| {band} | not present on this page |")
            continue
        cells = ", ".join(f"`{c['hex']}` {c['share']}%" for c in colours)
        rows.append(f"| {band} | {cells} |")
    return rows


def element_blocks(ref: dict) -> list[str]:
    out: list[str] = []
    hero = ref.get("hero_inventory") or {}
    if hero.get("items") or hero.get("lines"):
        out.append("**Hero / title block**")
        for line in hero.get("lines", []):
            out.append(f"- {line}")
        for item in hero.get("items", []):
            out.append(f"- {item}")
        if hero.get("countdown"):
            cd = hero["countdown"]
            out.append(f"- {cd['label']}: " + ", ".join(cd["tiles"]))
        out.append("")
    for section in ref["sections"]:
        out.append(f"**{section['title']}**")
        for item in section.get("items", []):
            out.append(f"- {item}")
        for table in section.get("tables", []):
            out.append(f"- _table_ {table['title']}: " + " | ".join(table["columns"]))
        for button in section.get("buttons", []):
            out.append(f"- button **{button}**")
        if section.get("note"):
            out.append(f"- _note_: {section['note']}")
        out.append("")
    for extra in ref["shell"]["exceptions"]:
        out.append(f"- shell exception: {extra}")
    return out


def routes_section(manifest: dict) -> list[str]:
    lines = [
        "| # | reference | page | route (primary) | status | replaces / new |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for ref in manifest["refs"]:
        if ref["duplicate_of"]:
            continue
        lines.append(
            f"| {ref['id'].split('-')[0]} | `{os.path.basename(ref['image'])}` | {md_escape(ref['title'])} | "
            f"`{ref['route']}` | {ref['status']} | {md_escape(ref.get('replaces') or '')} |"
        )
    return lines


def matrix(manifest: dict, warnings: list[str]) -> str:
    c = manifest["counts"]
    out: list[str] = []
    out.append("# Winterfest panel - specification matrix")
    out.append("")
    out.append("**This file is generated by `tools/design/build_gallery.py`. Do not edit it by hand.**")
    out.append("")
    out.append(f"Generated {manifest['generated_at']} from {c['references']} reference images "
               f"({c['unique']} unique, {c['duplicates']} duplicate), "
               f"{c['elements']} inventoried elements and {c['routes_mapped']} mapped primary routes.")
    out.append("")
    out.append("Every implementation page reads its numbers from here. Where a measurement could not be "
               "made cleanly from the image the row says **estimated** and the ambiguity is written down "
               "in that page's last block - nothing is presented as measured when it is not.")
    out.append("")
    out.append("## How to read this document")
    out.append("")
    out.append("- **Measured** values come from `tools/design/refmeasure.py`: sidebar border, top bar strip, "
               "hero borders, card gutters, corner radius, band palettes. Method notes are in `README` "
               "comments at the top of that file.")
    out.append("- **Read from the image** values (labels, section titles, table columns, counts of tiles) are "
               "transcribed literally from the reference by a person.")
    out.append("- Pixel numbers are in the reference's own space (1671-1672 x 941 for most pages, "
               "1622-1624 x 969 for `11-advent`, `13-levels`, `14-admin`).")
    out.append("- `route` names the primary route the page replaces; the full alias list is in the manifest "
               "and in `docs/design/PANEL-REBUILD.md`.")
    out.append("- **blockers** is the scheduling signal: the data or systems the page needs before it can be "
               "built honestly.")
    out.append("")
    out.append("## Route map at a glance")
    out.append("")
    out += routes_section(manifest)
    out.append("")
    out.append("## Summary table")
    out.append("")
    out.append("| reference | page | route | status | sidebar | top bar | hero | columns (upper / lower) | elements | blockers |")
    out.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for ref in manifest["refs"]:
        if ref["duplicate_of"]:
            continue
        g = ref["geometry"]
        up, low = g["columns_upper"], g["columns_lower"]
        hero = g["hero"]["height_px"]
        if hero:
            hero_cell = f"{hero} px"
        elif g["hero"]["top_border_y"] is not None or ref.get("hero_doc"):
            hero_cell = "not separable"
        else:
            hero_cell = "none found"
        out.append(
            f"| `{os.path.basename(ref['image'])}` | {md_escape(ref['title'])} | `{ref['route']}` | {ref['status']} | "
            f"{g['sidebar']['px']} px | {g['top_bar']['height_px']} px | "
            f"{hero_cell} | {up['count']} / {low['count']} | "
            f"{ref['element_count']} | {len(ref['blockers'])} |"
        )
    out.append("")
    out.append(f"Duplicate file: `02-profile-v2.png` is byte-identical to `02-profile.png` "
               f"(same SHA-256) and is flagged `duplicate_of` in the manifest; it is not a second page.")
    out.append("")
    out.append("## The shell (measured once, shared by every page)")
    out.append("")
    shell = manifest.get("shell", {})
    if shell:
        out.append("All references except `11-advent` repeat this shell. Sidebar: "
                   f"{manifest['refs'][0]['geometry']['sidebar']['px']} px wide, four groups, "
                   "active row filled purple with icon + title + subtitle.")
        out.append("")
        for group, items in shell.get("sidebar", {}).get("groups", {}).items():
            out.append(f"- **{group}**")
            for title, subtitle in items:
                out.append(f"  - {title} - _{subtitle}_")
        out.append("")
        out.append("Top bar: four currency pills (Coins 24,500 / GingerBread 1,320 / Spins 0 / Missions 0), "
                   "each with a `+` button, then a bell with a red unread dot, an envelope, and a profile chip "
                   "(avatar, FreeNovaPlayer, Level 56, chevron).")
        out.append("")
    out.append("## Palette method")
    out.append("")
    out.append("Each band is cropped, downscaled to at most 480 px, and median-cut quantised to 32 colours with "
               "no dithering; the six largest buckets are reported as their centroid hex plus their share of "
               "that band's pixels. The references are gradients, so these are representative buckets, not "
               "exact pixel values.")
    out.append("")

    for ref in manifest["refs"]:
        if ref["duplicate_of"]:
            continue
        out.append("---")
        out.append("")
        out.append(f"## {ref['id']} - {ref['title']}")
        out.append("")
        out.append(f"- image: `{os.path.basename(ref['image'])}` ({ref['width']}x{ref['height']}, "
                   f"{ref['bytes']:,} bytes)")
        out.append(f"- route: `{ref['route']}` " + (f"(also {', '.join('`' + r + '`' for r in ref['routes'][1:])})" if len(ref['routes']) > 1 else ""))
        out.append(f"- status: **{ref['status']}** - {ref.get('replaces') or ''}")
        out.append(f"- active sidebar item: {ref.get('active_nav')}")
        out.append(f"- {ref['summary']}")
        if ref.get("source_doc"):
            out.append(f"- cross-check: `{ref['source_doc']}`")
        out.append("")
        out.append("### Measured geometry")
        out.append("")
        out += geometry_table(ref)
        out.append("")
        out.append("### Palette")
        out.append("")
        out += palette_table(ref)
        out.append("")
        out.append(f"### Elements on screen ({ref['element_count']} inventoried)")
        out.append("")
        out += element_blocks(ref)
        out.append("### Data fields -> real source")
        out.append("")
        out.append("| element on screen | where the number/name must come from |")
        out.append("| --- | --- |")
        for field in ref["data_fields"]:
            out.append(f"| {md_escape(field['element'])} | {md_escape(field['source'])} |")
        out.append("")
        out.append("### Blockers")
        out.append("")
        out.append("The data or systems this page needs before it can be built honestly:")
        out.append("")
        for blocker in ref["blockers"]:
            out.append(f"- {blocker}")
        out.append("")
        out.append("### Ambiguous / estimated")
        out.append("")
        for item in ref["ambiguous"]:
            out.append(f"- {item}")
        out.append("")

    out.append("---")
    out.append("")
    out.append("## Pages the analysis could not map confidently")
    out.append("")
    out.append("- `11-advent` has no existing panel route; it is `new`. Its reference also contradicts itself: "
               "the header says Dec 1 - Dec 24 while the visible day houses are labelled Nov 18 - Nov 24, and "
               "the map implies a BONUS house beyond 24 days.")
    out.append("- `13-levels` is `new` (a `/levels` handler exists in `web-panel/src/index.js` but it is part of "
               "this same rebuild), and it disagrees with the profile reference on the XP scale "
               "(48,250/52,000 vs 28,450/40,000 at the same level 56).")
    out.append("- `14-admin` maps to the existing `/admin` section, but only its Overview tab has a reference; "
               "the eight other admin tabs in its strip have no design at all.")
    out.append("- `10-shop` prices are bare numbers with a coin icon on the tiles while the rail shows both "
               "coins and GingerBread; which currency each tile uses is an owner decision.")
    out.append("")
    if warnings:
        out.append("## Build warnings")
        out.append("")
        for warning in warnings:
            out.append(f"- {warning}")
        out.append("")
    out.append("## Opening the gallery")
    out.append("")
    out.append("```sh")
    out.append("docs/design/gallery/serve.sh          # picks a free port and prints the URL")
    out.append("python3 -m http.server -d docs/design/gallery 8000   # or plain python")
    out.append("```")
    out.append("")
    out.append("The site also opens by double-clicking `docs/design/gallery/index.html`: it reads "
               "`manifest.js`, so no fetch is needed. Only the compare iframe needs a running panel; "
               "point it at a local build with `?base=http://127.0.0.1:18101`.")
    out.append("")
    out.append("## Verification")
    out.append("")
    out.append("- `python3 -m json.tool docs/design/gallery/manifest.json`")
    out.append("- `python3 tools/design/build_gallery.py` twice - identical apart from `generated_at`")
    out.append("- every `image` path in the manifest is relative and resolves inside `docs/design/`")
    out.append("")
    return "\n".join(out)


def main() -> None:
    manifest, warnings = build()
    write_manifest(manifest)
    write_thumbs(manifest)
    with open(MATRIX, "w", encoding="utf-8") as fh:
        fh.write(matrix(manifest, warnings))
    for warning in warnings:
        print("warning:", warning)
    print(f"wrote {os.path.relpath(MATRIX, ROOT)}")
    print(f"wrote {os.path.relpath(os.path.join(GALLERY_DIR, 'manifest.json'), ROOT)}")
    print(f"{manifest['counts']['references']} references, {manifest['counts']['unique']} unique, "
          f"{manifest['counts']['elements']} elements, {manifest['counts']['routes_mapped']} routes")


if __name__ == "__main__":
    main()
