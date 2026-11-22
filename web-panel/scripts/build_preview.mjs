// Build modern_web_preview.html from the exact worker CSS, rank SVGs, and
// the same profile derivation used by pages.js (no mock CS2 ranks).
import { readFileSync, writeFileSync, readdirSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { DEFAULT_REWARD_TRACK } from "../src/catalogs.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ui = readFileSync(join(root, "src/ui.js"), "utf8")
const styleMatch = ui.match(/<style>([\s\S]*?)<\/style>/)
if (!styleMatch) throw new Error("could not extract ui.js CSS")
const css = styleMatch[1]

function toDataUri(path) {
  const b64 = readFileSync(path).toString("base64")
  const lower = path.toLowerCase()
  const mime = lower.endsWith(".png") ? "image/png"
    : (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) ? "image/jpeg"
    : "image/svg+xml"
  return `data:${mime};base64,` + b64
}
const logoUri = toDataUri(join(root, "assets/logo_nav.png"))
const rankUri = {}
for (const f of readdirSync(join(root, "assets/ranks"))) {
  if (f.endsWith(".png") && /^rank_\d\d\.png$/.test(f)) rankUri[f] = toDataUri(join(root, "assets/ranks", f))
}
const medalUriMap = {}
for (const f of readdirSync(join(root, "assets/medals"))) {
  if (f.startsWith("fn_") && f.endsWith(".png") && !f.startsWith("fn_badge_")) medalUriMap[f] = toDataUri(join(root, "assets/medals", f))
}
const gunUri = {}
const trophyUri = {}
const pixelUri = {}
const missionUri = {}
for (const f of readdirSync(join(root, "assets/i"))) {
  if (f.startsWith("gun_") && f.endsWith(".png")) gunUri[f] = toDataUri(join(root, "assets/i", f))
  if (/^trophy_[123]\.png$/.test(f)) trophyUri[f] = toDataUri(join(root, "assets/i", f))
}
const badgeUri = toDataUri(join(root, "assets/badges/generic.svg"))
const medalUri = medalUriMap["fn_kills_100.png"] || toDataUri(join(root, "assets/medals/generic.svg"))

const RANKS = [
  "Unranked", "Silver I", "Silver II", "Silver III", "Silver IV", "Silver Elite",
  "Silver Elite Master", "Gold Nova I", "Gold Nova II", "Gold Nova III", "Gold Nova Master",
  "Master Guardian", "Master Guardian II", "Master Guardian Elite", "Distinguished Master Guardian",
  "Legendary Eagle", "Legendary Eagle Master", "Supreme Master First Class", "Global Elite"
]
const RANK_XP = [
  0, 2816, 3730, 4207, 4698, 4999, 5622, 6492, 7416, 8376, 9348,
  9999, 10894, 12013, 13088, 14187, 15495, 18006, 30000
]
const THRESH = [0, 50, 150, 300, 500, 750, 1100, 1500, 2000, 2600, 3300, 4100, 5000, 6000, 7200, 8500, 10000]
const SHOWCASE = [
  { id: "kills_100", title: "FIRST BLOOD CENTURY", rarity: "COMMON", type: "BADGE", field: "kills", target: 100, ap: 50, desc: "Record 100 ranked kills." },
  { id: "kills_1000", title: "KILLING MACHINE", rarity: "UNCOMMON", type: "BADGE", field: "kills", target: 1000, ap: 100, desc: "Record 1,000 ranked kills." },
  { id: "kills_5000", title: "FREENOVA LEGEND", rarity: "EPIC", type: "MEDAL", field: "kills", target: 5000, ap: 200, desc: "Record 5,000 ranked kills." },
  { id: "kills_10000", title: "TEN THOUSAND FRAGS", rarity: "LEGENDARY", type: "MEDAL", field: "kills", target: 10000, ap: 400, desc: "Record 10,000 ranked kills." },
  { id: "hs_100", title: "SHARPSHOOTER", rarity: "COMMON", type: "BADGE", field: "headshots", target: 100, ap: 50, desc: "Land 100 ranked headshots." },
  { id: "hs_500", title: "HEAD HUNTER", rarity: "RARE", type: "BADGE", field: "headshots", target: 500, ap: 100, desc: "Land 500 ranked headshots." },
  { id: "wins_100", title: "TEAM PLAYER", rarity: "UNCOMMON", type: "BADGE", field: "wins", target: 100, ap: 100, desc: "Win 100 rounds." },
  { id: "mvp_50", title: "ROUND ACE", rarity: "RARE", type: "BADGE", field: "mvps", target: 50, ap: 100, desc: "Earn 50 round MVPs." },
  { id: "hours_100", title: "VETERAN", rarity: "RARE", type: "MEDAL", field: "hours", target: 100, ap: 200, desc: "Play 100 hours on FreeNova." },
  { id: "hours_500", title: "LIFETIME", rarity: "LEGENDARY", type: "MEDAL", field: "hours", target: 500, ap: 400, desc: "Play 500 hours on FreeNova." },
  { id: "rank_max", title: "GLOBAL ELITE", rarity: "LEGENDARY", type: "MEDAL", field: "level", target: 18, ap: 400, desc: "Reach Private Rank Global Elite." },
  { id: "ak_spec", title: "AK SPECIALIST", rarity: "RARE", type: "BADGE", slot: 0, target: 500, ap: 100, desc: "500 AK-47 ranked kills." },
  { id: "ak_master", title: "AK MASTER", rarity: "LEGENDARY", type: "MEDAL", slot: 0, target: 10000, ap: 400, desc: "10,000 AK-47 ranked kills." }
]
const RARITY_COLOR = { COMMON: "#94a3b8", UNCOMMON: "#22c55e", RARE: "#38bdf8", EPIC: "#a855f7", LEGENDARY: "#f59e0b" }
const WEAPONS = [
  "AK-47", "M4A1", "AWP", "Desert Eagle", "Knife", "USP", "Glock-18",
  "FAMAS", "Galil", "Scout", "AUG", "SG-552", "MP5 Navy", "P90", "UMP-45",
  "MAC-10", "TMP", "M249", "M3", "XM1014", "SG-550", "G3-SG1", "HE Grenade"
]
const GUN_PIXEL = [
  "wpn_011", "wpn_012", "cmb_034", "wpn_023", "wpn_031", "wpn_021", "wpn_022",
  "wpn_013", "wpn_014", "wpn_018", "wpn_015", "wpn_016", "wpn_017", "wpn_026", "wpn_027",
  "wpn_025", "wpn_025", "wpn_019", "wpn_020", "wpn_028", "cmb_025", "cmb_034", "wpn_035"
]
const NEED_PIXEL = new Set([...GUN_PIXEL, "cmb_002", "cmb_048", "wpn_042", "cmb_010", "cmb_004", "cmb_076", "cmb_008"])
for (const key of NEED_PIXEL) {
  const f = key + ".png"
  const fp = join(root, "assets/i", f)
  try { pixelUri[f] = toDataUri(fp) } catch {}
}
for (const f of ["mi_021.png", "mi_053.png"]) {
  try { missionUri[f] = toDataUri(join(root, "assets/missions", f)) } catch {}
}
const BP_SHOP_URL = "https://discord.gg/dqrWHhQykp"

function num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0 }
function fmt(n) { return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") }
function pct(part, whole) { return num(whole) ? Math.min(100, Math.max(0, Math.floor((num(part) * 100) / num(whole)))) : 0 }
function kdStr(k, d) { return num(d) ? (num(k) / num(d)).toFixed(2) : fmt(k) }
function ratingStr(x100) { return (num(x100) / 100).toFixed(2) }
function vipName(t) { return t === 3 ? "VIP Elite" : t === 2 ? "VIP+" : t === 1 ? "VIP" : "None" }
function skillName(r) {
  const x = num(r)
  const t = [[80, "Rookie"], [100, "Developing"], [115, "Average"], [130, "Skilled"], [150, "Advanced"], [175, "Elite"], [200, "Master"], [250, "Champion"]]
  for (const [m, n] of t) if (x < m) return n
  return "Global"
}
function rankProgress(curXp, rankId) {
  const curIdx = Math.min(Math.max(num(rankId), 1), RANKS.length) - 1
  const nextIdx = Math.min(curIdx + 1, RANKS.length - 1)
  const baseReq = RANK_XP[curIdx], nextReq = RANK_XP[nextIdx]
  const isMax = curIdx >= RANKS.length - 1 || curXp >= RANK_XP[RANK_XP.length - 1]
  const span = Math.max(1, nextReq - baseReq)
  const earned = Math.max(0, curXp - baseReq)
  const remaining = Math.max(0, nextReq - curXp)
  const progressPct = isMax ? 100 : Math.min(100, Math.max(0, Math.round((earned / span) * 100)))
  return { curName: RANKS[curIdx], nextName: RANKS[nextIdx], isMax, nextReq, remaining, progressPct }
}
function weaponMastery(kills) {
  const k = Math.max(0, num(kills))
  let lvl = 1
  for (let i = 0; i < THRESH.length; i++) {
    if (k >= THRESH[i]) lvl = i + 1
    else break
  }
  const isMax = lvl >= THRESH.length
  const curReq = THRESH[lvl - 1] || 0
  const nextReq = isMax ? curReq : (THRESH[lvl] || curReq)
  const span = Math.max(1, nextReq - curReq)
  const earned = Math.max(0, k - curReq)
  return { level: lvl, isMax, remaining: Math.max(0, nextReq - k), progressPct: isMax ? 100 : Math.min(100, Math.round((earned / span) * 100)), max: THRESH.length }
}
function rankSrc(id) {
  const n = String(Math.min(Math.max(num(id) || 1, 1), 19)).padStart(2, "0")
  return rankUri[`rank_${n}.png`] || badgeUri
}
function emblemBox(name, faded, rankId, size) {
  const src = rankId ? rankSrc(rankId) : badgeUri
  const cls = faded ? "rank-img faded" : (size === "lg" ? "rank-img-lg" : "rank-img")
  const n = String(Math.min(Math.max(num(rankId) || 1, 1), 19)).padStart(2, "0")
  const wrap = ["rank-anim", "rank-a-" + n, size === "lg" ? "rank-anim-lg" : "", faded ? "faded" : ""].filter(Boolean).join(" ")
  const wh = size === "lg" ? 148 : 56
  const shine = faded ? "" : `<i class='icon-shine' style='-webkit-mask-image:url(${src});mask-image:url(${src})'></i>`
  return `<span class='${wrap}'><img class='${cls}' src='${src}' width='${wh}' height='${wh}' alt='${esc(name || "")}'>${shine}</span>`
}
const showIds = SHOWCASE.map(s => s.id)
function passMedal(n) {
  const id = showIds[(Math.max(1, num(n)) - 1) % showIds.length]
  return medalUriMap[`fn_${id}.png`] || medalUri
}
function medalSrc(item) {
  if (item && item.id && medalUriMap[`fn_${item.id}.png`]) return medalUriMap[`fn_${item.id}.png`]
  if (item && item.id && medalUriMap[`fn_${item.id}.svg`]) return medalUriMap[`fn_${item.id}.svg`]
  return medalUri
}
function gunIcon(slot) {
  const pixel = GUN_PIXEL[num(slot)]
  const src = (pixel && pixelUri[pixel + ".png"]) || gunUri["gun_ak47.png"] || ""
  return `<img class='gun-img' src='${src}' width='56' height='56' alt=''>`
}
function trophyImg(place) {
  const src = trophyUri["trophy_" + place + ".png"] || ""
  return src ? `<img class='trophy' src='${src}' width='28' height='28' alt='#${place}'>` : `#${place}`
}
function msnIco(path) {
  if (path.startsWith("/missions/")) return missionUri[path.slice("/missions/".length)] || ""
  if (path.startsWith("/i/")) return pixelUri[path.slice("/i/".length)] || ""
  return ""
}
function tipCard(item) {
  const pctDone = item.target ? Math.min(100, Math.round((item.val / item.target) * 100)) : 0
  const src = medalSrc(item)
  const cls = item.unlocked ? "medal-img" : "medal-img faded"
  const mid = item && item.id ? String(item.id).replace(/[^a-z0-9_]/gi, "") : "generic"
  const wrap = ["medal-anim", "medal-" + mid, item.unlocked ? "" : "faded"].filter(Boolean).join(" ")
  const shine = item.unlocked ? `<i class='icon-shine' style='-webkit-mask-image:url(${src});mask-image:url(${src})'></i>` : ""
  return `<span class='tip'><span class='${wrap}'><img class='${cls}' src='${src}' width='64' height='64' alt='${esc(item.title)}'>${shine}</span>
    <span class='tipc'>
      <div class='tt'>${esc(item.title)}</div>
      <div class='tr' style='color:${item.color}'>${esc(item.rarity)} ${esc(item.type)}</div>
      <div class='td'>${esc(item.desc)}</div>
      <div class='td' style='margin-top:8px;'>Requirement: <b style='color:#fff'>${fmt(item.target)}</b></div>
      <div class='td'>Progress: <b style='color:#fff'>${fmt(item.val)} / ${fmt(item.target)}</b> (${pctDone}%)</div>
      <div class='td'>Achievement Points: <b style='color:var(--gold)'>+${item.ap} AP</b></div>
      <div class='td' style='margin-top:6px;'>${item.unlocked ? "<span class='green'>OWNED</span>" : "<span class='muted'>LOCKED — still earnable</span>"}</div>
    </span></span>`
}

// Snapshot of a veteran that the plugins would actually produce.
const p = {
  steamid: "STEAM_0:1:12345678",
  name: "zizouondc",
  xp: 15495,
  rank_id: 17,
  level: 17,
  prestige: 0,
  kills: 5120,
  deaths: 2890,
  assists: 840,
  headshots: 1840,
  damage: 412000,
  shots: 98000,
  hits: 27400,
  mvps: 64,
  wins: 118,
  losses: 91,
  playtime_minutes: 6120,
  rating_x100: 187,
  vip_tier: 2,
  coins: 18420,
  eq_title: 5,
  custom_tag: "",
  eq_model: "",
  last_seen: Math.floor(Date.now() / 1000) - 120,
  comp_season: "2026-09",
  comp_points: 1840,
  comp_kills: 890,
  comp_hs: 310,
  comp_wins: 42,
  comp_mvp: 11,
  bp_daily_kills: 11, bp_daily_hs: 2, bp_daily_plants: 1, bp_daily_defuses: 0, bp_daily_wins: 1,
  bp_daily_streak: 4, bp_daily_damage: 380, bp_daily_survives: 2, bp_daily_complete: 0,
  bp_weekly_kills: 64, bp_weekly_hs: 18, bp_weekly_plants: 6, bp_weekly_wins: 9, bp_weekly_complete: 0,
  comp_msn_k: 18, comp_msn_h: 11, comp_msn_w: 6, comp_msn_m: 2, comp_msn_done: 0
}
const wpKnown = {
  0: { slot: 0, kills: 1840, hs: 710, damage: 148000 },
  1: { slot: 1, kills: 960, hs: 310, damage: 72000 },
  2: { slot: 2, kills: 410, hs: 90, damage: 38000 },
  3: { slot: 3, kills: 540, hs: 290, damage: 41000 }
}
const wpRows = WEAPONS.map((_, slot) => wpKnown[slot] || { slot, kills: 0, hs: 0, damage: 0 })
const hours = Math.floor(p.playtime_minutes / 60)
const items = SHOWCASE.map(def => {
  const val = def.slot != null ? (wpRows.find(w => w.slot === def.slot)?.kills || 0)
    : def.field === "hours" ? hours : num(p[def.field])
  return { ...def, val, unlocked: val >= def.target, color: RARITY_COLOR[def.rarity], art: medalSrc(def) }
})
const earnedAP = items.filter(i => i.unlocked).reduce((s, i) => s + i.ap, 0)
const featured = items.filter(i => i.unlocked).slice(0, 5)
const rp = rankProgress(p.xp, p.rank_id)
const online = true
const activeTitle = "IMMORTAL"
const vipLabel = vipName(p.vip_tier)
const unlockedN = items.filter(i => i.unlocked).length
const unlockPct = pct(unlockedN, items.length)
const seasonRows = [
  { season: "2026-07", points: 920, wins: 18, mvp: 4 },
  { season: "2026-08", points: 1410, wins: 31, mvp: 8 },
  { season: "2026-09", points: p.comp_points, wins: p.comp_wins, mvp: p.comp_mvp }
]
const topWeapons = wpRows.map(w => {
  const wm = weaponMastery(w.kills)
  return { name: WEAPONS[w.slot], mastery: wm.level, max: wm.max, kills: w.kills, hsPct: pct(w.hs, w.kills), progressPct: wm.progressPct, isMax: wm.isMax }
})

function weaponCards() {
  return topWeapons.filter(w => w.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, 3).map(w => `
    <div style='display:flex;align-items:center;justify-content:space-between;background:rgba(10,18,30,0.7);border:1px solid rgba(56,189,248,0.14);border-radius:8px;padding:8px 12px;margin-bottom:8px;'>
      <div style='display:flex;align-items:center;gap:12px;'>
        ${gunIcon(WEAPONS.indexOf(w.name))}
        <div>
          <div style='font-family:var(--font-heading);font-size:14px;font-weight:800;color:#fff;'>${esc(w.name)}</div>
          <div style='font-size:11px;color:var(--text-dim);'>Mastery <b style='color:var(--gold);'>${w.mastery}</b> · ${fmt(w.kills)} kills · ${w.hsPct}% HS</div>
        </div>
      </div>
      <div style='text-align:right;min-width:90px;'>
        <div style='font-size:11px;color:var(--text-dim);margin-bottom:4px;'>${w.isMax ? "MAX" : w.mastery + " / " + w.max}</div>
        <div style='background:rgba(255,255,255,0.08);height:5px;border-radius:3px;overflow:hidden;width:90px;'>
          <div style='background:linear-gradient(90deg,var(--gold),#f59e0b);height:100%;width:${w.progressPct}%;'></div>
        </div>
      </div>
    </div>`).join("")
}
function profileSub(active) {
  const tabs = [
    ["overview", "OVERVIEW", "profile"],
    ["stats", "STATS", "pstats"],
    ["mastery", "MASTERY", "pmastery"],
    ["achievements", "ACHIEVEMENTS", "pachievements"],
    ["missions", "MISSIONS", "pmissions"],
    ["seasons", "SEASONS", "pseasons"],
    ["tournaments", "TOURNAMENTS", "ptournaments"]
  ]
  return tabs.map(([key, label, pane]) => key === active
    ? `<span style='padding:8px 18px;background:rgba(56,189,248,0.22);border:1px solid var(--cyan);color:#fff;font-family:var(--font-heading);font-size:13px;font-weight:800;letter-spacing:1px;border-radius:6px;box-shadow:0 0 14px var(--cyan-glow);'>${label}</span>`
    : `<a href='#${pane}' data-pane='${pane}' style='padding:8px 16px;color:var(--text-muted);font-family:var(--font-heading);font-size:13px;font-weight:700;letter-spacing:1px;text-decoration:none;'>${label}</a>`).join("")
}
const subNav = profileSub("overview")
const featuredSlots = [0, 1, 2, 3, 4].map(i => featured[i] || null)
const featuredHtml = featuredSlots.map(b => b
  ? `<div class='csgo-medal-slot'>${tipCard(b)}</div>`
  : `<div class='csgo-medal-slot empty'></div>`
).join("")
const hsPct = pct(p.headshots, p.kills)
const winPct = pct(p.wins, p.wins + (p.losses || 0))
const masteryTop = topWeapons[0]
const bpLevel = Math.max(1, Math.min(60, Math.floor(p.xp / 1000) + 1))

const body = `
  <div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${subNav}</div>
  <div class='csgo-hud-card'>
    <div class='csgo-hud-header'>
      <div class='csgo-hud-player'>
        <div class='csgo-avatar'>
          ${emblemBox(rp.curName, false, p.rank_id)}
          <span class='lvl'>${fmt(p.level)}</span>
        </div>
        <div>
          <div style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;'>
            <span style='width:8px;height:8px;background:var(--lime);border-radius:50%;display:inline-block;'></span>
            <span style='font-size:10px;font-weight:800;color:var(--lime);letter-spacing:1px;'>ONLINE</span>
            <span style='font-family:var(--font-heading);font-size:26px;font-weight:800;color:#fff;'>${esc(p.name)}</span>
          </div>
          <div style='margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;'>
            <span class='tier-badge tier-gold'>${esc(activeTitle)}</span>
            <span class='badge vip'>${esc(vipLabel)}</span>
          </div>
          <div style='font-size:11px;color:var(--text-muted);margin-top:4px;'>${esc(p.steamid)} · ${fmt(earnedAP)} AP · Season ${esc(p.comp_season)} · BP ${fmt(bpLevel)}</div>
        </div>
      </div>
      <div class='csgo-featured'>${featuredHtml}</div>
    </div>
    <div class='csgo-hud-body'>
      <div class='csgo-hud-rank-panel'>
        ${emblemBox(rp.curName, false, p.rank_id, "lg")}
        <div class='csgo-rank-title'>Private Rank ${fmt(p.rank_id)}</div>
        <div style='font-family:var(--font-heading);font-size:18px;font-weight:800;color:var(--cyan);margin:-4px 0 8px;'>${esc(rp.curName)}</div>
        <div style='display:flex;justify-content:space-between;font-size:12px;margin:6px 0 4px;'>
          <span style='font-family:var(--font-heading);font-weight:800;color:#fff;'>${fmt(p.xp)} / ${fmt(rp.nextReq)} XP</span>
          <span style='color:var(--text-dim);'>${rp.isMax ? "MAX RANK" : "+" + fmt(rp.remaining) + " XP to next rank"}</span>
        </div>
        <div style='background:rgba(255,255,255,0.08);height:8px;border-radius:4px;overflow:hidden;'>
          <div style='background:linear-gradient(90deg,var(--cyan),#0284c7);height:100%;width:${rp.progressPct}%;'></div>
        </div>
        <div class='csgo-commend'>
          <div class='csgo-commend-item'><div class='k'>MVPs</div><div class='v'>${fmt(p.mvps)}</div></div>
          <div class='csgo-commend-item'><div class='k'>Assists</div><div class='v'>${fmt(p.assists)}</div></div>
          <div class='csgo-commend-item'><div class='k'>Wins</div><div class='v'>${fmt(p.wins)}</div></div>
        </div>
      </div>
      <div class='csgo-hud-rating-panel'>
        <div style='font-size:10px;color:var(--text-dim);letter-spacing:1.2px;text-transform:uppercase;'>Competitive</div>
        <div class='csgo-rank-title'>${esc(skillName(p.rating_x100))}</div>
        <div style='font-family:var(--font-heading);font-size:28px;font-weight:800;color:var(--cyan);'>${ratingStr(p.rating_x100)}</div>
        <div class='csgo-esports-grid'>
          <div class='csgo-metric'><div class='k'>Rating</div><div class='v'>${ratingStr(p.rating_x100)}</div></div>
          <div class='csgo-metric'><div class='k'>K/D</div><div class='v'>${kdStr(p.kills, p.deaths)}</div></div>
          <div class='csgo-metric'><div class='k'>HS%</div><div class='v'>${hsPct}%</div></div>
          <div class='csgo-metric'><div class='k'>Win %</div><div class='v'>${winPct}%</div></div>
          <div class='csgo-metric'><div class='k'>MVPs</div><div class='v'>${fmt(p.mvps)}</div></div>
          <div class='csgo-metric'><div class='k'>Frags</div><div class='v'>${fmt(p.kills)}</div></div>
        </div>
      </div>
    </div>
    <div class='csgo-hud-bottom'>
      <div class='card' style='margin:0;'>
        <div class='h2'>BATTLE PASS</div>
        <div style='font-family:var(--font-heading);font-size:16px;font-weight:800;color:#fff;margin-bottom:4px;'>Tier ${fmt(bpLevel)}</div>
        <div class='muted' style='font-size:11px;'>${p.vip_tier > 0 ? "PREMIUM TRACK" : "FREE TRACK"} · Season ${esc(p.comp_season)}</div>
        <div class='bar' style='margin-top:8px;'><div style='width:${pct(p.xp % 1000, 1000)}%'></div></div>
        <p class='muted' style='margin-top:8px;'>Highest reached reward: <b style='color:var(--gold);'>Double Jump Perk</b></p>
      </div>
      <div class='card' style='margin:0;'>
        <div class='h2'>ACTIVE MISSIONS</div>
        <div style='margin-bottom:8px;'><div style='display:flex;justify-content:space-between;font-size:11px;'><span>STREAK</span><span>4 / 5</span></div><div class='bar'><div style='width:80%'></div></div></div>
        <div style='margin-bottom:8px;'><div style='display:flex;justify-content:space-between;font-size:11px;'><span>DAMAGE</span><span>380 / 500</span></div><div class='bar'><div style='width:76%'></div></div></div>
        <div><div style='display:flex;justify-content:space-between;font-size:11px;'><span>HEAD HUNTER</span><span>2 / 3</span></div><div class='bar'><div style='width:66%'></div></div></div>
      </div>
      <div class='card' style='margin:0;'>
        <div class='h2'>WEAPON MASTERY</div>
        ${weaponCards()}
      </div>
    </div>
  </div>
  <div style='display:flex;justify-content:space-between;align-items:center;padding:14px 4px;font-size:11px;color:var(--text-dim);'>
    <div style='display:flex;align-items:center;gap:8px;'><img class='brand-logo-img' src='${logoUri}' alt='FreeNova' width='28' height='28'><span>Free<span style='color:var(--cyan);'>Nova</span></span></div>
    <div>${fmt(unlockedN)} / ${items.length} medals · ${unlockPct}%</div>
  </div>`


const NAV = [
  ["home", "PLAY"],
  ["profile", "PROFILE"],
  ["top", "LEADERBOARDS"],
  ["bp", "BATTLE PASS"],
  ["missions", "MISSIONS"],
  ["achievements", "ACHIEVEMENTS"],
  ["tournament", "TOURNAMENT"],
  ["store", "SHOP"],
  ["events", "EVENTS"]
]

function paneNav(active) {
  return `<div class='nav' style='background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.2);padding:8px 14px;border-radius:10px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;'>
    <div style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;'>
      <img class='brand-logo-img' src='${logoUri}' alt='FreeNova' width='32' height='32'>
      <span style='font-family:var(--font-heading);font-size:22px;font-weight:900;color:#fff;letter-spacing:1px;margin-right:8px;'>Free<span style='color:var(--cyan);'>Nova</span></span>
      ${NAV.map(([id, label]) => id === active
        ? `<span class='nav-a' style='padding:6px 12px;border-radius:6px;background:rgba(56,189,248,0.18);border:1px solid var(--cyan);color:var(--cyan);font-weight:800;font-size:11px;'>${label}</span>`
        : `<a href='#${id}' data-pane='${id}' style='padding:6px 12px;color:var(--text-muted);font-weight:700;font-size:11px;text-decoration:none;border-radius:6px;text-transform:uppercase;'>${label}</a>`).join("")}
    </div>
    <span style='font-family:var(--font-heading);font-size:9.5px;letter-spacing:1.5px;color:var(--text-dim);'>PLAY • CONNECT • BELONG</span>
  </div>`
}

function card(title, inner) {
  return `<div class='card'><div class='h2'>${title}</div>${inner}</div>`
}

function table(headers, rows) {
  return `<table class='t'><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>${rows}</table>`
}

// -------------------- home
const paneHome = `
${paneNav("home")}
<div class='card ok'><div class='h2'>FREENOVA PLATFORM</div>
  <p class='muted'>One progression system. One currency. One inventory. This offline file is built from the live worker CSS, rank SVGs, and the same showcase / mastery math the game pushes to D1.</p></div>
<div class='card'><div class='h2'>PANELS IN THIS FILE</div>
  ${table(["Panel", "Opens"], NAV.map(([id, label]) => `<tr><td class='k'>${label}</td><td><a href='#${id}' data-pane='${id}'>#${id}</a></td></tr>`).join(""))}
</div>
<div class='card'><div class='h2'>THIS SNAPSHOT</div>
  ${table(["Field", "Value"], [
    ["Player", p.name],
    ["Private Rank", rp.curName],
    ["XP", fmt(p.xp) + " / " + fmt(rp.nextReq)],
    ["VIP", vipLabel],
    ["Coins", fmt(p.coins)],
    ["AP", fmt(earnedAP)],
    ["Season", p.comp_season]
  ].map(([k, v]) => `<tr><td class='k'>${k}</td><td class='v'>${esc(v)}</td></tr>`).join(""))}
</div>`

const profileInner = paneNav("profile") + body

function metricGrid(rows) {
  return `<div class='csgo-esports-grid'>${rows.map(([k, v]) =>
    `<div class='csgo-metric'><div class='k'>${esc(k)}</div><div class='v'>${v}</div></div>`
  ).join("")}</div>`
}
function missionCard(m) {
  const have = num(m.val)
  const need = num(m.target)
  const done = m.forced != null ? !!m.forced : have >= need
  const src = msnIco(m.icon)
  return `<article class='msn-card ${esc(m.kind || "daily")}${done ? " done" : ""}'>
    <div class='msn-head'>
      <span class='msn-ico-wrap'><img class='msn-ico' src='${src}' width='44' height='44' alt=''></span>
      <div>
        <div class='msn-title'>${esc(m.title)}</div>
        <div class='msn-desc'>${esc(m.desc)}</div>
      </div>
    </div>
    <div class='bar'><div style='width:${pct(have, need)}%'></div></div>
    <div class='msn-meta'><span>${fmt(Math.min(have, need))} / ${fmt(need)}</span><span>${pct(have, need)}%</span></div>
    <div class='msn-rew'>${esc(m.reward)}</div>
    <div class='msn-meta'><span>${esc(m.diff || "MEDIUM")}</span><span>${done ? "✓ COMPLETED" : esc(m.remaining || "")}</span></div>
    <details><summary>Details</summary>
      <div class='msn-detail'>What counts: <b>${esc(m.desc)}</b><br>Reward claimed in-game. The web never grants coins.</div>
    </details>
  </article>`
}
const dailyMs = [
  { title: "FRAG HUNTER", desc: "Get 15 ranked kills", val: p.bp_daily_kills, target: 15, reward: "+500 XP", kind: "daily", icon: "/missions/mi_021.png", diff: "EASY", remaining: "Resets midnight" },
  { title: "HEAD HUNTER", desc: "Get 3 headshots", val: p.bp_daily_hs, target: 3, reward: "+500 XP", kind: "daily", icon: "/i/cmb_002.png", diff: "MEDIUM", remaining: "Resets midnight" },
  { title: "BOMB SQUAD", desc: "Plant the bomb 2 times", val: p.bp_daily_plants, target: 2, reward: "+500 XP", kind: "daily", icon: "/i/cmb_048.png", diff: "EASY", remaining: "Resets midnight" },
  { title: "DEFUSER", desc: "Defuse the bomb 1 time", val: p.bp_daily_defuses, target: 1, reward: "+500 XP", kind: "daily", icon: "/i/wpn_042.png", diff: "MEDIUM", remaining: "Resets midnight" },
  { title: "WINNER", desc: "Win 2 rounds", val: p.bp_daily_wins, target: 2, reward: "+500 XP", kind: "daily", icon: "/missions/mi_053.png", diff: "EASY", remaining: "Resets midnight" },
  { title: "STREAK", desc: "Reach a 5-kill streak", val: p.bp_daily_streak, target: 5, reward: "+150 Coins", kind: "daily", icon: "/i/cmb_010.png", diff: "HARD", remaining: "Resets midnight" },
  { title: "DAMAGE", desc: "Deal 500 damage", val: p.bp_daily_damage, target: 500, reward: "+100 Coins", kind: "daily", icon: "/i/cmb_004.png", diff: "MEDIUM", remaining: "Resets midnight" },
  { title: "SURVIVOR", desc: "Survive 3 rounds", val: p.bp_daily_survives, target: 3, reward: "+100 Coins", kind: "daily", icon: "/i/cmb_076.png", diff: "EASY", remaining: "Resets midnight" }
]
const weeklyMs = [
  { title: "WEEKLY FRAGS", desc: "Get 100 weekly kills", val: p.bp_weekly_kills, target: 100, reward: "+5000 XP", kind: "weekly", icon: "/missions/mi_021.png", diff: "HARD", remaining: "Resets Monday" },
  { title: "WEEKLY HEAD HUNTER", desc: "Get 25 weekly headshots", val: p.bp_weekly_hs, target: 25, reward: "+5000 XP", kind: "weekly", icon: "/i/cmb_002.png", diff: "HARD", remaining: "Resets Monday" },
  { title: "PLANTER", desc: "Plant the bomb 10 times", val: p.bp_weekly_plants, target: 10, reward: "+5000 XP", kind: "weekly", icon: "/i/cmb_048.png", diff: "MEDIUM", remaining: "Resets Monday" },
  { title: "MATCH WINNER", desc: "Win 15 rounds", val: p.bp_weekly_wins, target: 15, reward: "+1000 Coins", kind: "weekly", icon: "/missions/mi_053.png", diff: "HARD", remaining: "Resets Monday" }
]
const specialMs = [
  { title: "RIFLEMAN", desc: "25 competitive kills", val: p.comp_msn_k, target: 25, reward: "+120 pts", kind: "special", icon: "/i/wpn_011.png", remaining: "Resets midnight", forced: p.comp_msn_done & 1 },
  { title: "SHARPSHOOTER", desc: "20 competitive headshots", val: p.comp_msn_h, target: 20, reward: "+130 pts", kind: "special", icon: "/i/cmb_002.png", remaining: "Resets midnight", forced: p.comp_msn_done & 2 },
  { title: "WINNER", desc: "10 competitive round wins", val: p.comp_msn_w, target: 10, reward: "+100 pts", kind: "special", icon: "/missions/mi_053.png", remaining: "Resets midnight", forced: p.comp_msn_done & 4 },
  { title: "MVP", desc: "3 competitive MVP awards", val: p.comp_msn_m, target: 3, reward: "+150 pts", kind: "special", icon: "/i/cmb_008.png", remaining: "Resets midnight", forced: p.comp_msn_done & 8 }
]

const paneStats = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("stats")}</div>
<div class='csgo-hud-card'><div class='h2'>COMBAT RECORD</div>
<p class='muted'>${esc(p.name)} · ${esc(p.steamid)}</p>
<div class='csgo-hud-body'>
  <div class='csgo-hud-rank-panel'>
    <div class='csgo-rank-title'>${esc(skillName(p.rating_x100))}</div>
    <div style='font-family:var(--font-heading);font-size:28px;font-weight:800;color:var(--cyan);'>${ratingStr(p.rating_x100)}</div>
    ${metricGrid([["Kills", fmt(p.kills)], ["Deaths", fmt(p.deaths)], ["Assists", fmt(p.assists)], ["K/D", kdStr(p.kills, p.deaths)], ["Headshots", fmt(p.headshots)], ["HS%", hsPct + "%"]])}
  </div>
  <div class='csgo-hud-rating-panel'>
    <div class='csgo-rank-title'>ROUNDS</div>
    ${metricGrid([["Wins", fmt(p.wins)], ["Losses", fmt(p.losses || 0)], ["Win %", winPct + "%"], ["MVPs", fmt(p.mvps)], ["Damage", fmt(p.damage)]])}
  </div>
</div></div>`

const paneMastery = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("mastery")}</div>
<div class='csgo-hud-card'><div class='h2'>WEAPON MASTERY</div>
<p class='muted'>Hover a gun for stats. Click opens a locker only if mastery_skins.ini lists models for that gun.</p>
<div class='csgo-hud-bottom' style='grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-top:12px;'>${weaponCards()}</div></div>`

const paneAchInner = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("achievements")}</div>
<div class='csgo-hud-card'><div class='h2'>TROPHY CABINET</div>
<p class='muted'>${fmt(unlockedN)} / ${items.length} medals · ${fmt(earnedAP)} AP earned</p>
${metricGrid([["Unlocked", unlockedN + " / " + items.length], ["AP", fmt(earnedAP)], ["Completion", unlockPct + "%"]])}</div>
<div class='card'><div class='h2'>COMBAT</div><div class='csgo-featured-row'>${items.filter(i => i.slot == null && i.field !== "hours" && i.field !== "level").map(i => `<div class='csgo-medal-slot'>${tipCard(i)}</div>`).join("")}</div></div>
<div class='card'><div class='h2'>WEAPONS</div><div class='csgo-featured-row'>${items.filter(i => i.slot != null).map(i => `<div class='csgo-medal-slot'>${tipCard(i)}</div>`).join("")}</div></div>
<div class='card'><div class='h2'>PROGRESSION</div><div class='csgo-featured-row'>${items.filter(i => i.field === "hours" || i.field === "level").map(i => `<div class='csgo-medal-slot'>${tipCard(i)}</div>`).join("")}</div></div>`

