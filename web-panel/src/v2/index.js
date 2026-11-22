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

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }

/** GET /v2 — the dashboard at 1672x941's proportions, fluid below that. */
export async function pageDashboardV2(env, url, nowSec) {
  const data = await loadDashboard(env, url, nowSec)
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
    default: {
      const res = page404()
      return new Response(res.body, { status: 404, headers: res.headers })
    }
  }
}
