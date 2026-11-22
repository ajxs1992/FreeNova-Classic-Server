// Winterfest season window — the ONE place "is Winterfest open?" is decided.
//
// Owner decisions (docs/WINTERFEST.md §6): the season runs 1 December 00:00 to
// 24 December 23:59:59 Europe/Paris, and a missed Advent day stays claimable
// until that same close. Nothing here invents a date: the window comes from
// (in order)
//
//   1. an explicit panel config     env.WINTER_ACTIVE / WINTER_START / WINTER_END
//                                   / WINTER_ADVENT_END (Worker vars), then the
//                                   `meta` rows winter.active / winter.start /
//                                   winter.end / winter.advent_end;
//   2. the game's own push          winter_meta.key='season' — the game is the
//                                   source of truth (docs §5.5, §5.6);
//   3. the documented default       1 Dec .. 24 Dec of the Paris year, so the
//                                   skin turns itself on without any config.
//
// Paris wall-clock maths is periods.js (parisMidnight/parisParts) — the same
// module that cuts the weekly/monthly boards. Reimplementing a timezone offset
// here is exactly the bug that module exists to prevent.

import { parisParts, parisMidnight, PARIS_TZ } from "../periods.js"

export { PARIS_TZ }

export const WINTER_DEFAULT_NAME = "Winterfest"
const OPEN_MONTH = 12
const OPEN_DAY = 1
const CLOSE_MONTH = 12
const CLOSE_DAY = 24

/**
 * A date key as the game writes it (`20261201`, from WfDateKey which keeps the
 * digits) or as a human writes it (`2026-12-01`). Returns { y, m, d } or null.
 */