const paneProfMissions = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("missions")}</div>
<div class='csgo-hud-card'><div class='h2'>MISSIONS OVERVIEW</div>
<p class='muted'>Active work now. Achievements are permanent. Battle Pass is the season track. Tournament is competitive events.</p>
<div class='msn-strip'><span class='chip'>Daily ${dailyMs.filter(m => num(m.val) >= m.target).length}/${dailyMs.length}</span><span class='chip'>Rewards auto-claim in game</span></div></div>
<div class='h2'>DAILY</div><div class='msn-grid'>${dailyMs.map(missionCard).join("")}</div>
<div class='h2' style='margin-top:16px;'>WEEKLY</div><div class='msn-grid'>${weeklyMs.map(missionCard).join("")}</div>
<div class='h2' style='margin-top:16px;'>SPECIAL</div><div class='msn-grid'>${specialMs.map(missionCard).join("")}</div>`

const paneSeasons = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("seasons")}</div>
<div class='csgo-hud-card'><div class='h2'>CURRENT SEASON ${esc(p.comp_season)}</div>
${metricGrid([["Points", fmt(p.comp_points)], ["Kills", fmt(p.comp_kills)], ["HS", fmt(p.comp_hs)], ["Wins", fmt(p.comp_wins)], ["MVP", fmt(p.comp_mvp)]])}</div>
<div class='h2' style='margin:14px 0 10px;'>SEASON ARCHIVE</div>
<div class='csgo-hud-bottom' style='grid-template-columns:repeat(auto-fill,minmax(260px,1fr));'>${seasonRows.map(s => `<div class='card' style='margin:0;'><div class='h2'>${esc(s.season)}</div>${metricGrid([["Points", fmt(s.points)], ["Wins", fmt(s.wins)], ["MVP", fmt(s.mvp)]])}</div>`).join("")}</div>`

