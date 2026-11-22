// Dashboard data adapters — real sources, documented empty shapes.
//
// NO NEW TABLES AND NO NEW WRITES. Everything below reads what the panel
// already stores (src/winter/store.js, schema.sql) or one of the four
// `winter_meta` keys in ADAPTER_CONTRACT that a workstream has not shipped yet.
// A key that is absent yields an honest zero/empty view model — never a demo
// number — and the page prints exactly which adapters are live (see `wiring`).
//
// The rule from the design doc, restated because it is the whole point:
//   "Every number on that screen must come from a real source or render as an
//    honest empty state (0, or 'no season data yet')."
//
// Pure helpers (countdownParts, eventState, objectiveRows, rewardTiles) are
// exported so test_harness.mjs can drive them with a fixed clock and with
// literal rows instead of a database.

import { loadSeason } from "../../winter/season.js"
import { loadCatalog, TREE_SLOTS, ADVENT_DAYS, REWARD, rewardType, rarityName, ornament } from "../../winter/catalog.js"
import { loadState } from "../../winter/store.js"
import { adventStatus, passStatus, treeStatus } from "../../winter/progress.js"
import { normalizeSteamid } from "../../publicapi.js"
import { fmt } from "../theme.js"

/**
 * The payload shapes the game/other workstreams should push. Every one is a
 * `winter_meta` key holding a JSON object — the table already exists, so this
 * needs no schema change from any agent. Written down here so the shape is
 * versioned in code, in the design doc and in the harness.
 *
 *   winter_meta.key = 'spin'
 *     { "players": { "STEAM_0:0:1": { "spins": 3 } }, "global": { "spins": 0 } }
 *   winter_meta.key = 'contracts'
 *     { "players": { "STEAM_0:0:1": { "open": 3, "total": 10 } } }
 *   winter_meta.key = 'objectives'
 *     { "season": "2026",
 *       "counters": [ { "key": "gifts", "label": "Collect Gifts",
 *                       "current": 42, "target": 50 }, ... up to 4 ] }
 *   winter_meta.key = 'announcements'
 *     { "items": [ { "id": "w1", "title": "Snowball fight tonight", "at": 1765000000,
 *                    "unread": true } ] }
 */
export const ADAPTER_CONTRACT = {
  spin: "winter_meta.spin → { players: { <steamid>: { spins } } }",
  contracts: "winter_meta.contracts → { players: { <steamid>: { open, total } } }",
  objectives: "winter_meta.objectives → { season, counters: [{ key, label, current, target }] }",
  announcements: "winter_meta.announcements → { items: [{ id, title, at, unread }] }"
}

/** The shape loadState returns for a player with no winter snapshot yet. */
export function EMPTY_STATE() {
  return {
    found: false, steamid: "", name: "", snowflakes: 0, giftsFound: 0, treeStyle: 1, treeLevel: 0,
    slots: new Map(), owned: [], ownedIds: new Set(), advent: new Map(), gifts: [], giftCounts: new Map(),
    giftTotal: 0, pass: { xp: 0, tier: 0, found: false }, community: null, seasonRow: null
  }
}

/** The four objective rows the reference shows, used when nothing is pushed. */
export const DEFAULT_OBJECTIVES = [
  { key: "gifts", label: "Collect Gifts", icon: "gift" },
  { key: "ornaments", label: "Find Ornaments", icon: "bauble" },
  { key: "missions", label: "Complete Missions", icon: "target" },
  { key: "matches", label: "Win Event Matches", icon: "snowflake" }
]

/** The four ornament tallies under the tree bar, in rarity order. */
export const ORNAMENT_SLOTS = [
  { key: "common", label: "Common ornaments", icon: "bauble" },
  { key: "rare", label: "Rare ornaments", icon: "star" },
  { key: "epic", label: "Epic ornaments", icon: "snowflake" },
  { key: "legendary", label: "Legendary ornaments", icon: "bow" }
]

