// Icon collection validation: run `node validate-icons.mjs` from web-panel/.
// Fails (exit 1) on: missing files, invalid PNGs, empty art, thin-line
// degenerate geometry (the screenshot bug), duplicate blobs, unmapped ids.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"
import { createHash } from "node:crypto"
import { TORNADO_WEAPONS, weaponById, weaponByName } from "./src/top15/theme.js"

const here = dirname(fileURLToPath(import.meta.url))
const I = (n) => join(here, "assets", "i", n)
let failures = 0
const check = (name, ok, detail) => {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? " — " + detail : ""))
  if (!ok) failures++
}

function pngAlpha(p) {
  const d = readFileSync(p)
  if (d.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("bad signature")
  let pos = 8, w = 0, h = 0, raw = Buffer.alloc(0)
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos)
    const typ = d.subarray(pos + 4, pos + 8).toString()
    const chunk = d.subarray(pos + 8, pos + 8 + ln)
    if (typ === "IHDR") { w = chunk.readUInt32BE(0); h = chunk.readUInt32BE(4) }
    else if (typ === "IDAT") raw = Buffer.concat([raw, chunk])
    else if (typ === "IEND") break
    pos += 12 + ln
  }
  const px = inflateSync(raw)
  const box = { x0: w, x1: -1, y0: h, y1: -1, ink: 0 }
  for (let y = 0; y < h; y++) {
    const row = (w * 4 + 1) * y
    for (let x = 0; x < w; x++) {
      if (px[row + 1 + x * 4 + 3] > 10) {
        box.ink++
        if (x < box.x0) box.x0 = x
        if (x > box.x1) box.x1 = x
        if (y < box.y0) box.y0 = y
        if (y > box.y1) box.y1 = y
      }
    }
  }
  return { w, h, ...box, bw: box.x1 - box.x0 + 1, bh: box.y1 - box.y0 + 1 }
}

// 1+2. every mapped asset exists and parses as PNG
const wanted = [...TORNADO_WEAPONS.map(w => w.img.split("/").pop()),
  "gun_c4.png", "gun_flashbang.png"]
for (const f of wanted) {
  const p = I(f)
  check("exists " + f, existsSync(p))
  if (existsSync(p)) {
    try { pngAlpha(p); check("valid png " + f, true) }
    catch (e) { check("valid png " + f, false, e.message) }
  }
}

// 3+4+5. geometry: non-empty, rejects thin-line degeneracy
for (const f of wanted) {
  const p = I(f)
  if (!existsSync(p)) continue
  const g = pngAlpha(p)
  check("non-empty " + f, g.ink > 50, "ink=" + g.ink)
  check("not-a-line " + f, g.bh >= 6 && g.bw >= 20,
    "bbox " + g.bw + "x" + g.bh)
  check("fills frame " + f, g.bw >= g.w * 0.5 && g.bh >= g.h * 0.4,
    "bbox " + g.bw + "x" + g.bh + " in " + g.w + "x" + g.h)
}

// 6+9. uniqueness: no two weapons share one blob
{
  const hashes = new Map()
  let dup = null
  for (const f of wanted) {
    const p = I(f)
    if (!existsSync(p)) continue
    const h = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16)
    if (hashes.has(h)) dup = f + " duplicates " + hashes.get(h)
    else hashes.set(h, f)
  }
  check("all icons unique", !dup, dup || wanted.length + " distinct files")
}

// 7. every id resolves to an existing asset
for (const w of TORNADO_WEAPONS) {
  check("id " + w.id + " resolves", existsSync(I(w.img.split("/").pop())), w.name)
}

// 8. aliases resolve without forking assets
for (const [alias, want] of [["mp5", 11], ["mp5navy", 11], ["glock", 1],
    ["glock18", 1], ["cv47", 17], ["ak47", 17], ["c4", -2], ["smoke", -3]]) {
  const got = weaponByName(alias)
  check("alias " + alias, !!got && got.id === want,
    got ? ("id=" + got.id + " img=" + (got.img || "(none)")) : "null")
}
check("unknown name is null", weaponByName("nonsense-xyz") === null)
check("id lookup intact", weaponById(17).name === "AK-47" && weaponById(999).id === 0)

// 9. battlepass / achievements / missions art: 96x96 RGBA, healthy margins,
// SHA-unique within each referenced set (2026-10-10 rebuild).
{
  const A = (d, f) => join(here, "assets", d, f)
  const ls = (d) => {
    try { return readdirSync(join(here, "assets", d)).filter(f => f.endsWith(".png")) } catch { return [] }
  }
  const sets = {
    bp: [...ls("bp").filter(f => /^(free|prem|bp)_/.test(f)), ...ls("bp").filter(f => /^skill_/.test(f)), "star.png"],
    medals: ls("medals").filter(f => /^(fn_|cat_|event_)/.test(f)),
    missions: ls("missions").filter(f => /^msn_/.test(f)),
  }
  for (const [setName, files] of Object.entries(sets)) {
    const hashes = new Map()
    for (const f of files) {
      const dir = setName === "bp" ? "bp" : setName
      const p = A(dir, f)
      if (!existsSync(p)) { check(`${setName}/${f} exists`, false); continue }
      let g
      try { g = pngAlpha(p) } catch (e) { check(`${setName}/${f} valid png`, false, e.message); continue }
      check(`${setName}/${f} 96x96`, g.w === 96 && g.h === 96, `${g.w}x${g.h}`)
      check(`${setName}/${f} margin>=6`, g.x0 >= 6 && g.y0 >= 6 && (g.w - 1 - g.x1) >= 6 && (g.h - 1 - g.y1) >= 6,
        `L=${g.x0} T=${g.y0} R=${g.w - 1 - g.x1} B=${g.h - 1 - g.y1}`)
      const h = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16)
      if (hashes.has(h)) check(`${setName}/${f} unique`, false, `duplicates ${hashes.get(h)}`)
      else { hashes.set(h, f); check(`${setName}/${f} unique`, true) }
    }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL ICON CHECKS PASSED")
process.exit(failures ? 1 : 0)
