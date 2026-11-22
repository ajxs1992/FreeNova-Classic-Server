// /v2/winter/gifts — Gift Openings, rebuilt on the v2 shell.
//
// The data is the old page's: winterContext() carries `state.gifts` (the game's
// winter_gifts claim ledger, newest first, ten rows), `state.giftCounts`
// (rarity -> openings) and `state.giftTotal` / `state.giftsFound`, and the
// reward and rarity names come from src/winter/catalog.js exactly as
// src/winter/gifts.js reads them. No new query, no write: the game logs an
// opening when the player types /opengift, and this page only reads the log.
//
// No invented rows. An empty ledger says what to do in game instead of drawing
// a placeholder present, and a rarity the catalogue does not name is labelled
// with its number, never with a guessed tier name ("Common" is a catalogue name,
// so it is only printed when the catalogue actually arrived).
import { esc, fmt } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon } from "../../art.js"
import { card, bar, emptyState } from "../../components.js"
import { rewardLabel, rewardType, rarityName, rarityColor, REWARD } from "../../../winter/catalog.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const RARITY_ROWS = 3 // WF_RARITY_MAX in winterfest.inc
const PARIS = "Europe/Paris"
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, day: "numeric", month: "short" })
const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", minute: "2-digit", hour12: false })

const int = v => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** "10 Dec · 13:20" from the ledger's unix seconds, in the season's timezone. */
function stamp(sec) {
  const n = int(sec)
  if (!n) return ""
  const d = new Date(n * 1000)
  return `${dayFmt.format(d)} · ${clockFmt.format(d)}`
}

/**
 * The catalogue's name for a rarity, or its number when the catalogue has not
 * published that row. rarityName() falls back to a NEUTRAL "Common" for a
 * missing row, which would label all three rarities the same — so the row has
 * to exist before its name is printed.
 */
function rarityLabel(cat, r) {
  const row = cat && Array.isArray(cat.rarities) ? cat.rarities[int(r)] : null
  return row && row.name ? rarityName(cat, r) : `Rarity ${int(r)}`
}

function rarityTone(cat, r) {
  const row = cat && Array.isArray(cat.rarities) ? cat.rarities[int(r)] : null
  return row && row.color ? rarityColor(cat, r) : "#8fa0b0"
}

/** The glyph on an opening: a picture for currency, an inline SVG for the rest. */
function giftGlyph(g) {
  const t = rewardType(g.type)
  if (t === REWARD.ORNAMENT) return ""
  if (t === REWARD.GIFT) return ""
  if (t === REWARD.PASS_XP) return ""
  if (t === REWARD.TITLE) return ""
  return artIcon("gingerbread", 16)
}

/** The community goal, only when the game pushed a real target. */
function communityOf(state) {
  const c = state && state.community
  if (!c || typeof c !== "object") return null
  const target = int(c.target)
  if (target <= 0) return null
  return { label: String(c.label || "Community goal"), current: Math.max(0, int(c.current)), target }
}

/** The page's view model — every field is a typed read of the old page's state. */
export function giftView(ctx) {
  const cat = ctx.cat
  const state = ctx.state || {}
  const rows = Array.isArray(state.gifts) ? state.gifts : []

  const tally = []
  let counted = 0
  for (let r = 0; r < RARITY_ROWS; r++) {
    const n = int(state.giftCounts && state.giftCounts.get ? state.giftCounts.get(r) : 0)
    counted += n
    tally.push({ rarity: r, n, label: rarityLabel(cat, r), tone: rarityTone(cat, r) })
  }

  const opened = int(state.giftTotal)
  const found = int(state.giftsFound)
  return {
    cat,
    rows,
    tally,
    counted,
    opened,
    found,
    total: Math.max(opened, found),
    seen: tally.filter(t => t.n > 0).length,
    community: communityOf(state)
  }
}

function openingRow(cat, g) {
  return `<div class="v2w-tlrow">
    <span aria-hidden="true">${giftGlyph(g)}</span>
    <span class="d">${esc(rewardLabel(cat, g.type, g.id, g.amount))}<small>${esc(stamp(g.openedAt))}</small></span>
    <span class="r"><i class="v2w-dot" style="background:${esc(rarityTone(cat, g.rarity))}"></i>${esc(rarityLabel(cat, g.rarity))}</span>
  </div>`
}

