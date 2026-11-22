// FreeNova panel — the read-only query layer (docs/panel/00-CONTRACT.md).
//
// Every page reads through here and never touches a state table itself. Two rules:
//
//  1. READ ONLY. Nothing in this file writes a row. The one call it makes into the
//     state layer is ensureStateSchema(), which creates missing tables/columns and
//     never touches data — so a page cannot fail on a fresh database.
//  2. PARAMETERISED. Every value a caller supplies is a bound parameter (?1, ?2 …).
//     The only identifiers that appear in a statement body come from the frozen
//     maps below, never from a caller, so there is no SQL string concatenation in
//     this file to get wrong.
//
// A helper that has no data to give returns an empty list or an explicit null, not
// an invented number: "not collected yet" is a render decision the page makes from
// `null`, and a zero that means "unknown" is a bug (contract §Rules).

import { ensureStateSchema, MAX_TREE_SLOT, validSteamid, Refusal } from "./state.js"

async function allOn(db, sql, params) {
  const res = await db.prepare(sql).bind(...(params || [])).all()
  return (res && res.results) || []
}

function clampLimit(raw, fallback, max) {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

function sid(steamid) {
  const s = String(steamid || "")
  if (!validSteamid(s)) throw new Refusal("bad steamid")
  return s
}

// ------------------------------------------------------------------- boards --
// A top board is one metric, one statement, `LIMIT ?1`. The metric is never
// interpolated: a caller names a key in this map, and the map holds the SQL.
const BOARDS = Object.freeze({
  xp: {
    label: "XP",
    sql: `SELECT steamid, name, xp AS value FROM players WHERE xp > 0 ORDER BY xp DESC, steamid LIMIT ?1`
  },
  level: {
    label: "Level",
    sql: `SELECT steamid, name, level AS value FROM players WHERE level > 0 ORDER BY level DESC, xp DESC, steamid LIMIT ?1`
  },
  kills: {
    label: "Kills",
    sql: `SELECT steamid, name, kills AS value FROM players WHERE kills > 0 ORDER BY kills DESC, steamid LIMIT ?1`
  },
  coins: {
    label: "Coins",
    sql: `SELECT steamid, name, coins AS value FROM players WHERE coins > 0 ORDER BY coins DESC, steamid LIMIT ?1`
  },
  gingerbread: {
    label: "Gingerbread",
    // The winter currency lives in winter_players; the name comes from players
    // when the panel has a row for that steamid, and is empty otherwise.
    sql: `SELECT w.steamid AS steamid, COALESCE(p.name, '') AS name, w.snowflakes AS value
            FROM winter_players w LEFT JOIN players p ON p.steamid = w.steamid
           WHERE w.snowflakes > 0
           ORDER BY w.snowflakes DESC, w.steamid LIMIT ?1`
  }
})

export const BOARD_KEYS = Object.freeze(Object.keys(BOARDS))

function rankRows(rows) {
  return rows.map((r, i) => ({
    rank: i + 1,
    steamid: r.steamid,
    name: String(r.name || ""),
    value: Number(r.value || 0)
  }))
}

// All the top lists one page needs, from one call: { xp: [...], level: [...], … }.
// `boards` narrows which ones are read (a page that shows two lists does not pay
// for five).
export async function topBoards(db, opts) {
  await ensureStateSchema(db)
  const limit = clampLimit(opts && opts.limit, 15, 100)
  const wanted = (opts && Array.isArray(opts.boards) && opts.boards.length ? opts.boards : BOARD_KEYS)
    .filter(k => Object.prototype.hasOwnProperty.call(BOARDS, k))
  const out = {}
  for (const key of wanted) out[key] = rankRows(await allOn(db, BOARDS[key].sql, [limit]))
  return out
}

// ----------------------------------------------------------------- missions --
// The panel owns CLAIM STATE, not the mission ladder: what a mission pays and
// whether it is finished is the game's `winterfest/missions.ini`, published through
// the signed push (catalog key "winterfest"). What this returns is the one thing the
// panel can honestly answer — which missions this player has claimed, which are
// still queued, and why one was refused.
export async function missionsFor(db, steamid, opts) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const limit = clampLimit(opts && opts.limit, 60, 200)
  const rows = await allOn(db,
    `SELECT id, payload, state, idem, created_at, applied_at, error, result
       FROM winter_actions
      WHERE steamid=?1 AND kind='claim_mission'
      ORDER BY id DESC LIMIT ?2`, [sidValue, limit])
  return rows.map(r => {
    let payload = {}
    try { payload = JSON.parse(r.payload || "{}") } catch {}
    return {
      action_id: Number(r.id),
      mission: payload.mission == null ? "" : String(payload.mission),
      state: r.state,                       // pending | applied | refused
      idem: r.idem,
      created_at: Number(r.created_at || 0),
      applied_at: Number(r.applied_at || 0),
      error: r.error || "",
      paid: parseOrNull(r.result)
    }
  })
}

