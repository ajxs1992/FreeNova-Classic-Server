// /levels — the rank ladder, its per-level rewards, and where this player sits.
//
// Owner decision (docs/WINTERFEST.md §6, docs/design/WINTERFEST-DASHBOARD.md):
// the sidebar carries a `Levels` item under PROGRESSION. This module is that
// page, plus the shared chrome both Winterfest dashboard pages (this one and the
// envelope in src/winter/mail.js) are drawn with.
//
// WHERE EVERY NUMBER COMES FROM (nothing on this page is estimated)
//   1. The curve. The game pushes `players.level` = crxranks_get_user_level(),
//      which rsu_crx_compat maps onto rsu_get_user_level() — the Rank System
//      Ultimate ladder, i.e. the 19 rows of
//      configs/rank_system_ultimate.ini [Ranks] (Unranked .. Global Elite), and
//      `players.xp` as the XP that ladder is measured in. The same table is
//      already mirrored in src/ranks.js (RANK_XP, "keep in lockstep"), which is
//      what /profile's rank crest uses. This page reads THAT module: one curve,
//      one place, no approximation and no second copy.
//   2. Per-level rewards. configs/freenova/winterfest/levels.ini
//      ([level_rewards], this workstream's file), carried here as LEVEL_REWARDS
//      for the same reason src/ranks.js carries [Ranks]: a Worker has no
//      filesystem. test_harness.mjs parses the ini and fails if the two drift.
//      Every row is then CROSS-REFERENCED against what actually exists in this
//      build (REWARD_KINDS below): a reward whose feature is missing is shown
//      as `coming` and is not claimable, and the page says why.
//   3. The leaderboard. boards.js's lifetimeBoard({metric:"xp"}) — the existing
//      helper /top and the public API already use. No second query path; the
//      level next to each row is derived from the same RANK_XP curve.
//
// A LEVEL IS NOT A BATTLE PASS TIER. Rank level/xp (this page) and BattlePass
// xp/tier (src/bp_track.js, /battlepass) are separate tracks that the tree
// deliberately keeps apart (REVIEW.md §2.4 H1). This page shows the BP tier as
// a labelled, separate figure so nobody reads one as the other.
//
// PHASE 1 HAS NO CLAIMS HERE. There is no level-reward ledger in the game yet,
// so nothing on this page can be claimed and no form posts anywhere: it is
// informational by design (the brief, and docs/WINTERFEST-LEVELS-MAIL.md).
import { esc, fmt, num, winterPage, bar, statCard } from "./render.js"
import { RANKS, RANK_XP, rankName, rankProgress } from "../ranks.js"
import { lifetimeBoard } from "../boards.js"
import { playerBpTier } from "../bp_track.js"
import { loadSeason } from "./season.js"
import { loadCatalog } from "./catalog.js"
import { ornamentName, rarityName, setTitle } from "./catalog.js"
import { normalizeSteamid } from "../publicapi.js"

export const MAX_LEVEL = RANKS.length
export const LEVEL_XP = RANK_XP

// ------------------------------------------------------------------ rewards --
// The `kind` vocabulary is winterfest.inc's reward enum — the core's ONE grant
// path (wf_grant) takes exactly these ids plus a claim key. A kind that path
// cannot pay is `available:false`, which forces `coming` on the page no matter
// what levels.ini says. That is the cross-reference the brief asks for.
export const REWARD_KINDS = {
  gingerbread: {
    label: "GingerBread",
    available: true,
    why: "wf_grant / WF_REWARD_GINGERBREAD — the Winterfest currency (id gb)"
  },
  ornament: {
    label: "Ornament",
    available: true,
    why: "wf_grant / WF_REWARD_ORNAMENT — the ornament inventory (ornaments.ini ids)"
  },
  gift: {
    label: "Present",
    available: true,
    why: "wf_grant / WF_REWARD_GIFT — a present instance of the given rarity"
  },
  pass_xp: {
    label: "Winter Pass XP",
    available: true,
    why: "wf_grant / WF_REWARD_PASS_XP — the free-track Winter Pass"
  },
  title: {
    label: "Title",
    available: true,
    why: "wf_grant / WF_REWARD_TITLE — an ornament-set title (id = set id)"
  },
  spin: {
    label: "Spin token",
    available: false,
    why: "the core keeps the counter (wf_add_spins) but the wheel that spends it ships with workstream 13"
  },
  coins: {
    label: "Coins",
    available: false,
    why: "the year-round wallet exists (players.coins) but the module's idempotent grant path has no coin kind, so a level payout could not be paid once"
  },
  cosmetic: {
    label: "Model / skin",
    available: false,
    why: "client downloads are still gated on fastdl (docs/WINTERFEST.md §1.1)"
  }
}

