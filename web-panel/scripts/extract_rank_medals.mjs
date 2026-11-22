import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const src = join(root, "rank medals no background1.png")
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "ranks")
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, "raw_sheet"), { recursive: true })
copyFileSync(src, join(outDir, "raw_sheet", "rank medals no background1.png"))

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height

function occX(y0, y1) {
  const out = new Array(w).fill(0)
  for (let y = y0; y <= y1; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) if (data[row + x * 4 + 3] > 24) out[x]++
  }
  return out
}
function occY(x0, x1, y0, y1) {
  const out = []
  for (let y = y0; y <= y1; y++) {
    let n = 0
    const row = y * w * 4
    for (let x = x0; x <= x1; x++) if (data[row + x * 4 + 3] > 24) n++
    out.push(n)
  }
  return out
}
function bands(occ, minRun = 16, minCount = 10) {
  const segs = []
  let start = null
  for (let i = 0; i < occ.length; i++) {
    if (occ[i] >= minCount) {
      if (start == null) start = i
    } else if (start != null) {
      if (i - start >= minRun) segs.push([start, i - 1])
      start = null
    }
  }
  if (start != null && occ.length - start >= minRun) segs.push([start, occ.length - 1])
  return segs
}

const rowY = bands(occY(0, w - 1, 0, h - 1), 24, 8)
const cells = []
for (const [ry0, ry1] of rowY) {
  const cols = bands(occX(ry0, ry1), 24, 12)
  for (const [cx0, cx1] of cols) {
    const ys = occY(cx0, cx1, ry0, ry1)
    let yA = 0, yB = ys.length - 1
    while (yA < ys.length && ys[yA] < 4) yA++
    while (yB > yA && ys[yB] < 4) yB--
    const minX = cx0, maxX = cx1, minY = ry0 + yA, maxY = ry0 + yB
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const ar = bw / bh
    if (bw < 100 || bh < 100 || bw > 230 || ar < 0.78 || ar > 1.28) continue
    cells.push({ minX, minY, maxX, maxY, bw, bh, ar })
  }
}
cells.sort((a, b) => a.minY - b.minY || a.minX - b.minX)
const take = cells.slice(0, 19)
console.log("take", take.length, take.map(c => [c.bw, c.bh, c.minX, c.minY]))
if (take.length < 19) throw new Error("need 19 emblems, got " + take.length)

function wrapSvg(n, dataUri) {
  const dur = (1.8 + (n % 5) * 0.15).toFixed(2)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <radialGradient id="g${n}" cx="50%" cy="42%" r="58%">
      <stop offset="0%" stop-color="#fff8cc" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#74E600" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="58" fill="none" stroke="#74E600" stroke-width="1.4" opacity="0.22">
    <animate attributeName="r" values="50;62;50" dur="${dur}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.1;0.7;0.1" dur="${dur}s" repeatCount="indefinite"/>
  </circle>
  <circle cx="64" cy="64" r="46" fill="url(#g${n})">
    <animate attributeName="opacity" values="0.2;0.65;0.2" dur="${(parseFloat(dur) + 0.4).toFixed(2)}s" repeatCount="indefinite"/>
  </circle>
  <g>
    <animateTransform attributeName="transform" type="rotate" values="-6 64 64;6 64 64;-6 64 64" dur="${(parseFloat(dur) + 0.9).toFixed(2)}s" repeatCount="indefinite"/>
    <image href="${dataUri}" x="8" y="6" width="112" height="112" preserveAspectRatio="xMidYMid meet"/>
  </g>
  <g opacity="0.65">
    <rect x="-24" y="6" width="22" height="116" fill="#fff">
      <animateTransform attributeName="transform" type="translate" values="-50,0;160,0;-50,0" dur="1.8s" repeatCount="indefinite"/>
    </rect>
  </g>
</svg>
`
}

for (let i = 0; i < take.length; i++) {
  const b = take[i]
  const pad = 6
  const left = Math.max(0, b.minX - pad)
  const top = Math.max(0, b.minY - pad)
  const width = Math.min(w - left, b.bw + pad * 2)
  const height = Math.min(h - top, b.bh + pad * 2)
  const id = String(i + 1).padStart(2, "0")
  const pngPath = join(outDir, `rank_${id}.png`)
  await sharp(src).extract({ left, top, width, height }).png().toFile(pngPath)
  const b64 = readFileSync(pngPath).toString("base64")
  writeFileSync(join(outDir, `rank_${id}.svg`), wrapSvg(i + 1, "data:image/png;base64," + b64))
}
writeFileSync(join(outDir, "rank_extract.json"), JSON.stringify({
  source: "rank medals no background1.png",
  count: take.length,
  cells: take
}, null, 2))
console.log("wrote png+embedded-svg", take.length)
