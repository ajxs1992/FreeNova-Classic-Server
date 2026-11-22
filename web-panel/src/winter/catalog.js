// The Winterfest catalogue — the ornament book, the Advent table, the pass
// ladder and the three tree layouts, as the GAME publishes them.
//
// The game is the source of truth (docs/WINTERFEST.md §5.5 "everything is
// config"). It pushes one JSON document through the existing sync channel:
//
//   POST /api/v1/server/stats
//   { "catalogs": { "winterfest": { ...this shape... } } }
//
// sync.js already stores any `catalogs.<key>` into the `catalog` table, so this
// needs no change to sync.js. docs/WINTERFEST-PANEL.md carries the field table
// the game agent has to match; this module only ever validates and clamps what
// it is given, and never invents an ornament, a reward or a set.
//
// What it DOES carry on its own is the three tree LAYOUTS (classic / tall /
// wide, 24 slots each, owner decision §6.1). A layout is presentation, not
// player data: in game only the style name and the filled count are read, so
// the panel ships the geometry and lets the game's `[tree]` rows override it
// when the ini wants to move a slot.

export const TREE_SLOTS = 24
export const ADVENT_DAYS = 24
export const PASS_TIERS = 30

/** Reward kinds — the same enum winterfest.inc uses (WF_REWARD_*). */
export const REWARD = { NONE: 0, SNOWFLAKES: 1, ORNAMENT: 2, GIFT: 3, PASS_XP: 4, TITLE: 5 }
const REWARD_NAMES = {
  0: "none", 1: "snowflakes", 2: "ornament", 3: "gift", 4: "pass_xp", 5: "title"
}
// The names winterfest.ini uses in `[advent]`/`[pass]` are
// `snow | pass | ornament | gift | title`; the older/longer spellings are
// accepted so a payload written by hand still validates.
const REWARD_ALIASES = {
  snow: 1, snowflakes: 1, snowflake: 1, currency: 1,
  ornament: 2, orn: 2,
  gift: 3, present: 3,
  pass: 4, pass_xp: 4, passxp: 4, xp: 4,
  title: 5, set: 5
}

/** "snowflakes" | 1 | "SNOWFLAKES" -> 1. Anything unknown -> 0. */
export function rewardType(v) {
  if (v == null || v === "") return 0
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Math.trunc(Number(v))
    return n >= 0 && n <= 5 ? n : 0
  }
  const k = String(v).trim().toLowerCase().replace(/[\s-]/g, "_")
  if (Object.prototype.hasOwnProperty.call(REWARD_ALIASES, k)) return REWARD_ALIASES[k]
  return 0
}

export function rewardTypeName(t) { return REWARD_NAMES[rewardType(t)] || "none" }

const int = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : (fallback == null ? 0 : fallback)
}
const clampInt = (v, lo, hi, fallback) => Math.min(hi, Math.max(lo, int(v, fallback == null ? lo : fallback)))
const str = (v, max) => String(v == null ? "" : v).slice(0, max == null ? 64 : max)
const bool = v => v === true || v === 1 || v === "1" || v === "true" || v === "yes"

// ---------------------------------------------------------------- layouts --
// x/y are percentages of the tree box (0..100), the same units the ini's
// `[tree] style | name | slot | x | y` rows use.
function rowSlots(out, y, xs) {
  for (const x of xs) out.push({ slot: out.length + 1, x, y })
  return out
}

function spread(n, center, span) {
  if (n <= 1) return [center]
  const xs = []
  const step = span / (n - 1)
  for (let i = 0; i < n; i++) xs.push(Math.round((center - span / 2 + i * step) * 10) / 10)
  return xs
}

/**
 * The three layouts. Deterministic, no images, no fonts — the panel draws each
 * slot as a CSS box at (x%, y%).
 *   classic: a wide triangle, 2/4/5/6/7 ornaments per tier (24)
 *   tall:    a narrow 8-row column of 3 (24)
 *   wide:    a low 3-row band of 8 (24)
 */
export function fallbackStyles() {
  const classic = []
  for (const [i, n] of [2, 4, 5, 6, 7].entries()) {
    const span = 74 * (n / 7)
    rowSlots(classic, 8 + i * 19, spread(n, 50, span))
  }
  const tall = []
  for (let r = 0; r < 8; r++) rowSlots(tall, Math.round(6 + r * (88 / 7) * 10) / 10, [25, 50, 75])
  const wide = []
  for (const [i, y] of [20, 50, 80].entries()) rowSlots(wide, y, spread(8, 50, 88 + i * 0))
  return [
    { style: 1, name: "Classic", box: { w: 100, h: 340 }, slots: classic.slice(0, TREE_SLOTS) },
    { style: 2, name: "Tall", box: { w: 58, h: 520 }, slots: tall.slice(0, TREE_SLOTS) },
    { style: 3, name: "Wide", box: { w: 100, h: 230 }, slots: wide.slice(0, TREE_SLOTS) }
  ]
}

