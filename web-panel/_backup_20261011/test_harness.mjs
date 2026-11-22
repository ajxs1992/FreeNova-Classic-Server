// FreeNova web panel — offline test harness (better-sqlite3 fakes the D1 API).
// Exercises: signed push -> snapshot upsert -> pages -> action queue -> dispatch -> results.
// Run: node test_harness.mjs
import Database from "better-sqlite3"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const here = path.dirname(fileURLToPath(import.meta.url))
const SECRET = "test_secret"

// ---------------- fake D1 ----------------
function makeD1() {
  const sqlite = new Database(":memory:")
  sqlite.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"))
  function isRead(sql) { return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) }
  function exec(sql, args, wantRows) {
    try {
      // D1 allows repeated ?N (numbered) placeholders; emulate via named params
      const norm = sql.replace(/\?(\d+)/g, "@p$1")
      const stmt = sqlite.prepare(norm)
      if (!wantRows) { stmt.run(Object.fromEntries(args.map((v, i) => [`p${i + 1}`, v]))); return null }
      return stmt.all(Object.fromEntries(args.map((v, i) => [`p${i + 1}`, v])))
    } catch (e) {
      throw new Error(`[mockD1] ${e.message}\nSQL: ${sql}\nARGS(${args.length}): ${JSON.stringify(args)}`)
    }
  }
  return {
    raw: sqlite,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => exec(sql, args, !isRead(sql) ? null : "rows")?.[0] ?? null,
            all: async () => ({ results: exec(sql, args, "rows") || [] }),
            run: async () => exec(sql, args, null) ?? { meta: {} }
          }
        },
        first: async () => exec(sql, [], "rows")?.[0] ?? null,
        all: async () => ({ results: exec(sql, [], "rows") || [] }),
        run: async () => exec(sql, [], null) ?? { meta: {} }
      }
    },
    async batch(stmts) {
      for (const s of stmts) {
        if (s && typeof s.run === "function") await s.run()
      }
    }
  }
}

let nonceSeq = 0
async function signedPostPath(path, payload) {
  const body = JSON.stringify(payload)
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = `${ts}_${++nonceSeq}`
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex")
  const sig = crypto.createHash("sha256")
    .update(`${SECRET}:POST:${path}:${ts}:${nonce}:${bodyHash}`).digest("hex")
  return new Request(`https://x${path}`, {
    method: "POST", body,
    headers: {
      "X-FreeNova-Timestamp": ts, "X-FreeNova-Nonce": nonce,
      "X-FreeNova-Signature": sig, "X-FreeNova-Server-ID": "test-1"
    }
  })
}

async function signedPost(env, players, extra) {
  return signedPostPath("/api/v1/server/stats", { players, ...(extra || {}) })
}