/**
 * Reward-tile art, chosen by reward TYPE (the crop set is fixed: four tiles
 * from the reference). The label on the tile is the real grant; the picture is
 * decoration, and says so in the design doc.
 */
// The four pictures the owner's reference actually has for a reward tile. Any
// other kind takes the closest one; nothing is drawn to fill a gap.
export const REWARD_ART = {
  [REWARD.ORNAMENT]: { art: "/winter/ref/tile-snowflake.png", tone: "ice" },
  [REWARD.SNOWFLAKES]: { art: "/winter/ref/tile-gingerbread.png", tone: "pink" },
  [REWARD.GIFT]: { art: "/winter/ref/tile-santahat.png", tone: "gold" },
  [REWARD.PASS_XP]: { art: "/winter/ref/tile-ak47.png", tone: "orange" },
  [REWARD.TITLE]: { art: "/winter/ref/tile-santahat.png", tone: "violet" }
}

const int = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : d
}

// ------------------------------------------------------------------ pure ----

/** Seconds -> the four countdown cells. Never negative, never NaN. */
export function countdownParts(targetSec, nowSec) {
  const left = Math.max(0, int(targetSec) - int(nowSec))
  return {
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
    left
  }
}

/** "2d 14h" / "14h" / "45m" / "now" — the reference's pill wording. */
export function shortDuration(sec) {
  const s = Math.max(0, int(sec))
  if (s <= 0) return "now"
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(1, m)}m`
}

/**
 * One `events` row -> the state pill. The four states in the reference:
 * `Active Now`, `Ends in 2d 14h`, `Starts in 14h`, `Active`.
 *   active + end in the future  -> green, "Ends in …"
 *   active + no end             -> green, "Active Now"
 *   scheduled + start future    -> gold,  "Starts in …"
 *   scheduled + start past      -> green, "Active"
 *   anything else               -> dim,   "Ended"
 */
export function eventState(row, nowSec) {
  const now = int(nowSec)
  const status = String((row && row.status) || "").toLowerCase()
  const start = int(row && row.start_at)
  const end = int(row && row.end_at)
  if (status === "active") {
    if (end > now) return { key: "active-ends", tone: "green", label: `Ends in ${shortDuration(end - now)}`, live: true }
    if (end > 0) return { key: "ended", tone: "dim", label: "Ended", live: false }
    return { key: "active", tone: "green", label: "Active Now", live: true }
  }
  if (status === "scheduled") {
    if (start > now) return { key: "starts", tone: "gold", label: `Starts in ${shortDuration(start - now)}`, live: false }
    return { key: "active", tone: "green", label: "Active", live: true }
  }
  return { key: "ended", tone: "dim", label: "Ended", live: false }
}

/** Which inline-SVG glyph a real event row gets, from its type and title. */
export function eventGlyph(row) {
  const s = `${(row && row.type) || ""} ${(row && row.title) || ""}`.toLowerCase()
  if (/wheel|roulette|spin|lottery/.test(s)) return { ic: "wheel", tone: "violet" }
  if (/santa|protect|defend|shield/.test(s)) return { ic: "shield", tone: "ice" }
  if (/grinch|boss|monster|goblin/.test(s)) return { ic: "grinch", tone: "green" }
  if (/gift|present|hunt|snow/.test(s)) return { ic: "gift", tone: "gold" }
  return { ic: "confetti", tone: "gold" }
}

/** The objective rows for the Event Progress card, from the pushed counters. */
export function objectiveRows(pushed) {
  const counters = pushed && Array.isArray(pushed.counters) ? pushed.counters : []
  const byKey = new Map()
  for (const c of counters) {
    if (!c || typeof c !== "object") continue
    const key = String(c.key || "").slice(0, 24)
    if (!key || byKey.has(key)) continue
    byKey.set(key, {
      key,
      label: String(c.label || DEFAULT_OBJECTIVES.find(d => d.key === key)?.label || key).slice(0, 40),
      current: Math.max(0, int(c.current)),
      target: Math.max(0, int(c.target))
    })
  }
  return DEFAULT_OBJECTIVES.map(d => {
    const hit = byKey.get(d.key)
    return {
      key: d.key,
      label: (hit && hit.label) || d.label,
      icon: d.icon,
      current: hit ? hit.current : 0,
      target: hit ? hit.target : 0,
      known: !!(hit && hit.target > 0)
    }
  })
}

/** Owned ornaments counted by rarity, for the four tallies under the tree bar. */
export function ornamentCounts(cat, state) {
  const owned = (state && state.ownedIds) || new Set()
  const list = (cat && cat.ornaments) || []
  const counts = new Map()
  for (const o of list) {
    if (!owned.has(o.id)) continue
    const r = Math.min(3, Math.max(0, int(o.rarity)))
    counts.set(r, (counts.get(r) || 0) + 1)
  }
  // Ornaments the mirror holds that the catalogue has not published yet still
  // exist: count them in the first slot rather than hide them.
  const known = new Set(list.map(o => o.id))
  const extra = [...owned].filter(id => !known.has(id)).length
  if (extra) counts.set(0, (counts.get(0) || 0) + extra)
  return ORNAMENT_SLOTS.map((s, i) => ({
    key: s.key,
    label: (cat && rarityName(cat, i)) ? `${rarityName(cat, i)} ornaments` : s.label,
    icon: s.icon,
    value: counts.get(i) || 0
  }))
}

/** The last four grants from the claim ledger, as reward tiles. */
export function rewardTiles(cat, state) {
  const gifts = (state && Array.isArray(state.gifts)) ? state.gifts.slice(0, 4) : []
  return gifts.map(g => {
    const kind = rewardType(g.type)
    const art = REWARD_ART[kind] || { art: "/winter/ref/tile-santahat.png", tone: "orange" }
    let title, sub
    if (kind === REWARD.ORNAMENT) {
      const o = ornament(cat, g.id)
      title = o ? o.name : `Ornament #${g.id}`
      sub = "Ornament"
    } else if (kind === REWARD.SNOWFLAKES) {
      title = `+${fmt(g.amount || g.id)}`
      sub = "GingerBread"
    } else if (kind === REWARD.PASS_XP) {
      title = `+${fmt(g.amount || g.id)} XP`
      sub = "Winter Pass"
    } else if (kind === REWARD.TITLE) {
      const s = cat && cat.setById ? cat.setById.get(g.id) : null
      title = s ? (s.title || s.name) : `Title #${g.id}`
      sub = "Title"
    } else if (kind === REWARD.GIFT) {
      title = rarityName(cat, g.id) || "Present"
      sub = "Present"
    } else {
      title = "Reward"
      sub = `#${g.id}`
    }
    return { title, sub, art: art.art, tone: art.tone, at: g.openedAt }
  })
}

