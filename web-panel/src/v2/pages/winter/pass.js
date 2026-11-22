// /v2/winter/pass — the Winterfest Battle Pass, rebuilt.
//
// The data is the old page's, reused whole: passStatus(cat, state)
// (src/winter/progress.js) over the catalogue's [pass] rows and the player's
// mirrored XP (winter_pass), through the family's one read pass (winterContext).
// No new query, no new SQL, and nothing here grants XP or a tier.
//
// OWNER RULE (§6.2, and docs/design/SPEC-MATRIX.md ## 05-battlepass): the
// ladder is the FREE TRACK, all 30 rungs. The premium track is an entitlement
// (`bp_premium_2026`) with no published price and no web checkout, so this page
// says exactly that: no price, no "buy", no premium column the catalogue cannot
// fill. A rung the catalogue does not publish says "Not published" rather than
// inventing a reward.
import { esc, fmt } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon, BIG } from "../../art.js"
import { card, bar, emptyState } from "../../components.js"
import { passStatus } from "../../../winter/progress.js"
import { PASS_TIERS, passEntry, passPublishedTiers, rewardLabel, REWARD } from "../../../winter/catalog.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

/** The glyph a rung's reward is drawn with — generated art where a PNG exists. */
const REWARD_ART = {
  [REWARD.SNOWFLAKES]: "gingerbread",
  [REWARD.ORNAMENT]: "bauble",
  [REWARD.GIFT]: "gift",
  [REWARD.PASS_XP]: "star",
  [REWARD.TITLE]: "crown"
}

const RUNG_STATE = {
  done: { cls: "done", icon: "check" },
  now: { cls: "now", icon: "arrow" },
  locked: { cls: "locked", icon: "lock" }
}

/** What rung N pays, in words; "" when the catalogue has no row for it. */
function rewardOf(cat, tier) {
  const e = passEntry(cat, tier)
  if (!e) return ""
  if (e.label) return e.label
  if (e.type === REWARD.NONE) return ""
  return rewardLabel(cat, e.type, e.id, e.amount)
}

/** The reward's type number, for choosing its art. */
function typeOf(cat, tier) {
  const e = passEntry(cat, tier)
  return e ? e.type : REWARD.NONE
}

function rungArt(type) {
  const name = REWARD_ART[type]
  return name ? artIcon(name, 22, { cls: "sm" }) : ""
}

/**
 * The page's view model: passStatus as it is, plus one readable reward per
 * rung. `known` is false when the visit is not tied to a player — the ladder is
 * still true, the tier is not, so nothing is highlighted.
 */
export function passView(ctx) {
  const { cat, state } = ctx
  const pass = passStatus(cat, state)
  const known = !!ctx.sid

  const rungs = pass.ladder.map(r => ({
    tier: r.tier,
    xp: r.xp,
    reward: rewardOf(cat, r.tier),
    type: typeOf(cat, r.tier),
    state: known ? r.state : "locked"
  }))

  return {
    known,
    tier: known ? pass.tier : 0,
    maxTier: pass.maxTier || PASS_TIERS,
    xp: pass.xp,
    floor: pass.floor,
    into: pass.into,
    span: pass.span,
    pct: pass.pct,
    next: pass.next,
    atMax: pass.atMax,
    published: pass.published,
    upcoming: pass.upcoming || [],
    rungs,
    rungsPublished: passPublishedTiers(cat)
  }
}

// ------------------------------------------------------------------ the rungs --
function rungTile(r) {
  const st = RUNG_STATE[r.state] || RUNG_STATE.locked
  const art = rungArt(r.type)
  return `<div class="v2w-rung ${st.cls}"${r.state === "now" ? ' aria-current="step"' : ""}>
    <span class="top"><span class="n">Tier ${r.tier}</span><span class="st" aria-hidden="true">${icon(st.icon, 13)}</span></span>
    <span class="rw${r.reward ? "" : " np"}">${art}<span class="tx">${r.reward ? esc(r.reward) : "Not published"}</span></span>
    <span class="xp">${r.xp == null ? "No XP floor published" : `${fmt(r.xp)} XP`}</span>
  </div>`
}

function ladderNote(v) {
  const n = v.rungsPublished
  if (!n) return "The game has not published a single rung yet: there are 30 tier numbers, but every XP floor and reward still says \"Not published\"."
  if (n < v.maxTier) return `${n} of ${v.maxTier} rungs are published by the game. The rest say "Not published" rather than guess a reward.`
  return `All ${v.maxTier} rungs are published by the game: the XP floor is the catalogue's, and the tier you reach is the game's, not this page's.`
}