function openingsCard(v) {
  const sub = v.rows.length
    ? `last ${v.rows.length} · newest first`
    : "nothing logged yet"
  const body = v.rows.length
    ? `<div class="v2w-tl">${v.rows.map(g => openingRow(v.cat, g)).join("")}</div>
       <p class="v2w-note" style="margin-top:8px">The game's own claim ledger — an opening can never show a time it did not happen.</p>`
    : emptyState("No presents opened yet", "Presents spawn on the map during Winterfest. Walk over one in game and type /opengift: the first opening shows up here within a minute.")
  return card({
    head: { icon: artIcon("gingerbread", 26), title: "Your openings", sub },
    body
  })
}

function rarityCard(v) {
  const rows = v.tally.map(t => `<div class="v2w-rar">
    <span class="v2w-dot" style="background:${esc(t.tone)}"></span>
    <b>${esc(t.label)}</b>
    <span class="v2w-rarbar">${bar(t.n, v.counted)}</span>
    <em>${fmt(t.n)}</em>
  </div>`).join("")
  return card({
    head: { icon: "", title: "By rarity", sub: `${fmt(v.counted)} counted opening${v.counted === 1 ? "" : "s"}` },
    body: `<div class="v2w-rars">${rows}</div>
      <p class="v2w-note" style="margin-top:8px">Counts come from the ${fmt(v.opened)} opening${v.opened === 1 ? "" : "s"} the game pushed; a rarity with no row has not been opened yet.</p>`
  })
}

function totalCard(v) {
  const ledger = v.opened
    ? `${fmt(v.opened)} logged opening${v.opened === 1 ? "" : "s"}`
    : "nothing in the ledger yet"
  return card({
    head: { icon: "", title: "Total opened" },
    body: `<p class="v2w-big"><b>${fmt(v.total)}</b> <span>gift${v.total === 1 ? "" : "s"} found</span></p>
      <p class="v2w-note">${esc(ledger)} &middot; ${fmt(v.found)} reported by the game snapshot.</p>`
  })
}

function communityCard(c) {
  return card({
    head: { icon: "", title: "Community goal" },
    body: `<p class="v2w-big"><b>${esc(c.label)}</b></p>
      ${bar(c.current, c.target)}
      <p class="v2w-note" style="margin-top:8px">${fmt(c.current)} / ${fmt(c.target)} — counted by the game server, not by this page.</p>`
  })
}

function stripCards(v) {
  const found = card({
    head: { icon: artIcon("gingerbread", 24), title: "Presents found" },
    body: `<p class="v2w-big"><b>${fmt(v.found)}</b> <span>reported by the game</span></p>
      <p class="v2w-note">The snapshot the game server pushes for this player; it can run ahead of the ledger.</p>`
  })
  const logged = card({
    head: { icon: "", title: "Openings logged" },
    body: `<p class="v2w-big"><b>${fmt(v.opened)}</b> <span>in the claim ledger</span></p>
      <p class="v2w-note">One row per accepted /opengift — ${fmt(v.seen)} of ${RARITY_ROWS} rarity tiers seen so far.</p>`
  })
  const where = card({
    head: { icon: "", title: "Where they come from" },
    body: `<p class="v2w-note">Presents spawn on the map during Winterfest. Walk over one to pick it up, then type <code>/opengift</code> (or <code>/christmas</code>) to open it. Every ornament you find joins the <a href="/v2/winter/ornaments">collection book</a>.</p>`
  })
  return `${found}${logged}${where}`
}

export async function pageWinterGiftsV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = giftView(ctx)

  const hero = winterHero({
    title: "Gift Openings",
    sub: "Presents spawn across the maps during Winterfest — walk over one and open it in game.",
    badge: `<b>${fmt(v.found)}</b> found in game`
  })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${openingsCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${rarityCard(v)}${totalCard(v)}${v.community ? communityCard(v.community) : ""}</div>
</div>
<div class="v2w-strip">${stripCards(v)}</div>`

  return winterPage({
    title: "Gift Openings",
    active: "events",
    tab: "gifts",
    ctx,
    content: body,
    extraCss: GIFTS_CSS
  })
}

const GIFTS_CSS = `
.v2w-dot{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none;border:1px solid rgba(255,255,255,.28)}
.v2w-tlrow .r{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px}
.v2w-rars{display:grid;gap:7px}
.v2w-rar{display:grid;grid-template-columns:12px minmax(54px,auto) minmax(50px,1fr) auto;gap:8px;align-items:center;
  font-size:12.5px;color:#cfdaf5}
.v2w-rar b{font-weight:700;color:#eef2ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v2w-rar em{font-style:normal;font-weight:800;color:#eef2ff;font-variant-numeric:tabular-nums}
.v2w-rarbar .v2-bar{height:7px}
.v2w-strip .v2w-big{margin-bottom:4px}
`