// ------------------------------------------------------------------ read ----

async function one(env, sql, ...args) {
  try {
    const st = env.DB.prepare(sql)
    return await (args.length ? st.bind(...args) : st.bind()).first()
  } catch { return null }
}

async function many(env, sql, ...args) {
  try {
    const st = env.DB.prepare(sql)
    const r = await (args.length ? st.bind(...args) : st.bind()).all()
    return r && Array.isArray(r.results) ? r.results : []
  } catch { return [] }
}

function parseJson(text) {
  if (!text) return null
  try {
    const v = JSON.parse(String(text))
    return v && typeof v === "object" ? v : null
  } catch { return null }
}

/** `{ players: { <sid>: {...} } }` -> the row for one player (or {}). */
function perPlayer(blob, sid) {
  if (!blob || !sid) return {}
  const players = blob.players
  if (!players || typeof players !== "object") return {}
  const row = players[sid]
  return row && typeof row === "object" ? row : {}
}

/** `WF_DEV=1` and nothing else: the switch that prints the data-wiring note. */
export function devFlag(env) {
  const flag = String((env && (env.WF_DEV || env.V2_DEV)) || "")
  return flag === "1" || flag.toLowerCase() === "true"
}

/**
 * The local instance: `WF_DEV=1`, or a request that arrived on loopback.
 * A production deploy (real hostname, no flag) is never local, so an anonymous
 * visit there stays anonymous — a shared box never shows one player's numbers to
 * the next visitor. `?steamid=` and WF_DEFAULT_STEAMID do not need this.
 */
