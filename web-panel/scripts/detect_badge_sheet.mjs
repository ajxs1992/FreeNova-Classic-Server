import sharp from "sharp"
const p = "C:/Users/conts/Desktop/FREENOVA System/rank medals no background.png"
const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height
function occX(y0, y1) {
  const out = new Array(w).fill(0)
  for (let y = y0; y <= y1; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) if (data[row + x * 4 + 3] > 24) out[x]++
  }
  return out
}
function occY(x0, x1, y0, y1) {
  const out = []
  for (let y = y0; y <= y1; y++) {
    let n = 0
    const row = y * w * 4
    for (let x = x0; x <= x1; x++) if (data[row + x * 4 + 3] > 24) n++
    out.push(n)
  }
  return out
}
function bands(occ, minRun = 16, minCount = 10) {
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
const rows = bands(occY(0, w - 1, 0, h - 1), 24, 8)
console.log("rows", rows)
for (const [y0, y1] of rows) {
  const cols = bands(occX(y0, y1), 20, 8)
  console.log(JSON.stringify({ y0, y1, n: cols.length, widths: cols.map(([a,b]) => b-a+1), cols }))
}