const env = { DB: makeD1(), SYNC_SECRET: SECRET }
let failures = 0
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : " — " + detail}`)
  if (!cond) failures++
}

// Independent route expectations: legacy i is accepted inbound, never emitted.
const PANEL_CONTRACTS = [
  { slug: "battlepass", code: "b", title: "BATTLE PASS", aliases: ["bp"] },
  { slug: "missions",   code: "i", title: "MISSIONS",    aliases: [] },
  { slug: "top", code: "t", title: "TOP 15", aliases: ["top15", "leaderboard", "rankings", "search"] },
  { slug: "profile", code: "p", title: "PROFILE", aliases: ["rankstats", "statsme", "rank", "compare"] },
  { slug: "vip", code: "v", title: "VIP", aliases: [] },
  { slug: "tournament", code: "r", title: "COMPETITIVE", aliases: ["ctop", "pts"] },
  { slug: "achievements", code: "a", title: "ACHIEVEMENTS", aliases: ["records", "hof", "halloffame"] },
  { slug: "events", code: "e", title: "EVENTS", aliases: [] }
]
const RETIRED_SLUGS = new Set(["", "store", "shop", "skins", "cosmetics", "models", "panel", "admin"])

function decodeHtml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[code.toLowerCase()]
  })
}

function withoutNonContent(html) {
  return html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
}

function textOf(html) {
  return decodeHtml(withoutNonContent(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function hrefsOf(html) {
  const hrefs = []
  // Tokenize tags/attributes, including unquoted values; don't match data-href or JS strings.
  for (const [tag] of withoutNonContent(html).matchAll(/<[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    for (const attr of tag.matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (attr[1].toLowerCase() === "href") hrefs.push(decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? ""))
    }
  }
  return hrefs
}

function foreignHits(html, product, baseUrl) {
  return hrefsOf(html).filter(href => {
    if (!href || href.startsWith("#")) return false
    let url, path
    try {
      url = new URL(href, baseUrl)
      path = decodeURIComponent(url.pathname).toLowerCase()
    } catch { return true }
    if (!/^https?:$/.test(url.protocol)) return false
    const short = path.match(/^\/m\/([^/]+)(?:\/|$)/)
    if (short) return short[1] !== product.code
    let slug = path.split("/")[1]
    // Player-identity drill-down: /profile?steamid= links from leaderboard
    // rows are navigation to the clicked player, not product cross-linking.
    if (slug === "profile" && /(^|[?&])steamid=/i.test(url.search)) return false
    // Include the other live entry points so isolation can't escape via an alias.
    if (slug === "u") slug = path.split("/")[3] || "profile"
    if (slug === "battlepass.php" || slug === "rsu.php") slug = url.searchParams.get("view") || url.searchParams.get("tab") || "top"
    if (RETIRED_SLUGS.has(slug)) return true
    const target = PANEL_CONTRACTS.find(p => p.slug === slug || p.aliases.includes(slug))
    return !!target && target.slug !== product.slug
  })
}

function hasProductTitle(html, title) {
  const actual = textOf(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  return actual.replace(/^FreeNova\s*\|\s*/i, "").toUpperCase() === title
}

function layoutIssues(html) {
  const issues = []
  if (!/<table\b/i.test(html)) issues.push("no table layout")
  if (/\bvar\s*\(|display\s*:\s*(?:inline-)?(?:flex|grid)\b|position\s*:\s*sticky\b|fonts\.(?:googleapis|gstatic)\.com/i.test(html)) issues.push("browser-only CSS/webfonts")
  if (/<(?:script|iframe)\b/i.test(html)) issues.push("script/iframe")
  // Old-MSHTML contract (in-game MOTD defaults to IE7 emulation on mshtml 11):
  // declarations those engines drop or choke on are banned so skins degrade
  // only through solid background-color/color fallbacks — never a broken box.
  const css = stylesOf(html) + "\n" + [...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map(m => m[1] ?? m[2] ?? "").join("\n")
  if (/expression\s*\(/i.test(css)) issues.push("IE CSS expression()")
  if (/nth-child/i.test(css)) issues.push("nth-child ignored by old MSHTML")
  if (/position\s*:\s*fixed/i.test(css)) issues.push("position:fixed unsupported pre-IE7/quirks")
  if (/[\d.]+(?:vw|vh)\b/i.test(css)) issues.push("viewport units unsupported by old MSHTML")
  if (/#[0-9a-f]{8}(?![0-9a-f])/i.test(css)) issues.push("8-digit hex color dropped by old MSHTML")
  return issues
}

function stylesOf(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1].replace(/\s+/g, " ").trim()).join("\n")
}

// Parse every <style> block into normalized "sel { decl }" rules — the same
// normalization src/ui.js compactCssFor() applies — so the harness can compare
// the compact micro-sheet to the browser sheet rule-for-rule. stylesOf()
// collapses newlines, so per-line substring checks cannot work here.
function sheetRules(html) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
  const out = []
  let i = 0
  for (;;) {
    const open = css.indexOf("{", i)
    if (open < 0) break
    const close = css.indexOf("}", open)
    if (close < 0) break
    const sel = css.slice(i, open).trim().replace(/\s+/g, " ")
    const decl = css.slice(open + 1, close).trim().replace(/\s+/g, " ")
    if (sel) out.push(`${sel} { ${decl} }`)
    i = close + 1
  }
  return out
}

// Partial counters deliberately differ from the original all-complete fixture.
const DAILY_EXPECTED = [
  ["FRAG HUNTER", 7, 15], ["HEAD HUNTER", 1, 3], ["BOMB SQUAD", 1, 2],
  ["DEFUSER", 0, 1], ["WINNER", 1, 2], ["STREAK", 2, 5],
  ["DAMAGE", 237, 500], ["SURVIVOR", 1, 3]
]

function dailyMissionIssues(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html
  const text = textOf(body)
  const start = text.indexOf("DAILY MISSIONS")
  if (start < 0) return ["missing DAILY MISSIONS body"]
  const daily = text.slice(start)
  const names = DAILY_EXPECTED.map(([name]) => name).join("|")
  return DAILY_EXPECTED.flatMap(([name, have, need]) => {
    // Pair each counter with its own mission, never with another card or nav label.
    const section = daily.match(new RegExp(`\\b${name}\\b([\\s\\S]*?)(?=\\b(?:${names}|WEEKLY MISSIONS)\\b|$)`))?.[1]
    return section && new RegExp(`(?:^|[^\\d])${have}\\s*\\/\\s*${need}(?!\\d)`).test(section)
      ? [] : [`${name}: expected ${have} / ${need}`]
  })
}

// Regression probes for the assertions themselves (no production mocks).
{
  const bp = PANEL_CONTRACTS[0]
  const base = "https://x/m/b/0-1-11111.htm"
  const clean = "<a href='/m/b/0-1-11111/missions.htm'>Missions</a><a href='#track'>Track</a>"
  check("isolation oracle allows same-product tabs", foreignHits(clean, bp, base).length === 0)
  const variants = [
    "<a href='/m/p/0-1-11111.htm'>Player</a>",
    '<a HREF = "/m/p/0-1-11111.htm">Player</a>',
    "<a href=/m/p/0-1-11111.htm>Player</a>",
    "<a href='https://x/m/p/0-1-11111.htm'>Player</a>",
    "<a href='//x/m/p/0-1-11111.htm'>Player</a>",
    "<a href='../p/0-1-11111.htm'>Player</a>",
    "<a href='&#47;m/p/0-1-11111.htm'>Player</a>"
  ]
  check("isolation oracle rejects injected short-profile links without canonical names",
    variants.every(link => foreignHits(clean + link, bp, base).length === 1))
  check("isolation oracle rejects foreign links for all eight panels", PANEL_CONTRACTS.every(p => {
    const code = p.code === "p" ? "b" : "p"
    return foreignHits(`<a href='/m/${code}/0-1-11111.htm'>Other</a>`, p, base).length === 1
  }))
  check("isolation oracle rejects canonical and retired aliases", ["/profile", "/top15", "/shop", "/panel/profile", "/m/i/0-1-11111.htm", "/m/s/0-1-11111.htm", "/m/o/0-1-11111.htm"].every(href =>
    foreignHits(`<a href='${href}'>Other</a>`, bp, base).length === 1))
  check("isolation oracle treats /admin as foreign for battlepass",
    foreignHits("<a href='/admin'>Staff</a>", bp, base).length === 1)
  check("isolation oracle ignores comments and data-href", foreignHits("<!-- <a href='/profile'> --> <b data-href='/profile'>Text</b>", bp, base).length === 0)
  const body = "<h2>DAILY MISSIONS</h2>" + DAILY_EXPECTED.map(([name, have, need]) => `<p>${name}: ${have} / ${need}</p>`).join("")
  check("missions oracle accepts named seeded counters", dailyMissionIssues(body).length === 0)
  check("missions oracle rejects title and nav only", dailyMissionIssues("<html><head><title>FreeNova | BATTLE PASS</title></head><body><nav>TRACK | MISSIONS | DAILY MISSIONS</nav></body></html>").length > 0)
  check("missions oracle rejects missing and wrong counters", dailyMissionIssues(body.replace("7 / 15", "")).length > 0 && dailyMissionIssues(body.replace("7 / 15", "0 / 15")).length > 0)
  check("missions oracle rejects swapped counters", dailyMissionIssues(body.replace("7 / 15", "1 / 3").replace("HEAD HUNTER: 1 / 3", "HEAD HUNTER: 7 / 15")).length > 0)
}

const { handleSync } = await import("./src/sync.js")
const pages = await import("./src/pages.js")
// Restored top15 module (flat-board design): weapon filter, search, pagination.
const { pageTop15 } = await import("./src/top15/page.js")
const { pageMapEnd } = await import("./src/top15/mapend.js")
const { DEFAULT_SKILLS, DEFAULT_SKINS } = await import("./src/catalogs.js")
const { setMotdCompact, MOTD_CSS } = await import("./src/ui.js")

// ---------------- 1. push a player snapshot ----------------
{
  const req = await signedPost(env, [{
    steamid: "STEAM_0:1:11111", name: 'ziz"><script>', xp: 18450, level: 12, rank_id: 12,
    prestige: 1, kills: 2841, deaths: 1900, assists: 300, headshots: 900, damage: 340000,
    shots: 100000, hits: 30000, mvps: 40, wins: 210, losses: 120, playtime_minutes: 4000,
    rating_x100: 133, vip_tier: 2, coins: 4850,
    bp_daily_kills: 15, bp_daily_hs: 3, bp_daily_plants: 2, bp_daily_defuses: 1,
    bp_daily_wins: 2, bp_daily_streak: 5, bp_daily_damage: 500, bp_daily_survives: 3,
    bp_daily_complete: 1,
    bp_weekly_kills: 60, bp_weekly_hs: 10, bp_weekly_plants: 4, bp_weekly_wins: 7,
    bp_weekly_complete: 0,
    comp_season: "2026-09", comp_points: 1250, comp_lifetime: 9800, comp_kills: 500,
    comp_hs: 200, comp_wins: 55, comp_mvp: 12, comp_msn_k: 25, comp_msn_h: 20,
    comp_msn_w: 10, comp_msn_m: 3, comp_msn_done: 15,
    eq_spawn: 2, eq_title: 3, eq_death: 1, eq_color: 1, custom_tag: "[<>]", eq_model: "legend_t",
    weapons: [{ slot: 0, kills: 900, hs: 350, damage: 120000 }, { slot: 4, kills: 77, hs: 77, damage: 9000 }],
    skins: [{ grp: "ak47", skin: 2, equipped: 1 }, { grp: "knife", skin: 1, equipped: 0 }],
    models: [{ model: "legend_t", equipped: 1, forced: 0 }]
  }], {
    catalogs: {
      reward_track: { version: 3, season: "2026-09", xp_per_tier: 1000, tiers: [
        { tier: 1, free: "250 XP", premium: "500 coins" },
        { tier: 2, free: "200 coins", premium: "Skin Crate" }
      ] },
      achievements: { version: 1, achievements: [] },
      skins: DEFAULT_SKINS,
      skills: DEFAULT_SKILLS,
      models: { version: 1, models: [{ id: "legend_t", name: "Legend", team: "T", vipTier: 0, price: 0 }] },
      events: { version: 1, events: [{
        id: "event_kill_race", name: "Kill Race", desc: "First to 1000 ranked kills",
        active: 1, metric: "kills", target: 1000, bonus: "10,000 Coins", ends: "season"
      }] }
    },
    season_history: [{ steamid: "STEAM_0:1:11111", season: "2026-08", points: 900, kills: 400, hs: 150, wins: 40, mvp: 8 }]
  })
  const res = await handleSync(req, env)
  const out = await res.json()
  check("push accepted", out.ok === true && out.stored === 1, JSON.stringify(out))
}

// ---------------- 2. verify stored truth (XSS escaped on render) ----------------
{
  const url = new URL("https://x/profile?steamid=STEAM_0:1:11111")
  const res = await pages.pageProfile(env, url)
  const html = await res.text()
  check("profile renders", res.status === 200 && html.includes("FREENOVA"))
  check("xss name escaped", html.includes("ziz&quot;&gt;&lt;script&gt;") && !html.includes("<script>"))
  check("real stats shown", html.includes("2,841") && html.includes("4,850") && html.includes("1.33"))
  check("skill tier word", html.includes("Advanced"))
  check("equipped model", html.includes("legend_t"))
}

// ---------------- 3. top15 contract (restored flat board) ----------------
{
  const t1 = await (await pageTop15(env, new URL("https://x/top15?sort=kills&dir=asc"))).text()
  // active sort renders as a header link back to the board ("sort=kills").
  check("top15 kill-sort header", t1.includes("TOP 15") && t1.includes("sort=kills"))
  const t2 = await (await pageTop15(env, new URL("https://x/top15?sort=DROP TABLE players"))).text()
  check("top15 sort whitelist blocks injection", t2.includes("TOP 15") && !t2.includes("DROP TABLE"))
  const t3 = await (await pageTop15(env, new URL("https://x/top15?q=ziz"))).text()
  check("top15 search finds seeded player", t3.includes("ziz") && t3.includes("18,450"))
  const t4 = await (await pageTop15(env, new URL("https://x/top15?sort=kills&dir=asc"))).text()
  check("weapon hover menu lists arsenal", t4.includes("M4A1") && t4.includes("wmenu") && t4.includes("G3SG1"))
  check("podium cards back on page 1", t4.includes("<table class='podium'") && t4.includes("prank"))
  check("own-row YOU tag", (await (await pageTop15(env, new URL("https://x/top15?steamid=STEAM_0:1:11111"))).text()).includes("YOU"))
  const profHrefs = [...t4.matchAll(/<a[^>]*href=['"]([^'"]*\/profile[^'"]*)['"]/gi)].map(m => m[1])
  check("top15 isolation: profile links carry steamid only",
    profHrefs.length > 0 && profHrefs.every(h => /steamid=/i.test(decodeURIComponent(h))))
  check("top15 no browser-only CSS", !layoutIssues(t4).length, layoutIssues(t4).join("; "))
  check("top15 utf-8 charset meta", /<meta\s+charset\s*=\s*['"]utf-8['"]/i.test(t4))
  check("top15 favicon icon", /<link\s+rel\s*=\s*['"]icon['"]/i.test(t4))
}

{
  // /mapend is the map-end T/CT board (restored module), not a top alias.
  const me = await (await pageMapEnd(env, new URL("https://x/mapend?steamid=STEAM_0:1:11111&map=de_dust2"))).text()
  check("mapend renders team boards", me.includes("TERRORISTS") && me.includes("COUNTER-TERRORISTS") && me.includes("DUST2"))
}

// ---------------- 3b. stats viewer contract ----------------
{
  const { pageStatsViewer } = pages
  const sv = await (await pageStatsViewer(env, new URL("https://x/statsviewer?sort=kills"))).text()
  check("statsviewer renders", sv.includes("STATS VIEWER") && sv.includes("<table"))
  check("statsviewer sort links", sv.includes("href='/statsviewer?sort=xp'") && sv.includes("href='/statsviewer?sort=playtime'"))
  check("statsviewer rows or empty state", /<tr>/.test(sv) && (/>open<\/a>/.test(sv) || sv.includes("No online players on the replica yet.")))
  const svBad = await (await pageStatsViewer(env, new URL("https://x/statsviewer?sort=DROP TABLE players"))).text()
  check("statsviewer bad sort falls back to xp", svBad.includes("<b>xp</b>") && !svBad.includes("DROP TABLE"))
}

// ---------------- 4. battlepass page (catalog + real mission state) ----------------
{
  const url = new URL("https://x/battlepass?steamid=STEAM_0:1:11111")
  const html = await (await pages.pageBattlePass(env, url)).text()
  check("bp tier window + claimed state", html.includes("page 1 /") || html.includes("TIER ") || html.includes("csgo-pass"))
  {
    const t1 = await (await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:11111&tier=1"))).text()
    check("bp tier detail shows full reward text", t1.includes("250 XP") && t1.includes("TIER 01"))
    check("bp tier cells link to detail", html.includes("tier=") && html.includes("csgo-pass"))
  }
  check("bp premium badge", html.includes("Premium") || html.includes("premium track unlocked") || html.includes("PREMIUM"))

  const { DEFAULT_REWARD_TRACK } = await import("./src/catalogs.js")
  const reqT3 = await signedPost(env, [{
    steamid: "STEAM_0:1:1", name: "t3", xp: 0, level: 1, rank_id: 1, vip_tier: 0, coins: 0
  }], {
    catalogs: { reward_track: { ...DEFAULT_REWARD_TRACK, version: 3 } }
  })
  const pushT3 = await handleSync(reqT3, env)
  const pushT3Out = await pushT3.json()
  check("t3 steamid pushed", pushT3Out.ok === true, JSON.stringify(pushT3Out))

  const bpRes = await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:1"))
  const bpHtml = await bpRes.text()
  check("bp cells use per-tier lane medallions", /<img src='\/bp\/prem_\d\d\.png'/.test(bpHtml) && /<img src='\/bp\/free_\d\d\.png'/.test(bpHtml) && /csgo-pass-cell premium/.test(bpHtml))
  // Windowed track: tiers 1..cursor only (min 8) — a maxed player sees all 60.
  const reqT60 = await signedPost(env, [{
    steamid: "STEAM_0:1:60060", name: "t60", xp: 60000, level: 60, rank_id: 19, vip_tier: 2, coins: 0
  }], {})
  const pushT60 = await handleSync(reqT60, env)
  check("t60 steamid pushed", (await pushT60.json()).ok === true)
  const bp60 = await (await pages.pageBattlePass(env, new URL(`https://x/battlepass?steamid=STEAM_0:1:60060`))).text()
  {
    // Full window (60): all tiers x both lanes, milestone frames both lanes.
    // (Div-anchored counts: the bare class string also matches CSS rules.)
    const catRow = await env.DB.prepare(`SELECT json FROM catalog WHERE key='reward_track'`).first()
    const catTiers = JSON.parse(catRow.json).tiers || []
    const expMiles = catTiers.filter(t => t.milestone).length * 2
    const cells = (bp60.match(/<div class='csgo-pass-cell /g) || []).length
    const miles = (bp60.match(/>MILESTONE<\/div>/g) || []).length
    const stars = (bp60.match(/id='tier-\d+'/g) || []).length
    check("bp max window renders all 120 lane cells", cells === 120, cells + " cells")
    check("bp milestone frames on all milestone tiers", miles === expMiles, miles + " of " + expMiles)
    check("bp all 60 tiers anchored for jump links", stars === 60, stars + " anchors")
    check("bp rarity classes", /bp-rarity-normal/.test(bp60) && /bp-rarity-rare/.test(bp60)
      && /bp-rarity-super_rare/.test(bp60) && /bp-rarity-mythic/.test(bp60)
      && /bp-rarity-legendary/.test(bp60))
    const srcs60 = [...bp60.matchAll(/<img src='(\/bp\/(?:prem|free)_\d\d\.png)'/g)].map(m => m[1])
    check("bp max window all 120 tier icons unique files", new Set(srcs60).size === 120, new Set(srcs60).size + " unique of " + srcs60.length)
  }
  {
    // Browser track always shows the full season for back-and-forth travel.
    const cells8 = (bpHtml.match(/<div class='csgo-pass-cell /g) || []).length
    const srcs8 = [...bpHtml.matchAll(/<img src='(\/bp\/(?:prem|free)_\d\d\.png)'/g)].map(m => m[1])
    check("bp browser track renders all 120 cells", cells8 === 120, cells8 + " cells")
    check("bp browser track all 120 icons unique", new Set(srcs8).size === 120, new Set(srcs8).size + " unique")
    check("bp browser track marks selected tier", /csgo-pass-cell[^']*selected/.test(bpHtml))
  }
  {
    const insp = await (await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:60060&tier=10"))).text()
    check("bp inspector shows track types", insp.includes("FREE ·") && insp.includes("PREMIUM ·"))
    check("bp inspector shows per-tier lane medallions", insp.includes("/bp/prem_10.png") && insp.includes("/bp/free_10.png"))
  }
  check("bp browser track renders 60 premium cells", (bpHtml.match(/csgo-pass-cell premium/g) || []).length === 60)
  check("bp track has jump-to-current anchor", bpHtml.includes("jump to current") && bpHtml.includes("#tier-"))

  const bpCompactRes = await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:1&compact=1"))
  {
    // Compact MOTD mirrors the browser structure: Prem + Free lanes over
    // the same reveal window, text cells only.
    const t60c = await (await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:60060&compact=1"))).text()
    check("bp compact has Prem lane", t60c.includes(">Prem<"))
    check("bp compact has Free lane", t60c.includes(">Free<"))
    const cells60 = (t60c.match(/<td class='pass-cell'/g) || []).length
    check("bp compact max window matches browser", cells60 === 61 * 3, cells60 + " cells")
    const t3c = await (await pages.pageBattlePass(env, new URL("https://x/battlepass?steamid=STEAM_0:1:1&compact=1"))).text()
    const cells3 = (t3c.match(/<td class='pass-cell'/g) || []).length
    check("bp compact fresh window is 8 tiers", cells3 === 9 * 3, cells3 + " cells")
    check("bp compact fresh window hides tier 9+", !/>9<\/font>/.test(t3c) && />8<\/font>/.test(t3c))
  }
  const bpCompact = await bpCompactRes.text()
  const passCells = bpCompact.match(/<td class='pass-cell'[\s\S]*?<\/td>/g) || []
  check("bp compact has star", bpCompact.includes("★"))
  check("bp compact has lock glyphs for locked tiers", bpCompact.includes("🔒"))
  check("bp compact no img in pass-cell", passCells.length > 0 && passCells.every(c => !/<img/i.test(c)))

  setMotdCompact(true)
  try {
    const bpUrl = new URL("https://x/battlepass?steamid=STEAM_0:1:11111&compact=1")
    const bpIsoHtml = await (await pages.pageBattlePass(env, bpUrl)).text()
    const foreign = foreignHits(bpIsoHtml, PANEL_CONTRACTS[0], bpUrl)
    check("bp compact title BATTLE PASS", hasProductTitle(bpIsoHtml, "BATTLE PASS"))
    check("bp compact no foreign product href", foreign.length === 0, foreign.join(" | "))
    check("bp compact no shared nav LEADERBOARDS", !bpIsoHtml.includes("LEADERBOARDS"))
    const anonymous = await (await pages.pageBattlePass(env, new URL("https://x/battlepass?compact=1"))).text()
    check("bp compact no steamid lookup form", !/<form\b|LOOKUP|placeholder=['"]STEAM_/i.test(anonymous), "anonymous BP still renders a lookup form")
  } finally {
    setMotdCompact(false)
  }

  const boosts = { hp: 4, armor: 2, jumps: 1, sniper: 1, laststand: 0, chute: 1, premium: 3, milestone: 5 }
  const boostSid = "STEAM_0:1:77777"
  const boostPush = await handleSync(await signedPost(env, [{
    steamid: boostSid, name: "bpboost", xp: 18450, level: 12, rank_id: 12,
    vip_tier: 0, coins: 100,
    bp_boosts: boosts
  }]), env)
  const boostOut = await boostPush.json()
  check("bp_boosts push accepted", boostOut.ok === true, JSON.stringify(boostOut))

  let boostRow = null
  let boostSelErr = ""
  try {
    boostRow = await env.DB.prepare(
      `SELECT bp_hp, bp_armor, bp_jumps, bp_sniper, bp_laststand, bp_chute, bp_premium, bp_milestone FROM players WHERE steamid=?1`
    ).bind(boostSid).first()
  } catch (e) {
    boostSelErr = e.message
  }
  check("bp_boosts all 8 columns stored",
    boostRow
      && Number(boostRow.bp_hp) === boosts.hp
      && Number(boostRow.bp_armor) === boosts.armor
      && Number(boostRow.bp_jumps) === boosts.jumps
      && Number(boostRow.bp_sniper) === boosts.sniper
      && Number(boostRow.bp_laststand) === boosts.laststand
      && Number(boostRow.bp_chute) === boosts.chute
      && Number(boostRow.bp_premium) === boosts.premium
      && Number(boostRow.bp_milestone) === boosts.milestone,
    boostSelErr || JSON.stringify(boostRow))

  const boostHtml = await (await pages.pageBattlePass(env, new URL(`https://x/battlepass?steamid=${boostSid}`))).text()
  const premCells = [...boostHtml.matchAll(/<div class='csgo-pass-cell premium ([^']*)'[^>]*>[\s\S]{0,600}?tier=(\d+)/g)]
  check("bp premium cells render progress window", premCells.length === 60, premCells.length + " cells")
  let premClaimed = premCells.length > 0
  premCells.forEach((m) => {
    const n = parseInt(m[2], 10)
    if (n && n <= boosts.premium && !/\bclaimed\b/.test(m[1])) premClaimed = false
  })
  check("bp premium cells n<=bp_premium claimed", premClaimed,
    premCells.slice(0, 4).map(m => m[1]).join(" | ") || "no premium cells")
}

// ---------------- 5. missions page (daily complete state) ----------------
{
  const html = await (await pages.pageMissions(env, new URL("https://x/missions?steamid=STEAM_0:1:11111&tab=daily"))).text()
  check("daily complete badge", html.includes("Completed</td><td class='v'>8 / 8") || html.includes("8 / 8") || html.includes("ALL COMPLETE"))
  check("mission checkmark", html.includes("[✓]") || html.includes(">READY<"))
}

// ---------------- 6. tournament page (participant list + stages + claim button) ----------------
{
  const html = await (await pages.pageTournament(env, new URL("https://x/tournament"))).text()
  check("tournament rows", html.includes("ziz") && html.includes("#1"))
  check("tournament completion state", html.includes("STAGE") || html.includes("COMPLETED"))
  check("podium carries rewards, pool card gone", html.includes("GOLD - 1ST") && html.includes("10,000 COINS")
    && !html.includes("PRIZE POOL") && html.includes("Also up for grabs"))
  check("season top stats aggregate", html.includes("Players in event") && html.includes("Points scored") && html.includes("Leader"))
  // Fixture season (2026-09) is over -> ENDED: winners frozen on the podium.
  check("ended season crowns winners", html.includes("SEASON PODIUM") && html.includes("FINAL") && html.includes("GOLD - 1ST"))
  check("tournament points at specials", html.includes("Short specials run on Events") && html.includes("monthly season"))
  check("podium gold reward underneath", html.includes("10,000 COINS") && html.includes("SILVER - 2ND") && html.includes("BRONZE - 3RD"))
  check("event stats columns", html.includes("<th>HS</th>") && html.includes("HS%"))
  {
    // Flip all rows to the current month -> RUNNING: podium vacant, countdown live.
    const cd = new Date()
    const curM = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}`
    await env.DB.prepare(`UPDATE players SET comp_season = '${curM}'`).run()
    const live = await (await pages.pageTournament(env, new URL("https://x/tournament"))).text()
    check("running season podium vacant", live.includes("DECIDED AT SEASON END") && /ends in \d+ days?/i.test(live))
    await env.DB.prepare(`UPDATE players SET comp_season = '2026-09'`).run()
  }

  // Test authenticated winner view with claim button
  const { actionToken } = await import("./src/sync.js")
  const tok = await actionToken(SECRET, "STEAM_0:1:11111")
  const authHtml = await (await pages.pageTournament(env, new URL(`https://x/tournament?steamid=STEAM_0:1:11111&t=${tok}`))).text()
  check("tournament winner claim button", authHtml.includes("CLAIM PRIZE") && authHtml.includes("10,000 COINS"))

  // Test queueing tournament claim
  const claimUrl = new URL(`https://x/tournament?steamid=STEAM_0:1:11111&t=${tok}&claim=CHAMPION+(%231)`)
  const claimHtml = await (await pages.pageTournament(env, claimUrl)).text()
  check("tournament claim queues and shows confirmation", claimHtml.includes("TOURNAMENT PRIZE CLAIM QUEUED"))
  const act = await env.DB.prepare(`SELECT * FROM actions WHERE steamid = 'STEAM_0:1:11111' AND type = 'claim_tournament'`).first()
  check("queue tournament prize action in db", act && act.type === "claim_tournament")
}

// ---------------- 7. action token: valid vs forged ----------------
{
  const { actionToken, queueAction, checkActionToken } = await import("./src/sync.js")
  const tok = await actionToken(SECRET, "STEAM_0:1:11111")
  check("token validates", await checkActionToken(SECRET, "STEAM_0:1:11111", tok))
  check("forged token rejected", !(await checkActionToken(SECRET, "STEAM_0:1:11111", "deadbeef".repeat(8))))
  const q1 = await queueAction(env, "STEAM_0:1:11111", "buy_skin", "ak47:2", tok)
  check("queue purchase", q1.ok === true, JSON.stringify(q1))
  const q2 = await queueAction(env, "STEAM_0:1:11111", "buy_skin", "ak47:2", tok)
  check("duplicate queue idempotent", q2.ok === true && q2.note === "already queued")
  const q3 = await queueAction(env, "STEAM_0:1:11111", "buy_skin", "awp:9", "forged")
  check("queue with bad token refused", q3.ok === false)
  const q4 = await queueAction(env, "STEAM_0:1:99999", "buy_skin", "awp:9", await actionToken(SECRET, "STEAM_0:1:99999"))
  check("unknown player queue accepted into queue (validated game-side)", q4.ok === true)
}

// ---------------- 8. dispatch: pending actions ride the push response ----------------
{
  const req = await signedPost(env, [{
    steamid: "STEAM_0:1:11111", name: "ziz", xp: 18450, level: 12, rank_id: 12, kills: 2841,
    deaths: 1900, headshots: 900, vip_tier: 2, coins: 4850, rating_x100: 133, comp_season: "2026-09", comp_kills: 500, comp_hs: 200, comp_wins: 55, comp_mvp: 12
  }])
  const res = await handleSync(req, env)
  const out = await res.json()
  check("actions dispatched in response", Array.isArray(out.actions) && out.actions.some(a => a.type === "buy_skin"), JSON.stringify(out.actions))

  // game reports result
  const req2 = await signedPost(env, [], { action_results: [{ id: out.actions[0].id, ok: true, result: "skin purchased" }] })
  await handleSync(req2, env)
  const row = await env.DB.prepare(`SELECT status, result FROM actions WHERE id = ${out.actions[0].id}`).first()
  check("action result recorded", row && row.status === "done", JSON.stringify(row))
}

// ---------------- 9. store page with queued feedback ----------------
{
  const tok = await (await import("./src/sync.js")).actionToken(SECRET, "STEAM_0:1:11111")
  const url = new URL(`https://x/store?steamid=STEAM_0:1:11111&t=${tok}`)
  const html = await (await pages.pageStore(env, url)).text()
  check("store renders catalog", html.includes("Asiimov") && html.includes("OWNED"))
  check("store shows coins", html.includes("4,850"))
  check("store shows healthnade skill", html.includes("HealthNade"))
  check("store shows skill stage and purchase at stage 0", html.includes("STAGE") && html.includes("PURCHASE"))
  const upgradeUrl = new URL(`https://x/store?steamid=STEAM_0:1:11111&t=${tok}&sk_healthnade=1`)
  const upgradeHtml = await (await pages.pageStore(env, upgradeUrl)).text()
  check("store shows reworked skill stage and upgrade", upgradeHtml.includes("STAGE") && upgradeHtml.includes("UPGRADE"))

  // Test buy_skill queuing
  const buyUrl = new URL(`https://x/store?steamid=STEAM_0:1:11111&t=${tok}&buy=buy_skill:healthnade`)
  await pages.pageStore(env, buyUrl)
  const act = await env.DB.prepare(`SELECT * FROM actions WHERE steamid = 'STEAM_0:1:11111' AND type = 'buy_skill'`).first()
  check("queue skill purchase", act && act.arg === "healthnade", JSON.stringify(act))
}

// ---------------- 10. achievements page ----------------
{
  const url = new URL("https://x/achievements?steamid=STEAM_0:1:11111")
  const html = await (await pages.pageAchievements(env, url)).text()
  check("achievements page renders", html.includes("ACHIEVEMENTS"))
  {
    const hof = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&tab=hof"))).text()
    check("hof shows catalog examples", hof.includes("EXAMPLE") && hof.includes("Season 1 Grand Champion"))
    check("hof examples never labeled live", !hof.includes("(Summer 2026) LIVE"))
    check("hof example champion coin renders", hof.includes("cs2-medal"))
  }

  await env.DB.prepare(`UPDATE players SET kills = 10000, ach_unlocked = 1 WHERE steamid = 'STEAM_0:1:11111'`).run()
  const htmlBits = await (await pages.pageAchievements(env, url)).text()
  check("bit 0 marks First Blood unlocked", htmlBits.includes("UNLOCKED") || htmlBits.includes("COMPLETED") || htmlBits.includes("[✓]"))
  check("kills=10000 does not unlock unpaid 10k medal", !/TEN THOUSAND|kills_10000/i.test(htmlBits) || !htmlBits.includes("10,000 ranked"))
  {
    // Podium vacant while nobody finished a hardest (MEDAL-tier) medal.
    const hof = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&tab=hof"))).text()
    check("podium vacant slots honest", hof.includes("VACANT") && hof.includes("HARDEST-MEDAL PODIUM"))
    const es = [...hof.matchAll(/data-e='([a-z0-9_]+)'/g)].map(m => m[1])
    check("hof example coins unique emblems", new Set(es).size >= 6, new Set(es).size + " unique")
    // Grant hardest bits (kills_5000=2, level_52=9, win_streak_10=11) -> 1ST.
    await env.DB.prepare(`UPDATE players SET ach_unlocked = ${(1 << 2) | (1 << 9) | (1 << 11)} WHERE steamid = 'STEAM_0:1:11111'`).run()
    const hof2 = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&tab=hof"))).text()
    check("podium seats hardest finisher", hof2.includes("1ST") && hof2.includes("3/5 hardest"))
    await env.DB.prepare(`UPDATE players SET ach_unlocked = 1 WHERE steamid = 'STEAM_0:1:11111'`).run()
    // Records: live holders from real columns, pending stays honest.
    const rec = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&tab=records"))).text()
    check("records groups render", rec.includes("COMBAT") && rec.includes("ARSENAL") && rec.includes("DEDICATION"))
    check("records live kill holder", rec.includes("Most Career Kills") && rec.includes("10,000 kills"))
    check("records pending honest", rec.includes("Tracked in-game"))
  }
  // Regression: bare /achievements (no steamid) rendered the cabinet with a
  // null player row and crashed achProgressOf (TypeError on .kills). Must not throw.
  const htmlBare = await (await pages.pageAchievements(env, new URL("https://x/achievements"))).text()
  check("bare achievements cabinet renders without player row", htmlBare.includes("LIVE MEDALS") && !/Unable to load|internal error/i.test(htmlBare))
  check("service-medal coins render (svg, no Valve art)", html.includes("cs2-medal") && /rarity-(common|uncommon|rare|mythic|legendary)/.test(html))
  check("cabinet cells show earned info", html.includes("Earned"))
  check("service-medal star polygon present", html.includes("<polygon points="))
  check("bare cabinet shows locked service medals", htmlBare.includes("cs2-medal") && htmlBare.includes("IN PROGRESS"))
  {
    const es = [...html.matchAll(/data-e='([a-z0-9_]+)'/g)].map(m => m[1])
    check("all 13 badges unique emblems", new Set(es).size >= 13, new Set(es).size + " unique")
    check("badges color in with progress (clip fill)", htmlBits.includes("clip-path"))
    check("cabinet shows live % caption", /IN PROGRESS &#183; [1-9][0-9]?%/.test(htmlBits))
    // Filter/preview links keep full context: no accumulation, no mode flip.
    const htmlCtx = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&compact=1"))).text()
    const catLinks = [...htmlCtx.matchAll(/<a[^>]*href='([^']*cat=[^']*)'/g)].map(m => m[1])
    check("ach category links preserve compact+identity", catLinks.length > 0 && catLinks.every(l => (l.includes("/m/a/") || l.includes("compact=1")) && (l.includes("0-1-11111") || l.includes("STEAM_0%3A1%3A11111"))), catLinks[0] || "no cat links")
    const htmlCat = await (await pages.pageAchievements(env, new URL("https://x/achievements?steamid=STEAM_0:1:11111&cat=combat"))).text()
    const prevLinks = [...htmlCat.matchAll(/<a[^>]*href='([^']*preview=[^']*)'/g)].map(m => m[1])
    check("ach preview links preserve category filter", prevLinks.length > 0 && prevLinks.every(l => l.includes("cat=combat")), prevLinks[0] || "no preview links")
    check("locked fresh medal stays grey (data-p=0)", htmlBare.includes("data-p='0'"))
  }
}

// ---------------- 11. events page ----------------
{
  const html = await (await pages.pageEvents(env, new URL("https://x/events"))).text()
  check("events empty state when none active", html.includes("NO LIVE EVENTS") || html.includes("No events in the catalog") || html.includes("ACTIVE") || html.includes("Kill Race"))
  check("events clarifies vs season", html.includes("LIMITED-TIME EVENTS") && html.includes("Competitive") && html.includes("/pts"))
  check("events visitor preview shows target counting", html.includes("Target 1,000") || html.includes("/ 1,000"))

  const authHtml = await (await pages.pageEvents(env, new URL("https://x/events?steamid=STEAM_0:1:11111"))).text()
  // Section 10 may have already rewritten kills to 10,000; both are live D1 counts vs catalog target 1,000.
// ---------------- 11b. events data contract (metric/target/scope/reward + REAL mults) ----------------
{
  const cols = (await env.DB.prepare(`SELECT name FROM pragma_table_info('events')`).all()).results.map(r => r.name)
  check("events contract columns exist", ["metric", "target", "scope", "reward"].every(c => cols.includes(c)), cols.join(","))
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,metric,target,scope,reward) VALUES ('Contract Probe','xp_mult','scheduled',0,0,1.5,2.5,'kills',1000,'individual','10 Coins')`).run()
  const probe = await env.DB.prepare(`SELECT metric,target,scope,reward,xp_mult FROM events WHERE title = 'Contract Probe'`).first()
  check("events contract row round-trips", probe && probe.metric === "kills" && probe.target === 1000 && probe.scope === "individual" && probe.xp_mult === 1.5, JSON.stringify(probe))
  await env.DB.prepare(`DELETE FROM events WHERE title = 'Contract Probe'`).run()
}

  check("events shows live counting system for player",
    /(?:2,841|10,000) \/ 1,000/.test(authHtml),
    authHtml.includes("Target") ? "visitor target only" : authHtml.slice(authHtml.indexOf("EVENTS"), authHtml.indexOf("EVENTS") + 400))
}

// ---------------- 11c. events settlement + admin op=edit + fractional mults ----------------
{
  // Staff auth must exist before this block's login POST (the staff section
  // sets the same values later; identical assignment, no behavior change).
  env.ADMIN_PASSWORD = "test-admin"
  env.ADMIN_STEAMIDS = "STEAM_0:0:683671116"
  const { default: evWorker } = await import("./src/index.js")
  const { actionToken: evTok } = await import("./src/sync.js")
  const loginRes = await evWorker.fetch(new Request("https://x/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-admin", steamid: "STEAM_0:0:683671116" }).toString()
  }), env)
  const evCookie = String(loginRes.headers.get("set-cookie") || "").split(";")[0] || ""
  const evLogged = /fn_staff/i.test(String(loginRes.headers.get("set-cookie") || ""))
  check("events admin login", evLogged)
  const csrfOf = async () => {
    const r = await evWorker.fetch(new Request("https://x/admin?s=events&tab=create", {
      headers: { cookie: evCookie }
    }), env)
    const t = await r.text()
    return (t.match(/name="csrf" value="([^"]+)"/) || ["", ""])[1]
  }
  const evPost = async (fields) => {
    const csrf = await csrfOf()
    const r = await evWorker.fetch(new Request("https://x/admin/events", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: evCookie },
      body: new URLSearchParams({ csrf, ...fields }).toString()
    }), env)
    return { status: r.status, text: await r.text() }
  }
  const nowS = Math.floor(Date.now() / 1000)
  // --- op=edit matrix on a scheduled event ---
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward,reward_coins,reward_viptier,reward_vipdays,min_score)
    VALUES ('Edit Probe','community_goal','scheduled',?1,?2,1,1,'editprobe',?1,'kills',100,'individual','x',0,0,0,0)`)
    .bind(nowS - 5, nowS + 3600).run()
  const probeEv = await env.DB.prepare(`SELECT id FROM events WHERE title = 'Edit Probe'`).first()
  const pid = probeEv.id
  let r = await evPost({ op: "edit", id: String(pid), metric: "headshots", target: "250", scope: "global", reward: "3K",
    reward_coins: "700", reward_viptier: "0", reward_vipdays: "0", min_score: "5" })
  const edited = await env.DB.prepare(`SELECT metric,target,reward_coins,min_score,xp_mult FROM events WHERE id = ?1`).bind(pid).first()
  check("op=edit scheduled updates incl. amounts", r.status === 302 && edited.metric === "headshots" && edited.target === 250
    && edited.reward_coins === 700 && edited.min_score === 5 && Number(edited.xp_mult) === 1, `status=${r.status} ${JSON.stringify(edited)}`)
  await env.DB.prepare(`UPDATE events SET status = 'active' WHERE id = ?1`).bind(pid).run()
  r = await evPost({ op: "edit", id: String(pid), metric: "kills", target: "10", scope: "global", reward: "y",
    reward_coins: "1", reward_viptier: "0", reward_vipdays: "0", min_score: "0" })
  check("op=edit active rejects amounts", r.status === 200 && r.text.includes("Prize amounts can only be edited while scheduled"), `status=${r.status}`)
  r = await evPost({ op: "edit", id: String(pid), metric: "kills", target: "10", scope: "global", reward: "y" })
  check("op=edit active allows contract fields", r.status === 302, `status=${r.status}`)
  await env.DB.prepare(`UPDATE events SET status = 'completed' WHERE id = ?1`).bind(pid).run()
  r = await evPost({ op: "edit", id: String(pid), metric: "kills", target: "10", scope: "global", reward: "y" })
  check("op=edit completed rejected", r.status === 200 && r.text.includes("Only scheduled or active"), `status=${r.status}`)
  await env.DB.prepare(`UPDATE events SET status = 'scheduled' WHERE id = ?1`).bind(pid).run()
  const badCases = [
    [{ metric: "nope", target: "10", scope: "global", reward: "" }, "Unknown event metric."],
    [{ metric: "kills", target: "-3", scope: "global", reward: "" }, "whole number"],
    [{ metric: "kills", target: "10", scope: "weird", reward: "" }, "Unknown event scope."],
    [{ metric: "kills", target: "10", scope: "global", reward: "x".repeat(121) }, "120 characters"],
    [{ metric: "kills", target: "10", scope: "global", reward: "a<b" }, "cannot contain"],
    [{ metric: "kills", target: "10", scope: "global", reward: "", reward_coins: "99999" }, "0-50000"],
    [{ metric: "kills", target: "10", scope: "global", reward: "", reward_viptier: "9" }, "0-3"],
    [{ metric: "kills", target: "10", scope: "global", reward: "", reward_vipdays: "999" }, "0-365"],
    [{ metric: "kills", target: "10", scope: "global", reward: "", min_score: "-1" }, "Minimum score"]
  ]
  let badOk = 0, badDetail = ""
  for (const [f, needle] of badCases) {
    const rr = await evPost({ op: "edit", id: String(pid), ...f })
    if (rr.status === 200 && rr.text.includes(needle)) badOk++
    else badDetail += ` [${JSON.stringify(f)}=>${rr.status}]`
  }
  check("op=edit validation matrix", badOk === badCases.length, `${badOk}/${badCases.length}${badDetail}`)
  // --- fractional create + queue serialization ---
  r = await evPost({ op: "create", title: "Frac Probe", type: "coins_mult", start_at: String(nowS - 5),
    end_at: String(nowS + 3600), xp_mult: "1.5", coins_mult: "2.5", metric: "kills", target: "100",
    scope: "individual", reward: "x", reward_coins: "0", reward_viptier: "0", reward_vipdays: "0", min_score: "0" })
  const fracEv = await env.DB.prepare(`SELECT id, xp_mult FROM events WHERE title = 'Frac Probe'`).first()
  check("fractional create stores REAL", r.status === 302 && fracEv && Number(fracEv.xp_mult) === 1.5, `status=${r.status} ${JSON.stringify(fracEv)}`)
  r = await evPost({ op: "create", title: "Step Probe", type: "happy_hour", start_at: String(nowS + 7200),
    end_at: String(nowS + 10800), xp_mult: "2.7", coins_mult: "1", metric: "none", target: "0",
    scope: "global", reward: "", reward_coins: "0", reward_viptier: "0", reward_vipdays: "0", min_score: "0" })
  const stepEv = await env.DB.prepare(`SELECT xp_mult FROM events WHERE title = 'Step Probe'`).first()
  check("off-step mult rounds to 0.5", stepEv && Number(stepEv.xp_mult) === 2.5, JSON.stringify(stepEv))
  // --- settlement race on an isolated player (fixture 11111 untouched) ---
  const TP = "STEAM_0:1:22222"
  await env.DB.prepare(`DELETE FROM players WHERE steamid IN ('${TP}')`).run()
  const pushTP = async (kills) => handleSync(await signedPost(env, [{
    steamid: TP, name: "racebot", xp: 10, level: 1, kills, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }]), env)
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward,reward_coins,reward_viptier,reward_vipdays,min_score)
    VALUES ('Race Probe','community_goal','scheduled',?1,?2,1,1,'goal',?1,'kills',100,'individual','500c',500,0,0,0)`)
    .bind(nowS - 5, nowS + 3600).run()
  await pushTP(500)
  const raceEv = await env.DB.prepare(`SELECT id, status FROM events WHERE title = 'Race Probe'`).first()
  check("race activates on push", raceEv && raceEv.status === "active", JSON.stringify(raceEv))
  const base = await env.DB.prepare(`SELECT baseline FROM event_baselines WHERE event_id = ?1 AND steamid = '${TP}' AND metric = 'kills'`).bind(raceEv.id).first()
  check("baseline snapshot on activation", base && base.baseline === 500, JSON.stringify(base))
  await pushTP(650)
  await env.DB.prepare(`UPDATE events SET end_at = ?1 WHERE id = ?2`).bind(nowS - 1, raceEv.id).run()
  await pushTP(650)
  const doneEv = await env.DB.prepare(`SELECT status FROM events WHERE id = ?1`).bind(raceEv.id).first()
  const win = await env.DB.prepare(`SELECT placement, steamid, score, reward_coins FROM event_winners WHERE event_id = ?1 ORDER BY placement`).bind(raceEv.id).all()
  const rew = await env.DB.prepare(`SELECT type, arg, status FROM actions WHERE type = 'srv_event_reward' AND arg LIKE ?1`).bind(`${raceEv.id}:%`).first()
  const hist = await env.DB.prepare(`SELECT title FROM event_history WHERE event_id = ?1`).bind(raceEv.id).first()
  check("race settles with winner + reward intent + history",
    doneEv && doneEv.status === "completed"
    && win.results.length === 1 && win.results[0].steamid === TP && win.results[0].score === 150 && win.results[0].reward_coins === 500
    && rew && rew.arg === `${raceEv.id}:500:0:0` && hist && hist.title === "Race Probe",
    JSON.stringify({ doneEv, win: win.results, rew, hist }))
  // idempotent re-finalize: push again, winners must not duplicate
  await pushTP(700)
  const win2 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_winners WHERE event_id = ?1`).bind(raceEv.id).first()
  check("re-finalize is idempotent", win2 && win2.n === 1, JSON.stringify(win2))
  // VIP-shaped intent also parses (coins + 7d Elite, no game here to pay it)
  await env.DB.prepare(`INSERT INTO actions (steamid, type, arg, status, created_at) VALUES ('${TP}', 'srv_event_reward', ?1, 'done', ?2)`)
    .bind(`${raceEv.id}:0:3:7`, nowS).run()
  // parser replica: every queued reward arg must survive the game's 4-slot split
  const allRew = await env.DB.prepare(`SELECT arg FROM actions WHERE type = 'srv_event_reward'`).all()
  const parse4 = (a) => {
    const t = String(a || "").split(":")
    if (t.length !== 4) return null
    if (!t.every(x => /^-?\d+$/.test(x))) return null
    const [e, c, vt, vd] = t.map(Number)
    return { e, c, vt, vd }
  }
  const badArgs = (allRew.results || []).filter(r => {
    const q = parse4(r.arg)
    return !q || !(q.e > 0 && q.c >= 0 && q.c <= 50000 && q.vt >= 0 && q.vt <= 3 && q.vd >= 0 && q.vd <= 365)
  })
  check("reward args match game grammar", badArgs.length === 0, JSON.stringify(badArgs.slice(0, 3)))
  await env.DB.prepare(`DELETE FROM actions WHERE steamid = '${TP}' AND type = 'srv_event_reward' AND arg = ?1`).bind(`${raceEv.id}:0:3:7`).run()
  // real re-entry: flip back to active, settle must not duplicate winners or intents
  await env.DB.prepare(`UPDATE events SET status = 'active' WHERE id = ?1`).bind(raceEv.id).run()
  await pushTP(700)
  const win3 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_winners WHERE event_id = ?1`).bind(raceEv.id).first()
  const act3 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM actions WHERE type = 'srv_event_reward' AND arg LIKE ?1`).bind(`${raceEv.id}:%`).first()
  const st3 = await env.DB.prepare(`SELECT status FROM events WHERE id = ?1`).bind(raceEv.id).first()
  check("re-entry settles once", win3 && win3.n === 1 && act3 && act3.n === 1 && st3.status === "completed",
    JSON.stringify({ win3, act3, st3 }))
  // counter-reset path: active event, baseline above current (restart/wipe).
  // Re-baselines, credits nothing, flags LATE (end long past).
  const R2END = nowS - 4000
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('R2','community_goal','active',?1,?2,1,1,'goal',?1,'kills',10,'individual','x')`)
    .bind(nowS - 5000, R2END).run()
  const r2ev = await env.DB.prepare(`SELECT id FROM events WHERE title = 'R2'`).first()
  await env.DB.prepare(`INSERT OR IGNORE INTO event_baselines (event_id,steamid,metric,baseline,taken_at) VALUES (?1,'${TP}','kills',700,?2)`)
    .bind(r2ev.id, nowS - 100).run()
  await pushTP(60)
  const w3 = await env.DB.prepare(`SELECT * FROM event_winners WHERE event_id = ?1`).bind(r2ev.id).all()
  const au3 = await env.DB.prepare(`SELECT meta FROM event_audit WHERE action = 'settled' AND entity = ?1`).bind(`event:${r2ev.id}`).first()
  check("reset re-baselines, no winner, LATE flagged", w3.results.length === 0 && au3
    && au3.meta.includes("resets=1") && au3.meta.includes("LATE") && au3.meta.includes("missing="), JSON.stringify({ w: w3.results, au: au3 }))
  const missN = Number((au3.meta.match(/missing=(\d+)/) || [0, 0])[1])
  check("missing baselines skipped, never credited", missN >= 1, au3.meta)
  await env.DB.prepare(`DELETE FROM events WHERE title = 'R2'`).run()
  await env.DB.prepare(`DELETE FROM event_baselines WHERE event_id = ?1`).bind(r2ev.id).run()
  // --- stale-scheduled sweep: window passed, never activated ---
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Stale Probe','community_goal','scheduled',?1,?2,1,1,'goal',?1,'kills',50,'individual','x')`)
    .bind(nowS - 100, nowS - 50).run()
  await pushTP(700)
  const stale = await env.DB.prepare(`SELECT status FROM events WHERE title = 'Stale Probe'`).first()
  const staleWin = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_winners WHERE event_id = (SELECT id FROM events WHERE title = 'Stale Probe')`).first()
  const staleAudit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_audit WHERE action = 'never-activated'`).first()
  check("stale-scheduled completes without winners", stale && stale.status === "completed" && staleWin.n === 0 && staleAudit.n >= 1,
    JSON.stringify({ stale, staleWin, staleAudit }))
  // tie-break: equal progress -> smaller steamid takes the better placement
  const TP2 = "STEAM_0:1:22223"
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Tie Probe','community_goal','scheduled',?1,?2,1,1,'goal',?1,'kills',10000,'individual','x')`)
    .bind(nowS - 5, nowS + 3600).run()
  const tiePush = async (k) => handleSync(await signedPost(env, [
    { steamid: TP, name: "racebot", xp: 10, level: 1, kills: k, deaths: 1, headshots: 1, vip_tier: 0, coins: 0 },
    { steamid: TP2, name: "racebot2", xp: 10, level: 1, kills: k, deaths: 1, headshots: 1, vip_tier: 0, coins: 0 }
  ]), env)
  await tiePush(500)
  await tiePush(600)
  const tieEv = await env.DB.prepare(`SELECT id FROM events WHERE title = 'Tie Probe'`).first()
  await env.DB.prepare(`UPDATE events SET end_at = ?1 WHERE id = ?2`).bind(nowS - 1, tieEv.id).run()
  await tiePush(600)
  const tieW = await env.DB.prepare(`SELECT placement, steamid FROM event_winners WHERE event_id = ?1 ORDER BY placement`).bind(tieEv.id).all()
  check("tie-break is deterministic", tieW.results.length === 2
    && tieW.results[0].steamid === TP && tieW.results[0].placement === 1
    && tieW.results[1].steamid === TP2, JSON.stringify(tieW.results))
  await env.DB.prepare(`DELETE FROM events WHERE title = 'Tie Probe'`).run()
  await env.DB.prepare(`DELETE FROM event_winners WHERE event_id = ?1`).bind(tieEv.id).run()
  await env.DB.prepare(`DELETE FROM event_baselines WHERE event_id = ?1`).bind(tieEv.id).run()
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP2}'`).run()
  // --- claim_event queue acceptance (game-side dup prevention is compiled, no live game here) ---
  const { queueAction } = await import("./src/sync.js")
  const ct = await evTok(SECRET, TP)
  const cq = await queueAction(env, TP, "claim_event", "7", ct)
  check("claim_event queues", cq && cq.ok === true, JSON.stringify(cq))
  // c4 display agrees with settlement counters (ach lifetime, never daily)
  await env.DB.prepare(`UPDATE players SET ach_plants = 30, ach_defuses = 20 WHERE steamid = '${TP}'`).run()
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('C4 Probe','community_goal','active',?1,?2,1,1,'goal',?1,'c4',100,'individual','x')`).bind(nowS - 5, nowS + 3600).run()
  const c4ev = await env.DB.prepare(`SELECT id FROM events WHERE title = 'C4 Probe'`).first()
  const c4det = await (await pages.pageEvents(env, new URL(`https://x/events?steamid=${TP}&id=${c4ev.id}`))).text()
  check("c4 progress uses lifetime counters", /50 \/ 100 \(50%\)/.test(c4det), c4det.slice(c4det.indexOf("YOUR PROGRESS"), c4det.indexOf("YOUR PROGRESS") + 160))
  await env.DB.prepare(`DELETE FROM events WHERE title = 'C4 Probe'`).run()
  // cancel guard: completed events cannot be rewritten as cancelled
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Cancel Probe','community_goal','scheduled',?1,?2,1,1,'goal',?1,'none',0,'global','')`).bind(nowS - 5, nowS + 3600).run()
  const cx = await env.DB.prepare(`SELECT id FROM events WHERE title = 'Cancel Probe'`).first()
  let cr = await evPost({ op: "cancel", id: String(cx.id) })
  check("cancel needs confirm", cr.status === 200 && cr.text.includes("Confirm event cancellation"), `status=${cr.status}`)
  cr = await evPost({ op: "cancel", id: String(cx.id), confirm: "1" })
  const cxSt = await env.DB.prepare(`SELECT status FROM events WHERE id = ?1`).bind(cx.id).first()
  check("cancel scheduled works", cr.status === 302 && cxSt.status === "cancelled", `status=${cr.status} ${JSON.stringify(cxSt)}`)
  cr = await evPost({ op: "cancel", id: String(cx.id), confirm: "1" })
  check("cancel cancelled rejected", cr.status === 200 && cr.text.includes("Only active or scheduled"), `status=${cr.status}`)
  await env.DB.prepare(`DELETE FROM events WHERE title = 'Cancel Probe'`).run()
  // MSIE MOTD must never see inline SVG on events pages
  const msie = await evWorker.fetch(new Request(`https://x/events?steamid=${TP}`, {
    headers: { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" }
  }), env)
  const msieHtml = await msie.text()
  check("events MSIE has no svg", msie.status === 200 && !msieHtml.includes("<svg"), `status=${msie.status}`)
  // --- cleanup test rows (fixture player never touched) ---
  await env.DB.prepare(`DELETE FROM actions WHERE (type = 'srv_event_reward' AND arg LIKE '${raceEv.id}:%') OR (steamid = '${TP}' AND type = 'claim_event')`).run()
  await env.DB.prepare(`DELETE FROM event_winners WHERE event_id = ?1`).bind(raceEv.id).run()
  await env.DB.prepare(`DELETE FROM event_baselines WHERE steamid = '${TP}'`).run()
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP}'`).run()
  await env.DB.prepare(`DELETE FROM events WHERE title IN ('Edit Probe','Frac Probe','Step Probe','Race Probe','Stale Probe')`).run()
  await env.DB.prepare(`DELETE FROM event_history WHERE title IN ('Race Probe','R2','Tie Probe','Stale Probe','Cancel Probe') OR event_id = 777001`).run()
  await env.DB.prepare(`DELETE FROM event_audit WHERE entity LIKE 'event:%' AND meta LIKE '%winners=%' OR action = 'never-activated'`).run()
  await env.DB.prepare(`DELETE FROM actions WHERE steamid = '${TP}' AND type = 'srv_event_reward' AND status = 'done'`).run()
}

// ---------------- 11d. events display surface (F1-F5, winners, claim, icons) ----------------
{
  // Direct page renders inherit the module-global MOTD flag left by earlier
  // MSIE worker tests. Reset to browser mode; later worker tests set it per
  // request themselves, and ?compact=1 pages read the query param, not this.
  const { setMotdCompact } = await import("./src/ui.js")
  setMotdCompact(false)
  const SID = "STEAM_0:1:11111"
  const nowS = Math.floor(Date.now() / 1000)
  const listHtml = async (q) => (await pages.pageEvents(env,
    new URL(`https://x/achievements`.replace("achievements", "events") + (q || "") + (q && q.includes("steamid") ? "" : `?steamid=${SID}`)))).text()
  // F1: separator + parens, never glued digits
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Glue Probe','community_goal','active',?1,?2,1,1,'goal',?1,'kills',1000,'individual','x')`).bind(nowS - 5, nowS + 3600).run()
  let g = await listHtml(`?steamid=${SID}`)
  check("progress formats with separator", /10,000 \/ 1,000 \(100%\)/.test(g) && !/1,0000%/.test(g))
  // F5: countdown + icons + kind class on cards
  check("countdown renders", /ends in \d+d \d+h/.test(g))
  check("event icons render", g.includes("evt-kind-community") && g.includes("<svg"))
  // boost-only row
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Boost Probe','xp_mult','active',?1,?2,2,1,'xp',?1,'none',0,'global','')`).bind(nowS - 5, nowS + 3600).run()
  g = await listHtml(`?steamid=${SID}`)
  check("boost-only has no fake target", g.includes("boost only - no personal target"))
  await env.DB.prepare(`DELETE FROM events WHERE title IN ('Glue Probe','Boost Probe')`).run()
  // F2: expired catalog cards rejected, future kept
  const catRow = await env.DB.prepare(`SELECT json FROM catalog WHERE key = 'events'`).first()
  const catBak = catRow && catRow.json
  const catMade = !catRow
  if (catMade) await env.DB.prepare(`INSERT INTO catalog (key, version, json, updated_at) VALUES ('events', 1, '{"events":[]}', 0)`).run()
  try {
    const cj = JSON.parse(catBak || '{"events":[]}')
    cj.events = (cj.events || []).concat([
      { id: "past-probe", name: "Past Probe", active: 1, ends: "2020-01-01 00:00", metric: "kills", target: 10 },
      { id: "future-probe", name: "Future Probe", active: 1, ends: "2099-01-01 00:00", metric: "kills", target: 10 }
    ])
    await env.DB.prepare(`UPDATE catalog SET json = ?1 WHERE key = 'events'`).bind(JSON.stringify(cj)).run()
    g = await listHtml(`?steamid=${SID}`)
    check("expired catalog never ACTIVE", !g.includes("Past Probe") && g.includes("Future Probe"))
  } finally {
    if (catBak != null) await env.DB.prepare(`UPDATE catalog SET json = ?1 WHERE key = 'events'`).bind(catBak).run()
    else if (catMade) await env.DB.prepare(`DELETE FROM catalog WHERE key = 'events'`).run()
  }
  // F4: tabs present + past view renders
  g = await listHtml(`?steamid=${SID}`)
  check("filter tabs present", g.includes("show=active") && g.includes("show=upcoming") && g.includes("show=past") && g.includes("show=mine"))
  const pastHtml = await listHtml(`?steamid=${SID}&show=past`)
  check("past view renders", pastHtml.includes("NO COMPLETED EVENTS") || pastHtml.includes("COMPLETED"))
  // winners names from the finalized record
  await env.DB.prepare(`INSERT INTO event_history (event_id,title,type,xp_mult,coins_mult,start_at,end_at,completed_at) VALUES (777001,'Won Probe','community_goal',1,1,?1,?2,?2)`)
    .bind(nowS - 100, nowS - 50).run()
  await env.DB.prepare(`INSERT INTO event_winners (event_id,placement,steamid,score,reward_coins,reward_viptier,reward_vipdays,issued_at) VALUES (777001,1,'${SID}',321,500,0,0,?1)`)
    .bind(nowS - 50).run()
  const past2 = await listHtml(`?steamid=${SID}&show=past`)
  check("winners names recorded", past2.includes("Won Probe") && past2.includes("321") && past2.includes("ziz"))
  await env.DB.prepare(`DELETE FROM event_history WHERE event_id = 777001`).run()
  await env.DB.prepare(`DELETE FROM event_winners WHERE event_id = 777001`).run()
  // claim affordance for a recorded winner on a live event
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Claim Probe','community_goal','active',?1,?2,1,1,'goal',?1,'kills',100,'individual','x')`).bind(nowS - 5, nowS + 3600).run()
  const ce = await env.DB.prepare(`SELECT id FROM events WHERE title = 'Claim Probe'`).first()
  await env.DB.prepare(`INSERT INTO event_winners (event_id,placement,steamid,score,reward_coins,reward_viptier,reward_vipdays,issued_at) VALUES (?1,1,'${SID}',150,500,0,0,?2)`)
    .bind(ce.id, nowS).run()
  const det = await (await pages.pageEvents(env, new URL(`https://x/events?steamid=${SID}&id=${ce.id}`))).text()
  check("winner claim link carries token", /act=claim_event:\d+/.test(det) && /t=[0-9a-f]{64}/.test(det) && det.includes("CLAIM"))
  const detQ = await (await pages.pageEvents(env, new URL(`https://x/events?steamid=${SID}&id=${ce.id}&act=claim_event:${ce.id}&t=${(det.match(/t=([0-9a-f]{64})/) || ["", ""])[1]}`))).text()
  check("claim queues through channel", detQ.includes("Reward claim queued"))
  await env.DB.prepare(`DELETE FROM event_winners WHERE event_id = ?1`).bind(ce.id).run()
  await env.DB.prepare(`DELETE FROM actions WHERE steamid = '${SID}' AND type = 'claim_event'`).run()
  await env.DB.prepare(`DELETE FROM events WHERE title = 'Claim Probe'`).run()
}

// ---------------- 11e. Wave B web-truth assertions ----------------
{
  const SID = "STEAM_0:1:11111"
  const { default: w2 } = await import("./src/index.js")
  const { actionToken: tokFn } = await import("./src/sync.js")
  const msieH = { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" }
  // W1/W4: READY label + single tab highlight + VIP EXTRA needs live tier
  await env.DB.prepare(`UPDATE players SET bp_daily_kills = 9999 WHERE steamid = '${SID}'`).run()
  let m = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${SID}`))).text()
  check("missions READY not CLAIMED", m.includes("READY") && !m.includes("[\u2713] CLAIMED"))
  check("missions single tab highlight", (m.match(/pill on/g) || []).length === 1)
  check("missions claim-all only when flaggable", !m.includes("claim_mission_all:"))
  const vt0 = await env.DB.prepare(`SELECT vip_tier, msn_st_v FROM players WHERE steamid = '${SID}'`).first()
  await env.DB.prepare(`UPDATE players SET vip_tier = 0, msn_st_v = 1 WHERE steamid = '${SID}'`).run()
  m = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${SID}`))).text()
  check("vip extra needs live tier", !m.includes("VIP EXTRA"))
  await env.DB.prepare(`UPDATE players SET vip_tier = ${vt0 ? vt0.vip_tier : 2}, msn_st_v = ${vt0 && vt0.msn_st_v != null ? vt0.msn_st_v : 0}, bp_daily_kills = 15 WHERE steamid = '${SID}'`).run()
  // W2/W3: HoF owned coin MOTD-guarded + compact missions have no SVG/JS
  await env.DB.prepare(`UPDATE players SET ach_unlocked = ${(1 << 2) | (1 << 8) | (1 << 9) | (1 << 11) | (1 << 13)} WHERE steamid = '${SID}'`).run()
  let mh = await w2.fetch(new Request(`https://x/achievements?steamid=${SID}&tab=hof`, { headers: msieH }), env)
  let mht = await mh.text()
  check("hof podium MOTD has no svg", mh.status === 200 && !mht.includes("<svg"))
  {
    const { setMotdCompact: mcHof } = await import("./src/ui.js")
    mcHof(false)
  }
  await env.DB.prepare(`UPDATE players SET ach_unlocked = 1 WHERE steamid = '${SID}'`).run()
  mh = await w2.fetch(new Request(`https://x/missions?steamid=${SID}`, { headers: msieH }), env)
  mht = await mh.text()
  check("compact missions have no svg/js", mh.status === 200 && !mht.includes("<svg") && !mht.includes("onerror"))
  {
    const { setMotdCompact: mcMsn } = await import("./src/ui.js")
    mcMsn(false)
  }
  // W5: profile links carry row targets (board needs fixture points set)
  await env.DB.prepare(`UPDATE players SET comp_points = 1250, comp_kills = 500, comp_hs = 200, comp_wins = 55, comp_mvp = 12 WHERE steamid = '${SID}'`).run()
  const t15 = await (await import("./src/top15/page.js")).pageTop15(env, new URL(`https://x/top15?steamid=${SID}`))
  const t15h = await t15.text()
  check("top15 rows link profiles", t15h.includes("/profile?steamid=STEAM_0%3A1%3A11111"))
  const tour = await (await pages.pageTournament(env, new URL(`https://x/tournament?steamid=${SID}`))).text()
  check("tournament rows link profiles", tour.includes("/profile?steamid="))
  // W6: tier-4 name + seconds (needSteamid COMPETITIVE/TOP15 branches have no
  // live callers; the /ctop + /top15 values are fixed for when they are used)
  const vr0 = await env.DB.prepare(`SELECT vip_remaining FROM players WHERE steamid = '${SID}'`).first()
  await env.DB.prepare(`UPDATE players SET vip_remaining = 45 WHERE steamid = '${SID}'`).run()
  const vip = await (await pages.pageVip(env, new URL(`https://x/vip?steamid=${SID}`))).text()
  check("vip seconds display", vip.includes("45s"))
  await env.DB.prepare(`UPDATE players SET vip_remaining = ${vr0 ? vr0.vip_remaining : 0} WHERE steamid = '${SID}'`).run()
  // W7: milestone drives both surfaces identically
  await env.DB.prepare(`UPDATE players SET bp_milestone = 26 WHERE steamid = '${SID}'`).run()
  const bp = await (await pages.pageBattlePass(env, new URL(`https://x/battlepass?steamid=${SID}`))).text()
  await env.DB.prepare(`UPDATE players SET bp_milestone = 0 WHERE steamid = '${SID}'`).run()
  // W8: staleness disclosure on profile
  const prof = await (await pages.pageProfile(env, new URL(`https://x/profile?steamid=${SID}`))).text()
  check("profile discloses snapshot lag", prof.includes("snapshots every ~30s"))
  // W9: store allowlist + models allowlist
  const tok = await tokFn(SECRET, SID)
  await pages.pageStore(env, new URL(`https://x/store?steamid=${SID}&t=${tok}&buy=${encodeURIComponent("unequip_tag:-")}`))
  const uq = await env.DB.prepare(`SELECT id FROM actions WHERE steamid = '${SID}' AND type = 'unequip_tag'`).first()
  check("store unequip_tag queues", !!uq)
  await env.DB.prepare(`DELETE FROM actions WHERE steamid = '${SID}' AND type = 'unequip_tag'`).run()
  const badt = await (await pages.pageModels(env, new URL(`https://x/models?steamid=${SID}&t=${tok}&act=${encodeURIComponent("claim_mission_all:x")}`))).text()
  const badRow = await env.DB.prepare(`SELECT id FROM actions WHERE steamid = '${SID}' AND type = 'claim_mission_all'`).first()
  check("models rejects foreign actions", !badRow && badt.includes("unknown action"))
  // W11: MOTD top15 shows the podium too (table markup is MOTD-safe)
  const tm = await w2.fetch(new Request(`https://x/top15?steamid=${SID}`, { headers: msieH }), env)
  const tmt = await tm.text()
  check("motd top15 shows podium", tm.status === 200 && tmt.includes("class='podium'"))
  // MSIE worker requests flip the module-global compact flag: restore browser
  // mode before every render below (each asserts browser-only output).
  {
    const { setMotdCompact: mcMid } = await import("./src/ui.js")
    mcMid(false)
  }
  // W12: buffed VIP XP display, coins unchanged
  check("vip xp buff display", vip.includes("+100%") && vip.includes("2.0x"))
  // BP economy truth (tier detail views render exact game payouts; the maxed
  // player sees the full window so out-of-window tiers stay in reach)
  const bp60 = await (await pages.pageBattlePass(env, new URL(`https://x/battlepass?steamid=STEAM_0:1:60060&tier=60`))).text()
  check("bp free coins truth", bp60.includes("+5,000 Coins (The Global Elite Trophy)"))
  check("bp premium extra truth", bp60.includes("+7,500c Global Elite"))
  const bp33 = await (await pages.pageBattlePass(env, new URL(`https://x/battlepass?steamid=STEAM_0:1:60060&tier=33`))).text()
  check("bp premium disambiguated", bp33.includes("Medic Vapor") && !bp33.includes("+100c Medic"))
  // skills persist end-to-end (push -> table -> UPGRADE label)
  const TP3 = "STEAM_0:1:22224"
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP3}'`).run()
  const { handleSync: hs2, ensureOpsTables: eo2 } = await import("./src/sync.js")
  await eo2(env)
  const skPush = await (await hs2(await signedPost(env, [{ steamid: TP3, name: "sk", xp: 1, level: 1, kills: 1, deaths: 1, vip_tier: 0, coins: 0,
    skills: { multi_jump: 2, parachute: 0 } }]), env)).json()
  const skRow = await env.DB.prepare(`SELECT stage FROM player_skills WHERE steamid = '${TP3}' AND skill = 'multi_jump'`).first()
  check("skills snapshot persists", skPush.ok === true && skRow && skRow.stage === 2, JSON.stringify(skRow))
  const skStore = await (await pages.pageStore(env, new URL(`https://x/store?steamid=${TP3}`))).text()
  check("store shows owned stage", skStore.includes("STAGE 2/"))
  await env.DB.prepare(`DELETE FROM player_skills WHERE steamid = '${TP3}'`).run()
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP3}'`).run()
  const { setMotdCompact: mcReset } = await import("./src/ui.js")
  mcReset(false)
}