export function localRequest(env, url) {
  if (devFlag(env)) return true
  const host = String((url && url.hostname) || "").toLowerCase()
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"
}

/**
 * Who the page is for.
 *   query   ?steamid=…                     always wins
 *   env     WF_DEFAULT_STEAMID=STEAM_0:0:1  the local script's pinned player
 *   recent  (dev mode only) the player whose last_seen is newest
 *   none    anonymous: the season and the event board, no player numbers
 * `recent` never invents a player: it is a row that exists, or nothing.
 */
export async function resolveSteamid(env, url) {
  const q = normalizeSteamid((url && url.searchParams && url.searchParams.get("steamid")) || "")
  if (q) return { sid: q, source: "query" }
  const pinned = normalizeSteamid((env && env.WF_DEFAULT_STEAMID) || "")
  if (pinned) return { sid: pinned, source: "env" }
  if (!localRequest(env, url)) return { sid: "", source: "none" }
  const row = await one(env,
    "SELECT steamid FROM players WHERE steamid LIKE 'STEAM_%' AND last_seen > 0 ORDER BY last_seen DESC LIMIT 1")
  const sid = row && normalizeSteamid(row.steamid)
  return sid ? { sid, source: "recent" } : { sid: "", source: "none" }
}

/**
 * Everything the dashboard renders, in one read pass.
 * `nowSec` is injectable so the harness can freeze the countdown.
 */
