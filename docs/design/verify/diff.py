#!/usr/bin/env python3
"""Fidelity check for the Winterfest dashboard MOTD (web-panel/assets/dashboard.html).

It measures three things, because they answer three different questions:

  1. does the page alter the owner's plate at all?
     Render the page at the plate's own size (1672x941). The image is drawn 1:1,
     so this is a straight pixel comparison against the file: any difference is
     something the page (or a CSS rule) did to it.

  2. does the page add anything inside the drawn area at the MOTD viewports?
     Render the plate ALONE at the exact size the page draws it (800x450,
     1024x576) and compare the page's drawn area with it. 0 differing pixels
     means the drawn area is nothing but the plate, scaled once by the client.

  3. how far is the page from the plate when PIL does the resizing?
     Chrome's and PIL's downscale kernels are not the same, so this number is
     never 0 - it is the resampling filter, not content. Reported with a block
     mean (structure: is anything shifted, cropped or stretched?) and flat-area
     medians (colour: are the colours exact?).

Usage:  python3 docs/design/verify/diff.py [http://192.168.1.5:18101]
Writes the screenshots and the side-by-side plates next to itself.
Exit:   0 when every check is at zero where it must be.
"""
import os
import subprocess
import sys
import tempfile
import hashlib
import urllib.request

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PLATE = os.path.join(ROOT, "docs", "design", "refs", "winterfest", "01-dashboard.png")
PAGE = "/dashboard"          # the route; /dashboard.html is the same bytes
PAGE_FILE = "/dashboard.html"  # what the game is sent (GoldSrc needs an extension)
PNG = "/dashboard.png"
BG = (13, 11, 24)          # the page's letterbox colour (#0d0b18)
THRESH = 8                 # "differs" = a channel moves more than this /255
BRAVE = os.environ.get("BRAVE", "brave")
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.5:18101").rstrip("/")


