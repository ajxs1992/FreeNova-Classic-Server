// The /winter route table.
//
//   GET  /winter                     December hub
//   GET  /winter/tree                the player's own 24-slot tree (move form)
//   GET  /winter/tree/<steamid>       somebody else's tree, read-only
//   GET  /winter/gifts               openings by rarity + the last ten
//   GET  /winter/ornaments           the collection book (sets, secrets)
//   GET  /winter/advent              the 24-day calendar
//   GET  /winter/pass                30 free-track tiers
//   POST /winter/tree                action=move|style, token-gated, queues a
//                                    `wf_tree_*` action for the game
//
// Same auth posture as every other panel: the page is readable without a
// session (it is the player's own MOTD surface), and anything that CHANGES
// state is queued for the game with the ?t=/form-token contract from
// src/sync.js. No page here grants a reward — the game is the only authority.
import { page404, isMotdCompact, setMotdCompact } from "../ui.js"
import { mintActionToken, NO_MINT_MSG } from "../sync.js"
import { normalizeSteamid } from "../publicapi.js"
import { loadSeason } from "./season.js"
import { loadCatalog } from "./catalog.js"
import { loadState, queueWinterAction, lastWinterAction } from "./store.js"
import { pageWinterHub } from "./hub.js"
import { pageWinterTree } from "./tree.js"
import { pageWinterGifts } from "./gifts.js"
import { pageWinterOrnaments } from "./ornaments.js"
import { pageWinterAdvent } from "./advent.js"
import { pageWinterPass } from "./pass.js"

const nowSec = () => Math.floor(Date.now() / 1000)

function notFoundWinter() {
  const res = page404()
  return new Response(res.body, { status: 404, headers: res.headers })
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } })
}

/** Everything a page needs, fetched once. */
async function context(env, url, steamid) {
  const now = nowSec()
  const season = await loadSeason(env, now)
  const cat = await loadCatalog(env)
  const sid = normalizeSteamid(steamid)
  const state = await loadState(env, sid, season.year)
  const token = sid ? await mintActionToken(env, sid) : ""
  return { env, url, nowSec: now, season, cat, state, sid, steamid: sid, token }
}

export async function handleWinter(request, env, url) {
  const path = (url.pathname || "/").replace(/\/+$/, "") || "/"

  if (request.method === "POST") {
    if (path === "/winter/tree") return await handleTreePost(request, env, url)
    return new Response("method not allowed", { status: 405 })
  }
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 })

  const publicTree = /^\/winter\/tree\/([^/]+)$/.exec(path)
  if (publicTree) {
    const raw = decodeURIComponent(publicTree[1])
    const sid = normalizeSteamid(raw)
    if (!sid) return notFoundWinter()
    const ctx = await context(env, url, sid)
    // The public page keeps the same renderer, with the forms off.
    return pageWinterTree({ ...ctx, token: "" }, { readOnly: true, style: Number(url.searchParams.get("style") || 0) })
  }

  const ctx = await context(env, url, url.searchParams.get("steamid") || "")
  switch (path) {
    case "/winter":
    case "/winter/hub":
      return pageWinterHub(ctx)
    case "/winter/tree":
      ctx.lastAction = ctx.sid ? await lastWinterAction(env, ctx.sid) : null
      return pageWinterTree(ctx, { style: Number(url.searchParams.get("style") || 0) })
    case "/winter/gifts":
      return pageWinterGifts(ctx)
    case "/winter/ornaments":
      return pageWinterOrnaments(ctx)
    case "/winter/advent":
      return pageWinterAdvent(ctx)
    case "/winter/pass":
      return pageWinterPass(ctx, { full: url.searchParams.get("full") === "1" })
    default:
      return notFoundWinter()
  }
}

async function readForm(request) {
  const type = String(request.headers.get("content-type") || "")
  try {
    if (typeof request.formData === "function" && type.includes("form")) {
      const fd = await request.formData()
      const out = {}
      for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : ""
      return out
    }
  } catch { /* fall through to the manual parser */ }
  try {
    const text = await request.text()
    const out = {}
    for (const [k, v] of new URLSearchParams(text)) out[k] = v
    return out
  } catch { return {} }
}

async function handleTreePost(request, env, url) {
  // A refused POST still renders a page, and a GoldSrc client must get the
  // compact skin for it. index.js decides this flag for GETs only, because the
  // POST is dispatched before its user-agent block.
  const ua = String(request.headers.get("user-agent") || "")
  if (url.searchParams.get("compact") === "1" || /MSIE|Trident|Mozilla\/4\.0/i.test(ua))
    setMotdCompact(true)

  const form = await readForm(request)
  const action = String(form.action || "")
  const sid = normalizeSteamid(form.steamid)
  const token = String(form.t || "")
  const ctx = await context(env, url, sid)

  const fail = (message) => {
    ctx.lastAction = { type: action === "style" ? "wf_tree_style" : "wf_tree_move", arg: "", status: "failed", result: message }
    const res = pageWinterTree(ctx, {})
    return new Response(res.body, { status: 403, headers: res.headers })
  }

  if (!sid) return fail("This panel does not know which player to act for — open it from the game.")
  if (!token) return fail(NO_MINT_MSG)
  if (action !== "move" && action !== "style") return fail("Unknown action.")

  let queued
  if (action === "move") {
    const from = Number(form.from || 0)
    const to = Number(form.to || 0)
    // The mirror is the only thing the panel can check cheaply; the game still
    // validates the real inventory before it moves anything.
    if (!(from >= 1 && from <= 24) || !(to >= 1 && to <= 24)) return fail("Pick a slot between 1 and 24.")
    if (!ctx.state.slots.get(from)) return fail(`Slot ${from} is empty.`)
    queued = await queueWinterAction(env, sid, "wf_tree_move", `${from}:${to}`, token)
  } else {
    const style = Number(form.style || 0)
    if (!(style >= 1 && style <= 3)) return fail("Pick tree style 1, 2 or 3.")
    queued = await queueWinterAction(env, sid, "wf_tree_style", String(style), token)
  }

  if (!queued.ok) return fail(queued.error || "The request was refused.")
  const back = new URL(url.toString())
  back.pathname = "/winter/tree"
  back.search = new URLSearchParams({ steamid: sid, ...(isMotdCompact() ? { compact: "1" } : {}) }).toString()
  return redirect(back.pathname + (back.search ? "?" + back.search : ""))
}

export { pageWinterHub, pageWinterTree, pageWinterGifts, pageWinterOrnaments, pageWinterAdvent, pageWinterPass }
