"""Slice Capture.PNG icon sheet into missions/mi_###.png for MOTD missions + Battle Pass."""
from pathlib import Path
from collections import deque
from PIL import Image

SRC = Path(r"C:\Users\conts\Desktop\FREENOVA System\Capture.PNG")
OUT = Path(r"C:\Users\conts\Desktop\FREENOVA System\web-panel\assets\missions")
RAW = OUT / "raw_sheet"
RAW.mkdir(parents=True, exist_ok=True)

im = Image.open(SRC).convert("RGBA")
w, h = im.size
px = im.load()

# Treat near-black as empty. Glow fringes stay attached to their icon.
def is_ink(x, y):
    r, g, b, a = px[x, y]
    if a < 20:
        return False
    return (r + g + b) > 36

seen = bytearray(w * h)
boxes = []

for y in range(h):
    row = y * w
    for x in range(w):
        i = row + x
        if seen[i] or not is_ink(x, y):
            continue
        q = deque([i])
        seen[i] = 1
        minx = maxx = x
        miny = maxy = y
        count = 0
        while q:
            p = q.pop()
            cx = p % w
            cy = p // w
            count += 1
            if cx < minx: minx = cx
            if cy < miny: miny = cy
            if cx > maxx: maxx = cx
            if cy > maxy: maxy = cy
            for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                ni = ny * w + nx
                if seen[ni] or not is_ink(nx, ny):
                    continue
                seen[ni] = 1
                q.append(ni)
        bw = maxx - minx + 1
        bh = maxy - miny + 1
        boxes.append((minx, miny, maxx, maxy, bw, bh, count))

# Icons are ~70-110px. Drop noise (glow specks) and the full-sheet blob.
tiles = [b for b in boxes if 36 <= b[4] <= 160 and 36 <= b[5] <= 160 and b[6] >= 180]
# Cluster into rows by y-center
tiles.sort(key=lambda b: (b[1] + b[3]) / 2)
rows = []
for b in tiles:
    cy = (b[1] + b[3]) / 2
    if not rows or abs(cy - rows[-1][0]) > 40:
        rows.append([cy, [b]])
    else:
        rows[-1][1].append(b)
        rows[-1][0] = (rows[-1][0] * (len(rows[-1][1]) - 1) + cy) / len(rows[-1][1])
ordered = []
for _, row in rows:
    row.sort(key=lambda b: b[0])
    ordered.extend(row)

print("components", len(boxes), "tiles", len(tiles), "rows", [(len(r[1]), round(r[0])) for r in rows])

# Copy source
(RAW / "mission_bp_sheet.png").write_bytes(SRC.read_bytes())

pad = 4
size = 96
written = []
for n, b in enumerate(ordered, 1):
    minx, miny, maxx, maxy, bw, bh, count = b
    left = max(0, minx - pad)
    top = max(0, miny - pad)
    right = min(w, maxx + 1 + pad)
    bottom = min(h, maxy + 1 + pad)
    crop = im.crop((left, top, right, bottom))
    # Put on transparent square, keep aspect
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cw, ch = crop.size
    scale = min((size - 8) / cw, (size - 8) / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    resized = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    name = f"mi_{n:03d}.png"
    canvas.save(OUT / name)
    written.append(name)

print("wrote", len(written), "from", SRC.name, "to", OUT)
print("first", written[:5], "last", written[-3:])