const RARITY_WORD = ["common", "uncommon", "rare"]

/**
 * levels.ini [level_rewards], byte-for-byte. Keep in lockstep — the harness
 * parses the ini and compares (test_harness.mjs, "levels: the reward table
 * matches levels.ini").
 */
export const LEVEL_REWARDS = [
  { level: 2, kind: "gingerbread", id: 0, amount: 75, state: "live", note: "a starter pouch of GingerBread" },
  { level: 3, kind: "gift", id: 0, amount: 0, state: "live", note: "one common present to open in game" },
  { level: 4, kind: "pass_xp", id: 0, amount: 50, state: "live", note: "Winter Pass XP" },
  { level: 5, kind: "ornament", id: 3, amount: 0, state: "live", note: "Silver Snowflake (set 1)" },
  { level: 6, kind: "gingerbread", id: 0, amount: 125, state: "live", note: "GingerBread" },
  { level: 7, kind: "gift", id: 1, amount: 0, state: "live", note: "one uncommon present" },
  { level: 8, kind: "pass_xp", id: 0, amount: 100, state: "live", note: "Winter Pass XP" },
  { level: 9, kind: "ornament", id: 8, amount: 0, state: "live", note: "Santa's Hat (set 2)" },
  { level: 10, kind: "gingerbread", id: 0, amount: 200, state: "live", note: "GingerBread" },
  { level: 11, kind: "spin", id: 0, amount: 1, state: "coming", note: "the spin wheel that spends the token ships with workstream 13" },
  { level: 12, kind: "pass_xp", id: 0, amount: 150, state: "live", note: "Winter Pass XP" },
  { level: 13, kind: "ornament", id: 12, amount: 0, state: "live", note: "Green Fur Bauble (set 3)" },
  { level: 14, kind: "coins", id: 0, amount: 250, state: "coming", note: "coins exist, but the core's idempotent grant path has no coin kind yet" },
  { level: 15, kind: "gift", id: 2, amount: 0, state: "live", note: "one rare present" },
  { level: 16, kind: "pass_xp", id: 0, amount: 200, state: "live", note: "Winter Pass XP" },
  { level: 17, kind: "ornament", id: 22, amount: 0, state: "live", note: "Candy Cane (set 5)" },
  { level: 18, kind: "gingerbread", id: 0, amount: 300, state: "live", note: "GingerBread" },
  { level: 19, kind: "title", id: 6, amount: 0, state: "live", note: "the \"Winterfest Legend\" title (set 6's title, via WF_REWARD_TITLE)" }
]

export function rewardAt(level) {
  const l = num(level)
  return LEVEL_REWARDS.find(r => r.level === l) || null
}

/** The first reward above `level` (null when the ladder is exhausted). */
export function nextRewardLevel(level) {
  const l = num(level)
  const above = LEVEL_REWARDS.filter(r => r.level > l).sort((a, b) => a.level - b.level)
  return above.length ? above[0].level : null
}

/**
 * "live" only when the config says so AND this build can pay it. The reason is
 * returned so the page can explain a `coming` instead of just flagging it.
 */
