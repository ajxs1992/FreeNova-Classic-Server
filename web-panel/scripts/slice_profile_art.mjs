import sharp from "sharp"
import { mkdirSync, copyFileSync, writeFileSync } from "fs"
import { join } from "path"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const assets = join(root, "web-panel/assets")

async function slice(file, destDir, prefix, cols, rows, padX, padY, gap, inset) {
  mkdirSync(destDir, { recursive: true })
  const meta = await sharp(join(root, file)).metadata()
  const innerW = meta.width - padX * 2
  const innerH = meta.height - padY * 2
  const cellW = (innerW - gap * (cols - 1)) / cols
  const cellH = (innerH - gap * (rows - 1)) / rows
  const out = []
  let i = 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = Math.round(padX + c * (cellW + gap) + inset)
      const top = Math.round(padY + r * (cellH + gap) + inset)
      const width = Math.round(cellW - inset * 2)
      const height = Math.round(cellH - inset * 2)
      if (left < 0 || top < 0 || left + width > meta.width || top + height > meta.height || width < 24 || height < 24) {
        throw new Error(`bad extract ${prefix} ${i} ${JSON.stringify({ left, top, width, height, mw: meta.width, mh: meta.height })}`)
      }
      const name = `${prefix}_${String(i).padStart(2, "0")}.png`
      await sharp(join(root, file)).extract({ left, top, width, height }).png().toFile(join(destDir, name))
      out.push({ name, left, top, width, height })
      i++
    }
  }
  return { src: file, srcW: meta.width, srcH: meta.height, cols, rows, cellW: +cellW.toFixed(1), cellH: +cellH.toFixed(1), files: out.length }
}

mkdirSync(join(assets, "medals"), { recursive: true })
mkdirSync(join(assets, "badges"), { recursive: true })
mkdirSync(join(assets, "logo"), { recursive: true })
copyFileSync(join(root, "freenova_logo.png"), join(assets, "logo.png"))
copyFileSync(join(root, "freenova_logo.png"), join(assets, "logo/freenova_logo.png"))

const medals = await slice("csgo medals.JPG", join(assets, "medals"), "medal", 8, 4, 8, 8, 24, 10)
const badgesA = await slice("level badges.JPG", join(assets, "badges"), "level", 6, 3, 16, 16, 12, 8)

const summary = { medals, badges: badgesA, logo: "web-panel/assets/logo.png" }
writeFileSync(join(assets, "asset_slice_manifest.json"), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
