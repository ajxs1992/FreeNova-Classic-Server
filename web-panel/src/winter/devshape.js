// Accept the payload shape the game-side document proposes.
//
// `docs/WINTERFEST-DEV.md` §9 (written after this surface was designed) describes
// what the core agent expects the panel to need — one RENDERED blob per push:
//
//   winterfest: {
//     season:    { name, year, start, end, advent_end, open, days_left },
//     wallet:    { snowflakes },
//     presents:  [ { instance, rarity, rarity_name, opened } ],
//     ornaments: [ { id, name, rarity, set, owned, hidden } ],
//     sets:      [ { id, name, title, owned, total, complete } ],
//     tree:      { style, style_name, level, filled, slots: [ {slot, ornament_id, x, y} ] },
//     advent:    [ { day, reward_text, claimed, claimable, late_half_value } ],
//     pass:      { tier, xp, next_xp, max_tier, tiers: [ {tier, xp, reward_text, claimed} ] },
//     titles:    [ set_id ]
//   }
//
// The panel's own contract (docs/WINTERFEST-PANEL.md §3) keeps the catalogue in
// one static push and the per-player state in another, because that is cheaper
// on the wire and the catalogue is the same for every player. Rather than make
// the two documents argue, this module TRANSLATES §9 into the same internal
// rows — so the panel works whichever shape the game implements first, with no
// second source of truth: everything below is copied from the payload, nothing
// is derived from what the panel thinks the ini says.
//
// Two things this module deliberately does NOT do:
//   * it never invents an ornament, a set, a tier or a reward: a field that is
//     absent stays absent, and the page says "not published yet";
//   * it never treats `open`/`claimable` as authority for a claim — the claim
//     ledger is the game's, so only `claimed: true` / `opened: true` is stored.

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : (d == null ? 0 : d)
}
const truthy = v => v === true || v === 1 || v === "1" || v === "true" || v === "yes"

function looksLikeDevShape(v) {
  if (!v || typeof v !== "object") return false
  return ("wallet" in v) || ("presents" in v) || ("tree" in v) || ("pass" in v) ||
    ("ornaments" in v) || ("advent" in v)
}

/** Every §9 blob in a push, as { steamid, blob }. */
export function devShapeBlobs(payload) {
  const out = []
  if (!payload || typeof payload !== "object") return out
  if (payload.winterfest && looksLikeDevShape(payload.winterfest))
    out.push({ steamid: payload.winterfest.steamid || payload.steamid, blob: payload.winterfest })
  if (Array.isArray(payload.players)) {
    for (const p of payload.players) {
      if (!p || !looksLikeDevShape(p.winterfest)) continue
      out.push({ steamid: p.winterfest.steamid || p.steamid, blob: p.winterfest })
    }
  }
  return out
}

/** One §9 blob -> the internal per-player row `applyWinterPayload` writes. */
export function playerFromDevShape(steamid, blob) {
  const b = blob && typeof blob === "object" ? blob : {}
  const tree = b.tree && typeof b.tree === "object" ? b.tree : null
  const slots = tree && Array.isArray(tree.slots) ? tree.slots.filter(Boolean) : null
  const presents = Array.isArray(b.presents) ? b.presents.filter(Boolean) : null
  const ornaments = Array.isArray(b.ornaments) ? b.ornaments.filter(Boolean) : null
  const advent = Array.isArray(b.advent) ? b.advent.filter(Boolean) : null
  const pass = b.pass && typeof b.pass === "object" ? b.pass : null

  const row = { steamid, at: b.at }
  if (b.wallet && typeof b.wallet === "object") row.snowflakes = int(b.wallet.snowflakes, 0)
  else if (b.snowflakes != null) row.snowflakes = int(b.snowflakes, 0)
  if (tree) {
    row.tree_style = int(tree.style, 1)
    row.tree_level = int(tree.level, 0)
  }
  if (ornaments) {
    row.ornaments = ornaments.filter(o => truthy(o.owned)).map(o => int(o.id, 0)).filter(Boolean)
    row.ornaments_total = ornaments.length
  }
  if (slots) row.tree = slots.map(s => ({ slot: int(s.slot, 0), ornament: int(s.ornament_id != null ? s.ornament_id : s.ornament, 0) }))
  if (advent) row.advent = advent.filter(a => truthy(a.claimed)).map(a => ({ day: int(a.day, 0), at: a.at || a.claimed_at }))
  if (presents) {
    // Only opened presents belong in the ledger; a carried-but-unopened one is
    // the game's business and never a row here.
    const opened = presents.filter(p => truthy(p.opened) || truthy(p.is_open))
    row.gifts_found = presents.length
    row.gifts = opened.map(p => ({
      instance: int(p.instance, 0),
      rarity: int(p.rarity, 0),
      type: p.type != null ? p.type : p.reward_type,
      id: int(p.id != null ? p.id : p.reward_id, 0),
      amount: int(p.amount, 0),
      at: p.at || p.opened_at,
      key: p.key || ("present#" + int(p.instance, 0))
    }))
  }
  if (pass) row.pass = { xp: int(pass.xp, 0), tier: int(pass.tier, 0) }
  return row
}