const paneTournaments = paneNav("profile") + `<div style='display:flex;gap:4px;background:rgba(6,11,20,0.85);border:1px solid rgba(56,189,248,0.18);padding:4px;border-radius:8px;overflow-x:auto;margin-bottom:12px;'>${profileSub("tournaments")}</div>
<div class='csgo-hud-card'><div class='h2'>TOURNAMENT</div>
<p class='muted'>Season points drive the monthly board. Prize claims are server-locked once per season.</p>
${metricGrid([["Season", esc(p.comp_season)], ["Season points", fmt(p.comp_points)], ["Career points", fmt(p.comp_lifetime || 0)], ["Season wins", fmt(p.comp_wins)]])}</div>`

const paneCollection = ""
const paneHistory = ""

// -------------------- leaderboard
const field = [
  { name: "nova", xp: 18006, rank_id: 18, kills: 7200, deaths: 3100, hs: 2400, rating: 214, wins: 160, mvps: 90, coins: 22000, ap: 1400, steamid: "STEAM_0:0:111" },
  { name: p.name, xp: p.xp, rank_id: p.rank_id, kills: p.kills, deaths: p.deaths, hs: p.headshots, rating: p.rating_x100, wins: p.wins, mvps: p.mvps, coins: p.coins, ap: earnedAP, steamid: p.steamid },
  { name: "ghost", xp: 12013, rank_id: 14, kills: 2800, deaths: 1900, hs: 900, rating: 149, wins: 70, mvps: 22, coins: 6400, ap: 400, steamid: "STEAM_0:1:222" },
  { name: "aimbotno", xp: 9999, rank_id: 12, kills: 2100, deaths: 1700, hs: 700, rating: 128, wins: 51, mvps: 14, coins: 3100, ap: 250, steamid: "STEAM_0:0:333" },
  { name: "rookie", xp: 2816, rank_id: 2, kills: 40, deaths: 80, hs: 8, rating: 72, wins: 3, mvps: 0, coins: 120, ap: 0, steamid: "STEAM_0:1:444" }
]
const lbRows = field.map((r, i) => {
  const med = i < 3 ? trophyImg(i + 1) : `#${i + 1}`
  return `<tr class='${i < 3 ? "r" + (i + 1) : ""}'><td class='pos c'>${med}</td>
    <td class='player'><a href='#profile'>${esc(r.name)}</a></td>
    <td class='rankname'>${esc(RANKS[r.rank_id - 1])}</td>
    <td class='v'>${fmt(r.xp)}</td>
    <td class='v'>${fmt(r.kills)}</td>
    <td class='v'>${kdStr(r.kills, r.deaths)}</td>
    <td class='v'>${ratingStr(r.rating)}</td>
    <td class='v'>${fmt(r.ap)}</td></tr>`
}).join("")
const paneTop = `
${paneNav("top")}
<div class='card'><div class='h2'>TOP PLAYERS</div>
  <p class='muted'>Places 1–3 use the podium trophies. XP sits in the XP lane — Private Rank stays with the name.</p>
  <table class='t'>
    <colgroup><col class='pos'><col class='player'><col class='rank'><col class='num'><col class='num'><col class='num'><col class='num'><col class='num'></colgroup>
    <tr><th class='pos c'>#</th><th class='player'>Player</th><th>Private Rank</th><th class='v'>XP</th><th class='v'>Kills</th><th class='v'>K/D</th><th class='v'>Rating</th><th class='v'>AP</th></tr>
    ${lbRows}
  </table>
</div>`