export function rewardState(entry) {
  if (!entry) return { state: "coming", why: "no reward is configured for this level" }
  const kind = REWARD_KINDS[entry.kind]
  if (!kind) return { state: "coming", why: `unknown reward kind "${String(entry.kind || "")}" — it cannot be paid` }
  if (String(entry.state || "").toLowerCase() !== "live")
    return { state: "coming", why: entry.note || "the config marks this reward as coming" }
  if (!kind.available) return { state: "coming", why: kind.why }
  return { state: "live", why: kind.why }
}

/** A reward in words. Ids are resolved through the catalogue, never guessed. */
export function rewardText(entry, cat) {
  if (!entry) return ""
  const kind = String(entry.kind || "")
  const id = num(entry.id)
  const amount = num(entry.amount)
  if (kind === "gingerbread") return `${fmt(amount)} GingerBread`
  if (kind === "pass_xp") return `${fmt(amount)} Winter Pass XP`
  if (kind === "coins") return `${fmt(amount)} coins`
  if (kind === "spin") return `${fmt(amount)} spin token${amount === 1 ? "" : "s"}`
  if (kind === "ornament") return cat && cat.ok ? ornamentName(cat, id) : `Ornament #${id}`
  if (kind === "gift") {
    const word = RARITY_WORD[id] || "common"
    return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word} present`
  }
  if (kind === "title") {
    const t = cat && cat.ok ? setTitle(cat, id, true) : ""
    return t ? `the "${t}" title` : `the title of ornament set #${id}`
  }
  if (kind === "cosmetic") return `a cosmetic (#${id})`
  return `reward "${kind}"`
}

// ----------------------------------------------------------------- the curve --
/** The level the RANK_XP floors put `xp` at (1..MAX_LEVEL). Never 0, never NaN. */
export function levelFromXp(xp) {
  const v = Math.max(0, num(xp))
  let lvl = 1
  for (let i = 1; i < LEVEL_XP.length; i++) if (v >= LEVEL_XP[i]) lvl = i + 1
  return Math.min(MAX_LEVEL, lvl)
}

/**
 * One players row -> where the player sits on the ladder. Every field is a
 * number, so a level-1 player with 0 XP renders 0/2816 and 0%, not NaN (the
 * harness checks exactly that).
 */
export function levelPosition(row) {
  const p = row || {}
  const xp = Math.max(0, num(p.xp))
  // players.level is the RSU level; rank_id is the same ladder clamped by the
  // game. Prefer level, fall back to rank_id, and clamp into the real range.
  const raw = num(p.level) || num(p.rank_id) || 1
  const level = Math.min(MAX_LEVEL, Math.max(1, raw))
  const rp = rankProgress(xp, level)
  return {
    found: !!row,
    xp,
    level,
    maxLevel: MAX_LEVEL,
    rank: rankName(level),
    floor: Math.max(0, num(rp.baseReq)),
    nextAt: rp.isMax ? null : num(rp.nextReq),
    into: Math.max(0, num(rp.earned)),
    span: rp.isMax ? 0 : Math.max(1, num(rp.nextReq) - num(rp.baseReq)),
    toNext: rp.isMax ? 0 : Math.max(0, num(rp.nextReq) - xp),
    pct: rp.isMax ? 100 : Math.min(100, Math.max(0, num(rp.progressPct))),
    atMax: !!rp.isMax,
    // The OTHER track, labelled as such wherever it is printed.
    bpTier: playerBpTier(p),
    bpXp: Math.max(0, num(p.bp_xp))
  }
}

/** The next `count` rungs above the player (level, xp floor, reward). */
export function milestones(level, count) {
  const from = Math.max(1, num(level))
  const out = []
  for (let l = from + 1; l <= MAX_LEVEL && out.length < (count || 3); l++) {
    out.push({ level: l, xp: LEVEL_XP[l - 1], reward: rewardAt(l) })
  }
  return out
}