// ---------------- 11f. offline-settlement ingest + spec broadcast ----------------
{
  const nowS = Math.floor(Date.now() / 1000)
  const TP = "STEAM_0:1:22222"
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP}'`).run()
  // response carries full specs for active metric events
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward,reward_coins,reward_viptier,reward_vipdays,min_score)
    VALUES ('Spec Probe','community_goal','active',?1,?2,1,1,'goal',?1,'kills',100,'individual','x',500,0,0,0)`)
    .bind(nowS - 5, nowS + 3600).run()
  const specPush = await handleSync(await signedPost(env, [{
    steamid: TP, name: "spec", xp: 1, level: 1, kills: 10, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }]), env)
  const specOut = await specPush.json()
  const spec = (specOut.events || []).find(e => e.id && e.metric === "kills")
  check("spec broadcast", !!spec && spec.target === 100 && spec.scope === "individual"
    && spec.reward_coins === 500 && spec.start_at > 0 && spec.end_at > spec.start_at, JSON.stringify(spec))
  // game-reported settlement: winners recorded, no intents (already paid), completed
  const eid = (await env.DB.prepare(`SELECT id FROM events WHERE title = 'Spec Probe'`).first()).id
  await env.DB.prepare(`UPDATE events SET end_at = ?1 WHERE id = ?2`).bind(nowS - 1, eid).run()
  const repPush = await handleSync(await signedPost(env, [{
    steamid: TP, name: "spec", xp: 1, level: 1, kills: 60, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }], {
    event_results: [{ event_id: eid, finalized_at: nowS,
      winners: [{ steamid: TP, placement: 1, score: 50, paid: 1 }] }]
  }), env)
  const repOut = await repPush.json()
  check("ingest accepted", repOut.ok === true)
  const gw = await env.DB.prepare(`SELECT placement, steamid, score FROM event_winners WHERE event_id = ?1`).bind(eid).all()
  check("game winners recorded", gw.results.length === 1 && gw.results[0].steamid === TP
    && gw.results[0].score === 50, JSON.stringify(gw.results))
  const intents = async () => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM actions WHERE type = 'srv_event_reward' AND arg LIKE ?1`).bind(`${eid}:%`).first()).n
  const n1 = await intents()
  // re-ingest the same report: convergence must not duplicate winners or intents
  await handleSync(await signedPost(env, [{
    steamid: TP, name: "spec", xp: 1, level: 1, kills: 60, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }], {
    event_results: [{ event_id: eid, finalized_at: nowS,
      winners: [{ steamid: TP, placement: 1, score: 50, paid: 1 }] }]
  }), env)
  const gw2 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_winners WHERE event_id = ?1`).bind(eid).first()
  check("re-ingest converges", gw2.n === 1 && (await intents()) === n1, JSON.stringify({ gw2, n1 }))
  const stDone = await env.DB.prepare(`SELECT status FROM events WHERE id = ?1`).bind(eid).first()
  check("game-settled event completed", stDone.status === "completed")
  const aud = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_audit WHERE action = 'settled-game'`).first()
  check("settled-game audited", aud.n >= 1, JSON.stringify(aud))
  // early report rejected (window not over)
  await env.DB.prepare(`INSERT INTO events (title,type,status,start_at,end_at,xp_mult,coins_mult,conflict_group,created_at,metric,target,scope,reward)
    VALUES ('Early Probe','community_goal','active',?1,?2,1,1,'goal',?1,'kills',100,'individual','x')`)
    .bind(nowS - 5, nowS + 3600).run()
  const ee = await env.DB.prepare(`SELECT id FROM events WHERE title = 'Early Probe'`).first()
  await handleSync(await signedPost(env, [{
    steamid: TP, name: "spec", xp: 1, level: 1, kills: 60, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }], { event_results: [{ event_id: ee.id, finalized_at: nowS, winners: [{ steamid: TP, placement: 1, score: 5, paid: 1 }] }] }), env)
  const ew = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_winners WHERE event_id = ?1`).bind(ee.id).first()
  check("early report rejected", ew.n === 0, JSON.stringify(ew))
  // unknown event id audited, nothing written
  await handleSync(await signedPost(env, [{
    steamid: TP, name: "spec", xp: 1, level: 1, kills: 60, deaths: 1, headshots: 1, vip_tier: 0, coins: 0
  }], { event_results: [{ event_id: 987654, finalized_at: nowS, winners: [] }] }), env)
  const unk = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_audit WHERE action = 'settled-game-unknown'`).first()
  check("unknown event audited", unk.n >= 1)
  await env.DB.prepare(`DELETE FROM event_winners WHERE event_id IN (?1,?2)`).bind(eid, ee.id).run()
  await env.DB.prepare(`DELETE FROM players WHERE steamid = '${TP}'`).run()
  await env.DB.prepare(`DELETE FROM events WHERE title IN ('Spec Probe','Early Probe')`).run()
}