// ------------------------------------------------------------------ load ---
function emptyCatalog(reason) {
  return {
    ok: false,
    reason: reason || "not pushed yet",
    version: 0,
    updatedAt: 0,
    season: null,
    rarities: [],
    ornaments: [],
    sets: [],
    advent: [],
    pass: [],
    tree: [],
    community: null,
    styles: fallbackStyles(),
    ornamentById: new Map(),
    setById: new Map()
  }
}

function normalizeList(v) { return Array.isArray(v) ? v : [] }

function normalize(raw, version, updatedAt) {
  const cat = emptyCatalog()
  cat.ok = true
  cat.reason = ""
  cat.version = int(version, 0)
  cat.updatedAt = int(updatedAt, 0)

  if (raw && typeof raw === "object" && raw.season && typeof raw.season === "object")
    cat.season = raw.season

  // rarities: id is the game's index (0..WF_RARITY_MAX-1)
  const rarities = normalizeList(raw && raw.rarities)
  for (const r of rarities) {
    if (!r || typeof r !== "object") continue
    const id = clampInt(r.id, 0, 2, rarities.indexOf(r))
    cat.rarities[id] = {
      id,
      name: str(r.name, 24) || "Rarity " + id,
      color: colourOf(r.color),
      weight: Math.max(0, int(r.weight, 0))
    }
  }

  // sets (the "secret collections")
  for (const s of normalizeList(raw && raw.sets)) {
    if (!s || typeof s !== "object") continue
    const id = clampInt(s.id, 1, 8, 0)
    if (!id || cat.setById.has(id)) continue
    cat.setById.set(id, {
      id,
      name: str(s.name, 32) || "Set " + id,
      title: str(s.title, 40),
      snowflakes: Math.max(0, int(s.snowflakes != null ? s.snowflakes : s.snow, 0)),
      // A set is not "secret" in winterfest.ini: the `hidden` flag lives on the
      // ORNAMENT rows. `secret` is still accepted here for a future season that
      // wants to hide a whole collection's title.
      secret: bool(s.secret != null ? s.secret : s.hidden)
    })
  }
  cat.sets = [...cat.setById.values()].sort((a, b) => a.id - b.id)

  // ornaments (WF_MAX_ORNAMENTS = 64)
  const seenOrn = new Set()
  for (const o of normalizeList(raw && raw.ornaments)) {
    if (!o || typeof o !== "object") continue
    const id = clampInt(o.id, 1, 64, 0)
    if (!id || seenOrn.has(id)) continue
    seenOrn.add(id)
    const entry = {
      id,
      name: str(o.name, 40) || "Ornament " + id,
      rarity: clampInt(o.rarity, 0, 2, 0),
      set: clampInt(o.set, 0, 8, 0),
      // winterfest.ini's fifth [ornament] column is `hidden`: 1 means the panel
      // and /ornaments print "? ? ?" until the player owns it.
      secret: bool(o.secret != null ? o.secret : o.hidden)
    }
    cat.ornamentById.set(id, entry)
  }
  cat.ornaments = [...cat.ornamentById.values()].sort((a, b) => a.id - b.id)

  // advent days 1..24
  for (const a of normalizeList(raw && raw.advent)) {
    if (!a || typeof a !== "object") continue
    const day = clampInt(a.day, 1, ADVENT_DAYS, 0)
    if (!day) continue
    cat.advent[day] = {
      day,
      type: rewardType(a.type != null ? a.type : a.reward_type),
      id: Math.max(0, int(a.id != null ? a.id : a.reward_id, 0)),
      amount: Math.max(0, int(a.amount, 0)),
      label: str(a.label, 60)
    }
  }

  // pass tiers 1..30 (free track only — there is no premium field anywhere)
  for (const p of normalizeList(raw && raw.pass)) {
    if (!p || typeof p !== "object") continue
    const tier = clampInt(p.tier, 1, PASS_TIERS, 0)
    if (!tier) continue
    cat.pass[tier] = {
      tier,
      xp: Math.max(0, int(p.xp, 0)),
      type: rewardType(p.type != null ? p.type : p.reward_type),
      id: Math.max(0, int(p.id != null ? p.id : p.reward_id, 0)),
      amount: Math.max(0, int(p.amount, 0)),
      label: str(p.label, 60)
    }
  }

  // tree styles: the ini's rows win over the built-in geometry
  const styles = new Map()
  for (const t of normalizeList(raw && raw.tree)) {
    if (!t || typeof t !== "object") continue
    const style = clampInt(t.style, 1, 3, 0)
    if (!style) continue
    let s = styles.get(style)
    if (!s) {
      s = { style, name: str(t.name, 24) || "Style " + style, box: null, slots: [] }
      styles.set(style, s)
    }
    const slots = Array.isArray(t.slots) ? t.slots : null
    if (slots) {
      for (const sl of slots) {
        if (!sl || typeof sl !== "object") continue
        const slot = clampInt(sl.slot, 1, TREE_SLOTS, 0)
        if (!slot) continue
        s.slots.push({ slot, x: clampInt(sl.x, 0, 100, 50), y: clampInt(sl.y, 0, 100, 50) })
      }
    } else {
      const slot = clampInt(t.slot, 1, TREE_SLOTS, 0)
      if (slot) s.slots.push({ slot, x: clampInt(t.x, 0, 100, 50), y: clampInt(t.y, 0, 100, 50) })
    }
  }
  if (styles.size) {
    const fallback = fallbackStyles()
    cat.styles = fallback.map(f => {
      const pushed = styles.get(f.style)
      if (!pushed) return f
      const slots = dedupeSlots(pushed.slots)
      return {
        style: f.style,
        name: pushed.name || f.name,
        box: slots.length >= TREE_SLOTS ? { w: 100, h: 400 } : f.box,
        slots: slots.length ? slots : f.slots
      }
    })
  }

  if (raw && raw.community && typeof raw.community === "object") {
    cat.community = {
      key: str(raw.community.key, 24) || "goal",
      label: str(raw.community.label, 48) || "Community goal",
      current: Math.max(0, int(raw.community.current, 0)),
      target: Math.max(0, int(raw.community.target, 0))
    }
  }
  return cat
}

