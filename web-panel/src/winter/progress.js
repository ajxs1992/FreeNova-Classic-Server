// Derived Winterfest numbers — pure functions, no DB.
//
// Every page (hub, tree, ornaments, advent, pass) asks this module the same
// questions so that "Advent 7/24" cannot mean one thing on the hub and another
// on the calendar. Nothing here invents a reward or a set: what the catalogue
// does not publish is reported as unpublished, not filled in with a placeholder.

import {
  TREE_SLOTS, ADVENT_DAYS, PASS_TIERS, REWARD,
  adventEntry, passEntry, passNext, passTierFromXp, ornamentsOfSet,
  rewardLabel
} from "./catalog.js"
import { parisDate } from "./season.js"

/**
 * Advent state for every day 1..24.
 *   claimed  the game's claim ledger has the day
 *   today    the day is unlocked today and not claimed
 *   missed   unlocked on an earlier day and not claimed (catch-up, half value)
 *   locked   not unlocked yet
 */
export function adventStatus(season, state) {
  const today = season && season.adventOpen ? season.dayOfMonth : 0
  const claimed = state && state.advent ? state.advent : new Map()
  const days = []
  let claimableNow = 0
  let missedCount = 0
  let claimedFull = 0
  let claimedHalf = 0
  for (let day = 1; day <= ADVENT_DAYS; day++) {
    const claimedAt = claimed.get(day) || 0
    let status
    if (claimedAt) status = "claimed"
    else if (!today || day > today) status = "locked"
    else if (day === today) status = "today"
    else status = "missed"
    if (status === "today" || status === "missed") claimableNow++
    if (status === "missed") missedCount++
    // Claimed on the day itself is full value; a catch-up claim is half
    // (owner decision §6.3). We know the claim timestamp, so this is derived,
    // never assumed.
    let full = false
    if (status === "claimed") {
      const p = parisDate(claimedAt)
      full = !!season && p.y === season.year && p.m === 12 && p.d === day
      if (full) claimedFull++
      else claimedHalf++
    }
    days.push({ day, status, claimedAt, full })
  }
  let nextDay = 0
  for (const d of days) if (d.day <= (today || 0) && !d.claimedAt) { nextDay = d.day; break }
  const nextLocked = days.find(d => d.status === "locked") || null
  return {
    days,
    today,
    claimedCount: days.filter(d => d.status === "claimed").length,
    claimableNow,
    missedCount,
    claimedFull,
    claimedHalf,
    total: ADVENT_DAYS,
    nextDay,
    nextLockedDay: nextLocked ? nextLocked.day : 0
  }
}

/** The Winter Pass ladder, current rung and the next three rewards. */
export function passStatus(cat, state) {
  const xp = state && state.pass ? Math.max(0, state.pass.xp) : 0
  const pushedTier = state && state.pass ? Math.max(0, state.pass.tier) : 0
  const tier = Math.min(PASS_TIERS, Math.max(1, pushedTier || passTierFromXp(cat, xp)))
  const cur = passEntry(cat, tier)
  const floor = cur ? cur.xp : 0
  const next = passNext(cat, tier, xp)
  const span = next.at != null ? Math.max(1, next.at - floor) : 0
  const into = Math.max(0, xp - floor)
  const pct = span ? Math.max(0, Math.min(100, Math.round((into * 100) / span))) : (tier >= PASS_TIERS ? 100 : 0)
  const upcoming = []
  for (let t = tier + 1; t <= PASS_TIERS && upcoming.length < 3; t++) {
    const p = passEntry(cat, t)
    if (!p) continue
    const label = p.label || (p.type !== REWARD.NONE ? rewardLabel(cat, p.type, p.id, p.amount) : "")
    if (!label) continue
    upcoming.push({ tier: t, xp: p.xp, label })
  }
  const ladder = []
  for (let t = 1; t <= PASS_TIERS; t++) {
    const p = passEntry(cat, t)
    ladder.push({
      tier: t,
      xp: p ? p.xp : null,
      label: p ? (p.label || (p.type !== REWARD.NONE ? rewardLabel(cat, p.type, p.id, p.amount) : "")) : "",
      state: t < tier ? "done" : t === tier ? "now" : "locked"
    })
  }
  return {
    xp, tier, floor, into, span, pct,
    next, upcoming, ladder,
    maxTier: PASS_TIERS,
    atMax: tier >= PASS_TIERS,
    published: !!cur || !!next.at
  }
}

/** Tree completion, level and the next set milestone. */
export function treeStatus(cat, state) {
  const filled = state && state.slots ? state.slots.size : 0
  const total = TREE_SLOTS
  const pct = Math.round((filled * 100) / total)
  const sets = setProgress(cat, state)
  const incomplete = sets
    .filter(s => s.total > 0 && s.owned < s.total)
    .sort((a, b) => (b.owned / b.total) - (a.owned / a.total) || a.id - b.id)
  const nextSet = incomplete.length ? incomplete[0] : null
  return {
    filled,
    total,
    pct,
    level: state && state.treeLevel ? state.treeLevel : filled,
    sets,
    completeSets: sets.filter(s => s.complete).length,
    nextSet,
    nextMilestone: nextSet
      ? `${nextSet.name}: ${nextSet.owned}/${nextSet.total} (${nextSet.total - nextSet.owned} to go)`
      : (sets.length ? "every set complete" : "")
  }
}