export function parseDateKey(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const digits = s.replace(/\D/g, "")
  if (digits.length < 8) return null
  const y = Number(digits.slice(0, 4))
  const m = Number(digits.slice(4, 6))
  const d = Number(digits.slice(6, 8))
  if (!(y >= 2020 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  return { y, m, d }
}

/** 20261201 -> "2026-12-01" (the form the panel prints and the docs use). */
export function dateKeyText(v, fallback) {
  const p = parseDateKey(v)
  if (!p) return fallback == null ? "" : String(fallback)
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`
}

/** Paris calendar date of an instant (the season is a Paris-local calendar). */
export function parisDate(sec) {
  const p = parisParts(sec)
  return { y: p.y, m: p.m, d: p.d }
}

/**
 * A calendar day from either a raw key (20261201 / "2026-12-01") or an
 * already-parsed { y, m, d }. Returns null when it is neither.
 */
function dayOf(v) {
  if (v && typeof v === "object") {
    const y = Number(v.y), m = Number(v.m), d = Number(v.d)
    if (y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d }
    return null
  }
  return parseDateKey(v)
}

const pad2n = n => String(n).padStart(2, "0")
const keyOf = p => p ? `${p.y}-${pad2n(p.m)}-${pad2n(p.d)}` : ""

/**
 * The opensAt/closesAt instants of a season window. `end` is an inclusive
 * calendar day in Europe/Paris ("the season closes on the 24th at 23:59"), so
 * closesAt is the first instant after that day.
 */
export function windowInstants(cfg) {
  const start = dayOf(cfg && cfg.start)
  const end = dayOf(cfg && cfg.end)
  const open = start ? parisMidnight(start.y, start.m, start.d) : null
  const close = end ? parisMidnight(end.y, end.m, end.d + 1) : null
  const advEnd = dayOf(cfg && cfg.advent_end)
  const advClose = advEnd ? parisMidnight(advEnd.y, advEnd.m, advEnd.d + 1) : close
  return { opensAt: open, closesAt: close, adventClosesAt: advClose }
}

/**
 * Resolve one season: defaults for the year `nowSec` falls in, overridden by
 * whatever config fields are present. Pure and synchronous — the unit checks
 * in test_harness.mjs drive it with a fixed clock.
 */
export function resolveSeason(cfg, nowSec) {
  const now = Math.floor(Number(nowSec) || 0)
  const today = parisDate(now)
  const year = (cfg && Number(cfg.year) > 0 && Number(cfg.year) <= 2100)
    ? Math.trunc(Number(cfg.year))
    : today.y
  const start = cfg && cfg.start ? dayOf(cfg.start) : null
  const end = cfg && cfg.end ? dayOf(cfg.end) : null
  const advEnd = cfg && cfg.advent_end ? dayOf(cfg.advent_end) : null

  const startDay = start || { y: year, m: OPEN_MONTH, d: OPEN_DAY }
  const endDay = end || { y: year, m: CLOSE_MONTH, d: CLOSE_DAY }
  const advDay = advEnd || endDay
  const { opensAt, closesAt, adventClosesAt } = windowInstants({
    start: startDay,
    end: endDay,
    advent_end: advDay
  })

  const enabled = cfg && cfg.enabled != null ? !!Number(cfg.enabled) || cfg.enabled === true : true
  const active = enabled && now >= opensAt && now < closesAt
  const phase = !enabled ? "disabled" : now < opensAt ? "before" : now >= closesAt ? "closed" : "open"

  return {
    name: (cfg && cfg.name) || WINTER_DEFAULT_NAME,
    year,
    enabled,
    phase,
    active,
    opensAt,
    // The last whole second of the closing day (23:59:59 Paris) — what a
    // player reads as "24 December 23:59". `closesAtExclusive` is 25 Dec 00:00.
    closesAt: closesAt - 1,
    closesAtExclusive: closesAt,
    adventClosesAt: adventClosesAt - 1,
    adventOpen: enabled && now >= opensAt && now < adventClosesAt,
    startKey: keyOf(startDay),
    endKey: keyOf(endDay),
    adventEndKey: keyOf(advDay),
    today,
    // Day of the month in Paris — the Advent calendar's "today" cell.
    dayOfMonth: active ? today.d : 0,
    daysLeft: Math.max(0, Math.ceil((closesAt - now) / 86400)),
    source: (cfg && cfg.source) || "default",
    tz: PARIS_TZ
  }
}

/** "24 Dec 2026, 23:59 Europe/Paris" — server-side, the honest fallback. */
export function parisStamp(sec) {
  const p = parisParts(sec)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${p.d} ${months[p.m - 1]} ${p.y}, ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`
}

/** The `?` bits that survive a redirect back to a winter page. */
export function winterQuery(url, extra) {
  const q = []
  const sid = url && url.searchParams ? url.searchParams.get("steamid") : ""
  if (sid) q.push("steamid=" + encodeURIComponent(sid))
  if (url && url.searchParams && url.searchParams.get("compact") === "1") q.push("compact=1")
  if (extra) q.push(extra)
  return q.length ? "?" + q.join("&") : ""
}

// ------------------------------------------------------------------ config --
// Panels have no config-file loader (src/ has none), so the window is read from
// what a deployment actually has: Worker `env` vars, the `meta` key/value table
// (staff ops without a redeploy), and the game's own push. Every read is
// try/catch'd: a panel booted before schema.sql ran still renders, it just
// falls back to the default window.
const CONFIG_KEYS = {
  active: "winter.active",
  start: "winter.start",
  end: "winter.end",
  advent_end: "winter.advent_end"
}

async function metaValue(env, key) {
  try {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first()
    return row && row.value != null ? String(row.value) : ""
  } catch { return "" }
}

async function pushedSeason(env) {
  try {
    const row = await env.DB.prepare("SELECT value, updated_at FROM winter_meta WHERE key='season'").bind().first()
    if (!row || !row.value) return null
    const j = JSON.parse(row.value)
    if (!j || typeof j !== "object") return null
    return j
  } catch { return null }
}

/**
 * The season as the panel should render it right now.
 * env  — the Worker/runner env (env.DB, optional WINTER_* vars)
 * nowSec — epoch seconds (tests pass a fixed clock)
 */
export async function loadSeason(env, nowSec) {
  const now = Math.floor(Number(nowSec) || Date.now() / 1000)
  const envActive = env && env.WINTER_ACTIVE != null ? String(env.WINTER_ACTIVE).trim().toLowerCase() : ""
  const envStart = env && env.WINTER_START != null ? String(env.WINTER_START) : ""
  const envEnd = env && env.WINTER_END != null ? String(env.WINTER_END) : ""
  const envAdv = env && env.WINTER_ADVENT_END != null ? String(env.WINTER_ADVENT_END) : ""

  const pushed = await pushedSeason(env)
  const metaKeys = envActive || envStart || envEnd || envAdv ? {} : {
    active: await metaValue(env, CONFIG_KEYS.active),
    start: await metaValue(env, CONFIG_KEYS.start),
    end: await metaValue(env, CONFIG_KEYS.end),
    advent_end: await metaValue(env, CONFIG_KEYS.advent_end)
  }

  const cfg = {
    name: (pushed && pushed.name) || WINTER_DEFAULT_NAME,
    year: pushed && pushed.year,
    start: (pushed && (pushed.start || pushed.start_key)) || metaKeys.start || envStart || null,
    end: (pushed && (pushed.end || pushed.end_key)) || metaKeys.end || envEnd || null,
    advent_end: (pushed && (pushed.advent_end || pushed.advent_end_key)) || metaKeys.advent_end || envAdv || null,
    enabled: 1,
    source: pushed ? "game" : (metaKeys.start || metaKeys.end ? "meta" : (envStart || envEnd ? "env" : "default"))
  }

  // The explicit on/off switch. A pushed season with enabled:0 is dormant even
  // inside its dates (the guardian of "no client asset, no season").
  if (pushed && pushed.enabled != null) cfg.enabled = Number(pushed.enabled) ? 1 : 0
  const off = ["0", "false", "no", "off"].includes(envActive) || ["0", "false", "no", "off"].includes(String(metaKeys.active || "").toLowerCase())
  const on = ["1", "true", "yes", "on"].includes(envActive) || ["1", "true", "yes", "on"].includes(String(metaKeys.active || "").toLowerCase())
  if (off) cfg.enabled = 0
  else if (on) cfg.enabled = 1

  // With no dates at all the default window follows the Paris year of `now`.
  if (!cfg.start && !cfg.end && !(pushed && pushed.year)) cfg.year = undefined
  const season = resolveSeason(cfg, now)
  season.name = cfg.name || WINTER_DEFAULT_NAME
  return season
}

/**
 * Synchronous variant for the response-level skin: takes the two facts it
 * needs, so the caller (skin.js) does the one DB read it already made.
 */
export function seasonFromRows(seasonRow, activeRow, nowSec, env) {
  let pushed = null
  if (seasonRow && seasonRow.value) {
    try { pushed = JSON.parse(seasonRow.value) } catch { pushed = null }
  }
  const envActive = env && env.WINTER_ACTIVE != null ? String(env.WINTER_ACTIVE).trim().toLowerCase() : ""
  const off = ["0", "false", "no", "off"].includes(envActive) ||
    ["0", "false", "no", "off"].includes(String(activeRow && activeRow.value || "").trim().toLowerCase())
  const on = ["1", "true", "yes", "on"].includes(envActive) ||
    ["1", "true", "yes", "on"].includes(String(activeRow && activeRow.value || "").trim().toLowerCase())
  const cfg = {
    name: (pushed && pushed.name) || WINTER_DEFAULT_NAME,
    year: pushed && pushed.year,
    start: pushed ? (pushed.start || pushed.start_key) : null,
    end: pushed ? (pushed.end || pushed.end_key) : null,
    advent_end: pushed ? (pushed.advent_end || pushed.advent_end_key) : null,
    // The pushed season can switch itself off (winterfest.ini [season] enabled
    // = 0) without any panel-side config, and the panel-side switch can still
    // force it either way.
    enabled: pushed && pushed.enabled != null ? (Number(pushed.enabled) ? 1 : 0) : 1,
    source: pushed ? "game" : "default"
  }
  if (on) cfg.enabled = 1
  const season = resolveSeason(cfg, nowSec)
  season.name = cfg.name
  return season
}

export const WINTER_WINDOW = { openMonth: OPEN_MONTH, openDay: OPEN_DAY, closeMonth: CLOSE_MONTH, closeDay: CLOSE_DAY }