// -------------------- battle pass (CS:GO Operation dual-track)
const trackTiers = DEFAULT_REWARD_TRACK.tiers || []
const xpPerTier = DEFAULT_REWARD_TRACK.xp_per_tier || 1000
const bpTier = Math.min(trackTiers.length, Math.max(1, Math.floor(p.xp / xpPerTier) + 1))
const bpInto = p.xp % xpPerTier
const bpNeed = xpPerTier
function passState(n) {
  if (n < bpTier) return "claimed"
  if (n === bpTier) return "current"
  return "locked"
}
const paneBp = `
${paneNav("bp")}
<div class='csgo-pass'>
  <div class='csgo-pass-layout'>
    <div class='csgo-pass-left'>
      <div class='op-kicker'>OPERATION</div>
      <div class='op-title'>CYBER GENESIS</div>
      <div class='op-art'><img src='${logoUri}' width='92' height='92' alt='FreeNova'></div>
      <a class='btn-bp' href='${BP_SHOP_URL}' target='_blank' rel='noopener'>Buy Battle Pass</a>
      <div class='op-meta'>Season ${esc(DEFAULT_REWARD_TRACK.season || "1")} · ${esc(p.name)}</div>
      <div class='op-meta'>Premium track unlocked · ${fmt(p.coins)} coins</div>
      <div class='csgo-pass-xp'>
        <div style='font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;'>Pass level</div>
        <div class='lvl'>${fmt(bpTier)}</div>
        <div style='display:flex;justify-content:space-between;font-size:11px;margin:6px 0 4px;'>
          <span>${fmt(bpInto)} XP</span><span>${fmt(bpNeed - bpInto)} to next</span>
        </div>
        <div class='bar'><div style='width:${pct(bpInto, bpNeed)}%'></div></div>
      </div>
    </div>
    <div class='csgo-pass-track-wrap'>
      <div class='csgo-pass-track'>
        <div class='csgo-pass-rail premium'>Premium</div>
        <div class='csgo-pass-row'>${trackTiers.map((t, idx) => {
          const n = num(t.tier ?? idx + 1)
          return `<div class='csgo-pass-cell premium ${passState(n)}${t.milestone ? " milestone" : ""}'><span class='pass-medal pm-${(n - 1) % showIds.length}'></span><div class='nm'>${esc(t.premium || t.name)}</div><div class='rw'>VIP</div></div>`
        }).join("")}</div>
        <div class='csgo-pass-row csgo-pass-stars'>${trackTiers.map((t, idx) => {
          const n = num(t.tier ?? idx + 1)
          const st = n < bpTier ? "done" : (n === bpTier ? "now" : "")
          return `<div class='csgo-pass-star ${st}'>${n}</div>`
        }).join("")}</div>
        <div class='csgo-pass-row'>${trackTiers.map((t, idx) => {
          const n = num(t.tier ?? idx + 1)
          return `<div class='csgo-pass-cell ${passState(n)}${t.milestone ? " milestone" : ""}'><span class='pass-medal pm-${(n + 6) % showIds.length}'></span><div class='nm'>${esc(t.name || t.free)}</div><div class='rw'>${esc(t.free || "—")}</div></div>`
        }).join("")}</div>
        <div class='csgo-pass-rail free'>Free rewards</div>
      </div>
    </div>
  </div>
</div>
<p class='muted'>Live catalog · ${trackTiers.length} tiers · claim in-game with /bp.</p>`

