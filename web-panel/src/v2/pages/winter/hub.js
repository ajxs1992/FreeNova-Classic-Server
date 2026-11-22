// /v2/winter — the hub, rebuilt: seven doors into the family with the live
// number behind each one, and the season's clock underneath.
//
// Every number here is the old /winter hub's own helper over the same context —
// adventStatus, treeStatus, passStatus and ornamentStatus from
// src/winter/progress.js over winterContext()'s { season, cat, state } — plus the
// inbox's unreadCount() and the winter_meta spin row the top-bar chip reads
// (src/v2/data/winter.js::chipsOf). The gift numbers come from the sibling
// page's giftView(), so the hub and /v2/winter/gifts can never disagree. No new
// query, and nothing here writes: this page is a set of links with the counters
// beside them.
//
// ZERO STATE. Every door prints the shape its number takes once the season fills
// in — "0 / 24 claimed", "0 opened", "0% decorated" — because a real zero is
// information and a guessed number is not. When the panel has no snapshot for
// the player at all, the page says so instead of dressing the zeros up.
import { esc, fmt } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon, BIG } from "../../art.js"
import { card, sectionHeading, emptyState } from "../../components.js"
import { adventStatus, passStatus, treeStatus, ornamentStatus } from "../../../winter/progress.js"
import { unreadCount } from "../../../winter/mail.js"
import { winterContext } from "../../data/winter.js"
import { giftView } from "./gifts.js"
import { winterPage, winterHero } from "./shared.js"

const PARIS = "Europe/Paris"
const monthDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
const fullDay = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, day: "numeric", month: "short", year: "numeric" })

const int = v => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** "20261201" or "2026-12-01" -> "1 Dec"; anything else is printed as it came. */
function keyDay(key) {
  const s = String(key || "")
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s)
  if (!m) return s
  const d = new Date(Date.UTC(int(m[1]), int(m[2]) - 1, int(m[3])))
  return monthDay.format(d)
}

/** Days between now and an epoch second, rounded up; 0 once it has passed. */
function daysUntil(now, sec) {
  const t = int(sec)
  if (!t) return 0
  return Math.max(0, Math.ceil((t - int(now)) / 86400))
}

/**
 * The spin counter, read the way the top-bar chip reads it: the winter_meta
 * "spin" payload, this player's row. `null` means the game has not mirrored it,
 * which the door says instead of printing a comfortable zero.
 */
function spinsOf(ctx) {
  const payload = ctx.meta && ctx.meta.get ? ctx.meta.get("spin") : null
  const players = payload && typeof payload === "object" ? payload.players : null
  const row = players && ctx.sid && typeof players === "object" ? players[ctx.sid] : null
  if (!row || typeof row !== "object" || row.spins == null) return null
  return Math.max(0, int(row.spins))
}

/** The whole page's view model. */
export async function hubView(ctx) {
  const season = ctx.season
  const adv = adventStatus(season, ctx.state)
  const pass = passStatus(ctx.cat, ctx.state)
  const tree = treeStatus(ctx.cat, ctx.state)
  const orn = ornamentStatus(ctx.cat, ctx.state)
  const gifts = giftView(ctx)
  const unread = ctx.sid ? await unreadCount(ctx.env, ctx.sid, ctx.nowSec) : 0
  return {
    season,
    now: int(ctx.nowSec),
    adv,
    pass,
    tree,
    orn,
    gifts,
    spins: spinsOf(ctx),
    unread: Math.max(0, int(unread)),
    found: !!ctx.state.found
  }
}

/** The seven doors, in the reference's order, each with its live number. */
function doors(v) {
  const spins = v.spins === null
    ? "not mirrored yet"
    : `${fmt(v.spins)} spin${v.spins === 1 ? "" : "s"} left`
  return [
    {
      href: "/v2/winter/advent",
      icon: artIcon("advent", 34),
      title: "Advent",
      line: v.adv.today
        ? `Day ${fmt(v.adv.today)} · ${fmt(v.adv.claimedCount)} claimed`
        : `${fmt(v.adv.claimedCount)} / ${fmt(v.adv.total)} claimed`
    },
    {
      href: "/v2/winter/tree",
      icon: artIcon("tree", 34),
      title: "Tree",
      line: `${fmt(v.tree.pct)}% decorated`
    },
    {
      href: "/v2/winter/gifts",
      icon: artIcon("gingerbread", 34),
      title: "Gifts",
      line: `${fmt(v.gifts.opened)} opened`
    },
    {
      href: "/v2/winter/ornaments",
      icon: artIcon("bauble", 34),
      title: "Ornaments",
      line: v.orn.catalogueTotal
        ? `${fmt(v.orn.ownedInCatalogue)} / ${fmt(v.orn.catalogueTotal)} found`
        : `${fmt(v.orn.ownedTotal)} owned`
    },
    {
      href: "/v2/winter/pass",
      icon: artIcon("crown", 34),
      title: "Battle Pass",
      line: `Lv. ${fmt(v.pass.tier)} · ${fmt(v.pass.xp)} XP`
    },
    {
      href: "/v2/winter/spin",
      icon: artIcon("spintoken", 34),
      title: "Spin Wheel",
      line: spins
    },
    {
      href: "/v2/winter/mail",
      icon: artIcon("envelope", 34),
      title: "Mail",
      line: `${fmt(v.unread)} unread`
    }
  ]
}

function doorCards(v) {
  return doors(v).map(d => `<a class="v2w-door" href="${esc(d.href)}">
    <span class="v2w-door-ic" aria-hidden="true">${d.icon}</span>
    <b>${esc(d.title)}</b>
    <span class="v2w-door-n">${esc(d.line)}</span>
  </a>`).join("")
}

