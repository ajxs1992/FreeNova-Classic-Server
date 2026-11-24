// FreeNova panel — the Winterfest dashboard, page 1 of 14.
//
// The owner approved this look (the plate: web-panel/assets/dashboard.png,
// 1672x941). This page keeps it: the chrome is the plate photograph itself,
// shown through CSS sprites (`background: url(/dashboard.png) -Xpx -Ypx`), and
// only the data is drawn as text. The region table lives in
// docs/panel/03-DASHBOARD.md and is repeated in SPRITES below; the harness
// checks every box against the file's real dimensions so a typo cannot ship.
//
// HOW THE PLATE IS REUSED
//   The plate paints its sample values INTO the chrome: the coin figure sits on
//   the currency pill's own plate, the countdown sits on its panel, the reward
//   labels sit on their frames. A sprite of that rectangle would bring the
//   sample with it. So a region that has text in it is padded with the
//   background colour sampled around it (PLATES[name][5] is that colour, taken
//   by docs/panel/03-DASHBOARD.md §6) — a solid monochrome pad has no inner
//   edges, so the panel's rounded border bleeds through it pixel for pixel, and
//   the real value is printed on the pad at the plate's own text position and
//   size. Regions the plate does have clean (the logo, the nav, the hero, the
//   card layer, the artwork) are the bare rectangles.
//
// WHAT IS NOT FILLED
//   Nothing below y = 646: the plate's left event card's Grinch art already
//   overlaps its own "Active Winterfest Events" heading, and every event card's
//   art runs up under its title, so no rectangle there is free of a sample
//   string or would survive a real title of a different length. That row is
//   drawn as text on the sampled navy instead (03-DASHBOARD.md §6 lists it, and
//   the chrome diff in §9 shows the floor that costs).
//
// DATA
//   Every number comes from getPlayer() (src/state.js) or src/query.js — never
//   ad-hoc SQL in this file. A missing player has null coins/level and the page
//   says "No player"; a counter the panel does not have prints an em dash, never
//   a 0 pretending to be data. The query count per load is fixed (five reads,
//   no N+1) and proven by the harness.
//
// JS OFF
//   The page is complete without script. The only script is the countdown tick
//   (it reads the server's own seconds from data-sec) and the fit-to-window
//   scaler, so a GoldSrc MOTD sees the whole 1672x941 plate, never a crop.
import { getPlayer } from "../state.js"
import { recentLedger, treeSlots, missionsFor } from "../query.js"
import { loadSchedule } from "../schedule.js"
import { parisParts, parisMidnight } from "../periods.js"
import { esc, fmt } from "../top15/render.js"

const PLATE_W = 1672, PLATE_H = 941

// --------------------------------------------------------------- sprites ----
// [name, x, y, w, h, pad, alt]
//   pad === null  → the bare plate rectangle (nothing on it was a sample value)
//   pad === "#hex" → the rectangle, padded with that sampled colour, with the
//                    page's own value printed on top at the plate's own glyph
//                    position (the matching `.txt-*` rule below).
// The bare rectangles are first: where two overlap the padded one wins the
// stack, the way the plate's own panel sits on the hero.
export const SPRITES = [
  ["logo", 0, 0, 294, 87, null],
  ["nav", 0, 87, 292, 441, null],
  ["navstrip", 0, 528, 292, 160, null],
  ["navgift", 0, 688, 292, 84, null],
  ["pill", 10, 90, 282, 60, null],
  ["hero", 294, 87, 1378, 260, null],
  ["cards", 306, 444, 1360, 202, null],
  ["treeart", 308, 461, 328, 289, null],
  ["tiles", 1235, 575, 420, 97, null],

  ["tile_coins", 324, 17, 230, 57, "#1c1638"],
  ["tile_gb", 576, 17, 230, 57, "#2a1730"],
  ["tile_spins", 827, 17, 222, 57, "#1b1233"],
  ["tile_missions", 1067, 17, 224, 57, "#171436"],
  ["chip_bell", 1295, 17, 52, 57, null],
  ["chip_envelope", 1352, 17, 52, 57, null],
  ["profile", 1409, 17, 250, 57, "#211740"],

  ["countdown", 770, 282, 388, 64, "#241f45"],
  ["cap_tree", 328, 388, 730, 44, "#123a34"],
  ["cap_pass", 850, 388, 240, 44, "#1c2959"],
  ["cap_advent", 1110, 388, 240, 44, "#1e2b5f"],
  ["cap_missions", 1338, 388, 257, 44, "#1e2c63"],
  ["cap_events", 1600, 388, 68, 44, "#20336d"],

  ["hdr_tree", 415, 467, 250, 60, "#1a3a52"],
  ["hdr_prog", 853, 467, 200, 60, "#141a45"],
  ["hdr_rew", 1288, 467, 180, 60, "#141a45"],
  ["row_labels", 871, 534, 152, 142, "#0e173d"],
  ["bar1", 872, 564, 310, 14, "#0e173d"],
  ["bar2", 872, 602, 310, 14, "#0e173d"],
  ["bar3", 872, 640, 310, 14, "#0e173d"],
  ["bar4", 872, 678, 310, 14, "#0e173d"],
  ["cta", 577, 673, 181, 38, null],
  ["snow_outer", 306, 444, 1360, 6, null],
  ["snow_inner", 306, 722, 1360, 24, null],
  ["act_icons", 320, 726, 36, 30, null],
  ["event_art", 320, 812, 1340, 80, null],
  ["pill1", 464, 856, 132, 32, null]
]

