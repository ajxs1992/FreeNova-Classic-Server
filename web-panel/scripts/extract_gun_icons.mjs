import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const src = join(root, "gun icons.png")
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "i")
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, "raw"), { recursive: true })
copyFileSync(src, join(outDir, "raw", "gun icons.png"))

const KEYS = [
  "ak47", "m4a1", "awp", "deagle", "knife", "usp", "glock",
  "famas", "galil", "scout", "aug", "sg552", "mp5", "p90", "ump",
  "mac10", "tmp", "m249", "m3", "xm1014", "sg550", "g3sg1", "he", "p228"
]

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height

function occX(y0, y1) {
  const out = new Array(w).fill(0)
  for (let y = y0; y <= y1; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) if (data[row + x * 4 + 3] > 18) out[x]++
  }
  return out
}
function occY(x0, x1, y0, y1) {
  const out = []
  for (let y = y0; y <= y1; y++) {
    let n = 0
    const row = y * w * 4
    for (let x = x0; x <= x1; x++) if (data[row + x * 4 + 3] > 18) n++
    out.push(n)
  }
  return out
}
function bands(occ, minRun = 16, minCount = 6) {
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

const rows = bands(occY(0, w - 1, 0, h - 1), 20, 6)
const cells = []
for (const [ry0, ry1] of rows) {
  const cols = bands(occX(ry0, ry1), 24, 8)
  for (const [cx0, cx1] of cols) {
    const ys = occY(cx0, cx1, ry0, ry1)
    let yA = 0, yB = ys.length - 1
    while (yA < ys.length && ys[yA] < 3) yA++
    while (yB > yA && ys[yB] < 3) yB--
    const xs = occX(ry0 + yA, ry0 + yB)
    let xA = cx0, xB = cx1
    while (xA < xB && xs[xA] < 3) xA++
    while (xB > xA && xs[xB] < 3) xB--
    const bw = xB - xA + 1, bh = (ry0 + yB) - (ry0 + yA) + 1
    if (bw < 40 || bh < 20) continue
    cells.push({ minX: xA, minY: ry0 + yA, maxX: xB, maxY: ry0 + yB, bw, bh })
  }
}
console.log("cells", cells.length, cells.map(c => [c.bw, c.bh, c.minX, c.minY]))

const report = []
for (let i = 0; i < Math.min(cells.length, KEYS.length); i++) {
  const b = cells[i]
  const pad = 4
  const left = Math.max(0, b.minX - pad)
  const top = Math.max(0, b.minY - pad)
  const width = Math.min(w - left, b.bw + pad * 2)
  const height = Math.min(h - top, b.bh + pad * 2)
  const name = `gun_${KEYS[i]}.png`
  await sharp(src).extract({ left, top, width, height }).png().toFile(join(outDir, name))
  report.push({ key: KEYS[i], left, top, width, height })
}
writeFileSync(join(outDir, "gun_extract.json"), JSON.stringify({
  source: "gun icons.png",
  count: report.length,
  keys: KEYS.slice(0, report.length),
  cells: report
}, null, 2))
console.log("wrote", report.length)
