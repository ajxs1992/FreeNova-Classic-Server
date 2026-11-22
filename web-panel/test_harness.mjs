// FreeNova panel test suite. Starts the local Node panel against disposable
// SQLite databases and checks, in this order:
//
//   1. every player-facing route, the compact MOTD skin and the hub's links
//      (the original smoke suite - it must stay green and stay first);
//   2. the signed game push: replay guard, signature check, body cap, and the
//      ordering guard that stops a stale snapshot rolling counters back;
//   2b. the BattlePass XP ledger (REVIEW.md §2.4 H1): a push carrying
//      bp_xp/bp_tier lands in its own columns, a stale push cannot lower them,
//      a player with rank XP and 0 BP XP renders tier 1 (never NaN, never a
//      rank-derived tier), and the tier curve matches bp_track.js;
//   3. the action queue: claim-once under concurrency, exactly one re-dispatch
//      for a lost reply, a receipt for a re-dispatched row, and expiry only
//      after the dispatch attempts are used;
//   4. the admin surface: the theme key is refused in a URL and accepted in a
//      POST body / header, the login lockout is keyed on the platform address
//      (not x-forwarded-for) and its counters are pruned;
//   5. token policy: no panel-side action-token minting unless FN_LOCAL_TRUST=1,
//      with the claim pages saying so instead of doing nothing;
//   6. Referrer-Policy on URLs that carry a token in the query string;
//   7. unit checks: sqlite_d1 batch atomicity, bp_track's premium table.
//
// Run: node test_harness.mjs   (exit 0 = every check passed)
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { request } from "node:http"

import { openLocalD1 } from "./src/sqlite_d1.js"
import { handleSync, mintActionToken, localTrustEnabled } from "./src/sync.js"
import {
  premiumExtraCoins, premiumCoins, xpPerTier, PREMIUM_COINS,
  bpTierFromXp, bpInto, playerBpTier, BP_MAX_TIER,
} from "./src/bp_track.js"
// MOTD v2 + public API + weekly/monthly boards (this agent's surface).
import {
  periodBounds, weekKeyAt, monthKeyAt, previousKey, keysBefore, parisMidnight, parisParts, isoWeekOf
} from "./src/periods.js"
import {
  ensureBoardTables, refreshMarks, periodBoard, lifetimeBoard, settlePeriod,
  maybeRollover, playerBadges, playerPeriodStanding, playerLifetimeStanding
} from "./src/boards.js"
import { normalizeSteamid } from "./src/publicapi.js"
import { countdownText } from "./src/schedule.js"
import { renderFallback } from "./src/motd.js"
// Winterfest panel surface (this agent: src/winter/*).
import { resolveSeason, parisStamp } from "./src/winter/season.js"
import {
  normalizeWinterCatalog, rewardType, rewardLabel, rarityColor, loadCatalog, adventEntry
} from "./src/winter/catalog.js"
import { adventStatus, passStatus, treeStatus } from "./src/winter/progress.js"
import { applyWinterPayload, ensureWinterTables, loadState } from "./src/winter/store.js"
import { WINTER_SKIN_MARK } from "./src/winter/skin.js"
// The v2 design rebuild (src/v2/): shell + components + the dashboard adapters.
import {
  countdownParts, shortDuration, eventState, objectiveRows,
  ornamentCounts, rewardTiles, loadDashboard, ADAPTER_CONTRACT
} from "./src/v2/data/dashboard.js"
import { render as renderDashboardV2 } from "./src/v2/pages/dashboard.js"
import { icon as v2icon, ICON_NAMES } from "./src/v2/icons.js"
import { page as v2page } from "./src/v2/shell.js"
// Levels page + the envelope (this agent: workstreams 14 and 15).
import {
  LEVEL_REWARDS, REWARD_KINDS, MAX_LEVEL, LEVEL_XP,
  levelFromXp, levelPosition, rewardAt, nextRewardLevel, rewardState, rewardText, milestones
} from "./src/winter/levels.js"
import {
  MAIL_DDL, MAIL_KINDS, unreadCount, loadInbox, loadMessage, sendMail,
  ensureMailTables, normalizeKind, isVisible, expiryFromDays, applyMailReads
} from "./src/winter/mail.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "freenova-panel-test-"))
const SECRET = "test-only-secret"
const ADMIN = "test-only-admin"
const NO_MINT = "Action links are not available on this deployment"

let passed = 0
let failures = 0

function ok(name, extra) {
  passed++
  console.log(`PASS ${name}${extra ? " " + extra : ""}`)
}
function bad(name, detail) {
  failures++
  console.error(`FAIL ${name}${detail ? ": " + detail : ""}`)
}
function check(name, cond, detail) {
  if (cond) ok(name, detail)
  else bad(name, detail)
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function sha256hex(text) { return createHash("sha256").update(text).digest("hex") }

// ---------------------------------------------------------------- panel ----
class Panel {
  constructor(name, extraEnv) {
    this.name = name
    this.dbFile = join(root, name + ".sq3")
    this.extraEnv = extraEnv || {}
    this.output = ""
    this.child = null
  }
  async start(port) {
    this.port = port
    this.child = spawn(process.execPath, ["server_local.mjs"], {
      cwd: here,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        PANEL_DB: this.dbFile,
        FNWEB_SECRET: SECRET,
        ADMIN_PASSWORD: ADMIN,
        ...this.extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.child.stdout.on("data", c => { this.output += c.toString() })
    this.child.stderr.on("data", c => { this.output += c.toString() })
    for (let i = 0; i < 60; i++) {
      if (this.output.includes("[panel] HTTP")) return this
      await wait(250)
    }
    throw new Error(`panel ${this.name} did not become ready:\n${this.output}`)
  }
  get base() { return `http://127.0.0.1:${this.port}` }
  async stop() {
    if (this.child) this.child.kill()
    await wait(200)
  }
  // Read-only view of this panel's database (WAL, so a reader is safe).
  db() { return new DatabaseSync(this.dbFile, { readOnly: true }) }
  first(sql, ...args) {
    const db = this.db()
    try { return db.prepare(sql).get(...args) } finally { db.close() }
  }
  all(sql, ...args) {
    const db = this.db()
    try { return db.prepare(sql).all(...args) } finally { db.close() }
  }
}

// ------------------------------------------------------- signed push API ---
function pushSignature(path, ts, nonce, body) {
  return sha256hex(`${SECRET}:POST:${path}:${ts}:${nonce}:${sha256hex(body)}`)
}

async function push(panel, payload, opts = {}) {
  const path = opts.path || "/api/v1/server/stats"
  const body = opts.rawBody != null ? String(opts.rawBody) : JSON.stringify(payload)
  const ts = opts.ts != null ? opts.ts : Math.floor(Date.now() / 1000)
  const nonce = opts.nonce || ("n" + Math.random().toString(36).slice(2) + Date.now())
  const sig = opts.sig != null ? opts.sig : pushSignature(path, ts, nonce, body)
  return fetch(panel.base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-freenova-timestamp": String(ts),
      "x-freenova-nonce": nonce,
      "x-freenova-signature": sig,
      "x-freenova-server-id": "harness",
    },
    body,
  })
}

// One POST over node:http, isolated from the fetch pool. Resolves to the status
// code, or 0 when the server drops the connection (also a refusal).
function rawPost(port, path, body) {
  return new Promise(resolve => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, res => {
      res.resume()
      resolve(res.statusCode || 0)
    })
    req.on("error", () => resolve(0))
    req.end(body)
  })
}

function player(steamid, extra) {
  return {
    steamid,
    name: "harness-" + steamid.slice(-3),
    xp: 0, level: 0, rank_id: 0, prestige: 0, kills: 0, deaths: 0, assists: 0,
    headshots: 0, damage: 0, shots: 0, hits: 0, mvps: 0, wins: 0, losses: 0,
    playtime_minutes: 0, rating_x100: 0, vip_tier: 0, vip_remaining: 0,
    coins: 0, ...(extra || {}),
  }
}

// The Winterfest catalogue exactly as the game is expected to push it
// (payload.catalogs.winterfest). docs/WINTERFEST-PANEL.md is the field contract;
// this fixture is what the panel-side checks drive the renderer with.
function winterCatalogue() {
  // Shapes copied from winterfest.ini (2026-11-22): [rarity] stores "R G B",
  // [ornament] fifth column is `hidden`, [set] carries a bonus and a title,
  // [advent]/[pass] carry a MAGNITUDE in their last column, [tree] is 24 x/y rows
  // per style. If the panel accepts this, it accepts what the game will push.
  const slots = style => Array.from({ length: 24 }, (_, i) => ({
    slot: i + 1,
    x: style === 2 ? 26 + (i % 4) * 16 : 10 + (i % 8) * 11,
    y: style === 2 ? 6 + Math.floor(i / 4) * 15 : style === 3 ? 20 + Math.floor(i / 8) * 30 : 8 + Math.floor(i / 6) * 17
  }))
  return {
    version: 1,
    season: { name: "Winterfest", year: 2026, start: "2026-12-01 00:00", end: "2026-12-24 23:59", advent_end: "2026-12-24 23:59", enabled: 1 },
    rarities: [
      { id: 0, name: "Common", color: "190 220 255", weight: 62 },
      { id: 1, name: "Uncommon", color: "120 255 140", weight: 28 },
      { id: 2, name: "Rare", color: "255 215 90", weight: 10 },
    ],
    ornaments: [
      { id: 1, name: "Crystal Snowflake", rarity: 0, set: 1, hidden: 0 },
      { id: 2, name: "Frosted Snowflake", rarity: 0, set: 1, hidden: 0 },
      { id: 3, name: "Silver Snowflake", rarity: 1, set: 1, hidden: 0 },
      { id: 4, name: "Frozen Star", rarity: 1, set: 1, hidden: 1 },
      { id: 5, name: "Diamond Snowflake", rarity: 2, set: 1, hidden: 1 },
      { id: 6, name: "Jolly Santa", rarity: 0, set: 2, hidden: 0 },
      { id: 7, name: "Wooden Sleigh", rarity: 0, set: 2, hidden: 0 },
      { id: 8, name: "Brass Bell", rarity: 1, set: 2, hidden: 0 },
      { id: 9, name: "Golden Santa", rarity: 1, set: 2, hidden: 1 },
      { id: 10, name: "Frozen Crown", rarity: 2, set: 2, hidden: 1 },
    ],
    sets: [
      { id: 1, name: "Snowflakes", title: "Ice Warrior", snow: 100 },
      { id: 2, name: "Santas", title: "Santa's Helper", snow: 150 },
    ],
    advent: Array.from({ length: 24 }, (_, i) => (i + 1 === 9
      ? { day: 9, type: "ornament", id: 1, amount: 0 }
      : { day: i + 1, type: "snow", id: 0, amount: 40 + i * 5 })),
    pass: Array.from({ length: 30 }, (_, i) => ({ tier: i + 1, xp: (i + 1) * 300, type: "snow", id: 0, amount: 100 + i * 10 })),
    tree: [1, 2, 3].map(style => ({ style, name: ["Classic", "Tall", "Wide"][style - 1], slots: slots(style) })),
    community: { key: "gifts", label: "Presents opened", current: 4321, target: 10000 },
  }
}

const routes = ["/hub", "/profile", "/bp", "/battlepass", "/missions", "/achievements",
  "/competitive", "/events", "/vip", "/shop", "/skins", "/models", "/cosmetics",
  "/settings", "/rules", "/top15", "/top/week", "/top/month", "/admin"]

// =================================================================== main ==
const panel = new Panel("main")
const trusted = new Panel("trusted", { FN_LOCAL_TRUST: "1" })
// A third process so the public-API rate limit can be exercised without
// spending the main panel's bucket.
const limited = new Panel("limited", { PANEL_PUBLIC_RATE_LIMIT: "2" })
// Winterfest gets its own process: the section below pushes a season window and
// turns the Christmas skin on, which must not leak into the checks above.
const winterPanel = new Panel("winter", { FN_LOCAL_TRUST: "1" })
// Levels + Mail get their own process too: they seed players and a mailbox, and
// must not disturb the databases the sections above assert against.
const levelPanel = new Panel("levels-mail", { FN_LOCAL_TRUST: "1" })

