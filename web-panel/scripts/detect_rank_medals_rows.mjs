import sharp from "sharp"
const p = "C:/Users/conts/Desktop/FREENOVA System/rank medals no background1.png"
const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height
function occX(y0, y1) {
  const out = new Array(w).fill(0)
  for (let y = y0; y <= y1; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) if (data[row + x * 4 + 3] > 20) out[x]++
  }
  return out
}
function bands(occ, minRun = 12, minCount = 6) {
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
const rowBands = [[42,204],[250,400],[441,593],[623,824]]
for (const [y0, y1] of rowBands) {
  const xs = occX(y0, y1)
  const cols = bands(xs, 18, 8)
  const widths = cols.map(([a,b]) => b - a + 1)
  console.log(JSON.stringify({ y0, y1, n: cols.length, widths, cols }))
}
