import sharp from "sharp"
import { join } from "path"

const root = "C:/Users/conts/Desktop/FREENOVA System"

async function luma(file) {
  const { data, info } = await sharp(join(root, file)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}
function meanBox(img, x, y, w, h) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y))
  w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h))
  const x2 = Math.min(img.w, x + w), y2 = Math.min(img.h, y + h)
  let s = 0, n = 0
  for (let yy = y; yy < y2; yy++) {
    const row = yy * img.w
    for (let xx = x; xx < x2; xx++) { s += img.data[row + xx]; n++ }
  }
  return n ? s / n : 0
}
function scoreGrid(img, cols, rows, padX = 0, padY = 0, gap = 0) {
  const innerW = img.w - padX * 2
  const innerH = img.h - padY * 2
  const cellW = (innerW - gap * (cols - 1)) / cols
  const cellH = (innerH - gap * (rows - 1)) / rows
  if (cellW < 40 || cellH < 40) return { cols, rows, score: -1 }
  let interior = 0, gutter = 0, gn = 0, inN = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (cellW + gap)
      const y = padY + r * (cellH + gap)
      interior += meanBox(img, x + cellW * 0.25, y + cellH * 0.25, cellW * 0.5, cellH * 0.5)
      inN++
    }
  }
  for (let c = 1; c < cols; c++) {
    const x = padX + c * (cellW + gap) - Math.max(2, gap / 2 + 2)
    gutter += meanBox(img, x, padY + innerH * 0.2, 4, innerH * 0.6)
    gn++
  }
  for (let r = 1; r < rows; r++) {
    const y = padY + r * (cellH + gap) - Math.max(2, gap / 2 + 2)
    gutter += meanBox(img, padX + innerW * 0.2, y, innerW * 0.6, 4)
    gn++
  }
  const i = interior / inN
  const g = gn ? gutter / gn : i
  return { cols, rows, padX, padY, gap, cellW: +cellW.toFixed(1), cellH: +cellH.toFixed(1), interior: Math.round(i), gutter: Math.round(g), score: +(i - g).toFixed(2) }
}

const medals = await luma("csgo medals.JPG")
const badges = await luma("level badges.JPG")

function best(img, trials) {
  const scored = trials.map(t => scoreGrid(img, t[0], t[1], t[2] || 0, t[3] || 0, t[4] || 0))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 8)
}

const medalTrials = []
for (const cols of [4, 5, 6, 7, 8, 9, 10]) {
  for (const rows of [2, 3, 4, 5, 6]) {
    for (const pad of [0, 8, 16, 24, 40, 60]) {
      for (const gap of [0, 4, 8, 12, 16, 24]) {
        medalTrials.push([cols, rows, pad, pad, gap])
      }
    }
  }
}
const badgeTrials = []
for (const cols of [5, 6, 7, 8, 9]) {
  for (const rows of [2, 3, 4]) {
    for (const pad of [0, 8, 16, 24, 40, 60, 80]) {
      for (const gap of [0, 4, 8, 12, 16, 24, 32]) {
        badgeTrials.push([cols, rows, pad, pad, gap])
      }
    }
  }
}

console.log("MEDALS TOP", JSON.stringify(best(medals, medalTrials), null, 2))
console.log("BADGES TOP", JSON.stringify(best(badges, badgeTrials), null, 2))
