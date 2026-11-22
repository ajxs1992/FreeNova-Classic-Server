import sharp from "sharp"
const p = "C:/Users/conts/Desktop/FREENOVA System/gun icons.png"
const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height
function occ(axis) {
  const n = axis === "x" ? w : h
  const out = new Array(n).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) {
        if (axis === "x") out[x]++
        else out[y]++
      }
    }
  }
  return out
}
function bands(occ, minRun = 12, minCount = 8) {
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
const xs = occ("x"), ys = occ("y")
const cols = bands(xs, 20, 6)
const rows = bands(ys, 20, 6)
console.log(JSON.stringify({
  w, h,
  colCount: cols.length, rowCount: rows.length,
  cols, rows,
  colW: cols.map(([a,b]) => b-a+1),
  rowH: rows.map(([a,b]) => b-a+1)
}, null, 2))
