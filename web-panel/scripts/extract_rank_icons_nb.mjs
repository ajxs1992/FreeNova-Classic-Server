import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const src = join(root, "rank icons no background.png")
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "ranks")
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, "raw_sheet"), { recursive: true })
copyFileSync(src, join(outDir, "raw_sheet", "rank icons no background.png"))

const NAMES = [
  "Unranked",
  "Silver I", "Silver II", "Silver III", "Silver IV", "Silver Elite", "Silver Elite Master",
  "Gold Nova I", "Gold Nova II", "Gold Nova III", "Gold Nova Master",
  "Master Guardian", "Master Guardian II", "Master Guardian Elite", "Distinguished Master Guardian",
  "Legendary Eagle", "Legendary Eagle Master", "Supreme Master First Class", "Global Elite"
]

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height, n = w * h
const seen = new Uint8Array(n)
const boxes = []
function a(i) { return data[i * 4 + 3] }

for (let i = 0; i < n; i++) {
  if (seen[i] || a(i) <= 16) continue
  const stack = [i]
  seen[i] = 1
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p / w) | 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    count++
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (q < 0 || q >= n || seen[q] || a(q) <= 16) continue
      if (Math.abs((q % w) - x) > 1) continue
      seen[q] = 1
      stack.push(q)
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  boxes.push({ minX, minY, maxX, maxY, bw, bh, count, ar: bw / bh })
}

const tiles = boxes.filter(b =>
  b.minY >= 180 &&
  b.bw >= 105 && b.bw <= 220 &&
  b.bh >= 105 && b.bh <= 200 &&
  b.ar >= 0.8 && b.ar <= 1.45 &&
  b.count >= 7000
).sort((a, b) => a.minY - b.minY || a.minX - b.minX)

console.log("tiles", tiles.length, tiles.map(b => [b.bw, b.bh, b.minX, b.minY, +b.ar.toFixed(2)]))
if (tiles.length < 18) throw new Error("need 18 rank tiles, got " + tiles.length)

const take = tiles.slice(0, 18)
const report = []
for (let i = 0; i < take.length; i++) {
  const b = take[i]
  const pad = 4
  const left = Math.max(0, b.minX - pad)
  const top = Math.max(0, b.minY - pad)
  const width = Math.min(w - left, b.bw + pad * 2)
  const height = Math.min(h - top, b.bh + pad * 2)
  const rankId = i + 2
  const name = `rank_${String(rankId).padStart(2, "0")}.png`
  await sharp(src).extract({ left, top, width, height }).png().toFile(join(outDir, name))
  report.push({ rankId, label: NAMES[rankId - 1], file: name, w: width, h: height, left, top })
}

const blank = Buffer.alloc(180 * 56 * 4)
await sharp(blank, { raw: { width: 180, height: 56, channels: 4 } }).png().toFile(join(outDir, "rank_01.png"))
report.unshift({ rankId: 1, label: "Unranked", file: "rank_01.png", w: 180, h: 56 })

writeFileSync(join(outDir, "cs_rank_extract.json"), JSON.stringify({
  source: "rank icons no background.png",
  cells: report
}, null, 2))
console.log(report.map(x => `${x.rankId} ${x.label} ${x.w}x${x.h}`).join("\n"))
