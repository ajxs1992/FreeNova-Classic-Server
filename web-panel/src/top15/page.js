import { readContract, queryBoard, stateQuery } from "./query.js"
import { loadTheme, saveTheme, resetTheme } from "./store.js"
import { renderPremier } from "./premier.js"
import { isMotdCompact } from "../ui.js"
import { DEFAULT_THEME, normalizeTheme } from "./theme.js"
import { serverMeta } from "./meta.js"

function staffOk(url, env) {
  const key = url.searchParams.get("k") || ""
  const secret = (env && (env.ADMIN_PASSWORD || env.SYNC_SECRET)) || ""
  return secret && key && key === secret
}

export async function pageTop15(env, url) {
  const c = readContract(url)
  // MOTD short path (/m/t/...) and legacy UAs set the global compact flag but
  // carry no ?compact=1 - honor it so GoldSrc always gets the MOTD skin.
  if (!c.compact && isMotdCompact()) c.compact = true
  if (url.searchParams.get("theme") === "reset" && staffOk(url, env)) {
    await resetTheme(env)
    return new Response(null, { status: 302, headers: { location: "/top15?" + stateQuery(c) } })
  }
  if (url.searchParams.get("theme") === "save" && staffOk(url, env)) {
    const patch = {}
    for (const k of Object.keys(DEFAULT_THEME)) {
      if (url.searchParams.has("t_" + k)) patch[k] = url.searchParams.get("t_" + k)
    }
    await saveTheme(env, normalizeTheme({ ...(await loadTheme(env)), ...patch }))
    return new Response(null, { status: 302, headers: { location: "/top15?" + stateQuery(c) } })
  }

  const theme = await loadTheme(env)
  const board = await queryBoard(env, c)
  if (board.error) {
    return new Response("<html><body bgcolor='#111111' text='#e8e4dc'>Unable to load Top 15.</body></html>", {
      status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
    })
  }
  const now = Math.floor(Date.now() / 1000)
  const medals = {}
  try {
    const m = await env.DB.prepare(
      `SELECT steamid, code FROM ap_unlocks ORDER BY earned_at DESC LIMIT 400`
    ).all()
    for (const row of m.results || []) {
      const sid = String(row.steamid || "")
      if (sid && !medals[sid]) medals[sid] = String(row.code || "").toLowerCase()
    }
  } catch {}
  const html = renderPremier({
    contract: c,
    rows: board.rows,
    total: board.total,
    theme,
    now,
    meta: await serverMeta(env, now),
    medals
  })
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  })
}
