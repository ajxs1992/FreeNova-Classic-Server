// /v2/winter/mail — the inbox, rebuilt on the v2 shell.
//
// The reads are the old page's, unchanged: loadInbox(env, sid, { now, limit })
// returns this player's visible messages newest first, unreadCount() returns the
// number behind the top bar's red dot, and MAIL_KIND_LABEL / MAIL_KINDS name the
// four kinds. Nothing here queries, and nothing here writes: the panel has no
// player login (?steamid= is a view identity, not a session), so marking a
// message read stays in game with /mail, exactly as src/winter/mail.js documents.
//
// Read-only means read-only: there is no form, no POST and no "mark as read"
// link on this page, because one would let anyone holding the link flip a
// stranger's mail.
import { esc, fmt } from "../../theme.js"
import { icon } from "../../icons.js"
import { card, emptyState, pill } from "../../components.js"
import {
  loadInbox, unreadCount, isVisible, MAIL_KINDS, MAIL_KIND_LABEL
} from "../../../winter/mail.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const PARIS = "Europe/Paris"
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, day: "numeric", month: "short" })
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: PARIS, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
})
const RTF = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" })

const int = v => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** "just now", "3 days ago", "in 2 days", or the calendar day for older rows. */
function ago(now, sec) {
  const t = int(sec)
  if (!t) return ""
  const d = t - int(now) // negative = in the past
  const abs = Math.abs(d)
  if (abs < 90) return "just now"
  if (abs < 5400) return RTF.format(Math.round(d / 60), "minute")
  if (abs < 129600) return RTF.format(Math.round(d / 3600), "hour")
  if (abs < 5184000) return RTF.format(Math.round(d / 86400), "day")
  return dayFmt.format(new Date(t * 1000))
}

/** The full Paris stamp, for a row's title attribute. */
function stamp(sec) {
  const n = int(sec)
  return n ? stampFmt.format(new Date(n * 1000)) : ""
}

/** Expiry in words; "" for a message that never expires. */
function expiryNote(now, sec) {
  const t = int(sec)
  if (!t) return ""
  const left = t - int(now)
  if (left <= 0) return ""
  return `expires ${dayFmt.format(new Date(t * 1000))}`
}

const preview = body => {
  const text = String(body || "").replace(/\s+/g, " ").trim()
  return text.length > 160 ? text.slice(0, 157) + "…" : text
}

/** The page's view model: the loader's own rows, re-checked with the same pair. */
export async function mailView(ctx) {
  const now = int(ctx.nowSec)
  const sid = ctx.sid || ""
  const inbox = sid ? await loadInbox(ctx.env, sid, { now, limit: 20 }) : []
  // loadInbox returns rows already shaped by mailRow() (typed fields, expired
  // rows dropped). isVisible() is the same guard re-applied here, so an expired
  // row can never reach this HTML even if the loader's own filter changes.
  const messages = inbox.filter(m => isVisible(m, now))
  const unread = sid ? await unreadCount(ctx.env, sid, now) : 0
  const kinds = MAIL_KINDS.map(k => ({
    kind: k,
    label: MAIL_KIND_LABEL[k] || k,
    n: messages.filter(m => m.kind === k).length
  }))
  return { messages, unread: Math.max(0, unread), total: messages.length, kinds, hasPlayer: !!sid, now }
}

function messageRow(v, m) {
  const unread = !int(m.readAt)
  const body = preview(m.body)
  const expiry = expiryNote(v.now, m.expiresAt)
  return `<article class="v2w-msg${unread ? " unread" : ""}" title="${esc(stamp(m.createdAt))}">
    <span class="v2w-msg-dot" aria-hidden="true"></span>
    <div>
      <div class="v2w-msg-top">
        ${pill({ tone: unread ? "gold" : "dim", label: MAIL_KIND_LABEL[m.kind] || m.kind })}
        <b>${esc(m.title)}</b>
        <span class="v2w-msg-when">${esc(ago(v.now, m.createdAt))}</span>
      </div>
      ${body ? `<p class="v2w-msg-body">${esc(body)}</p>` : ""}
      <p class="v2w-msg-meta">${unread ? "Unread" : "Read"}${expiry ? ` &middot; ${esc(expiry)}` : ""}</p>
    </div>
  </article>`
}

function inboxCard(v) {
  const head = {
    icon: icon("envelope", 26),
    title: "Inbox",
    sub: v.hasPlayer ? `${fmt(v.total)} shown · ${fmt(v.unread)} unread` : "no player selected"
  }
  let body
  if (!v.hasPlayer) {
    body = emptyState("No player selected", "Open this page with ?steamid=STEAM_0:0:12345, or from the game (the envelope in the top bar). The inbox only ever shows the steamid in the URL.")
  } else if (!v.messages.length) {
    body = emptyState("No messages yet", "Staff broadcasts and reward notices appear here. The game tells you on connect when there is something to read.")
  } else {
    body = `<div class="v2w-msgs">${v.messages.map(m => messageRow(v, m)).join("")}</div>`
  }
  return card({ head, body })
}