function dedupeSlots(slots) {
  const byId = new Map()
  for (const s of slots || []) if (s && s.slot && !byId.has(s.slot)) byId.set(s.slot, s)
  return [...byId.values()].sort((a, b) => a.slot - b.slot).slice(0, TREE_SLOTS)
}

/**
 * Read the pushed catalogue. Never throws: a missing row, corrupt JSON or a
 * pre-Winterfest database all render the honest "not published yet" state.
 */
export async function loadCatalog(env) {
  let row = null
  // A pre-Winterfest database may not even have the table: that is "not pushed
  // yet", not an error, and it must still fall through to the §9 fallback.
  try {
    row = await env.DB.prepare("SELECT json, version, updated_at FROM catalog WHERE key='winterfest'").bind().first()
  } catch { row = null }
  let raw = null
  let version = 0
  let updatedAt = 0
  if (row && row.json) {
    try {
      raw = JSON.parse(row.json)
      version = row.version
      updatedAt = row.updated_at
    } catch { return emptyCatalog("catalogue JSON is invalid") }
  }
  if (!raw) {
    // docs/WINTERFEST-DEV.md §9 carries the catalogue inside the player blob.
    // It is a fallback, never a second source of truth: only used when the
    // static catalogs.winterfest document has not been pushed.
    try {
      const m = await env.DB.prepare("SELECT value, updated_at FROM winter_meta WHERE key=?1").bind("catalog").first()
      if (m && m.value) { raw = JSON.parse(m.value); updatedAt = m.updated_at }
    } catch { raw = null }
    if (!raw) return emptyCatalog("not pushed yet")
  }
  if (!raw || typeof raw !== "object") return emptyCatalog("catalogue JSON is not an object")
  try { return normalize(raw, version, updatedAt) } catch { return emptyCatalog("catalogue could not be read") }
}

/**
 * The same validation the loader applies, for a payload that has not been
 * stored yet (the unit checks drive this directly).
 */
export function normalizeWinterCatalog(raw, version, updatedAt) {
  if (!raw || typeof raw !== "object") return emptyCatalog("catalogue JSON is not an object")
  try { return normalize(raw, version, updatedAt) } catch { return emptyCatalog("catalogue could not be read") }
}

// --------------------------------------------------------------- helpers ---
const NEUTRAL = { id: 0, name: "Common", color: "#9aa7b4", weight: 0 }

export function rarity(cat, id) {
  const r = cat && cat.rarities ? cat.rarities[clampInt(id, 0, 2, 0)] : null
  return r || NEUTRAL
}
export function rarityColor(cat, id) { return rarity(cat, id).color }
export function rarityName(cat, id) { return rarity(cat, id).name }

export function ornament(cat, id) {
  const o = cat && cat.ornamentById ? cat.ornamentById.get(int(id, 0)) : null
  return o || null
}

