// /winter/spin — the Spin Wheel page.
//
// WHAT IT IS: a VIEWER. The wheel, the prize table and the odds are real config
// (src/winter/spin_data.js, checked against configs/freenova/winterfest/spin.ini
// by web-panel/test_harness.mjs). The player's spins and their last ten results
// come from the game's mirror, if the game has pushed them.
//
// WHAT IT IS NOT: a way to spin. A spin must be one atomic thing — take the
// token, roll, record the intent, pay, announce — and today only the game can do
// that: there is no authenticated panel→game path for it (the `actions` queue has
// no consumer for Winterfest, and inventing an unauthenticated one would let any
// visitor burn a stranger's tokens). So the page states the truth — "spins happen
// in game with /spin" — and offers no button. docs/WINTERFEST-SPIN.md §6 has the
// two seams that would change that (a game-side `wf_spin` action consumer, or a
// signed claim endpoint) and exactly what each would need.
//
// Rendering rules are the Winterfest panel's (src/winter/render.js): server-side
// HTML, inline CSS, no images, no webfonts, no flex/grid/variables, and
// JavaScript only ever as enhancement. The GoldSrc MOTD browser cannot render
// SVG, so the compact skin gets the same information as tables and the wheel is
// browser-only — the page never looks broken, it looks plainer.
//
// Palette: the dashboard reference (docs/design/WINTERFEST-DASHBOARD.md) — page
// #0b1030, card #0d1430, border #2a3d6e, gold #f5c451, green #3fbf6f. The shared
// shell (render.js, owner: workstream 5) is on the pine-green seasonal palette;
// this page follows the reference for its own surfaces, as the mission asks, and
// needs no change when the shell moves over.
import { esc, fmt, winterPage, navTabs, winterHref, winterTime } from "./render.js"
import { isMotdCompact } from "../ui.js"
import { loadSeason } from "./season.js"
import { loadCatalog } from "./catalog.js"
import { loadState } from "./store.js"
import { normalizeSteamid } from "../publicapi.js"
import { parisMidnight, parisParts } from "../periods.js"
import {
  SPIN_WHEEL, SPIN_SECTORS, SPIN_RARITIES, SPIN_KINDS,
  spinOdds, spinTotalWeight, rarityWeight, prizeText, loadSpinMirror, nextResetAt,
} from "./spin_data.js"

const C = {
  page: "#0b1030",
  card: "#0d1430",
  cardTop: "#16224a",
  border: "#2a3d6e",
  text: "#eef2ff",
  muted: "#9fb0d0",
  gold: "#f5c451",
  green: "#3fbf6f",
  ice: "#4070c0",
  dim: "#7f8fb5",
}

const SPIN_CSS = `
body{background:${C.page} !important;color:${C.text};}
.wfs-card{background:${C.card};border:1px solid ${C.border};border-top:1px solid ${C.cardTop};
  border-radius:14px;padding:12px 14px;margin-top:10px;color:${C.text};}
.wfs-k{display:block;color:${C.dim};font-size:10px;letter-spacing:1.6px;text-transform:uppercase;}
.wfs-v{display:block;color:${C.text};font-size:26px;font-weight:bold;line-height:1.15;margin-top:3px;}
.wfs-v.gold{color:${C.gold};}.wfs-v.green{color:${C.green};}.wfs-v.ice{color:${C.ice};}.wfs-v.muted{color:${C.muted};}
.wfs-s{display:block;color:${C.muted};font-size:11px;margin-top:3px;}
.wfs-note{color:${C.muted};font-size:11px;line-height:1.5;margin:6px 0 0;}
.wfs-h2{color:${C.gold};font-size:13px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;
  margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #233562;}
.wfs-tab{width:100%;border-collapse:collapse;}
.wfs-tab td{border-bottom:1px solid #1b2745;padding:5px 6px;font-size:12px;color:${C.text};vertical-align:middle;}
.wfs-tab th{color:${C.dim};font-size:10px;letter-spacing:1.2px;text-transform:uppercase;text-align:left;
  border-bottom:1px solid ${C.border};padding:4px 6px;}
.wfs-tab td.r{text-align:right;}
.wfs-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle;}
.wfs-bar{background:#101a3a;border:1px solid ${C.border};height:8px;border-radius:4px;}
.wfs-bar div{background:${C.gold};height:8px;border-radius:4px;}
.wfs-chip{display:inline-block;border:1px solid ${C.border};background:#101a3a;color:${C.muted};
  border-radius:10px;padding:2px 9px;margin:3px 4px 0 0;font-size:11px;}
.wfs-chip b{color:${C.text};}
.wfs-hero{width:100%;border-collapse:collapse;}
.wfs-hero td{vertical-align:middle;padding:0;}
.wfs-wheelbox{width:320px;text-align:center;}
.wfs-ro{display:inline-block;border:1px solid ${C.border};background:#101a3a;color:${C.muted};
  border-radius:10px;padding:3px 10px;margin-top:8px;font-size:11px;}
.wfs-seq{color:${C.dim};font-size:10px;letter-spacing:2px;}
`

