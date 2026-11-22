// The Spin Wheel's DATA — the wheel, its odds, and the read of the panel mirror.
//
// WHY THIS FILE EXISTS SEPARATELY FROM spin.js
//   The page is only half the deliverable: the wheel's contents must be a
//   checkable fact, not markup. So the sectors live here as plain data, the odds
//   are computed from the weights in one place, and the test suite
//   (web-panel/test_harness.mjs, "spin wheel" section) parses
//   configs/freenova/winterfest/spin.ini from disk and fails if this file and
//   that file ever disagree. spin.js then only draws.
//
// WHAT THIS FILE IS NOT
//   It is not the authority on anything a player owns. The game owns the spin
//   counter (winterfest_core), the prizes and every claim; the panel cannot write
//   any of it (docs/WINTERFEST-SPIN.md §6). `loadSpinMirror` reads what the game
//   has pushed and reports honestly when that is nothing, so no number on the
//   page can be invented.
//
// PALETTE (docs/design/WINTERFEST-DASHBOARD.md, sampled from the owner's
// reference): page #0b1030, card #0d1430, border #2a3d6e, gold #f5c451,
// green #3fbf6f, ice blue #4070c0, muted #9fb0d0.

/** The four wheel rarities: the reveal colour and what the fade threshold means. */
export const SPIN_RARITIES = {
  common: { label: "Common", color: "#9fb0d0", glow: "#3a4a72" },
  uncommon: { label: "Uncommon", color: "#3fbf6f", glow: "#1d4530" },
  rare: { label: "Rare", color: "#4070c0", glow: "#1b3055" },
  legendary: { label: "Legendary", color: "#f5c451", glow: "#4a3a12" },
}

/** The prize kinds spin.ini may use, with the word a player reads. */
export const SPIN_KINDS = {
  gingerbread: { label: "GingerBread", note: "Winterfest currency, paid through the game's ledger" },
  coins: { label: "Coins", note: "the permanent coin wallet" },
  ornament: { label: "Ornament", note: "for your tree" },
  title: { label: "Title", note: "a collector title from an ornament set" },
  spin: { label: "Spin", note: "another turn of the wheel" },
  gift: { label: "Present", note: "a present to open in game" },
  nothing: { label: "Nothing", note: "the wheel stopped on a gap" },
}

/**
 * [wheel] from spin.ini. `freePerDay`/`resetHour`/`timezone` describe the DAILY
 * FREE SPIN, which the core grants (winterfest_core's [spins] block, claim key
 * spin#<YYYYMMDD>): this module displays them and never grants them itself.
 */
export const SPIN_WHEEL = {
  freePerDay: 1,
  resetHour: 0,
  timezone: "Europe/Paris",
  max: 10,
  fadeRarity: "rare",
  stepSeconds: 0.65,
  enabled: true,
}

/**
 * [sector] from spin.ini, in file order = wheel order. `amount` is the magnitude
 * for gingerbread/coins/spin, the rarity index for gift, the set id for title,
 * and the ornament id (0 = a random one you do not own) for ornament.
 */
export const SPIN_SECTORS = [
  { label: "Nothing", kind: "nothing", amount: 0, weight: 12, rarity: "common" },
  { label: "5 GingerBread", kind: "gingerbread", amount: 5, weight: 20, rarity: "common" },
  { label: "15 GingerBread", kind: "gingerbread", amount: 15, weight: 18, rarity: "common" },
  { label: "25 Coins", kind: "coins", amount: 25, weight: 12, rarity: "common" },
  { label: "75 Coins", kind: "coins", amount: 75, weight: 10, rarity: "uncommon" },
  { label: "1 Extra Spin", kind: "spin", amount: 1, weight: 8, rarity: "uncommon" },
  { label: "Common Present", kind: "gift", amount: 0, weight: 9, rarity: "common" },
  { label: "Mystery Ornament", kind: "ornament", amount: 0, weight: 6, rarity: "uncommon" },
  { label: "Collector Title", kind: "title", amount: 6, weight: 3, rarity: "rare" },
  { label: "Rare Present", kind: "gift", amount: 2, weight: 2, rarity: "rare" },
]

/** Weights sum. Never 0: a wheel with no weight cannot be drawn or audited. */
export function spinTotalWeight(sectors = SPIN_SECTORS) {
  const total = sectors.reduce((a, s) => a + Math.max(0, Number(s.weight) || 0), 0)
  return total > 0 ? total : 1
}

/**
 * The odds, exactly as the game rolls them: a sector's chance is its weight over
 * the sum, and the SVG's slice angle is the same fraction, so the picture cannot
 * disagree with the table.
 */
export function spinOdds(sectors = SPIN_SECTORS) {
  const total = spinTotalWeight(sectors)
  return sectors.map((s, i) => {
    const weight = Math.max(0, Number(s.weight) || 0)
    const pct = (weight * 100) / total
    return {
      ...s,
      index: i + 1,
      weight,
      pct,
      pctText: pct.toFixed(1),
      fraction: weight / total,
    }
  })
}

