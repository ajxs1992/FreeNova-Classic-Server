import sharp from "sharp"
import { mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets")

function keyBlack(raw, w, h, thresh = 22) {
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

function trim(raw, w, h, pad = 4) {
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

async function extractRect(src, box, dest, thresh = 22) {
  const { data, info } = await sharp(src).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const buf = Buffer.from(data)
  keyBlack(buf, info.width, info.height, thresh)
  const t = trim(buf, info.width, info.height, 6)
  await sharp(t.raw, { raw: { width: t.w, height: t.h, channels: 4 } }).png().toFile(dest)
  return { w: t.w, h: t.h }
}

async function trophies() {
  const src = join(root, "trophies podium.jpg")
  const out = join(assets, "i")
  mkdirSync(out, { recursive: true })
  const meta = await sharp(src).metadata()
  const w = Math.floor(meta.width / 3)
  const names = ["trophy_1.png", "trophy_2.png", "trophy_3.png"]
  for (let i = 0; i < 3; i++) {
    await extractRect(src, { left: i * w, top: 0, width: i === 2 ? meta.width - 2 * w : w, height: meta.height }, join(out, names[i]), 18)
  }
  console.log("trophies", names.join(","))
}

async function gridSheet(file, destDir, prefix, cols, rows, thresh = 28) {
  const src = join(root, file)
  mkdirSync(destDir, { recursive: true })
  const meta = await sharp(src).metadata()
  const cellW = Math.floor(meta.width / cols)
  const cellH = Math.floor(meta.height / rows)
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = c * cellW
      const top = r * cellH
      const width = c === cols - 1 ? meta.width - left : cellW
      const height = r === rows - 1 ? meta.height - top : cellH
      const name = `${prefix}_${String(++n).padStart(3, "0")}.png`
      await extractRect(src, { left, top, width, height }, join(destDir, name), thresh)
    }
  }
  console.log(prefix, n, cellW, cellH)
  return n
}

await trophies()
mkdirSync(join(assets, "missions"), { recursive: true })
mkdirSync(join(assets, "i", "raw"), { recursive: true })
copyFileSync(join(root, "trophies podium.jpg"), join(assets, "i", "raw", "trophies podium.jpg"))
copyFileSync(join(root, "mission icons colorful.jpg"), join(assets, "missions", "raw.jpg"))
copyFileSync(join(root, "weapon mastery sheet 1.jpg"), join(assets, "i", "raw", "weapon mastery sheet 1.jpg"))
copyFileSync(join(root, "weapon mastery sheet 2.jpg"), join(assets, "i", "raw", "weapon mastery sheet 2.jpg"))
await gridSheet("mission icons colorful.jpg", join(assets, "missions"), "mi", 13, 10, 26)
await gridSheet("weapon mastery sheet 1.jpg", join(assets, "i"), "wpn", 10, 10, 26)
await gridSheet("weapon mastery sheet 2.jpg", join(assets, "i"), "cmb", 10, 10, 26)