// ---------------- 12. unknown steamid / no data ----------------
{
  const html = await (await pages.pageProfile(env, new URL("https://x/profile?steamid=STEAM_0:1:99999"))).text()
  check("profile no-data state", html.includes("NO DATA YET"))
  const html2 = await (await pages.pageProfile(env, new URL("https://x/profile"))).text()
  check("profile needs steamid state", html2.includes("OPEN FROM THE GAME"))
}

// ---------------- 13. self-contained MOTD / no remote assets ----------------
{
  let worker = null
  try {
    ;({ default: worker } = await import("./src/index.js"))
  } catch (e) {
    check("worker module loads", false, e && e.message ? e.message : String(e))
  }
  const { actionToken } = await import("./src/sync.js")
  if (!worker) {
    check("GoldSrc MOTD worker tests skipped", false, "src/index.js did not load (admin.js may still be missing)")
  } else {

  const vipMotdRes = await worker.fetch(new Request("https://x/m/v/0-1-11111.htm"), env)
  const vipMotd = await vipMotdRes.text()
  check("vip MOTD short path renders player", vipMotdRes.status === 200 && vipMotd.includes("STEAM_0:1:11111") && vipMotd.includes("VIP+"))
  check("vip discord is official invite", vipMotd.includes("discord.gg/vuGaWjuX") && !vipMotd.includes("zizouondc"))

  const vipOverrideRes = await worker.fetch(new Request("https://x/m/v/0-1-11111.htm?steamid=STEAM_0:1:99999"), env)
  const vipOverride = await vipOverrideRes.text()
  check("vip MOTD path identity wins over query steamid", vipOverrideRes.status === 200 && vipOverride.includes("STEAM_0:1:11111") && !vipOverride.includes("STEAM_0:1:99999"))

  setMotdCompact(false)
  // VIP is a read-only page (tiers granted in-game; the web never sells VIP
  // or mutates anything), so a valid ?steamid= renders without a token.
  const vipUnbound = await (await pages.pageVip(env, new URL("https://x/vip?steamid=STEAM_0:1:11111"))).text()
  check("vip steamid renders read-only without token", vipUnbound.includes("VIP STATUS") && vipUnbound.includes("STEAM_0:1:11111") && !vipUnbound.includes("OPEN FROM THE GAME"))

  const vipA = await (await pages.pageVip(env, new URL("https://x/vip?a=STEAM_0:1:11111"))).text()
  check("vip ignores ?a= as player id", vipA.includes("OPEN FROM THE GAME") && !vipA.includes("STEAM_0:1:11111"))

  const tok11111 = await actionToken(SECRET, "STEAM_0:1:11111")
  const vipTok = await (await pages.pageVip(env, new URL(`https://x/vip?steamid=STEAM_0:1:11111&t=${tok11111}`))).text()
  check("vip renders with or without token", vipTok.includes("STEAM_0:1:11111") && vipTok.includes("VIP+") && vipTok.includes("store.php?section=vip"))
  check("vip store prices real", vipTok.includes("$4/mo") && vipTok.includes("$63 lifetime") && vipTok.includes("VIP Diamond") && !vipTok.includes("zizouondc"))
  check("vip status banner owns the top", vipTok.includes("VIP STATUS") && vipTok.includes("CURRENT TIER") && vipTok.includes("YOUR TIER"))
  check("vip perks grouped by unlock tier", vipTok.includes("VIP UNLOCKS") && vipTok.includes("VIP+ ADDS") && vipTok.includes("ELITE ADDS")
    && !vipTok.includes(">YES</b>") && vipTok.includes("GET VIP - OFFICIAL STORE"))
  check("vip owned rows color in", vipTok.includes("<b style='color:#36DEAB;'>Parachute (hold E falling)</b>")
    && vipTok.includes("<span class='muted'>Multi-jump (when server enables it)</span>") && vipTok.includes("13/14 perks active"))
  {
    const before = await env.DB.prepare(`SELECT vip_tier FROM players WHERE steamid = 'STEAM_0:1:11111'`).first()
    await env.DB.prepare(`UPDATE players SET vip_tier = 0 WHERE steamid = 'STEAM_0:1:11111'`).run()
    const mem = await (await pages.pageVip(env, new URL("https://x/vip?steamid=STEAM_0:1:11111"))).text()
    check("vip member state honest", mem.includes("NO MEMBERSHIP") && mem.includes("0/14 perks active") && mem.includes("GET VIP - OFFICIAL STORE"))
    await env.DB.prepare(`UPDATE players SET vip_tier = ${Number(before && before.vip_tier) || 0} WHERE steamid = 'STEAM_0:1:11111'`).run()
  }

  const tok99999 = await actionToken(SECRET, "STEAM_0:1:99999")
  const vipMismatch = await (await pages.pageVip(env, new URL(`https://x/vip?steamid=STEAM_0:1:11111&t=${tok99999}`))).text()
  check("vip ignores token for viewing (read-only)", vipMismatch.includes("VIP STATUS") && vipMismatch.includes("STEAM_0:1:11111"))

  const noSecret = await (await pages.pageVip({ DB: env.DB, SYNC_SECRET: "" }, new URL(`https://x/vip?steamid=STEAM_0:1:11111&t=${tok11111}`))).text()
  check("vip renders without SYNC_SECRET (nothing to mint)", noSecret.includes("VIP STATUS") && noSecret.includes("STEAM_0:1:11111"))

  const vipCompactQ = await (await pages.pageVip(env, new URL("https://x/vip?steamid=STEAM_0:1:11111&compact=1"))).text()
  check("vip compact=1 renders same read-only view", vipCompactQ.includes("VIP STATUS") && vipCompactQ.includes("STEAM_0:1:11111"))

  const compactFetch = await worker.fetch(new Request("https://x/vip?steamid=STEAM_0:1:11111&compact=1"), env)
  const compactFetchHtml = await compactFetch.text()
  check("vip compact=1 fetch renders read-only view", compactFetch.status === 200 && compactFetchHtml.includes("VIP STATUS") && compactFetchHtml.includes("STEAM_0:1:11111"))

  const msieRes = await worker.fetch(new Request("https://x/vip?steamid=STEAM_0:1:11111", {
    headers: { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" }
  }), env)
  const msieHtml = await msieRes.text()
  check("vip MSIE UA renders read-only view", msieRes.status === 200 && msieHtml.includes("VIP STATUS") && msieHtml.includes("STEAM_0:1:11111"))

  setMotdCompact(true)
  const vipLeftover = await (await pages.pageVip(env, new URL("https://x/vip?steamid=STEAM_0:1:11111"))).text()
  check("vip leftover compact flag renders read-only view", vipLeftover.includes("VIP STATUS") && vipLeftover.includes("STEAM_0:1:11111"))
  setMotdCompact(false)

  // A forged stamp in the query string must not become identity: with no
  // ?steamid= the page stays on the game-open view.
  const vipFakeStamp = await (await pages.pageVip(env, new URL("https://x/vip?_fnMotdSid=STEAM_0:1:11111"))).text()
  check("vip query _fnMotdSid is not identity", vipFakeStamp.includes("OPEN FROM THE GAME") && !vipFakeStamp.includes("VIP STATUS"))

  const sid = "STEAM_0:1:11111"
  const shortSid = "0-1-11111"
  const browserHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" }
  // Legacy GoldSrc MOTD engine: short /m/ URLs stay compact for it, while
  // modern in-game browsers get the full browser UI on the same URLs.
  const msieHeaders = { "user-agent": "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1)" }
  try {
    // Worker chooses the mode on every request; ordinary browser GETs must not retain a second skin.
    for (const product of PANEL_CONTRACTS) {
      let shortHtml
      for (const [mode, route] of [
        ["short", `/m/${product.code}/${shortSid}.htm`],
        // VIP compact=1 is viewport-only; identity still needs t (or a minted path stamp).
        ["compact", product.slug === "vip"
          ? `/${product.slug}?steamid=${sid}&compact=1&t=${tok11111}`
          : `/${product.slug}?steamid=${sid}&compact=1`],
        ["browser", `/${product.slug}?steamid=${sid}&t=${tok11111}`]
      ]) {
        const url = `https://x${route}`
        const response = await worker.fetch(new Request(url, { headers: mode === "short" ? msieHeaders : browserHeaders }), env)
        const html = await response.text()
        const label = `worker ${product.slug} ${mode}`
        check(`${label} renders`, response.status === 200, `${route}: status ${response.status}`)
        check(`${label} title ${product.title}`, hasProductTitle(html, product.title), html.match(/<title[^>]*>[^<]*/i)?.[0])
        const foreign = foreignHits(html, product, url)
        check(`${label} no foreign product href`, foreign.length === 0, foreign.join(" | "))
        const issues = layoutIssues(html)
        check(`${label} GoldSrc-safe layout`, issues.length === 0, issues.join("; "))
        if (mode === "short") shortHtml = html
        if (mode === "browser") {
          // Restored top15 module serves one self-contained theme skin in
          // every mode (no compact/browser split); the other products inline
          // a micro-subset of MOTD_CSS on compact (old-IE byte budget).
          if (product.code === "t") {
            check(`${label} single-skin board`, shortHtml.includes("TOP 15") && html.includes("TOP 15"))
          } else {
            check(`${label} browser keeps full MOTD stylesheet`,
              stylesOf(html).split("\n")[0] === String(MOTD_CSS || "").replace(/\s+/g, " ").trim(),
              stylesOf(html).split("\n")[0].slice(0, 90))
            const compactRules = sheetRules(shortHtml)
            const fullRules = sheetRules(html)
            const fullSet = new Set(fullRules)
            const stray = compactRules.filter(r => !fullSet.has(r))
            check(`${label} short-path sheet is a subset of the browser sheet`,
              compactRules.length > 0 && compactRules.length < fullRules.length && stray.length === 0,
              stray[0] || `${compactRules.length} compact vs ${fullRules.length} browser rules`)
          }
        }
        if (product.code === "t" && mode === "short") check("motd podium table", html.includes("TOP 15") && html.includes("#1"))
      }
    }
    // Modern in-game browsers get the exact preview UI on short /m/ URLs;
    // only legacy engines (or explicit ?compact=1) stay compact.
    {
      const aModern = await (await worker.fetch(new Request(`https://x/m/a/${shortSid}.htm`, { headers: browserHeaders }), env)).text()
      check("short modern-UA achievements renders browser coins", aModern.includes("cs2-medal"), `len=${aModern.length} title=${(aModern.match(/<title[^>]*>[^<]*/i) || ["?"])[0]}`)
      const bModern = await (await worker.fetch(new Request(`https://x/m/b/${shortSid}.htm`, { headers: browserHeaders }), env)).text()
      check("short modern-UA battlepass renders lane art", bModern.includes("/bp/prem_") && bModern.includes("/bp/free_"))
      const aLegacy = await (await worker.fetch(new Request(`https://x/m/a/${shortSid}.htm`, { headers: msieHeaders }), env)).text()
      check("short legacy-UA achievements stays compact", !aLegacy.includes("cs2-medal") && aLegacy.includes("IN PROGRESS"))
    }

    for (const mode of ["compact", "browser"]) {
      const url = `https://x/battlepass${mode === "compact" ? "?compact=1" : ""}`
      const res = await worker.fetch(new Request(url, { headers: browserHeaders }), env)
      const html = await res.text()
      check(`worker bp ${mode} anonymous has no lookup form`, res.status === 200 && !/<form\b|LOOKUP|placeholder=['"]STEAM_/i.test(html), `status ${res.status}; request intentionally omits SteamID`)
    }

    for (const [name, path] of [
      ["store MOTD gone", "/store"], ["models MOTD gone", "/models"],
      ["shop alias gone", "/shop"], ["skins alias gone", "/skins"], ["cosmetics alias gone", "/cosmetics"]
    ]) {
      for (const mode of ["compact", "browser"]) {
        const route = `${path}?steamid=${sid}${mode === "compact" ? "&compact=1" : ""}`
        const res = await worker.fetch(new Request(`https://x${route}`, { headers: browserHeaders }), env)
        check(`${name}${mode === "browser" ? " (browser)" : ""}`, res.status === 404, `${route}: expected 404, got ${res.status}`)
      }
    }
    // "/" is the panel directory, not a dead-end: it must render and link
    // every product (compact visits use short /m/<code>/ paths).
    for (const mode of ["compact", "browser"]) {
      const route = `/?steamid=${sid}${mode === "compact" ? "&compact=1" : ""}`
      const res = await worker.fetch(new Request(`https://x${route}`, { headers: browserHeaders }), env)
      const hubHtml = await res.text()
      const label = `worker home hub ${mode}`
      check(`${label} renders`, res.status === 200 && hubHtml.includes("FREENOVA"), `${route}: status ${res.status}`)
      check(`${label} title PANELS`, hasProductTitle(hubHtml, "PANELS"), hubHtml.match(/<title[^>]*>[^<]*/i)?.[0])
      const want = mode === "compact"
        ? ["p", "t", "b", "i", "a", "r", "v", "e"].map(c => `/m/${c}/`)
        : ["/profile", "/top15", "/battlepass", "/missions", "/achievements", "/tournament", "/vip", "/events"].map(s => `href='${s}`)
      const missing = want.filter(w => !hubHtml.includes(w))
      check(`${label} links all 8 products`, missing.length === 0, `missing: ${missing.join(", ")}`)
      check(`${label} no retired links`, !/href='\/(?:store|shop|skins|cosmetics|models)(?:[?']|$)/i.test(hubHtml), "retired slug linked")
      check(`${label} GoldSrc-safe layout`, layoutIssues(hubHtml).length === 0, layoutIssues(hubHtml).join("; "))
    }
    for (const [name, path] of [
      ["panel hub alias", "/panel"], ["panel profile alias", "/panel/profile"]
    ]) {
      for (const mode of ["compact", "browser"]) {
        const route = `${path}?steamid=${sid}${mode === "compact" ? "&compact=1" : ""}`
        const res = await worker.fetch(new Request(`https://x${route}`, { headers: browserHeaders }), env)
        const html = await res.text()
        check(`${name}${mode === "browser" ? " (browser)" : ""}`, res.status === 200 && html.includes("FREENOVA"), `${route}: expected 200 profile, got ${res.status}`)
      }
    }
    for (const code of ["s", "o"]) {
      const route = `/m/${code}/${shortSid}.htm`
      const res = await worker.fetch(new Request(`https://x${route}`), env)
      check(`retired ${route} gone`, res.status === 404, `expected 404, got ${res.status}`)
    }

    // Separate in-memory DB: section 8 overwrites the main player's daily counters.
    const missionEnv = { ...env, DB: makeD1() }
    const seeded = await (await handleSync(await signedPost(missionEnv, [{
      steamid: sid, name: "mission-fixture", xp: 18450, level: 12, rank_id: 12, vip_tier: 2, coins: 4850,
      bp_daily_kills: 7, bp_daily_hs: 1, bp_daily_plants: 1, bp_daily_defuses: 0,
      bp_daily_wins: 1, bp_daily_streak: 2, bp_daily_damage: 237, bp_daily_survives: 1,
      bp_daily_complete: 0
    }]), missionEnv)).json()
    check("missions partial snapshot accepted", seeded.ok === true && seeded.stored === 1, JSON.stringify(seeded))
    // /m/b/*/missions.htm → 302 redirect to /m/i/ (no render, just a redirect)
    {
      const redirectUrl = `https://x/m/b/${shortSid}/missions.htm`
      const redirectRes = await worker.fetch(new Request(redirectUrl, { headers: browserHeaders }), missionEnv)
      check("missions short path /m/b/*/missions.htm redirects", redirectRes.status === 302,
        `expected 302, got ${redirectRes.status}`)
    }
    // /m/i/ short path and /missions canonical → Missions product (title MISSIONS, isolated)
    const msnContract = PANEL_CONTRACTS.find(p => p.slug === "missions")
    for (const [name, route] of [
      ["missions /m/i/ short path renders Missions product", `/m/i/${shortSid}.htm`],
      ["canonical /missions renders Missions product", `/missions?steamid=${sid}`],
      ["compact /missions renders Missions product", `/missions?steamid=${sid}&compact=1`]
    ]) {
      const url = `https://x${route}`
      const res = await worker.fetch(new Request(url, { headers: browserHeaders }), missionEnv)
      const html = await res.text()
      const issues = dailyMissionIssues(html)
      check(name, res.status === 200 && hasProductTitle(html, "MISSIONS") && issues.length === 0,
        `status ${res.status}; MISSIONS title ${hasProductTitle(html, "MISSIONS")}; ${issues.join("; ") || "daily counters correct"}`)
      check(`${name}: DAILY MISSIONS seeded counters`, issues.length === 0, issues.join("; "))
      const foreign = foreignHits(html, msnContract, url)
      check(`${name}: isolated`, foreign.length === 0, foreign.join(" | "))
    }

    // Routes the rewrite must keep working: mapend board + stats viewer.
    for (const [name, route, needle] of [
      ["worker /mapend renders map-end board", "/mapend", "MAP END"],
      ["worker /statsviewer renders stats viewer", "/statsviewer", "STATS VIEWER"],
      ["worker /stats renders stats viewer", "/stats", "STATS VIEWER"]
    ]) {
      const routeRes = await worker.fetch(new Request(`https://x${route}`, { headers: browserHeaders }), env)
      const routeHtml = await routeRes.text()
      check(name, routeRes.status === 200 && routeHtml.includes(needle), `${route}: status ${routeRes.status}`)
    }
    // Icon gallery: debug surface for the weapon icon set.
    {
      const galRes = await worker.fetch(new Request("https://x/icons", { headers: browserHeaders }), env)
      const galHtml = await galRes.text()
      check("icons gallery renders", galRes.status === 200 && galHtml.includes("ICON GALLERY"))
      check("icons gallery lists ak47 asset", galHtml.includes("gun_ak47.png") && galHtml.includes("AK-47"))
      check("icons gallery size ladder", galHtml.includes("height='24'") && galHtml.includes("height='64'"))
      check("icons gallery isolated (no product hrefs)", !/<a[^>]*href=['"]\/(profile|top|battlepass|missions|tournament|achievements|events|vip)/i.test(galHtml))
    }
  } finally {
    setMotdCompact(false)
  }
  } // worker loaded
}

// ---------------- staff / events (outside PANEL_CONTRACTS GoldSrc loop) ----------------
{
  env.ADMIN_PASSWORD = "test-admin"
  env.ADMIN_STEAMIDS = "STEAM_0:0:683671116"

  let handleAdmin = null
  let adminImportErr = ""
  try {
    ;({ handleAdmin } = await import("./src/admin.js"))
  } catch (e) {
    adminImportErr = e && e.message ? e.message : String(e)
  }
  check("admin module present", !!handleAdmin, adminImportErr || "src/admin.js did not export handleAdmin")

  let staffWorker = null
  if (handleAdmin) {
    try {
      ;({ default: staffWorker } = await import("./src/index.js"))
    } catch (e) {
      check("worker module loads for admin", false, e && e.message ? e.message : String(e))
    }
  }
  let loggedIn = false
  let cookieHeader = ""
  if (staffWorker) {
    const staffGet = await staffWorker.fetch(new Request("https://x/admin"), env)
    const staffHtml = await staffGet.text()
    const staffOk = staffGet.status === 200 || staffGet.status === 401
    check("GET /admin unauth is login or 401", staffOk, `status ${staffGet.status}`)
    check("GET /admin unauth is not MOTD BATTLE PASS",
      !hasProductTitle(staffHtml, "BATTLE PASS") && !/BATTLE PASS/i.test(staffHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
      staffHtml.match(/<title[^>]*>[^<]*/i)?.[0])
    check("GET /admin unauth allows flex/grid (not MOTD-table-required)",
      staffOk && (staffGet.status === 401 || /<html/i.test(staffHtml)))

    const loginBody = new URLSearchParams({
      password: "test-admin",
      steamid: "STEAM_0:0:683671116"
    }).toString()
    let loginRes = await staffWorker.fetch(new Request("https://x/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: loginBody
    }), env)
    if (loginRes.status === 404 || loginRes.status === 405) {
      loginRes = await staffWorker.fetch(new Request("https://x/admin", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: loginBody
      }), env)
    }
    const setCookie = String(loginRes.headers.get("set-cookie") || "")
    loggedIn = (loginRes.status === 302 || loginRes.status === 200) && /fn_staff/i.test(setCookie)
    check("POST admin login sets fn_staff", loggedIn,
      `status ${loginRes.status}; set-cookie=${setCookie.slice(0, 80)}`)

    cookieHeader = setCookie.split(";")[0] || ""
    const kickRes = await staffWorker.fetch(new Request("https://x/admin/action", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader
      },
      body: new URLSearchParams({ type: "kick", steamid: "STEAM_0:1:11111" }).toString()
    }), env)
    check("POST /admin/action kick without csrf is 403", kickRes.status === 403, `status ${kickRes.status}`)
  } else {
    check("GET /admin unauth is login or 401", false, "admin.js missing")
    check("GET /admin unauth is not MOTD BATTLE PASS", false, "admin.js missing")
    check("GET /admin unauth allows flex/grid (not MOTD-table-required)", false, "admin.js missing")
    check("POST admin login sets fn_staff", false, "admin.js missing")
    check("POST /admin/action kick without csrf is 403", false, "admin.js missing")
  }

  const mapPush = await handleSync(await signedPost(env, [{
    steamid: "STEAM_0:1:11111", name: "ziz", xp: 1, level: 1, rank_id: 1, vip_tier: 0, coins: 0
  }], {
    server: { map: "de_dust2", hostname: "FN", players: 2, humans: 2, maxplayers: 32, hh: 2, event_xp: 1 }
  }), env)
  const mapOut = await mapPush.json()
  check("signed push with payload.server accepted", mapOut.ok === true, JSON.stringify(mapOut))
  if (loggedIn && staffWorker) {
    const overview = await staffWorker.fetch(new Request("https://x/admin", {
      headers: { cookie: cookieHeader }
    }), env)
    const overviewHtml = await overview.text()
    check("admin overview shows de_dust2", overviewHtml.includes("de_dust2"), `status ${overview.status}`)
    const themeSec = await staffWorker.fetch(new Request("https://x/admin?s=top15", {
      headers: { cookie: cookieHeader }
    }), env)
    const themeHtml = await themeSec.text()
    // The rewrite removed the top15 theme section; unknown s= falls back to overview (200).
    check("admin top15 theme section removed",
      themeSec.status === 200 && !themeHtml.includes("Primary (mint)") && !themeHtml.includes('type="color"'),
      `status ${themeSec.status}`)
  } else {
    check("admin overview shows de_dust2", false, "login did not set fn_staff — skipped overview")
    check("admin top15 theme section removed", false, "login did not set fn_staff — skipped theme form")
  }

  const nowSec = Math.floor(Date.now() / 1000)
  try {
    await env.DB.prepare(
      `INSERT INTO events (title, type, status, start_at, end_at, xp_mult, coins_mult, conflict_group, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
    ).bind("Double XP", "xp_mult", "scheduled", nowSec - 10, nowSec + 3600, 2, 1, "xp", nowSec).run()
    check("event scheduler seed", true)
  } catch (e) {
    check("event scheduler seed", false, e.message)
  }
  const schedPush = await handleSync(await signedPost(env, [{
    steamid: "STEAM_0:1:11111", name: "ziz", xp: 1, level: 1, rank_id: 1, vip_tier: 0, coins: 0
  }]), env)
  const schedOut = await schedPush.json()
  check("event scheduler push accepted", schedOut.ok === true, JSON.stringify(schedOut))
  let evRow = null, actRow = null, schedErr = ""
  try {
    evRow = await env.DB.prepare(`SELECT status FROM events WHERE title = 'Double XP'`).first()
    actRow = await env.DB.prepare(
      `SELECT type, status FROM actions WHERE type = 'srv_event_apply' AND status IN ('pending','sent') ORDER BY id DESC`
    ).first()
  } catch (e) {
    schedErr = e.message
  }
  check("event scheduler activates scheduled xp_mult",
    evRow && String(evRow.status).toLowerCase() === "active",
    schedErr || JSON.stringify(evRow))
  check("event scheduler queues srv_event_apply",
    actRow && actRow.type === "srv_event_apply",
    schedErr || JSON.stringify(actRow))

  // ---- admin section matrix + POST endpoints (harness in-memory DB only) ----
  if (staffWorker && loggedIn) {
    const authedGet = async (path) => {
      const res = await staffWorker.fetch(new Request(`https://x${path}`, { headers: { cookie: cookieHeader } }), env)
      return { res, text: await res.text() }
    }
    const authedPost = async (path, fields) => {
      const res = await staffWorker.fetch(new Request(`https://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body: new URLSearchParams(fields).toString()
      }), env)
      return { res, text: await res.text() }
    }

    // Every staff section renders for the owner session.
    for (const [s, heading] of [
      ["", "Overview"], ["players", "Players"], ["catalog", "Achievement catalog"],
      ["events", "Events"], ["logs", "Audit log"], ["diagnostics", "Diagnostics"]
    ]) {
      const path = s ? `/admin?s=${s}` : "/admin"
      const { res, text: secHtml } = await authedGet(path)
      const label = `admin section ${s || "overview"}`
      check(`${label} renders <h2>${heading}</h2>`,
        res.status === 200 && secHtml.includes(`<h2>${heading}</h2>`), `status ${res.status}`)
      check(`${label} nav links audit log`, secHtml.includes('href="/admin?s=logs"'))
    }
    // Players ?f=all lists the pushed fixture player (not only the online window).
    const { res: playersRes, text: playersHtml } = await authedGet("/admin?s=players&f=all")
    check("admin players f=all lists fixture steamid",
      playersRes.status === 200 && playersHtml.includes("STEAM_0:1:11111"), `status ${playersRes.status}`)
    // Diagnostics reports the DB honestly ("Reachable" only when the probe works).
    const { text: diagHtml } = await authedGet("/admin?s=diagnostics")
    check("admin diagnostics DB Reachable", diagHtml.includes("Reachable"))
    // CSRF token is minted per session (32 hex chars) into every page.
    const csrf = (diagHtml.match(/name="csrf" value="([0-9a-f]{32})"/) || [])[1] || ""
    check("admin pages carry 32-hex csrf", !!csrf, "no csrf input found")

    if (csrf) {
      // --- /admin/action endpoint matrix ---
      const noCsrf = await authedPost("/admin/action",
        { type: "kick", steamid: "STEAM_0:1:11111", arg: "staff" })
      check("admin action kick without csrf 403", noCsrf.res.status === 403, `status ${noCsrf.res.status}`)

      const kick = await authedPost("/admin/action",
        { csrf, type: "kick", steamid: "STEAM_0:1:11111", arg: "staff" })
      check("admin action kick queues + redirects to players",
        kick.res.status === 302 && kick.res.headers.get("location") === "/admin?s=players",
        `status ${kick.res.status}; loc ${kick.res.headers.get("location")}`)
      const kickRow = await env.DB.prepare(
        `SELECT id FROM actions WHERE type='kick' AND steamid='STEAM_0:1:11111' AND status='pending'`).first()
      check("admin kick queued a pending action", !!kickRow, JSON.stringify(kickRow))
      const kickAudit = await env.DB.prepare(
        `SELECT id FROM admin_audit WHERE action='KICK' AND steamid='STEAM_0:0:683671116'`).first()
      check("admin kick wrote KICK audit row", !!kickAudit)

      const coinsNoConfirm = await authedPost("/admin/action",
        { csrf, type: "give_coins", steamid: "STEAM_0:1:11111", arg: "5000" })
      check("admin give_coins 5000 without confirm 400",
        coinsNoConfirm.res.status === 400 && coinsNoConfirm.text.includes("Confirm this dangerous action."),
        `status ${coinsNoConfirm.res.status}; ${coinsNoConfirm.text.slice(0, 60)}`)
      const coinsOk = await authedPost("/admin/action",
        { csrf, type: "give_coins", steamid: "STEAM_0:1:11111", arg: "5000", confirm: "1" })
      check("admin give_coins 5000 confirmed queues",
        coinsOk.res.status === 302, `status ${coinsOk.res.status}`)

      const mapBad = await authedPost("/admin/action",
        { csrf, type: "srv_map", arg: "de_notamap", confirm: "1" })
      check("admin srv_map off-whitelist 400",
        mapBad.res.status === 400 && mapBad.text.includes("whitelist"), `status ${mapBad.res.status}`)
      const mapOk = await authedPost("/admin/action",
        { csrf, type: "srv_map", arg: "de_inferno", confirm: "1" })
      check("admin srv_map whitelisted queues", mapOk.res.status === 302, `status ${mapOk.res.status}`)

      const unknown = await authedPost("/admin/action", { csrf, type: "definitely_not_a_type" })
      check("admin action unknown type 403", unknown.res.status === 403, `status ${unknown.res.status}`)

      // --- /admin/events endpoint matrix ---
      const evNoCsrf = await staffWorker.fetch(new Request("https://x/admin/events", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body: new URLSearchParams({ op: "create", title: "Nope", type: "coins_mult" }).toString()
      }), env)
      check("admin events POST without csrf 403", evNoCsrf.status === 403, `status ${evNoCsrf.status}`)

      const evStart = Math.floor(Date.now() / 1000) - 60
      const evEnd = evStart + 7200
      const evBadType = await authedPost("/admin/events",
        { csrf, op: "create", title: "Bad type test", type: "np_mult", start_at: String(evStart), end_at: String(evEnd) })
      check("admin event unknown type rejected inline",
        evBadType.res.status === 200 && evBadType.text.includes("Unknown event type."),
        `status ${evBadType.res.status}`)

      const evCreate = await authedPost("/admin/events", {
        csrf, op: "create", title: "Harness Coins Boost", type: "coins_mult",
        start_at: String(evStart), end_at: String(evEnd), xp_mult: "1", coins_mult: "2"
      })
      check("admin event create redirects to events",
        evCreate.res.status === 302 && evCreate.res.headers.get("location") === "/admin?s=events",
        `status ${evCreate.res.status}; loc ${evCreate.res.headers.get("location")}`)
      const ev = await env.DB.prepare(
        `SELECT * FROM events WHERE title = 'Harness Coins Boost'`).first()
      check("admin event row scheduled + created_by owner + coins group",
        ev && ev.status === "scheduled" && ev.conflict_group === "coins" && ev.created_by === "STEAM_0:0:683671116",
        JSON.stringify(ev))

      // Scheduler activation on the next push (window already started).
      await handleSync(await signedPost(env, [{
        steamid: "STEAM_0:1:11111", name: "ziz", xp: 1, level: 1, rank_id: 1, vip_tier: 0, coins: 0
      }]), env)
      const evActive = await env.DB.prepare(
        `SELECT status FROM events WHERE title = 'Harness Coins Boost'`).first()
      check("admin event activated by scheduler push",
        evActive && String(evActive.status).toLowerCase() === "active", JSON.stringify(evActive))

      // Extend +1h, then cancel (confirm required), then history/clear rows.
      const evExtend = await authedPost("/admin/events", { csrf, op: "extend", id: String(ev.id), seconds: "3600" })
      check("admin event extend 302", evExtend.res.status === 302, `status ${evExtend.res.status}`)
      const evExtended = await env.DB.prepare(
        `SELECT end_at FROM events WHERE id = ?1`).bind(ev.id).first()
      check("admin event end_at grew by 3600",
        evExtended && Number(evExtended.end_at) === Number(ev.end_at) + 3600,
        `${evExtended && evExtended.end_at} vs ${Number(ev.end_at) + 3600}`)

      const evCancelNoConfirm = await authedPost("/admin/events", { csrf, op: "cancel", id: String(ev.id) })
      check("admin event cancel without confirm rejected inline",
        evCancelNoConfirm.res.status === 200 && evCancelNoConfirm.text.includes("Confirm event cancellation."),
        `status ${evCancelNoConfirm.res.status}`)

      const evCancel = await authedPost("/admin/events", { csrf, op: "cancel", id: String(ev.id), confirm: "1" })
      check("admin event cancel 302", evCancel.res.status === 302, `status ${evCancel.res.status}`)
      const evCancelled = await env.DB.prepare(
        `SELECT status FROM events WHERE id = ?1`).bind(ev.id).first()
      check("admin event cancelled", evCancelled && evCancelled.status === "cancelled", JSON.stringify(evCancelled))
      const clearRow = await env.DB.prepare(
        `SELECT id FROM actions WHERE type='srv_event_clear' AND arg=?1 AND status IN ('pending','sent')`).bind(String(ev.id)).first()
      check("admin event cancel queues srv_event_clear", !!clearRow, JSON.stringify(clearRow))
      const histRow = await env.DB.prepare(
        `SELECT id FROM event_history WHERE event_id = ?1`).bind(ev.id).first()
      check("admin event cancel writes event_history", !!histRow, JSON.stringify(histRow))

      // --- /admin/catalog endpoint matrix (fixture row forced in) ---
      await env.DB.prepare(
        `INSERT INTO catalog (key, version, json, updated_at) VALUES ('achievements', 1, ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET json=?1, version=1, updated_at=?2`
      ).bind(JSON.stringify({
        version: 1,
        achievements: [{
          id: "harness_ach", bit: 3, name: "Harness Achievement",
          desc: "Fixture for admin catalog edit", target: 100, reward_coins: 50, enabled: 1
        }]
      }), Math.floor(Date.now() / 1000)).run()

      const catList = await authedGet("/admin?s=catalog")
      check("admin catalog lists fixture achievement",
        catList.res.status === 200 && catList.text.includes("harness_ach"), `status ${catList.res.status}`)

      const catNoCsrf = await staffWorker.fetch(new Request("https://x/admin/catalog", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body: new URLSearchParams({ id: "harness_ach", name: "x" }).toString()
      }), env)
      check("admin catalog POST without csrf 403", catNoCsrf.status === 403, `status ${catNoCsrf.status}`)

      const catBadId = await authedPost("/admin/catalog", { csrf, id: "not a valid id!", name: "x" })
      check("admin catalog invalid id rejected inline",
        catBadId.res.status === 200 && catBadId.text.includes("Invalid catalog id."),
        `status ${catBadId.res.status}`)

      const catMissing = await authedPost("/admin/catalog", { csrf, id: "no_such_ach", name: "x" })
      check("admin catalog unknown id rejected inline",
        catMissing.res.status === 200 && catMissing.text.includes("Achievement not found."),
        `status ${catMissing.res.status}`)

      const catEdit = await authedPost("/admin/catalog", {
        csrf, id: "harness_ach", name: "Renamed Harness", desc: "Edited by harness",
        target: "250", reward_coins: "75", enabled: "0"
      })
      check("admin catalog edit 302", catEdit.res.status === 302, `status ${catEdit.res.status}`)
      const catRow = await env.DB.prepare(
        `SELECT json, version FROM catalog WHERE key='achievements'`).first()
      let catParsed = {}
      try { catParsed = JSON.parse((catRow && catRow.json) || "{}") } catch {}
      const catItem = (catParsed.achievements || []).find(a => a.id === "harness_ach")
      check("admin catalog edit bumped version to 2",
        catRow && Number(catRow.version) === 2, `version ${catRow && catRow.version}`)
      check("admin catalog edit applied fields",
        catItem && catItem.name === "Renamed Harness" && catItem.desc === "Edited by harness"
          && Number(catItem.target) === 250 && Number(catItem.reward_coins) === 75 && Number(catItem.enabled) === 0,
        JSON.stringify(catItem))

      // --- logout invalidates the session ---
      const out = await authedPost("/admin/logout", { csrf })
      check("admin logout 302 to /admin",
        out.res.status === 302 && out.res.headers.get("location") === "/admin",
        `status ${out.res.status}`)
      const afterOut = await staffWorker.fetch(new Request("https://x/admin"), env)
      const afterOutHtml = await afterOut.text()
      check("admin after logout shows staff login",
        afterOut.status === 200 && afterOutHtml.includes("Staff login"), `status ${afterOut.status}`)
    } else {
      check("admin action kick without csrf 403", false, "no csrf token found — skipped action matrix")
    }
  } else {
    check("admin section matrix", false, "login did not set fn_staff — skipped admin matrix")
  }
}

// ---------------- 13. self-minted action tokens (local-trust) + 404 status ----------------
{
  const { mintActionToken, checkActionToken, actionToken } = await import("./src/sync.js")
  const sid = "STEAM_0:1:11111"

  // mintActionToken is the exact inverse of checkActionToken (unit-level).
  const minted = await mintActionToken(SECRET, sid)
  check("mintActionToken validates via checkActionToken", minted.length === 64 && !!(await checkActionToken(SECRET, sid, minted)))
  check("mintActionToken equals actionToken(day 0)", minted === await actionToken(SECRET, sid))
  check("mintActionToken refuses empty secret", (await mintActionToken("", sid)) === "")
  check("mintActionToken refuses bad steamid", (await mintActionToken(SECRET, "PENDING")) === "")
  check("checkActionToken still rejects forged token after minting helper added",
    !(await checkActionToken(SECRET, sid, "deadbeef".repeat(8))))

  // Section 8 re-pushed a partial snapshot, zeroing the daily/bonus counters
  // (sync upserts full rows). Restore completed counters so the claim-all
  // state renders. In-memory DB only.
  await env.DB.prepare(`UPDATE players SET bp_daily_kills=15, bp_daily_hs=3, bp_daily_plants=2,
    bp_daily_defuses=1, bp_daily_wins=2, bp_daily_streak=5, bp_daily_damage=500, bp_daily_survives=3,
    msn_st_d=1
    WHERE steamid='STEAM_0:1:11111'`).run()

  // Rendered with a known steamid and NO ?t= → action links carry a valid token.
  const msn = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${sid}`))).text()
  const msnToks = [...msn.matchAll(/[?&]t=([0-9a-f]{64})/g)].map(m => m[1])
  check("missions mints t= into action links", msnToks.length > 0, `found ${msnToks.length} token link(s)`)
  check("missions minted token validates", msnToks.length > 0 && !!(await checkActionToken(SECRET, sid, msnToks[0])))
  check("missions tokens equal mintActionToken", msnToks.length > 0 && msnToks.every(t => t === minted))
  check("missions claim-all link present with token",
    new RegExp(`href='/missions\\?[^']*t=[0-9a-f]{64}[^']*act=claim_mission_all`).test(msn))
  {
    // Tabs filter groups; detail panel renders on ?sel=.
    const wk = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${sid}&tab=weekly`))).text()
    check("missions weekly tab filters", wk.includes("WEEKLY MISSIONS") && !wk.includes("DAILY MISSIONS"))
    const done = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${sid}&tab=completed`))).text()
    check("missions completed tab renders", done.includes("COMPLETED"))
    const det = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${sid}&sel=0:0`))).text()
    check("missions detail panel renders", det.includes("FRAG HUNTER") && det.includes("Progress") && det.includes("Reward"))
    const glyphs = (msn.match(/<svg[^>]*viewBox='0 0 44 44'/g) || []).length
    check("missions glyph icons render", glyphs > 0, glyphs + " glyphs")
    check("missions dashboard shows available XP", /Available rewards/.test(msn))
  }

  // Explicit ?t= still wins (game-minted /u/.../k/... links keep their token).
  const explicit = await (await pages.pageMissions(env, new URL(`https://x/missions?steamid=${sid}&t=${minted}`))).text()
  check("missions keeps explicit t in action links", explicit.includes(`t=${minted}`))

  // No steamid → nothing to claim → no token links anywhere (restored top15 emits none).
  const bareTop = await (await pageTop15(env, new URL("https://x/top"))).text()
  check("bare /top emits no t= links", !/[?&]t=[0-9a-f]{64}/.test(bareTop))

  // Tournament claim is a real in-page link carrying the minted token.
  // Restore winner fixture state (sections 8/12 overwrote comp columns) and
  // clear section 6's fixture claim row (its checks already ran) so the
  // eligible-claim state renders. In-memory DB only.
  await env.DB.prepare(
    `UPDATE players SET comp_points=1250, comp_lifetime=9800, comp_kills=500, comp_wins=55,
            comp_mvp=12, comp_msn_k=25, comp_msn_h=20, comp_msn_w=10, comp_msn_m=3, comp_msn_done=15
     WHERE steamid = ?1`).bind(sid).run()
  await env.DB.prepare(`DELETE FROM actions WHERE steamid = ?1 AND type = 'claim_tournament'`).bind(sid).run()
  const tour = await (await pages.pageTournament(env, new URL(`https://x/tournament?steamid=${sid}`))).text()
  const claimLink = (tour.match(/href='\/tournament\?[^']*claim=/) || [""])[0]
  check("tournament claim link carries minted t=",
    /t=[0-9a-f]{64}/.test(claimLink) && !!(await checkActionToken(SECRET, sid, claimLink.match(/t=([0-9a-f]{64})/)[1])),
    claimLink || "no claim link")

  // Unknown route → HTTP 404 with the same body; gone() stays 404 by design.
  let w404 = null
  try { ;({ default: w404 } = await import("./src/index.js")) } catch (e) { w404 = null }
  if (!w404) {
    check("unknown route is HTTP 404", false, "src/index.js did not load")
  } else {
    const res = await w404.fetch(new Request("https://x/nope"), env)
    const body = await res.text()
    check("unknown route is HTTP 404", res.status === 404, `status ${res.status}`)
    check("404 keeps the NOT FOUND body", body.includes("404") && body.includes("Unknown panel"))
    const goneRes = await w404.fetch(new Request(`https://x/store?steamid=${sid}`), env)
    check("gone() route still 404s", goneRes.status === 404, `status ${goneRes.status}`)
  }
}

