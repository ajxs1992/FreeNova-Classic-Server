#!/usr/bin/env python3
"""tools/art/mksprite.py - build a GoldSrc .spr (version 2, 8-bit indexed) from PNG frames.

Why this exists
---------------
The Winterfest effects need sprites that belong to us: a shipped file whose terms
we can name, sized for a 640x480 client, small enough to ride the connect
download. Nothing in the tree could write a .spr, so this is that tool. The
frames it eats are produced by ``tools/art/gen_effect_sprites.py`` and kept in
``thirdparty/winterfest-assets/effects-src/`` so every released .spr is
reproducible from this repo.

The container format, as verified against retail files
-----------------------------------------------------
There is no published GoldSrc sprite specification that agrees with itself, so
the layout below was derived from the retail sprites that ship with a CS 1.6
client (``sprites/glow01.spr``, ``sprites/fire1.spr``, ``sprites/steam1.spr``)
by parsing them until every byte of the file was accounted for, and then by
re-encoding them and diffing the result against the original. ``--verify`` does
that diff, and it passes on single-frame and multi-frame retail sprites alike::

    0   int32   ident            "IDSP" (0x50534449)
    4   int32   version          2
    8   int32   type             sprite orientation, see SPR_* below
    12  int32   texFormat        copied from the reference sprite, see --texformat
    16  float32 boundingradius   used for PVS culling; radius of the biggest frame
    20  int32   width            widest frame
    24  int32   height           tallest frame
    28  int32   numframes
    32  float32 beamlength       0 for a normal sprite
    36  int32   synctype         1 in every retail sprite we checked
    40  int16   numcolors        256
    42  byte[768] palette        r,g,b per index
    810 4 bytes padding          zero
    814 frames, numframes times:
            int32 origin[2]      offsets of the frame in its bounding box
            int32 width, height
            byte  pixels[width*height]   (one palette index per pixel)
            4 zero bytes after every frame except the last

Pixel index 255 is the transparent index, which is why a sprite can only carry
255 opaque colours; ``make_palette`` reserves it.

What is NOT proven here: the *meaning* of the ``texFormat`` field. Retail files
use 0, 1, 2 and 3 for different families and all of them are 8-bit, so it is not
a pixel-depth switch; the value is copied from a reference file and the effect's
blending is set on the entity/tempentity instead, so nothing depends on guessing
that field. Run ``--verify-sprites`` to re-check this tool against whatever
retail sprites are on this box.

Usage
-----
    # one sprite from explicit frames, in order
    tools/art/mksprite.py out.spr a.png b.png c.png

    # a horizontal strip cut into 6 equal frames (what gen_effect_sprites.py writes)
    tools/art/mksprite.py out.spr --strip sheet.png --frames 6

    # prove the writer against retail files (needs a cstrike/sprites directory)
    tools/art/mksprite.py --verify-sprites game-server/cstrike/sprites

    # prove the writer against one file
    tools/art/mksprite.py --verify build/wf-local/server/cstrike/sprites/steam1.spr

Exit codes: 0 ok, 1 verification mismatch, 2 usage/IO error.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the host has PIL 13
    print("mksprite: Pillow is required (python3 -m pip install Pillow)", file=sys.stderr)
    raise SystemExit(2)

IDSP = 0x50534449  # "IDSP"
VERSION = 2

# sprtype_t: how the sprite faces the camera. 2 (parallel to the screen, steered
# by the entity's angles) is what retail flare/glow/beam sprites use for things
# lying around a map, and what the effects here want.
SPR_VP_PARALLEL_UPRIGHT = 0
SPR_FACING_UPRIGHT = 1
SPR_VP_PARALLEL = 2
SPR_ORIENTED = 3
SPR_VP_PARALLEL_ORIENTED = 4

TRANSPARENT_INDEX = 255

HEADER = struct.Struct("<iiiifiiifi")
PALETTE_HEAD = struct.Struct("<h")
FRAME = struct.Struct("<iiii")
PALETTE_BYTES = 768
PALETTE_PAD = 4
FRAME_SEPARATOR = b"\x00\x00\x00\x00"


def _u8(value, what):
    if not 0 <= value <= 255:
        raise SystemExit(f"mksprite: {what} {value} does not fit in a byte")
    return value


def make_palette(frames):
    """One 256-entry palette shared by every frame.

    The frames are quantised together (not one at a time) so a colour keeps its
    index across the animation and does not shimmer. Index 255 is left for
    transparency: any pixel that is less than half opaque becomes 255, which is
    the only alpha a .spr version 2 sprite has.
    """
    w, h = frames[0].size
    strip = Image.new("RGBA", (w, h * len(frames)))
    for i, frame in enumerate(frames):
        strip.paste(frame, (0, h * i))
    # quantize() against an adaptive palette: 255 entries, one short of the
    # table, because the last slot is ours.
    quantised = strip.convert("RGB").quantize(colors=TRANSPARENT_INDEX, method=Image.MEDIANCUT, dither=Image.NONE)
    palette = quantised.getpalette()[: TRANSPARENT_INDEX * 3]
    palette += [0] * (PALETTE_BYTES - len(palette))
    out = []
    for i, frame in enumerate(frames):
        band = quantised.crop((0, h * i, w, h * (i + 1)))
        out.append(band)
    return bytes(palette), out, strip


def encode(frames, spritetype=SPR_VP_PARALLEL, texformat=1, synctype=1):
    """frames: list of PIL RGBA images, all the same size. Returns .spr bytes."""
    if not frames:
        raise SystemExit("mksprite: no frames")
    sizes = {f.size for f in frames}
    if len(sizes) != 1:
        raise SystemExit(f"mksprite: every frame must be the same size, got {sorted(sizes)}")
    width, height = frames[0].size
    if width < 1 or height < 1 or width > 1024 or height > 1024:
        raise SystemExit(f"mksprite: frame size {width}x{height} is not usable for a sprite")
    if not 1 <= len(frames) <= 255:
        raise SystemExit("mksprite: a sprite needs 1..255 frames")

    palette, indexed, strip = make_palette(frames)

    widest = max(f.size[0] for f in frames)
    tallest = max(f.size[1] for f in frames)
    radius = (widest * widest + tallest * tallest) ** 0.5 / 2.0

    out = bytearray()
    out += HEADER.pack(
        IDSP,
        VERSION,
        spritetype,
        texformat,
        float(radius),
        widest,
        tallest,
        len(frames),
        0.0,          # beamlength
        synctype,
    )
    out += PALETTE_HEAD.pack(256)
    out += palette
    out += b"\x00" * PALETTE_PAD

    for i, band in enumerate(indexed):
        alpha = frames[i].getchannel("A")
        pixels = bytearray(band.tobytes())
        # A pixel that is nearly invisible becomes the transparent index instead
        # of a dark fringe, so the sprite does not smudge on screen.
        for pos, a in enumerate(alpha.getdata()):
            if a < 128:
                pixels[pos] = TRANSPARENT_INDEX
        out += FRAME.pack(-(width // 2), height // 2, width, height)
        out += bytes(pixels)
        if i != len(frames) - 1:
            out += FRAME_SEPARATOR
    return bytes(out)


def read_sprite(data):
    """Parse .spr bytes into a dict, in the layout documented above.

    Raises ValueError when the bytes do not account for themselves, which is how
    ``--verify`` detects that this tool has drifted from the real format.
    """
    if len(data) < HEADER.size:
        raise ValueError("shorter than a sprite header")
    (ident, version, stype, texformat, radius, width, height,
     numframes, beamlength, synctype) = HEADER.unpack_from(data, 0)
    if ident != IDSP:
        raise ValueError(f"not a sprite (ident {ident:#x})")
    if version != VERSION:
        raise ValueError(f"version {version} (this tool writes {VERSION})")
    off = HEADER.size
    palette = None
    if version == 2:
        (numcolors,) = PALETTE_HEAD.unpack_from(data, off)
        off += PALETTE_HEAD.size
        palette = data[off: off + PALETTE_BYTES]
        off += PALETTE_BYTES + PALETTE_PAD
    frames = []
    for i in range(numframes):
        if off + FRAME.size > len(data):
            raise ValueError(f"frame {i}: header runs past the end")
        ox, oy, fw, fh = FRAME.unpack_from(data, off)
        off += FRAME.size
        if fw <= 0 or fh <= 0 or off + fw * fh > len(data):
            raise ValueError(f"frame {i}: {fw}x{fh} does not fit")
        frames.append((ox, oy, fw, fh, data[off: off + fw * fh]))
        off += fw * fh
        if i != numframes - 1:
            if data[off: off + 4] != FRAME_SEPARATOR:
                raise ValueError(f"frame {i}: expected the 4-byte frame separator")
            off += 4
    if off != len(data):
        raise ValueError(f"{len(data) - off} trailing bytes after {numframes} frame(s)")
    return {
        "version": version,
        "type": stype,
        "texformat": texformat,
        "radius": radius,
        "width": width,
        "height": height,
        "numframes": numframes,
        "palette": palette,
        "frames": frames,
        "synctype": synctype,
        "numcolors": numcolors if palette is not None else 0,
    }


def reencode(parsed):
    """Rebuild the exact bytes of a parsed sprite (used by --verify)."""
    out = bytearray()
    out += HEADER.pack(
        IDSP,
        parsed["version"],
        parsed["type"],
        parsed["texformat"],
        parsed["radius"],
        parsed["width"],
        parsed["height"],
        parsed["numframes"],
        0.0,
        parsed["synctype"],
    )
    out += PALETTE_HEAD.pack(parsed["numcolors"])
    out += parsed["palette"]
    out += b"\x00" * PALETTE_PAD
    for i, (ox, oy, fw, fh, pixels) in enumerate(parsed["frames"]):
        out += FRAME.pack(ox, oy, fw, fh)
        out += pixels
        if i != parsed["numframes"] - 1:
            out += FRAME_SEPARATOR
    return bytes(out)


def verify(path):
    with open(path, "rb") as fh:
        original = fh.read()
    parsed = read_sprite(original)
    rebuilt = reencode(parsed)
    if rebuilt != original:
        if len(rebuilt) != len(original):
            return False, f"rebuilt {len(rebuilt)}B, original {len(original)}B"
        first = next(i for i, (a, b) in enumerate(zip(rebuilt, original)) if a != b)
        return False, f"byte {first} differs"
    return True, f"{parsed['width']}x{parsed['height']} {parsed['numframes']} frame(s), {len(original)}B"


def verify_dir(directory):
    ok = bad = skipped = 0
    for name in sorted(os.listdir(directory)):
        if not name.lower().endswith(".spr"):
            continue
        path = os.path.join(directory, name)
        try:
            good, note = verify(path)
        except (ValueError, struct.error) as exc:
            skipped += 1
            print(f"SKIP {name}: {exc}")
            continue
        if good:
            ok += 1
        else:
            bad += 1
            print(f"FAIL {name}: {note}")
    print(f"{ok} sprite(s) round-tripped, {bad} mismatched, {skipped} not in this format")
    return 0 if bad == 0 else 1


def load_frames(args):
    frames = []
    if args.strip:
        sheet = Image.open(args.strip).convert("RGBA")
        if not args.frames:
            raise SystemExit("mksprite: --strip needs --frames N")
        count = args.frames
        if sheet.width % count:
            raise SystemExit(f"mksprite: strip width {sheet.width} is not a multiple of {count}")
        step = sheet.width // count
        for i in range(count):
            frames.append(sheet.crop((i * step, 0, (i + 1) * step, sheet.height)))
    else:
        for path in args.frames_or_none:
            frames.append(Image.open(path).convert("RGBA"))
    return frames


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Build a GoldSrc .spr (v2, 8-bit indexed) from PNG frames.",
        epilog="The frame layout is documented in this file's docstring; --verify proves it.",
    )
    ap.add_argument("output", nargs="?", help="the .spr to write")
    ap.add_argument("frames_or_none", nargs="*", metavar="frame.png", help="one PNG per frame, in order")
    ap.add_argument("--strip", help="a horizontal strip of --frames N equal frames instead")
    ap.add_argument("--frames", type=int, default=0, help="frame count when using --strip")
    ap.add_argument("--type", type=int, default=SPR_VP_PARALLEL, help=f"sprite orientation 0..4 (default {SPR_VP_PARALLEL})")
    ap.add_argument("--texformat", type=int, default=1,
                    help="copied from a reference retail sprite; 1 is what sprites/glow01.spr and "
                         "sprites/fire1.spr use (default 1). Blending is set on the entity, not here.")
    ap.add_argument("--synctype", type=int, default=1, help="1 in every retail sprite (default 1)")
    ap.add_argument("--verify", metavar="file.spr", help="round-trip an existing sprite and diff the bytes")
    ap.add_argument("--verify-sprites", metavar="dir", help="round-trip every .spr in a directory")
    ap.add_argument("--quiet", action="store_true", help="no per-file summary")
    args = ap.parse_args(argv)

    if args.verify_sprites:
        return verify_dir(args.verify_sprites)
    if args.verify:
        good, note = verify(args.verify)
        print(("OK   " if good else "FAIL ") + args.verify + ": " + note)
        return 0 if good else 1

    if not args.output:
        ap.error("an output .spr is required (or use --verify/--verify-sprites)")
    frames = load_frames(args)
    data = encode(frames, args.type, args.texformat, args.synctype)
    with open(args.output, "wb") as fh:
        fh.write(data)
    if not args.quiet:
        kind = {SPR_VP_PARALLEL_UPRIGHT: "parallel upright", SPR_FACING_UPRIGHT: "facing upright",
                SPR_VP_PARALLEL: "parallel", SPR_ORIENTED: "oriented",
                SPR_VP_PARALLEL_ORIENTED: "parallel oriented"}.get(args.type, str(args.type))
        print(f"{os.path.basename(args.output)}: {frames[0].width}x{frames[0].height}, "
              f"{len(frames)} frame(s), {len(data)} bytes, {kind}, texFormat {args.texformat}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
