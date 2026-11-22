import sharp from "sharp"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const outRoot = join(root, "web-panel/assets")

function rowMeans(raw, w, h, channels) {
  const rows = []
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      s += raw[i] + raw[i + 1] + raw[i + 2]
    }
    rows.push(s / (w * 3))
  }
  return rows
}
function colMeans(raw, w, h, channels) {
  const cols = []
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * channels
      s += raw[i] + raw[i + 1] + raw[i + 2]
    }
    cols.push(s / (h * 3))
  }
  return cols
}
function findGaps(means, minRun = 4, threshRatio = 0.55) {
  const avg = means.reduce((a, b) => a + b, 0) / means.length
  const thresh = avg * threshRatio
  const gaps = []
  let start = null
  for (let i = 0; i < means.length; i++) {
    if (means[i] < thresh) {
      if (start == null) start = i
    } else if (start != null) {
      if (i - start >= minRun) gaps.push([start, i - 1])
      start = null
    }
  }
  if (start != null && means.length - start >= minRun) gaps.push([start, means.length - 1])
  return { avg: Math.round(avg), thresh: Math.round(thresh), gaps }
}
function cellsFromGaps(gaps, total) {
  const bounds = []
  let cursor = 0
  for (const [g0, g1] of gaps) {
    if (g0 - cursor > 12) bounds.push([cursor, g0])
    cursor = g1 + 1
  }
  if (total - cursor > 12) bounds.push([cursor, total])
  return bounds
}

async function analyze(name) {
  const img = sharp(join(root, name)).removeAlpha()
  const meta = await img.metadata()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const rows = rowMeans(data, info.width, info.height, info.channels)
  const cols = colMeans(data, info.width, info.height, info.channels)
  const rg = findGaps(rows, 3, 0.62)
  const cg = findGaps(cols, 3, 0.62)
  const rowCells = cellsFromGaps(rg.gaps, info.height)
  const colCells = cellsFromGaps(cg.gaps, info.width)
  return {
    name,
    w: info.width,
    h: info.height,
    rowAvg: rg.avg,
    colAvg: cg.avg,
    rowGaps: rg.gaps.length,
    colGaps: cg.gaps.length,
    rows: rowCells.length,
    cols: colCells.length,
    rowCells,
    colCells
  }
}

const medals = await analyze("csgo medals.JPG")
const badges = await analyze("level badges.JPG")
console.log(JSON.stringify({ medals: { ...medals, rowCells: medals.rowCells, colCells: medals.colCells }, badges: { ...badges, rowCells: badges.rowCells, colCells: badges.colCells } }, null, 2))
