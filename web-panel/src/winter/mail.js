// /mail — the envelope: the Winterfest inbox.
//
// Owner decision (docs/WINTERFEST.md §6.3, docs/design/WINTERFEST-DASHBOARD.md):
// the envelope in the top bar is a real route, and it carries a red dot driven
// by the unread count. `winter_mail` (schema.sql, appended by this workstream)
// is the mailbox of record; this module is the only panel code that reads or
// writes it.
//
// THE BELL AND THE ENVELOPE (the choice the brief asked us to document)
//   * The ENVELOPE is this inbox: one row per message per player, unread count,
//     message view. It is the only thing with a red dot in the top bar.
//   * The BELL in the owner's reference stays the EVENT/announcement indicator
//     on the Winterfest hub (live event windows, the season countdown). Both
//     point at the same inbox when they need to say something durable, so there
//     is exactly one place a player reads a message — but the bell is not a
//     second mailbox and this page does not try to be an event feed.
//
// WHAT THE PANEL MAY WRITE, AND WHAT IT MAY NOT
//   The panel has no player login today: a player is identified by the
//   `?steamid=` in the URL the game opens, exactly like every other MOTD page.
//   That is a VIEW identity, not an authenticated session, so this module does
//   NOT offer a mark-as-read POST: anyone holding the link could then mark a
//   stranger's mail read, which is a write dressed up as a session. Phase 1 is
//   therefore READ-ONLY BY STEAMID on the player side (the brief's §15.5), and
//   the "read" flag is written by the GAME when the player opens the message
//   with `!mail` (winterfest_mail.sma) and pushed back in the payload this file
//   documents below. The only panel-side writes are the staff broadcast in
//   /admin?s=mail (existing admin session + CSRF) and the lazy DDL.
//
// THE TABLE (schema.sql, CREATE TABLE IF NOT EXISTS winter_mail)
//   id          INTEGER PK AUTOINCREMENT
//   steamid     TEXT    recipient (one row per recipient: a broadcast is a
//                       fan-out, so read state never has to be shared)
//   kind        'system' | 'event' | 'grant' | 'admin'
//   title       one line, <= 80 chars
//   body        the text
//   created_at  epoch seconds
//   read_at     epoch seconds, 0 = unread
//   expires_at  epoch seconds, 0 = never (an expired row is invisible)
//   payload     optional JSON (a grant reference, an event id, …)
//
// PAYLOADS (both features; the exact JSON is in docs/WINTERFEST-LEVELS-MAIL.md)
//   game -> panel, inside the existing winter push:
//     winter.mail_read: [{ steamid, id, at }]      what the player read in game
//   panel -> game, one action per undelivered message (freenova_sync.sma owns the
//   dispatch line, exactly like wf_tree_move):
//     type "wf_mail", arg "<panel id>:<kind code>:<expires>:<title, 40 chars>"
import { esc, fmt, num, winterPage, winterTime } from "./render.js"
import { CHROME_CSS, winterDashboard, MAX_LEVEL } from "./levels.js"
import { rankName } from "../ranks.js"
import { loadSeason } from "./season.js"
import { normalizeSteamid } from "../publicapi.js"

const nowSec = () => Math.floor(Date.now() / 1000)

export const MAIL_KINDS = ["system", "event", "grant", "admin"]

export const MAIL_KIND_LABEL = {
  system: "System",
  event: "Event",
  grant: "Reward",
  admin: "Staff"
}

// Byte-for-byte the block appended to schema.sql. Repeated here (the same way
// src/winter/store.js repeats the winter_* DDL) so a deployment that never execs
// schema.sql still gets the table the first time a page or a broadcast needs it.
// Every statement is IF NOT EXISTS: an existing live table is never rewritten.
export const MAIL_DDL = [
  `CREATE TABLE IF NOT EXISTS winter_mail (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'system',
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT 0,
    read_at     INTEGER NOT NULL DEFAULT 0,
    expires_at  INTEGER NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_winter_mail_inbox ON winter_mail (steamid, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_winter_mail_unread ON winter_mail (steamid, read_at)`
]

const ddlDone = new WeakSet()

