// /v2/winter/advent — the 24-day calendar, rebuilt.
//
// The data is the old page's: adventStatus(season, state) over the player's
// winter_advent claims, and the catalogue's [advent] rows for what each day pays
// (src/winter/catalog.js, loaded by loadCatalog). No new query, no write, no
// invented reward: a day the catalogue does not publish says so.
//
// THE OWNER'S RULE (2026-11-22, final, and this page is the first to state it):
// a day is claimable ON ITS DATE ONLY. After midnight it is expired — not
// discounted, not claimable. At the end of the season the whole calendar can be
// unlocked at once by the Advent Pass. The half-value catch-up the old page was
// written with does not appear here at all: no "still claimable", no "half".
import { esc } from "../../theme.js"
import { icon } from "../../icons.js"
import { card, bar } from "../../components.js"
import { adventStatus } from "../../../winter/progress.js"
import { adventEntry, rewardLabel, REWARD, ADVENT_DAYS } from "../../../winter/catalog.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const PARIS = "Europe/Paris"
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, day: "numeric", month: "short" })

/** "Dec 4" from a unix second count, in the season's timezone. */
function stamp(sec) {
  return sec ? dayFmt.format(new Date(Number(sec) * 1000)) : ""
}

/** What day N pays, in words; "" when the catalogue has no row for it. */
function rewardOf(cat, day) {
  const e = adventEntry(cat, day)
  if (!e) return ""
  if (e.label) return e.label
  if (e.type === REWARD.NONE) return ""
  // the currency was renamed: the catalogue still calls it snowflakes
  if (e.type === REWARD.SNOWFLAKES) return `${e.amount || e.id} GingerBread`
  return rewardLabel(cat, e.type, e.id, e.amount)
}

/** The glyph on a claimed row: gingerbread, ornament, present, pass XP, title. */
function rewardIcon(cat, day) {
  const e = adventEntry(cat, day)
  const t = e ? e.type : REWARD.NONE
  if (t === REWARD.ORNAMENT) return ""
  if (t === REWARD.GIFT) return ""
  if (t === REWARD.PASS_XP) return ""
  if (t === REWARD.TITLE) return ""
  return ""
}

/**
 * The page's view model. Statuses come straight from adventStatus; the half
 * catch-up it still counts for legacy rows is deliberately not surfaced.
 */
export function adventView(ctx) {
  const { season, cat, state } = ctx
  const adv = adventStatus(season, state)
  const open = !!season.adventOpen
  const today = open ? adv.today : 0

  const days = adv.days.map(d => {
    const status = d.status === "missed" ? "expired" : d.status
    return {
      day: d.day,
      status,
      claimedAt: d.claimedAt || 0,
      reward: status === "claimed" || status === "today" ? rewardOf(cat, d.day) : ""
    }
  })

  const claimed = days.filter(d => d.status === "claimed").length
  const expired = days.filter(d => d.status === "expired").length
  const locked = days.filter(d => d.status === "locked").length
  const todayRow = days.find(d => d.status === "today") || null
  const nextRow = todayRow || days.find(d => d.status === "locked") || null
  const finalRow = days[days.length - 1] || null

  return {
    open, today, days, claimed, expired, locked,
    total: ADVENT_DAYS,
    pct: ADVENT_DAYS ? Math.round(claimed / ADVENT_DAYS * 100) : 0,
    next: nextRow,
    final: finalRow,
    finalReward: finalRow ? rewardOf(cat, finalRow.day) : "",
    closes: season.closesAt || 0,
    opens: season.opensAt || 0,
    phase: season.phase
  }
}

const STATUS = {
  claimed: { label: "Claimed", icon: "check", cls: "claimed" },
  today: { label: "Today only", icon: "unlock", cls: "today" },
  expired: { label: "Expired", icon: "expired", cls: "expired" },
  locked: { label: "Locked", icon: "lock", cls: "locked" }
}

function dayTile(d) {
  const st = STATUS[d.status] || STATUS.locked
  const reward = d.reward ? esc(d.reward)
    : d.status === "claimed" ? "Claimed"
      : d.status === "locked" || d.status === "expired" ? "Mystery reward"
        : "—"
  return `<div class="v2w-day ${st.cls}">
    <span class="st" aria-hidden="true">${icon(st.icon, 15)}</span>
    <span class="n">${d.day}</span>
    <span class="dt">Dec ${d.day} &middot; ${st.label}</span>
    <span class="r">${reward}</span>
  </div>`
}

function timelineRow(cat, d) {
  const st = STATUS[d.status] || STATUS.locked
  const when = d.claimedAt ? `${stamp(d.claimedAt)} · claimed` : st.label
  const reward = d.status === "claimed"
    ? (d.reward || "Claimed")
    : d.status === "today" ? (d.reward || "Claim in game")
      : d.status === "expired" ? "Expired" : "Hidden"
  return `<div class="v2w-tlrow ${st.cls}">
    <span aria-hidden="true">${d.status === "claimed" ? rewardIcon(cat, d.day) : icon(st.icon, 16)}</span>
    <span class="d">Day ${d.day} – Dec ${d.day}<small>${esc(when)}</small></span>
    <span class="r">${esc(reward)}</span>
  </div>`
}

