// FreeNova Web Panel — Cloudflare Worker (D1-backed, server-rendered).
// The game server is the only authority: it pushes signed snapshots; the web
// is read-only except for QUEUING actions that the game validates and applies.
import { handleSync, handleAdminCall, queueAction } from "./sync.js"
import { handleRegister, handleRegHealth } from "./register.js"
import { handleAdmin } from "./admin.js"
import { pageProfile } from "./profile.js"
import { pageBattlePass } from "./battlepass.js"
import { pageMissions } from "./missions.js"
import { pageCompetitive } from "./competitive.js"
import { pageVip } from "./vip.js"
import { pageEvents } from "./events.js"
import { pageAchievements } from "./achievements.js"
import { pageTop15 } from "./top15/page.js"
import { pageStatsViewer } from "./top15/viewer.js"
import { pageMapEnd } from "./top15/mapend.js"
import { pageIcons } from "./icons.js"
import { page404, html, errorState, setMotdCompact } from "./ui.js"
import { pageHub } from "./hub.js"
import { pageGameSurface, pageSettings, pageRules } from "./gamepages.js"
import { handlePublicApi } from "./publicapi.js"
import { pageMotdV2 } from "./motd.js"
import { pageBoards } from "./boards_page.js"
import { handleWinter } from "./winter/index.js"
import { applyWinterSkin } from "./winter/skin.js"
import { pageWinterSpin } from "./winter/spin.js"
import { handleV2 } from "./v2/index.js"
// The two dashboard surfaces the owner drew in the sidebar (docs/design/
// WINTERFEST-DASHBOARD.md): Levels under PROGRESSION and the envelope in the top
// bar. They are ordinary GET pages: /levels is informational (no claim path in
// Phase 1) and /mail is read-only by steamid, so neither adds a POST route.
import { pageLevels } from "./winter/levels.js"
import { pageMail, unreadCount } from "./winter/mail.js"

export default {
  async fetch(request, env, ctx) {
    // One place adds the policy for pages that carry a token in their query
    // string (REVIEW.md §4.2 M3): a ?t= / ?k= / ?claim= URL must not leak
    // through Referer to flagcdn.com, Discord or any other third party.
    const res = await withSafeReferrer(request, await routeRequest(request, env, ctx))
    // Winterfest's seasonal skin (src/winter/skin.js). It is a response-level
    // wrapper BY DESIGN: inside the season window every existing page gets the
    // December palette, outside it `applyWinterSkin` returns the very same
    // response object, so the panel is byte-for-byte unchanged from 25 Dec on.
    return await applyWinterSkin(request, env, res)
  }
}

function withSafeReferrer(request, res) {
  try {
    const url = new URL(request.url)
    const carries = TOKEN_QUERY.some(p => url.searchParams.has(p))
    if (!carries || !res || !res.headers || res.headers.has("referrer-policy")) return res
    const headers = new Headers(res.headers)
    headers.set("referrer-policy", "no-referrer")
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  } catch { return res }
}

const TOKEN_QUERY = ["t", "k", "claim", "act"]