/** Create the mailbox if it is missing. Safe to call on every read and write. */
export async function ensureMailTables(env) {
  if (!env || !env.DB) return
  if (ddlDone.has(env.DB)) return
  for (const sql of MAIL_DDL) {
    try { await env.DB.prepare(sql).run() } catch { /* exists, or no DDL rights */ }
  }
  ddlDone.add(env.DB)
}

// ------------------------------------------------------------------ helpers --
export function normalizeKind(kind) {
  const k = String(kind == null ? "" : kind).trim().toLowerCase()
  return MAIL_KINDS.includes(k) ? k : "system"
}

/** A row -> the shape the page renders. Every field is typed, nothing trusted. */
export function mailRow(row) {
  if (!row) return null
  return {
    id: num(row.id),
    steamid: String(row.steamid || ""),
    kind: normalizeKind(row.kind),
    title: String(row.title || ""),
    body: String(row.body || ""),
    createdAt: num(row.created_at),
    readAt: num(row.read_at),
    expiresAt: num(row.expires_at),
    payload: String(row.payload || "")
  }
}

/** Visible = not expired (`expires_at = 0` means never). */
export function isVisible(mail, at) {
  if (!mail) return false
  const now = num(at)
  return !num(mail.expiresAt) || num(mail.expiresAt) > now
}