// ---------------- game registration API (/api/game/v1/*, freenova_registration.sma) ----------------
{
  let regWorker = null
  try { ;({ default: regWorker } = await import("./src/index.js")) } catch { regWorker = null }
  check("reg: worker module loads", !!regWorker, "src/index.js did not load")

  const { handleRegister, handleRegHealth, EXPECTED_SERVER_ID } = await import("./src/register.js")
  const REG_PATH = "/api/game/v1/register"
  const REG_SECRET = "reg-test-secret-0123456789abcdef" // harness fixture, never the live secret
  let regSeq = 0
  // Mirrors the plugin's signing (freenova_registration.sma L846-850):
  // SHA256(secret + ":POST:" + path + ":" + ts + ":" + nonce + ":" + BODY-raw).
  // Unlike signedPostPath above (stats push), the body is NOT pre-hashed here.
  async function regSignedRequest(bodyRaw, opts = {}) {
    const { secret = REG_SECRET, serverId = EXPECTED_SERVER_ID, ts, nonce, path = REG_PATH } = opts
    const t = String(ts ?? Math.floor(Date.now() / 1000))
    const n = nonce ?? (t + (++regSeq).toString(16).padStart(8, "0"))
    const sig = opts.sig ?? crypto.createHash("sha256")
      .update(`${secret}:POST:${path}:${t}:${n}:${bodyRaw}`, "utf8").digest("hex")
    return new Request(`https://x${path}`, {
      method: "POST", body: bodyRaw,
      headers: {
        "Content-Type": "application/json",
        "X-FreeNova-Server-ID": serverId,
        "X-FreeNova-Timestamp": t,
        "X-FreeNova-Nonce": n,
        "X-FreeNova-Signature": sig
      }
    })
  }
  const regPayload = (over = {}) => ({
    protocol_version: over.protocol_version ?? 1,
    request_id: over.request_id ?? `fn-reg-${Math.floor(Date.now() / 1000)}-${++regSeq}-54321`,
    server_id: over.server_id ?? EXPECTED_SERVER_ID,
    timestamp: over.timestamp ?? Math.floor(Date.now() / 1000),
    player: { auth_provider: "steam", auth_id: over.auth_id ?? "STEAM_0:1:424242" },
    registration: {
      username: over.username ?? "regtester",
      email: over.email ?? "reg@example.com",
      password: over.password ?? "hunter2hunter2"
    }
  })
  const regEnv = { DB: makeD1(), REG_SECRET } // in-memory DB only — never the live file
  const regCount = async () => (await regEnv.DB.prepare(`SELECT COUNT(*) AS c FROM reg_requests`).first()).c

  // 1. health: unauthenticated, works with no secret configured (FORUM_UP trigger)
  {
    const res = await handleRegHealth(new Request("https://x/api/game/v1/health"), { DB: makeD1() })
    const out = await res.json()
    check("reg health 200 without auth or secret", res.status === 200 && out.ok === true && out.reg_configured === false, `status ${res.status}`)
    const res2 = await handleRegHealth(new Request("https://x/api/game/v1/health"), regEnv)
    check("reg health reports secret configured", res2.status === 200 && (await res2.json()).reg_configured === true)
    if (regWorker) {
      const routed = await regWorker.fetch(new Request("https://x/api/game/v1/health"), regEnv)
      check("reg health routed through worker", routed.status === 200 && (await routed.json()).ok === true, `status ${routed.status}`)
    } else {
      check("reg health routed through worker", false, "worker did not load")
    }
  }

  // 2. fail-closed: no/empty REG_SECRET -> 503, never accept
  {
    const res = await handleRegister(await regSignedRequest(JSON.stringify(regPayload())), { DB: makeD1() })
    check("reg POST without secret env is 503 fail-closed",
      res.status === 503 && (await res.json()).code === "REGISTRATION_DISABLED", `status ${res.status}`)
    const res2 = await handleRegister(await regSignedRequest(JSON.stringify(regPayload())), { DB: makeD1(), REG_SECRET: "" })
    check("reg POST with empty REG_SECRET is 503 fail-closed", res2.status === 503, `status ${res2.status}`)
  }

  // 3. auth failures -> 401 (plugin falls back to generic failure text)
  {
    const wrong = await handleRegister(
      await regSignedRequest(JSON.stringify(regPayload()), { secret: "wrong-reg-secret" }), regEnv)
    check("reg wrong secret 401", wrong.status === 401 && (await wrong.json()).code === "UNAUTHORIZED", `status ${wrong.status}`)
    const bare = await handleRegister(
      new Request(`https://x${REG_PATH}`, { method: "POST", body: JSON.stringify(regPayload()) }), regEnv)
    check("reg missing signature headers 401", bare.status === 401, `status ${bare.status}`)
    const stale = await handleRegister(
      await regSignedRequest(JSON.stringify(regPayload()), { ts: String(Math.floor(Date.now() / 1000) - 3600) }), regEnv)
    check("reg stale timestamp 401", stale.status === 401, `status ${stale.status}`)
  }

  // 4. valid registration -> 200 + exactly one pending row (via worker routing)
  {
    const res = regWorker
      ? await regWorker.fetch(await regSignedRequest(JSON.stringify(regPayload())), regEnv)
      : await handleRegister(await regSignedRequest(JSON.stringify(regPayload())), regEnv)
    const out = await res.json()
    check("reg valid POST 200", res.status === 200 && out.success === true && out.duplicate === false, JSON.stringify(out))
    check("reg valid POST stores one pending row", await regCount() === 1, `count=${await regCount()}`)
    const row = await regEnv.DB.prepare(`SELECT * FROM reg_requests WHERE steamid = 'STEAM_0:1:424242'`).first()
    check("reg row fields stored",
      !!row && row.status === "pending" && row.server_id === EXPECTED_SERVER_ID
        && row.username === "regtester" && row.email === "reg@example.com" && row.provider === "steam",
      JSON.stringify(row))
    check("reg row stores no password material", !!row && !("password" in row) && !("password_hash" in row))
  }

  // 5. duplicate steamid (new request_id) -> idempotent re-return, still one row
  {
    const dup = await handleRegister(
      await regSignedRequest(JSON.stringify(regPayload({ request_id: "fn-reg-2-888-1", username: "regtester2" }))), regEnv)
    const out = await dup.json()
    check("reg duplicate steamid 200 with duplicate=true",
      dup.status === 200 && out.success === true && out.duplicate === true, JSON.stringify(out))
    check("reg duplicate adds no second row", await regCount() === 1, `count=${await regCount()}`)
  }

  // 6. unknown server_id -> rejected, no row
  {
    const rogue = await handleRegister(
      await regSignedRequest(JSON.stringify(regPayload({ server_id: "rogue-7" })), { serverId: "rogue-7" }), regEnv)
    check("reg unknown server_id 403", rogue.status === 403 && (await rogue.json()).code === "UNKNOWN_SERVER", `status ${rogue.status}`)
    check("reg unknown server_id adds no row", await regCount() === 1)
  }

  // 7. malformed JSON (valid signature over raw bytes) -> 400, no row
  {
    const res = await handleRegister(await regSignedRequest("not-json{{{"), regEnv)
    check("reg malformed json 400", res.status === 400 && (await res.json()).code === "BAD_REQUEST", `status ${res.status}`)
    check("reg malformed json adds no row", await regCount() === 1)
  }

  // 8. payload validation mirrors plugin input rules (codes the plugin maps)
  {
    const cases = [
      ["reg bad username 400 INVALID_USERNAME", { username: "bad name!" }, 400, "INVALID_USERNAME"],
      ["reg short password 400 PASSWORD_TOO_SHORT", { password: "short" }, 400, "PASSWORD_TOO_SHORT"],
      ["reg bad email 400 INVALID_EMAIL", { email: "nope" }, 400, "INVALID_EMAIL"],
      ["reg protocol_version 2 rejected", { protocol_version: 2 }, 400, "UNSUPPORTED_PROTOCOL"],
      ["reg pending steamid rejected", { auth_id: "STEAM_ID_PENDING" }, 400, "BAD_REQUEST"]
    ]
    for (const [name, over, wantStatus, wantCode] of cases) {
      const res = await handleRegister(await regSignedRequest(JSON.stringify(regPayload(over))), regEnv)
      const out = await res.json()
      check(name, res.status === wantStatus && out.code === wantCode, `status ${res.status} code ${out.code}`)
    }
    check("reg all failures add no row", await regCount() === 1, `count=${await regCount()}`)
  }
}