// ------------------------------------------------------------------- chrome --
// The dashboard chrome both Winterfest pages are drawn with: a top bar carrying
// the envelope + its red unread dot (owner's drawing, docs/design/
// WINTERFEST-DASHBOARD.md "bell with red dot / envelope"), and the sidebar with
// the PROGRESSION group the owner put Levels under.
//
// IE-safe on purpose, exactly like render.js's WINTER_CSS: tables, solid hex, no
// flex, no grid, no CSS variables, no transforms. border-radius is decoration an
// old engine ignores.
export const CHROME_CSS = `
.wf-top{width:100%;border-collapse:collapse;background:#0d1430;border:1px solid #2a3d6e;margin-top:6px;}
.wf-top td{padding:5px 8px;vertical-align:middle;}
.wf-top .who{color:#eef2ff;font-weight:bold;font-size:13px;}
.wf-top .kick{color:#7f8fb5;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;}
.wf-top .right{text-align:right;white-space:nowrap;}
.wf-env{display:inline-block;border:1px solid #2a3d6e;background:#12143a;color:#eef2ff;text-decoration:none;
  padding:3px 9px;font-size:12px;border-radius:8px;}
.wf-env:hover{border-color:#9be7ff;color:#9be7ff;}
.wf-env.unread{border-color:#d62828;}
.wf-dot{display:inline-block;width:9px;height:9px;background:#d62828;border:1px solid #ff9a9a;
  border-radius:50%;margin-left:4px;vertical-align:1px;}
.wf-count{color:#f5c451;font-weight:bold;margin-left:4px;}
.wf-lay{width:100%;border-collapse:collapse;margin-top:8px;}
.wf-lay td.side{width:164px;vertical-align:top;padding:0 9px 0 0;}
.wf-lay td.main{vertical-align:top;padding:0;}
.wf-nav{background:#0d1430;border:1px solid #2a3d6e;padding:7px 8px;border-radius:12px;}
.wf-nav .g{color:#7f8fb5;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin:9px 0 3px;}
.wf-nav .g:first-child{margin-top:0;}
.wf-nav a{display:block;color:#9fb0d0;text-decoration:none;font-size:12px;padding:2px 5px;border-radius:6px;}
.wf-nav a:hover{color:#9be7ff;}
.wf-nav a.on{background:#302070;color:#eef2ff;font-weight:bold;}
.wf-nav .pill{display:inline-block;background:#d62828;color:#ffffff;font-size:10px;font-weight:bold;
  padding:0 5px;border-radius:8px;margin-left:4px;}
.wf-panel{background:#0d1430;border:1px solid #2a3d6e;padding:7px 9px;margin-top:8px;border-radius:12px;}
.wf-panel .h{color:#eef2ff;font-weight:bold;font-size:13px;margin:0 0 4px;letter-spacing:.5px;}
.wf-panel .k{color:#7f8fb5;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;}
.wf-msg{border:1px solid #2a3d6e;background:#101832;padding:6px 8px;margin-top:6px;}
.wf-msg.unread{border-left:4px solid #d62828;}
.wf-msg.read{opacity:.85;}
.wf-msg .t{color:#eef2ff;font-weight:bold;font-size:13px;}
.wf-msg .b{color:#c8d3ec;font-size:12px;white-space:pre-wrap;}
.wf-tag{display:inline-block;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
  border:1px solid #2a3d6e;color:#9fb0d0;padding:1px 5px;margin-right:4px;}
.wf-tag.sys{border-color:#4070c0;color:#9be7ff;}
.wf-tag.event{border-color:#7c5cd6;color:#c0a8ff;}
.wf-tag.grant{border-color:#3fbf6f;color:#5ce08a;}
.wf-tag.admin{border-color:#c00000;color:#ff9a9a;}
.wf-tag.live{border-color:#3fbf6f;color:#5ce08a;}
.wf-tag.coming{border-color:#f5c451;color:#f5c451;}
.wf-lb{width:100%;border-collapse:collapse;}
.wf-lb td,.wf-lb th{padding:3px 5px;font-size:12px;border-bottom:1px solid #1b2748;text-align:left;}
.wf-lb th{color:#7f8fb5;font-size:9px;letter-spacing:1.3px;text-transform:uppercase;}
.wf-lb td.n{text-align:right;color:#9fb0d0;}
.wf-lb tr.me td{background:#1d1a3a;}
.wf-curve{width:100%;border-collapse:collapse;}
.wf-curve td,.wf-curve th{padding:3px 5px;font-size:11px;border-bottom:1px solid #1b2748;}
.wf-curve th{color:#7f8fb5;font-size:9px;letter-spacing:1.3px;text-transform:uppercase;text-align:left;}
.wf-curve td.lv{width:52px;color:#eef2ff;font-weight:bold;}
.wf-curve td.xp{width:74px;text-align:right;color:#9fb0d0;}
.wf-curve tr.now td{background:#1d1a0f;}
.wf-curve tr.now td.lv{color:#f5c451;}
.wf-curve tr.done td.lv{color:#3fbf6f;}
.wf-curve tr.locked td{color:#66759a;}
.wf-note2{color:#7f8fb5;font-size:11px;margin:5px 0;}
`