function calendarCard(v) {
  const grid = v.days.map(d => dayTile(d)).join("")
  const note = v.phase === "before"
    ? `The calendar opens ${stamp(v.opens)}. Day 1 is claimable on 1 December only.`
    : v.phase === "open"
      ? `Each box is claimable on its own date only. Once midnight passes, that day is expired — nothing is discounted, nothing is claimable later.`
      : v.phase === "disabled"
        ? `Winterfest is switched off on this deployment.`
        : `The season has closed. Missed days can only come back with the Advent Pass.`
  return card({
    head: { icon: "", title: "1 – 24 December", sub: "Claim in game with /advent — this page never grants anything." },
    body: `<div class="v2w-cal eight">${grid}</div>
    <div class="v2w-legend">
      <span class="c"><i></i>claimed</span>
      <span class="t"><i></i>claimable today</span>
      <span class="e"><i></i>expired</span>
      <span class="l"><i></i>locked</span>
    </div>
    <p class="v2w-note" style="margin-top:8px">${esc(note)}</p>`
  })
}

function timelineCard(v, cat) {
  const rows = v.days.map(d => timelineRow(cat, d)).join("")
  return card({
    head: { icon: "", title: "Rewards Timeline", sub: `${v.total} days` },
    body: `<div class="v2w-tl">${rows}</div>`
  })
}

function passCard(v) {
  return card({
    head: { icon: "", title: "Advent Pass" },
    body: `<div class="v2w-pass">
      <div class="v2w-pass-art">
        <img src="/winter/ref/advent-pass.png" width="60" height="46" alt="" aria-hidden="true">
        <span class="v2w-note">Unlocks the whole calendar at the end of the event.</span>
      </div>
      <ul style="gap:3px">
        <li>${icon("check", 15)}Reveal every mystery reward</li>
        <li>${icon("check", 15)}Claim all 24 daily rewards after 24 December</li>
        <li>${icon("check", 15)}Exclusive Advent Pass badge &amp; frame</li>
      </ul>
      <span class="v2w-cta" aria-disabled="true" title="The web checkout is not live; the pass is granted in game">${""}Sold in game</span>
      <p class="v2w-note" style="margin:0;font-size:11px">No price is published to the panel yet, so nothing here charges anyone. An admin grants <code>advent_pass_2026</code> in game.</p>
    </div>`
  })
}

function progressCard(v) {
  return card({
    head: { icon: "", title: "Your Progress" },
    body: `<div class="v2w-progress">
      <p class="v2w-big"><b>${v.claimed}</b> <span>/ ${v.total} days</span></p>
      ${bar(v.claimed, v.total)}
      <p class="v2w-note">${v.pct}%${v.expired ? ` · ${v.expired} expired` : ""}${v.locked ? ` · ${v.locked} still to open` : ""}</p>
    </div>`
  })
}

function nextCard(v) {
  const n = v.next
  const body = n
    ? `<p class="v2w-big"><b>Day ${n.day}</b> <span>· Dec ${n.day}</span></p>
       <p class="v2w-note">${n.status === "today" ? (n.reward ? esc(n.reward) : "Today's box is waiting") : "Not opened yet"}
       <br>${n.status === "today" ? "Available only today" : `Unlocks on Dec ${n.day}`}</p>`
    : `<p class="v2w-big"><b>All done</b></p><p class="v2w-note">Every day is claimed or expired.</p>`
  return card({ head: { icon: "", title: "Next Reward" }, body })
}

function finalCard(v) {
  return card({
    head: { icon: "", title: "Final Reward (Day 24)" },
    body: `<div class="v2w-pass-art" style="align-items:center;gap:12px">
      <span aria-hidden="true">${""}</span>
      <div>
        <p class="v2w-big" style="margin:0"><b>${esc(v.finalReward || "Not published")}</b></p>
        <p class="v2w-note" style="margin:2px 0 0">${v.final && v.final.status === "claimed" ? "Claimed" : "Opens on 24 December"}</p>
      </div>
    </div>`
  })
}

export async function pageWinterAdventV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = adventView(ctx)
  const season = ctx.season

  const hero = winterHero({
    title: "Calendar Advent",
    sub: "Open a new house each day and claim exclusive Winterfest rewards!",
    badge: `<b>${esc(String(season.year || 2026))}</b> &middot; Dec 1 – Dec 24`,
    artLeft: { src: "/winter/ref/advent-house-a.png", w: 242, h: 212 },
    artRight: { src: "/winter/ref/advent-house-b.png", w: 282, h: 258 }
  })

  // the three summary cards sit directly under the hero: the calendar and the
  // timeline are both tall, and at 941 px the strip would otherwise be the one
  // thing below the fold
  const body = `${hero}
<div class="v2w-strip">${progressCard(v)}${nextCard(v)}${finalCard(v)}</div>
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${calendarCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${timelineCard(v, ctx.cat)}${passCard(v)}</div>
</div>`

  return winterPage({
    title: "Calendar Advent",
    active: "advent",
    tab: "advent",
    ctx,
    content: body
  })
}
