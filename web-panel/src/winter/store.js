// Winterfest panel storage — a MIRROR of the game's state, never the authority.
//
// The game owns snowflakes, ornaments, tree slots, Advent claims and pass XP in
// nvault (winterfest_core.sma). It pushes a snapshot through the existing sync
// channel and this module copies it into `winter_*` tables so the browser
// surface can render without asking the game anything. Every write here is
// idempotent, because a sync push can be retried after a lost reply:
//
//   tree slots      replace-all inside one transaction (the push is the truth)
//   ornaments       INSERT OR IGNORE on (steamid, ornament)
//   Advent claims   INSERT OR IGNORE on (steamid, season, day)   <- claim-once
//   gift log        INSERT OR IGNORE on (steamid, claim_key)
//   pass xp/tier    monotonic: a stale push can never roll a tier back
//
// The DDL below is byte-for-byte the `winter_*` block in schema.sql. It is
// repeated here (the same way src/boards.js repeats the board DDL) so a
// deployment that never execs schema.sql still gets its tables the first time
// the game pushes — every statement is IF NOT EXISTS, so running it twice is
// harmless and an existing live replica is never rewritten.
//
// INTEGRATION SEAM (documented in docs/WINTERFEST-PANEL.md): sync.js must call
//   await applyWinterPayload(env, payload)
// once, next to the players upsert. sync.js is owned by the coordinator; this
// module is written so that call is the ONLY change it needs. The catalogue
// itself needs no change at all — payload.catalogs already lands in `catalog`.

import { normalizeSteamid } from "../publicapi.js"
import { parisParts } from "../periods.js"
import { devShapeBlobs, playerFromDevShape, catalogFromDevShape, mergeCatalogRows } from "./devshape.js"
import { checkActionToken } from "../sync.js"

export const WINTER_DDL = `
CREATE TABLE IF NOT EXISTS winter_players (
    steamid          TEXT PRIMARY KEY,
    season           TEXT NOT NULL DEFAULT '',
    snowflakes       INTEGER NOT NULL DEFAULT 0,
    gifts_found      INTEGER NOT NULL DEFAULT 0,
    tree_style       INTEGER NOT NULL DEFAULT 1,
    tree_level       INTEGER NOT NULL DEFAULT 0,
    ornaments_total  INTEGER NOT NULL DEFAULT 0,
    advent_claimed   INTEGER NOT NULL DEFAULT 0,
    seen_at          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS winter_tree (
    steamid    TEXT NOT NULL,
    slot       INTEGER NOT NULL,
    ornament   INTEGER NOT NULL,
    moved_at   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, slot)
);
-- An ornament may sit in at most one slot (owner decision §6.1); the mirror
-- enforces it so a bad push is refused instead of drawn twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_winter_tree_ornament ON winter_tree (steamid, ornament);

CREATE TABLE IF NOT EXISTS winter_ornaments (
    steamid     TEXT NOT NULL,
    ornament    INTEGER NOT NULL,
    obtained_at INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (steamid, ornament)
);

CREATE TABLE IF NOT EXISTS winter_gifts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL,
    season      TEXT NOT NULL DEFAULT '',
    instance    INTEGER NOT NULL DEFAULT 0,
    rarity      INTEGER NOT NULL DEFAULT 0,
    reward_type   TEXT NOT NULL DEFAULT '',
    reward_id     INTEGER NOT NULL DEFAULT 0,
    reward_amount INTEGER NOT NULL DEFAULT 0,
    claim_key     TEXT NOT NULL DEFAULT '',
    opened_at   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (steamid, claim_key)
);
CREATE INDEX IF NOT EXISTS idx_winter_gifts_player ON winter_gifts (steamid, opened_at DESC);

CREATE TABLE IF NOT EXISTS winter_advent (
    steamid    TEXT NOT NULL,
    season     TEXT NOT NULL DEFAULT '',
    day        INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL DEFAULT 0,
    claim_key  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (steamid, season, day)
);

CREATE TABLE IF NOT EXISTS winter_pass (
    steamid   TEXT NOT NULL,
    season    TEXT NOT NULL DEFAULT '',
    xp        INTEGER NOT NULL DEFAULT 0,
    tier      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, season)
);

CREATE TABLE IF NOT EXISTS winter_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
);
`

let ddlDone = new WeakSet()