export async function loadDashboard(env, url, nowSec) {
  const now = int(nowSec || Math.floor(Date.now() / 1000))
  const identity = await resolveSteamid(env, url)
  const sid = identity.sid

  const season = await loadSeason(env, now)
  const cat = await loadCatalog(env)
  const state = sid ? await loadState(env, sid, season.year) : EMPTY_STATE()

  const prow = sid ? await one(env, "SELECT name, level, coins FROM players WHERE steamid=?1", sid) : null

  const metaRows = await many(env,
    "SELECT key, value FROM winter_meta WHERE key IN ('spin','contracts','objectives','announcements')")
  const meta = new Map(metaRows.map(r => [String(r.key), parseJson(r.value)]))

  const eventRows = await many(env,
    `SELECT id, title, type, status, start_at, end_at, metric, target, reward
       FROM events WHERE status IN ('active','scheduled')
       ORDER BY (status='active') DESC, start_at ASC LIMIT 8`)

  // ---- derived, all from the reads above --------------------------------
  const adv = adventStatus(season, state)
  const pass = passStatus(cat, state)
  const tree = treeStatus(cat, state)
  const spinRow = perPlayer(meta.get("spin"), sid)
  const contractRow = perPlayer(meta.get("contracts"), sid)
  const objectives = objectiveRows(meta.get("objectives"))
  const announcements = meta.get("announcements")
  const unread = Array.isArray(announcements && announcements.items)
    ? announcements.items.filter(i => i && i.unread).length
    : 0

  // countdown target: the close while open, the open while before it
  const target = season.phase === "open" ? season.closesAtExclusive
    : season.phase === "before" ? season.opensAt : 0
  const cd = countdownParts(target, now)

  const events = eventRows.map(row => {
    const st = eventState(row, now)
    const g = eventGlyph(row)
    const evTarget = Math.max(0, int(row.target))
    const blurb = String(row.reward || "").trim()
      || (evTarget > 0 ? `${String(row.metric || "progress")} target ${fmt(evTarget)}` : "")
      || "Details on the events page"
    return {
      id: row.id, title: String(row.title || "Untitled event"), blurb,
      state: st, ic: g.ic, tone: g.tone, href: "/events"
    }
  })

  const liveEvents = events.filter(e => e.state.live).length
  const coins = prow ? int(prow.coins) : 0

  const wired = {
    player: !!sid && !!prow,
    coins: !!prow,
    gingerbread: !!state.found,
    spins: !!meta.get("spin"),
    contracts: !!meta.get("contracts"),
    announcements: !!meta.get("announcements"),
    objectives: !!meta.get("objectives"),
    rewards: (state.gifts || []).length > 0,
    events: eventRows.length > 0,
    tree: !!state.found,
    pass: !!(state.pass && state.pass.found),
    advent: !!state.found,
    season: season.source === "game" || season.source === "meta" || season.source === "env"
  }

  return {
    now,
    dev: devFlag(env),
    identity,
    season,
    player: {
      steamid: sid,
      name: (prow && prow.name) ? String(prow.name) : (state.name || ""),
      level: prow ? int(prow.level) : 0,
      known: !!prow,
      signedIn: !!sid,
      href: sid ? `/profile?steamid=${encodeURIComponent(sid)}` : "/profile"
    },
    currency: {
      coins,
      gingerbread: int(state.snowflakes),
      spins: Math.max(0, int(spinRow.spins)),
      missions: { open: Math.max(0, int(contractRow.open)), total: Math.max(0, int(contractRow.total)) }
    },
    bell: { unread, href: "/events" },
    countdown: {
      label: season.phase === "open" ? "Event Ends In"
        : season.phase === "before" ? "Event Opens In"
          : season.phase === "disabled" ? "Season switched off" : "Season closed",
      parts: [
        { key: "days", value: cd.days, label: "Days" },
        { key: "hours", value: cd.hours, label: "Hours" },
        { key: "minutes", value: cd.minutes, label: "Minutes" },
        { key: "seconds", value: cd.seconds, label: "Seconds" }
      ],
      left: cd.left
    },
    tree: {
      filled: tree.filled, total: TREE_SLOTS, pct: tree.pct, level: tree.level,
      ornaments: ornamentCounts(cat, state)
    },
    pass: { tier: pass.tier, maxTier: pass.maxTier, pct: pass.pct, xp: pass.xp },
    advent: { claimed: adv.claimedCount, total: ADVENT_DAYS, today: season.dayOfMonth },
    events: { active: liveEvents, list: events },
    objectives,
    rewards: rewardTiles(cat, state),
    wiring: [
      { name: "Coins", source: "players.coins", wired: wired.coins, note: "no player row yet" },
      { name: "GingerBread", source: "winter_players.snowflakes", wired: wired.gingerbread, note: "no winter snapshot yet" },
      { name: "Spins", source: ADAPTER_CONTRACT.spin, wired: wired.spins, note: "workstream 13 has not pushed it" },
      { name: "Missions", source: ADAPTER_CONTRACT.contracts, wired: wired.contracts, note: "no seasonal contracts pushed" },
      { name: "Bell", source: ADAPTER_CONTRACT.announcements, wired: wired.announcements, note: "no announcements pushed" },
      { name: "Season", source: "winter_meta.season / meta winter.*", wired: wired.season, note: "using the documented 1–24 Dec default window" },
      { name: "Tree", source: "winter_tree + winter_ornaments", wired: wired.tree, note: "no tree snapshot yet" },
      { name: "Battle Pass", source: "winter_pass.tier", wired: wired.pass, note: "no pass snapshot yet" },
      { name: "Advent", source: "winter_advent", wired: wired.advent, note: "no claims yet" },
      { name: "Objectives", source: ADAPTER_CONTRACT.objectives, wired: wired.objectives, note: "four counters pending from the game" },
      { name: "Recent rewards", source: "winter_gifts", wired: wired.rewards, note: "no grants in the ledger yet" },
      { name: "Events", source: "events", wired: wired.events, note: "no Winterfest events scheduled" }
    ]
  }
}
