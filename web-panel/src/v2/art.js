// The pictures on screen: slices of the owner's own reference images.
//
// OWNER RULE (2025-11-22, final): the panel shows exactly the photos the owner
// provided — nothing drawn, nothing generated. Every file under
// `assets/winter/ref/` is a rectangle cut from `docs/design/refs/winterfest/*.png`
// at native pixel size, reference background intact (`ref/MANIFEST.json` records
// the source box for each one). Generated art is gone: `assets/winter/_generated_unused/`
// is not served and nothing below points at it.
//
// Consequences this module encodes:
//   * an element whose slice exists renders as an <img> at its native size,
//   * an element with no slice renders NOTHING (never a substitute, never an
//     SVG stand-in): the page falls back to the reference's plain text,
//   * no slice is ever scaled up.
import { MANIFEST } from "./art-manifest.js"

/** The three big pieces the pages place directly. */
export const BIG = {
  hero: "/winter/ref/hero-band.png",   // 1345x284 — the dashboard band, text baked in
  tree: "/winter/ref/tree-art.png",    // 194x214 — the decorated tree from the dashboard card
  santa: null                          // no standalone Santa exists in the reference
}

/** The four reward-tile pictures (the reference's own tiles, art only). */
export const TILE = {
  skin: "/winter/ref/tile-ak47.png",
  gingerbread: "/winter/ref/tile-gingerbread.png",
  ornament: "/winter/ref/tile-snowflake.png",
  badge: "/winter/ref/tile-santahat.png"
}

/**
 * One box size per context. A slice smaller than its box keeps its own size
 * (it is never enlarged); a slice larger than its box is scaled down to fit.
 */
export const ICON_SIZE = {
  nav: 46,
  tile: 74
}

/** Logical slot -> slice name in ref/. Only what the reference actually shows. */
const SLICE = {
  dashboard: "nav-dashboard", profile: "nav-profile", rankstats: "nav-rankstats",
  top15: "nav-top15", battlepass: "nav-battlepass", missions: "nav-missions",
  achievements: "nav-achievements", levels: "nav-levels", events: "nav-events",
  advent: "nav-advent", wheel: "nav-wheel", vip: "nav-vip", shop: "nav-shop",
  admin: "nav-admin",
  // the top-bar chips: the reference's own picture at the left of each glass pill
  "chip-coins": "chip-coins", "chip-gingerbread": "chip-gingerbread",
  "chip-spins": "chip-spins", "chip-missions": "chip-missions",
  // the shell's NAV rows name their icon by its picture, not by the page key
  stats: "nav-rankstats", trophy: "nav-top15", flag: "nav-battlepass",
  medal: "nav-achievements", crown: "nav-vip", gear: "nav-admin"
}

function sz(name) {
  const m = MANIFEST[name]
  return m ? { w: m.w, h: m.h } : null
}

/**
 * An icon as a slice in a fixed box. Returns "" when the reference has no
 * picture for that slot — the caller then renders no image at all.
 */
export function artIcon(name, box, opts = {}) {
  const slice = SLICE[name] || (MANIFEST[name] ? name : "")
  if (!slice) return ""
  const s = sz(slice)
  if (!s) return ""
  const limit = Math.min(box || Math.max(s.w, s.h), Math.max(s.w, s.h))
  const w = Math.min(s.w, limit)
  const h = Math.min(s.h, limit)
  const label = opts.label ? ` alt="${String(opts.label).replace(/"/g, "&quot;")}" role="img"` : ' alt="" aria-hidden="true"'
  return `<img class="v2-art-ic${opts.cls ? " " + opts.cls : ""}" src="/winter/ref/${slice}.png" width="${w}" height="${h}"${label} decoding="async">`
}

/** A big slice (hero band, tree art) at its native size. */
export function art(src, opts = {}) {
  const name = String(src || "").split("/").pop().replace(/\.png$/, "")
  const s = sz(name)
  if (!s) return ""
  const label = opts.label ? ` alt="${String(opts.label).replace(/"/g, "&quot;")}"` : ' alt="" aria-hidden="true"'
  return `<img class="v2-art-big${opts.cls ? " " + opts.cls : ""}" src="/winter/ref/${name}.png" width="${s.w}" height="${s.h}"${label} decoding="async">`
}

/** Is there a picture for this slot? */
export function hasArt(name) {
  return !!(SLICE[name] || MANIFEST[name])
}

export const ART_CSS = `
/* A slice keeps its own pixels: never stretched, never enlarged past native. */
.v2-art-ic{display:block;flex:none;object-fit:contain;max-width:100%;max-height:100%;
  filter:drop-shadow(0 1px 1px rgba(4,8,24,.65))}
.v2-art-big{display:block;max-width:100%;height:auto}
`
