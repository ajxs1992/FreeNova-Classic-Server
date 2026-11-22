// The Christmas skin — one seasonal layer over the pages that already exist.
//
// Requirement (docs/WINTERFEST.md §4 Phase 2 + the panel mission): recolour the
// EXISTING surface for December without rewriting any of it, turn itself on on
// 1 December, off when the season closes, and be a byte-for-byte no-op outside
// that window.
//
// How it does that: it is applied at the response boundary (src/index.js wraps
// the routed response), never inside a page. When the season is shut the
// function returns the response it was given — the same object, body untouched
// — so nothing can drift and no existing check can see a difference. When the
// season is open it appends one <style> block (the last stylesheet on the
// document, so it wins on equal specificity without needing !important
// everywhere) and one decorative snow line after <body>.
//
// GoldSrc MOTD rules still apply to the injected CSS: solid hex only, no
// custom properties, no flex/grid, no images, no web fonts. An old engine
// ignores the rounded corners and keeps the colours.

import { seasonFromRows } from "./season.js"

const MARK = "wf-winter-skin"

// The December palette: cranberry red, dark pine, candle gold, icy blue.
export const WINTER_SKIN_CSS = `
/* ${MARK} — seasonal palette, applied only inside the season window */
html,body{background:#0a1410 !important;}
body{color:#e9f3ee;}
a{color:#9be7ff;}
a:hover{color:#e8c547;}
.motd-head,.card,.tile,.msn-card,.store-hero,.store-card,.csgo-hud-card,.bp-head td,.csgo-pass-left,.csgo-pass-xp{
  background:#101d18 !important;border-color:#20503a !important;}
.hero-kick,.sub,.muted,.small,.wf-note,.tip{color:#8fbfae;}
.hero-title{color:#e05a5a !important;}
.h2,.t th,.msn-title,.op-kicker{color:#e8c547 !important;}
.t th{background:#12241c !important;border-bottom-color:#20503a !important;}
.t td,.msg,.wf-row td{border-bottom-color:#1a2f26 !important;}
.bar{background:#0b1a14 !important;border-color:#20503a !important;}
.bar div{background:#e05a5a !important;}
.pill,.chip,.badge{border-color:#20503a !important;background:#0b1a14 !important;color:#8fbfae !important;}
.pill.on,.badge.done{border-color:#e8c547 !important;background:#1d1a0f !important;color:#e8c547 !important;}
.lead{background:#12241c !important;border-color:#20503a !important;border-left-color:#e05a5a !important;}
.lead b{color:#e8c547 !important;}
.empty{border-color:#20503a !important;color:#8fbfae !important;}
code{color:#9be7ff !important;}
.err{border-color:#e05a5a !important;}
.ok,.green{color:#3dff9e !important;}
#${MARK}{background:#0b1a14;border-top:1px solid #20503a;border-bottom:1px solid #20503a;
  color:#4d7d69;font:10px Tahoma,Verdana,Arial,sans-serif;letter-spacing:4px;text-align:center;padding:3px 0;margin:0 0 6px;}
`

function snowLine() {
  const flake = "* &#183; "
  return `<div id="${MARK}" aria-hidden="true">${flake.repeat(10)}</div>`
}

async function metaRow(env, sql, key) {
  try {
    return await env.DB.prepare(sql).bind(key).first()
  } catch { return null }
}

/**
 * Wrap a routed response with the seasonal skin. Returns the SAME response
 * object when the season is closed, so "no-op" is verifiable, not aspirational.
 */
export async function applyWinterSkin(request, env, res, nowSec) {
  try {
    if (!res || res.status !== 200) return res
    if (request.method !== "GET") return res
    const type = String(res.headers.get("content-type") || "")
    if (!type.includes("text/html")) return res

    const now = Math.floor(Number(nowSec) || Date.now() / 1000)
    const seasonRow = await metaRow(env, "SELECT value FROM winter_meta WHERE key=?1", "season")
    const activeRow = await metaRow(env, "SELECT value FROM meta WHERE key=?1", "winter.active")
    const season = seasonFromRows(seasonRow, activeRow, now, env)
    if (!season.active) return res

    const body = await res.text()
    // The idempotency guard must hand back a READABLE body: `res.text()` above
    // drained it, so returning `res` itself would fail downstream with
    // "Body is unusable" (the v2 dashboard carries the marker deliberately —
    // it draws its own Winterfest palette and must not be repainted).
    if (body.includes(MARK))
      return new Response(body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) })
    let out = body
    const style = `<style>${WINTER_SKIN_CSS}</style>`
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, style + "</head>")
    else out = style + out
    if (/<body[^>]*>/i.test(out)) out = out.replace(/(<body[^>]*>)/i, `$1${snowLine()}`)
    else out = snowLine() + out

    const headers = new Headers(res.headers)
    headers.delete("content-length")
    return new Response(out, { status: res.status, statusText: res.statusText, headers })
  } catch {
    // A skin must never break a page: any failure returns the untouched page.
    return res
  }
}

export { MARK as WINTER_SKIN_MARK }
