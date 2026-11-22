// The Winterfest family's one read pass.
//
// The old pages (src/winter/*.js) already own the data: loadSeason,
// loadCatalog and loadState produce `{ season, cat, state }`, and the pure
// helpers in progress.js turn that into per-page truth (adventStatus, treeStatus,
// passStatus). This module assembles that same context for the v2 pages — it
// adds NO query the old panel does not already make and writes nothing — plus
// the four top-bar chips, so every winter page shows the same numbers as the
// dashboard.
//
// Identity is the dashboard's (data/dashboard.js::resolveSteamid): ?steamid=
// wins, WF_DEFAULT_STEAMID pins, and a local/dev request falls back to the
// player whose last_seen is newest. A production visit with no identity gets an
// honest empty view of the same page.
import { loadSeason } from "../../winter/season.js"
import { loadCatalog } from "../../winter/catalog.js"
import { loadState } from "../../winter/store.js"
import { EMPTY_STATE, resolveSteamid, devFlag } from "./dashboard.js"
import { artIcon } from "../art.js"
import { fmt } from "../theme.js"

function db(env) {
  return env && env.DB ? env.DB : null
}

async function one(env, sql, ...args) {
  const D = db(env)
  if (!D) return null
  try {
    const st = D.prepare(sql)
    return await (args.length ? st.bind(...args) : st).first()
  } catch { return null }
}

async function many(env, sql, ...args) {
  const D = db(env)
  if (!D) return []
  try {
    const st = D.prepare(sql)
    const res = await (args.length ? st.bind(...args) : st).all()
    return (res && res.results) || []
  } catch { return [] }
}

function parseJson(v) {
  if (v && typeof v === "object") return v
  try { return JSON.parse(String(v || "")) } catch { return null }
}

function perPlayer(payload, sid) {
  if (!payload || typeof payload !== "object" || !sid) return {}
  const players = payload.players
  if (!players || typeof players !== "object") return {}
  const row = players[sid]
  return row && typeof row === "object" ? row : {}
}

const int = v => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** Everything a Winterfest page reads, once. */
export async function winterContext(env, url, nowSec) {
  const now = int(nowSec || Math.floor(Date.now() / 1000))
  const identity = await resolveSteamid(env, url)
  const sid = identity.sid

  const season = await loadSeason(env, now)
  const cat = await loadCatalog(env)
  const state = sid ? await loadState(env, sid, season.year) : EMPTY_STATE()
  const prow = sid ? await one(env, "SELECT name, level, coins FROM players WHERE steamid=?1", sid) : null
  const metaRows = await many(env, "SELECT key, value FROM winter_meta WHERE key IN ('spin','contracts')")
  const meta = new Map(metaRows.map(r => [String(r.key), parseJson(r.value)]))

  return { env, url, nowSec: now, identity, sid, season, cat, state, prow, meta, dev: devFlag(env) }
}

/** The four chips, in the shell's shape (icon + value + label). */
export function chipsOf(ctx) {
  const spinRow = perPlayer(ctx.meta.get("spin"), ctx.sid)
  const contractRow = perPlayer(ctx.meta.get("contracts"), ctx.sid)
  const spins = Math.max(0, int(spinRow.spins))
  const open = Math.max(0, int(contractRow.open))
  return [
    { icon: artIcon("chip-coins", 40), value: fmt(ctx.prow ? int(ctx.prow.coins) : 0), label: "Coins", addHref: "" },
    { icon: artIcon("chip-gingerbread", 40), value: fmt(int(ctx.state.snowflakes)), label: "GingerBread", addHref: "/v2/winter/gifts" },
    { icon: artIcon("chip-spins", 40), value: fmt(spins), label: "Spins", addHref: "/v2/winter/spin" },
    { icon: artIcon("chip-missions", 40), value: fmt(open), label: "Missions", addHref: "" }
  ]
}

/** The shell's player object. */
export function playerOf(ctx) {
  const name = (ctx.prow && ctx.prow.name) ? String(ctx.prow.name) : (ctx.state.name || "")
  return {
    steamid: ctx.sid,
    name,
    level: ctx.prow ? int(ctx.prow.level) : 0,
    known: !!ctx.prow,
    signedIn: !!ctx.sid,
    href: ctx.sid ? `/profile?steamid=${encodeURIComponent(ctx.sid)}` : "/profile"
  }
}

/** The Winterfest sub-navigation: one row of links under the top bar. */
export const WINTER_TABS = [
  { key: "hub", label: "Hub", href: "/v2/winter" },
  { key: "advent", label: "Advent", href: "/v2/winter/advent" },
  { key: "tree", label: "Tree", href: "/v2/winter/tree" },
  { key: "gifts", label: "Gifts", href: "/v2/winter/gifts" },
  { key: "ornaments", label: "Ornaments", href: "/v2/winter/ornaments" },
  { key: "pass", label: "Battle Pass", href: "/v2/winter/pass" },
  { key: "spin", label: "Spin Wheel", href: "/v2/winter/spin" },
  { key: "mail", label: "Mail", href: "/v2/winter/mail" }
]
