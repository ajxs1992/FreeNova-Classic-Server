import sharp from "sharp"
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets")

function dist(r, g, b, sr, sg, sb) {
  const dr = r - sr, dg = g - sg, db = b - sb
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function floodAlpha(raw, w, h, thresh) {
  const n = w * h
  const alpha = new Uint8Array(n)
  alpha.fill(255)
  const bg = { r: 0, g: 0, b: 0, c: 0 }
  const corners = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5]
  ]
  for (const [cx, cy] of corners) {
    for (let yy = cy; yy < cy + 6 && yy < h; yy++) {
      for (let xx = cx; xx < cx + 6 && xx < w; xx++) {
        const i = (yy * w + xx) * 4
        bg.r += raw[i]; bg.g += raw[i + 1]; bg.b += raw[i + 2]; bg.c++
      }
    }
  }
  const sr = bg.r / bg.c, sg = bg.g / bg.c, sb = bg.b / bg.c
  // Global chroma-key against sampled source card color, then edge flood to catch leftovers.
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const r = raw[p], g = raw[p + 1], b = raw[p + 2]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const sat = Math.max(r, g, b) - Math.min(r, g, b)
    if (dist(r, g, b, sr, sg, sb) < thresh || (luma < 52 && sat < 22)) alpha[i] = 0
  }
  const stack = []
  const seen = new Uint8Array(n)
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
    if (alpha[i] === 0) {
      const x = i % w, y = (i / w) | 0
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
      continue
    }
    const p = i * 4
    const r = raw[p], g = raw[p + 1], b = raw[p + 2]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (dist(r, g, b, sr, sg, sb) < thresh + 18 && luma < 80) {
      alpha[i] = 0
      const x = i % w, y = (i / w) | 0
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    }
  }
  const next = alpha.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (alpha[i] === 0) continue
      let neighbors = 0
      if (!alpha[i - 1]) neighbors++
      if (!alpha[i + 1]) neighbors++
      if (!alpha[i - w]) neighbors++
      if (!alpha[i + w]) neighbors++
      const p = i * 4
      const luma = 0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2]
      if (neighbors >= 2 && luma < 78) next[i] = 0
    }
  }
  for (let i = 0; i < n; i++) raw[i * 4 + 3] = next[i]
  return { opaque: next.reduce((s, v) => s + (v ? 1 : 0), 0) / n, sr, sg, sb }
}

function rowStats(raw, w, h) {
  const rows = new Array(h)
  for (let y = 0; y < h; y++) {
    let luma = 0, sat = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = raw[i], g = raw[i + 1], b = raw[i + 2]
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b
      sat += Math.max(r, g, b) - Math.min(r, g, b)
    }
    rows[y] = { l: luma / w, sat: sat / w }
  }
  return rows
}

// Source sheets have a second bright band of caption text under each emblem.
function cropCaptionBand(raw, w, h) {
  const rows = rowStats(raw, w, h)
  const bandStart = Math.floor(h * 0.72)
  let peak = bandStart
  for (let y = bandStart; y < h; y++) if (rows[y].l > rows[peak].l) peak = y
  if (rows[peak].l < 70) return { raw, w, h, cut: h }
  let cut = h
  for (let y = peak; y > Math.floor(h * 0.48); y--) {
    if (rows[y].l < 50 && rows[y].sat < 24) { cut = y; break }
  }
  if (cut >= h - 6) return { raw, w, h, cut: h }
  const out = Buffer.alloc(w * cut * 4)
  raw.copy(out, 0, 0, w * cut * 4)
  return { raw: out, w, h: cut, cut }
}

function trimPad(raw, w, h, pad = 6) {
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

async function processDir(kind, prefix) {
  const srcDir = join(assets, kind)
  const rawDir = join(assets, kind, "raw")
  const outDir = join(assets, kind, "processed")
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  const files = readdirSync(srcDir).filter(f => f.startsWith(prefix) && f.endsWith(".png") && !f.includes("processed"))
  const report = []
  for (const f of files) {
    const live = join(srcDir, f)
    const rawPath = join(rawDir, f)
    if (!existsSync(rawPath)) copyFileSync(live, rawPath)
    const { data, info } = await sharp(rawPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const cropped = cropCaptionBand(Buffer.from(data), info.width, info.height)
    const stat = floodAlpha(cropped.raw, cropped.w, cropped.h, kind === "medals" ? 28 : 32)
    const trimmed = trimPad(cropped.raw, cropped.w, cropped.h, 8)
    await sharp(trimmed.raw, { raw: { width: trimmed.w, height: trimmed.h, channels: 4 } })
      .png()
      .toFile(join(outDir, f))
    report.push({ f, in: [info.width, info.height], cut: cropped.cut, out: [trimmed.w, trimmed.h], opaque: +stat.opaque.toFixed(3) })
  }
  return report
}

const medals = await processDir("medals", "medal_")
const badges = await processDir("badges", "level_")
const summary = { medals, badges }
writeFileSync(join(assets, "asset_process_manifest.json"), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ medalCount: medals.length, badgeCount: badges.length, sample: medals.slice(0, 3).concat(badges.slice(0, 2)) }, null, 2))