/** One href that keeps ?steamid= and ?compact= (the render.js rule). */
function href(url, path, extra) {
  const q = new URLSearchParams()
  const sid = url && url.searchParams ? url.searchParams.get("steamid") : ""
  if (sid) q.set("steamid", sid)
  if (url && url.searchParams && url.searchParams.get("compact") === "1") q.set("compact", "1")
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === "") q.delete(k)
      else q.set(k, String(v))
    }
  }
  const s = q.toString()
  return path + (s ? "?" + s : "")
}

export const PROGRESSION_ITEMS = [
  ["levels", "Levels", "/levels"],
  ["battlepass", "Battle Pass", "/battlepass"],
  ["pass", "Winter Pass", "/winter/pass"]
]

export const REWARD_ITEMS = [
  ["mail", "Mail", "/mail"]
]

export const WINTER_ITEMS = [
  ["hub", "Winterfest Hub", "/winter"],
  ["tree", "Tree", "/winter/tree"],
  ["gifts", "Gifts", "/winter/gifts"],
  ["ornaments", "Ornaments", "/winter/ornaments"],
  ["advent", "Advent", "/winter/advent"]
]

/**
 * The sidebar as the owner drew it: PROGRESSION › Levels, REWARDS › Mail, and
 * the rest of the winter surface below. `active` is one of the keys above;
 * `unread` puts the count badge on Mail.
 */
export function winterSidebar(url, active, unread) {
  const group = (label, items) => `<div class="g">${esc(label)}</div>` + items.map(([key, text, path]) => {
    const on = key === active
    const badge = key === "mail" && num(unread) > 0 ? `<span class="pill">${fmt(unread)}</span>` : ""
    return on
      ? `<a class="on" href="${esc(href(url, path))}">${esc(text)}${badge}</a>`
      : `<a href="${esc(href(url, path))}">${esc(text)}${badge}</a>`
  }).join("")
  return `<div class="wf-nav">
    ${group("Progression", PROGRESSION_ITEMS)}
    ${group("Rewards", REWARD_ITEMS)}
    ${group("Winterfest", WINTER_ITEMS)}
  </div>`
}

/**
 * The top bar: who is looking at this page, on which rung, and the envelope
 * with the unread dot. The envelope is a real route (/mail); the bell in the
 * owner's reference stays the event indicator on the Winterfest hub, and both
 * point at the same inbox — see docs/WINTERFEST-LEVELS-MAIL.md "the bell and the
 * envelope".
 */