// -------------------- missions
const paneMissions = `
${paneNav("missions")}
<div class='card'><div class='h2'>DAILY MISSIONS <span class='sub'>&nbsp;Resets midnight</span></div>
  <div class='msn-strip'><span class='chip'>${dailyMs.filter(m => num(m.val) >= m.target).length} / ${dailyMs.length} completed</span><span class='chip'>Rewards claimed in-game</span></div>
</div>
<div class='msn-grid'>${dailyMs.map(missionCard).join("")}</div>
<div class='h2' style='margin-top:16px;'>WEEKLY</div>
<div class='msn-grid'>${weeklyMs.map(missionCard).join("")}</div>
<div class='h2' style='margin-top:16px;'>SPECIAL</div>
<div class='msn-grid'>${specialMs.map(missionCard).join("")}</div>`

// -------------------- achievements
const paneAch = `
${paneNav("achievements")}
<div class='card ok'><div class='h2'>ACHIEVEMENT POINTS</div>
  <table class='t'><tr><td class='k'>Earned</td><td class='v' style='color:var(--gold);'>${fmt(earnedAP)} AP</td></tr>
  <tr><td class='k'>Unlocked</td><td class='v'>${unlockedN} / ${items.length}</td></tr></table>
  <p class='muted'>Hover a badge to see how you earn it. History and Collection were removed — this is the medals surface.</p></div>
<div class='card'><div class='h2'>BADGE CABINET</div>
  <div class='csgo-featured-row'>${items.map(i => `<div class='csgo-medal-slot'>${tipCard(i)}</div>`).join("")}</div>
</div>`