/** Create the winter_* family if it is missing. Safe to call on every write. */
export async function ensureWinterTables(env) {
  if (!env || !env.DB) return
  if (ddlDone.has(env.DB)) return
  // One statement at a time: a D1 batch would abort the whole family on the
  // first statement an older database already has.
  for (const stmt of WINTER_DDL.split(";")) {
    const sql = stmt.trim()
    if (!sql) continue
    try { await env.DB.prepare(sql).run() } catch { /* exists, or no DDL rights */ }
  }
  // Safe migration for a database that booted an earlier build of this file:
  // ALTER is not idempotent, so it is guarded by the live table info instead of
  // being replayed on every boot (the src/schedule.js pattern).
  try {
    const cols = await env.DB.prepare("PRAGMA table_info(winter_gifts)").all()
    const have = new Set(((cols && cols.results) || []).map(r => r.name))
    if (have.size && !have.has("reward_amount"))
      await env.DB.prepare("ALTER TABLE winter_gifts ADD COLUMN reward_amount INTEGER NOT NULL DEFAULT 0").run()
  } catch { /* table missing or read-only: the CREATE above is the normal path */ }
  ddlDone.add(env.DB)
}

// ------------------------------------------------------------------ utils --
const int = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : (fallback == null ? 0 : fallback)
}
const clean = v => String(v == null ? "" : v).replace(/[<>&"'\r\n]/g, "").slice(0, 40)
const nowSecOf = v => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Date.now() / 1000)
}

function pairsFromTree(tree) {
  const out = new Map()
  if (!tree) return out
  if (Array.isArray(tree)) {
    for (const t of tree) {
      if (!t) continue
      if (typeof t === "object") {
        const slot = int(t.slot, 0)
        const orn = int(t.ornament != null ? t.ornament : t.ornament_id, 0)
        if (slot >= 1 && slot <= 24 && orn > 0 && !out.has(slot)) out.set(slot, orn)
      } else if (Array.isArray(t)) {
        const slot = int(t[0], 0), orn = int(t[1], 0)
        if (slot >= 1 && slot <= 24 && orn > 0 && !out.has(slot)) out.set(slot, orn)
      }
    }
  } else if (typeof tree === "object") {
    // {"3": 7, "9": 4} — slot key, ornament id value
    for (const [k, v] of Object.entries(tree)) {
      const slot = int(k, 0), orn = int(v, 0)
      if (slot >= 1 && slot <= 24 && orn > 0 && !out.has(slot)) out.set(slot, orn)
    }
  }
  // An ornament may occupy one slot only: keep the lowest slot.
  const used = new Set()
  const cleanMap = new Map()
  for (const slot of [...out.keys()].sort((a, b) => a - b)) {
    const orn = out.get(slot)
    if (used.has(orn)) continue
    used.add(orn)
    cleanMap.set(slot, orn)
  }
  return cleanMap
}