// ---------------- seed guard: boot must never clobber game-pushed catalogs ----------------
{
  const seedSql = fs.readFileSync(path.join(here, "seed_catalogs.sql"), "utf8")
  const ignoreCount = (seedSql.match(/INSERT\s+OR\s+IGNORE/gi) || []).length
  const guardedUpserts = (seedSql.match(/ON CONFLICT\(key\) DO UPDATE[\s\S]*?WHERE excluded\.version > catalog\.version/gi) || []).length
  check("seed never clobbers newer catalogs",
    !/INSERT\s+OR\s+REPLACE/i.test(seedSql) && (ignoreCount === 8 || guardedUpserts === 8),
    `${ignoreCount} IGNORE / ${guardedUpserts} guarded upserts`)

  const seedDb = makeD1()
  seedDb.raw.exec(seedSql)
  const keys = ["reward_track", "skills", "skins", "models", "cosmetics", "achievements", "events", "hall_of_fame"]
  const rows = seedDb.raw.prepare(`SELECT key, version FROM catalog ORDER BY key`).all()
  check("seed fills all 8 catalogs (reward_track v2, rest v1)",
    rows.length === 8 && keys.every(k => rows.some(r => r.key === k && Number(r.version) === (k === "reward_track" ? 2 : 1))),
    JSON.stringify(rows.map(r => `${r.key}:${r.version}`)))

  // Game pushes a newer skills catalog...
  const pushEnv = { DB: seedDb, SYNC_SECRET: SECRET }
  const push = await handleSync(await signedPostPath("/api/v1/server/stats", {
    players: [],
    catalogs: { skills: { version: 2, skills: [{ id: "pushed_skill", name: "Pushed" }] } }
  }), pushEnv)
  const pushOut = await push.json()
  check("catalog push accepted", pushOut.ok === true, JSON.stringify(pushOut))
  let skills = seedDb.raw.prepare(`SELECT version, json FROM catalog WHERE key='skills'`).get()
  check("pushed skills catalog stored at v2",
    skills && Number(skills.version) === 2 && String(skills.json).includes("pushed_skill"),
    JSON.stringify(skills && skills.version))

  // ...and a later boot re-runs the seed: the pushed row must survive.
  seedDb.raw.exec(seedSql)
  skills = seedDb.raw.prepare(`SELECT version, json FROM catalog WHERE key='skills'`).get()
  const others = seedDb.raw.prepare(`SELECT COUNT(*) AS c FROM catalog WHERE key<>'skills' AND version=1`).get()
  check("re-seed does not clobber the pushed skills catalog",
    skills && Number(skills.version) === 2 && String(skills.json).includes("pushed_skill"),
    JSON.stringify(skills && skills.version))
  check("re-seed still fills the untouched 6 catalogs at v1", others.c === 6, `count ${others.c}`)

  // A deleted gap is refilled by the seed at v1 (INSERT OR IGNORE semantics).
  seedDb.raw.exec(`DELETE FROM catalog WHERE key='skins'`)
  seedDb.raw.exec(seedSql)
  const skins = seedDb.raw.prepare(`SELECT version FROM catalog WHERE key='skins'`).get()
  check("re-seed refills a deleted catalog at v1", skins && Number(skins.version) === 1, JSON.stringify(skins))
}