// -------------------- tournament
const paneTour = `
${paneNav("tournament")}
<div class='card'><div class='h2'>TOURNAMENT · ${esc(p.comp_season)}</div>
  ${table(["Field", "Value"], [
    ["Season points", fmt(p.comp_points)],
    ["Season kills", fmt(p.comp_kills)],
    ["Season HS", fmt(p.comp_hs)],
    ["Season wins", fmt(p.comp_wins)],
    ["Season MVP", fmt(p.comp_mvp)],
    ["Claim", "Once per season — server native fncomp_claim_season_prize"]
  ].map(([k, v]) => `<tr><td class='k'>${k}</td><td class='v'>${v}</td></tr>`).join(""))}
</div>
<div class='card'><div class='h2'>SEASON ARCHIVE</div>
  ${table(["Season", "Points", "Wins", "MVP"], seasonRows.map(s => `<tr><td>${esc(s.season)}</td><td class='v'>${fmt(s.points)}</td><td class='v'>${fmt(s.wins)}</td><td class='v'>${fmt(s.mvp)}</td></tr>`).join(""))}
</div>`

// -------------------- store
const skins = [
  { grp: "ak47", name: "AK47 Asiimov", price: 25000, vip: 0 },
  { grp: "ak47", name: "AK47 Neon Rider", price: 35000, vip: 1 },
  { grp: "m4a1", name: "M4A1 Howl", price: 25000, vip: 0 },
  { grp: "awp", name: "AWP Dragon Lore", price: 50000, vip: 2 },
  { grp: "deagle", name: "Deagle Blaze", price: 20000, vip: 0 }
]
const skills = [
  { name: "Multi-Jump", desc: "Mid-air leaps", cost: 2500, stage: "1 / 3" },
  { name: "Spawn HP Boost", desc: "Extra spawn HP", cost: 2000, stage: "0 / 3" },
  { name: "Vampire", desc: "Lifesteal on kill", cost: 4000, stage: "0 / 3" }
]
const paneStore = `
${paneNav("store")}
<div class='store-hero'>
  <div>
    <span class='tier-badge tier-radiant'>FREENOVA ARMORY</span>
    <h2 style='font-family:var(--font-heading);font-size:22px;font-weight:800;color:#fff;margin:8px 0 4px;'>STORE · COLLECTION IS OWNERSHIP · LOADOUT IS EQUIPPED</h2>
    <p class='muted'>Prices come from the game catalog. Web only queues; AMXX spends coins.</p>
  </div>
  <div class='store-hero-balance'>
    <div style='font-size:10px;color:var(--text-dim);text-transform:uppercase;'>${esc(p.name)}</div>
    <div style='font-family:var(--font-heading);font-size:22px;font-weight:800;color:var(--gold);'>${fmt(p.coins)}</div>
    <div style='font-size:10px;color:var(--text-muted);'>COINS · ${esc(vipLabel)}</div>
  </div>
</div>
<div class='card'><div class='h2'>WEAPON SKINS</div>
  <div class='store-grid'>
    ${skins.map(s => `<div class='store-card rarity-milspec'>
      <div class='store-card-header'><span class='tier-badge'>${esc(s.grp.toUpperCase())}</span>${s.vip ? "<span class='tier-badge tier-gold'>VIP</span>" : ""}</div>
      <div class='store-card-title'>${esc(s.name)}</div>
      <div class='store-card-footer'><div class='store-price'>${fmt(s.price)} COINS</div>
      <span class='btn-store ${s.vip && p.vip_tier < s.vip ? "btn-vip-req" : "btn-buy"}'>${s.vip && p.vip_tier < s.vip ? "VIP REQUIRED" : "BUY (in-game)"}</span></div>
    </div>`).join("")}
  </div>
</div>
<div class='card'><div class='h2'>COMBAT SKILLS</div>
  <div class='store-grid'>
    ${skills.map(s => `<div class='store-card rarity-legend'>
      <div class='store-card-title' style='color:var(--lime);'>${esc(s.name)}</div>
      <div class='store-card-sub'>${esc(s.desc)} · stage ${s.stage}</div>
      <div class='store-card-footer'><div class='store-price'>${fmt(s.cost)} COINS</div><span class='btn-store btn-buy'>UPGRADE</span></div>
    </div>`).join("")}
  </div>
</div>`

