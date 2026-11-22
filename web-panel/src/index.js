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

export default {
  async fetch(request, env, ctx) {
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

      if (request.method !== "GET")
        return new Response("method not allowed", { status: 405 })

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
      if (env.ASSETS && (path === "/logo.png" || path.startsWith("/ranks/") || path.startsWith("/badges/") || path.startsWith("/medals/") || path.startsWith("/i/") || path.startsWith("/missions/") || path.startsWith("/bp/"))) {
        const res = await env.ASSETS.fetch(request)
        if (res && res.status !== 404) return res
      }

      const view = (url.searchParams.get("view") || url.searchParams.get("tab") || "").toLowerCase()
      if ((route === "/" || route === "/battlepass.php" || route === "/rsu.php") && view) {
        if (view === "store" || view === "shop" || view === "skins" || view === "cosmetics" || view === "models")
          return gone()
        if (view === "top" || view === "top15" || view === "leaderboard" || view === "rankings" || view === "mapend")
          return await pageTop15(env, url)
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
        case "/top/rating":  return await pageTop15(env, url)
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
        case "/search":      return await pageTop15(env, url)
        case "/battlepass.php":
        case "/rsu.php":     return await pageTop15(env, url)
        case "/favicon.ico": return new Response(null, { status: 204 })
        default:             return page404()
      }
    } catch (e) {
      // players get a clean unavailable state; the error goes to Worker logs
      console.error("panel error:", e && e.stack ? e.stack : String(e))
      return errorState("ERROR", "home", "the panel (internal error — logged)")
    }
  }
}