// --------------------------------------------------------------- the wheel --
const f2 = n => (Math.round(n * 100) / 100).toFixed(2)

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]
}

/**
 * The wheel as inline SVG. A slice's ANGLE is its chance, so the picture and the
 * table cannot disagree: a 2 % slice really is a sliver. The SVG colour of a
 * slice is its rarity's, and its rim is the card border, so it reads the same as
 * the table below it.
 */
export function wheelSvg(sectors = SPIN_SECTORS, opts) {
  const o = opts || {}
  const odds = spinOdds(sectors)
  const size = 480
  const cx = size / 2, cy = size / 2
  const r = 132
  const labelRings = [154, 178]
  const parts = []
  let angle = 0

  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="none" stroke="${C.border}" stroke-width="1"/>`)
  for (const s of odds) {
    const span = s.fraction * 360
    const a0 = angle
    const a1 = angle + span
    angle = a1
    const [x0, y0] = polar(cx, cy, r, a0)
    const [x1, y1] = polar(cx, cy, r, a1)
    const large = span > 180 ? 1 : 0
    const rar = SPIN_RARITIES[s.rarity] || SPIN_RARITIES.common
    parts.push(`<path d="M${cx} ${cy} L${f2(x0)} ${f2(y0)} A${r} ${r} 0 ${large} 1 ${f2(x1)} ${f2(y1)} Z" fill="${rar.color}" fill-opacity="${s.rarity === "common" ? "0.24" : s.rarity === "uncommon" ? "0.34" : "0.45"}" stroke="${C.card}" stroke-width="1.5"/>`)
    if (span >= 14) {
      const mid = a0 + span / 2
      const [ix, iy] = polar(cx, cy, r * 0.74, mid)
      parts.push(`<text x="${f2(ix)}" y="${f2(iy + 3)}" text-anchor="middle" font-family="Tahoma,Verdana,Arial,sans-serif" font-size="10" fill="${rar.color}">${s.index}</text>`)
    }
  }

  // labels around the ring, staggered on two radii so two short slices never
  // print on top of each other
  angle = 0
  for (let i = 0; i < odds.length; i++) {
    const s = odds[i]
    const span = s.fraction * 360
    const mid = angle + span / 2
    angle += span
    const ring = labelRings[i % 2]
    const [lx, ly] = polar(cx, cy, ring, mid)
    const sin = Math.sin((mid * Math.PI) / 180)
    const anchor = sin > 0.28 ? "start" : sin < -0.28 ? "end" : "middle"
    const rar = SPIN_RARITIES[s.rarity] || SPIN_RARITIES.common
    const dy = sin > 0.28 || sin < -0.28 ? 3 : 3
    parts.push(`<text x="${f2(lx)}" y="${f2(ly + dy)}" text-anchor="${anchor}" font-family="Tahoma,Verdana,Arial,sans-serif" font-size="10" fill="${rar.color}">${esc(s.label)}</text>`)
    const [tx0, ty0] = polar(cx, cy, r + 8, mid)
    const [tx1, ty1] = polar(cx, cy, ring - 16, mid)
    parts.push(`<line x1="${f2(tx0)}" y1="${f2(ty0)}" x2="${f2(tx1)}" y2="${f2(ty1)}" stroke="${C.border}" stroke-width="0.7"/>`)
  }

  const hub = o.hub == null ? String(SPIN_WHEEL.max) : String(o.hub)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="34" fill="${C.card}" stroke="${C.border}" stroke-width="1.5"/>`)
  parts.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Tahoma,Verdana,Arial,sans-serif" font-size="10" letter-spacing="1" fill="${C.dim}">SPINS</text>`)
  parts.push(`<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-family="Tahoma,Verdana,Arial,sans-serif" font-size="15" font-weight="bold" fill="${C.gold}">${esc(hub)}</text>`)

  return `<svg width="100%" viewBox="0 0 ${size} ${size}" role="img" aria-label="The Winterfest spin wheel: ${odds.length} prize sectors" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`
}

