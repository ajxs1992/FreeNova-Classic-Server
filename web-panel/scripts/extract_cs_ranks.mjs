import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const src = join(root, "cs ranks skill groups.jpg")
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "ranks")
mkdirSync(outDir, { recursive: true })
copyFileSync(src, join(outDir, "raw_sheet", "cs ranks skill groups.jpg"))

const NAMES = [
  "Unranked",
  "Silver I", "Silver II", "Silver III", "Silver IV", "Silver Elite", "Silver Elite Master",
  "Gold Nova I", "Gold Nova II", "Gold Nova III", "Gold Nova Master",
  "Master Guardian", "Master Guardian II", "Master Guardian Elite", "Distinguished Master Guardian",
  "Legendary Eagle", "Legendary Eagle Master", "Supreme Master First Class", "Global Elite"
]

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height, ch = info.channels
function luma(x, y) {
  const i = (y * w + x) * ch
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}
function bands1d(occ, minRun, minCount) {
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

const colOcc = new Array(w).fill(0)
for (let x = 0; x < w; x++) {
  let n = 0
  for (let y = 0; y < h; y += 2) if (luma(x, y) > 28) n++
  colOcc[x] = n
}
const cols = bands1d(colOcc, 80, 40)

const cells = []
for (const [cx0, cx1] of cols) {
  const rowOcc = new Array(h).fill(0)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = cx0; x <= cx1; x += 2) if (luma(x, y) > 28) n++
    rowOcc[y] = n
  }
  const rows = bands1d(rowOcc, 18, 12).filter(([a, b]) => (b - a + 1) >= 70)
  for (const [ry0, ry1] of rows) {
    const heights = []
    for (let y = ry0; y <= ry1; y++) {
      let n = 0
      for (let x = cx0; x <= cx1; x += 2) if (luma(x, y) > 28) n++
      heights.push({ y, n })
    }
    const maxN = Math.max(...heights.map(r => r.n))
    let cut = ry1
    const mid = Math.floor(heights.length * 0.62)
    for (let i = mid; i < heights.length - 2; i++) {
      if (heights[i].n < maxN * 0.2) { cut = heights[i].y; break }
    }
    cells.push({ minX: cx0, minY: ry0, maxX: cx1, maxY: cut })
  }
}

function keyAndTrim(raw, w0, h0) {
  const n = w0 * h0
  const seen = new Uint8Array(n)
  const stack = []
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w0 || y >= h0) return
    const i = y * w0 + x
    if (seen[i]) return
    seen[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w0; x++) { push(x, 0); push(x, h0 - 1) }
  for (let y = 0; y < h0; y++) { push(0, y); push(w0 - 1, y) }
  while (stack.length) {
    const i = stack.pop()
    const p = i * 4
    const L = 0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2]
    if (L > 22) continue
    raw[p + 3] = 0
    const x = i % w0, y = (i / w0) | 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  let minX = w0, minY = h0, maxX = 0, maxY = 0
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      if (raw[(y * w0 + x) * 4 + 3] < 20) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return { raw, w: w0, h: h0 }
  const pad = 3
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(w0 - 1, maxX + pad)
  maxY = Math.min(h0 - 1, maxY + pad)
  const nw = maxX - minX + 1, nh = maxY - minY + 1
  const out = Buffer.alloc(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    raw.copy(out, y * nw * 4, ((minY + y) * w0 + minX) * 4, ((minY + y) * w0 + minX + nw) * 4)
  }
  return { raw: out, w: nw, h: nh }
}

console.log("cells", cells.length, cells.map(c => [c.maxX - c.minX + 1, c.maxY - c.minY + 1, c.minX, c.minY]))
if (cells.length < 18) throw new Error("expected 18 badges, got " + cells.length)

const report = []
for (let i = 0; i < 18; i++) {
  const b = cells[i]
  const left = b.minX
  const top = b.minY
  const width = b.maxX - b.minX + 1
  const height = Math.max(24, b.maxY - b.minY + 1)
  const { data: raw, info: inf } = await sharp(src)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const trimmed = keyAndTrim(Buffer.from(raw), inf.width, inf.height)
  const rankId = i + 2
  const name = `rank_${String(rankId).padStart(2, "0")}.png`
  await sharp(trimmed.raw, { raw: { width: trimmed.w, height: trimmed.h, channels: 4 } })
    .png()
    .toFile(join(outDir, name))
  report.push({ rankId, label: NAMES[rankId - 1], file: name, w: trimmed.w, h: trimmed.h })
}

const blank = Buffer.alloc(180 * 56 * 4)
await sharp(blank, { raw: { width: 180, height: 56, channels: 4 } }).png().toFile(join(outDir, "rank_01.png"))
writeFileSync(join(outDir, "cs_rank_extract.json"), JSON.stringify({ source: "cs ranks skill groups.jpg", cells: report }, null, 2))
console.log(report.map(x => `${x.rankId} ${x.label} ${x.w}x${x.h}`).join("\n"))