/**
 * The catalogue a §9 blob implies: ornament rows with their `hidden` flag, set
 * names/titles, and the reward TEXT for advent days and pass rungs. Stored as a
 * fallback for when the game has not pushed `catalogs.winterfest` (the panel
 * prefers the static catalogue when it has one).
 */
export function catalogFromDevShape(blob) {
  const b = blob && typeof blob === "object" ? blob : {}
  const out = {}
  if (Array.isArray(b.ornaments) && b.ornaments.length) {
    out.ornaments = b.ornaments.filter(Boolean).map(o => ({
      id: int(o.id, 0),
      name: o.name,
      rarity: int(o.rarity, 0),
      set: int(o.set, 0),
      hidden: truthy(o.hidden) ? 1 : 0
    })).filter(o => o.id > 0)
  }
  if (Array.isArray(b.sets) && b.sets.length) {
    out.sets = b.sets.filter(Boolean).map(s => ({
      id: int(s.id, 0),
      name: s.name,
      title: s.title,
      snow: int(s.snow != null ? s.snow : s.snowflakes, 0)
    })).filter(s => s.id > 0)
  }
  if (Array.isArray(b.advent) && b.advent.length) {
    out.advent = b.advent.filter(Boolean).map(a => ({
      day: int(a.day, 0),
      label: a.reward_text || a.label || ""
    })).filter(a => a.day >= 1)
  }
  if (b.pass && typeof b.pass === "object" && Array.isArray(b.pass.tiers)) {
    out.pass = b.pass.tiers.filter(Boolean).map(t => ({
      tier: int(t.tier, 0),
      xp: int(t.xp, 0),
      label: t.reward_text || t.label || ""
    })).filter(t => t.tier >= 1)
  }
  if (b.season && typeof b.season === "object" && (b.season.start || b.season.year)) {
    out.season = {
      name: b.season.name, year: int(b.season.year, 0),
      start: b.season.start, end: b.season.end, advent_end: b.season.advent_end,
      enabled: b.season.enabled == null ? 1 : (truthy(b.season.enabled) ? 1 : 0)
    }
  }
  return Object.keys(out).length ? out : null
}

/** Merge a translated catalogue over a stored one (new rows win, others stay). */
export function mergeCatalogRows(existing, incoming) {
  const base = existing && typeof existing === "object" ? existing : {}
  const add = incoming && typeof incoming === "object" ? incoming : {}
  const byId = (a, b) => {
    const map = new Map()
    for (const r of Array.isArray(a) ? a : []) if (r && r.id) map.set(r.id, r)
    for (const r of Array.isArray(b) ? b : []) {
      const id = r && (r.id != null ? r.id : r.day != null ? r.day : r.tier)
      if (id != null) map.set(id, r)
    }
    return [...map.values()].sort((x, y) => (x.id || x.day || x.tier) - (y.id || y.day || y.tier))
  }
  return {
    ...base,
    ...add,
    ornaments: byId(base.ornaments, add.ornaments),
    sets: byId(base.sets, add.sets),
    advent: byId(base.advent, add.advent),
    pass: byId(base.pass, add.pass),
    season: add.season || base.season || null
  }
}