try {
  await panel.start(18080)
  await trusted.start(18081)
  await limited.start(18082)

  // ---------------------------------------------------------- 1. smoke ----
  for (const route of routes) {
    const res = await fetch(panel.base + route, { redirect: "manual" })
    if (![200, 302].includes(res.status)) bad(route, "-> " + res.status)
    else ok(route, "-> " + res.status)
  }
  for (const route of ["/hub", "/profile", "/bp", "/shop"]) {
    const res = await fetch(panel.base + route + "?compact=1", {
      headers: { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" },
    })
    const body = await res.text()
    let clean = res.status === 200
    for (const needle of ["display:flex", "display: grid", "var("]) {
      if (body.includes(needle)) { bad(`compact ${route}`, "contains " + needle); clean = false }
    }
    if (clean) ok("compact " + route)
  }

  // Every internal target advertised by the hub must resolve.
  const hub = await (await fetch(panel.base + "/hub")).text()
  const links = [...new Set([...hub.matchAll(/href=['"]([^'"]+)/g)].map(m => m[1]))]
  for (const link of links) {
    if (/^(#|mailto:|javascript:)/i.test(link)) continue
    if (/^https?:/i.test(link)) { console.log(`SKIP external ${link}`); continue }
    const res = await fetch(panel.base + link, { redirect: "manual" })
    if (![200, 302].includes(res.status)) bad("hub link " + link, "-> " + res.status)
  }
  ok("hub link audit", `(${links.length} targets)`)
  ok("panel smoke suite")

  // ------------------------------------------------ 2. signed game push ----
  const now = Math.floor(Date.now() / 1000)
  const steamA = "STEAM_0:0:101"

  const first = await push(panel, { players: [player(steamA, { xp: 5000, coins: 777, last_seen: now })] })
  check("push accepted", first.status === 200, "-> " + first.status)
  const rowA = panel.first(`SELECT xp, coins, last_seen FROM players WHERE steamid=?1`, steamA)
  check("push stored the row", !!rowA && Number(rowA.xp) === 5000, rowA ? `xp=${rowA.xp}` : "missing")

  // replay of the identical signed request
  const replayNonce = "replay-" + now
  const bodyOnce = JSON.stringify({ players: [player(steamA, { xp: 5001, last_seen: now })] })
  const r1 = await push(panel, null, { rawBody: bodyOnce, nonce: replayNonce, ts: now })
  const r2 = await push(panel, null, { rawBody: bodyOnce, nonce: replayNonce, ts: now })
  check("first signed request accepted", r1.status === 200, "-> " + r1.status)
  check("replayed nonce refused", r2.status === 401, "-> " + r2.status)

  // wrong signature
  const wrong = await push(panel, { players: [] }, { sig: "0".repeat(64) })
  check("wrong signature refused", wrong.status === 401, "-> " + wrong.status)

  // the ordering guard: an older snapshot must not roll the counters back
  const beforeStale = panel.first(`SELECT xp, coins FROM players WHERE steamid=?1`, steamA)
  const stale = await push(panel, {
    players: [player(steamA, { xp: 1, coins: 1, last_seen: now - 600 })],
  })
  check("stale push accepted (it is a valid request)", stale.status === 200, "-> " + stale.status)
  const rowStale = panel.first(`SELECT xp, coins FROM players WHERE steamid=?1`, steamA)
  check("stale push did not lower xp", Number(rowStale.xp) === Number(beforeStale.xp),
    `${beforeStale.xp} -> ${rowStale.xp}`)
  check("stale push did not lower coins", Number(rowStale.coins) === Number(beforeStale.coins),
    `${beforeStale.coins} -> ${rowStale.coins}`)

  // ...and a newer push still applies
  await push(panel, { players: [player(steamA, { xp: 6000, coins: 800, last_seen: now + 60 })] })
  const rowNew = panel.first(`SELECT xp, coins FROM players WHERE steamid=?1`, steamA)
  check("newer push applied", Number(rowNew.xp) === 6000, "xp=" + rowNew.xp)

  // ------------------------------- 2b. BattlePass XP ledger (REVIEW §2.4) ----
  const steamBp = "STEAM_0:0:303"
  check("BP push accepted", (await push(panel, {
    players: [player(steamBp, { xp: 40000, level: 40, bp_xp: 1500, bp_tier: 2, last_seen: now + 300 })],
  })).status === 200)
  const bpRow = panel.first(`SELECT bp_xp, bp_tier, xp FROM players WHERE steamid=?1`, steamBp)
  check("push stored bp_xp", !!bpRow && Number(bpRow.bp_xp) === 1500, bpRow ? "bp_xp=" + bpRow.bp_xp : "missing")
  check("push stored bp_tier", !!bpRow && Number(bpRow.bp_tier) === 2, bpRow ? "bp_tier=" + bpRow.bp_tier : "missing")

  // a late snapshot may no more roll BP XP back than rank xp
  await push(panel, {
    players: [player(steamBp, { xp: 1, level: 1, bp_xp: 0, bp_tier: 0, last_seen: now - 600 })],
  })
  const bpStale = panel.first(`SELECT bp_xp, bp_tier FROM players WHERE steamid=?1`, steamBp)
  check("stale push did not lower bp_xp", Number(bpStale.bp_xp) === 1500, "bp_xp=" + bpStale.bp_xp)
  check("stale push did not lower bp_tier", Number(bpStale.bp_tier) === 2, "bp_tier=" + bpStale.bp_tier)

  // the ledger still follows a newer snapshot (so it is not write-once)
  await push(panel, {
    players: [player(steamBp, { xp: 40000, level: 40, bp_xp: 3200, bp_tier: 4, last_seen: now + 600 })],
  })
  const bpNew = panel.first(`SELECT bp_xp, bp_tier FROM players WHERE steamid=?1`, steamBp)
  check("newer push raised bp_xp", Number(bpNew.bp_xp) === 3200, "bp_xp=" + bpNew.bp_xp)
  check("newer push raised bp_tier", Number(bpNew.bp_tier) === 4, "bp_tier=" + bpNew.bp_tier)

  // A rank-52 player with no BP XP: tier 1, empty progress, no NaN anywhere.
  const steamZero = "STEAM_0:0:304"
  await push(panel, {
    players: [player(steamZero, { xp: 59000, level: 52, rank_id: 52, bp_xp: 0, bp_tier: 0, last_seen: now + 300 })],
  })
  const bpPage = await (await fetch(panel.base + "/battlepass?steamid=" + encodeURIComponent(steamZero))).text()
  const bpPageTier = (bpPage.match(/Tier<\/span><span class='v p'>(\d+) \/ 60/) || [])[1]
  check("0 BP XP renders tier 1 on /battlepass", bpPageTier === "1", "tier=" + bpPageTier)
  check("/battlepass shows no NaN for a 0 BP XP player", !bpPage.includes("NaN"))
  const profZero = await (await fetch(panel.base + "/profile?steamid=" + encodeURIComponent(steamZero))).text()
  check("0 BP XP renders tier 1 on /profile", profZero.includes("Tier 1 / 60"))
  check("/profile shows 0 / 1,000 BP XP", /0 \/ 1,000 BP XP/.test(profZero))
  check("/profile shows no NaN for a 0 BP XP player", !profZero.includes("NaN"))

  // Worker-side body cap (unit: the handler refuses before touching the DB)
  const bigBody = JSON.stringify({ players: [], pad: "x".repeat(2 * 1024 * 1024 + 16) })
  const bigTs = Math.floor(Date.now() / 1000)
  const bigNonce = "big-" + bigTs
  const bigRes = await handleSync(new Request("http://panel.invalid/api/v1/server/stats", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-freenova-timestamp": String(bigTs),
      "x-freenova-nonce": bigNonce,
      "x-freenova-signature": pushSignature("/api/v1/server/stats", bigTs, bigNonce, bigBody),
    },
    body: bigBody,
  }), { SYNC_SECRET: SECRET })
  check("oversize push refused with 413", bigRes.status === 413, "-> " + bigRes.status)

  // The local runner caps the socket read as well. Sent with node:http rather
  // than fetch: the server answers 413 without draining a 3 MB upload, which
  // kills the keep-alive socket, and undici would then hand that dead socket to
  // the next request in the pool as "fetch failed".
  const hugeStatus = await rawPost(panel.port, "/api/v1/server/stats", "x".repeat(3 * 1024 * 1024))
  check("runner body cap refuses 3 MB", hugeStatus === 413 || hugeStatus === 0, "status=" + hugeStatus)

  // -------------------------------------------------- 3. action queue ----
  const insertAction = (steamid, type, arg, status, attempts, createdAt) => {
    const db = new DatabaseSync(panel.dbFile)
    try {
      const info = db.prepare(
        `INSERT INTO actions (steamid, type, arg, status, attempts, created_at) VALUES (?,?,?,?,?,?)`
      ).run(steamid, type, arg, status, attempts, createdAt)
      return Number(info.lastInsertRowid)
    } finally { db.close() }
  }
  const actionState = id => panel.first(`SELECT status, attempts FROM actions WHERE id=?1`, id)

  const actId = insertAction("STEAM_0:0:202", "claim_bp", "1", "pending", 0, now)
  const d1 = await (await push(panel, { players: [] })).json()
  const sentIds1 = (d1.actions || []).map(a => a.id)
  check("pending action dispatched", sentIds1.includes(actId), "ids=" + sentIds1.join(","))
  const s1 = actionState(actId)
  check("first dispatch marks it sent/attempts=1", s1.status === "sent" && Number(s1.attempts) === 1, `${s1.status}/${s1.attempts}`)

  const d2 = await (await push(panel, { players: [] })).json()
  const sentIds2 = (d2.actions || []).map(a => a.id)
  check("a lost reply is re-dispatched once", sentIds2.includes(actId), "ids=" + sentIds2.join(","))
  const s2 = actionState(actId)
  check("re-dispatch counts as attempt 2", s2.status === "sent" && Number(s2.attempts) === 2, `${s2.status}/${s2.attempts}`)

  const d3 = await (await push(panel, { players: [] })).json()
  check("no third dispatch", !(d3.actions || []).some(a => a.id === actId))

  // a receipt for a re-dispatched row is accepted (the game may have applied it)
  await push(panel, {
    players: [],
    action_results: [{ id: actId, ok: true, result: "already applied" }],
  })
  const s3 = actionState(actId)
  check("receipt closes a re-dispatched action", s3.status === "done", "status=" + s3.status)

  // The claim is `UPDATE ... AND attempts=<the value we read>`, so the number of
  // times a row is advertised can never exceed its attempts budget, and the
  // counter always agrees with what the game was told. The pre-fix bug read rows
  // and then flipped them by id alone: one row came back in both responses while
  // attempts stayed 1, and the game paid twice.
  const raceId = insertAction("STEAM_0:0:203", "claim_event", "7", "pending", 0, now)
  const [c1, c2] = await Promise.all([
    push(panel, { players: [] }).then(r => r.json()),
    push(panel, { players: [] }).then(r => r.json()),
  ])
  const dupInOne = (r) => new Set((r.actions || []).map(a => a.id)).size !== (r.actions || []).length
  check("no response carries the same action twice", !dupInOne(c1) && !dupInOne(c2))
  const advertised = [...(c1.actions || []), ...(c2.actions || [])].filter(a => a.id === raceId).length
  const raceState = actionState(raceId)
  check("dispatches stay inside the attempts budget", advertised >= 1 && advertised <= 2, "advertised=" + advertised)
  check("attempts match the number of dispatches", Number(raceState.attempts) === advertised,
    `${raceState.attempts} vs ${advertised}`)

  // expiry only after the attempts are used
  const staleSent1 = insertAction("STEAM_0:0:204", "claim_bp", "1", "sent", 1, now - 3700)
  const staleSent2 = insertAction("STEAM_0:0:205", "claim_bp", "1", "sent", 2, now - 3700)
  const ancient = insertAction("STEAM_0:0:206", "claim_bp", "1", "sent", 1, now - 7300)
  await push(panel, { players: [] })
  check("sent row with attempts left is not expired", actionState(staleSent1).status === "sent", actionState(staleSent1).status)
  check("sent row with every attempt used expires", actionState(staleSent2).status === "expired", actionState(staleSent2).status)
  check("sent row past the hard stop expires", actionState(ancient).status === "expired", actionState(ancient).status)

  // ------------------------------------------------- 4. admin surface ----
  const keyed = await fetch(panel.base + "/top15?theme=save&k=" + encodeURIComponent(ADMIN) + "&t_accent=%23ff0000", { redirect: "manual" })
  check("GET admin key refused", keyed.status === 403, "-> " + keyed.status)
  const afterKeyed = await (await fetch(panel.base + "/top15")).text()
  check("GET admin key changed nothing", !afterKeyed.includes("#ff0000"))

  const storedTheme = () => {
    const row = panel.first(`SELECT json FROM catalog WHERE key=?1`, "top15_theme")
    try { return row ? JSON.parse(row.json) : {} } catch { return {} }
  }
  const posted = await fetch(panel.base + "/top15?theme=save", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-freenova-admin-key": ADMIN },
    body: "t_accent=%23ff0000",
    redirect: "manual",
  })
  check("POST with header key accepted", posted.status === 302, "-> " + posted.status)
  check("POST theme saved", storedTheme().accent === "#ff0000", JSON.stringify(storedTheme().accent))

  const bodyKey = await fetch(panel.base + "/top15?theme=save", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "k=" + encodeURIComponent(ADMIN) + "&t_accent=%2300ff00",
    redirect: "manual",
  })
  check("POST with body key accepted", bodyKey.status === 302, "-> " + bodyKey.status)

  const wrongKey = await fetch(panel.base + "/top15?theme=save", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-freenova-admin-key": "nope" },
    body: "t_accent=%23111111",
    redirect: "manual",
  })
  check("wrong key refused", wrongKey.status === 403, "-> " + wrongKey.status)

  // lockout keyed on the platform address, not on x-forwarded-for
  const staleAt = Math.floor(Date.now() / 1000) - 7200
  const writer = new DatabaseSync(panel.dbFile)
  try {
    writer.prepare(`INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2`)
      .run("login_fail:203.0.113.9", "9:" + staleAt)
  } finally { writer.close() }

  // A client cannot pick its own lockout bucket with a platform header: the
  // runner strips cf-connecting-ip / x-forwarded-for and stamps the socket
  // address instead, so this failure lands in the shared bucket, not in
  // "login_fail:203.0.113.77".
  await fetch(panel.base + "/admin", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.77" },
    body: "steamid=STEAM_0%3A0%3A683671116&password=spoof",
  })
  const spoofRow = panel.first(`SELECT value FROM meta WHERE key=?1`, "login_fail:203.0.113.77")
  check("client cannot choose its lockout bucket", !spoofRow, spoofRow ? "row exists" : "")

  let blocked = 0
  for (let i = 0; i < 6; i++) {
    const res = await fetch(panel.base + "/admin", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": `198.51.100.${i + 1}`,
      },
      body: "steamid=STEAM_0%3A0%3A683671116&password=wrong-" + i,
    })
    const text = await res.text()
    if (text.includes("Too many failed logins")) blocked++
  }
  check("lockout survives a rotated x-forwarded-for", blocked > 0, "blocked=" + blocked)
  const staleRow = panel.first(`SELECT value FROM meta WHERE key=?1`, "login_fail:203.0.113.9")
  check("expired login_fail counters are pruned", !staleRow, staleRow ? "still there" : "")

  // --------------------------------------------- 5. action-token policy ----
  const noTrustToken = await mintActionToken({ SYNC_SECRET: SECRET }, steamA)
  check("no token minted without FN_LOCAL_TRUST", noTrustToken === "", JSON.stringify(noTrustToken))
  const trustToken = await mintActionToken({ SYNC_SECRET: SECRET, FN_LOCAL_TRUST: "1" }, steamA)
  check("token minted when FN_LOCAL_TRUST=1", /^[0-9a-f]{64}$/.test(trustToken))
  check("localTrustEnabled is off by default", localTrustEnabled({}) === false && localTrustEnabled({ FN_LOCAL_TRUST: "0" }) === false)

  const claimUrl = panel.base + "/events?steamid=" + encodeURIComponent(steamA) + "&act=claim_event:1"
  const claimRes = await fetch(claimUrl)
  const claimBody = await claimRes.text()
  check("anonymous claim page explains itself", claimBody.includes(NO_MINT), "status " + claimRes.status)
  const queuedUntrusted = panel.first(
    `SELECT COUNT(*) AS n FROM actions WHERE steamid=?1 AND type='claim_event'`, steamA)
  check("anonymous claim queued nothing", Number(queuedUntrusted.n) === 0, "rows=" + queuedUntrusted.n)

  const compRes = await fetch(panel.base + "/competitive?steamid=" + encodeURIComponent(steamA) + "&claim=VICTOR")
  check("anonymous prize claim explains itself", (await compRes.text()).includes(NO_MINT))

  // on a deployment that does mint, the same request does queue
  const trustUrl = trusted.base + "/events?steamid=" + encodeURIComponent(steamA) + "&act=claim_event:1"
  await fetch(trustUrl)
  const queuedTrusted = trusted.first(
    `SELECT COUNT(*) AS n FROM actions WHERE steamid=?1 AND type='claim_event'`, steamA)
  check("trusted deployment queues the claim", Number(queuedTrusted.n) === 1, "rows=" + queuedTrusted.n)

  // ------------------------------------------------ 6. referrer policy ----
  const withToken = await fetch(panel.base + "/events?steamid=" + encodeURIComponent(steamA) + "&t=" + trustToken)
  check("token URL sends no-referrer", withToken.headers.get("referrer-policy") === "no-referrer",
    String(withToken.headers.get("referrer-policy")))
  const withoutToken = await fetch(panel.base + "/events")
  check("plain page sends no referrer policy",
    !withoutToken.headers.get("referrer-policy"), String(withoutToken.headers.get("referrer-policy")))

  // ------------------------------------------------------- 7. unit checks ----
  const batchDb = join(root, "batch.sq3")
  const local = openLocalD1(batchDb)
  local.raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
  let threw = false
  try {
    await local.batch([
      local.prepare("INSERT INTO t (id, v) VALUES (1, 'a')"),
      local.prepare("INSERT INTO t (id, v) VALUES (2, 'b')"),
      local.prepare("INSERT INTO t (id, v) VALUES ('not-an-int', 'c')"),
    ])
  } catch { threw = true }
  const left = local.raw.prepare("SELECT COUNT(*) AS n FROM t").get()
  check("failing batch throws", threw)
  check("failing batch rolls back", Number(left.n) === 0, "rows=" + left.n)
  local.raw.close()

  const positive = Object.values(PREMIUM_COINS).filter(v => v > 0).length
  check("premium table covers most tiers", positive >= 30, positive + "/60 tiers")
  check("premiumExtraCoins(1) is the server value", premiumExtraCoins(1) === 150, String(premiumExtraCoins(1)))
  check("premiumExtraCoins(50) is the server value", premiumExtraCoins(50) === 1950, String(premiumExtraCoins(50)))
  check("premiumExtraCoins(4) is 0 (item tier)", premiumExtraCoins(4) === 0, String(premiumExtraCoins(4)))
  check("premiumExtraCoins out of range is 0", premiumExtraCoins(0) === 0 && premiumExtraCoins(61) === 0)
  check("premiumCoins matches the table", premiumCoins(50) === 1950, String(premiumCoins(50)))
  check("xpPerTier follows the track", xpPerTier({ xp_per_tier: 2500 }) === 2500)
  check("xpPerTier falls back to 1000", xpPerTier(null) === 1000, String(xpPerTier(null)))

  // BP tier curve (bp_track.js is the single source): tier 1 covers [0, need).
  check("bpTierFromXp(0) is tier 1", bpTierFromXp(0, 1000) === 1, String(bpTierFromXp(0, 1000)))
  check("bpTierFromXp(999) is tier 1", bpTierFromXp(999, 1000) === 1, String(bpTierFromXp(999, 1000)))
  check("bpTierFromXp(1000) is tier 2", bpTierFromXp(1000, 1000) === 2, String(bpTierFromXp(1000, 1000)))
  check("bpTierFromXp(1500) is tier 2", bpTierFromXp(1500, 1000) === 2, String(bpTierFromXp(1500, 1000)))
  check("bpTierFromXp(59000) is tier 60", bpTierFromXp(59000, 1000) === 60, String(bpTierFromXp(59000, 1000)))
  check("bpTierFromXp caps at tier 60", bpTierFromXp(999999, 1000) === BP_MAX_TIER, String(bpTierFromXp(999999, 1000)))
  check("bpTierFromXp survives null/undefined", bpTierFromXp(null, 1000) === 1 && bpTierFromXp(undefined, 1000) === 1)
  check("bpTierFromXp follows a non-default curve", bpTierFromXp(2500, 2500) === 2, String(bpTierFromXp(2500, 2500)))
  check("bpInto(1500, 1000) is 500", bpInto(1500, 1000) === 500, String(bpInto(1500, 1000)))
  check("bpInto(0) is 0", bpInto(0, 1000) === 0)
  check("playerBpTier prefers the stored tier", playerBpTier({ bp_xp: 0, bp_tier: 7 }, 1000) === 7)
  check("playerBpTier derives from bp_xp", playerBpTier({ bp_xp: 2000, bp_tier: 0 }, 1000) === 3, String(playerBpTier({ bp_xp: 2000, bp_tier: 0 }, 1000)))
  check("playerBpTier ignores rank xp/level",
    playerBpTier({ xp: 59000, level: 52, bp_xp: 0, bp_tier: 0 }, 1000) === 1,
    String(playerBpTier({ xp: 59000, level: 52, bp_xp: 0, bp_tier: 0 }, 1000)))

  // ============================================ 8. public JSON API =========
  // /api/public/* is unauthenticated and read-only: shape, 404s, and the
  // promise that it leaks no personal state.
  const jget = async (path) => {
    const res = await fetch(panel.base + path)
    let body = null
    try { body = await res.json() } catch {}
    return { res, body, headers: res.headers }
  }

  const st0 = await jget("/api/public/status")
  check("status 200", st0.res.status === 200, "-> " + st0.res.status)
  check("status is no-store", st0.headers.get("cache-control") === "no-store",
    String(st0.headers.get("cache-control")))
  check("status has server/events/updated",
    Boolean(st0.body && st0.body.server && st0.body.events && st0.body.updated))
  check("status keeps player count honest before a live push",
    st0.body.server.players === null || typeof st0.body.server.players === "number",
    "players=" + JSON.stringify(st0.body.server.players))

  // The game's own signed push is the only source of a live count.
  const liveTs = Math.floor(Date.now() / 1000)
  const livePush = await push(panel, {
    server: { map: "de_dust2", hostname: "Harness Server", players: 5, humans: 5, maxplayers: 32, hh: 0 },
    players: [],
  })
  check("server meta push accepted", livePush.status === 200, "-> " + livePush.status)
  const st1 = await jget("/api/public/status")
  check("status reports the pushed player count", st1.body.server.players === 5,
    "players=" + JSON.stringify(st1.body.server.players))
  check("status reports the slot count", st1.body.server.max === 32, "max=" + JSON.stringify(st1.body.server.max))
  check("status reports the pushed map", st1.body.server.map === "de_dust2", String(st1.body.server.map))
  check("status marks a fresh push live", st1.body.server.stale === false && st1.body.server.online === true,
    `stale=${st1.body.server.stale} online=${st1.body.server.online}`)

  // An old push must turn the count back into null, never into a stale number.
  const metaWriter = new DatabaseSync(panel.dbFile)
  try {
    metaWriter.prepare(`UPDATE meta SET value=?2 WHERE key=?1`).run("last_push", String(liveTs - 600))
  } finally { metaWriter.close() }
  const stOld = await jget("/api/public/status")
  check("a stale push reports players as null", stOld.body.server.players === null,
    "players=" + JSON.stringify(stOld.body.server.players))
  check("a stale push is flagged", stOld.body.server.stale === true, String(stOld.body.server.stale))
  await push(panel, { server: { map: "cs_office", hostname: "Harness Server", players: 3, humans: 3, maxplayers: 32 }, players: [] })

  const topAll = await jget("/api/public/top?period=all&limit=2")
  check("top all 200", topAll.res.status === 200, "-> " + topAll.res.status)
  check("top all honours limit", Array.isArray(topAll.body.rows) && topAll.body.rows.length === 2,
    "rows=" + (topAll.body.rows || []).length)
  check("top all is ordered by xp", topAll.body.rows[0].value >= topAll.body.rows[1].value,
    `${topAll.body.rows[0].value} >= ${topAll.body.rows[1].value}`)
  check("top rows carry name/value/metric/period",
    ["name", "value", "metric", "period"].every(k => k in topAll.body.rows[0]),
    Object.keys(topAll.body.rows[0]).join(","))

  const badPeriod = await jget("/api/public/top?period=decade")
  check("top rejects an unknown period with 400", badPeriod.res.status === 400, "-> " + badPeriod.res.status)
  check("top 400 explains the allowed periods",
    badPeriod.body && badPeriod.body.error === "bad_period" && Array.isArray(badPeriod.body.allowed),
    JSON.stringify(badPeriod.body && badPeriod.body.error))

  const killBoard = await jget("/api/public/top?period=all&metric=kills&limit=3")
  check("top supports metric=kills", killBoard.res.status === 200 && killBoard.body.metric === "kills" &&
    (killBoard.body.rows.length === 0 || killBoard.body.rows.every(r => r.metric === "kills")),
    `${killBoard.res.status} ${killBoard.body && killBoard.body.metric}`)

  const weekNow = Math.floor(Date.now() / 1000)
  const topWeek = await jget("/api/public/top?period=week&limit=5")
  check("top week 200", topWeek.res.status === 200, "-> " + topWeek.res.status)
  check("top week uses the Europe/Paris ISO week", topWeek.body.window.key === weekKeyAt(weekNow),
    `${topWeek.body.window.key} vs ${weekKeyAt(weekNow)}`)
  check("top week publishes its window bounds",
    topWeek.body.window.tz === "Europe/Paris" &&
    topWeek.body.window.start === periodBounds("week", weekNow).start &&
    topWeek.body.window.end === periodBounds("week", weekNow).end,
    JSON.stringify(topWeek.body.window))
  check("top week publishes coverage instead of pretending completeness",
    topWeek.body.coverage && typeof topWeek.body.coverage.complete === "boolean",
    JSON.stringify(topWeek.body.coverage))
  const topMonth = await jget("/api/public/top?period=month&limit=5")
  check("top month uses the calendar month", topMonth.body.window.key === monthKeyAt(weekNow),
    `${topMonth.body.window.key} vs ${monthKeyAt(weekNow)}`)

  // The website board and the API board must show the same window and the same
  // numbers: one boundary implementation, no second opinion.
  const siteWeek = await fetch(panel.base + "/top/week")
  const siteWeekBody = await siteWeek.text()
  check("the site has a weekly board", siteWeek.status === 200, "-> " + siteWeek.status)
  check("the site's weekly board names the same period key the API returns",
    siteWeekBody.includes(weekKeyAt(weekNow)), weekKeyAt(weekNow))
  const siteMonth = await fetch(panel.base + "/top/month")
  check("the site has a monthly board", siteMonth.status === 200, "-> " + siteMonth.status)
  const apiWeekRows = (await jget("/api/public/top?period=week&limit=15")).body.rows
  check("the site board and the API board agree row for row",
    apiWeekRows.every(r => siteWeekBody.includes(r.name || r.steamid)),
    apiWeekRows.map(r => r.name).join(","))

  const meApi = await jget("/api/public/player/0-0-101")
  check("player 200 for the packed form", meApi.res.status === 200, "-> " + meApi.res.status)
  check("player answers the canonical steamid", meApi.body.steamid === "STEAM_0:0:101", String(meApi.body.steamid))
  check("player carries the documented fields",
    ["name", "rank", "bp_tier", "bp_xp", "bp_next_xp", "coins", "playtime_minutes", "badges"].every(k => k in meApi.body),
    Object.keys(meApi.body).join(","))
  check("player leaks no personal state",
    !("last_seen" in meApi.body) && !("cc" in meApi.body) && !("server_id" in meApi.body) &&
    !JSON.stringify(meApi.body).includes("192.0.2."),
    Object.keys(meApi.body).join(","))
  const colonPlayer = await jget("/api/public/player/" + encodeURIComponent("STEAM_0:0:101"))
  check("player accepts the colon form", colonPlayer.res.status === 200 && colonPlayer.body.steamid === "STEAM_0:0:101",
    "-> " + colonPlayer.res.status)

  const missing = await jget("/api/public/player/0-0-9999999")
  check("unknown player 404", missing.res.status === 404, "-> " + missing.res.status)
  check("unknown player 404 shape", missing.body.error === "player_not_found" && missing.body.steamid === "STEAM_0:0:9999999",
    JSON.stringify(missing.body))
  const badSid = await jget("/api/public/player/not-a-steamid")
  check("malformed steamid 400", badSid.res.status === 400 && badSid.body.error === "bad_steamid",
    "-> " + badSid.res.status)
  check("normalizeSteamid round-trips both forms",
    normalizeSteamid("0-0-101") === "STEAM_0:0:101" &&
    normalizeSteamid("STEAM_0:0:101") === "STEAM_0:0:101" &&
    normalizeSteamid("nope") === "")

  // Events: the panel schedule. The detail column is added lazily on first
  // read, so an older replica gains it without a manual migration.
  const evEmpty = await jget("/api/public/events")
  check("events 200", evEmpty.res.status === 200, "-> " + evEmpty.res.status)
  check("events declares the panel as its source", evEmpty.body.source === "panel", String(evEmpty.body.source))
  const evWriter = new DatabaseSync(panel.dbFile)
  let evId = 0
  try {
    const info = evWriter.prepare(
      `INSERT INTO events (title, type, status, start_at, end_at, xp_mult, coins_mult)
       VALUES (?1,'xp_mult','active',?2,?3,2,1)`
    ).run("Harness Double XP", liveTs - 600, liveTs + 3600)
    evId = Number(info.lastInsertRowid)
  } finally { evWriter.close() }
  const evOne = await jget("/api/public/events")
  const rowEv = (evOne.body.events || []).find(e => e.title === "Harness Double XP")
  check("events lists an active event", Boolean(rowEv) && rowEv.state === "active",
    JSON.stringify(rowEv))
  check("events exposes title/starts_at/ends_at/detail/state",
    rowEv && ["title", "starts_at", "ends_at", "detail", "state"].every(k => k in rowEv),
    rowEv ? Object.keys(rowEv).join(",") : "missing")
  check("a live event appears in status.events.now",
    (await jget("/api/public/status")).body.events.now.some(e => e.title === "Harness Double XP"))
  const detailWriter = new DatabaseSync(panel.dbFile)
  let hasDetailCol = false
  try {
    hasDetailCol = detailWriter.prepare(`PRAGMA table_info(events)`).all().some(c => c.name === "detail")
    detailWriter.prepare(`UPDATE events SET detail=?2 WHERE id=?1`).run(evId, "2x XP on every kill.")
  } finally { detailWriter.close() }
  check("events.detail is added lazily to an older replica", hasDetailCol)

  const evList = await jget("/api/public/events")
  check("events 404s an unknown sub-path", (await jget("/api/public/nope")).res.status === 404)
  check("no public response leaks a secret", !JSON.stringify([st1.body, topAll.body, meApi.body, evList.body]).includes(SECRET))

  const counted = await fetch(limited.base + "/api/public/status")
  await fetch(limited.base + "/api/public/status")
  const overLimit = await fetch(limited.base + "/api/public/status")
  check("public API rate-limits a poll loop", counted.status === 200 && overLimit.status === 429,
    `${counted.status} then ${overLimit.status}`)
  const limitBody = await overLimit.json().catch(() => ({}))
  check("rate-limit answer is JSON", limitBody.error === "rate_limited", JSON.stringify(limitBody.error))

  // ================================================ 9. MOTD v2 pages =======
  const motdPages = [
    "/m/p/0-0-101.htm",
    "/m/i/0-0-101/daily.htm",
    "/m/i/0-0-101/weekly.htm",
    "/m/i/0-0-101/completed.htm",
    "/m/b/0-0-101/battlepass.htm",
    "/m/t/0-0-101/top15.htm",
    "/m/t/0-0-101/week.htm",
    "/m/t/0-0-101/month.htm",
    "/m/e/0-0-101/events.htm",
    "/m/p/0-0-9999999.htm",       // player the panel has never seen
    "/m/p/0-0-101",               // .htm optional
  ]
  const FORBIDDEN = ["<script", "<img", "<link", "<iframe", "display:flex", "display: flex",
    "display:grid", "display: grid", "var(", "NaN", "undefined", "&amp;middot;"]
  for (const p of motdPages) {
    const res = await fetch(panel.base + p)
    const body = await res.text()
    const badWords = FORBIDDEN.filter(w => body.includes(w))
    check(`motd ${p} renders`, res.status === 200, "-> " + res.status)
    check(`motd ${p} is a self-contained MSIE-safe document`, badWords.length === 0, badWords.join(","))
    check(`motd ${p} carries noindex + no-referrer`,
      res.headers.get("x-robots-tag") === "noindex" && res.headers.get("referrer-policy") === "no-referrer",
      `${res.headers.get("x-robots-tag")} / ${res.headers.get("referrer-policy")}`)
    check(`motd ${p} tells the player what to type`, body.includes("!missions"))
  }
  const profPage = await (await fetch(panel.base + "/m/p/0-0-101.htm")).text()
  check("motd header shows the player name", profPage.includes("harness-101"))
  check("motd header shows the BP tier and the coin balance",
    profPage.includes("TIER 1/60") && profPage.includes("coins"), "tier/coins strip present")

  // A player row with every counter at zero (the most common first impression).
  const steamFresh = "STEAM_0:0:909"
  await push(panel, { players: [player(steamFresh, { xp: 0, bp_xp: 0, bp_tier: 0, coins: 0, last_seen: Math.floor(Date.now() / 1000) })] })
  const freshPage = await (await fetch(panel.base + "/m/p/0-0-909.htm")).text()
  check("a zero-data player renders tier 1", freshPage.includes("TIER 1/60"))
  check("a zero-data player is unranked, not rank 0", freshPage.includes("Unranked"))
  check("a zero-data player page is free of NaN/undefined",
    !freshPage.includes("NaN") && !freshPage.includes("undefined"))
  const freshJson = await (await fetch(panel.base + "/api/public/player/0-0-909")).json()
  check("a zero-data player has rank null in the API", freshJson.rank === null, String(freshJson.rank))
  check("a zero-data player has tier 1 and 0 XP in the API",
    freshJson.bp_tier === 1 && freshJson.bp_xp === 0, `${freshJson.bp_tier} / ${freshJson.bp_xp}`)
  check("a zero-data player asks the next tier for a full bar",
    freshJson.bp_next_xp === freshJson.bp_tier_xp, `${freshJson.bp_next_xp} / ${freshJson.bp_tier_xp}`)

  // Badges reach the MOTD header and /api/public/player.
  const badgeWriter = new DatabaseSync(panel.dbFile)
  try {
    badgeWriter.prepare(
      `INSERT OR IGNORE INTO badges (steamid, kind, period, label, awarded_at) VALUES (?1,?2,?3,?4,?5)`
    ).run(steamA, "weekly_champion", "2026-W45", "Weekly #1 · Week 45 · 2026", liveTs)
  } finally { badgeWriter.close() }
  const badgedPage = await (await fetch(panel.base + "/m/p/0-0-101.htm")).text()
  check("a badge is drawn as text in the MOTD header", badgedPage.includes("Weekly #1"))
  const badgedApi = await (await fetch(panel.base + "/api/public/player/0-0-101")).json()
  check("a badge is exposed by /api/public/player",
    Array.isArray(badgedApi.badges) && badgedApi.badges.some(b => b.kind === "weekly_champion" && b.label.includes("Weekly #1")),
    JSON.stringify(badgedApi.badges))
  check("badges are text only (no client content)",
    badgedApi.badges.every(b => !/[<>]/.test(b.label) && Object.keys(b).sort().join(",") === "kind,label,period"),
    JSON.stringify(badgedApi.badges[0]))

  // Existing MOTD contract: the documented redirects and 404s still hold.
  const redirMissions = await fetch(panel.base + "/m/b/0-0-101/missions.htm", { redirect: "manual" })
  check("/m/b/*/missions still 302s to /m/i/", redirMissions.status === 302 &&
    redirMissions.headers.get("location") === "/m/i/0-0-101/daily.htm",
    `${redirMissions.status} ${redirMissions.headers.get("location")}`)
  const goneS = await fetch(panel.base + "/m/s/0-0-1/x.htm", { redirect: "manual" })
  check("/m/s/ is still 404", goneS.status === 404, "-> " + goneS.status)

  // The degradation path: no DB, no theme, no snapshot — still a useful page.
  const fb = renderFallback("test: database unavailable", { FN_PUBLIC_ADDR: "example.invalid:27015" })
  const fbBody = await fb.text()
  check("the static fallback is HTTP 200", fb.status === 200, "-> " + fb.status)
  check("the static fallback names the server", fbBody.includes("example.invalid:27015"))
  check("the static fallback tells the player what to type", fbBody.includes("!missions") && fbBody.includes("!bp"))
  check("the static fallback is self-contained",
    !/<script|<img|<link|<iframe/i.test(fbBody) && !fbBody.includes("var(") && !fbBody.includes("display:flex"),
    "no external resource")

  // ================================= 10. Europe/Paris period arithmetic ===
  const at = s => Math.floor(Date.parse(s) / 1000)
  const iso = s => new Date(s * 1000).toISOString()
  const w47 = periodBounds("week", at("2026-11-22T21:00:00Z"))
  check("week boundary is Monday 00:00 Europe/Paris", w47.key === "2026-W47" &&
    iso(w47.start) === "2026-11-15T23:00:00.000Z" && iso(w47.end) === "2026-11-22T23:00:00.000Z",
    `${w47.key} ${iso(w47.start)}..${iso(w47.end)}`)
  check("a Sunday 23:30 Paris instant is still the previous ISO week",
    weekKeyAt(at("2026-11-22T23:30:00Z")) === "2026-W48",
    weekKeyAt(at("2026-11-22T23:30:00Z")))
  check("DST start does not shift the week boundary",
    iso(periodBounds("week", at("2026-03-30T12:00:00Z")).start) === "2026-03-29T22:00:00.000Z",
    iso(periodBounds("week", at("2026-03-30T12:00:00Z")).start))
  check("DST end does not shift the week boundary",
    iso(periodBounds("week", at("2026-10-28T12:00:00Z")).start) === "2026-10-25T23:00:00.000Z",
    iso(periodBounds("week", at("2026-10-28T12:00:00Z")).start))
  check("ISO week-year edge (2026-12-31 is 2026-W53)",
    weekKeyAt(at("2026-12-31T23:30:00Z")) === "2026-W53" && weekKeyAt(at("2027-01-01T10:00:00Z")) === "2026-W53",
    `${weekKeyAt(at("2026-12-31T23:30:00Z"))} / ${weekKeyAt(at("2027-01-01T10:00:00Z"))}`)
  const nov = periodBounds("month", at("2026-11-30T23:30:00Z"))
  check("the month boundary is the 1st 00:00 Europe/Paris", nov.key === "2026-12" &&
    iso(nov.start) === "2026-11-30T23:00:00.000Z", `${nov.key} ${iso(nov.start)}`)
  check("a Paris November instant stays in November",
    monthKeyAt(at("2026-11-30T22:59:00Z")) === "2026-11" &&
    iso(periodBounds("month", at("2026-11-30T22:59:00Z")).end) === "2026-11-30T23:00:00.000Z",
    monthKeyAt(at("2026-11-30T22:59:00Z")))
  check("parisMidnight is DST-aware",
    iso(parisMidnight(2026, 3, 30)) === "2026-03-29T22:00:00.000Z" &&
    iso(parisMidnight(2026, 10, 26)) === "2026-10-25T23:00:00.000Z",
    `${iso(parisMidnight(2026, 3, 30))} / ${iso(parisMidnight(2026, 10, 26))}`)
  check("isoWeekOf follows the Thursday rule", isoWeekOf(2026, 1, 1).week === 1 && isoWeekOf(2025, 12, 29).year === 2026,
    JSON.stringify(isoWeekOf(2025, 12, 29)))
  check("previousKey walks back one period",
    previousKey("week", at("2026-11-22T21:00:00Z")) === "2026-W46" &&
    previousKey("month", at("2026-11-22T21:00:00Z")) === "2026-10",
    `${previousKey("week", at("2026-11-22T21:00:00Z"))} / ${previousKey("month", at("2026-11-22T21:00:00Z"))}`)
  check("keysBefore skips nothing across a year boundary",
    keysBefore("week", "2026-W01", at("2026-01-10T12:00:00Z"), 2).join(",") === "2025-W52,2025-W51",
    keysBefore("week", "2026-W01", at("2026-01-10T12:00:00Z"), 2).join(","))

  // ==================================== 11. boards, rollover, badges ======
  // A disposable database, so the rollover can be driven straight past a
  // boundary without waiting for a real Monday.
  const boardDb = join(root, "boards.sq3")
  const bd = openLocalD1(boardDb)
  // Minimal players table: the boards read steamid/name/xp(/kills) only.
  bd.raw.exec(`CREATE TABLE IF NOT EXISTS players (
    steamid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', xp INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0)`)
  bd.raw.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`)
  const bEnv = { DB: bd }
  check("board tables are created on demand", await ensureBoardTables(bEnv) === true)
  const bNow = Math.floor(Date.now() / 1000)
  const bPrev = previousKey("week", bNow)
  const insPlayer = (sid, name, xp) => bd.raw.prepare(
    `INSERT INTO players (steamid, name, xp, coins, last_seen) VALUES (?,?,?,0,?)`
  ).run(sid, name, xp, bNow)
  insPlayer("STEAM_0:0:501", "alpha", 1000)
  insPlayer("STEAM_0:0:502", "bravo", 2000)
  insPlayer("STEAM_0:0:503", "charlie", 0)

  await refreshMarks(bEnv, bNow, { force: true })
  const baseRow = bd.raw.prepare(
    `SELECT base, last_value FROM board_marks WHERE period='week' AND metric='xp' AND steamid='STEAM_0:0:501'`
  ).get()
  check("the first read inside a period records the baseline", Number(baseRow.base) === 1000, JSON.stringify(baseRow))

  bd.raw.prepare(`UPDATE players SET xp=1400 WHERE steamid='STEAM_0:0:501'`).run()
  bd.raw.prepare(`UPDATE players SET xp=2100 WHERE steamid='STEAM_0:0:502'`).run()
  await refreshMarks(bEnv, bNow, { force: true })
  const wBoard = await periodBoard(bEnv, { period: "week", limit: 10, now: bNow })
  check("the weekly board shows the period delta, not lifetime xp",
    wBoard.rows[0].value === 400 && wBoard.rows[1].value === 100,
    JSON.stringify(wBoard.rows.map(r => [r.name, r.value])))
  check("a player with no progress this period is not listed",
    !wBoard.rows.some(r => r.steamid === "STEAM_0:0:503"), JSON.stringify(wBoard.rows.map(r => r.steamid)))
  check("the weekly board ranks by value", wBoard.rows[0].rank === 1 && wBoard.rows[0].name === "alpha",
    JSON.stringify(wBoard.rows[0]))
  check("the board reports its coverage honestly", wBoard.coverage.complete === false &&
    wBoard.coverage.observed_players === 3, JSON.stringify(wBoard.coverage))

  const stand = await playerPeriodStanding(bEnv, "STEAM_0:0:502", { period: "week", now: bNow })
  check("own weekly standing counts the gap to the player above",
    stand.rank === 2 && stand.behind === 300 && stand.ahead.name === "alpha", JSON.stringify(stand))
  const lifeStand = await playerLifetimeStanding(bEnv, { xp: 2100 })
  check("own lifetime standing is exact", lifeStand.rank === 1 && lifeStand.ahead === null, JSON.stringify(lifeStand))
  const zeroStand = await playerLifetimeStanding(bEnv, { xp: 0 })
  check("a player with 0 xp has no rank", zeroStand.rank === null, JSON.stringify(zeroStand))

  // Settle last week: a baseline recorded then, snapshotted after the boundary.
  const insMark = (sid, key, base, last, first) => bd.raw.prepare(
    `INSERT OR REPLACE INTO board_marks (period, period_key, steamid, metric, base, last_value, first_seen, seen_at)
     VALUES ('week', ?, ?, 'xp', ?, ?, ?, ?)`
  ).run(key, sid, base, last, first, first)
  const weekStart = periodBounds("week", bNow).start - 1
  insMark("STEAM_0:0:501", bPrev, 0, 5000, weekStart - 7 * 86400)
  insMark("STEAM_0:0:502", bPrev, 0, 3000, weekStart - 7 * 86400)
  insMark("STEAM_0:0:503", bPrev, 0, 1000, weekStart - 7 * 86400)

  const roll1 = await maybeRollover(bEnv, bNow)
  check("the first rollover only records where we are", roll1.settled.length === 0 &&
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM board_history`).get().n === 0, JSON.stringify(roll1))

  bd.raw.prepare(`UPDATE meta SET value=?1 WHERE key='board_settled:week'`).run(bPrev)
  const roll2 = await maybeRollover(bEnv, bNow)
  const hist = bd.raw.prepare(`SELECT rank, steamid, name, value FROM board_history WHERE period='week' ORDER BY rank`).all()
  check("a finished week is snapshotted into board_history", hist.length === 3, JSON.stringify(hist))
  check("the snapshot keeps the winner in order", hist[0].steamid === "STEAM_0:0:501" && hist[0].value === 5000,
    JSON.stringify(hist[0]))
  check("rollover awards the weekly champion badge",
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM badges WHERE kind='weekly_champion' AND period=?1`).get(bPrev).n === 1,
    bPrev)
  check("rollover awards top-3 badges for the podium",
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM badges WHERE kind='weekly_top3' AND period=?1`).get(bPrev).n === 3)
  const roll3 = await maybeRollover(bEnv, bNow)
  check("a second rollover is a no-op (idempotent)", roll3.settled.length === 0 &&
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM board_history`).get().n === 3, JSON.stringify(roll3))

  // Three weeks running for the same name.
  const wk2 = previousKey("week", weekStart - 1)
  const wk3 = previousKey("week", weekStart - 8 * 86400)
  for (const k of [wk2, wk3]) insMark("STEAM_0:0:501", k, 0, 1000, weekStart - 21 * 86400)
  for (const k of [wk2, wk3]) insMark("STEAM_0:0:502", k, 0, 500, weekStart - 21 * 86400)
  await settlePeriod(bEnv, "week", wk3, bNow)
  await settlePeriod(bEnv, "week", wk2, bNow)
  await settlePeriod(bEnv, "week", bPrev, bNow)
  check("top 3 three weeks running is awarded once per player",
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM badges WHERE kind='weekly_streak3'`).get().n === 2 &&
    bd.raw.prepare(`SELECT COUNT(*) AS n FROM badges WHERE kind='weekly_streak3' AND steamid='STEAM_0:0:501'`).get().n === 1,
    JSON.stringify(bd.raw.prepare(`SELECT steamid, period FROM badges WHERE kind='weekly_streak3'`).all()))
  check("badges are readable per player",
    (await playerBadges(bEnv, "STEAM_0:0:501")).some(b => b.kind === "weekly_champion"))
  check("a player with no badges gets an empty list",
    (await playerBadges(bEnv, "STEAM_0:0:999")).length === 0)
  check("the lifetime board reads the players table",
    (await lifetimeBoard(bEnv, { limit: 5 })).rows[0].steamid === "STEAM_0:0:502",
    JSON.stringify((await lifetimeBoard(bEnv, { limit: 5 })).rows.map(r => [r.name, r.value])))
  check("countdown text is server-side plain text",
    countdownText({ state: "active", starts_at: 0, ends_at: bNow + 7200 }, bNow) === "ends in 2h",
    countdownText({ state: "active", starts_at: 0, ends_at: bNow + 7200 }, bNow))
  bd.raw.close()

  // ============================================ 9. Winterfest panel =========
  // The panel surface built for docs/WINTERFEST.md Phase 1: the winter_* mirror,
  // its ingestion seam (applyWinterPayload), the six /winter pages, the tree move
  // action, and the seasonal skin. Everything below runs against its own panel so
  // the checks above keep the database they expect.
  {
    const nowW = Math.floor(Date.now() / 1000)
    const dayNow = parisParts(nowW).d
    const monthNow = parisParts(nowW).m

    // ---- 9a. the window is arithmetic, not a hardcoded date --------------
    const dec1 = parisMidnight(2026, 12, 1)
    const dec24 = parisMidnight(2026, 12, 24) + 86399
    const nov30 = parisMidnight(2026, 11, 30) + 3600

    const before = resolveSeason({}, nov30)
    check("season: November is not open", before.active === false && before.phase === "before", before.phase)
    check("season: the default window opens 1 December Europe/Paris",
      before.startKey === "2026-12-01" && before.opensAt === dec1,
      `${before.startKey} ${before.opensAt}`)
    const opening = resolveSeason({}, dec1 + 60)
    check("season: open one minute into 1 December", opening.active === true && opening.dayOfMonth === 1,
      `${opening.phase} day=${opening.dayOfMonth}`)
    check("season: 24 December 23:59 is still open",
      resolveSeason({}, dec24).active === true && resolveSeason({}, dec24).daysLeft === 1,
      String(resolveSeason({}, dec24).daysLeft))
    const after = resolveSeason({}, parisMidnight(2026, 12, 25))
    check("season: closed from 25 December 00:00", after.active === false && after.phase === "closed",
      after.phase)
    check("season: closesAt prints as 24 December 23:59",
      parisParts(resolveSeason({}, dec1).closesAt).d === 24 && parisParts(resolveSeason({}, dec1).closesAt).hh === 23,
      parisStamp(resolveSeason({}, dec1).closesAt))
    const disabled = resolveSeason({ enabled: 0, start: "2026-12-01", end: "2026-12-24" }, dec1 + 60)
    check("season: enabled=0 is dormant even inside its dates",
      disabled.active === false && disabled.phase === "disabled", disabled.phase)
    const custom = resolveSeason({ start: "2027-12-05", end: "2027-12-28" }, parisMidnight(2027, 12, 6))
    check("season: dates come from config, not from the code",
      custom.active === true && custom.startKey === "2027-12-05" && custom.endKey === "2027-12-28",
      `${custom.startKey}..${custom.endKey}`)
    check("season: parses the game's digit-only date keys",
      resolveSeason({ start: 20261201, end: 20261224 }, dec1 + 60).active === true)

    // ---- 9b. catalogue + progress are pure and honest --------------------
    const CAT = winterCatalogue()
    const cat = normalizeWinterCatalog(CAT)
    check("catalogue: parses every ornament", cat.ornaments.length === 10, String(cat.ornaments.length))
    check("catalogue: turns the ini's R G B into a CSS colour", rarityColor(cat, 2) === "#ffd75a", rarityColor(cat, 2))
    check("catalogue: maps the reward names winterfest.inc uses",
      rewardType("snowflakes") === 1 && rewardType("ornament") === 2 && rewardType("pass_xp") === 4 && rewardType("nonsense") === 0)
    check("catalogue: labels a reward without inventing one",
      rewardLabel(cat, "ornament", 3) === "Ornament: Silver Snowflake" &&
      rewardLabel(cat, "snow", 0, 25) === "25 snowflakes" &&
      rewardLabel(cat, "pass", 0, 50) === "Winter Pass XP +50",
      rewardLabel(cat, 2, 3))
    check("catalogue: a missing catalogue degrades instead of throwing",
      normalizeWinterCatalog(null).ok === false && normalizeWinterCatalog(null).styles.length === 3)
    check("catalogue: three tree styles, 24 slots each",
      cat.styles.length === 3 && cat.styles.every(s => s.slots.length === 24),
      JSON.stringify(cat.styles.map(s => s.slots.length)))
    const tall = cat.styles.find(s => s.style === 2)
    const wide = cat.styles.find(s => s.style === 3)
    check("catalogue: the three layouts are genuinely different",
      JSON.stringify(tall.slots) !== JSON.stringify(wide.slots) &&
      JSON.stringify(cat.styles[0].slots) !== JSON.stringify(tall.slots))

    const advNow = {
      days: [], claimedAt: null, found: true,
      advent: new Map([[1, dec1 + 3600], [2, dec1 + 7200]]),
      slots: new Map(), owned: [], ownedIds: new Set(), gifts: [], giftCounts: new Map(),
      pass: { xp: 0, tier: 0, found: false }, treeLevel: 0
    }
    const advMid = adventStatus(resolveSeason({}, parisMidnight(2026, 12, 5) + 3600), advNow)
    const byDay = d => advMid.days.find(x => x.day === d)
    check("advent: a claimed day stays claimed", byDay(1).status === "claimed", byDay(1).status)
    check("advent: today is today", byDay(5).status === "today", byDay(5).status)
    check("advent: an earlier unclaimed day is catch-up, not lost", byDay(3).status === "missed", byDay(3).status)
    check("advent: a later day is locked", byDay(6).status === "locked", byDay(6).status)
    check("advent: a claim on the day is full value",
      advMid.days.find(x => x.day === 1).full === true)
    check("advent: 24 days, never 31", advMid.days.length === 24 && advMid.total === 24)
    check("advent: claimable-now counts today plus the missed days", advMid.claimableNow === 3, String(advMid.claimableNow))

    const passState = { pass: { xp: 1050, tier: 3, found: true } }
    const ps = passStatus(cat, passState)
    check("pass: tier and XP come from the game", ps.tier === 3 && ps.xp === 1050)
    check("pass: XP into the tier is measured from the catalogue's floor",
      ps.into === 150 && ps.span === 300 && ps.pct === 50, `${ps.into}/${ps.span}`)
    check("pass: the next three rewards are the next three, in order",
      ps.upcoming.length === 3 && ps.upcoming[0].tier === 4 && ps.upcoming[2].tier === 6,
      JSON.stringify(ps.upcoming.map(u => u.tier)))
    check("pass: the ladder is 30 rungs and free-track only",
      ps.ladder.length === 30 && ps.ladder.every(r => !("premium" in r)), String(ps.ladder.length))
    check("pass: tier 30 is the top", passStatus(cat, { pass: { xp: 99999, tier: 30 } }).atMax === true)

    const treeState = {
      slots: new Map([[1, 1], [2, 2]]), ownedIds: new Set([1, 2, 3, 4, 5]), treeLevel: 2
    }
    const tst = treeStatus(cat, treeState)
    check("tree: filled count and percentage", tst.filled === 2 && tst.pct === 8, `${tst.filled}/${tst.pct}%`)
    check("tree: the next milestone is the closest incomplete set",
      tst.nextSet && tst.nextSet.id === 2 && tst.nextSet.owned === 0,
      JSON.stringify(tst.nextSet && tst.nextSet.id))
    check("tree: a completed set is reported complete", tst.sets.find(s => s.id === 1).complete === true)

    // ---- 9c. the store: idempotent ingestion against a real database -----
    const wDb = openLocalD1(join(root, "winter-store.sq3"))
    const wEnv = { DB: wDb }
    await ensureWinterTables(wEnv)
    await ensureWinterTables(wEnv) // twice on purpose: every statement is IF NOT EXISTS
    const tables = wDb.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'winter%' ORDER BY name").all().map(r => r.name)
    check("store: the winter_* family exists",
      ["winter_advent", "winter_gifts", "winter_meta", "winter_ornaments", "winter_pass", "winter_players", "winter_tree"]
        .every(t => tables.includes(t)), JSON.stringify(tables))

    const owner = "STEAM_0:0:900001"
    const stranger = "STEAM_0:0:900002"
    const pushed = await applyWinterPayload(wEnv, {
      winter: {
        season: { name: "Winterfest", year: 2026, start: "2026-12-01", end: "2026-12-24", enabled: 1 },
        community: { key: "gifts", label: "Presents opened", current: 4321, target: 10000 },
        players: [{
          steamid: owner, at: nowW, snowflakes: 145, gifts_found: 12,
          tree_style: 2, tree_level: 3,
          tree: [{ slot: 3, ornament: 2 }, { slot: 9, ornament: 1 }],
          ornaments: [1, 2, 3, 4, 5],
          advent: [{ day: 1, at: parisMidnight(2026, 12, 1) + 3600 }],
          gifts: [
            { instance: 1, rarity: 1, type: "ornament", id: 2, at: nowW - 300, key: "g:1" },
            { instance: 2, rarity: 2, type: "snow", id: 0, amount: 25, at: nowW - 200, key: "g:2" },
            { instance: 3, rarity: 0, type: "snow", id: 0, amount: 10, at: nowW - 100, key: "g:3" }
          ],
          pass: { xp: 250, tier: 3 }
        }]
      }
    }, nowW)
    check("store: one pushed player is stored once", pushed.players === 1 && pushed.errors.length === 0,
      JSON.stringify(pushed.errors))
    check("store: tree slots land in their own table", pushed.treeSlots === 2 && wDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM winter_tree WHERE steamid=?1").get(owner).n === 2)
    check("store: the push replaced the whole tree",
      wDb.raw.prepare("SELECT ornament FROM winter_tree WHERE steamid=?1 AND slot=3").get(owner).ornament === 2)
    check("store: ornaments are cached", wDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM winter_ornaments WHERE steamid=?1").get(owner).n === 5,
      String(wDb.raw.prepare("SELECT COUNT(*) AS n FROM winter_ornaments WHERE steamid=?1").get(owner).n))
    check("store: the gift log keeps the claim key", wDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM winter_gifts WHERE steamid=?1").get(owner).n === 3)
    check("store: pass XP is stored", wDb.raw.prepare(
      "SELECT xp, tier FROM winter_pass WHERE steamid=?1").get(owner).xp === 250)

    // Duplicate advent claim: the ledger's primary key is the guard.
    const advAgain = await applyWinterPayload(wEnv, {
      winter: { players: [{ steamid: owner, at: nowW + 1, advent: [{ day: 1, at: nowW }] }] }
    }, nowW + 1)
    check("store: a duplicate Advent claim inserts nothing",
      advAgain.advent === 0 && advAgain.adventDuplicates === 1, JSON.stringify(advAgain.adventDuplicates))
    check("store: the claim ledger holds exactly one row for day 1",
      wDb.raw.prepare("SELECT COUNT(*) AS n FROM winter_advent WHERE steamid=?1 AND day=1").get(owner).n === 1)
    const claimAt = wDb.raw.prepare("SELECT claimed_at FROM winter_advent WHERE steamid=?1 AND day=1").get(owner).claimed_at
    check("store: the duplicate did not rewrite the claim timestamp",
      claimAt === parisMidnight(2026, 12, 1) + 3600, String(claimAt))

    // A replayed gift push is a no-op too.
    const giftAgain = await applyWinterPayload(wEnv, {
      winter: { players: [{ steamid: owner, at: nowW + 2, gifts: [{ instance: 1, rarity: 1, type: "ornament", id: 2, at: nowW - 300, key: "g:1" }] }] }
    }, nowW + 2)
    check("store: a replayed gift opening is refused", giftAgain.gifts === 0 && giftAgain.giftsDuplicates === 1)

    // Stale push: an older snapshot must not roll the pass back (sync.js rule).
    const stalePush = await applyWinterPayload(wEnv, {
      winter: { players: [{ steamid: owner, at: nowW - 600, snowflakes: 1, pass: { xp: 10, tier: 1 } }] }
    }, nowW - 600)
    check("store: a stale snapshot is skipped", stalePush.stale === 1 && stalePush.players === 0,
      JSON.stringify({ stale: stalePush.stale, players: stalePush.players }))
    const still = wDb.raw.prepare("SELECT xp, tier FROM winter_pass WHERE steamid=?1").get(owner)
    check("store: a stale snapshot cannot lower pass XP", still.xp === 250 && still.tier === 3,
      JSON.stringify(still))

    // A tree with the same ornament twice is refused by the mirror's index.
    let dupeTree = false
    try {
      await applyWinterPayload(wEnv, {
        winter: { players: [{ steamid: owner, at: nowW + 3, tree: [{ slot: 4, ornament: 1 }, { slot: 5, ornament: 1 }] }] }
      }, nowW + 3)
      const rows = wDb.raw.prepare("SELECT COUNT(*) AS n FROM winter_tree WHERE steamid=?1").get(owner).n
      dupeTree = rows <= 2
    } catch { dupeTree = true }
    check("store: a push cannot put one ornament in two slots (deduped or refused)", dupeTree === true)

    // An unseen player reads as an honest zero state.
    const unseenState = await loadState(wEnv, "STEAM_0:0:900099", "2026")
    check("store: an unseen player is not fabricated",
      unseenState.found === false && unseenState.snowflakes === 0 && unseenState.slots.size === 0 &&
      unseenState.owned.length === 0 && unseenState.advent.size === 0 && unseenState.pass.tier === 0)
    check("store: a bad steamid reads as empty instead of throwing",
      (await loadState(wEnv, "not-a-steamid", "2026")).found === false)

    // docs/WINTERFEST-DEV.md §9: the core agent documented a RENDERED per-player
    // blob. It is translated into the same rows, so the panel works whichever
    // shape ships first — without a second source of truth.
    const devPush = await applyWinterPayload(wEnv, {
      players: [{
        steamid: stranger,
        winterfest: {
          season: { name: "Winterfest", year: 2026, start: "2026-12-01", end: "2026-12-24", enabled: 1 },
          wallet: { snowflakes: 77 },
          presents: [
            { instance: 5, rarity: 2, rarity_name: "Rare", opened: true },
            { instance: 6, rarity: 0, rarity_name: "Common", opened: false }
          ],
          ornaments: [
            { id: 1, name: "Crystal Snowflake", rarity: 0, set: 1, owned: true, hidden: false },
            { id: 4, name: "Frozen Star", rarity: 1, set: 1, owned: false, hidden: true }
          ],
          sets: [{ id: 1, name: "Snowflakes", title: "Ice Warrior", owned: 1, total: 2, complete: false }],
          tree: { style: 3, level: 1, filled: 1, slots: [{ slot: 7, ornament_id: 1, x: 10, y: 20 }] },
          advent: [{ day: 1, reward_text: "40 snowflakes", claimed: true }, { day: 2, reward_text: "45 snowflakes", claimable: true }],
          pass: { tier: 2, xp: 700, next_xp: 900, max_tier: 30, tiers: [
            { tier: 1, xp: 300, reward_text: "100 snowflakes", claimed: true },
            { tier: 2, xp: 600, reward_text: "110 snowflakes", claimed: false }
          ] }
        }
      }]
    }, nowW + 10)
    check("§9 payload: a rendered blob lands as one player row", devPush.players === 1 && devPush.treeSlots === 1,
      JSON.stringify({ players: devPush.players, tree: devPush.treeSlots, errors: devPush.errors }))
    const devState = await loadState(wEnv, stranger, "2026")
    check("§9 payload: wallet, style, level and pass are mirrored",
      devState.snowflakes === 77 && devState.treeStyle === 3 && devState.treeLevel === 1 && devState.pass.tier === 2,
      JSON.stringify({ s: devState.snowflakes, st: devState.treeStyle, t: devState.pass.tier }))
    check("§9 payload: chapter and verse — only an OPENED present reaches the log",
      devState.gifts.length === 1 && devState.gifts[0].rarity === 2, String(devState.gifts.length))
    check("§9 payload: only owned ornaments count as owned",
      devState.ownedIds.has(1) && !devState.ownedIds.has(4))
    check("§9 payload: only CLAIMED advent days reach the ledger",
      devState.advent.size === 1 && devState.advent.has(1), String(devState.advent.size))
    check("§9 payload: slots are mirrored by ornament_id",
      devState.slots.get(7) === 1, String(devState.slots.get(7)))
    const devCat = await loadCatalog(wEnv)
    check("§9 payload: its catalogue is used when catalogs.winterfest is absent",
      devCat.ok && devCat.ornaments.length === 2 && devCat.ornamentById.get(4).secret === true,
      JSON.stringify({ ok: devCat.ok, n: devCat.ornaments.length }))
    check("§9 payload: the reward text it carries is what the pages print",
      !!adventEntry(devCat, 1) && adventEntry(devCat, 1).label === "40 snowflakes",
      adventEntry(devCat, 1) && adventEntry(devCat, 1).label)

    // ---- 9d. the pages over HTTP (catalogue through the REAL push) --------
    await winterPanel.start(18083)
    const catPush = await push(winterPanel, { players: [], catalogs: { winterfest: CAT } })
    check("winter: the catalogue lands through the existing catalogs push",
      catPush.status === 200 && !!winterPanel.first("SELECT json FROM catalog WHERE key='winterfest'"),
      "-> " + catPush.status)

    // The one-line seam sync.js will call, exercised for real against the
    // running panel's database.
    const panelDb = openLocalD1(winterPanel.dbFile)
    const panelEnv = { DB: panelDb, SYNC_SECRET: SECRET, FN_LOCAL_TRUST: "1" }
    const seeded = await applyWinterPayload(panelEnv, {
      winter: {
        season: { name: "Winterfest", year: 2026, start: "2026-12-01", end: "2026-12-24", enabled: 1 },
        community: { key: "gifts", label: "Presents opened", current: 4321, target: 10000 },
        players: [{
          steamid: owner, at: nowW, snowflakes: 145, gifts_found: 12,
          tree_style: 2, tree_level: 3,
          tree: [{ slot: 3, ornament: 2 }, { slot: 9, ornament: 1 }],
          ornaments: [1, 2, 3, 4, 5],
          advent: [{ day: 1, at: parisMidnight(2026, 12, 1) + 3600 }],
          gifts: [
            { instance: 1, rarity: 1, type: "ornament", id: 2, at: nowW - 300, key: "pg:1" },
            { instance: 2, rarity: 2, type: "snow", id: 0, amount: 25, at: nowW - 200, key: "pg:2" }
          ],
          pass: { xp: 250, tier: 3 }
        }]
      }
    }, nowW)
    check("winter: the panel mirror accepts a push while the panel is running",
      seeded.players === 1 && seeded.errors.length === 0, JSON.stringify(seeded.errors))

    const noScript = t => t.replace(/<script[\s\S]*?<\/script>/g, "")
    const wget = async (path) => {
      const res = await fetch(winterPanel.base + path)
      return { status: res.status, body: await res.text(), headers: res.headers }
    }
    for (const route of ["/winter", "/winter/tree", "/winter/gifts", "/winter/ornaments", "/winter/advent", "/winter/pass"]) {
      const r = await wget(route + "?steamid=" + encodeURIComponent(owner))
      check("winter route " + route, r.status === 200, "-> " + r.status)
    }
    const w404 = await fetch(winterPanel.base + "/winter/nope")
    check("winter route /winter/nope is a 404", w404.status === 404, "-> " + w404.status)

    // A player the panel has never seen still renders a full page.
    const unseenHub = await wget("/winter?steamid=" + encodeURIComponent("STEAM_0:0:900099"))
    check("unseen player: /winter answers 200", unseenHub.status === 200, "-> " + unseenHub.status)
    check("unseen player: the hub shows the zero state, not a blank page",
      unseenHub.body.includes("0/24") && unseenHub.body.includes("Tier 1"), "")
    check("unseen player: no NaN anywhere outside the enhancement script",
      !noScript(unseenHub.body).includes("NaN"))
    check("unseen player: the page says what to do in game", unseenHub.body.includes("/christmas"))

    const unseenTree = await wget("/winter/tree?steamid=" + encodeURIComponent("STEAM_0:0:900099"))
    const emptySlots = (unseenTree.body.match(/class="wf-in empty"/g) || []).length
    check("empty tree: 24 slots, all of them empty", emptySlots === 24, String(emptySlots))
    check("empty tree: nothing is filled", (unseenTree.body.match(/class="wf-in filled"/g) || []).length === 0)
    check("empty tree: completion reads 0/24", unseenTree.body.includes("0/24"))

    // The owner's tree: the same renderer, with ornaments and their names.
    const ownerTree = await wget("/winter/tree?steamid=" + encodeURIComponent(owner))
    const filledSlots = (ownerTree.body.match(/class="wf-in filled"/g) || []).length
    check("tree: filled slots render with their ornament names",
      filledSlots === 2 && ownerTree.body.includes("Frosted Snowflake"), String(filledSlots))
    check("tree: the ornament has a hover title with its slot",
      ownerTree.body.includes('title="Frosted Snowflake') && ownerTree.body.includes("slot 3"), "")
    check("tree: the player's own style is the one rendered",
      ownerTree.body.includes("Tall (yours)") && ownerTree.body.includes("Slots filled") &&
      ownerTree.body.includes("2/24"), "")
    check("tree: the no-JS move form is there for a trusted deployment",
      ownerTree.body.includes('id="wf-move-form"') && ownerTree.body.includes('name="from"') &&
      ownerTree.body.includes('name="to"'), "")
    check("tree: every style is reachable without JavaScript",
      ownerTree.body.includes("style=1") && ownerTree.body.includes("style=3"), "")

    // Somebody else's tree: same renderer, read-only, and none of the owner's data.
    const strangerTree = await wget("/winter/tree/" + encodeURIComponent(stranger))
    check("public tree: a stranger's tree answers 200", strangerTree.status === 200, "-> " + strangerTree.status)
    check("public tree: it is read-only (no move form)", !strangerTree.body.includes('id="wf-move-form"'))
    check("public tree: it does not leak the owner's ornaments",
      !strangerTree.body.includes("Frosted Snowflake") && !strangerTree.body.includes("Crystal Snowflake"))
    check("public tree: it is the same renderer", strangerTree.body.includes("wf-in empty") &&
      strangerTree.body.includes("wf-tree"))
    check("public tree: an unparseable steamid is a 404",
      (await fetch(winterPanel.base + "/winter/tree/notasteamid")).status === 404)

    // Advent: claimed / today / missed / locked, computed from the real clock.
    const adventBody = (await wget("/winter/advent?steamid=" + encodeURIComponent(owner))).body
    const calCells = (adventBody.match(/<td class="(claimed|today|missed|locked)"/g) || []).length
    check("advent page: 24 calendar cells", calCells === 24, String(calCells))
    check("advent page: day 1 is claimed", (adventBody.match(/<td class="claimed"/g) || []).length === 1)
    const seasonNow = resolveSeason({ name: "Winterfest", year: 2026, start: "2026-12-01", end: "2026-12-24", enabled: 1 }, nowW)
    const seasonOpenNow = seasonNow.adventOpen
    const todayCells = (adventBody.match(/<td class="today"/g) || []).length
    check("advent page: exactly one 'today' cell while the calendar is open",
      seasonOpenNow ? todayCells === 1 : todayCells === 0, `today=${todayCells} day=${dayNow}/${monthNow}`)
    check("advent page: the closing rule is printed with its timezone",
      adventBody.includes("Europe/Paris") && adventBody.includes("on its own date"))
    check("advent page: the withdrawn half-value catch-up is not advertised",
      !adventBody.includes("half value") || adventBody.includes("withdrawn"))
    check("advent page: it names the owner's timezone enhancement",
      adventBody.includes("your own timezone") || adventBody.includes("Europe/Paris"))

    // Ornaments: the secret rules.
    const ornBody = (await wget("/winter/ornaments?steamid=" + encodeURIComponent(owner))).body
    check("ornaments: a found ornament is listed by name", ornBody.includes("Crystal Snowflake"))
    check("ornaments: a found HIDDEN ornament shows its name once owned",
      ornBody.includes("Frozen Star"))
    check("ornaments: a locked non-hidden ornament still shows its name",
      ornBody.includes("Jolly Santa"))
    check("ornaments: a locked hidden ornament never leaks its name",
      !ornBody.includes("Golden Santa") && !ornBody.includes("Santa's List"))
    check("ornaments: the locked silhouette is rendered", ornBody.includes("? ? ?"))
    check("ornaments: a completed set shows the title it awarded",
      ornBody.includes("Ice Warrior") && ornBody.includes("UNLOCKED"))
    check("ornaments: a locked set shows its prize and its unlock state",
      ornBody.includes("Helper") && ornBody.includes("LOCKED"))
    check("ornaments: set progress is stated", ornBody.includes("5/5") && ornBody.includes("0/5"))

    // Gifts: real openings only, and an honest empty state.
    const giftsBody = (await wget("/winter/gifts?steamid=" + encodeURIComponent(owner))).body
    check("gifts: the openings are listed with a reward", giftsBody.includes("Ornament: Frosted Snowflake"))
    check("gifts: counts are grouped by rarity", giftsBody.includes("Uncommon") && giftsBody.includes("Rare"))
    check("gifts: the community goal is shown when the game pushes one",
      giftsBody.includes("Presents opened") && giftsBody.includes("4,321"))
    const emptyGifts = (await wget("/winter/gifts?steamid=" + encodeURIComponent(stranger))).body
    check("gifts: an empty log points at /christmas instead of inventing rows",
      emptyGifts.includes("/christmas") && emptyGifts.includes("No presents opened yet"))

    // Pass: 30 tiers, free track, no premium anywhere.
    const passBody = (await wget("/winter/pass?steamid=" + encodeURIComponent(owner))).body
    check("pass page: the current tier and XP are shown", passBody.includes("Tier") && passBody.includes("250"))
    check("pass page: the next three rewards are listed", passBody.includes("Next three rewards"))
    check("pass page: the ladder is collapsible without JavaScript",
      passBody.includes("Show the full 30-tier ladder"))
    const passFull = (await wget("/winter/pass?steamid=" + encodeURIComponent(owner) + "&full=1")).body
    const ladderRungs = (passFull.match(/<td class="t">/g) || []).length
    check("pass page: the full ladder renders 30 rungs", ladderRungs === 30, String(ladderRungs))
    // The shared MOTD stylesheet still carries the BattlePass's .premium rules
    // (not ours to delete), so the assertion is about OUR markup: strip <style>.
    const passMarkup = passFull.replace(/<style[\s\S]*?<\/style>/g, "")
    check("pass page: there is no premium track, paid lane or purchase link",
      !/premium|paid track|purchase|upgrade now/i.test(passMarkup))

    // The hub carries the three headlines.
    const hubBody = (await wget("/winter?steamid=" + encodeURIComponent(owner))).body
    check("hub: the season countdown is present",
      /day[s]? left|not open yet|closed/.test(hubBody), "")
    check("hub: Advent progress is shown", hubBody.includes("1/24"), "")
    check("hub: snowflakes and gifts are shown", hubBody.includes("145") && hubBody.includes("12"))
    check("hub: the tree level is shown as filled/24", hubBody.includes("2/24") || hubBody.includes("level 3"))
    check("hub: the pass tier is shown", hubBody.includes("Tier 3"))
    check("hub: the three headlines are rendered",
      hubBody.includes("ADVENT") && hubBody.includes("WINTER PASS") && hubBody.includes("COMMUNITY GOAL"))
    check("hub: no NaN on a real player either", !noScript(hubBody).includes("NaN"))

    // ---- 9e. the tree move action (no JS, token-gated) --------------------
    const ownerToken = await mintActionToken({ SYNC_SECRET: SECRET, FN_LOCAL_TRUST: "1" }, owner)
    const postTree = async (base, fields) => {
      const body = new URLSearchParams(fields).toString()
      const res = await fetch(base + "/winter/tree", {
        method: "POST", redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      })
      return { status: res.status, body: await res.text() }
    }
    const noTokenPost = await postTree(winterPanel.base, { steamid: owner, action: "move", from: "9", to: "12" })
    check("tree POST: no token is refused with 403", noTokenPost.status === 403, "-> " + noTokenPost.status)
    const badSlotPost = await postTree(winterPanel.base, { steamid: owner, t: ownerToken, action: "move", from: "5", to: "12" })
    check("tree POST: moving an empty slot is refused", badSlotPost.status === 403 &&
      badSlotPost.body.includes("Slot 5 is empty"), "-> " + badSlotPost.status)
    const movePost = await postTree(winterPanel.base, { steamid: owner, t: ownerToken, action: "move", from: "9", to: "12" })
    check("tree POST: a valid move redirects (303)", movePost.status === 303, "-> " + movePost.status)
    const queuedMove = winterPanel.first(
      "SELECT type, arg, status FROM actions WHERE steamid=?1 AND type='wf_tree_move'", owner)
    check("tree POST: the move is QUEUED for the game, not applied here",
      !!queuedMove && queuedMove.arg === "9:12" && queuedMove.status === "pending",
      JSON.stringify(queuedMove))
    const mirrored = winterPanel.first("SELECT ornament FROM winter_tree WHERE steamid=?1 AND slot=9", owner)
    check("tree POST: the mirror is untouched until the game confirms",
      !!mirrored && Number(mirrored.ornament) === 1)
    const dupePost = await postTree(winterPanel.base, { steamid: owner, t: ownerToken, action: "move", from: "9", to: "12" })
    check("tree POST: an identical request is deduplicated", dupePost.status === 303 && winterPanel.first(
      "SELECT COUNT(*) AS n FROM actions WHERE steamid=?1 AND type='wf_tree_move'", owner).n === 1)
    const stylePost = await postTree(winterPanel.base, { steamid: owner, t: ownerToken, action: "style", style: "3" })
    check("tree POST: the style change is queued too", stylePost.status === 303 && !!winterPanel.first(
      "SELECT arg FROM actions WHERE steamid=?1 AND type='wf_tree_style'", owner))
    const untrustedPost = await postTree(panel.base, { steamid: owner, action: "style", style: "1" })
    check("tree POST: a deployment that does not mint tokens refuses", untrustedPost.status === 403,
      "-> " + untrustedPost.status)

    // ---- 9f. the Christmas skin ------------------------------------------
    // The one meta key is the switch. Off first, so the baseline is provably
    // the untouched page; then on, then off again.
    const setSeasonWindow = async (json) => {
      const db = openLocalD1(winterPanel.dbFile)
      try {
        await ensureWinterTables({ DB: db })
        if (json == null) db.raw.prepare("DELETE FROM winter_meta WHERE key='season'").run()
        else db.raw.prepare(
          "INSERT INTO winter_meta (key, value, updated_at) VALUES ('season', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
          .run(JSON.stringify(json), nowW)
      } finally { db.raw.close() }
    }
    // /rules is a static page: the strongest possible "no-op" assertion is that
    // injecting the skin and stripping it again gives EXACTLY the same bytes.
    await setSeasonWindow({ name: "Winterfest", year: 2026, start: "2020-12-01", end: "2020-12-24", enabled: 1 })
    const skinOff = (await wget("/rules")).body
    check("skin: a window in the past injects nothing", !skinOff.includes(WINTER_SKIN_MARK))

    const thisYear = parisParts(nowW).y
    await setSeasonWindow({ name: "Winterfest", year: thisYear, start: `${thisYear}-01-01`, end: `${thisYear}-12-31`, enabled: 1 })
    const skinOn = (await wget("/rules")).body
    check("skin: an open window recolours an existing page", skinOn.includes(WINTER_SKIN_MARK))
    check("skin: it adds the snow motif", skinOn.includes('id="wf-winter-skin"'))
    const injected = (skinOn.match(new RegExp("<style>[^<]*" + WINTER_SKIN_MARK + "[\\s\\S]*?</style>")) || [""])[0]
    check("skin: the injected sheet needs no image, font or second request",
      injected.length > 200 && !/url\(|@font-face|<img/i.test(injected), String(injected.length))
    const snowDiv = (skinOn.match(/<div id="wf-winter-skin"[\s\S]*?<\/div>/) || [""])[0]
    const stripped = injected && snowDiv ? skinOn.replace(injected, "").replace(snowDiv, "") : "did-not-split"
    check("skin: it only ADDS — strip the sheet and the page is byte-identical",
      stripped === skinOff, stripped === "did-not-split" ? "could not split the injection" : `${stripped.length} vs ${skinOff.length}`)
    check("skin: the page keeps its own stylesheet", skinOn.includes("motd-head") && skinOn.includes("csgo-pass"))

    await setSeasonWindow({ name: "Winterfest", year: thisYear, start: `${thisYear}-01-01`, end: `${thisYear}-12-31`, enabled: 0 })
    const skinDisabled = (await wget("/rules")).body
    check("skin: enabled=0 is inert even inside the dates", !skinDisabled.includes(WINTER_SKIN_MARK))
    check("skin: enabled=0 hands back the untouched page", skinDisabled === skinOff)
    await setSeasonWindow(null)
    const skinDefault = (await wget("/rules")).body
    const defaultActive = resolveSeason({}, nowW).active
    check("skin: with no pushed season it follows the documented 1..24 December window",
      defaultActive ? skinDefault.includes(WINTER_SKIN_MARK) : !skinDefault.includes(WINTER_SKIN_MARK),
      `month=${monthNow} day=${dayNow}`)
    check("skin: a JSON response is never touched",
      !(await wget("/api/public/status")).body.includes(WINTER_SKIN_MARK))

    // ---- 9g. the v2 design rebuild: the dashboard at /v2 ------------------
    // The page is a pure function of the adapters (render(viewModel)), so the
    // maths and the markup are checked without HTTP first; the route checks
    // then prove the same numbers over the wire, and that a zero-data player
    // gets an honest page instead of the reference mock's numbers.
    const T0 = 1_700_000_000

    const cdA = countdownParts(T0 + 2 * 86400 + 14 * 3600 + 5 * 60 + 9, T0)
    check("v2 countdown: days/hours/minutes/seconds split correctly",
      cdA.days === 2 && cdA.hours === 14 && cdA.minutes === 5 && cdA.seconds === 9, JSON.stringify(cdA))
    const cdPast = countdownParts(1000, 2000)
    check("v2 countdown: a closed window clamps to zero, never goes negative",
      cdPast.days === 0 && cdPast.hours === 0 && cdPast.left === 0)
    check("v2 duration: the pill's wording (2d 14h / 14h / 45m / now)",
      shortDuration(2 * 86400 + 14 * 3600) === "2d 14h" && shortDuration(14 * 3600) === "14h" &&
      shortDuration(45 * 60) === "45m" && shortDuration(0) === "now",
      [shortDuration(2 * 86400 + 14 * 3600), shortDuration(14 * 3600), shortDuration(45 * 60)].join(" | "))

    const pill = row => eventState(row, T0)
    const ends = pill({ status: "active", start_at: T0 - 100, end_at: T0 + 2 * 86400 + 14 * 3600 })
    check("v2 pill: an active window with an end reads 'Ends in 2d 14h'",
      ends.label === "Ends in 2d 14h" && ends.tone === "green", ends.label)
    check("v2 pill: an active window with no end reads 'Active Now'",
      pill({ status: "active" }).label === "Active Now")
    const starts = pill({ status: "scheduled", start_at: T0 + 14 * 3600 })
    check("v2 pill: a scheduled window reads 'Starts in 14h'", starts.label === "Starts in 14h" && starts.tone === "gold", starts.label)
    check("v2 pill: a scheduled window whose start has passed reads 'Active'",
      pill({ status: "scheduled", start_at: T0 - 60 }).label === "Active")
    check("v2 pill: a completed row reads 'Ended'", pill({ status: "completed" }).label === "Ended")

    const noObj = objectiveRows(null)
    check("v2 objectives: nothing pushed means four honest empty rows",
      noObj.length === 4 && noObj.every(o => o.target === 0 && o.current === 0 && o.known === false))
    const someObj = objectiveRows({ counters: [{ key: "gifts", label: "Collect Gifts", current: 42, target: 50 }, { key: "zzz", label: "junk", current: 1, target: 2 }] })
    check("v2 objectives: a pushed counter wins, an unknown key is ignored",
      someObj[0].current === 42 && someObj[0].target === 50 && someObj[0].known === true &&
      someObj.filter(o => o.known).length === 1)

    const ornCounts = ornamentCounts(cat, { ownedIds: new Set([1, 2, 3]) })
    check("v2 ornaments: owned ornaments are counted into four rarity buckets",
      ornCounts.length === 4 && ornCounts.reduce((n, o) => n + o.value, 0) === 3,
      JSON.stringify(ornCounts.map(o => o.value)))

    const tiles = rewardTiles(cat, {
      gifts: [
        { type: "ornament", id: 1, amount: 0 },
        { type: "snow", id: 0, amount: 100 },
        { type: "pass", id: 0, amount: 25 },
        { type: "title", id: 1, amount: 0 },
        { type: "ornament", id: 2, amount: 0 }
      ]
    })
    check("v2 rewards: at most four tiles, each with real art and a real label",
      tiles.length === 4 && tiles.every(t => t.art && t.title && t.title !== "undefined"), JSON.stringify(tiles.map(t => t.title)))
    check("v2 rewards: the currency tile is named GingerBread (owner decision 2026-11-22)",
      tiles[1].sub === "GingerBread", tiles[1].sub)

    check("v2 icons: an unknown name falls back to a snowflake instead of throwing",
      v2icon("no-such-icon", 20).includes("<svg") && v2icon("no-such-icon", 20) === v2icon("snowflake", 20))
    check("v2 icons: the set covers every nav item", ["dashboard", "profile", "stats", "trophy", "flag",
      "missions", "medal", "levels", "events", "advent", "wheel", "crown", "shop", "gear"].every(n => ICON_NAMES.includes(n)),
      ICON_NAMES.length + " icons")

    const shellPage = v2page({ title: "t", active: "profile", content: "<p>x</p>", chips: [], player: { name: "A" }, bell: {} })
    check("v2 shell: exactly one nav item carries aria-current", (shellPage.match(/aria-current="page"/g) || []).length === 1)
    check("v2 shell: the active item is the one asked for",
      /<a class="v2-navitem on" href="\/profile" aria-current="page">/.test(shellPage))
    check("v2 shell: a nav destination that does not exist is inert, not a 404 link",
      shellPage.includes('aria-disabled="true"') && shellPage.includes("ships with workstream"))

    // the view model, from the store 9c seeded (the §9 blob for `stranger`)
    const dashUrl = new URL("http://panel/v2?steamid=" + encodeURIComponent(stranger))
    const dash = await loadDashboard(wEnv, dashUrl, nowW)
    check("v2 dashboard: gingerbread comes from winter_players.snowflakes",
      dash.currency.gingerbread === 77, String(dash.currency.gingerbread))
    check("v2 dashboard: the pass tier comes from winter_pass",
      dash.pass.tier === 2, String(dash.pass.tier))
    check("v2 dashboard: the tree is the filled slots over 24",
      dash.tree.filled === 1 && dash.tree.total === 24 && dash.tree.pct === 4,
      `${dash.tree.filled}/${dash.tree.total} ${dash.tree.pct}%`)
    check("v2 dashboard: advent claims come from the ledger", dash.advent.claimed === 1, String(dash.advent.claimed))
    check("v2 dashboard: recent rewards are the ledger's newest grants",
      dash.rewards.length === 1, String(dash.rewards.length))
    check("v2 dashboard: every adapter reports its state for the wiring note",
      dash.wiring.length === 12 && dash.wiring.every(w => w.name && w.source && typeof w.wired === "boolean"),
      dash.wiring.filter(w => w.wired).length + "/12 live")
    check("v2 dashboard: an adapter with no source is wired:false, not invented",
      dash.wiring.find(w => w.name === "Objectives").wired === false &&
      dash.wiring.find(w => w.name === "Spins").wired === false)
    check("v2 dashboard: the not-yet-shipped shapes are documented in code",
      ADAPTER_CONTRACT.spin.includes("winter_meta.spin") && ADAPTER_CONTRACT.objectives.includes("counters") &&
      Object.keys(ADAPTER_CONTRACT).length === 4)

    const dashHtml = renderDashboardV2(dash)
    check("v2 dashboard: the measured palette is in the page", dashHtml.includes("--v2-border:#2a3d6e"))
    check("v2 dashboard: the sidebar has the four reference groups",
      ["Player", "Progression", "Events &amp; Activities", "Rewards &amp; Management"].every(g => dashHtml.includes(g)))
    check("v2 dashboard: the hero lockup, ribbon and subtitle are rendered",
      dashHtml.includes("Free<span>Nova</span>") && dashHtml.includes("WINTERFEST") && dashHtml.includes("v2-lockup"))
    check("v2 dashboard: the cropped art is referenced locally",
      ['/winter/hero.png', '/winter/santa.png', '/winter/tree.png'].every(p => dashHtml.includes(p)) &&
      /\/winter\/tile_[a-z0-9]+\.png/.test(dashHtml))
    check("v2 dashboard: alt text on the cropped art",
      /alt="Santa Claus waving[^"]*"/.test(dashHtml) && /alt="A decorated Christmas tree[^"]*"/.test(dashHtml))
    check("v2 dashboard: it makes no external request",
      !/(src|href)="https?:/i.test(dashHtml) && !/@import|fonts\.googleapis|cdn\./i.test(dashHtml))
    const dashNoJs = dashHtml.replace(/<script[\s\S]*?<\/script>/g, "")
    check("v2 dashboard: the countdown is complete with JavaScript disabled",
      (dashNoJs.match(/data-cd="/g) || []).length === 4 && dashNoJs.includes("Days") && dashNoJs.includes("Seconds"))
    check("v2 dashboard: no NaN, no 'undefined', no reference mock numbers",
      !dashNoJs.includes("NaN") && !dashNoJs.includes("undefined") &&
      !dashNoJs.includes("24,500") && !dashNoJs.includes("1,320") && !dashNoJs.includes("68%"))
    check("v2 dashboard: the page states which adapters are live",
      dashNoJs.includes("adapters live") && dashNoJs.includes("winter_meta"))

    for (const art of ["hero.png", "santa.png", "tree.png", "tile_ak47.png", "tile_ginger.png", "tile_snowflake.png", "tile_hat.png"]) {
      const fp = join(here, "assets", "winter", art)
      check("v2 art: assets/winter/" + art + " is on disk and non-trivial",
        existsSync(fp) && readFileSync(fp).length > 2000, existsSync(fp) ? readFileSync(fp).length + " bytes" : "missing")
    }

    // ---- the route, over HTTP, against the running winter panel ----------
    const v2 = await wget("/v2")
    check("v2 route: /v2 answers 200 as HTML",
      v2.status === 200 && (v2.headers.get("content-type") || "").includes("text/html"), "-> " + v2.status)
    const v2hub = await wget("/v2/hub")
    check("v2 route: /v2/hub is the same page", v2hub.status === 200 && v2hub.body === v2.body)
    const v2nope = await fetch(winterPanel.base + "/v2/nope")
    check("v2 route: an unknown /v2 path is a 404", v2nope.status === 404, "-> " + v2nope.status)

    // a real push changes the chips: the numbers are the database, not markup
    await push(winterPanel, { players: [player(owner, { name: "Owner", coins: 1234, level: 12, last_seen: nowW })] })
    const v2Owner = await wget("/v2?steamid=" + encodeURIComponent(owner))
    check("v2 route: the coins chip is players.coins", v2Owner.body.includes("1,234"), "")
    check("v2 route: the profile chip is players.name + players.level",
      v2Owner.body.includes("Owner") && v2Owner.body.includes("Level 12"))
    check("v2 route: the gingerbread chip is the winter mirror", v2Owner.body.includes("145"))
    check("v2 route: the stat strip prints the pass tier and the tree", v2Owner.body.includes("Lv. 3") && v2Owner.body.includes("2 of 24 slots filled"))
    check("v2 route: aria-current marks exactly the dashboard",
      (v2Owner.body.match(/aria-current="page"/g) || []).length === 1 && /v2-navitem on" href="\/v2"/.test(v2Owner.body))

    const v2Unseen = await wget("/v2?steamid=" + encodeURIComponent("STEAM_0:0:900099"))
    const unseenNoJs = noScript(v2Unseen.body)
    check("v2 route: a player with no data still gets a full page", v2Unseen.status === 200)
    check("v2 route: their zero state is honest (0%, no NaN)",
      unseenNoJs.includes("0%") && !unseenNoJs.includes("NaN"))
    check("v2 route: the unseen player's card says it is not signed in",
      unseenNoJs.includes("not signed in"))
    const v2Anon = await wget("/v2")
    check("v2 route: an anonymous visit shows the season, never a fake player",
      v2Anon.status === 200 && noScript(v2Anon.body).includes("Guest") &&
      noScript(v2Anon.body).includes("Open this panel from the game"))

    // every link the dashboard advertises has to resolve (same rule as the hub)
    const dashLinks = [...new Set([...v2Owner.body.matchAll(/href=['"]([^'"]+)/g)].map(m => m[1]))]
    let deadDashLinks = []
    for (const link of dashLinks) {
      if (/^(#|mailto:|javascript:)/i.test(link)) continue
      if (/^https?:/i.test(link)) { deadDashLinks.push("external:" + link); continue }
      const res = await fetch(winterPanel.base + link, { redirect: "manual" })
      if (![200, 302].includes(res.status)) deadDashLinks.push(link + " -> " + res.status)
    }
    check("v2 route: every link the dashboard advertises resolves", deadDashLinks.length === 0, deadDashLinks.join(", "))

    // The seasonal skin must not repaint this page: it owns the Winterfest
    // palette already, and the skin's guard has to hand back a READABLE body
    // (returning the drained response used to 500 the whole route in December).
    await setSeasonWindow({ name: "Winterfest", year: thisYear, start: `${thisYear}-01-01`, end: `${thisYear}-12-31`, enabled: 1 })
    const v2Skinned = await wget("/v2?steamid=" + encodeURIComponent(owner))
    // The countdown ticks between requests, so compare everything but the clock.
    const steady = t => t.replace(/(<b data-cd="[a-z]+">)\d+/g, "$1N").replace(/data-left="\d+"/g, 'data-left="N"')
    const v2SkinnedAgain = await wget("/v2?steamid=" + encodeURIComponent(owner))
    check("v2 skin: /v2 answers with the season open, and is stable", v2Skinned.status === 200 &&
      steady(v2Skinned.body) === steady(v2SkinnedAgain.body), "-> " + v2Skinned.status)
    check("v2 skin: the seasonal sheet is NOT injected into the dashboard",
      !v2Skinned.body.includes("#" + WINTER_SKIN_MARK + "{background") && !v2Skinned.body.includes('id="' + WINTER_SKIN_MARK + '"'))
    check("v2 skin: it carries the marker it opts out with", v2Skinned.body.includes(WINTER_SKIN_MARK))
    const rulesSkinned = await wget("/rules")
    check("v2 skin: the skin still recolours the pages that want it",
      rulesSkinned.body.includes(WINTER_SKIN_MARK) && rulesSkinned.status === 200)
    await setSeasonWindow(null)

    panelDb.raw.close()
    wDb.raw.close()
    await winterPanel.stop()
  }


  // ============================ 14. Levels page + the envelope =============
  // Workstreams 14 (docs/WINTERFEST-WORKSTREAMS.md row 14) and 15 (row 15):
  // the rank ladder page and the inbox behind the red dot in the top bar.
  // Pure units first (curve, rewards, cross-reference, inbox scoping), then the
  // two pages over HTTP against a panel with a seeded player and mailbox.
  {
    // The same catalogue fixture the winter section uses (one shape, one place).
    const lvCat = normalizeWinterCatalog(winterCatalogue())

    // ---- 14a. the curve is the RSU table, not a formula -------------------
    check("levels: 19 rungs, one per RSU rank", MAX_LEVEL === 19 && LEVEL_XP.length === 19,
      `max=${MAX_LEVEL} xp=${LEVEL_XP.length}`)
    check("levels: the XP floors are the [Ranks] table in rank_system_ultimate.ini",
      LEVEL_XP[0] === 0 && LEVEL_XP[1] === 2816 && LEVEL_XP[18] === 30000,
      JSON.stringify([LEVEL_XP[0], LEVEL_XP[1], LEVEL_XP[18]]))
    check("levels: a level is derived from XP by the floors, never by division",
      levelFromXp(0) === 1 && levelFromXp(2815) === 1 && levelFromXp(2816) === 2 &&
      levelFromXp(12013) === 14 && levelFromXp(29999) === 18 && levelFromXp(30000) === 19 &&
      levelFromXp(999999) === 19,
      [levelFromXp(0), levelFromXp(2815), levelFromXp(2816), levelFromXp(12013), levelFromXp(999999)].join(","))

    // ---- 14b. a level-1 player is arithmetic, not NaN ---------------------
    const lvl1 = levelPosition({ xp: 0, level: 1, rank_id: 1, bp_xp: 0, bp_tier: 0 })
    check("levels: a level-1 player at 0 XP shows 0/2816 and 0%",
      lvl1.level === 1 && lvl1.into === 0 && lvl1.span === 2816 && lvl1.toNext === 2816 && lvl1.pct === 0,
      JSON.stringify({ l: lvl1.level, into: lvl1.into, span: lvl1.span, pct: lvl1.pct }))
    const noRow = levelPosition(null)
    const flat = JSON.stringify(noRow, (k, v) => typeof v === "number" && Number.isNaN(v) ? "NaN" : v)
    check("levels: no snapshot is level 1 with no NaN anywhere",
      noRow.level === 1 && noRow.found === false && !flat.includes("NaN") && !flat.includes("null,"),
      flat.slice(0, 120))
    check("levels: a malformed row cannot produce NaN",
      !JSON.stringify(levelPosition({ xp: "abc", level: "x", rank_id: null, bp_xp: undefined })).includes("NaN"))
    const mid = levelPosition({ xp: 12013, level: 14, rank_id: 14, bp_xp: 900, bp_tier: 2 })
    check("levels: a mid-ladder player reads floor, next rung and distance",
      mid.floor === 12013 && mid.nextAt === 13088 && mid.toNext === 1075 && mid.pct === 0,
      JSON.stringify({ f: mid.floor, n: mid.nextAt, d: mid.toNext }))
    check("levels: the top rung is 100% and has no next",
      levelPosition({ xp: 30000, level: 19, rank_id: 19 }).atMax === true &&
      levelPosition({ xp: 30000, level: 19, rank_id: 19 }).nextAt === null &&
      levelPosition({ xp: 30000, level: 19, rank_id: 19 }).pct === 100)
    check("levels: the Battle Pass tier is carried as a SEPARATE figure",
      mid.bpTier === 2 && mid.bpTier !== mid.level,
      `bp=${mid.bpTier} level=${mid.level}`)

    // ---- 14c. the reward table matches levels.ini (lockstep, enforced) ----
    const iniText = readFileSync(
      join(here, "..", "game-server", "cstrike", "addons", "amxmodx", "configs",
        "freenova", "winterfest", "levels.ini"), "utf8")
    const iniRows = iniText.split(/\r?\n/)
      .map(l => l.replace(/;.*$/, "").trim())
      .filter(l => /^\d+\s*\|/.test(l))
      .map(l => {
        const f = l.split("|").map(x => x.trim())
        return { level: Number(f[0]), kind: f[1], id: Number(f[2]), amount: Number(f[3]), state: f[4] }
      })
    check("levels: levels.ini has a row for every rung but level 1", iniRows.length === 18,
      String(iniRows.length))
    const drift = []
    for (const row of iniRows) {
      const mine = LEVEL_REWARDS.find(r => r.level === row.level)
      if (!mine || mine.kind !== row.kind || mine.id !== row.id || mine.amount !== row.amount || mine.state !== row.state)
        drift.push(`${row.level}:${row.kind}/${row.id}/${row.amount}/${row.state} vs ${JSON.stringify(mine)}`)
    }
    const extra = LEVEL_REWARDS.filter(r => !iniRows.some(i => i.level === r.level)).map(r => r.level)
    check("levels: LEVEL_REWARDS is byte-for-byte levels.ini (keep in lockstep)",
      drift.length === 0 && extra.length === 0,
      (drift.join(" | ") + (extra.length ? " extra:" + extra.join(",") : "")).slice(0, 220))

    // ---- 14d. a reward that is not implemented is coming, and NOT claimable --
    const liveRow = { level: 6, kind: "gingerbread", id: 0, amount: 125, state: "live" }
    const spinRow = { level: 11, kind: "spin", id: 0, amount: 1, state: "live" } // config LIES on purpose
    const coinRow = { level: 14, kind: "coins", id: 0, amount: 250, state: "live" }
    const deadRow = { level: 4, kind: "pass_xp", id: 0, amount: 50, state: "coming" }
    check("levels: a live, implemented reward is live", rewardState(liveRow).state === "live")
    check("levels: spin is forced to coming even when the config says live",
      rewardState(spinRow).state === "coming" && /workstream 13|wheel/.test(rewardState(spinRow).why),
      rewardState(spinRow).why)
    check("levels: coins are forced to coming (no coin kind in wf_grant)",
      rewardState(coinRow).state === "coming" && /coin/.test(rewardState(coinRow).why), rewardState(coinRow).why)
    check("levels: a config 'coming' stays coming", rewardState(deadRow).state === "coming")
    check("levels: an unknown reward kind is coming, never live",
      rewardState({ level: 3, kind: "sleigh", state: "live" }).state === "coming")
    check("levels: REWARD_KINDS only calls implemented things available",
      REWARD_KINDS.gingerbread.available === true && REWARD_KINDS.ornament.available === true &&
      REWARD_KINDS.spin.available === false && REWARD_KINDS.coins.available === false &&
      REWARD_KINDS.cosmetic.available === false)
    check("levels: rewards are worded from real ids (ornament names from the catalogue)",
      rewardText({ kind: "ornament", id: 3 }, lvCat) === "Silver Snowflake" &&
      rewardText({ kind: "gingerbread", amount: 1250 }, lvCat) === "1,250 GingerBread" &&
      rewardText({ kind: "title", id: 1 }, lvCat) === "the \"Ice Warrior\" title",
      rewardText({ kind: "title", id: 1 }, lvCat))
    check("levels: an absent catalogue falls back to the id, not to a guess",
      rewardText({ kind: "ornament", id: 3 }, normalizeWinterCatalog(null)) === "Ornament #3")
    check("levels: next reward and the next three milestones",
      nextRewardLevel(1) === 2 && nextRewardLevel(10) === 11 && nextRewardLevel(19) === null &&
      milestones(1, 3).map(m => m.level).join(",") === "2,3,4" &&
      milestones(17, 3).map(m => m.level).join(",") === "18,19" &&
      milestones(19, 3).length === 0,
      JSON.stringify(milestones(17, 3).map(m => m.level)))

    // ---- 14e. the mailbox: scoping, expiry, unread ------------------------
    const mDb = openLocalD1(join(root, "levels-mail-unit.sq3"))
    const mEnv = { DB: mDb, SYNC_SECRET: SECRET, FN_LOCAL_TRUST: "1" }
    await ensureMailTables(mEnv)
    await ensureMailTables(mEnv) // twice: every statement is IF NOT EXISTS
    const mTables = mDb.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='winter_mail'").all()
    check("mail: winter_mail exists after the DDL", mTables.length === 1)
    const mCols = mDb.raw.prepare("PRAGMA table_info(winter_mail)").all().map(r => r.name)
    check("mail: the table carries every column the brief names",
      ["id", "steamid", "kind", "title", "body", "created_at", "read_at", "expires_at", "payload"]
        .every(c => mCols.includes(c)), mCols.join(","))
    check("mail: MAIL_DDL is IF NOT EXISTS only (never rewrites a live table)",
      MAIL_DDL.every(sql => /IF NOT EXISTS/.test(sql)) && !/ALTER|DROP/.test(MAIL_DDL.join(" ")))
    check("mail: the four kinds are system/event/grant/admin",
      MAIL_KINDS.join(",") === "system,event,grant,admin")
    check("mail: an unknown kind normalizes to system", normalizeKind("nonsense") === "system" &&
      normalizeKind("GRANT") === "grant")

    const mailNow = Math.floor(Date.now() / 1000)
    const alice = "STEAM_0:0:700001"
    const bob = "STEAM_0:0:700002"
    check("mail: an empty inbox counts 0 unread", (await unreadCount(mEnv, alice, mailNow)) === 0)
    check("mail: an empty inbox lists nothing", (await loadInbox(mEnv, alice, { now: mailNow })).length === 0)
    const sentA = await sendMail(mEnv, { target: alice, kind: "system", title: "Hello Alice", body: "one", now: mailNow })
    check("mail: one steamid gets exactly one row", sentA.ok === true && sentA.sent === 1, JSON.stringify(sentA))
    await sendMail(mEnv, { target: alice, kind: "grant", title: "Reward paid", body: "two", now: mailNow + 1, payload: '{"ref":"g:1"}' })
    await sendMail(mEnv, { target: bob, kind: "admin", title: "Hello Bob", body: "three", now: mailNow + 2 })
    const expired = await sendMail(mEnv, { target: alice, kind: "event", title: "Expired one", body: "gone",
      now: mailNow, expiresAt: mailNow - 10 })
    check("mail: an expiry in the past is refused at send time", expired.ok === false && expired.status === 400,
      JSON.stringify(expired))
    mDb.raw.prepare("INSERT INTO winter_mail (steamid,kind,title,body,created_at,read_at,expires_at,payload) VALUES (?1,?2,?3,?4,?5,0,?6,'')")
      .run(alice, "event", "Already expired", "gone", mailNow - 500, mailNow - 5)
    check("mail: unread counts only unexpired messages", (await unreadCount(mEnv, alice, mailNow)) === 2,
      String(await unreadCount(mEnv, alice, mailNow)))
    const aliceInbox = await loadInbox(mEnv, alice, { now: mailNow })
    check("mail: the inbox hides expired rows", aliceInbox.length === 2 && !aliceInbox.some(m => m.title === "Already expired"),
      JSON.stringify(aliceInbox.map(m => m.title)))
    check("mail: the inbox is scoped to its own steamid",
      !aliceInbox.some(m => m.title === "Hello Bob") &&
      (await loadInbox(mEnv, bob, { now: mailNow })).length === 1,
      JSON.stringify((await loadInbox(mEnv, bob, { now: mailNow })).map(m => m.title)))
    const bobMessage = (await loadInbox(mEnv, bob, { now: mailNow }))[0]
    check("mail: another player's message id resolves to nothing",
      (await loadMessage(mEnv, alice, bobMessage.id, mailNow)) === null)
    check("mail: its own message id resolves",
      (await loadMessage(mEnv, alice, aliceInbox[0].id, mailNow)) !== null)
    check("mail: a steamid that cannot be parsed sees nothing",
      (await loadInbox(mEnv, "not-a-steamid", { now: mailNow })).length === 0 &&
      (await unreadCount(mEnv, "", mailNow)) === 0)
    // The game reports a read; the panel only ever decreases the count.
    mDb.raw.prepare("UPDATE winter_mail SET read_at=?1 WHERE steamid=?2 AND title=?3").run(mailNow + 5, alice, "Hello Alice")
    check("mail: a reported read drops the unread count", (await unreadCount(mEnv, alice, mailNow)) === 1,
      String(await unreadCount(mEnv, alice, mailNow)))
    check("mail: the read timestamp is kept", (await loadInbox(mEnv, alice, { now: mailNow }))
      .some(m => m.title === "Hello Alice" && m.readAt === mailNow + 5))
    // The game -> panel direction: the read report (the payload sync.js will
    // forward). Monotonic, idempotent, scoped to the right steamid.
    const readReported = await applyMailReads(mEnv, [
      { steamid: alice, id: aliceInbox.find(m => m.title === "Reward paid").id, at: mailNow + 9 },
      { steamid: bob, id: aliceInbox.find(m => m.title === "Reward paid").id, at: mailNow + 9 },
      { steamid: "not-a-steamid", id: 1, at: mailNow },
    ])
    check("mail: the game's read report updates exactly the right row",
      readReported.updated === 1 && readReported.skipped === 2,
      JSON.stringify(readReported))
    check("mail: another player's read report cannot touch somebody else's mail",
      (await loadInbox(mEnv, alice, { now: mailNow })).every(m => m.title !== "Reward paid" || m.readAt === mailNow + 9) &&
      (await loadInbox(mEnv, bob, { now: mailNow }))[0].readAt === 0)
    const replayRead = await applyMailReads(mEnv, [{ steamid: alice, id: aliceInbox.find(m => m.title === "Reward paid").id, at: mailNow + 99 }])
    check("mail: a replayed read report is a no-op (read_at never moves backwards)",
      replayRead.updated === 0 &&
      (await loadInbox(mEnv, alice, { now: mailNow })).some(m => m.title === "Reward paid" && m.readAt === mailNow + 9),
      JSON.stringify(replayRead))
    check("mail: isVisible() honours expires_at = 0 as never",
      isVisible({ expiresAt: 0 }, mailNow) === true && isVisible({ expiresAt: mailNow - 1 }, mailNow) === false)

    // ---- 14f. the broadcast's refusals -----------------------------------
    const noTitle = await sendMail(mEnv, { target: alice, kind: "system", title: "  ", body: "x" })
    check("mail: an empty title is refused", noTitle.ok === false && noTitle.status === 400)
    const longTitle = await sendMail(mEnv, { target: alice, title: "x".repeat(81), body: "x" })
    check("mail: an over-long title is refused", longTitle.ok === false && /80/.test(longTitle.error))
    const angle = await sendMail(mEnv, { target: alice, title: "ok", body: "<script>x</script>" })
    check("mail: angle brackets are refused (the body is rendered on a page)", angle.ok === false)
    const badTarget = await sendMail(mEnv, { target: "everyone-ish", title: "ok", body: "x" })
    check("mail: a target that is neither * nor a steamid is refused",
      badTarget.ok === false && /steamid/i.test(badTarget.error), badTarget.error)
    const badJson = await sendMail(mEnv, { target: alice, title: "ok", body: "x", payload: "{not json" })
    check("mail: a payload must be JSON when it is given", badJson.ok === false && /JSON/.test(badJson.error))
    const nobody = await sendMail(mEnv, { target: "*", title: "ok", body: "x" })
    check("mail: 'everyone' with no player snapshots is refused, not silently sent",
      nobody.ok === false && /no player/i.test(nobody.error), nobody.error)
    check("mail: expires in days parses, and 0/blank means never",
      expiryFromDays("", mailNow) === 0 && expiryFromDays("0", mailNow) === mailNow &&
      expiryFromDays("7", mailNow) === mailNow + 7 * 86400 && expiryFromDays("400", mailNow) === -1 &&
      expiryFromDays("-3", mailNow) === -1)
    mDb.raw.close()

    // ---- 14g. the two pages over HTTP -------------------------------------
    await levelPanel.start(18084)
    const pDb = openLocalD1(levelPanel.dbFile)
    await ensureMailTables({ DB: pDb })
    const lvNow = Math.floor(Date.now() / 1000)
    const rookie = "STEAM_0:0:800001"
    const veteran = "STEAM_0:0:800002"
    const stranger = "STEAM_0:0:800003"
    const seedPlayer = (sid, name, xp, level, bpxp, bptier) => pDb.raw.prepare(
      `INSERT OR REPLACE INTO players (steamid,name,xp,level,rank_id,bp_xp,bp_tier,coins,last_seen)
       VALUES (?1,?2,?3,?4,?4,?5,?6,0,?7)`).run(sid, name, xp, level, bpxp, bptier, lvNow)
    seedPlayer(rookie, "Rookie One", 0, 1, 0, 0)
    seedPlayer(veteran, "Veteran Two", 12013, 14, 900, 2)
    const insMail = pDb.raw.prepare(
      "INSERT INTO winter_mail (steamid,kind,title,body,created_at,read_at,expires_at,payload) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
    insMail.run(rookie, "system", "Welcome to Winterfest", "Find a present and open it.", lvNow - 600, 0, 0, "")
    insMail.run(rookie, "grant", "Reward paid", "Silver Snowflake is yours.", lvNow - 300, 0, 0, '{"ref":"ornament:3"}')
    const secretBody = "Only the stranger may read this sentence"
    insMail.run(stranger, "admin", "Stranger's secret", secretBody, lvNow - 100, 0, 0, "")
    const strangerId = Number(pDb.raw.prepare("SELECT MAX(id) AS id FROM winter_mail").get().id)

    const lget = async (path) => {
      const res = await fetch(levelPanel.base + path)
      return { status: res.status, body: await res.text() }
    }
    const strip = t => t.replace(/<script[\s\S]*?<\/script>/g, "")
    // Raw HTML is not readable prose: "Level" and "1" live in different tags, and
    // an apostrophe is escaped. Assertions against a page go through this.
    const text = t => t
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&middot;/g, "\u00b7").replace(/&rsaquo;/g, ">").replace(/&lsaquo;/g, "<")
      .replace(/&check;/g, "v").replace(/&rarr;/g, "->").replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ")

    const lv1 = await lget("/levels?steamid=" + encodeURIComponent(rookie))
    check("levels route: /levels answers 200", lv1.status === 200, "-> " + lv1.status)
    const lv1Text = text(lv1.body)
    check("levels page: a level-1 player shows Level 1, 0/2,816 and 0%, with no NaN",
      lv1Text.includes("Level 1 of 19") && lv1Text.includes("0 / 2,816") &&
      lv1Text.includes("0% of the way") && !lv1Text.includes("NaN"), lv1Text.slice(0, 0))
    check("levels page: the curve is the real table (first and last rung)",
      lv1.body.includes("Unranked") && lv1.body.includes("Global Elite") && lv1.body.includes("30,000 XP"))
    check("levels page: the next reward is named",
      text(lv1.body).includes("Next reward at level 2 : 75 GingerBread"), "")
    check("levels page: the next three milestones are listed",
      lv1.body.includes("The next three milestones") && lv1.body.includes("3,730 XP") &&
      lv1.body.includes("4,207 XP"))
    check("levels page: a coming reward is tagged coming",
      /class="wf-tag coming">coming</.test(lv1.body) && lv1.body.includes("spin token"))
    check("levels page: nothing on it is claimable (no form, no claim link)",
      !/<form/i.test(lv1.body) && !/<button/i.test(lv1.body) && !/href="[^"]*claim/i.test(lv1.body))
    check("levels page: it says Phase 1 is informational",
      /Informational in Phase 1/i.test(lv1Text) && /nothing on this page is claimable/i.test(lv1Text))
    check("levels page: rank level and Battle Pass tier are labelled as different tracks",
      /not this level/i.test(lv1.body) && lv1.body.includes("bp_xp"))
    check("levels page: the sidebar carries PROGRESSION > Levels",
      lv1.body.includes(">Progression<") && /class="on"[^>]*href="[^"]*\/levels/.test(lv1.body.replace(/\n/g, "")) ||
      (lv1.body.includes("Progression") && lv1.body.includes('href="/levels')))
    check("levels page: the top bar carries the envelope", lv1.body.includes("wf-env") && lv1.body.includes("/mail"))
    check("levels page: the envelope shows the unread dot when there is unread mail",
      lv1.body.includes('class="dot wf-dot"') && /class="wf-count">2</.test(lv1.body))
    // lifetimeBoard() only lists players with XP > 0, so the rookie is correctly
    // absent from the board while the veteran, at 12,013 XP, is on it.
    const boardText = lv1Text.slice(lv1Text.indexOf("Leaderboard"))
    check("levels page: the leaderboard is the existing lifetime board, top 10",
      lv1Text.includes("Leaderboard") && boardText.includes("Veteran Two") &&
      boardText.includes("Lv 14") && !boardText.includes("Rookie One"), boardText.slice(0, 120))
    const lvVet = await lget("/levels?steamid=" + encodeURIComponent(veteran))
    const lvVetText = text(lvVet.body)
    check("levels page: a mid-ladder player reads its own rung",
      lvVetText.includes("Level 14 of 19") && lvVetText.includes("12,013") &&
      lvVetText.includes("Master Guardian Elite") && !lvVetText.includes("NaN"))
    const lvNone = await lget("/levels")
    const lvNoneText = text(lvNone.body)
    check("levels page: with no steamid it renders the zero state and still shows the curve",
      lvNone.status === 200 && lvNoneText.includes("No player selected") &&
      lvNoneText.includes("Global Elite") && !lvNoneText.includes("NaN"))
    const lvUnknown = await lget("/levels?steamid=" + encodeURIComponent("STEAM_0:0:899999"))
    check("levels page: an unknown player says there is no snapshot, it does not invent one",
      lvUnknown.status === 200 && /no server snapshot/i.test(lvUnknown.body))

    // With the catalogue pushed, the reward table resolves ids to real names
    // (the cross-reference the brief asks for) instead of falling back to ids.
    const catPushLv = await push(levelPanel, { players: [], catalogs: { winterfest: winterCatalogue() } })
    check("levels page: the catalogue can be pushed while the panel runs", catPushLv.status === 200, "-> " + catPushLv.status)
    const lvCatPage = text((await lget("/levels?steamid=" + encodeURIComponent(rookie))).body)
    // Ornament ids resolve to the fixture's names; set 6 is not in the fixture, so
    // that reward must fall back to its set id instead of inventing a title.
    check("levels page: ornament rewards resolve through the catalogue",
      lvCatPage.includes("Silver Snowflake") && lvCatPage.includes("Brass Bell") &&
      !lvCatPage.includes("Ornament #3"))
    check("levels page: a title whose set is not in the catalogue falls back to the set id",
      lvCatPage.includes("the title of ornament set #6"))

    const mailEmpty = await lget("/mail?steamid=" + encodeURIComponent(veteran))
    check("mail route: /mail answers 200", mailEmpty.status === 200, "-> " + mailEmpty.status)
    check("mail page: an empty inbox says so and has no red dot",
      text(mailEmpty.body).includes("No messages yet") && !mailEmpty.body.includes('class="dot wf-dot"'), "")
    const mailRookie = await lget("/mail?steamid=" + encodeURIComponent(rookie))
    check("mail page: unread count is in the top bar and the sidebar",
      /class="wf-count">2</.test(mailRookie.body) && /class="pill">2</.test(mailRookie.body))
    check("mail page: the red dot is there when something is unread",
      mailRookie.body.includes('class="dot wf-dot"'))
    check("mail page: the messages are listed newest first",
      mailRookie.body.indexOf("Reward paid") < mailRookie.body.indexOf("Welcome to Winterfest"))
    check("mail page: the panel offers no mark-as-read write",
      !/<form/i.test(mailRookie.body) && !/method="post"/i.test(mailRookie.body) &&
      /no player login|read-only/i.test(mailRookie.body))
    const mailView = await lget("/mail?steamid=" + encodeURIComponent(rookie) + "&id=" + strangerId)
    check("mail page: another player's message id is a 404 and leaks nothing",
      mailView.status === 404 && !mailView.body.includes(secretBody) &&
      !mailView.body.includes("Stranger") && !mailView.body.includes("secret"), "-> " + mailView.status)
    // The title is escaped on the page (&#39;), which is what makes it safe to render.
    const strangerInbox = await lget("/mail?steamid=" + encodeURIComponent(stranger))
    check("mail page: the stranger's own inbox shows that message",
      strangerInbox.body.includes("Stranger&#39;s secret") &&
      text(strangerInbox.body).includes("Stranger's secret"), "")
    check("mail page: a stranger's mail never appears in another player's inbox",
      !mailRookie.body.includes("Stranger") && !mailRookie.body.includes(secretBody))
    const ownId = Number(pDb.raw.prepare("SELECT id FROM winter_mail WHERE steamid=?1 ORDER BY id DESC LIMIT 1").get(rookie).id)
    const mailOwn = await lget("/mail?steamid=" + encodeURIComponent(rookie) + "&id=" + ownId)
    check("mail page: its own message opens with its body",
      mailOwn.status === 200 && mailOwn.body.includes("Silver Snowflake is yours"))
    check("mail page: an unread message tells the player to mark it read in game",
      mailOwn.status === 200 && /marked read in game/i.test(mailOwn.body) && mailOwn.body.includes("/mail"))
    check("mail page: an expired message is gone rather than shown",
      (await lget("/mail?steamid=" + encodeURIComponent(rookie) + "&id=999999")).status === 404)
    const postMail = await fetch(levelPanel.base + "/mail", { method: "POST", body: "steamid=" + encodeURIComponent(rookie) })
    check("mail route: there is no POST route (no unauthenticated write path)", postMail.status === 405,
      "-> " + postMail.status)
    const postLevels = await fetch(levelPanel.base + "/levels", { method: "POST", body: "level=19" })
    check("levels route: there is no POST route either", postLevels.status === 405, "-> " + postLevels.status)
    const compactMail = await lget("/mail?steamid=" + encodeURIComponent(rookie) + "&compact=1")
    check("mail page: the compact/MOTD skin draws no SVG and no script",
      compactMail.status === 200 && !compactMail.body.includes("<svg") &&
      compactMail.body.includes("MAIL ("), "")
    check("both routes keep the skin wrapper working (http 200 on /rules while the season is on)",
      (await lget("/levels?compact=1")).status === 200)

    // ---- 14h. the admin broadcast (existing admin session + CSRF) ---------
    const noSession = await fetch(levelPanel.base + "/admin?s=mail", { redirect: "manual" })
    const noSessionBody = await noSession.text()
    check("admin mail: the section is behind the staff login",
      noSession.status === 302 || /Sign in|password/i.test(noSessionBody), "-> " + noSession.status)
    const loginRes = await fetch(levelPanel.base + "/admin/login", {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "steamid=STEAM_0%3A0%3A683671116&password=" + encodeURIComponent(ADMIN),
    })
    const cookies = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [])
      .map(c => c.split(";")[0]).join("; ")
    check("admin mail: staff login sets a session cookie", loginRes.status === 302 && cookies.includes("fn_staff"),
      "-> " + loginRes.status)
    const admMail = await fetch(levelPanel.base + "/admin?s=mail", { headers: { cookie: cookies } })
    const admMailBody = await admMail.text()
    check("admin mail: /admin?s=mail renders the send form",
      admMail.status === 200 && admMailBody.includes("Send a message") && admMailBody.includes("Last 20 messages"),
      "-> " + admMail.status)
    check("admin mail: the sidebar has a Mail item", admMailBody.includes('href="/admin?s=mail"'))
    const csrf = (admMailBody.match(/name="csrf" value="([a-f0-9]+)"/) || [])[1] || ""
    check("admin mail: the form carries the session CSRF token", csrf.length >= 16, csrf.slice(0, 8))
    const noCsrf = await fetch(levelPanel.base + "/admin/mail", {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
      body: "target=*&title=No%20csrf&body=x",
    })
    check("admin mail: a POST without the CSRF token is refused", noCsrf.status === 403, "-> " + noCsrf.status)
    const badDays = await fetch(levelPanel.base + "/admin/mail", {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
      body: "csrf=" + encodeURIComponent(csrf) + "&target=*&kind=admin&title=x&body=y&expires_days=999",
    })
    const badDaysBody = await badDays.text()
    check("admin mail: an impossible expiry is refused with a message",
      badDays.status === 200 && /Expiry must be a whole number of days/.test(badDaysBody), "-> " + badDays.status)
    const sent = await fetch(levelPanel.base + "/admin/mail", {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
      body: "csrf=" + encodeURIComponent(csrf) + "&target=*&kind=event&title=" +
        encodeURIComponent("Christmas event tonight") + "&body=" + encodeURIComponent("Double XP from 20:00.") +
        "&expires_days=7",
    })
    check("admin mail: a valid broadcast redirects back to the section", sent.status === 302, "-> " + sent.status)
    const broadcast = pDb.raw.prepare("SELECT steamid, kind, title, expires_at FROM winter_mail WHERE title='Christmas event tonight'").all()
    check("admin mail: the broadcast fans out one row per known player",
      broadcast.length === 2 && broadcast.every(r => r.kind === "event" && Number(r.expires_at) > lvNow),
      JSON.stringify(broadcast.map(r => r.steamid)))
    check("admin mail: the audit log records the broadcast",
      !!levelPanel.first("SELECT id FROM admin_audit WHERE action='MAIL_SENT' LIMIT 1"))
    check("mail page: the broadcast reached the player's inbox",
      (await lget("/mail?steamid=" + encodeURIComponent(veteran))).body.includes("Christmas event tonight"))
    pDb.raw.close()
    await levelPanel.stop()
  }

} catch (e) {
  bad("suite", e && e.stack ? e.stack : String(e))
  console.error("--- panel output ---\n" + panel.output.split("\n").slice(-25).join("\n"))
  console.error("--- trusted output ---\n" + trusted.output.split("\n").slice(-25).join("\n"))
  try { console.error("--- winter output ---\n" + winterPanel.output.split("\n").slice(-25).join("\n")) } catch {}
} finally {
  await panel.stop()
  await trusted.stop()
  await limited.stop()
  try { await winterPanel.stop() } catch {}
  try { await levelPanel.stop() } catch {}
  await wait(200)
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}

// ===================================================================== //
// 10. the Spin Wheel (workstream 13, docs/WINTERFEST-SPIN.md)            //
// ===================================================================== //
// The wheel is DATA, so it is checked against the data: the rows below are read
// from configs/freenova/winterfest/spin.ini ON DISK and compared with
// src/winter/spin_data.js, which is what the page renders from. If those two
// ever drift, the panel advertises odds the game does not roll - the one thing
// this page must never do.
//
// The page is a VIEWER (it cannot spend a token: there is no game-side consumer
// for a panel action), so the checks also prove the absence of a write path and
// the honesty of the zero state, then create the two mirror columns/tables the
// page already knows how to read and prove they light it up.
{
  const spinPanel = new Panel("spin", { FN_LOCAL_TRUST: "1" })
  const spinRoot = mkdtempSync(join(tmpdir(), "freenova-spin-test-"))
  spinPanel.dbFile = join(spinRoot, "spin.sq3")
  const { readFileSync } = await import("node:fs")
  const {
    SPIN_SECTORS, SPIN_WHEEL, SPIN_RARITIES, spinOdds, spinTotalWeight,
    rarityWeight, prizeText, nextResetAt,
  } = await import("./src/winter/spin_data.js")

  try {
    await spinPanel.start(18084)

    const sid = "STEAM_0:0:777001"
    const sget = async (path, headers) => {
      const res = await fetch(spinPanel.base + path, { headers: headers || {} })
      return { status: res.status, body: await res.text() }
    }
    const noScriptBody = t => t.replace(/<script[\s\S]*?<\/script>/g, "")
    const route = "/winter/spin?steamid=" + encodeURIComponent(sid)

    // ---- 10a. the page's wheel IS the game's wheel -----------------------
    const iniText = readFileSync(join(here, "..", "game-server", "cstrike", "addons", "amxmodx",
      "configs", "freenova", "winterfest", "spin.ini"), "utf8")
    const iniWheel = {}
    const iniSectors = []
    let iniSection = ""
    for (const rawLine of iniText.split("\n")) {
      const line = rawLine.trim()
      if (!line || line[0] === ";" || line[0] === "#" || line.startsWith("//")) continue
      if (line[0] === "[") { iniSection = line.slice(1, line.indexOf("]")).trim().toLowerCase(); continue }
      if (iniSection === "wheel") {
        const eq = line.indexOf("=")
        if (eq > 0) iniWheel[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
      } else if (iniSection === "sector") {
        const f = line.split("|").map(x => x.trim())
        iniSectors.push({ label: f[0], kind: f[1], amount: Number(f[2]), weight: Number(f[3]), rarity: f[4] })
      }
    }
    check("spin: spin.ini has 8..12 sectors (the brief's range)",
      iniSectors.length >= 8 && iniSectors.length <= 12, String(iniSectors.length))
    check("spin: the page's sectors are spin.ini's sectors, row for row",
      JSON.stringify(iniSectors) === JSON.stringify(SPIN_SECTORS.map(s => ({
        label: s.label, kind: s.kind, amount: s.amount, weight: s.weight, rarity: s.rarity,
      }))),
      JSON.stringify(iniSectors.map(s => s.label)))
    check("spin: the page's wheel settings are spin.ini's [wheel] block",
      Number(iniWheel.free_per_day) === SPIN_WHEEL.freePerDay &&
      Number(iniWheel.reset_hour) === SPIN_WHEEL.resetHour &&
      Number(iniWheel.max) === SPIN_WHEEL.max &&
      Number(iniWheel.step) === SPIN_WHEEL.stepSeconds &&
      iniWheel.timezone === SPIN_WHEEL.timezone &&
      iniWheel.fade_rarity === SPIN_WHEEL.fadeRarity &&
      Number(iniWheel.enabled) === (SPIN_WHEEL.enabled ? 1 : 0),
      JSON.stringify(iniWheel))
    check("spin: every weight is >= 2 and the odds add up to 100 %",
      SPIN_SECTORS.every(s => s.weight >= 2) &&
      Math.abs(spinOdds().reduce((a, s) => a + s.pct, 0) - 100) < 1e-9,
      JSON.stringify({ total: spinTotalWeight(), rare: rarityWeight(SPIN_WHEEL.fadeRarity).pct.toFixed(1) }))
    check("spin: the fade threshold is worth what the ini header claims (5 %)",
      Math.abs(rarityWeight("rare").pct - 5) < 1e-9, String(rarityWeight("rare").pct))

    // ---- 10b. the page, with no mirror at all (the shipped deployment) ---
    const bare = await sget(route)
    check("spin: /winter/spin answers 200", bare.status === 200, "-> " + bare.status)
    check("spin: it is the reference palette (page, card, border, gold, green)",
      ["#0b1030", "#0d1430", "#2a3d6e", "#f5c451", "#3fbf6f"].every(c => bare.body.includes(c)))
    check("spin: the wheel is inline SVG, one slice per sector",
      bare.body.includes("<svg") && bare.body.includes('viewBox="0 0 480 480"') &&
      (bare.body.match(/<path d="M240 240/g) || []).length === SPIN_SECTORS.length,
      String((bare.body.match(/<path d="M240 240/g) || []).length))
    check("spin: every sector is labelled on the page",
      SPIN_SECTORS.every(s => bare.body.includes(s.label)),
      SPIN_SECTORS.filter(s => !bare.body.includes(s.label)).map(s => s.label).join(","))
    check("spin: the prize table shows the configured odds as percentages",
      spinOdds().every(s => bare.body.includes(`${s.pctText}%`)),
      spinOdds().map(s => s.pctText + "%").join(" "))
    check("spin: the table says what each prize actually is",
      bare.body.includes(prizeText({}, { kind: "gingerbread", amount: 5 })) &&
      bare.body.includes("a random ornament you do not own yet") &&
      bare.body.includes("common present") && bare.body.includes("rare present"))
    check("spin: no NaN and no undefined outside the enhancement script",
      !noScriptBody(bare.body).includes("NaN") && !noScriptBody(bare.body).includes("undefined"))
    check("spin: READ-ONLY - the page has no form, no button and no POST",
      !/<form/i.test(bare.body) && !/<button/i.test(bare.body) && !/method=["']?post/i.test(bare.body))
    check("spin: it says where a spin actually happens",
      bare.body.includes("spins happen in game") && bare.body.includes("<code>/spin</code>"))
    check("spin: with no pushed counter it says 'not mirrored' instead of printing a 0",
      bare.body.includes("not mirrored") && bare.body.includes("winter_players.spins"))
    check("spin: the zero state names what is missing, not a fake result row",
      bare.body.includes("winter_spin_log") && !bare.body.includes("No results to show.</b> You have not spun"))
    check("spin: the daily reset is a <time> element the browser localises",
      /<time class="wf-time" datetime="\d{4}-\d{2}-\d{2}T/.test(bare.body) &&
      bare.body.includes("Europe/Paris") && bare.body.includes("1 free spin a day"))
    check("spin: the rare+ chip matches the configured rare-or-better weight",
      bare.body.includes(`${rarityWeight(SPIN_WHEEL.fadeRarity).pct.toFixed(1)}%`))
    check("spin: the shared tab bar is there and no tab claims to be current",
      bare.body.includes("wf-tabs") && !/<span class="on">Spin/.test(bare.body))
    check("spin: no route of its own under the page is invented",
      (await sget("/winter/spin/anything")).status === 404)
    check("spin: a page with no player selected still answers, with the standard note",
      (await fetch(spinPanel.base + "/winter/spin")).status === 200)

    // The GoldSrc MOTD browser cannot render SVG and must not get a script.
    const motd = await sget(route + "&compact=1", { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" })
    check("spin: the compact skin drops the SVG for a text wheel",
      motd.status === 200 && !motd.body.includes("<svg") && motd.body.includes("drawn in a browser"),
      "-> " + motd.status)
    check("spin: the compact skin keeps every sector and its odds",
      SPIN_SECTORS.every(s => motd.body.includes(s.label)) &&
      spinOdds().every(s => motd.body.includes(`${s.pctText}%`)))
    check("spin: the compact skin ships no script at all", !motd.body.includes("<script"))

    // ---- 10c. the mirror: the columns/tables the game will push ----------
    // THIS IS THE DDL docs/WINTERFEST-SPIN.md §6 asks workstream 5 (and 1) for.
    // Creating it here is the proof that the read path works the day it lands.
    const db = openLocalD1(spinPanel.dbFile)
    await ensureWinterTables({ DB: db })
    db.raw.prepare("ALTER TABLE winter_players ADD COLUMN spins INTEGER NOT NULL DEFAULT 0").run()
    db.raw.prepare("ALTER TABLE winter_players ADD COLUMN spin_serial INTEGER NOT NULL DEFAULT 0").run()
    db.raw.prepare(`CREATE TABLE IF NOT EXISTS winter_spin_log (
        steamid TEXT NOT NULL, season TEXT NOT NULL DEFAULT '',
        serial INTEGER NOT NULL, sector INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL DEFAULT 0, rarity TEXT NOT NULL DEFAULT '',
        claim_key TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (steamid, serial))`).run()
    const t0 = Math.floor(Date.now() / 1000)
    db.raw.prepare("INSERT INTO winter_players (steamid, season, snowflakes, spins, spin_serial, seen_at) VALUES (?1,'2026',145,3,2,?2)")
      .run(sid, t0)
    db.raw.prepare("INSERT INTO winter_spin_log (steamid, season, serial, sector, label, kind, amount, rarity, claim_key, at) VALUES (?1,'2026',1,2,'5 GingerBread','gingerbread',5,'common','wfspin#1',?2)")
      .run(sid, t0 - 120)
    db.raw.prepare("INSERT INTO winter_spin_log (steamid, season, serial, sector, label, kind, amount, rarity, claim_key, at) VALUES (?1,'2026',2,10,'Rare Present','gift',2,'rare','wfspin#2',?2)")
      .run(sid, t0 - 60)
    db.raw.close()

    const lit = await sget(route)
    check("spin mirror: the counter is shown once the game pushes it",
      lit.body.includes("Your spins") && /class="wfs-v gold">3/.test(lit.body), "")
    check("spin: the counter is shown against the configured cap", lit.body.includes("/ 10"))
    // The sector labels also appear on the wheel and in the prize table, so the
    // order has to be read inside the results card only.
    const resultsCard = (lit.body.split("Your last")[1] || "").split("How a spin works")[0]
    check("spin mirror: both results are listed, newest first",
      resultsCard.includes("Rare Present") && resultsCard.includes("5 GingerBread") &&
      resultsCard.indexOf("Rare Present") < resultsCard.indexOf("5 GingerBread"),
      resultsCard.slice(0, 120))
    check("spin mirror: a result carries a real timestamp the browser localises",
      (lit.body.match(/<time class="wf-time" datetime=/g) || []).length >= 2)
    check("spin mirror: the claim key is NOT published",
      !lit.body.includes("wfspin#"), "the ledger key is server-side only")
    check("spin mirror: 'not mirrored' is gone once the number is real",
      !lit.body.includes("not mirrored"))
    check("spin mirror: an unknown rarity or kind cannot break the page", await (async () => {
      const d2 = openLocalD1(spinPanel.dbFile)
      d2.raw.prepare("INSERT INTO winter_spin_log (steamid, season, serial, sector, label, kind, amount, rarity, claim_key, at) VALUES (?1,'2026',3,99,'','weird',0,'mythic','wfspin#3',?2)")
        .run(sid, t0 - 30)
      d2.raw.close()
      const r = await sget(route)
      return r.status === 200 && r.body.includes("mythic")
    })(), "")
    check("spin mirror: a label from the game is escaped, never markup", await (async () => {
      const d3 = openLocalD1(spinPanel.dbFile)
      d3.raw.prepare("INSERT INTO winter_spin_log (steamid, season, serial, sector, label, kind, amount, rarity, claim_key, at) VALUES (?1,'2026',4,1,'<script>alert(1)</script>','nothing',0,'common','wfspin#4',?2)")
        .run(sid, t0 - 10)
      d3.raw.close()
      const r = await sget(route)
      return r.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !r.body.includes("<script>alert(1)</script>")
    })(), "")

    // ---- 10d. the reset arithmetic the page prints -----------------------
    const nowSpin = Math.floor(Date.now() / 1000)
    const nextReset = nextResetAt(nowSpin, SPIN_WHEEL.resetHour, parisMidnight, parisParts)
    check("spin: the next reset is in the future and within a day",
      nextReset > nowSpin && nextReset - nowSpin <= 26 * 3600,
      `${nextReset - nowSpin}s`)
    check("spin: the reset instant is Paris midnight when the hour is 0",
      nextReset === parisMidnight(parisParts(nextReset).y, parisParts(nextReset).m, parisParts(nextReset).d),
      String(nextReset))
    check("spin: the rarity colours are the reference palette",
      SPIN_RARITIES.common.color === "#9fb0d0" && SPIN_RARITIES.uncommon.color === "#3fbf6f" &&
      SPIN_RARITIES.rare.color === "#4070c0" && SPIN_RARITIES.legendary.color === "#f5c451")
  } catch (e) {
    bad("spin suite", e && e.stack ? e.stack : String(e))
    try { console.error("--- spin panel output ---\n" + spinPanel.output.split("\n").slice(-20).join("\n")) } catch {}
  } finally {
    try { await spinPanel.stop() } catch {}
    try { rmSync(spinRoot, { recursive: true, force: true }) } catch {}
  }
}

if (failures) {
  console.error(`\nFAILURES: ${failures} (passed ${passed})`)
  process.exitCode = 1
} else {
  console.log(`PASS panel test suite (${passed} checks)`)
}