/** The catalogue name, or an id-only placeholder when the game has not sent it. */
export function ornamentName(cat, id) {
  const o = ornament(cat, id)
  return o ? o.name : "Ornament #" + int(id, 0)
}

/** A locked entry may only show its name when the catalogue does not mark it secret. */
export function ornamentLockedLabel(cat, id) {
  const o = ornament(cat, id)
  if (o && o.secret) return "? ? ?"
  return o ? o.name : "? ? ?"
}

export function ornamentSet(cat, id) {
  const o = ornament(cat, id)
  if (!o || !o.set) return null
  return cat.setById.get(o.set) || null
}

export function ornamentsOfSet(cat, setId) {
  return (cat && cat.ornaments ? cat.ornaments : []).filter(o => o.set === int(setId, 0))
}

export function setTitle(cat, setId, ownedAll) {
  const s = cat && cat.setById ? cat.setById.get(int(setId, 0)) : null
  if (!s) return ""
  if (s.secret && !ownedAll) return "? ? ?"
  return s.title || s.name
}

export function treeStyle(cat, style) {
  const styles = (cat && cat.styles) || fallbackStyles()
  const id = clampInt(style, 1, 3, 1)
  return styles.find(s => s.style === id) || styles[0]
}

export function adventEntry(cat, day) {
  return cat && cat.advent ? (cat.advent[int(day, 0)] || null) : null
}

export function passEntry(cat, tier) {
  return cat && cat.pass ? (cat.pass[int(tier, 0)] || null) : null
}

/**
 * The ladder the panel draws: always 30 rungs (Phase 1, free track only). The
 * catalogue fills in the XP floor and the reward per rung; a rung it does not
 * publish renders as "not published" rather than as an invented reward.
 */
export function passMaxTier() { return PASS_TIERS }

/** How many rungs the game actually published (for the honest footer line). */
export function passPublishedTiers(cat) {
  let n = 0
  for (let t = 1; t <= PASS_TIERS; t++) if (passEntry(cat, t)) n++
  return n
}

/**
 * The tier an XP total opens, from the catalogue's own XP floors. Only used
 * when the game has not pushed a tier: the pushed tier always wins.
 */
export function passTierFromXp(cat, xp) {
  let tier = 1
  for (let t = 1; t <= PASS_TIERS; t++) {
    const p = passEntry(cat, t)
    if (p && int(xp, 0) >= p.xp) tier = p.tier
  }
  return tier
}

/** XP still needed for the next rung, and the rung's floor. */
export function passNext(cat, tier, xp) {
  const t = clampInt(tier, 1, PASS_TIERS, 1)
  if (t >= PASS_TIERS) return { tier: t, floor: null, need: 0, at: null }
  const cur = passEntry(cat, t)
  const next = passEntry(cat, t + 1)
  const floor = cur ? cur.xp : null
  if (!next) return { tier: t + 1, floor, need: 0, at: null }
  return {
    tier: t + 1,
    floor,
    at: next.xp,
    need: Math.max(0, next.xp - int(xp, 0))
  }
}

/**
 * What a reward is, in words. `amount` is the ini's magnitude column (snowflakes
 * for `snow`, XP for `pass`); the id names a catalogue entry for the rest.
 * Never guesses: an unknown id says its number.
 */
export function rewardLabel(cat, type, id, amount) {
  const kind = rewardType(type)
  const n = Math.max(0, int(id, 0))
  const qty = Math.max(0, int(amount, 0))
  if (kind === REWARD.SNOWFLAKES) {
    const v = qty || n
    return v + " snowflake" + (v === 1 ? "" : "s")
  }
  if (kind === REWARD.ORNAMENT) {
    const o = ornament(cat, n)
    return o ? "Ornament: " + o.name : "Ornament #" + n
  }
  if (kind === REWARD.GIFT) return "a present (" + (rarityName(cat, n) || "common") + ")"
  if (kind === REWARD.PASS_XP) {
    const v = qty || n
    return "Winter Pass XP +" + v
  }
  if (kind === REWARD.TITLE) {
    const s = cat && cat.setById ? cat.setById.get(n) : null
    return s ? "Title: " + (s.title || s.name) : "Title #" + n
  }
  return "unknown reward"
}

/** "#9aa7b4" or the ini's "190 220 255" -> a hex colour the CSS can use. */
export function colourOf(v) {
  const s = String(v == null ? "" : v).trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  const m = /^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/.exec(s)
  if (m) {
    const hex = [m[1], m[2], m[3]].map(x => Math.min(255, Math.max(0, Number(x))).toString(16).padStart(2, "0")).join("")
    return "#" + hex
  }
  return "#9aa7b4"
}