def shoot(url, w, h):
    out = os.path.join(tempfile.mkdtemp(), "shot.png")
    subprocess.run([BRAVE, "--headless=new", "--disable-gpu", "--no-sandbox",
                    "--force-device-scale-factor=1", "--window-size=%d,%d" % (w, h),
                    "--screenshot=" + out, url],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Image.open(out).convert("RGB")


def drawn_box(shot, tol=6):
    """The non-letterbox rows and columns of a screenshot of the page."""
    px = shot.load()
    w, h = shot.size
    rows = [y for y in range(h)
            if any(max(abs(px[x, y][i] - BG[i]) for i in range(3)) > tol
                   for x in range(0, w, 7))]
    cols = [x for x in range(w)
            if any(max(abs(px[x, y][i] - BG[i]) for i in range(3)) > tol
                   for y in range(0, h, 7))]
    return (min(cols), min(rows), max(cols) + 1, max(rows) + 1)


def counts(shot, ref):
    d = ImageChops.difference(shot, ref)
    g = d.convert("L")
    px = g.load()
    w, h = g.size
    out = {}
    for t in (0, 8, 32):
        out[t] = sum(1 for y in range(h) for x in range(w) if px[x, y] > t)
    out["n"] = w * h
    out["mean"] = sum(ImageStat.Stat(d).mean) / 3
    out["max"] = max(px[x, y] for y in range(h) for x in range(w))
    return out


def blocks(crop, ref, size=16):
    w, h = crop.size
    bw, bh = max(1, w // size), max(1, h // size)
    a = crop.resize((bw, bh), Image.BOX)
    b = ref.resize((bw, bh), Image.BOX)
    px = ImageChops.difference(a, b).convert("L").load()
    worst = max(px[x, y] for y in range(bh) for x in range(bw))
    over = sum(1 for y in range(bh) for x in range(bw) if px[x, y] > 2)
    return worst, 100.0 * over / (bw * bh)


def averaged(crop, ref, div=8):
    """Compare both images averaged into div x div blocks: structure, not kernel."""
    w, h = crop.size
    aw, ah = max(1, w // div), max(1, h // div)
    a = crop.resize((aw, ah), Image.BOX)
    b = ref.resize((aw, ah), Image.BOX)
    px = ImageChops.difference(a, b).convert("L").load()
    over = sum(1 for y in range(ah) for x in range(aw) if px[x, y] > 8)
    return aw, ah, 100.0 * over / (aw * ah), max(px[x, y] for y in range(ah) for x in range(aw))


def flat(crop, ref):
    """Difference where the plate is locally smooth: are the colours exact?"""
    w, h = ref.size
    smooth = ref.filter(ImageFilter.BoxBlur(3))
    sp = ImageChops.difference(ref, smooth).convert("L").load()
    px = ImageChops.difference(crop, ref).convert("L").load()
    err = sorted(px[x, y] for y in range(0, h, 2) for x in range(0, w, 2)
                 if sp[x, y] <= 2)
    if not err:
        return 0, 0, 0, 0
    return len(err), err[len(err) // 2], err[int(len(err) * .95)], err[-1]


def amplify(diff, factor=8):
    return diff.point(lambda v: min(255, v * factor))


def composite(shot, ref, diff, caption, path):
    w, h = shot.size
    pad, top = 8, 22
    out = Image.new("RGB", (w * 3 + pad * 4, h + top + pad), (24, 22, 34))
    dr = ImageDraw.Draw(out)
    for i, (img, label) in enumerate(((shot, caption[0]), (ref, caption[1]), (diff, caption[2]))):
        x = pad + i * (w + pad)
        out.paste(img, (x, top))
        dr.text((x + 2, 6), label, fill=(226, 220, 250))
    out.save(path)
    return path


def main():
    plate = Image.open(PLATE).convert("RGB")
    pw, ph = plate.size
    print("plate %s %dx%d sha256 %s" % (os.path.relpath(PLATE, ROOT), pw, ph,
          subprocess.run(["sha256sum", PLATE], capture_output=True, text=True)
                    .stdout.split()[0]))
    print("page  %s%s" % (BASE, PAGE))
    bad = []

    # ---- 0. the route and the file are the same document ----------------
    bodies = {}
    for path in ("/dashboard", PAGE_FILE, "/winter/dashboard"):
        with urllib.request.urlopen(BASE + path) as r:
            bodies[path] = r.read()
    same = len({hashlib.sha256(b).hexdigest() for b in bodies.values()}) == 1
    print("\n/dashboard, /dashboard.html and /winter/dashboard: %s (%d bytes, sha256 %s)"
          % ("identical" if same else "DIFFERENT", len(bodies[PAGE]),
             hashlib.sha256(bodies[PAGE]).hexdigest()[:16]))
    if not same:
        bad.append("the route and the static page are not the same document")

    # ---- 1. native size: the page must not touch a pixel -----------------
    native = os.path.join(HERE, "motd-%dx%d-native.png" % (pw, ph))
    shot = shoot(BASE + PAGE, pw, ph)
    shot.save(native)
    c = counts(shot, plate)
    print("\n%d x %d (plate's own size, image drawn 1:1)" % (pw, ph))
    print("  screenshot            %s" % os.path.relpath(native, ROOT))
    print("  pixels differing      %d of %d  (%.4f%%)  max channel delta %d  mean %.3f/255"
          % (c[0], c["n"], 100.0 * c[0] / c["n"], c["max"], c["mean"]))
    if c[0]:
        bad.append("native render differs from the plate")

    # ---- 2 + 3. the two MOTD viewports -----------------------------------
    for vw, vh in ((1024, 768), (800, 600)):
        shot = shoot(BASE + PAGE, vw, vh)
        page_png = os.path.join(HERE, "motd-%dx%d.png" % (vw, vh))
        shot.save(page_png)

        box = drawn_box(shot)
        crop = shot.crop(box)
        w, h = crop.size
        ratio = (w / h) / (pw / ph)

        # the browser's own render of the plate at exactly this size
        html = os.path.join(tempfile.mkdtemp(), "ref.html")
        with open(html, "w") as fh:
            fh.write("<!doctype html><meta charset=utf-8><style>html,body{margin:0;"
                     "padding:0;background:#0d0b18}img{display:block;width:%dpx;"
                     "height:%dpx}</style><img src=\"%s%s\">" % (w, h, BASE, PNG))
        ref = shoot("file://" + html, w, h)
        ref_full = Image.new("RGB", shot.size, BG)
        ref_full.paste(ref, (box[0], box[1]))

        zero = counts(crop, ref)
        lanc = plate.resize((w, h), Image.LANCZOS)
        pil = counts(crop, lanc)
        bw, bover = blocks(crop, lanc)
        fn, med, p95, mx = flat(crop, lanc)

        print("\n%d x %d" % (vw, vh))
        print("  screenshot            %s" % os.path.relpath(page_png, ROOT))
        print("  drawn area            %dx%d at (%d,%d), aspect %dx%d vs plate %.5f:%.5f"
              % (w, h, box[0], box[1], w, h, w / h, pw / ph))
        print("  vs the browser's own render of dashboard.png at %dx%d:" % (w, h))
        print("    pixels differing    %d of %d  (%.4f%%)  max channel delta %d"
              % (zero[0], zero["n"], 100.0 * zero[0] / zero["n"], zero["max"]))
        if zero[0]:
            bad.append("%dx%d drawn area is not just the plate" % (vw, vh))
        print("  vs the plate resized by PIL LANCZOS (the resampling filter, not content):")
        print("    >8/255              %d of %d  (%.3f%%)   >32/255 %.3f%%   mean %.3f/255"
              % (pil[8], pil["n"], 100.0 * pil[8] / pil["n"],
                 100.0 * pil[32] / pil["n"], pil["mean"]))
        print("    16x16 block means   worst %d/255, %.2f%% of blocks over 2/255" % (bw, bover))
        aw, ah, apct, amax = averaged(crop, lanc)
        print("    averaged to %dx%d   >8/255 %.3f%%   worst %d/255" % (aw, ah, apct, amax))
        print("    flat areas          %d px, median %d/255, p95 %d/255, max %d/255"
              % (fn, med, p95, mx))

        path = os.path.join(HERE, "motd-%dx%d-vs-plate.png" % (vw, vh))
        composite(shot, ref_full, amplify(ImageChops.difference(crop, lanc)),
                  ("MOTD %dx%d" % (vw, vh),
                   "dashboard.png at %dx%d" % (w, h),
                   "diff x8 (resize only)"),
                  path)
        print("  side by side         %s" % os.path.relpath(path, ROOT))

    print("\n%s" % ("EVERY CHECK AT ZERO" if not bad else "FAILED: " + "; ".join(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