/** The compact (GoldSrc MOTD) wheel: the same sectors, as text. */
function wheelText(sectors = SPIN_SECTORS) {
  const odds = spinOdds(sectors)
  const rows = odds.map(s => {
    const rar = SPIN_RARITIES[s.rarity] || SPIN_RARITIES.common
    return `<tr>
      <td width="24"><b>${s.index}</b></td>
      <td><span class="wfs-dot" style="background:${esc(rar.color)}"></span>${esc(s.label)}</td>
      <td width="64" align="right">${s.pctText}%</td>
    </tr>`
  }).join("")
  return `<table class="wfs-tab" cellspacing="0" cellpadding="0" border="0">
    <tr><th width="24">#</th><th>Sector</th><th width="64" align="right">Chance</th></tr>
    ${rows}</table>
    <div class="wfs-note">The wheel itself is drawn in a browser (inline SVG); this is the same wheel as a list.</div>`
}

// --------------------------------------------------------------- the table --
function prizeTable(cat) {
  const odds = spinOdds()
  const rows = odds.map(s => {
    const rar = SPIN_RARITIES[s.rarity] || SPIN_RARITIES.common
    return `<tr>
      <td width="26" align="right"><b>${s.index}</b></td>
      <td><span class="wfs-dot" style="background:${esc(rar.color)}"></span>${esc(s.label)}</td>
      <td>${esc(prizeText(cat, s))}</td>
      <td width="92"><span class="wfs-s" style="margin:0">${esc(rar.label)}</span></td>
      <td width="64" align="right"><b>${s.pctText}%</b></td>
      <td width="90"><div class="wfs-bar"><div style="width:${Math.max(2, Math.round(s.pct))}%"></div></div></td>
    </tr>`
  }).join("")
  return `<table class="wfs-tab" cellspacing="0" cellpadding="0" border="0">
    <tr><th width="26">#</th><th>Prize</th><th>What you get</th><th width="92">Rarity</th><th width="64" align="right">Chance</th><th width="90">Weight</th></tr>
    ${rows}</table>`
}