async function routeRequest(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, "") || "/"

    try {
      // Admin Control Center is session-auth, not game HMAC. Must run before
      // the GET-only gate so staff POSTs are not 405'd. Do not put this on
      // verifyGamePost and do not add an MOTD short-code for /admin.
      if (path === "/admin" || path.startsWith("/admin/"))
        return await handleAdmin(request, env)

      if (request.method === "POST" && path === "/api/v1/server/stats")
        return await handleSync(request, env)
      if (request.method === "POST" && path === "/api/v1/server/admin-call")
        return await handleAdminCall(request, env)
      // Game registration (freenova_registration.sma). POST is HMAC-signed with
      // REG_SECRET (raw-body formula — see src/register.js header); health is
      // unauthenticated and a 2xx there flips the plugin to FORUM_UP.
      if (request.method === "POST" && path === "/api/game/v1/register")
        return await handleRegister(request, env)
      if (request.method === "GET" && path === "/api/game/v1/health")
        return await handleRegHealth(request, env)

      // Top-15 theme editor: POST only, so the staff key never rides in a URL
      // (REVIEW.md §4.1 H2). Routed before the GET-only gate for that reason.
      if (request.method === "POST" && (path === "/top15" || path === "/top"))
        return await pageTop15(env, url, request)

      // Winterfest panel surface (src/winter/). The POST (the no-JS "move slot X
      // to Y" form) has to sit above the GET-only gate, exactly like the top15
      // theme POST above. The GET routes are dispatched further down, AFTER the
      // MOTD/compact skin is decided — otherwise an MSIE client would get the
      // browser skin and its enhancement script. Nothing here mutates player
      // state: a move is queued for the game as a `wf_tree_*` action.
      if (request.method === "POST" && path === "/winter/tree")
        return await handleWinter(request, env, url)

      if (request.method !== "GET")
        return new Response("method not allowed", { status: 405 })

      // Public read-only JSON (docs/PUBLIC-API.md). No session, no secret, no
      // token: additive to every route above and below. Dispatched after the
      // method gate so a POST to it stays a plain 405.
      if (path === "/api/public" || path.startsWith("/api/public/"))
        return await handlePublicApi(request, env, url)

      // GoldSrc MOTD: short path only (HTTP -102 if the URL is too long).
      //   /m/b/0-0-123456.htm   optional tab: /m/a/0-0-123456/hof.htm
      const SHORT = { p: "/profile", b: "/battlepass", t: "/top", i: "/missions", a: "/achievements", v: "/vip", e: "/events", r: "/tournament" }
      const gone = () => {
        const res = page404()
        return new Response(res.body, { status: 404, headers: res.headers })
      }
      const stampMotdSid = (minted) => {
        // Non-enumerable instance field. Callers cannot set this via query string.
        Object.defineProperty(url, "_fnMotdSid", { value: minted, enumerable: false, writable: false, configurable: false })
      }
      let motdPath = path.match(/^\/m\/([pbtisavoer])\/(\d+-\d+-\d+)(?:\/([a-z0-9_-]+))?(?:\.html?)?$/i)
      if (motdPath) {
        const minted = "STEAM_" + motdPath[2].replace(/-/g, ":")
        url.searchParams.set("steamid", minted)
        stampMotdSid(minted)
        const code = motdPath[1].toLowerCase()
        const extra = motdPath[3] ? motdPath[3].toLowerCase() : ""
        if (code === "s" || code === "o")
          return gone()
        // /m/b/*/missions (or daily/weekly/completed) → 302 to Missions product
        if (code === "b" && /^(missions|daily|weekly|completed)$/.test(extra)) {
          const dest = motdPath[2]
            ? `/m/i/${motdPath[2]}/${extra === "missions" ? "daily" : extra}.htm`
            : "/missions"
          return new Response(null, { status: 302, headers: { location: dest } })
        }
        // MOTD v2 (src/motd.js): p / i / e / b / t are the five player-facing
        // pages the game opens. They are one self-contained document each
        // (inline CSS, no script, no images) and carry X-Robots-Tag +
        // Referrer-Policy. The remaining codes keep the legacy rewrite below.
        const V2 = { p: "p", i: "i", e: "e", b: "b", t: "t" }
        if (V2[code]) {
          setMotdCompact(true)
          if (extra) url.searchParams.set("tab", extra)
          return await pageMotdV2(env, url, {
            code: V2[code],
            steamid: minted,
            tab: extra,
            page: /^\d+$/.test(extra) ? Number(extra) : 0
          })
        }
        if (/^\d+$/.test(extra)) url.searchParams.set("from", extra)
        else if (extra) url.searchParams.set("tab", extra)
        // Restored top15 module reads ?steamid= for the own-row highlight;
        // the stamp stays authoritative (steamidOf prefers _fnMotdSid).
        if (minted) url.searchParams.set("steamid", minted)
        url.pathname = SHORT[code] || "/profile"
      } else {
        // Dashes (packed, what /m/ uses) and colons (the documented long form)
        // are both accepted: the authid is re-packed below anyway, so a link
        // written as /u/STEAM_0:0:1 used to 404 while /u/STEAM_0-0-1 worked.
        motdPath = path.match(/^\/u\/(STEAM_[0-9][-:][0-9][-:]\d+)(?:\/([a-z0-9_-]+))?(?:\/k\/([a-fA-F0-9]{16,64}))?$/i)
        if (motdPath) {
          const minted = "STEAM_" + motdPath[1].slice(6).replace(/-/g, ":")
          url.searchParams.set("steamid", minted)
          stampMotdSid(minted)
          if (motdPath[3]) url.searchParams.set("t", motdPath[3].toLowerCase())
          const slug = (motdPath[2] || "profile").toLowerCase()
          if (/^(store|shop|skins|cosmetics|models)$/.test(slug))
            return gone()
          const pages = {
            profile: "/profile", battlepass: "/battlepass", bp: "/battlepass", pass: "/battlepass",
            missions: "/missions", top: "/top", tournament: "/tournament",
            achievements: "/achievements", events: "/events", vip: "/vip"
          }
          url.pathname = pages[slug] || "/profile"
        }
      }

      if (path === "/panel" || path.startsWith("/panel/")) {
        const rest = path.replace(/^\/panel\/?/, "")
        const alias = {
          "": "/profile",
          profile: "/profile",
          top: "/top",
          battlepass: "/battlepass",
          bp: "/battlepass",
          missions: "/missions",
          achievements: "/achievements",
          tournament: "/tournament",
          vip: "/vip",
          events: "/events"
        }
        url.pathname = alias[rest] || "/profile"
      }

      const route = (url.pathname.replace(/\/+$/, "") || "/")

      // CS 1.6 MOTD is MSIE 6 / Mozilla/4. It cannot use var()/flex/Google Fonts.
      const ua = request.headers.get("user-agent") || ""
      const compactQ = url.searchParams.get("compact") === "1"
      // Short /m/ + /u/ rewrites are pure URL shortening — the compact skin is
      // chosen by the rendering engine, not by the path. Legacy GoldSrc MOTD
      // (MSIE/Trident/Mozilla/4.0) or an explicit ?compact=1 get the compact
      // skin; modern in-game browsers hitting the same short URLs get the full
      // preview UI.
      const looksLikeMotd = compactQ || /MSIE|Trident|Mozilla\/4\.0/i.test(ua)
      setMotdCompact(looksLikeMotd)
      if (looksLikeMotd && url.searchParams.get("compact") !== "1")
        url.searchParams.set("compact", "1")

      // Rank emblems, processed medals, badges, /i icons from ./assets
      // /winter/*.png is the dashboard's cropped art (assets/winter/). Narrow to
      // image extensions so it can never shadow the /winter/* pages below.
      if (env.ASSETS && (path === "/logo.png" || path.startsWith("/ranks/") || path.startsWith("/badges/") || path.startsWith("/medals/") || path.startsWith("/i/") || path.startsWith("/missions/") || path.startsWith("/bp/") || /^\/winter\/(?:icons\/)?[a-z0-9_-]+\.(png|jpe?g|webp|svg)$/i.test(path))) {
        const res = await env.ASSETS.fetch(request)
        if (res && res.status !== 404) return res
      }

      // /winter/spin (workstream 13, src/winter/spin.js): a read-only viewer, so
      // it is dispatched here — before the /winter/* catch-all in winter/index.js,
      // which does not own this page. One line, no other change to this file.
      if (path === "/winter/spin")
        return await pageWinterSpin(request, env, url)

      // Winterfest pages (src/winter/): GET only, and only now that the compact
      // skin flag is final. Both the browser page and the in-game MOTD skin come
      // out of the same renderer (src/winter/render.js).
      if (path === "/winter" || path.startsWith("/winter/"))
        return await handleWinter(request, env, url)

      // The v2 design rebuild (src/v2/). /v2/… only: the routes below keep
      // serving the live panel untouched until each replacement is verified
      // (docs/design/PANEL-REBUILD.md — cutover is one page per commit).
      if (path === "/v2" || path.startsWith("/v2/"))
        return await handleV2(request, env, url)

      const view = (url.searchParams.get("view") || url.searchParams.get("tab") || "").toLowerCase()
      if ((route === "/" || route === "/battlepass.php" || route === "/rsu.php") && view) {
        if (view === "store" || view === "shop" || view === "skins" || view === "cosmetics" || view === "models")
          return gone()
        if (view === "top" || view === "top15" || view === "leaderboard" || view === "rankings" || view === "mapend")
          return await pageTop15(env, url, request)
        if (view === "player" || view === "rankstats" || view === "profile" || view === "statsme" || view === "rank")
          return await pageProfile(env, url)
        if (view === "bp" || view === "battlepass")
          return await pageBattlePass(env, url)
        if (view === "missions")
          return await pageMissions(env, url)
        if (view === "tournament" || view === "ctop" || view === "competitive")
          return await pageCompetitive(env, url)
        if (view === "records" || view === "achievements" || view === "hof" || view === "halloffame")
          return await pageAchievements(env, url)
        if (view === "events")
          return await pageEvents(env, url)
        if (view === "vip")
          return await pageVip(env, url)
      }

      switch (route) {
        case "/":
        case "/hub":
        case "/home":
          return pageHub(env, url)
        case "/top":
        case "/top15":
        case "/leaderboard":
        case "/rankings":
        case "/top/xp":
        case "/top/level":
        case "/top/kills":
        case "/top/kd":
        case "/top/headshots":
        case "/top/mvps":
        case "/top/wins":
        case "/top/playtime":
        case "/top/rating":  return await pageTop15(env, url, request)
        // Weekly / monthly boards: one boundary implementation with
        // /api/public/top and the MOTD top tabs (src/periods.js + boards.js).
        case "/top/week":    return await pageBoards(env, url, "week")
        case "/top/month":   return await pageBoards(env, url, "month")
        case "/mapend":      return await pageMapEnd(env, url)
        case "/profile":
        case "/rankstats":
        case "/statsme":
        case "/rank":        return await pageProfile(env, url)
        case "/battlepass":
        case "/bp":          return await pageBattlePass(env, url)
        case "/missions":    return await pageMissions(env, url)
        case "/tournament":
        case "/competitive":
        case "/ctop":        return await pageCompetitive(env, url)
        case "/achievements":
        case "/records":
        case "/hof":
        case "/halloffame":  return await pageAchievements(env, url)
        // Winterfest dashboard pages (src/winter/levels.js, src/winter/mail.js).
        // GET only: the levels page has nothing to claim and the inbox is
        // read-only by steamid, so a POST to either falls through to the method
        // gate above and is refused with 405 instead of inventing a write path.
        // The envelope's red dot is the unread count in winter_mail.
        case "/levels":      return await pageLevels(env, url, {
                               unread: await unreadCount(env, url.searchParams.get("steamid") || "")
                             })
        case "/mail":        return await pageMail(env, url)
        // Read-only web landing pages. Purchases and equipping remain in game.
        case "/store":
        case "/shop":        return await pageGameSurface(env, url, "shop")
        case "/skins":       return await pageGameSurface(env, url, "skins")
        case "/models":      return await pageGameSurface(env, url, "models")
        case "/cosmetics":   return await pageGameSurface(env, url, "cosmetics")
        case "/settings":    return await pageSettings(env, url)
        case "/rules":       return await pageRules(env, url)
        case "/discord":     return new Response(null, { status: 302, headers: { location: "https://discord.gg/vuGaWjuX" } })
        case "/events":      return await pageEvents(env, url)
        case "/vip":         return await pageVip(env, url)
        case "/statsviewer":
        case "/stats":       return await pageStatsViewer(env, url)
        case "/icons":       return await pageIcons(env, url)
        case "/compare": {
          const sid = url.searchParams.get("steamid") || url.searchParams.get("a") || ""
          const loc = sid ? `/profile?steamid=${encodeURIComponent(sid)}` : "/profile"
          return new Response(null, { status: 302, headers: { location: loc } })
        }
        case "/search":      return await pageTop15(env, url, request)
        case "/battlepass.php":
        case "/rsu.php":     return await pageTop15(env, url, request)
        case "/favicon.ico": return new Response(null, { status: 204 })
        default:             return page404()
      }
    } catch (e) {
      // players get a clean unavailable state; the error goes to Worker logs
      console.error("panel error:", e && e.stack ? e.stack : String(e))
      return errorState("ERROR", "home", "the panel (internal error — logged)")
    }
}