function ladderCard(v) {
  return card({
    head: {
      icon: artIcon("crown", 26),
      title: "The 30-Rung Ladder",
      sub: "Free track — tier, the catalogue's XP floor, and what the rung pays."
    },
    body: `<div class="v2w-rungs">${v.rungs.map(rungTile).join("")}</div>
    <div class="v2w-legend">
      <span class="c"><i></i>unlocked</span>
      <span class="t"><i></i>current tier</span>
      <span class="l"><i></i>locked</span>
    </div>
    <p class="v2w-note" style="margin-top:8px">${esc(ladderNote(v))}</p>`
  })
}

// -------------------------------------------------------------- the player ---
function progressNote(v) {
  const xp = `${fmt(v.xp)} Winter Pass XP`
  if (v.atMax) return `Tier ${v.maxTier} is the top of the free track. ${xp} banked, and tier ${v.maxTier} starts at ${v.floor == null ? "an unpublished floor" : fmt(v.floor) + " XP"}.`
  if (!v.published) return `The game has not pushed this ladder's XP floors yet, so only the total is shown: ${xp}.`
  const next = v.next && v.next.at != null
    ? `tier ${v.next.tier} starts at ${fmt(v.next.at)} XP`
    : `the next rung has no published XP floor yet`
  // A push can lag behind the XP it carries; then "into / span" would read as
  // more XP than the rung holds, so show the two published floors instead.
  const into = v.span > 0 && v.into <= v.span
    ? `${fmt(v.into)} / ${fmt(v.span)} XP into tier ${v.tier} (${v.pct}%)`
    : `tier ${v.tier} starts at ${v.floor == null ? "an unpublished floor" : fmt(v.floor) + " XP"}`
  return `${xp} · ${into} · ${next}.`
}

function progressCard(v) {
  const head = {
    icon: artIcon("star", 26),
    title: "Your Tier",
    sub: v.known ? `Tier ${v.tier} of ${v.maxTier}` : "No player identified"
  }
  const big = `<p class="v2w-big"><b>${v.known ? `Tier ${v.tier}` : "&mdash;"}</b> <span>of ${v.maxTier}</span></p>`
  const body = v.known
    ? `${big}${bar(v.pct)}<p class="v2w-note">${esc(progressNote(v))}</p>`
    : `${big}${emptyState("No player on this visit", "Open this page from your session, or add ?steamid= to the address, and the tier you have reached appears here.")}<p class="v2w-note">The ladder below is the same for every player.</p>`
  return card({ head, body })
}

function xpCard(v) {
  return card({
    head: { icon: artIcon("star", 24), title: "Winter Pass XP", sub: "Awarded by the game, never here" },
    body: `<p class="v2w-big"><b>${v.known ? fmt(v.xp) : "&mdash;"}</b> <span>XP</span></p>
    <p class="v2w-note">XP comes from opening <a href="/v2/winter/gifts">presents</a>, <a href="/v2/winter/advent">Advent</a> claims and Christmas <a href="/missions">missions</a>. This page reads the game's mirror and awards nothing.</p>`
  })
}

function nextCard(v) {
  if (!v.known) {
    return card({
      head: { icon: icon("arrow", 24), title: "Next Rung", sub: "No player identified" },
      body: `<p class="v2w-big"><b>&mdash;</b> <span>nothing to advance</span></p>
      <p class="v2w-note">The next rung is counted from the tier you have reached, which this page only knows once the visit is tied to a player.</p>`
    })
  }
  const n = v.next || { tier: v.tier + 1, at: null, need: 0 }
  let big, note
  if (v.atMax) {
    big = `<p class="v2w-big"><b>Free track complete</b> <span>tier ${v.maxTier}</span></p>`
    note = "There is nothing left above tier 30 on the free track."
  } else if (n.at != null) {
    big = `<p class="v2w-big"><b>Tier ${n.tier}</b> <span>starts at ${fmt(n.at)} XP</span></p>`
    note = n.need > 0
      ? `${fmt(n.need)} XP to go from tier ${v.tier}.`
      : `Your XP already meets tier ${n.tier}'s ${fmt(n.at)} XP floor — the tier itself is opened by the game.`
  } else {
    big = `<p class="v2w-big"><b>Tier ${n.tier}</b> <span>no published XP floor</span></p>`
    note = "The game has not published the next rung's XP floor yet, so this page will not guess one."
  }
  return card({
    head: { icon: icon("arrow", 24), title: "Next Rung", sub: `Tier ${v.tier} of ${v.maxTier} now` },
    body: `${big}<p class="v2w-note">${esc(note)}</p>`
  })
}

