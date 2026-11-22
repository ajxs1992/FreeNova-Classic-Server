// The /v2 route table — the design rebuild's front door.
//
// Mounted at /v2 (and /v2/hub) while the rebuild lands page by page. The live
// panel keeps serving `/`, `/hub` and every other route untouched until its
// replacement passes verification (docs/design/PANEL-REBUILD.md: "cutover is
// per page"). Nothing here writes, and nothing here needs a session: the page
// is the same read-only surface as /winter, identified by ?steamid=.
//
// First page cut over would be `/` → this renderer (the reference is the home
// screen), then `/profile`. See the design doc's "as built" section.
import { page404 } from "../ui.js"
import { loadDashboard } from "./data/dashboard.js"
import { render as renderDashboard } from "./pages/dashboard.js"
import { pageWinterHubV2 } from "./pages/winter/hub.js"
import { pageWinterAdventV2 } from "./pages/winter/advent.js"
import { pageWinterTreeV2 } from "./pages/winter/tree.js"
import { pageWinterGiftsV2 } from "./pages/winter/gifts.js"
import { pageWinterOrnamentsV2 } from "./pages/winter/ornaments.js"
import { pageWinterPassV2 } from "./pages/winter/pass.js"
import { pageWinterSpinV2 } from "./pages/winter/spin.js"
import { pageWinterMailV2 } from "./pages/winter/mail.js"

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }

/**
 * Dev clock. `WF_NOW=2026-12-10T13:20:00Z` (or epoch seconds) renders every v2
 * page as of that instant so the owner can see a December screen in November.
 * Read from env only, never from the URL: a visitor can never move the clock.
 */
const html = body => new Response(body, { status: 200, headers: HTML })

export function v2Now(env) {
  const raw = env && (env.WF_NOW || "")
  if (!raw) return 0
  const n = Number(raw)
  if (Number.isFinite(n) && n > 1e9) return Math.trunc(n)
  const t = Date.parse(String(raw))
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0
}

/** GET /v2 — the dashboard at 1672x941's proportions, fluid below that. */
export async function pageDashboardV2(env, url, nowSec) {
  const data = await loadDashboard(env, url, nowSec || v2Now(env))
  return new Response(renderDashboard(data), { status: 200, headers: HTML })
}

export async function handleV2(request, env, url) {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 })
  const path = (url.pathname || "/").replace(/\/+$/, "") || "/"
  switch (path) {
    case "/v2":
    case "/v2/hub":
    case "/v2/dashboard":
      return await pageDashboardV2(env, url)
    // The Winterfest family. Every one of these is linked from the rail, the
    // sub-nav, the dashboard cards and the hub — so none of them may 404.
    case "/v2/winter":
    case "/v2/winter/hub":
      return html(await pageWinterHubV2(env, url, v2Now(env)))
    case "/v2/winter/advent":
      return html(await pageWinterAdventV2(env, url, v2Now(env)))
    case "/v2/winter/tree":
      return html(await pageWinterTreeV2(env, url, v2Now(env)))
    case "/v2/winter/gifts":
      return html(await pageWinterGiftsV2(env, url, v2Now(env)))
    case "/v2/winter/ornaments":
      return html(await pageWinterOrnamentsV2(env, url, v2Now(env)))
    case "/v2/winter/pass":
      return html(await pageWinterPassV2(env, url, v2Now(env)))
    case "/v2/winter/spin":
      return html(await pageWinterSpinV2(env, url, v2Now(env)))
    case "/v2/winter/mail":
      return html(await pageWinterMailV2(env, url, v2Now(env)))
    default: {
      const res = page404()
      return new Response(res.body, { status: 404, headers: res.headers })
    }
  }
}