export function winterTopBar(opts) {
  const o = opts || {}
  const unread = Math.max(0, num(o.unread))
  // Never say "no player selected" while a steamid IS in the URL: that reads
  // like a bug. A steamid the panel has no snapshot for is an unknown player.
  const who = o.name
    ? esc(o.name)
    : o.steamid ? `Unknown player ${esc(o.steamid)}` : "No player selected"
  const sub = o.name && o.steamid
    ? esc(o.steamid)
    : o.steamid ? "no server snapshot yet" : "open this page with ?steamid= or from the game"
  const right = o.level
    ? `Lv ${fmt(o.level)}${o.rank ? ` &middot; ${esc(o.rank)}` : ""}`
    : ""
  // SVG for a browser, a text glyph for the GoldSrc MOTD browser (render.js's
  // rule: MSIE cannot draw inline SVG). Never an image request.
  const envelope = o.compact
    ? `MAIL${unread ? ` (${fmt(unread)})` : ""}`
    : `<svg width="15" height="12" viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px" aria-hidden="true"><rect x="0.5" y="0.5" width="14" height="11" rx="1.5" fill="none" stroke="#9be7ff"/><path d="M1 2 L7.5 7 L14 2" fill="none" stroke="#9be7ff"/></svg> MAIL`
  return `<table class="wf-top" cellspacing="0" cellpadding="0" border="0"><tr>
    <td><span class="kick">Winterfest &middot; ${esc(o.kicker || "Dashboard")}</span><br>
      <span class="who">${who}</span> <span class="kick">${sub}</span>${right ? ` &middot; <b style="color:#f5c451;">${right}</b>` : ""}</td>
    <td class="right"><a class="wf-env${unread ? " unread" : ""}" href="${esc(href(o.url, "/mail"))}" title="${
      unread ? `${fmt(unread)} unread message${unread === 1 ? "" : "s"}` : "Inbox — no unread messages"
    }">${envelope}</a>${unread ? `<span class="dot wf-dot"></span><span class="wf-count">${fmt(unread)}</span>` : ""}</td>
  </tr></table>`
}

/** Top bar + sidebar + main column. `body` is already-rendered HTML. */
export function winterDashboard(url, opts, body) {
  const o = opts || {}
  return `${winterTopBar({ ...o, url })}
<table class="wf-lay" cellspacing="0" cellpadding="0" border="0"><tr>
  <td class="side">${winterSidebar(url, o.active, o.unread)}</td>
  <td class="main">${body}</td>
</tr></table>`
}

// ------------------------------------------------------------------- loader --
/**
 * Everything /levels needs: the season line, the ornament catalogue (so reward
 * ids print their real names), the player's own row and the lifetime XP board.
 * Same helpers every other winter page uses; no new query path.
 */
export async function loadLevelsContext(env, url, unread) {
  const nowSec = Math.floor(Date.now() / 1000)
  const season = await loadSeason(env, nowSec)
  const cat = await loadCatalog(env)
  const sid = normalizeSteamid(url && url.searchParams ? url.searchParams.get("steamid") : "")
  let row = null
  if (sid) {
    try {
      row = await env.DB.prepare(
        "SELECT steamid, name, xp, level, rank_id, bp_xp, bp_tier FROM players WHERE steamid=?1"
      ).bind(sid).first()
    } catch { row = null }
  }
  const board = await lifetimeBoard(env, { metric: "xp", limit: 10 })
  return { env, url, nowSec, season, cat, sid, steamid: sid, row, board, unread: Math.max(0, num(unread)) }
}