function phaseCard(v) {
  const s = v.season
  const phase = s.phase
  const big = phase === "open" ? "Live now"
    : phase === "before" ? "Not open yet"
      : phase === "disabled" ? "Switched off"
        : "Closed"
  const note = phase === "open"
    ? `${s.name || "Winterfest"} ${s.year || ""} is running.`
    : phase === "before"
      ? `${s.name || "Winterfest"} ${s.year || ""} opens on ${keyDay(s.startKey)}.`
      : phase === "disabled"
        ? "Winterfest is switched off on this deployment."
        : `${s.name || "Winterfest"} ${s.year || ""} has closed.`
  return card({
    head: { icon: "", title: "Season" },
    body: `<p class="v2w-big"><b>${esc(big)}</b></p>
      <p class="v2w-note">${esc(note)}</p>`
  })
}

function daysCard(v) {
  const s = v.season
  const phase = s.phase
  const body = phase === "open"
    ? `<p class="v2w-big"><b>${fmt(s.daysLeft)}</b> <span>day${int(s.daysLeft) === 1 ? "" : "s"} left</span></p>
       <p class="v2w-note">Counted to the close of ${fullDay.format(new Date(int(s.closesAt) * 1000))}.</p>`
    : phase === "before"
      ? `<p class="v2w-big"><b>${fmt(daysUntil(v.now, s.opensAt))}</b> <span>day${daysUntil(v.now, s.opensAt) === 1 ? "" : "s"} to go</span></p>
         <p class="v2w-note">The calendar opens on 1 December, and day 1 is claimable that day only.</p>`
      : phase === "disabled"
        ? `<p class="v2w-big"><b>&mdash;</b> <span>no season planned</span></p>
           <p class="v2w-note">Nothing is counting down.</p>`
        : `<p class="v2w-big"><b>0</b> <span>days left</span></p>
           <p class="v2w-note">The season has closed — the numbers in the doors are the final ones.</p>`
  return card({ head: { icon: "", title: "Time left" }, body })
}

function closesCard(v) {
  const s = v.season
  const closes = int(s.closesAt)
  const body = closes
    ? `<p class="v2w-big"><b>${esc(fullDay.format(new Date(closes * 1000)))}</b></p>
       <p class="v2w-note">The last whole second of the season, ${PARIS} time. Window ${esc(keyDay(s.startKey))} &ndash; ${esc(keyDay(s.endKey))}.</p>`
    : `<p class="v2w-big"><b>&mdash;</b> <span>no close date</span></p>
       <p class="v2w-note">The season configuration has no closing day, so this page will not invent one.</p>`
  return card({ head: { icon: "", title: "Closes" }, body })
}

export async function pageWinterHubV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = await hubView(ctx)

  const hero = winterHero({
    title: "Winterfest",
    sub: "Doors into every Winterfest page, with the number each one is counting.",
    badge: `<b>${esc(String(v.season.year || ""))}</b> &middot; ${esc(keyDay(v.season.startKey))} &ndash; ${esc(keyDay(v.season.endKey))}`,
    artRight: { src: BIG.santa, w: 1024, h: 1536 }
  })

  const zero = v.found
    ? ""
    : emptyState("No Winterfest snapshot for this player yet", "Open /christmas in game once and these counters fill in within a minute. Until then every door shows its zero shape rather than a guess.")

  const body = `${hero}
${sectionHeading({ icon: "", text: "Winterfest pages" })}
<div class="v2w-doors">${doorCards(v)}</div>
<div class="v2w-strip">${phaseCard(v)}${daysCard(v)}${closesCard(v)}</div>
${zero}
<p class="v2w-note">The same adapters the dashboard's chips read: Advent from the game's claim ledger, the tree from your slots, the pass from its XP, gifts from the opening log, spins from the mirrored counter and mail from the inbox. Every page behind a door is read-only — claims and openings happen in game.</p>`

  return winterPage({
    title: "Hub",
    active: "dashboard",
    tab: "hub",
    ctx,
    content: body,
    extraCss: HUB_CSS
  })
}

const HUB_CSS = `
.v2w-doors{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:clamp(8px,0.8vw,12px)}
.v2w-door{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:3px;
  padding:11px 8px 10px;border-radius:14px;min-width:0;text-align:center;text-decoration:none;color:var(--v2-text);
  background:linear-gradient(180deg,#141d44 0%, #0d1434 100%);border:1px solid var(--v2-border);
  box-shadow:inset 0 1px 0 rgba(130,160,230,.18), 0 8px 18px rgba(0,0,0,.3);
  transition:border-color .15s,box-shadow .15s,transform .15s}
.v2w-door:hover,.v2w-door:focus-visible{border-color:#9a7be8;color:var(--v2-text);transform:translateY(-1px);
  box-shadow:0 0 0 1px rgba(124,92,214,.4), 0 12px 24px rgba(0,0,0,.38)}
.v2w-door-ic{line-height:0;margin-bottom:2px}
.v2w-door b{font-size:12.5px;font-weight:800;letter-spacing:.2px;line-height:1.15}
.v2w-door-n{max-width:100%;font-size:11px;font-weight:700;line-height:1.25;color:var(--v2-gold);
  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v2w-strip .v2w-big{margin-bottom:4px}
/* the Santa is an opaque portrait, so the hero frames it as a picture instead of
   pretending it is cut-out art (no upscale: it is 1024x1536, drawn ~150px tall) */
.v2w-art{border-radius:14px;border:1px solid rgba(150,180,255,.35)}
@media (max-width:1180px){
  .v2w-doors{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (max-width:820px){
  .v2w-doors{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`