function upcomingCard(v) {
  const rows = v.upcoming.length
    ? v.upcoming.map(u => `<div class="v2w-tlrow">
        <span aria-hidden="true">${icon("arrow", 15)}</span>
        <span class="d">Tier ${u.tier}<small>starts at ${fmt(u.xp)} XP</small></span>
        <span class="r">${esc(u.label)}</span>
      </div>`).join("")
    : emptyState("No rewards published yet", "The next rungs appear here as soon as the game pushes them.")
  return card({
    head: { icon: artIcon("gift", 24), title: "Next Rewards", sub: "The next published rungs, in order" },
    body: `<div class="v2w-tl">${rows}</div>`
  })
}

// ------------------------------------------------------------- the premium ---
/**
 * The premium track, honestly: it is an entitlement the game grants, not a
 * product this panel sells. No price is printed because none is published, and
 * the page never says it is for sale.
 */
function premiumCard() {
  return card({
    head: { icon: artIcon("vip", 26), title: "Premium Track", sub: "An entitlement the game grants — not a purchase" },
    body: `<div class="v2w-pass">
      <div class="v2w-pass-art">
        ${artIcon("vip", 40)}
        <div>
          <p class="v2w-big" style="margin:0"><b>bp_premium_2026</b></p>
          <p class="v2w-note" style="margin:2px 0 0">The entitlement flag the game server reads.</p>
        </div>
      </div>
      <ul>
        <li>${icon("check", 15)}Marks your account as a premium pass holder</li>
        <li>${icon("check", 15)}What it unlocks is decided by the game server, not this page</li>
        <li>${icon("check", 15)}No premium reward list is published to the panel, so no premium column is drawn here</li>
      </ul>
      <span class="v2w-cta" aria-disabled="true" title="There is no web checkout for the premium pass; it is granted in game">${""}No web checkout</span>
      <p class="v2w-note" style="margin:0">No price for <code>bp_premium_2026</code> is published to the panel and there is no web checkout, so this page does not sell it. An admin grants the entitlement in game.</p>
    </div>`
  })
}

// ------------------------------------------------------------------ styles ---
const PASS_CSS = `
.v2w-rungs{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
.v2w-rung{position:relative;display:flex;flex-direction:column;gap:3px;padding:8px 9px 7px;border-radius:12px;
  background:linear-gradient(180deg,#141d44 0%, #0d1434 100%);border:1px solid var(--v2-border);min-height:86px}
.v2w-rung .top{display:flex;align-items:center;gap:6px}
.v2w-rung .n{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#93a3c8}
.v2w-rung .st{margin-left:auto;line-height:0;opacity:.9}
.v2w-rung .rw{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;line-height:1.2;color:#eef2ff}
.v2w-rung .rw .tx{min-width:0}
.v2w-rung .rw.np .tx{color:#8593b8;font-weight:700}
.v2w-rung .rw img,.v2w-rung .rw svg{flex:none}
.v2w-rung .xp{margin-top:auto;font-size:10.5px;font-weight:700;color:#8c9cc4;letter-spacing:.2px;font-variant-numeric:tabular-nums}
.v2w-rung.done{border-color:#2f7d55;background:linear-gradient(180deg,#14351f 0%, #0c2416 100%)}
.v2w-rung.done .n{color:#8ef0b4}
.v2w-rung.done .rw{color:#c8f2d6}
.v2w-rung.now{border-color:#e0b445;background:linear-gradient(180deg,#3a2a0c 0%, #241708 100%);
  box-shadow:0 0 0 1px rgba(240,200,90,.35), 0 10px 22px rgba(150,110,10,.25)}
.v2w-rung.now .n{color:#ffe08a}
.v2w-rung.now .rw{color:#fff3cf}
.v2w-rung.now .xp{color:#ffd77a}
.v2w-rung.locked{opacity:.74}
`

// -------------------------------------------------------------------- page ---
export async function pageWinterPassV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = passView(ctx)

  const hero = winterHero({
    title: "Winterfest Battle Pass",
    sub: "Thirty rungs, one free track — earned in game, never bought here",
    badge: `${artIcon("crown", 18)}<b>${esc(String(ctx.season.year || 2026))}</b> &middot; ${v.maxTier} tiers`,
    artLeft: { src: BIG.tree, w: 1024, h: 1536 },
    artRight: { src: BIG.santa, w: 1024, h: 1536 }
  })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${ladderCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${progressCard(v)}${premiumCard()}</div>
</div>
<div class="v2w-strip">${xpCard(v)}${nextCard(v)}${upcomingCard(v)}</div>`

  return winterPage({
    title: "Winterfest Battle Pass",
    active: "pass",
    tab: "pass",
    ctx,
    content: body,
    extraCss: PASS_CSS
  })
}