// -------------------- events
const paneEvents = `
${paneNav("events")}
<div class='card'><div class='h2'>EVENTS &amp; TOURNAMENTS</div>
  <p class='muted'>Click an event for details, prize box, and the board. Monthly competitive points stay on Tournament.</p>
</div>
<div class='evt-grid'>
  <a class='evt-card' href='#event-kill'><div class='h2' style='margin:0 0 6px;'>Kill Race: First to 1,000 Kills</div><div class='muted'>Lifetime kills on the replica.</div><div class='msn-rew'>10,000 Coins + 7 Days VIP ELITE</div></a>
  <a class='evt-card' href='#event-hs'><div class='h2' style='margin:0 0 6px;'>Headshot Frenzy Weekend</div><div class='muted'>Headshot count from live snapshots.</div><div class='msn-rew'>3,000 Coins + 1.5x XP Boost</div></a>
  <a class='evt-card' href='#event-obj'><div class='h2' style='margin:0 0 6px;'>Operation Objective Master</div><div class='muted'>C4 plants / defuses counted in-game.</div><div class='msn-rew'>5,000 Coins + Custom Chat Title</div></a>
</div>`
const paneEventKill = `
${paneNav("events")}
<div class='card'><a href='#events'>← All events</a><div class='h2'>Kill Race: First to 1,000 Kills</div><span class='badge done'>ACTIVE</span></div>
<div class='evt-layout'>
  <div>
    <div class='card'><div class='h2'>DETAILS</div><p>First player on the replica to 1,000 kills during the event window.</p>
      <table class='t'><tr><td class='k'>Metric</td><td class='v'>kills</td></tr><tr><td class='k'>Target</td><td class='v'>1,000</td></tr></table></div>
    <div class='card'><div class='h2'>REWARDS</div><div class='msn-rew'>10,000 Coins</div><div class='msn-rew'>7 Days VIP ELITE</div></div>
  </div>
  <div class='evt-side'>
    <div class='card'><div class='h2'>TOP PLAYERS</div>
      <table class='t'><tr><th>#</th><th>Player</th><th class='v'>KILLS</th></tr>
      ${field.slice(0, 5).map((r, i) => `<tr><td class='pos c'>${i + 1}</td><td>${esc(r.name)}</td><td class='v'>${fmt(r.kills)}</td></tr>`).join("")}</table></div>
    <div class='card'><div class='h2'>PRIZE BOX</div><div class='msn-rew'>10,000 Coins + 7 Days VIP ELITE</div></div>
  </div>
</div>`