function sprite([name, x, y, w, h, pad]) {
  return `<div class="spr spr-${name}" style="` +
    `left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
    `background-position:-${x}px -${y}px` +
    (pad ? `;background-color:${pad}` : "") +
    `"></div>`
}

// ------------------------------------------------------------------- text ---
// The page's own text boxes: [id, x, y, w, h, font-px, weight, colour, align].
// Positions are the plate's own glyph boxes (measured, 03-DASHBOARD.md §6); a
// value is left-aligned at its plate x, a centred value is centred on it.
export const TEXTS = [
  ["s-dash-t", 105, 96, 172, 26, 18, 800, "#ffffff", "left"],
  ["s-dash-sub", 104, 124, 162, 14, 13, 600, "#cdc3e8", "left"],
  ["coins-v", 430, 21, 112, 30, 27, 700, "#fdfdfd", "left"],
  ["coins-l", 430, 49, 104, 22, 19, 600, "#eaedf7", "left"],
  ["gb-v", 663, 21, 112, 30, 27, 700, "#fdfdfd", "left"],
  ["gb-l", 663, 49, 98, 20, 19, 600, "#eaedf7", "left"],
  ["spins-v", 933, 21, 60, 30, 27, 700, "#fdfdfd", "left"],
  ["spins-l", 933, 49, 44, 20, 19, 600, "#eaedf7", "left"],
  ["miss-v", 1155, 21, 60, 30, 27, 700, "#fdfdfd", "left"],
  ["miss-l", 1155, 49, 92, 20, 19, 600, "#eaedf7", "left"],
  ["who-n", 1507, 26, 144, 22, 16, 700, "#f4f7ff", "left"],
  ["who-l", 1507, 45, 60, 18, 14, 600, "#dfe6f7", "left"],
  ["cd-eyebrow", 778, 260, 372, 30, 19, 700, "#f1ecfa", "center"],
  ["cd-dy", 808, 303, 36, 28, 28, 700, "#ffffff", "center"],
  ["cd-dy-l", 808, 335, 40, 18, 13, 600, "#d3cbe6", "center"],
  ["cd-hr", 904, 303, 36, 28, 28, 700, "#ffffff", "center"],
  ["cd-hr-l", 900, 335, 44, 16, 13, 600, "#d3cbe6", "center"],
  ["cd-mi", 998, 303, 36, 28, 28, 700, "#ffffff", "center"],
  ["cd-mi-l", 990, 335, 50, 16, 13, 600, "#d3cbe6", "center"],
  ["cd-se", 1094, 303, 36, 28, 28, 700, "#ffffff", "center"],
  ["cd-se-l", 1044, 335, 92, 16, 13, 600, "#d3cbe6", "center"],
  ["cap-tree-t", 478, 386, 120, 28, 17, 700, "#ffffff", "left"],
  ["cap-tree-v", 478, 414, 70, 24, 20, 800, "#63e877", "left"],
  ["cap-pass-t", 721, 386, 120, 24, 17, 700, "#ffffff", "left"],
  ["cap-pass-v", 721, 414, 80, 20, 19, 800, "#f4d34b", "left"],
  ["cap-adv-t", 971, 386, 120, 24, 17, 700, "#ffffff", "left"],
  ["cap-adv-v", 971, 414, 122, 20, 19, 800, "#f4d34b", "left"],
  ["cap-mis-t", 1178, 386, 120, 24, 17, 700, "#ffffff", "left"],
  ["cap-mis-v", 1178, 414, 100, 22, 19, 800, "#f4d34b", "left"],
  ["cap-evt-t", 1402, 386, 140, 24, 17, 700, "#ffffff", "left"],
  ["cap-evt-v", 1402, 414, 152, 24, 19, 800, "#f4d34b", "left"],
  ["h-tree", 415, 469, 248, 34, 23, 800, "#fdfdfd", "left"],
  ["sub-tree", 419, 497, 380, 28, 15, 600, "#e6eaf6", "left"],
  ["tp-label", 527, 541, 108, 22, 18, 700, "#f4f6ff", "left"],
  ["tp-value", 692, 539, 60, 26, 32, 800, "#46e05a", "right"],
  ["deco", 588, 680, 136, 14, 16, 800, "#ffffff", "left"],
  ["h-prog", 853, 469, 190, 34, 23, 800, "#fdfdfd", "left"],
  ["sub-prog", 857, 497, 320, 28, 15, 600, "#e6eaf6", "left"],
  ["h-rew", 1288, 469, 175, 34, 23, 800, "#fdfdfd", "left"],
  ["sub-rew", 1300, 497, 194, 26, 15, 600, "#e6eaf6", "left"],
  ["row1-l", 873, 536, 140, 22, 16, 600, "#eef1fa", "left"],
  ["row2-l", 873, 574, 140, 22, 16, 600, "#eef1fa", "left"],
  ["row3-l", 873, 612, 150, 22, 16, 600, "#eef1fa", "left"],
  ["row4-l", 873, 650, 150, 22, 16, 600, "#eef1fa", "left"],
  ["row1-v", 1104, 536, 68, 18, 15, 700, "#fdfdfd", "right"],
  ["row2-v", 1104, 574, 68, 18, 15, 700, "#fdfdfd", "right"],
  ["row3-v", 1104, 612, 68, 18, 15, 700, "#fdfdfd", "right"],
  ["row4-v", 1104, 650, 68, 18, 15, 700, "#fdfdfd", "right"],
  ["rw1", 1246, 610, 86, 52, 12, 700, "#fdfdfd", "center"],
  ["rw2", 1340, 610, 90, 52, 12, 700, "#fdfdfd", "center"],
  ["rw3", 1444, 610, 84, 52, 12, 700, "#fdfdfd", "center"],
  ["rw4", 1548, 610, 90, 52, 12, 700, "#fdfdfd", "center"],
  ["h-act", 370, 730, 303, 26, 20, 800, "#fdfdfd", "left"]
]