function kindsCard(v) {
  const rows = v.kinds.map(k => `<div class="v2w-kind">
    ${pill({ tone: "dim", label: k.label })}
    <em>${fmt(k.n)}</em>
  </div>`).join("")
  return card({
    head: { icon: "", title: "Message kinds", sub: `${v.kinds.length} kinds the game sends` },
    body: `<div class="v2w-kinds">${rows}</div>
      <p class="v2w-note" style="margin-top:8px">Counted over the messages shown above, not over the whole mailbox.</p>`
  })
}

function howCard() {
  return card({
    head: { icon: "", title: "How this inbox works" },
    body: `<p class="v2w-note"><b>Read-only here.</b> A player is identified by the <code>?steamid=</code> in the URL the game opens — a view identity, not a login. There is no player session, so this page has no "mark as read" action: one would let anyone with the link flip a stranger's mail.</p>
      <p class="v2w-note" style="margin-top:6px">Messages are marked read in game: type <code>/mail</code> (or <code>!mail</code>), open the message, and the game reports the read back to this panel.</p>
      <p class="v2w-note" style="margin-top:6px">No player-to-player mail: staff broadcasts and reward notices only.</p>`
  })
}

function stripCards(v) {
  const unread = card({
    head: { icon: icon("envelope", 24), title: "Unread" },
    body: `<p class="v2w-big"><b>${fmt(v.unread)}</b> <span>of ${fmt(v.total)} shown</span></p>
      <p class="v2w-note">The same count the envelope in the top bar uses.</p>`
  })
  const delivered = card({
    head: { icon: icon("check", 24), title: "Delivered" },
    body: `<p class="v2w-big"><b>${fmt(v.total)}</b> <span>message${v.total === 1 ? "" : "s"}</span></p>
      <p class="v2w-note">Expired messages are hidden; the newest 20 are shown.</p>`
  })
  const read = card({
    head: { icon: "", title: "Read happens in game" },
    body: `<p class="v2w-note">Opening a message with <code>/mail</code> is what marks it read. This panel never writes it, so nothing here can be changed from a link someone else was given.</p>`
  })
  return `${unread}${delivered}${read}`
}

export async function pageWinterMailV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = await mailView(ctx)

  const hero = winterHero({
    title: "Inbox",
    sub: "Staff broadcasts and reward notices. Open a message in game to mark it read.",
    badge: `<b>${fmt(v.unread)}</b> unread`
  })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${inboxCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${kindsCard(v)}${howCard()}</div>
</div>
<div class="v2w-strip">${stripCards(v)}</div>`

  return winterPage({
    title: "Inbox",
    active: "",
    tab: "mail",
    ctx,
    content: body,
    extraCss: MAIL_CSS
  })
}

const MAIL_CSS = `
.v2w-msgs{display:flex;flex-direction:column;gap:8px;max-height:540px;overflow:auto;padding-right:2px}
.v2w-msg{display:grid;grid-template-columns:10px minmax(0,1fr);gap:9px;align-items:start;padding:9px 10px;
  border-radius:12px;background:rgba(18,26,58,.6);border:1px solid #22305e}
.v2w-msg.unread{background:linear-gradient(180deg,rgba(58,42,12,.55),rgba(26,19,8,.6));border-color:#6b5a2a}
.v2w-msg-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;background:#243156;border:1px solid #3d4f86}
.v2w-msg.unread .v2w-msg-dot{background:var(--v2-gold);border-color:#ffe79b;box-shadow:0 0 8px rgba(245,196,81,.7)}
.v2w-msg-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.v2w-msg-top b{font-size:13.5px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis}
.v2w-msg-when{margin-left:auto;font-size:11px;font-weight:700;color:var(--v2-muted);white-space:nowrap}
.v2w-msg-body{margin:3px 0 0;font-size:12px;line-height:1.45;color:#b9c6e4}
.v2w-msg-meta{margin:4px 0 0;font-size:11px;font-weight:700;color:#8c9cc4}
.v2w-kinds{display:grid;gap:6px}
.v2w-kind{display:flex;align-items:center;gap:8px;font-size:12px;color:#cfdaf5}
.v2w-kind em{margin-left:auto;font-style:normal;font-weight:800;color:#eef2ff;font-variant-numeric:tabular-nums}
.v2w-strip .v2w-big{margin-bottom:4px}
`