/** Per-set ownership; a secret set hides its title until the set is complete. */
export function setProgress(cat, state) {
  const owned = (state && state.ownedIds) || new Set()
  const out = []
  const sets = (cat && cat.sets) || []
  for (const s of sets) {
    const items = ornamentsOfSet(cat, s.id)
    const have = items.filter(o => owned.has(o.id)).length
    const complete = items.length > 0 && have === items.length
    out.push({
      id: s.id,
      name: s.name,
      title: s.secret ? (complete ? s.title || s.name : "? ? ?") : (s.title || s.name),
      secret: !!s.secret,
      snowflakes: s.snowflakes,
      owned: have,
      total: items.length,
      complete,
      ornaments: items
    })
  }
  return out
}

/** Collection-book totals, including ornaments that belong to no set. */
export function ornamentStatus(cat, state) {
  const owned = (state && state.ownedIds) || new Set()
  const catalogue = (cat && cat.ornaments) || []
  const known = new Set(catalogue.map(o => o.id))
  const extra = [...owned].filter(id => !known.has(id)).sort((a, b) => a - b)
  const ownedInCatalogue = catalogue.filter(o => owned.has(o.id)).length
  return {
    ownedTotal: owned.size,
    catalogueTotal: catalogue.length,
    missing: catalogue.length - ownedInCatalogue,
    ownedInCatalogue,
    extra,
    pct: catalogue.length ? Math.round((ownedInCatalogue * 100) / catalogue.length) : 0
  }
}

/** The hub's three headlines. Always returns up to three entries. */
export function headlines(cat, season, state) {
  const out = []
  const adv = adventStatus(season, state)
  const pass = passStatus(cat, state)
  const tree = treeStatus(cat, state)

  if (adv.nextDay) {
    const label = adv.nextDay === adv.today
      ? `Day ${adv.nextDay} of the Advent calendar is ready to claim.`
      : `Day ${adv.nextDay} was missed — claim it at half value before the season closes.`
    out.push({ kicker: "ADVENT", text: label, href: "/winter/advent" })
  } else if (adv.nextLockedDay) {
    const entry = adventEntry(cat, adv.nextLockedDay)
    const reward = entry && entry.type !== REWARD.NONE ? ` — ${rewardLabel(cat, entry.type, entry.id, entry.amount)}` : ""
    out.push({
      kicker: "ADVENT",
      text: adv.today
        ? `Day ${adv.nextLockedDay} unlocks tomorrow${reward}.`
        : `Day ${adv.nextLockedDay} unlocks on ${adv.nextLockedDay} December${reward}.`,
      href: "/winter/advent"
    })
  } else if (adv.claimedCount >= ADVENT_DAYS) {
    out.push({ kicker: "ADVENT", text: "Every Advent day is claimed.", href: "/winter/advent" })
  }

  if (!pass.atMax) {
    const upcoming = pass.upcoming[0]
    out.push({
      kicker: "WINTER PASS",
      text: upcoming && pass.next.at != null
        ? `Tier ${upcoming.tier}: ${upcoming.label} — ${pass.next.need} XP to go.`
        : pass.next.at == null
          ? `Tier ${pass.tier} — ${pass.xp} XP. The next rung's XP floor has not been pushed by the game yet.`
          : `Tier ${pass.tier + 1} needs ${pass.next.need} more XP.`,
      href: "/winter/pass"
    })
  } else {
    out.push({ kicker: "WINTER PASS", text: "Tier 30 reached — the free track is complete.", href: "/winter/pass" })
  }

  if (state && state.community && Number(state.community.target) > 0) {
    const c = state.community
    const pct = Math.min(100, Math.round((Number(c.current) * 100) / Number(c.target)))
    out.push({
      kicker: "COMMUNITY GOAL",
      text: `${c.label || "Community goal"}: ${Math.max(0, Number(c.current) || 0)} / ${Number(c.target)} (${pct}%)`,
      href: "/winter/gifts"
    })
  } else if (tree.nextSet) {
    out.push({
      kicker: "YOUR TREE",
      text: `${tree.filled}/${tree.total} slots filled — next set ${tree.nextSet.name} ${tree.nextSet.owned}/${tree.nextSet.total}.`,
      href: "/winter/tree"
    })
  } else if (tree.filled === 0) {
    out.push({ kicker: "YOUR TREE", text: "Your tree is empty — open a present in game to find your first ornament.", href: "/winter/tree" })
  }
  return out.slice(0, 3)
}
