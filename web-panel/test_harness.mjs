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
import { mkdtempSync, rmSync } from "node:fs"
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

const routes = ["/hub", "/profile", "/bp", "/battlepass", "/missions", "/achievements",
  "/competitive", "/events", "/vip", "/shop", "/skins", "/models", "/cosmetics",
  "/settings", "/rules", "/top15", "/admin"]

// =================================================================== main ==
const panel = new Panel("main")
const trusted = new Panel("trusted", { FN_LOCAL_TRUST: "1" })

try {
  await panel.start(18080)
  await trusted.start(18081)

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
} catch (e) {
  bad("suite", e && e.stack ? e.stack : String(e))
  console.error("--- panel output ---\n" + panel.output.split("\n").slice(-25).join("\n"))
  console.error("--- trusted output ---\n" + trusted.output.split("\n").slice(-25).join("\n"))
} finally {
  await panel.stop()
  await trusted.stop()
  await wait(200)
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}

if (failures) {
  console.error(`\nFAILURES: ${failures} (passed ${passed})`)
  process.exitCode = 1
} else {
  console.log(`PASS panel test suite (${passed} checks)`)
}
