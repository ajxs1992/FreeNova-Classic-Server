import sharp from "sharp"
import { join } from "path"

const p = "C:/Users/conts/Desktop/FREENOVA System/rank medals no background1.png"

function occupancy(raw, w, h, axis) {
  const n = axis === "x" ? w : h
  const out = new Array(n).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw[(y * w + x) * 4 + 3] > 16) {
        if (axis === "x") out[x]++
        else out[y]++
      }
    }
  }
  return out
}
function bands(occ, minRun = 8) {
  const segs = []
  let start = null
  for (let i = 0; i < occ.length; i++) {
    if (occ[i] > 4) {
      if (start == null) start = i
    } else if (start != null) {
      if (i - start >= minRun) segs.push([start, i - 1])
      start = null
    }
  }
  if (start != null && occ.length - start >= minRun) segs.push([start, occ.length - 1])
  return segs
}

const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const xs = occupancy(data, info.width, info.height, "x")
const ys = occupancy(data, info.width, info.height, "y")
const cols = bands(xs, 20)
const rows = bands(ys, 20)
console.log(JSON.stringify({
  w: info.width, h: info.height,
  colCount: cols.length, rowCount: rows.length,
  cols, rows,
  total: cols.length * rows.length
}, null, 2))