function idsFromList(list) {
  const out = []
  const seen = new Set()
  const push = v => {
    const id = int(v, 0)
    if (id <= 0 || id > 64 || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  if (Array.isArray(list)) for (const v of list) push(v && typeof v === "object" ? (v.ornament != null ? v.ornament : v.id) : v)
  else if (typeof list === "string") for (const part of list.split(",")) push(part)
  else if (list != null && typeof list !== "object") push(list)
  return out
}

function claimsFromList(list) {
  const out = new Map()
  if (!list) return out
  const push = (day, at) => {
    const d = int(day, 0)
    if (d < 1 || d > 24 || out.has(d)) return
    out.set(d, nowSecOf(at))
  }
  if (Array.isArray(list)) {
    for (const v of list) {
      if (v && typeof v === "object") push(v.day, v.at != null ? v.at : v.claimed_at)
      else push(v, 0)
    }
  } else if (typeof list === "string") {
    for (const part of list.split(",")) push(part, 0)
  } else if (typeof list === "number") push(list, 0)
  return out
}

// --------------------------------------------------------------- ingest ----
/**
 * Copy one signed push's Winterfest block into the mirror.
 *
 * payload.winter = {
 *   season:    { name, year, start, end, advent_end, enabled }   (optional)
 *   community: { key, label, current, target }                   (optional)
 *   players:   [ { steamid, at, snowflakes, gifts_found, tree_style, tree_level,
 *                  ornaments: [id...], tree: [{slot,ornament}] | {"3":7},
 *                  advent: [ {day, at} ] | [1,4,7] | "1,4,7",
 *                  gifts: [ {instance, rarity, type, id, at, key} ],
 *                  pass: { xp, tier } } ]
 * }
 *
 * A per-player `winter` block inside payload.players[] is accepted too, so the
 * game can push it either way without a second code path here.
 */
export async function applyWinterPayload(env, payload, nowSec) {
  const result = {
    ok: true, players: 0, stale: 0, treeSlots: 0, ornaments: 0,
    advent: 0, adventDuplicates: 0, gifts: 0, giftsDuplicates: 0, passXp: 0, errors: []
  }
  if (!env || !env.DB) { result.ok = false; result.errors.push("no DB"); return result }
  const block = payload && payload.winter && typeof payload.winter === "object" ? payload.winter : null
  const rows = []
  if (block && Array.isArray(block.players)) rows.push(...block.players)
  if (payload && Array.isArray(payload.players)) {
    for (const p of payload.players) {
      if (p && p.winter && typeof p.winter === "object") rows.push({ ...p.winter, steamid: p.steamid })
    }
  }
  const pendingCatalog = []
  // Accept docs/WINTERFEST-DEV.md §9's rendered shape as well as the panel's
  // own raw one: whichever the game implements first, the same rows land.
  const devBlobs = devShapeBlobs(payload)
  for (const { steamid, blob } of devBlobs) {
    if (!steamid) continue
    rows.push(playerFromDevShape(steamid, blob))
    const implied = catalogFromDevShape(blob)
    if (implied) pendingCatalog.push(implied)
  }
  if (!block && !rows.length) return result
  await ensureWinterTables(env)

  const now = int(nowSec, 0) || Math.floor(Date.now() / 1000)
  // The season stamp must match what the PAGES ask for (the resolved
  // season's year), so a push without a season block still lands in the same
  // ledger the calendar reads. Falling back to the Paris year of `now` does
  // that without inventing a season: on 1 January both sides say next year,
  // and nothing is open on either side.
  const seasonYear = block && block.season && block.season.year ? String(int(block.season.year, 0)) : ""
  const seasonLabel = seasonYear || String(parisParts(now).y)

  try {
    if (block && block.season && typeof block.season === "object") {
      await env.DB.prepare(
        `INSERT INTO winter_meta (key, value, updated_at) VALUES ('season', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .bind(JSON.stringify(block.season).slice(0, 4000), now).run()
    }
    if (block && block.community && typeof block.community === "object") {
      await env.DB.prepare(
        `INSERT INTO winter_meta (key, value, updated_at) VALUES ('community', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .bind(JSON.stringify(block.community).slice(0, 2000), now).run()
    }
    if (pendingCatalog.length) {
      // docs/WINTERFEST-DEV.md §9 carries the catalogue inside the player blob.
      // Keep it as a FALLBACK: src/winter/catalog.js prefers the static
      // catalogs.winterfest document and only reads this when that is absent.
      let merged = pendingCatalog[0]
      for (const extra of pendingCatalog.slice(1)) merged = mergeCatalogRows(merged, extra)
      let stored = null
      try {
        const row = await env.DB.prepare("SELECT value FROM winter_meta WHERE key=?1").bind("catalog").first()
        if (row && row.value) stored = JSON.parse(row.value)
      } catch { stored = null }
      await env.DB.prepare(
        `INSERT INTO winter_meta (key, value, updated_at) VALUES ('catalog', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .bind(JSON.stringify(mergeCatalogRows(stored, merged)).slice(0, 20000), now).run()
      if (!block || !block.season) {
        // §9 also carries the season; without it the panel would keep guessing.
        const season = merged.season || null
        if (season) await env.DB.prepare(
          `INSERT INTO winter_meta (key, value, updated_at) VALUES ('season', ?1, ?2)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
          .bind(JSON.stringify(season).slice(0, 4000), now).run()
      }
    }
  } catch (e) { result.errors.push("meta: " + (e && e.message)) }

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const sid = normalizeSteamid(row.steamid)
    if (!sid) { result.errors.push("bad steamid"); continue }
    const at = nowSecOf(row.at != null ? row.at : row.seen_at != null ? row.seen_at : now)
    // Stale guard, the same posture as sync.js: an older snapshot is a valid
    // request that must not roll state back.
    let stored = null
    try {
      stored = await env.DB.prepare("SELECT seen_at, season FROM winter_players WHERE steamid=?1").bind(sid).first()
    } catch { stored = null }
    if (stored && Number(stored.seen_at) > at) { result.stale++; continue }
    // The season key must be stable across pushes: a push that omits its
    // season block inherits the one already stored for this player, otherwise
    // the Advent ledger (keyed on season) would let a duplicate claim through.
    const season = clean(row.season) || (stored && clean(stored.season)) || seasonLabel

    try {
      await env.DB.prepare(
        `INSERT INTO winter_players (steamid, season, snowflakes, gifts_found, tree_style, tree_level, ornaments_total, advent_claimed, seen_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(steamid) DO UPDATE SET
           season=excluded.season,
           snowflakes=excluded.snowflakes,
           gifts_found=excluded.gifts_found,
           tree_style=excluded.tree_style,
           tree_level=excluded.tree_level,
           ornaments_total=excluded.ornaments_total,
           advent_claimed=excluded.advent_claimed,
           seen_at=excluded.seen_at`)
        .bind(
          sid, season,
          Math.max(0, int(row.snowflakes, 0)),
          Math.max(0, int(row.gifts_found, 0)),
          Math.min(3, Math.max(1, int(row.tree_style, 1))),
          Math.max(0, int(row.tree_level, 0)),
          Math.max(0, int(row.ornaments_total, 0)),
          Math.max(0, int(row.advent_claimed, 0)),
          at
        ).run()
    } catch (e) { result.errors.push("player: " + (e && e.message)); continue }
    result.players++

    // ---- tree slots: the push is the whole truth, so replace-all
    if (row.tree != null) {
      const slotMap = pairsFromTree(row.tree)
      const stmts = [env.DB.prepare("DELETE FROM winter_tree WHERE steamid=?1").bind(sid)]
      for (const [slot, orn] of slotMap) {
        stmts.push(env.DB.prepare(
          "INSERT INTO winter_tree (steamid, slot, ornament, moved_at) VALUES (?1,?2,?3,?4)")
          .bind(sid, slot, orn, at))
      }
      try {
        if (typeof env.DB.batch === "function") await env.DB.batch(stmts)
        else for (const s of stmts) await s.run()
        result.treeSlots += slotMap.size
      } catch (e) { result.errors.push("tree: " + (e && e.message)) }
    }

    // ---- ornaments the player owns (cache of the game's inventory)
    const owned = idsFromList(row.ornaments)
    for (const orn of owned) {
      try {
        const r = await env.DB.prepare(
          "INSERT OR IGNORE INTO winter_ornaments (steamid, ornament, obtained_at, source) VALUES (?1,?2,?3,?4)")
          .bind(sid, orn, at, clean(row.ornament_source) || "push").run()
        if (r && r.meta && Number(r.meta.changes) > 0) result.ornaments++
      } catch (e) { result.errors.push("ornaments: " + (e && e.message)) }
    }

    // ---- Advent claims: the claim-once ledger (duplicate = no new row)
    const claims = claimsFromList(row.advent != null ? row.advent : row.advent_claimed_days)
    for (const [day, claimedAt] of claims) {
      try {
        const r = await env.DB.prepare(
          "INSERT OR IGNORE INTO winter_advent (steamid, season, day, claimed_at, claim_key) VALUES (?1,?2,?3,?4,?5)")
          .bind(sid, season, day, claimedAt || at, `advent:${season}:${day}`).run()
        if (r && r.meta && Number(r.meta.changes) > 0) result.advent++
        else result.adventDuplicates++
      } catch (e) { result.errors.push("advent: " + (e && e.message)) }
    }

    // ---- gift log (what the player has opened; last 10 are shown)
    if (Array.isArray(row.gifts)) {
      for (const g of row.gifts) {
        if (!g || typeof g !== "object") continue
        const instance = Math.max(0, int(g.instance, 0))
        const openedAt = nowSecOf(g.at != null ? g.at : g.opened_at != null ? g.opened_at : at)
        const key = clean(g.key) || `g:${instance || openedAt}`
        try {
          const r = await env.DB.prepare(
            `INSERT OR IGNORE INTO winter_gifts (steamid, season, instance, rarity, reward_type, reward_id, reward_amount, claim_key, opened_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
            .bind(sid, season, instance, Math.min(2, Math.max(0, int(g.rarity, 0))),
              clean(g.reward_type != null ? g.reward_type : g.type) || "none",
              Math.max(0, int(g.reward_id != null ? g.reward_id : g.id, 0)),
              Math.max(0, int(g.amount, 0)),
              key, openedAt).run()
          if (r && r.meta && Number(r.meta.changes) > 0) result.gifts++
          else result.giftsDuplicates++
        } catch (e) { result.errors.push("gift: " + (e && e.message)) }
      }
    }

    // ---- pass XP/tier: monotonic (never lower, like bp_xp in sync.js)
    if (row.pass && typeof row.pass === "object") {
      const xp = Math.max(0, int(row.pass.xp, 0))
      const tier = Math.max(0, int(row.pass.tier, 0))
      try {
        await env.DB.prepare(
          `INSERT INTO winter_pass (steamid, season, xp, tier, updated_at) VALUES (?1,?2,?3,?4,?5)
           ON CONFLICT(steamid, season) DO UPDATE SET
             xp = MAX(winter_pass.xp, excluded.xp),
             tier = MAX(winter_pass.tier, excluded.tier),
             updated_at = excluded.updated_at`)
          .bind(sid, season, xp, tier, at).run()
        result.passXp++
      } catch (e) { result.errors.push("pass: " + (e && e.message)) }
    }
  }
  return result
}

// ---------------------------------------------------------------- read -----
/**
 * Everything one page needs about one player, in one round of queries.
 * A player the panel has never seen yields `found:false` and empty collections
 * — pages render the zero state from that, they never invent a row.
 */
export async function loadState(env, steamid, seasonKey) {
  const sid = normalizeSteamid(steamid)
  const empty = {
    found: false, steamid: sid, name: "",
    snowflakes: 0, giftsFound: 0, treeStyle: 1, treeLevel: 0, ornamentsTotal: 0,
    adventClaimed: 0, seenAt: 0,
    slots: new Map(), owned: [], ownedIds: new Set(), advent: new Map(),
    gifts: [], giftCounts: new Map(), giftTotal: 0,
    pass: { xp: 0, tier: 0, found: false },
    community: null, seasonRow: null
  }
  if (!sid) return empty

  const one = async (sql, ...args) => {
    try {
      const st = env.DB.prepare(sql)
      return await (args.length ? st.bind(...args) : st.bind()).first()
    } catch { return null }
  }
  const many = async (sql, ...args) => {
    try {
      const st = env.DB.prepare(sql)
      const r = await (args.length ? st.bind(...args) : st.bind()).all()
      return r && Array.isArray(r.results) ? r.results : []
    } catch { return [] }
  }

  const season = String(seasonKey || "current")
  const row = await one("SELECT * FROM winter_players WHERE steamid=?1", sid)
  const player = row || null
  const nameRow = await one("SELECT name FROM players WHERE steamid=?1", sid)

  const slotRows = await many("SELECT slot, ornament FROM winter_tree WHERE steamid=?1 ORDER BY slot", sid)
  const ownedRows = await many("SELECT ornament, obtained_at, source FROM winter_ornaments WHERE steamid=?1 ORDER BY ornament", sid)
  const adventRows = await many("SELECT day, claimed_at FROM winter_advent WHERE steamid=?1 AND season=?2 ORDER BY day", sid, season)
  const giftRows = await many(
    "SELECT rarity, reward_type, reward_id, reward_amount, claim_key, opened_at, instance FROM winter_gifts WHERE steamid=?1 ORDER BY opened_at DESC, id DESC LIMIT 10", sid)
  const giftCountRows = await many("SELECT rarity, COUNT(*) AS n FROM winter_gifts WHERE steamid=?1 GROUP BY rarity", sid)
  // Prefer this season's rung; fall back to the newest row for the player so
  // a stamp mismatch can never show "Tier 1, 0 XP" to someone who has played.
  const passRow = await one(
    "SELECT xp, tier FROM winter_pass WHERE steamid=?1 ORDER BY (season=?2) DESC, updated_at DESC LIMIT 1", sid, season)
  const communityRow = await one("SELECT value FROM winter_meta WHERE key='community'")
  const seasonRow = await one("SELECT value, updated_at FROM winter_meta WHERE key='season'")

  let community = null
  if (communityRow && communityRow.value) {
    try { community = JSON.parse(communityRow.value) } catch { community = null }
  }

  const state = {
    ...empty,
    found: !!player,
    steamid: sid,
    name: nameRow && nameRow.name ? String(nameRow.name) : "",
    snowflakes: player ? Number(player.snowflakes) || 0 : 0,
    giftsFound: player ? Number(player.gifts_found) || 0 : 0,
    treeStyle: player ? Math.min(3, Math.max(1, Number(player.tree_style) || 1)) : 1,
    treeLevel: player ? Number(player.tree_level) || 0 : 0,
    ornamentsTotal: player ? Number(player.ornaments_total) || 0 : 0,
    adventClaimed: player ? Number(player.advent_claimed) || 0 : 0,
    seenAt: player ? Number(player.seen_at) || 0 : 0,
    community,
    seasonRow: seasonRow || null
  }
  for (const r of slotRows) state.slots.set(Number(r.slot), Number(r.ornament))
  state.owned = ownedRows.map(r => ({
    ornament: Number(r.ornament), obtainedAt: Number(r.obtained_at) || 0, source: String(r.source || "")
  }))
  state.ownedIds = new Set(state.owned.map(o => o.ornament))
  for (const r of adventRows) state.advent.set(Number(r.day), Number(r.claimed_at) || 0)
  state.gifts = giftRows.map(r => ({
    rarity: Number(r.rarity) || 0,
    type: String(r.reward_type || ""),
    id: Number(r.reward_id) || 0,
    amount: Number(r.reward_amount) || 0,
    key: String(r.claim_key || ""),
    openedAt: Number(r.opened_at) || 0,
    instance: Number(r.instance) || 0
  }))
  for (const r of giftCountRows) state.giftCounts.set(Number(r.rarity) || 0, Number(r.n) || 0)
  for (const n of state.giftCounts.values()) state.giftTotal += n
  if (passRow) state.pass = { xp: Number(passRow.xp) || 0, tier: Number(passRow.tier) || 0, found: true }
  return state
}

// --------------------------------------------------------------- actions ---
// The panel never moves an ornament itself. A move is a queued action the game
// validates and applies (the same channel every other panel uses); the mirror
// only catches up on the next push. Token checking is sync.js's own exported
// checkActionToken — no second implementation of the auth formula.
const WINTER_ACTIONS = new Set(["wf_tree_move", "wf_tree_style"])

export async function queueWinterAction(env, steamid, type, arg, token) {
  const sid = normalizeSteamid(steamid)
  if (!sid) return { ok: false, error: "bad steamid" }
  if (!WINTER_ACTIONS.has(type)) return { ok: false, error: "unknown action" }
  const value = String(arg == null ? "" : arg)
  const valid = type === "wf_tree_style" ? /^[1-3]$/.test(value) : /^([1-9]|1[0-9]|2[0-4]):([1-9]|1[0-9]|2[0-4])$/.test(value)
  if (!valid) return { ok: false, error: "bad argument" }
  if (value.length > 8) return { ok: false, error: "bad argument" }
  if (!await checkActionToken(env.SYNC_SECRET, sid, token))
    return { ok: false, error: "invalid or expired session token - reopen the panel from the game" }
  try {
    const dup = await env.DB.prepare(
      "SELECT id FROM actions WHERE steamid=?1 AND type=?2 AND arg=?3 AND status IN ('pending','sent')")
      .bind(sid, type, value).first()
    if (dup) return { ok: true, queued: dup.id, note: "already queued" }
    const res = await env.DB.prepare(
      "INSERT INTO actions (steamid, type, arg, status, created_at) VALUES (?1,?2,?3,'pending',?4)")
      .bind(sid, type, value, Math.floor(Date.now() / 1000)).run()
    return { ok: true, queued: res && res.meta ? res.meta.last_row_id : 0 }
  } catch (e) {
    return { ok: false, error: "queue unavailable" }
  }
}

/** The newest Winterfest action for a player, for the page's status line. */
export async function lastWinterAction(env, steamid) {
  const sid = normalizeSteamid(steamid)
  if (!sid) return null
  try {
    const row = await env.DB.prepare(
      `SELECT type, arg, status, result, created_at FROM actions
       WHERE steamid=?1 AND type IN ('wf_tree_move','wf_tree_style')
       ORDER BY created_at DESC, id DESC LIMIT 1`).bind(sid).first()
    return row || null
  } catch { return null }
}