// ------------------------------------------------------------------- page --
export async function pageWinterSpin(request, env, url) {
  const now = Math.floor(Date.now() / 1000)
  const sid = normalizeSteamid(url.searchParams.get("steamid") || "")
  const season = await loadSeason(env, now)
  const cat = await loadCatalog(env)
  const state = await loadState(env, sid, season.year)
  const mirror = await loadSpinMirror(env, sid)
  const odds = spinOdds()
  const rare = rarityWeight(SPIN_WHEEL.fadeRarity)
  const resetAt = nextResetAt(now, SPIN_WHEEL.resetHour, parisMidnight, parisParts)

  const compact = isMotdCompact()

  // --- the counter -------------------------------------------------------
  const haveSpins = mirror.spins != null
  const spinsValue = haveSpins
    ? `${fmt(mirror.spins)}<span class="wfs-s" style="display:inline"> / ${fmt(SPIN_WHEEL.max)}</span>`
    : `<span style="font-size:15px;color:${C.muted}">not mirrored</span>`
  const spinsNote = haveSpins
    ? (mirror.spins > 0
        ? `Enough for ${mirror.spins} spin${mirror.spins === 1 ? "" : "s"} right now.`
        : "No spins banked. The daily free spin is added by the game when you join on a new day.")
    : `The game has not pushed the spin counter yet (${esc(mirror.missing.join(", ") || "winter_players.spins")}), so this page will not print a number it cannot check. Your balance is on <code>/spin</code> in game.`

  // --- the daily reset, in the reader's own locale -----------------------
  const resetLine = `${fmt(SPIN_WHEEL.freePerDay)} free spin${SPIN_WHEEL.freePerDay === 1 ? "" : "s"} a day, at ${String(SPIN_WHEEL.resetHour).padStart(2, "0")}:00 ${esc(SPIN_WHEEL.timezone)} —
    next: ${winterTime(resetAt, SPIN_WHEEL.timezone)}`

  // --- recent results ----------------------------------------------------
  const results = mirror.results.length
    ? `<table class="wfs-tab" cellspacing="0" cellpadding="0" border="0">
        <tr><th width="128">When</th><th width="34">#</th><th>Prize</th><th width="92">Rarity</th></tr>
        ${mirror.results.map(r => {
          const rar = SPIN_RARITIES[r.rarity] || null
          return `<tr>
            <td><span class="wfs-s" style="margin:0">${winterTime(r.at, season.tz)}</span></td>
            <td align="right">${fmt(r.sector)}</td>
            <td>${esc(r.label || prizeText(cat, r))}</td>
            <td>${rar ? `<span class="wfs-dot" style="background:${esc(rar.color)}"></span>${esc(rar.label)}` : `<span class="wfs-s" style="margin:0">${esc(r.rarity)}</span>`}</td>
          </tr>`
        }).join("")}
      </table>`
    : `<div class="wfs-note"><b>No results to show.</b> ${mirror.missing.includes("winter_spin_log")
        ? "The game does not push spin results to the panel yet (there is no <code>winter_spin_log</code> table in this deployment), so there is nothing honest to put here. Every spin, its sector and its claim key are in the game server's log, and <code>/spin</code> in game shows your balance."
        : "You have not spun yet this season. Your last ten results appear here once the game pushes them."}</div>`

  // --- the wheel ---------------------------------------------------------
  const wheel = compact
    ? wheelText()
    : `<div class="wfs-wheelbox">${wheelSvg(SPIN_SECTORS, { hub: haveSpins ? mirror.spins : "?" })}
        <div class="wfs-s">Every slice's angle is its chance.</div></div>`

  const body = `
<style>${SPIN_CSS}</style>

<div class="wfs-card">
  <table class="wfs-hero" cellspacing="0" cellpadding="0" border="0"><tr>
    <td width="320">${wheel}</td>
    <td valign="top" style="padding-left:16px;">
      <div class="wfs-k">Your spins</div>
      <div class="wfs-v gold">${spinsValue}</div>
      <div class="wfs-s">${spinsNote}</div>
      <div style="margin-top:10px;">
        <span class="wfs-chip">Daily <b>${fmt(SPIN_WHEEL.freePerDay)}</b></span>
        <span class="wfs-chip">Cap <b>${fmt(SPIN_WHEEL.max)}</b></span>
        <span class="wfs-chip">Sectors <b>${odds.length}</b></span>
        <span class="wfs-chip">${esc(SPIN_RARITIES[SPIN_WHEEL.fadeRarity].label)}+ <b>${rare.pct.toFixed(1)}%</b></span>
      </div>
      <div class="wfs-note">${resetLine}</div>
      <div class="wfs-ro">Read-only view — spins happen in game with <code>/spin</code></div>
    </td>
  </tr></table>
</div>

<div class="wfs-card">
  <div class="wfs-h2">Prize table</div>
  ${prizeTable(cat)}
  <div class="wfs-note">Weights are the configured ones (they sum to ${fmt(spinTotalWeight())}); a sector's chance is
  its weight over that sum. A prize the game cannot pay you right now — an ornament you already own, a present bag
  that is full, a coin wallet that is still loading — is skipped on the wheel and its chance is spread over the rest,
  so a spent spin always buys a real prize. Nothing on this page is an estimate.</div>
</div>

<div class="wfs-card">
  <div class="wfs-h2">Your last ${mirror.results.length ? mirror.results.length : 10} results</div>
  ${results}
</div>

<div class="wfs-card">
  <div class="wfs-h2">How a spin works</div>
  <table class="wfs-tab" cellspacing="0" cellpadding="0" border="0">
    <tr><td width="130"><b>In game</b></td><td>Type <code>/spin</code>. The menu shows your balance; picking "Spin the wheel" spends one token, turns the wheel
      for about ${(SPIN_WHEEL.stepSeconds * 4).toFixed(1)} s and pays the prize. Rare and better also fades the screen.</td></tr>
    <tr><td><b>Earning more</b></td><td>One free spin a day, plus spins from presents, Advent days, Winter Pass tiers and the odd gift.
      An admin can grant them too.</td></tr>
    <tr><td><b>No double-spend</b></td><td>The token is taken before the prize is paid and the claim key is written before the announcement, so a
      reconnect or a second <code>/spin</code> can never pay twice. A spin interrupted mid-reveal is paid on your next connect.</td></tr>
    <tr><td><b>Why no button here</b></td><td>The panel cannot take a token: only the game can spend one atomically, and this deployment has no
      authenticated panel→game write path for spins. A button that queued an action nothing consumes would be a lie, so there is none.</td></tr>
  </table>
  <div class="wfs-note">Your tree, presents and ornaments are on the
    <a href="${esc(winterHref(url, "/winter"))}">Winterfest hub</a>.</div>
</div>`

  return winterPage("SPIN WHEEL", body, { season, nav: navTabs(url, "spin"), url })
}