const extraCss = `
.pane { display: none; }
.pane.active { display: block; }
.pass-medal { width:48px; height:48px; display:block; background-size:contain; background-repeat:no-repeat; background-position:center; }
${showIds.map((id, i) => `.csgo-pass-cell .pm-${i} { background-image:url(${medalUriMap["fn_" + id + ".png"] || medalUri}); }`).join("\n")}
`

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FreeNova | All-in-one preview</title>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}
${extraCss}
</style>
</head><body><div class="wrap">
<header class="master-header">
  <div class="brand-badge">
    <img class="brand-logo-img" src="${logoUri}" alt="FreeNova" width="44" height="44">
    <div class="brand-text"><h1>FREENOVA</h1><span>THE ULTIMATE GAMING NETWORK</span></div>
  </div>
  <div class="header-title-badge">ALL-IN-ONE WEB PREVIEW</div>
</header>

<div id="home" class="pane">${paneHome}</div>
<div id="profile" class="pane">${profileInner}</div>
<div id="pstats" class="pane">${paneStats}</div>
<div id="pmastery" class="pane">${paneMastery}</div>
<div id="pachievements" class="pane">${paneAchInner}</div>
<div id="pmissions" class="pane">${paneProfMissions}</div>
<div id="pseasons" class="pane">${paneSeasons}</div>
<div id="ptournaments" class="pane">${paneTournaments}</div>
<div id="top" class="pane">${paneTop}</div>
<div id="bp" class="pane">${paneBp}</div>
<div id="missions" class="pane">${paneMissions}</div>
<div id="achievements" class="pane">${paneAch}</div>
<div id="tournament" class="pane">${paneTour}</div>
<div id="store" class="pane">${paneStore}</div>
<div id="events" class="pane">${paneEvents}</div>
<div id="event-kill" class="pane">${paneEventKill}</div>

<div class="foot">FREENOVA &bull; one file, every panel &bull; hash nav (#profile #top #store …) &bull; generated from live CSS + rank SVGs + showcase math</div>
</div>
<script>
(function () {
  function show(id) {
    var panes = document.querySelectorAll(".pane");
    for (var i = 0; i < panes.length; i++) panes[i].classList.remove("active");
    var el = document.getElementById(id) || document.getElementById("home");
    el.classList.add("active");
    var title = document.querySelector(".header-title-badge");
    if (title) title.textContent = (id || "HOME").toUpperCase();
    window.scrollTo(0, 0);
  }
  function fromHash() {
    var h = (location.hash || "#home").replace("#", "").split("/")[0];
    if (!document.getElementById(h)) h = "home";
    show(h);
  }
  window.addEventListener("hashchange", fromHash);
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-pane]");
    if (!a) return;
    e.preventDefault();
    location.hash = a.getAttribute("data-pane");
  });
  fromHash();
})();
</script>
</body></html>
`

const out1 = join(root, "..", "modern_web_preview.html")
const out2 = join("C:/Users/conts/Desktop/Server CS 1.6/cstrike/modern_web_preview.html")
writeFileSync(out1, html)
writeFileSync(out2, html)
console.log("wrote", out1, html.length, "bytes")
console.log("wrote", out2)
console.log("rank", rp.curName, "AP", earnedAP, "panes home/profile/top/bp/missions/achievements/tournament/store/events")