// --------------------------------------------------------------------- page --
export async function pageLevels(env, url, opts) {
  const o = opts || {}
  const ctx = await loadLevelsContext(env, url, o.unread)
  const { season, cat, sid, row, board, unread } = ctx
  const pos = levelPosition(row)
  const name = row && row.name ? String(row.name) : ""

  const catalogueNote = cat && cat.ok
    ? ""
    : `<div class="wf-note2">The ornament catalogue has not been pushed by the game yet, so ornament rewards are shown by id and their names are not guessed.</div>`

  // ---- the player's position -------------------------------------------
  const position = !sid
    ? `<div class="wf-panel"><div class="k">Your position</div>
        <div class="wf-note2">No player selected — open this page with <code>?steamid=STEAM_0:0:12345</code> or from the game (the N menu). The curve below is the real ladder; nothing is filled in for a player the panel does not know.</div></div>`
    : !row
      ? `<div class="wf-panel"><div class="k">Your position</div>
          <div class="wf-note2">The panel has no server snapshot for <b>${esc(sid)}</b> yet. That is normal before the first push: play one round and the ladder below fills in. Nothing here is estimated.</div></div>`
      : `<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
          ${statCard("Level", `${fmt(pos.level)} <span class="wf-s">of ${pos.maxLevel}</span>`, esc(pos.rank), "gold")}
          ${statCard("Rank XP", fmt(pos.xp), pos.atMax ? "top of the ladder" : `next rung at ${fmt(pos.nextAt)}`)}
        </tr><tr>
          ${statCard("Into this level", `${fmt(pos.into)} / ${fmt(pos.span)}`, `${pos.pct}% of the way`)}
          ${statCard("To the next level", pos.atMax ? "—" : fmt(pos.toNext), pos.atMax ? "Global Elite has no rung above it" : esc(rankName(Math.min(MAX_LEVEL, pos.level + 1))), "ice")}
        </tr><tr>
          ${statCard("Battle Pass tier", fmt(pos.bpTier), "a DIFFERENT track (bp_xp / bp_tier) — not this level", "green")}
          ${statCard("Level rewards", fmt(LEVEL_REWARDS.filter(r => rewardState(r).state === "live").length), "live reward rungs on the ladder, of " + fmt(LEVEL_REWARDS.length) + " configured")}
        </tr></table>
        <div style="margin-top:6px;">${bar(pos.pct, pos.atMax ? "#f5c451" : "#3fbf6f")}</div>
        <div class="wf-note2">${pos.atMax
          ? `Global Elite (level ${pos.maxLevel}) — the ladder is complete.`
          : `${fmt(pos.xp)} XP &middot; ${fmt(pos.nextAt - pos.xp)} to level ${pos.level + 1} (${esc(rankName(pos.level + 1))})`}</div>`

  // ---- next reward + the next three milestones --------------------------
  const nxt = nextRewardLevel(pos.level)
  const nextEntry = nxt ? rewardAt(nxt) : null
  const nextState = rewardState(nextEntry)
  const nextLine = nxt
    ? `<div class="wf-note2">Next reward at <b>level ${fmt(nxt)}</b>: <b>${esc(rewardText(nextEntry, cat))}</b>
        <span class="wf-tag ${nextState.state}">${esc(nextState.state)}</span>
        ${nextState.state === "coming" ? `<br>Why: ${esc(nextState.why)}` : ""}</div>`
    : `<div class="wf-note2">No reward is configured above level ${fmt(pos.level)}.</div>`

  const ms = milestones(pos.level, 3)
  const msRows = ms.length
    ? ms.map(m => {
        const st = rewardState(m.reward)
        return `<tr>
          <td class="lv"><b>${fmt(m.level)}</b></td>
          <td class="xp">${fmt(m.xp)} XP</td>
          <td>${m.reward ? esc(rewardText(m.reward, cat)) : `<span class="wf-note2">no reward configured</span>`}</td>
          <td class="xp"><span class="wf-tag ${st.state}">${esc(st.state)}</span></td>
        </tr>`
      }).join("")
    : `<tr><td colspan="4"><span class="wf-note2">The ladder is complete — nothing above Global Elite.</span></td></tr>`

  // ---- the curve ---------------------------------------------------------
  const rewardByLevel = new Map(LEVEL_REWARDS.map(r => [r.level, r]))
  const curveRows = RANKS.map((rank, i) => {
    const level = i + 1
    const floor = LEVEL_XP[i]
    const reward = rewardByLevel.get(level) || null
    const st = rewardState(reward)
    const reached = pos.found && level <= pos.level
    const now = pos.found && level === pos.level
    const cls = now ? "now" : reached ? "done" : "locked"
    const marker = now ? "&rarr;" : reached ? "&check;" : ""
    return `<tr class="${cls}">
      <td class="lv">${marker} ${fmt(level)}</td>
      <td>${esc(rank)}</td>
      <td class="xp">${fmt(floor)} XP</td>
      <td>${reward ? esc(rewardText(reward, cat)) : `<span class="wf-note2">—</span>`}${
        reward ? ` <span class="wf-tag ${st.state}">${esc(st.state)}</span>` : ""}</td>
    </tr>`
  }).join("")

  // ---- leaderboard-lite --------------------------------------------------
  const lbRows = (board.rows || []).map(r => {
    const lvl = levelFromXp(r.value)
    const me = sid && r.steamid === sid
    return `<tr class="${me ? "me" : ""}">
      <td class="n">${fmt(r.rank)}</td>
      <td>${esc(r.name || r.steamid)}${me ? ` <span class="wf-tag live">you</span>` : ""}</td>
      <td class="n">Lv ${fmt(lvl)}</td>
      <td class="n">${fmt(r.value)} XP</td>
    </tr>`
  }).join("")
  const leaderboard = lbRows
    ? `<table class="wf-lb" cellspacing="0" cellpadding="0" border="0">
        <tr><th>#</th><th>Player</th><th style="text-align:right">Level</th><th style="text-align:right">Rank XP</th></tr>
        ${lbRows}
      </table>
      <div class="wf-note2">The top ${fmt((board.rows || []).length)} by lifetime rank XP, read through boards.js's lifetime board (the same helper /top uses). The level column is derived from the same XP floors as the curve above.</div>`
    : `<div class="wf-note2">No rank XP has been pushed yet, so the board is empty rather than invented.</div>`

  const body = `${winterDashboard(url, {
    kicker: "Levels",
    active: "levels",
    unread,
    name,
    steamid: sid,
    level: pos.found ? pos.level : 0,
    rank: pos.found ? pos.rank : "",
    compact: !!(url && url.searchParams && url.searchParams.get("compact") === "1")
  }, `
    ${position}
    <div class="wf-panel">
      <div class="h">Next reward</div>
      ${nextLine}
    </div>
    <div class="wf-panel">
      <div class="h">The next three milestones</div>
      <table class="wf-curve" cellspacing="0" cellpadding="0" border="0">
        <tr><th>Level</th><th style="text-align:right">XP floor</th><th>Reward</th><th style="text-align:right">State</th></tr>
        ${msRows}
      </table>
    </div>
    <div class="wf-panel">
      <div class="h">The curve <span class="k">19 rungs &middot; Rank System Ultimate</span></div>
      <table class="wf-curve" cellspacing="0" cellpadding="0" border="0">
        <tr><th>Level</th><th>Rank</th><th style="text-align:right">XP floor</th><th>Reward at this level</th></tr>
        ${curveRows}
      </table>
      <div class="wf-note2">XP floors are the <code>[Ranks]</code> table in
        <code>configs/rank_system_ultimate.ini</code> — the table the plugin itself reads, mirrored in
        <code>src/ranks.js</code> (the same numbers <code>/profile</code> uses). No formula is applied here:
        the game decides the level, this page reads it.</div>
      ${catalogueNote}
    </div>
    <div class="wf-panel">
      <div class="h">Leaderboard — top 10 by rank XP</div>
      ${leaderboard}
    </div>
    <div class="wf-panel">
      <div class="h">What this page can and cannot do</div>
      <div class="wf-note2"><b>Informational in Phase 1.</b> Level rewards have no claim ledger in the game
        yet, so nothing on this page is claimable and no link here pays anything — a reward marked
        <span class="wf-tag coming">coming</span> is not implemented and cannot be claimed by any route.
        When the game can pay a rung through its one idempotent grant path (<code>wf_grant</code>, claim key
        <code>level#&lt;level&gt;</code>), a claim link can be added here; the table in
        <code>configs/freenova/winterfest/levels.ini</code> is where the rewards themselves live.</div>
      <div class="wf-note2"><b>A level is not a Battle Pass tier.</b> The rung above is rank XP
        (<code>players.xp</code>/<code>players.level</code>); the BattlePass is its own 60-tier track over
        <code>bp_xp</code>/<code>bp_tier</code> at <a href="${esc(href(url, "/battlepass"))}">/battlepass</a>.
        Ranking up never moves a BP tier and a BP grant never moves rank XP.</div>
    </div>
  `)}`

  return winterPage("LEVELS", `<style>${CHROME_CSS}</style>${body}`, { season, url })
}
