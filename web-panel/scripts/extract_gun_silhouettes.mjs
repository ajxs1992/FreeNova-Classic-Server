import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const src = join(root, "gun silhouettes.png")
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "i")
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, "raw"), { recursive: true })
copyFileSync(src, join(outDir, "raw", "gun silhouettes.png"))

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height, n = w * h
const seen = new Uint8Array(n)
const boxes = []
function a(i) { return data[i * 4 + 3] }

for (let i = 0; i < n; i++) {
  if (seen[i] || a(i) < 16) continue
  const stack = [i]
  seen[i] = 1
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0
  while (stack.length) {
    const q = stack.pop()
    const x = q % w, y = (q / w) | 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    count++
    for (const t of [q - 1, q + 1, q - w, q + w]) {
      if (t < 0 || t >= n || seen[t] || a(t) < 16) continue
      if (Math.abs((t % w) - x) > 1) continue
      seen[t] = 1
      stack.push(t)
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  if (count < 200 || bw < 30 || bh < 14) continue
  boxes.push({ minX, minY, maxX, maxY, bw, bh, count })
}

boxes.sort((a, b) => a.minY - b.minY || a.minX - b.minX)
const rows = []
for (const b of boxes) {
  const last = rows[rows.length - 1]
  if (!last || b.minY - last[last.length - 1].minY > 28) rows.push([b])
  else last.push(b)
}
for (const row of rows) row.sort((a, c) => a.minX - c.minX)
const ordered = rows.flat()
console.log("rows", rows.map(r => r.length), "total", ordered.length)
rows.forEach((row, ri) => {
  console.log("R" + ri, row.map((b, i) => i + ":" + b.bw + "x" + b.bh + "@" + b.minX + "," + b.minY).join("  "))
})

const GUNS = {
  ak47: [2, 1],
  m4a1: [2, 0],
  awp: [1, 0],
  deagle: [7, 2],
  knife: [6, 0],
  usp: [0, 1],
  glock: [0, 0],
  famas: [0, 4],
  galil: [1, 1],
  scout: [3, 0],
  aug: [1, 2],
  sg552: [1, 3],
  mp5: [5, 0],
  p90: [0, 5],
  ump: [2, 4],
  mac10: [2, 2],
  tmp: [2, 3],
  m249: [5, 1],
  m3: [3, 1],
  xm1014: [3, 3],
  sg550: [5, 3],
  g3sg1: [5, 2],
  he: [6, 1]
}

function pick(ri, ci) {
  const row = rows[ri]
  if (!row || !row[ci]) throw new Error("missing cell " + ri + "," + ci)
  return row[ci]
}

const report = []
for (const [key, [ri, ci]] of Object.entries(GUNS)) {
  const b = pick(ri, ci)
  const pad = 3
  const left = Math.max(0, b.minX - pad)
  const top = Math.max(0, b.minY - pad)
  const width = Math.min(w - left, b.bw + pad * 2)
  const height = Math.min(h - top, b.bh + pad * 2)
  const { data: raw, info: inf } = await sharp(src)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const buf = Buffer.from(raw)
  const nn = inf.width * inf.height
  for (let i = 0; i < nn; i++) {
    const p = i * 4
    const L = 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2]
    if (L < 12 || buf[p + 3] < 12) { buf[p + 3] = 0; continue }
    buf[p] = 56
    buf[p + 1] = 120
    buf[p + 2] = 190
  }
  await sharp(buf, { raw: { width: inf.width, height: inf.height, channels: 4 } })
    .png()
    .toFile(join(outDir, `gun_${key}.png`))
  report.push({ key, ri, ci, w: width, h: height, left, top })
}

writeFileSync(join(outDir, "gun_extract.json"), JSON.stringify({
  source: "gun silhouettes.png",
  mapping: GUNS,
  cells: report
}, null, 2))
console.log(report.map(r => r.key + " r" + r.ri + "c" + r.ci + " " + r.w + "x" + r.h).join("\n"))
