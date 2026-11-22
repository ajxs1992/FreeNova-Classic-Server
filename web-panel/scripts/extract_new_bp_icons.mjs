import sharp from "sharp"
import { mkdirSync, copyFileSync, writeFileSync, readdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const cache = "C:/Users/conts/AppData/Local/Temp/opencode/icon-cache"
const root = "C:/Users/conts/Desktop/FREENOVA System"
const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets")
const MOTD_BG = { r: 13, g: 15, b: 14 }

const SHEETS = [
  { file: "blob_9_27a79dd3759a280c75fd", prefix: "sheet1", cols: 5, rows: 4 },
  { file: "blob_8_e09340fb34d1dc520964", prefix: "sheet2", cols: 5, rows: 4 },
  { file: "blob_7_c6ff0b6186155a247419", prefix: "sheet3", cols: 5, rows: 4 }
]

function keyBlack(raw, w, h, thresh = 18) {
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = []
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (seen[i]) return
    seen[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const i = stack.pop()
    const p = i * 4
    const L = 0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2]
    if (L > thresh) continue
    raw[p + 3] = 0
    const x = i % w, y = (i / w) | 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
}

function trim(raw, w, h, pad = 6) {
  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw[(y * w + x) * 4 + 3] < 16) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return { raw, w, h }
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(w - 1, maxX + pad)
  maxY = Math.min(h - 1, maxY + pad)
  const nw = maxX - minX + 1, nh = maxY - minY + 1
  const out = Buffer.alloc(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    raw.copy(out, y * nw * 4, ((minY + y) * w + minX) * 4, ((minY + y) * w + minX + nw) * 4)
  }
  return { raw: out, w: nw, h: nh }
}

function flattenRgb(raw, w, h, bg = MOTD_BG) {
  const out = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const a = raw[i * 4 + 3] / 255
    out[i * 3] = Math.round(raw[i * 4] * a + bg.r * (1 - a))
    out[i * 3 + 1] = Math.round(raw[i * 4 + 1] * a + bg.g * (1 - a))
    out[i * 3 + 2] = Math.round(raw[i * 4 + 2] * a + bg.b * (1 - a))
  }
  return out
}

async function writeOpaquePng(rawRgba, w, h, dest, size = 96) {
  const rgb = flattenRgb(rawRgba, w, h)
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .resize(size, size, { fit: "contain", background: MOTD_BG })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(dest)
}

async function extractGrid(src, destDir, prefix, cols, rows, startIndex) {
  mkdirSync(destDir, { recursive: true })
  const meta = await sharp(src).metadata()
  const cellW = Math.floor(meta.width / cols)
  const cellH = Math.floor(meta.height / rows)
  const names = []
  let n = startIndex
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = c * cellW
      const top = r * cellH
      const width = c === cols - 1 ? meta.width - left : cellW
      const height = r === rows - 1 ? meta.height - top : cellH
      const { data, info } = await sharp(src).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const buf = Buffer.from(data)
      keyBlack(buf, info.width, info.height, 16)
      const t = trim(buf, info.width, info.height, 8)
      n++
      const name = `${prefix}_${String(n).padStart(2, "0")}.png`
      await writeOpaquePng(t.raw, t.w, t.h, join(destDir, name), 96)
      names.push(name)
    }
  }
  return { names, cellW, cellH, count: names.length }
}

async function flattenDir(dir, prefix, size) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(".png") || f.endsWith(".tmp.png")) continue
    const fp = join(dir, f)
    const { data, info } = await sharp(fp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const rgb = flattenRgb(Buffer.from(data), info.width, info.height)
    const tmp = fp + ".tmp.png"
    let img = sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    if (size) img = img.resize(size, size, { fit: "contain", background: MOTD_BG })
    await img.png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(tmp)
    copyFileSync(tmp, fp)
    n++
  }
  return n
}

mkdirSync(join(assets, "bp"), { recursive: true })
mkdirSync(join(root, "web-panel/assets/bp/raw"), { recursive: true })

const report = { sheets: [], start: 0 }
let idx = 0
for (const s of SHEETS) {
  const src = join(cache, s.file)
  const rawDest = join(assets, "bp", "raw", s.prefix + ".png")
  mkdirSync(join(assets, "bp", "raw"), { recursive: true })
  copyFileSync(src, rawDest)
  copyFileSync(src, join(root, s.prefix + "_bp_icons.png"))
  const r = await extractGrid(src, join(assets, "bp"), "bp", s.cols, s.rows, idx)
  idx += r.count
  report.sheets.push({ prefix: s.prefix, ...r, src: s.file })
  console.log(s.prefix, r.count, r.cellW, r.cellH)
}

const logo = join(assets, "logo.png")
if (existsSync(logo)) {
  const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgb = flattenRgb(Buffer.from(data), info.width, info.height)
  await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(96, 96, { fit: "contain", background: MOTD_BG })
    .png()
    .toFile(logo)
}

const flatRanks = await flattenDir(join(assets, "ranks"), "rank_", 96)
const flatBadges = await flattenDir(join(assets, "medals"), "fn_badge_", 96)
const flatShowcase = await flattenDir(join(assets, "medals"), "fn_", 96)
const flatMissions = await flattenDir(join(assets, "missions"), "mi_", 64)

report.flattened = { ranks: flatRanks, badges: flatBadges, showcase: flatShowcase, missions: flatMissions, bp: idx }
writeFileSync(join(assets, "bp", "extract_manifest.json"), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.flattened))