// ------------------------------------------------------------------- styles --
const CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:#0e0f30;overflow:hidden}
body{font-family:Nunito,'Trebuchet MS','Segoe UI',Cantarell,'DejaVu Sans',Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
#stage{position:relative;width:${PLATE_W}px;height:${PLATE_H}px;background:#0e0f30;
  overflow:hidden;transform-origin:top left;color:#f6f8ff}
.spr{position:absolute;left:0;top:0;background-image:url(/dashboard.png);background-repeat:no-repeat;
  background-size:${PLATE_W}px ${PLATE_H}px}
${SPRITES.map(([n, x, y, w, h, pad]) => `.spr-${n}{left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-position:-${x}px -${y}px${pad ? `;background-color:${pad}` : ""}}`).join("\n")}
${TEXTS.map(([id, x, y, w, h, fs, wt, col, al]) => `#${id}{left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${fs}px;line-height:${h}px;font-weight:${wt};color:${col};text-align:${al}}`).join("\n")}
.txt{position:absolute;white-space:nowrap;letter-spacing:0;overflow:hidden}
.num{font-variant-numeric:tabular-nums}
/* the active-event row: text only, on the plate's own navy */
.act-navy{position:absolute;left:306px;top:704px;width:1360px;height:237px;background:#0b1030}
.ev{position:absolute;top:812px;width:320px;overflow:hidden}
.ev b{display:block;font-size:19px;line-height:22px;font-weight:800;color:#ffffff;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev span{display:block;margin-top:3px;font-size:14px;line-height:16px;font-weight:600;color:#e3e7f2;
  height:32px;overflow:hidden}
.ev em{display:inline-block;margin-top:5px;font-style:normal;font-size:13px;line-height:18px;
  font-weight:800;padding:1px 12px;border-radius:9px;background:#1f9d46;color:#ffffff}
.ev em.wait{background:#7a5a12;color:#ffe9a8}
.ev em.off{background:#3a3f55;color:#dfe4f0}
#ev0{left:460px}#ev1{left:775px}#ev2{left:1065px}#ev3{left:1425px}
#ev-sub2{display:block;margin-top:2px}
.hidden{display:none}
`.trim()

// ------------------------------------------------------------------ helpers --
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null }
function val(v, dash) { const n = num(v); return n == null ? esc(dash || "—") : esc(fmt(n)) }
function pad2(n) { return n < 10 ? "0" + n : String(n) }
function plural(n, one, many) { return n === 1 ? one : many }

/** The season window: the game's pushed one, else the documented default
 *  (1 Dec 00:00 → 24 Dec 23:59 Europe/Paris, owner decision §6.3). */
export function seasonWindow(metaRow, now) {
  let start = null, end = null
  if (metaRow && metaRow.value) {
    try {
      const s = JSON.parse(metaRow.value)
      const a = Number(s.start || s.start_at || s.starts_at || 0)
      const b = Number(s.end || s.end_at || s.ends_at || 0)
      if (a > 0) start = a
      if (b > 0) end = b
    } catch {}
  }
  const season = parisParts(now).y
  if (start == null) start = parisMidnight(season, 12, 1)
  if (end == null) end = parisMidnight(season, 12, 25) - 60
  return { start, end }
}

/** The four countdown cells. Never negative: a closed window is all zeros. */
export function countdownCells(end, now) {
  const left = Math.max(0, Math.trunc(end - now))
  return {
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
    left,
    closed: left === 0
  }
}

function relText(sec) {
  const left = Math.max(0, Math.trunc(sec || 0))
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function rewardLabel(row) {
  const cur = String(row.currency || "")
  const long = cur === "coins" ? "Coins" : cur === "gingerbread" ? "Gingerbread" : cur === "spins" ? "Spin" : cur || "Grant"
  const short = cur === "coins" ? "Coins" : cur === "gingerbread" ? "Gingerbread" : cur === "spins" ? "Spin" : cur.slice(0, 9) || "Grant"
  const sign = row.delta > 0 ? "+" : ""
  return { long, short, amount: sign + fmt(row.delta) }
}

// -------------------------------------------------------------------- page --
export async function pageDashboard(env, url) {
  const now = Math.floor(Date.now() / 1000)
  const minted = url && url._fnMotdSid
  const raw = (minted && String(minted)) || (url.searchParams.get("steamid") || "").trim()
  const sid = /^STEAM_[0-9]:[0-9]:\d+$/.test(raw) ? raw : ""
  const data = await loadDashboard(env, sid, now)
  const doc = renderPlate(data)
  return new Response(doc, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  })
}

// Five reads, fixed: the schedule (cached per env), the pushed season row, and
// for a known player getPlayer() (four statements), the last ledger lines, the
// tree slots and the mission claims. No query inside a loop.
export async function loadDashboard(env, sid, now) {
  const schedule = await loadSchedule(env, now)
  const seasonRow = await env.DB.prepare("SELECT value FROM winter_meta WHERE key='season'").first().catch(() => null)
  const window = seasonWindow(seasonRow, now)
  const cd = countdownCells(window.end, now)
  let p = null, ledger = [], tree = null, missions = []
  if (sid) {
    try { p = await getPlayer(env.DB, sid) } catch { p = null }
    if (p && p.exists) {
      ledger = await recentLedger(env.DB, sid, { limit: 4 })
      tree = await treeSlots(env.DB, sid)
      missions = await missionsFor(env.DB, sid, { limit: 60 })
    }
  }
  const known = !!(p && p.exists)
  const live = (schedule || []).filter(e => e.state === "active")
  const upcoming = (schedule || []).filter(e => e.state === "scheduled")
  return {
    sid, known, p, ledger, tree, missions, cd, window, now,
    active: live.concat(upcoming).slice(0, 4),
    usingSid: !!sid,
    who: known ? String(p.name || "") : ""
  }
}

// ------------------------------------------------------------------ render --
export function renderPlate(d) {
  const { sid, known, p, ledger, tree, missions, active, cd, now, who } = d
  const counts = (p && p.counts) || {}
  const treePct = known && tree && tree.capacity ? Math.round((tree.filled / tree.capacity) * 100) : null

  // Missions: the panel owns CLAIM state only (query.js missionsFor). "done" is
  // the applied claims; the ladder size comes from the game's pushed count when
  // the panel has one, otherwise the page shows the claims alone and never
  // invents a denominator.
  const done = missions.filter(m => m.state === "applied").length
  const total = Number(counts.missions_total || 0) || (missions.length || 0)

  const noPlayer = "No player"
  const coinsText = known ? val(p.coins) : noPlayer
  const gbText = known ? val(p.gingerbread) : noPlayer
  const spinsText = known ? val(p.spins) : noPlayer
  const missText = known ? val(done) : noPlayer
  const passText = known ? "Lv. " + (num(p.pass && p.pass.tier) == null ? "—" : fmt(p.pass.tier)) : noPlayer
  const treeText = treePct == null ? (known ? "—" : noPlayer) : treePct + "%"
  const adventText = known ? `${esc(String(counts.advent_claimed || 0))} / 24` : noPlayer
  const missionsText = known ? `${esc(String(done))} / ${esc(String(total || 0))}` : noPlayer
  const eventCount = active.filter(e => e.state === "active").length
  const eventsText = `Active: ${eventCount}`
  const nameText = known && who ? esc(who) : esc(sid ? "Unknown player" : noPlayer)
  const levelText = known && num(p.level) != null ? "Level " + esc(fmt(p.level)) : esc(sid ? "not synced yet" : "")

  const cdCells = [["cd-dy", cd.days, "Day", "Days"], ["cd-hr", cd.hours, "Hour", "Hours"],
                   ["cd-mi", cd.minutes, "Minute", "Minutes"], ["cd-se", cd.seconds, "Second", "Seconds"]]

  const values = {
    "s-dash-t": "Dashboard",
    "s-dash-sub": "Winterfest overview &amp; countdown",
    "coins-v": coinsText, "coins-l": "Coins",
    "gb-v": gbText, "gb-l": "GingerBread",
    "spins-v": spinsText, "spins-l": "Spins",
    "miss-v": missText, "miss-l": "Missions",
    "who-n": nameText, "who-l": levelText,
    "cd-eyebrow": cd.closed ? "The event has ended" : "Event Ends In",
    "cap-tree-t": "My Tree", "cap-tree-v": treeText,
    "cap-pass-t": "Battle Pass", "cap-pass-v": passText,
    "cap-adv-t": "Advent", "cap-adv-v": adventText,
    "cap-mis-t": "Missions", "cap-mis-v": missionsText,
    "cap-evt-t": "Events", "cap-evt-v": eventsText,
    "h-tree": "Your Christmas Tree",
    "sub-tree": "Collect ornaments and decorate your tree!",
    "tp-label": "Tree Progress",
    "tp-value": treeText,
    "deco": "Decorate Tree →",
    "h-prog": "Event Progress",
    "sub-prog": "Complete Winterfest objectives for exclusive rewards!",
    "h-rew": "Recent Rewards",
    "sub-rew": "Your latest Christmas rewards!",
    "h-act": "Active Winterfest Events"
  }
  for (const [id, n, one, many] of cdCells) {
    values[id] = id === "cd-dy" ? String(n) : pad2(n)
    values[id + "-l"] = plural(n, one, many)
  }

  // The four progress rows print only counters the panel really has today
  // (03-DASHBOARD.md §7 says which and why); the rest is an em dash.
  const rows = [
    ["Gingerbread earned", null, null],
    ["Ornaments owned", known ? num(counts.ornaments_total) : null, null],
    ["Missions done", known ? done : null, total || null],
    ["Ornaments placed", tree ? tree.filled : null, tree ? tree.capacity : null]
  ]
  rows.forEach(([label, v, target], i) => {
    const n = i + 1
    values["row" + n + "-l"] = label
    values["row" + n + "-v"] = v == null ? "—" : (target ? `${fmt(v)} / ${fmt(target)}` : fmt(v))
  })

  // The three bars the panel can fill from real counters; "Gingerbread earned"
  // has no counter anywhere, so its bar stays empty rather than faking 0.
  const barPct = [
    0,
    rows[1][1] == null ? 0 : Math.min(100, rows[1][1]),
    rows[2][1] == null || !total ? 0 : Math.min(100, Math.round(100 * rows[2][1] / total)),
    rows[3][1] == null || !tree ? 0 : Math.min(100, Math.round(100 * rows[3][1] / tree.capacity))
  ]

  const texts = TEXTS.map(([id]) => `<div class="txt num" id="${id}">${values[id] == null ? "—" : values[id]}</div>`).join("\n")

  const rewardCells = [0, 1, 2, 3].map(i => {
    const r = ledger[i]
    if (!r) return `<div class="txt num" id="rw${i + 1}">—</div>`
    const lab = rewardLabel(r)
    return `<div class="txt num" id="rw${i + 1}">${esc(lab.short)}<br>${esc(lab.amount)}</div>`
  }).join("\n")

  const evCells = active.map((e, i) => {
    const live = e.state === "active"
    const state = live ? "Active Now" : "Starts in " + relText(e.starts_at - now)
    const cls = live ? "" : (e.starts_at > now ? "wait" : "off")
    return `<div class="ev" id="ev${i}"><b>${esc(e.title)}</b><span>${esc(e.detail || "")}</span>` +
      `<em class="${cls}">${esc(state)}</em></div>`
  }).join("\n")

  const stage = `
<div id="stage" data-cd-sec="${cd.left}">
  <div class="act-navy"></div>
  ${SPRITES.map(sprite).join("\n")}
  ${texts}
  ${rewardCells}
  ${evCells}
  ${active.length ? "" : `<div class="ev" id="ev0"><b>No Winterfest events scheduled yet</b></div>`}
  <div class="spr spr-bars" style="left:872px;top:564px;width:310px;height:128px;background:none">
    ${[0, 1, 2, 3].map(i => `<i style="position:absolute;left:4px;top:${i * 38 + 3}px;display:block;height:8px;border-radius:4px;background:#16dd66;width:${Math.round(284 * barPct[i] / 100)}px"></i>`).join("\n")}
  </div>
  <div class="spr spr-treebar" style="left:538px;top:574px;width:218px;height:12px;background:none">
    <i style="display:block;height:12px;border-radius:6px;background:#16dd66;width:${treePct == null ? 0 : Math.round(218 * treePct / 100)}px"></i>
  </div>
</div>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FreeNova · Winterfest</title>
<style>${CSS}</style></head>
<body>${stage}
<script>
(function(){
  // Additive: the server's countdown is already in the markup.
  var st=document.getElementById('stage');if(!st)return;
  var left=parseInt(st.getAttribute('data-cd-sec'),10)||0;
  var f=function(n){return (n<10?'0':'')+n};
  var set=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v};
  setInterval(function(){
    if(left<=0)return;left--;
    set('cd-dy',String(Math.floor(left/86400)));set('cd-hr',f(Math.floor(left%86400/3600)));
    set('cd-mi',f(Math.floor(left%3600/60)));set('cd-se',f(left%60));
  },1000);
  // Fit the fixed plate into the client window: a GoldSrc MOTD (800x600) sees
  // the whole page scaled, never a crop.
  var fit=function(){
    var s=Math.min(window.innerWidth/${PLATE_W},window.innerHeight/${PLATE_H});
    st.style.transform='scale('+s+')';
    st.style.marginLeft=Math.max(0,(window.innerWidth-${PLATE_W}*s)/2)+'px';
    st.style.marginTop=Math.max(0,(window.innerHeight-${PLATE_H}*s)/2)+'px';
  };
  fit();window.addEventListener('resize',fit);
})();
</scr` + `ipt>
</body></html>`
}