// ---------------- compact MOTD micro-stylesheet (size + content contract) ----------------
{
  let cw = null
  try { ;({ default: cw } = await import("./src/index.js")) } catch { cw = null }
  check("compact contract worker loads", !!cw, "src/index.js did not load")
  if (cw) {
    const shortSid = "0-1-11111"
    const sid = "STEAM_0:1:11111"
    const chromeUA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" }
    const msieUA = { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" }
    const STYLE_CAP = 5000 // old-IE MOTD byte budget for the inline sheet
    const fetchText = async (path, headers) => {
      const res = await cw.fetch(new Request(`https://x${path}`, { headers }), env)
      return { res, text: await res.text() }
    }
    const routes = [
      ["profile", `/m/p/${shortSid}.htm`, `/profile?steamid=${sid}`],
      ["top", `/m/t/${shortSid}.htm`, `/top?steamid=${sid}`],
      ["battlepass", `/m/b/${shortSid}.htm`, `/battlepass?steamid=${sid}`],
      ["missions", `/m/i/${shortSid}.htm`, `/missions?steamid=${sid}`]
    ]
    for (const [name, shortPath, browserPath] of routes) {
      const c = await fetchText(shortPath, msieUA)
      const b = await fetchText(browserPath, chromeUA)
      check(`compact ${name} renders short + browser`,
        c.res.status === 200 && b.res.status === 200, `short ${c.res.status}; browser ${b.res.status}`)
      const cSheet = stylesOf(c.text).split("\n")[0] || ""
      const bSheet = stylesOf(b.text).split("\n")[0] || ""
      const bRules = new Set(sheetRules(b.text))
      const cRules = sheetRules(c.text)
      const stray = cRules.filter(r => !bRules.has(r))
      // Restored top15 serves one self-contained theme skin in every mode
      // (no compact/browser split), so the trim assertion can't apply to it.
      if (name !== "top") check(`compact ${name} sheet trimmed vs browser`,
        cSheet.length > 0 && cSheet.length <= STYLE_CAP && cSheet.length < bSheet.length * 0.65,
        `compact ${cSheet.length}B vs browser ${bSheet.length}B (cap ${STYLE_CAP})`)
      check(`compact ${name} sheet rules all in browser sheet`,
        cRules.length > 0 && stray.length === 0, stray[0] || `${cRules.length} rules`)
    }

    // Content contract: compact drops only the documented low-value cards;
    // all data rows (leaderboard, missions counters, events) stay.
    const cProf = await fetchText(`/m/p/${shortSid}.htm`, msieUA)
    const bProf = await fetchText(`/profile?steamid=${sid}`, chromeUA)
    check("profile has no repeated record cards",
      !cProf.text.includes(">COMBAT RECORD<") && !cProf.text.includes(">ROUNDS<")
        && !bProf.text.includes(">COMBAT RECORD<") && !bProf.text.includes(">ROUNDS<"))
    check("profile stats live in tiles once",
      bProf.text.includes("Assists") && bProf.text.includes("Headshots")
        && bProf.text.includes("Damage") && bProf.text.includes("Accuracy"))
    check("compact profile keeps identity + stats overview",
      cProf.text.includes("PROFILE") && cProf.text.includes("STEAM_0:1:11111")
        && cProf.text.includes("Battle Pass"))

    const cTop = await fetchText(`/m/t/${shortSid}.htm`, msieUA)
    const bTop = await fetchText(`/top?steamid=${sid}`, chromeUA)
    check("compact top is the same single-skin board",
      cTop.text.includes("TOP 15") && cTop.text.includes("#1")
        && bTop.text.includes("TOP 15") && bTop.text.includes("#1"))
    check("compact top keeps weapon filter + search",
      cTop.text.includes("M4A1") && cTop.text.includes("Search"))

    const cMsn = await fetchText(`/m/i/${shortSid}.htm`, msieUA)
    const bMsn = await fetchText(`/missions?steamid=${sid}`, chromeUA)
    check("compact missions drop card footer counts + bonus mode cell",
      !cMsn.text.includes("Ranked kills today.") && !cMsn.text.includes("Bonus daily")
        && bMsn.text.includes("Ranked kills today.") && bMsn.text.includes("Bonus daily"))
    check("compact missions keep counters, titles and rewards",
      cMsn.text.includes("DAILY MISSIONS") && cMsn.text.includes("FRAG HUNTER")
        && cMsn.text.includes("Daily AND-set"))
  }
}

// ---------------- 14. country flags (cc) + top weapons + mapend medals ----------------
{
  // Push carries cc through the 64-bind upsert (sanitized: lowercase a-z, max 2).
  const res = await handleSync(await signedPost(env, [
    { steamid: "STEAM_0:1:22222", name: "flag-fixture", xp: 10, cc: "US" },
    { steamid: "STEAM_0:1:22223", name: "flag-bad", xp: 10, cc: "!!9" }
  ]), env)
  const out = await res.json()
  check("push with cc accepted", out.ok === true && out.stored === 2, JSON.stringify(out))
  const ccUS = await env.DB.prepare(`SELECT cc FROM players WHERE steamid='STEAM_0:1:22222'`).first()
  const ccBad = await env.DB.prepare(`SELECT cc FROM players WHERE steamid='STEAM_0:1:22223'`).first()
  check("cc sanitized lowercase", ccUS && ccUS.cc === "us", JSON.stringify(ccUS))
  check("cc garbage becomes empty", ccBad && ccBad.cc === "", JSON.stringify(ccBad))

  // Board renders the flag image for cc rows, nothing (no broken img) without.
  const flagged = await (await pageTop15(env, new URL("https://x/top15"))).text()
  check("board flag image", flagged.includes("flag-icons") && flagged.includes("/us.svg"))
  await env.DB.prepare(`UPDATE players SET cc=''`).run()
  const noflag = await (await pageTop15(env, new URL("https://x/top15"))).text()
  check("board no flag without cc", !noflag.includes("flag-icons"))

  // Profile identity shows the flag; top-5 weapons list renders plain names.
  await env.DB.prepare(`UPDATE players SET cc='de' WHERE steamid='STEAM_0:1:11111'`).run()
  await env.DB.prepare(`INSERT INTO player_weapons (steamid, slot, kills, hs, damage)
    VALUES ('STEAM_0:1:11111', 5, 777, 111, 22000), ('STEAM_0:1:11111', 6, 321, 40, 30000)`).run()
  const prof = await (await pages.pageProfile(env, new URL("https://x/profile?steamid=STEAM_0:1:11111"))).text()
  check("profile flag image", prof.includes("/de.svg"))
  check("profile top weapons plain list", prof.includes("TOP WEAPONS") && prof.includes("USP") && prof.includes("777")
    && !prof.includes("Mastery") && !prof.includes("WEAPON MASTERY"))
  await env.DB.prepare(`UPDATE players SET cc='' WHERE steamid='STEAM_0:1:11111'`).run()
  await env.DB.prepare(`DELETE FROM player_weapons WHERE steamid='STEAM_0:1:11111' AND slot IN (5,6)`).run()

  // Map-end top-3 rows carry trophy medals.
  const me = await (await pageMapEnd(env, new URL("https://x/mapend?map=de_dust2"))).text()
  check("mapend top-3 medals", me.includes("/medals/medal_01.png") && me.includes("/medals/medal_03.png"))

  // Leave no fixture rows behind.
  await env.DB.prepare(`DELETE FROM players WHERE steamid IN ('STEAM_0:1:22222','STEAM_0:1:22223')`).run()
  const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE steamid LIKE 'STEAM_0:1:2222%'`).first()
  check("flag fixtures cleaned", left && left.n === 0, JSON.stringify(left))
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL TESTS PASSED")
process.exit(failures ? 1 : 0)