/** The weight of a rarity or better: what the fade threshold is worth. */
export function rarityWeight(rarity, sectors = SPIN_SECTORS) {
  const order = Object.keys(SPIN_RARITIES)
  const from = order.indexOf(rarity)
  if (from < 0) return { weight: 0, pct: 0 }
  const weight = sectors
    .filter(s => order.indexOf(s.rarity) >= from)
    .reduce((a, s) => a + Math.max(0, Number(s.weight) || 0), 0)
  return { weight, pct: (weight * 100) / spinTotalWeight(sectors) }
}

/**
 * A prize in words, using the pushed catalogue when it has the entry and the
 * bare number when it does not (the same "never invent a name" rule the other
 * winter pages follow).
 */
export function prizeText(cat, sector) {
  const kind = String((sector && sector.kind) || "")
  const amount = Math.max(0, Number(sector && sector.amount) || 0)
  if (kind === "nothing") return "nothing"
  if (kind === "gingerbread") return amount + " GingerBread"
  if (kind === "coins") return amount + " coin" + (amount === 1 ? "" : "s")
  if (kind === "spin") return amount + " extra spin" + (amount === 1 ? "" : "s")
  if (kind === "gift") {
    const r = cat && cat.rarities ? cat.rarities[amount] : null
    return (r && r.name ? String(r.name).toLowerCase() : ["common", "uncommon", "rare"][amount] || "common") + " present"
  }
  if (kind === "ornament") {
    if (!amount) return "a random ornament you do not own yet"
    const o = cat && cat.ornamentById ? cat.ornamentById.get(amount) : null
    return o ? "ornament: " + o.name : "ornament #" + amount
  }
  if (kind === "title") {
    const s = cat && cat.setById ? cat.setById.get(amount) : null
    if (s) return "collector title: " + (s.title || s.name)
    return "a collector title (set #" + amount + ")"
  }
  return kind || "unknown"
}

// --------------------------------------------------------------------------
// The mirror. The game pushes; the panel reads. Nothing here writes.
// --------------------------------------------------------------------------
/**
 * The spin counter and the last results, if the game has ever pushed them.
 *
 * Two reads, both DEFENSIVE because neither column nor table exists in the
 * shipped schema yet (docs/WINTERFEST-SPIN.md §6 has the exact DDL for whoever
 * adds them):
 *
 *   winter_players.spins, winter_players.spin_serial   the counter + claim serial
 *   winter_spin_log (steamid, serial, sector, label, kind, amount, rarity,
 *                    claim_key, at)                     one row per paid spin
 *
 * `ok` is false when neither read worked, which is the shipped deployment today:
 * the page then says so instead of printing a comfortable zero.
 */
export async function loadSpinMirror(env, sid, limit = 10) {
  const out = { ok: false, spins: null, serial: null, results: [], missing: [] }
  if (!env || !env.DB || !sid) {
    out.missing.push("no database")
    return out
  }

  const first = async (sql, ...args) => {
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
    } catch { return null }
  }

  const row = await first("SELECT spins, spin_serial FROM winter_players WHERE steamid=?1", sid)
  if (row && row.spins != null) {
    out.spins = Number(row.spins) || 0
    out.serial = row.spin_serial == null ? null : Number(row.spin_serial) || 0
    out.ok = true
  } else {
    out.missing.push("winter_players.spins")
  }

  const rows = await many(
    `SELECT serial, sector, label, kind, amount, rarity, claim_key, at
       FROM winter_spin_log WHERE steamid=?1 ORDER BY at DESC, serial DESC LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10))}`,
    sid,
  )
  if (rows === null) {
    out.missing.push("winter_spin_log")
  } else {
    out.ok = true
    out.results = rows.map(r => ({
      serial: Number(r.serial) || 0,
      sector: Number(r.sector) || 0,
      label: String(r.label || ""),
      kind: String(r.kind || ""),
      amount: Number(r.amount) || 0,
      rarity: String(r.rarity || ""),
      claimKey: String(r.claim_key || ""),
      at: Number(r.at) || 0,
    }))
  }
  return out
}

/**
 * The next daily reset as a unix timestamp, from the configured hour and the
 * Paris calendar. Mirrors what the game tells a player ("in 4h 12m") and is
 * rendered through winterTime(), so a browser shows it in the reader's own
 * timezone and the server-rendered text stays Europe/Paris.
 */
export function nextResetAt(nowSec, resetHour = SPIN_WHEEL.resetHour, midnightFn, partsFn) {
  const now = Math.floor(Number(nowSec) || 0)
  const hour = Math.max(0, Math.min(23, Number(resetHour) || 0))
  if (!midnightFn || !partsFn) return now
  const today = partsFn(now)
  let at = midnightFn(today.y, today.m, today.d) + hour * 3600
  if (at <= now) {
    const tomorrow = partsFn(now + 86400)
    at = midnightFn(tomorrow.y, tomorrow.m, tomorrow.d) + hour * 3600
  }
  return at
}