// ------------------------------------------------------------ achievements --
// What the panel has actually GRANTED this player as a badge or a title, from
// winter_inventory. The achievement ladder itself (achievements.ini) is game-side
// and is not mirrored here; a page that needs the ladder reads the pushed catalogue.
export async function achievements(db, steamid) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const rows = await allOn(db,
    `SELECT item, kind, equipped, acquired_at
       FROM winter_inventory
      WHERE steamid=?1 AND kind IN ('title', 'badge')
      ORDER BY acquired_at DESC, item`, [sidValue])
  return rows.map(r => ({
    item: r.item,
    kind: r.kind,
    equipped: Number(r.equipped || 0) === 1,
    acquired_at: Number(r.acquired_at || 0)
  }))
}

// --------------------------------------------------------------------- mail --
// The inbox. One row per message per recipient (schema.sql), unread first and then
// newest; an expired row is invisible but never deleted.
export async function mail(db, steamid, opts) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const limit = clampLimit(opts && opts.limit, 20, 100)
  const now = Math.trunc(Number(opts && opts.now)) || Math.floor(Date.now() / 1000)
  const rows = await allOn(db,
    `SELECT id, kind, title, body, created_at, read_at, expires_at, payload
       FROM winter_mail
      WHERE steamid=?1 AND (expires_at = 0 OR expires_at > ?2)
      ORDER BY (read_at = 0) DESC, created_at DESC, id DESC
      LIMIT ?3`, [sidValue, now, limit])
  return rows.map(r => ({
    id: Number(r.id),
    kind: r.kind,
    title: r.title || "",
    body: r.body || "",
    created_at: Number(r.created_at || 0),
    read_at: Number(r.read_at || 0),
    unread: Number(r.read_at || 0) === 0,
    expires_at: Number(r.expires_at || 0),
    payload: parseOrNull(r.payload)
  }))
}

// ---------------------------------------------------------------- tree slots --
// The 24 slots, always 24 and always in order: a slot with no row is `ornament: null`
// (empty), never a gap in the list, so a page can render a tree without inventing
// placeholders. `filled` counts the real rows.
export async function treeSlots(db, steamid) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const rows = await allOn(db,
    `SELECT slot, ornament, moved_at FROM winter_tree WHERE steamid=?1 ORDER BY slot`, [sidValue])
  const bySlot = new Map(rows.map(r => [Number(r.slot), r]))
  const slots = []
  for (let slot = 1; slot <= MAX_TREE_SLOT; slot++) {
    const row = bySlot.get(slot)
    slots.push({
      slot,
      ornament: row ? Number(row.ornament) : null,
      moved_at: row ? Number(row.moved_at || 0) : 0
    })
  }
  return { slots, filled: rows.length, capacity: MAX_TREE_SLOT }
}

// -------------------------------------------------------------- recent ledger --
// The last N currency movements with the balance each one left, newest first. This
// is the page-side view of winter_ledger; the append-only truth itself.
export async function recentLedger(db, steamid, opts) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const limit = clampLimit(opts && opts.limit, 20, 100)
  const rows = await allOn(db,
    `SELECT id, currency, delta, balance_after, reason, ref, action_id, created_at
       FROM winter_ledger
      WHERE steamid=?1
      ORDER BY id DESC LIMIT ?2`, [sidValue, limit])
  return rows.map(r => ({
    id: Number(r.id),
    currency: r.currency,
    delta: Number(r.delta || 0),
    balance_after: Number(r.balance_after || 0),
    reason: r.reason || "",
    ref: r.ref || "",
    action_id: Number(r.action_id || 0),
    created_at: Number(r.created_at || 0)
  }))
}

// --------------------------------------------------------- the queue, viewed --
// A player's own action rows, newest first — what a page shows as "queued" or
// "done". The game's side of the same rows is pendingActions() in src/state.js.
export async function recentActions(db, steamid, opts) {
  await ensureStateSchema(db)
  const sidValue = sid(steamid)
  const limit = clampLimit(opts && opts.limit, 10, 100)
  const rows = await allOn(db,
    `SELECT id, kind, payload, state, error, result, created_at, applied_at,
            game_state, game_acked_at
       FROM winter_actions
      WHERE steamid=?1
      ORDER BY id DESC LIMIT ?2`, [sidValue, limit])
  return rows.map(r => {
    let payload = {}
    try { payload = JSON.parse(r.payload || "{}") } catch {}
    return {
      action_id: Number(r.id),
      kind: r.kind,
      payload,
      state: r.state,
      error: r.error || "",
      result: parseOrNull(r.result),
      created_at: Number(r.created_at || 0),
      applied_at: Number(r.applied_at || 0),
      game_state: r.game_state || "",
      game_acked_at: Number(r.game_acked_at || 0)
    }
  })
}

function parseOrNull(text) {
  if (text == null || text === "") return null
  try { return JSON.parse(text) } catch { return null }
}