// -------------------------------------------------------------------- reads --
/** Unread, unexpired messages for one steamid. 0 for a player with no session. */
export async function unreadCount(env, steamid, at) {
  const sid = normalizeSteamid(steamid)
  if (!sid) return 0
  const now = num(at) || nowSec()
  try {
    await ensureMailTables(env)
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM winter_mail
        WHERE steamid=?1 AND read_at=0 AND (expires_at=0 OR expires_at>?2)`
    ).bind(sid, now).first()
    return Math.max(0, num(row && row.n))
  } catch { return 0 }
}

/**
 * One player's inbox, newest first, expired messages excluded. The WHERE clause
 * is the whole access-control story of this page: a query is always scoped to
 * one steamid, so a message addressed to somebody else can never be returned.
 */
export async function loadInbox(env, steamid, opts) {
  const o = opts || {}
  const sid = normalizeSteamid(steamid)
  const now = num(o.now) || nowSec()
  const limit = Math.min(50, Math.max(1, num(o.limit) || 20))
  if (!sid) return []
  try {
    await ensureMailTables(env)
    const res = await env.DB.prepare(
      `SELECT id, steamid, kind, title, body, created_at, read_at, expires_at, payload
         FROM winter_mail
        WHERE steamid=?1 AND (expires_at=0 OR expires_at>?2)
        ORDER BY created_at DESC, id DESC LIMIT ?3`
    ).bind(sid, now, limit).all()
    return ((res && res.results) || []).map(mailRow).filter(m => isVisible(m, now))
  } catch { return [] }
}

/**
 * ONE message, scoped to its recipient. Returns null when the id belongs to
 * somebody else (or is expired), which is exactly what the page turns into a
 * 404 — it must never reveal that another player's row exists.
 */
export async function loadMessage(env, steamid, id, at) {
  const sid = normalizeSteamid(steamid)
  const mid = num(id)
  const now = num(at) || nowSec()
  if (!sid || !mid) return null
  try {
    await ensureMailTables(env)
    const row = await env.DB.prepare(
      `SELECT id, steamid, kind, title, body, created_at, read_at, expires_at, payload
         FROM winter_mail WHERE id=?1 AND steamid=?2`
    ).bind(mid, sid).first()
    const mail = mailRow(row)
    return isVisible(mail, now) ? mail : null
  } catch { return null }
}

// ------------------------------------------------------------------- writes --
const isSteamid = s => /^STEAM_[0-9]:[0-9]:\d+$/.test(String(s || ""))
const BAD_TEXT = /[\0<>]/

/**
 * The staff broadcast. One message to everyone the panel knows, or to one
 * steamid. Validation happens here so both the admin form and any later caller
 * get the same refusals; nothing is written when a field is refused.
 */
export async function sendMail(env, msg) {
  const m = msg || {}
  await ensureMailTables(env)
  const kind = normalizeKind(m.kind)
  const title = String(m.title == null ? "" : m.title).replace(/\s+/g, " ").trim()
  const body = String(m.body == null ? "" : m.body).replace(/\r\n/g, "\n").trim()
  if (!title) return { ok: false, status: 400, error: "A title is required." }
  if (title.length > 80) return { ok: false, status: 400, error: "The title cannot exceed 80 characters." }
  if (BAD_TEXT.test(title)) return { ok: false, status: 400, error: "The title cannot contain angle brackets." }
  if (body.length > 2000) return { ok: false, status: 400, error: "The body cannot exceed 2000 characters." }
  if (BAD_TEXT.test(body)) return { ok: false, status: 400, error: "The body cannot contain angle brackets." }

  const created = num(m.now) || nowSec()
  const expiresAt = Math.max(0, num(m.expiresAt))
  if (expiresAt && expiresAt <= created)
    return { ok: false, status: 400, error: "The expiry must be in the future (or empty for never)." }

  let payload = ""
  if (m.payload != null && String(m.payload).trim() !== "") {
    const raw = String(m.payload)
    if (raw.length > 500) return { ok: false, status: 400, error: "The payload cannot exceed 500 characters." }
    try { JSON.parse(raw); payload = raw } catch { return { ok: false, status: 400, error: "The payload must be valid JSON." } }
  }

  const target = String(m.target == null ? "" : m.target).trim()
  let targets = []
  if (target === "*" || target.toLowerCase() === "everyone") {
    let rows = []
    try {
      const res = await env.DB.prepare("SELECT steamid FROM players ORDER BY steamid LIMIT 5001").all()
      rows = (res && res.results) || []
    } catch { rows = [] }
    if (rows.length > 5000)
      return { ok: false, status: 400, error: "More than 5000 recipients: send to a single steamid instead." }
    targets = rows.map(r => String(r.steamid || "")).filter(isSteamid)
    if (!targets.length)
      return { ok: false, status: 400, error: "The panel has no player snapshots yet, so \"everyone\" is nobody. Send to a steamid instead." }
  } else {
    const sid = normalizeSteamid(target)
    if (!sid) return { ok: false, status: 400, error: "Choose everyone, or type a STEAM_0:0:0 steamid." }
    targets = [sid]
  }

  let sent = 0
  const stmt = env.DB.prepare(
    `INSERT INTO winter_mail (steamid, kind, title, body, created_at, read_at, expires_at, payload)
     VALUES (?1,?2,?3,?4,?5,0,?6,?7)`)
  for (const sid of targets) {
    try {
      await stmt.bind(sid, kind, title, body, created, expiresAt, payload).run()
      sent++
    } catch { /* one refused row must not stop the broadcast */ }
  }
  if (!sent) return { ok: false, status: 500, error: "The message could not be stored." }
  return { ok: true, status: 200, sent, expiresAt, kind }
}

/**
 * The game -> panel direction: the read timestamps the in-game inbox reports
 * (winterfest_mail.sma's wfm_reads()). Idempotent and monotonic — a row is only
 * ever marked read once, so a replayed push cannot move a read backwards.
 *
 *   applyMailReads(env, [{ steamid, id, at }, ...])
 *
 * This is the one call sync.js needs next to its winter payload ingest; it is
 * exported here so the seam is a function, not a second mailbox implementation.
 */
export async function applyMailReads(env, list) {
  const out = { updated: 0, skipped: 0, errors: [] }
  const items = Array.isArray(list) ? list : []
  if (!items.length) return out
  await ensureMailTables(env)
  for (const item of items) {
    const sid = normalizeSteamid(item && item.steamid)
    const id = num(item && item.id)
    if (!sid || !id) { out.skipped++; continue }
    const at = Math.max(0, num(item && item.at)) || nowSec()
    try {
      const res = await env.DB.prepare(
        "UPDATE winter_mail SET read_at=?1 WHERE id=?2 AND steamid=?3 AND read_at=0"
      ).bind(at, id, sid).run()
      if (res && res.meta && Number(res.meta.changes) > 0) out.updated++
      else out.skipped++
    } catch (e) { out.errors.push(String(e && e.message ? e.message : e)) }
  }
  return out
}

// ---------------------------------------------------------------- admin page --
const days = (n, now) => now + Math.max(0, num(n)) * 86400

/**
 * GET /admin?s=mail — the staff section. Rendered inside admin.js's shell()
 * (its own session/CSRF handling); this function returns the <main> body only.
 * The form posts to /admin/mail with the session's csrf token.
 */
export async function renderMailSection(env, session, url) {
  await ensureMailTables(env)
  const now = nowSec()
  let recent = []
  try {
    const res = await env.DB.prepare(
      `SELECT MIN(id) AS id, kind, title, body, created_at, expires_at,
              COUNT(*) AS recipients,
              SUM(CASE WHEN read_at>0 THEN 1 ELSE 0 END) AS read_n
         FROM winter_mail
        GROUP BY kind, title, body, created_at, expires_at
        ORDER BY created_at DESC, id DESC LIMIT 20`
    ).all()
    recent = (res && res.results) || []
  } catch { recent = [] }

  let known = 0
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM players").first()
    known = num(r && r.n)
  } catch { known = 0 }

  const listRows = recent.length
    ? recent.map(r => {
        const expires = num(r.expires_at)
        const state = expires && expires <= now ? "expired" : expires ? "scheduled to expire" : "never expires"
        return `<tr>
          <td>${esc(fmtTime(r.created_at))}</td>
          <td><span class="badge">${esc(String(r.kind || "system"))}</span></td>
          <td><b>${esc(String(r.title || ""))}</b><br><span class="muted">${esc(String(r.body || "").slice(0, 120))}</span></td>
          <td>${fmt(r.recipients)}</td>
          <td>${fmt(r.read_n)}</td>
          <td>${esc(state)}</td>
        </tr>`
      }).join("")
    : `<tr><td colspan="6" class="empty">No messages have been sent yet.</td></tr>`

  return `
    <h2>Mail</h2>
    <div class="grid">
      <div class="card"><div class="k">Messages</div><div class="v">${fmt(recent.reduce((a, r) => a + num(r.recipients), 0))}</div></div>
      <div class="card"><div class="k">Unread</div><div class="v">${fmt(recent.reduce((a, r) => a + Math.max(0, num(r.recipients) - num(r.read_n)), 0))}</div></div>
      <div class="card"><div class="k">Players the panel knows</div><div class="v">${fmt(known)}</div></div>
      <div class="card"><div class="k">Reads here</div><div class="v">never</div><div class="muted">marking read happens in game</div></div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="k">Send a message</div>
      <p class="muted">One broadcast to every player the panel knows, or one steamid. Players read it at
        <code>/mail</code> on the panel and with <code>!mail</code> in game; the in-game inbox marks a message
        read when the player opens it, and the game reports that back. Row-by-row mail is not offered:
        player-to-player mail is explicitly a later step (owner decision, 2026-11-22).</p>
      <form method="post" action="/admin/mail">
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <div class="row">
          <div><label>To</label><input name="target" value="*" required></div>
          <div><label>Kind</label>
            <select name="kind">
              ${MAIL_KINDS.map(k => `<option value="${k}"${k === "admin" ? " selected" : ""}>${esc(MAIL_KIND_LABEL[k])} (${k})</option>`).join("")}
            </select>
          </div>
          <div><label>Expires in days (empty = never)</label><input name="expires_days" inputmode="numeric" placeholder="7"></div>
        </div>
        <label>Title (80 chars)</label>
        <input name="title" required maxlength="80" placeholder="Christmas event starts tonight">
        <label>Message</label>
        <textarea name="body" rows="5" maxlength="2000" placeholder="What the player needs to know."></textarea>
        <label>Payload (optional JSON, e.g. {"ref":"grant:42"})</label>
        <input name="payload" placeholder="">
        <p><button type="submit">Send</button></p>
      </form>
      <p class="muted">\`*\` fans out one row per known player at send time. A player the panel has never
        seen will not receive this broadcast; send again after they have played once.</p>
    </div>

    <div class="card">
      <div class="k">Last 20 messages</div>
      <table>
        <tr><th>When</th><th>Kind</th><th>Message</th><th>Recipients</th><th>Read</th><th>Expiry</th></tr>
        ${listRows}
      </table>
      <p class="muted">Read counts come from the game's report (<code>winter.mail_read</code>); until the
        game sends one, every message shows 0 reads even if a player opened it.</p>
    </div>`
}

/** "expires in N days" -> epoch. Empty/invalid -> 0 (never). */
export function expiryFromDays(value, now) {
  const raw = String(value == null ? "" : value).trim()
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 365) return -1
  return days(Math.round(n), num(now) || nowSec())
}

/**
 * POST /admin/mail. admin.js has already checked the session and the CSRF token
 * (the same two lines the events section uses); this returns {status, error}.
 */
export async function handleMailAdminPost(env, session, body) {
  const b = body || {}
  const now = nowSec()
  const expires = expiryFromDays(b.expires_days, now)
  if (expires < 0) return { status: 400, error: "Expiry must be a whole number of days between 0 and 365." }
  const res = await sendMail(env, {
    target: b.target,
    kind: b.kind,
    title: b.title,
    body: b.body,
    expiresAt: expires,
    payload: b.payload,
    now
  })
  if (!res.ok) return { status: res.status || 400, error: res.error }
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit (steamid, action, detail, created_at) VALUES (?1,?2,?3,?4)"
    ).bind(session && session.steamid || "", "MAIL_SENT",
      `${String(b.target || "*")}:${res.sent} recipient(s): ${String(b.title || "").slice(0, 60)}`, now).run()
  } catch { /* an audit miss must not undo a sent message */ }
  return { status: 200, ok: true, sent: res.sent }
}

// ------------------------------------------------------------------ the page --
function fmtTime(sec) {
  const n = num(sec)
  if (!n) return "—"
  return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

/**
 * GET /mail — the inbox, or one message with ?id=N.
 *
 * Read-only by steamid (see the header): no form, no POST, no mark-as-read link.
 * The page says where the read action lives so the player is never left clicking
 * something that would do nothing.
 */
export async function pageMail(env, url, opts) {
  const o = opts || {}
  const now = nowSec()
  const season = await loadSeason(env, now)
  const sid = normalizeSteamid(url && url.searchParams ? url.searchParams.get("steamid") : "")
  const unread = Number.isFinite(o.unread) ? Math.max(0, num(o.unread)) : (sid ? await unreadCount(env, sid, now) : 0)
  // The top bar shows who the inbox belongs to. Read from the same snapshot the
  // rest of the panel uses; an unknown player is labelled as unknown, never
  // guessed.
  let who = { name: "", level: 0, rank: "" }
  if (sid) {
    try {
      const row = await env.DB.prepare("SELECT name, level, rank_id FROM players WHERE steamid=?1").bind(sid).first()
      if (row) {
        who.name = row.name ? String(row.name) : ""
        const lvl = Math.min(MAX_LEVEL, Math.max(1, num(row.level) || num(row.rank_id) || 1))
        who.level = lvl
        who.rank = rankName(lvl)
      }
    } catch { who = { name: "", level: 0, rank: "" } }
  }
  const wantedId = num(url && url.searchParams ? url.searchParams.get("id") : 0)
  const compact = !!(url && url.searchParams && url.searchParams.get("compact") === "1")

  // A message view is scoped: somebody else's id is a 404, not a page that says
  // "you may not see this" (that would confirm the row exists).
  let message = null
  let missing = false
  if (wantedId) {
    message = sid ? await loadMessage(env, sid, wantedId, now) : null
    missing = !message
  }
  const inbox = sid && !message ? await loadInbox(env, sid, { now, limit: 20 }) : []

  const link = (id) => {
    const q = new URLSearchParams()
    if (sid) q.set("steamid", sid)
    if (compact) q.set("compact", "1")
    if (id) q.set("id", String(id))
    const s = q.toString()
    return "/mail" + (s ? "?" + s : "")
  }

  const kindTag = k => `<span class="wf-tag ${esc(k)}">${esc(MAIL_KIND_LABEL[k] || k)}</span>`

  const listRows = inbox.length
    ? inbox.map(m => `<div class="wf-msg ${m.readAt ? "read" : "unread"}">
        <div>${kindTag(m.kind)}<a class="t" href="${esc(link(m.id))}">${esc(m.title)}</a>
          ${m.readAt ? `<span class="wf-tag">read</span>` : `<span class="wf-tag coming">unread</span>`}</div>
        <div class="wf-note2">${esc(fmtTime(m.createdAt))}${
          m.expiresAt ? ` &middot; expires ${esc(winterTime(m.expiresAt, season.tz))}` : ""}</div>
      </div>`).join("")
    : ""

  const inboxCard = sid
    ? (inbox.length
      ? `<div class="wf-panel"><div class="h">Inbox <span class="k">${fmt(inbox.length)} shown &middot; ${fmt(unread)} unread</span></div>
          ${listRows}
          <div class="wf-note2">Marking a message read happens in game: type <code>/mail</code> (or
            <code>!mail</code>), pick the message and it is marked read. This panel has no player login, so it
            will not write your read state.</div></div>`
      : `<div class="wf-panel"><div class="h">Inbox</div>
          <div class="wf-note2">No messages yet. Staff broadcasts and reward notices appear here, and the game
            tells you on connect when there is something to read.</div></div>`)
    : `<div class="wf-panel"><div class="h">Inbox</div>
        <div class="wf-note2">No player selected — open this page with
          <code>?steamid=STEAM_0:0:12345</code>, or from the game (the envelope in the top bar). The panel
          only ever shows the inbox of the steamid in the URL.</div></div>`

  const messageCard = message
    ? `<div class="wf-panel">
        <div class="h">${esc(message.title)}</div>
        <div>${kindTag(message.kind)}${message.readAt
          ? `<span class="wf-tag live">read ${esc(fmtTime(message.readAt))}</span>`
          : `<span class="wf-tag coming">unread</span>`}
          <span class="wf-note2">sent ${esc(fmtTime(message.createdAt))}${
            message.expiresAt ? ` &middot; expires ${esc(winterTime(message.expiresAt, season.tz))}` : ""}</span></div>
        <div class="b wf-msg" style="border-left:0;padding:8px;">${esc(message.body || "")}</div>
        ${message.payload ? `<div class="wf-note2">Attachment: <code>${esc(message.payload)}</code></div>` : ""}
        ${message.readAt ? "" : `<div class="wf-note2"><b>Unread.</b> Type <code>/mail</code> in game and open
          this message to mark it read — the panel cannot do that for you (it has no player session).</div>`}
        <div class="wf-note2"><a href="${esc(link(0))}">&lsaquo; Back to the inbox</a></div>
      </div>`
    : missing
      ? `<div class="wf-panel"><div class="h">Message not in this inbox</div>
          <div class="wf-note2">That message does not exist for this player, or it has expired. An inbox is
            only ever readable by the steamid it belongs to.</div>
          <div class="wf-note2"><a href="${esc(link(0))}">&lsaquo; Back to the inbox</a></div></div>`
      : ""

  const body = `${winterDashboard(url, {
    kicker: "Mail",
    active: "mail",
    unread,
    name: who.name,
    steamid: sid,
    level: who.level,
    rank: who.rank,
    compact
  }, `
    ${messageCard}
    ${inboxCard}
    <div class="wf-panel">
      <div class="h">How this inbox works</div>
      <div class="wf-note2"><b>Read-only on the panel.</b> A player is identified here by the
        <code>?steamid=</code> in the URL the game opens — a view identity, not a login. Because there is no
        authenticated player session, the panel deliberately has no "mark as read" form: one would let anyone
        with the link flip a stranger's mail. Messages are marked read in game (<code>!mail</code>), and the
        game reports that back to this table.</div>
      <div class="wf-note2"><b>The envelope, not the bell.</b> The envelope in the top bar is this page and its
        red dot is the unread count. The bell in the dashboard reference stays the event/announcement
        indicator on the Winterfest hub; both open this inbox, and there is only one mailbox.</div>
      <div class="wf-note2"><b>No player-to-player mail</b> in Phase 1 (owner decision, 2026-11-22). Staff
        broadcasts and system notices only.</div>
    </div>
  `)}`

  const res = winterPage("MAIL", `<style>${CHROME_CSS}</style>${body}`, { season, url })
  if (missing) return new Response(res.body, { status: 404, headers: res.headers })
  return res
}
