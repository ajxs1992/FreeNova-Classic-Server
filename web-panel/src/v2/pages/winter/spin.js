// /v2/winter/spin — the Spin Wheel, rebuilt.
//
// WHAT IT IS: a VIEWER. The wheel, the prize table and the odds are the old
// page's own config (src/winter/spin_data.js, checked against
// configs/freenova/winterfest/spin.ini by web-panel/test_harness.mjs). The
// player's spins come from the same source the old page reads —
// loadSpinMirror() over winter_players.spins / winter_spin_log — and, when the
// game has mirrored nothing there, from the Winterfest mirror payload the top
// bar's Spins chip already reads (winter_meta.spin). Nothing here writes.
//
// WHAT IT IS NOT: a way to spin. A spin must be one atomic thing — take the
// token, roll, record the intent, pay, announce — and only the game can do
// that. So the page states the truth ("spins happen in game with /spin") and
// offers no button, instead of queueing an action nothing consumes.
//
// The wheel stays SVG (wheelSvg from src/winter/spin.js): a sector is drawn as
// an angle, because its angle IS its chance. Everything else that is a picture
// is generated art through artIcon().
import { esc, fmt } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon, BIG } from "../../art.js"
import { card, bar, emptyState } from "../../components.js"
import { wheelSvg } from "../../../winter/spin.js"
import {
  SPIN_SECTORS, SPIN_WHEEL, SPIN_RARITIES,
  spinOdds, spinTotalWeight, rarityWeight, prizeText, loadSpinMirror, nextResetAt
} from "../../../winter/spin_data.js"
import { parisMidnight, parisParts } from "../../../periods.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const TZ = SPIN_WHEEL.timezone || "Europe/Paris"
const clockFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
})

/** "24 Dec, 00:00" from a unix second count, in the wheel's own timezone. */
function clock(sec) {
  const n = Number(sec) || 0
  return n > 0 ? clockFmt.format(new Date(n * 1000)) : ""
}

/** The spins the season mirror carries for this player, if it carries any. */
function metaSpins(ctx) {
  const payload = ctx.meta && typeof ctx.meta.get === "function" ? ctx.meta.get("spin") : null
  if (!payload || typeof payload !== "object" || !ctx.sid) return null
  const row = payload.players && typeof payload.players === "object" ? payload.players[ctx.sid] : null
  const n = row && row.spins != null ? Number(row.spins) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

function rarityOf(sector) {
  return SPIN_RARITIES[sector.rarity] || SPIN_RARITIES.common
}

/**
 * The page's view model: the odds, the balance and where that balance came
 * from, plus the rarest slice (the smallest configured chance — a fact of the
 * weights, not a judgement about value).
 */
export async function spinView(ctx) {
  const odds = spinOdds(SPIN_SECTORS)
  const mirror = await loadSpinMirror(ctx.env, ctx.sid)
  const fromMirror = mirror.spins == null ? null : mirror.spins
  const fromMeta = fromMirror == null ? metaSpins(ctx) : null
  const spins = fromMirror != null ? fromMirror : fromMeta
  const source = fromMirror != null ? "winter_players.spins" : fromMeta != null ? "winter_meta.spin" : ""
  const rarest = odds.reduce((a, b) => (b.pct < a.pct ? b : a), odds[0] || null)
  const fade = SPIN_RARITIES[SPIN_WHEEL.fadeRarity] || null

  return {
    known: !!ctx.sid,
    cat: ctx.cat,
    odds,
    total: spinTotalWeight(SPIN_SECTORS),
    mirror,
    spins,
    source,
    rarest,
    fade,
    fadeWeight: rarityWeight(SPIN_WHEEL.fadeRarity, SPIN_SECTORS),
    results: mirror.results || [],
    resetAt: nextResetAt(ctx.nowSec, SPIN_WHEEL.resetHour, parisMidnight, parisParts)
  }
}

// -------------------------------------------------------------------- wheel ---
function wheelCard(v) {
  // Inline SVG in HTML needs no xmlns; dropping it also keeps every page free
  // of http(s) strings.
  const wheel = wheelSvg(SPIN_SECTORS, { hub: v.spins != null ? String(v.spins) : "?" })
    .replace(' xmlns="http://www.w3.org/2000/svg"', "")
  const fade = v.fade ? `${esc(v.fade.label)}+ <b>${v.fadeWeight.pct.toFixed(1)}%</b>` : ""
  return card({
    head: {
      icon: artIcon("spintoken", 26),
      title: "The Wheel",
      sub: "Every slice's angle is its chance, so the picture cannot disagree with the table."
    },
    body: `<div class="v2w-wheel">${wheel}</div>
    <div class="v2w-chips">
      <span class="v2w-chip">Daily <b>${fmt(SPIN_WHEEL.freePerDay)}</b></span>
      <span class="v2w-chip">Cap <b>${fmt(SPIN_WHEEL.max)}</b></span>
      <span class="v2w-chip">Sectors <b>${v.odds.length}</b></span>
      ${fade ? `<span class="v2w-chip">${fade}</span>` : ""}
    </div>
    <p class="v2w-note">The hub shows your balance when the game has pushed one. The wheel never stops for you here: spins are granted and spent in game.</p>`
  })
}

// ------------------------------------------------------------------ balance ---
function balanceNote(v) {
  if (v.spins == null) {
    return "The game has not pushed a spin counter to the panel for this player, so there is no number to print. Your balance is on /spin in game."
  }
  if (v.spins === 0) {
    return "No spins banked. The daily free spin is added by the game when you join on a new day; spins are granted and spent in game."
  }
  return `Enough for ${fmt(v.spins)} spin${v.spins === 1 ? "" : "s"} right now. A spin spends one token and pays one prize, in game.`
}

function balanceCard(v) {
  const known = v.spins != null
  const barHtml = known
    ? bar(v.spins, SPIN_WHEEL.max)
    : `<div class="v2-bar chance" role="img" aria-label="the game has not pushed a spin balance for this player"><i style="width:0"></i></div>`
  const empty = v.known
    ? ""
    : emptyState("No player on this visit", "Open this page from your session, or add ?steamid= to the address, and the spins the game has mirrored for you appear here.")
  return card({
    head: {
      icon: artIcon("spintoken", 26),
      title: "Your Spins",
      sub: known ? `${fmt(v.spins)} of ${fmt(SPIN_WHEEL.max)} banked` : "No balance pushed yet"
    },
    body: `<p class="v2w-big"><b>${known ? fmt(v.spins) : "&mdash;"}</b> <span>/ ${fmt(SPIN_WHEEL.max)} cap</span></p>
    ${barHtml}
    ${empty}
    <p class="v2w-note" style="margin-top:6px">${esc(balanceNote(v))}</p>
    ${v.source ? `<p class="v2w-note">Source: <code>${esc(v.source)}</code></p>` : ""}
    <p class="v2w-note">Read-only view — a spin happens in game with <code>/spin</code>.</p>`
  })
}

function rarestCard(v) {
  const r = v.rarest
  const detail = r ? prizeText(v.cat, r) : ""
  const showsDetail = r && String(detail).toLowerCase() !== String(r.label).toLowerCase()
  const body = r
    ? `<p class="v2w-big"><b>${esc(r.label)}</b></p>
       <p class="v2w-note">${showsDetail ? `${esc(detail)} · ` : ""}${esc(rarityOf(r).label)} · <b>${esc(r.pctText)}%</b> (weight ${fmt(r.weight)} of ${fmt(v.total)})</p>
       <p class="v2w-note">The rarest slice is the one with the smallest configured weight — a fact of the table, not a ranking of prizes.</p>`
    : `<p class="v2w-note">The prize table is empty, so there is no rarest slice to show.</p>`
  return card({
    head: { icon: artIcon("crown", 26), title: "Rarest Slice", sub: "The smallest configured chance" },
    body
  })
}

// ------------------------------------------------------------------- prizes ---
function prizeTile(cat, s) {
  const rar = rarityOf(s)
  const detail = prizeText(cat, s)
  const sub = detail && String(detail).toLowerCase() !== String(s.label).toLowerCase() ? detail : ""
  return `<div class="v2w-prize" style="--rc:${esc(rar.color)}">
    <span class="top"><span class="n">#${s.index}</span><span class="rar">${esc(rar.label)}</span></span>
    <b>${esc(s.label)}</b>
    ${sub ? `<small>${esc(sub)}</small>` : ""}
    <span class="pc"><b>${esc(s.pctText)}%</b> <span>weight ${fmt(s.weight)}</span></span>
    <span class="rb" aria-hidden="true"><i style="width:${Math.max(2, Math.round(s.pct))}%"></i></span>
  </div>`
}

function prizesCard(v) {
  return card({
    head: {
      icon: artIcon("gift", 26),
      title: "Possible Rewards",
      sub: `${v.odds.length} sectors — weight, chance and what the game pays`
    },
    body: `<div class="v2w-prizes">${v.odds.map(s => prizeTile(v.cat, s)).join("")}</div>
    <p class="v2w-note" style="margin-top:8px">Weights are the configured ones (they sum to ${fmt(v.total)}); a sector's chance is its weight over that sum.
    A prize the game cannot pay you right now — an ornament you already own, a present bag that is full — is skipped on the wheel and its chance is spread
    over the rest, so a spent spin always buys a real prize. Nothing here is an estimate.</p>`
  })
}

// -------------------------------------------------------------- the 3 strip ---
function earnCard() {
  const rows = [
    ["clock", `One free spin a day, added by the game when you join on a new day`],
    ["gift", "Spins from presents, Advent days, Winter Pass tiers and the odd gift"],
    ["star", "An admin can grant spins too — there is no web purchase for them"]
  ].map(([ic, text]) => `<div class="v2w-tlrow">
      <span aria-hidden="true">${icon(ic, 15)}</span>
      <span class="d" style="white-space:normal">${esc(text)}</span>
    </div>`).join("")
  return card({
    head: { icon: artIcon("missions", 24), title: "How Spins Arrive", sub: "Granted by the game, never by this page" },
    body: `<div class="v2w-tl">${rows}</div>`
  })
}

function rulesCard(v) {
  const rows = [
    ["In game", "Type /spin. The menu shows your balance; picking \"Spin the wheel\" spends one token, turns the wheel and pays the prize."],
    ["No double-spend", "The token is taken before the prize is paid and the claim key is written before the announcement, so a reconnect can never pay twice."],
    ["Why no button here", "Only the game can spend a token atomically, and this deployment has no authenticated panel-to-game write path for spins. A button that queued an action nothing consumes would be a lie, so there is none."]
  ].map(([k, text]) => `<div class="v2w-tlrow">
      <span aria-hidden="true">${icon("check", 15)}</span>
      <span class="d" style="white-space:normal"><b>${esc(k)}</b><small style="white-space:normal">${esc(text)}</small></span>
    </div>`).join("")
  return card({
    head: { icon: artIcon("spintoken", 24), title: "How a Spin Works", sub: "One token, one prize, one atomic turn" },
    body: `<div class="v2w-tl">${rows}</div>
    <p class="v2w-note" style="margin-top:8px">The daily free spin is added at ${String(SPIN_WHEEL.resetHour).padStart(2, "0")}:00 ${esc(TZ)}${
      v.resetAt ? ` — next: ${esc(clock(v.resetAt))}` : ""
    }.</p>`
  })
}

function resultsCard(v) {
  const rows = v.results.length
    ? v.results.map(r => `<div class="v2w-tlrow">
        <span aria-hidden="true">${artIcon("spintoken", 15)}</span>
        <span class="d">#${fmt(r.sector)}<small>${esc(clock(r.at))}</small></span>
        <span class="r">${esc(r.label || prizeText(v.cat, r))}</span>
      </div>`).join("")
    : emptyState("No spins logged to the panel yet", "Your last ten results appear here once the game pushes them; /spin in game shows your balance.")
  const extras = !v.results.length && v.mirror.missing && v.mirror.missing.length
    ? `<p class="v2w-note" style="margin-top:6px">Not pushed by this deployment: ${esc(v.mirror.missing.join(", "))}.</p>`
    : ""
  return card({
    head: { icon: artIcon("spintoken", 24), title: "Recent Spins", sub: `${fmt(v.results.length)} mirrored` },
    body: `<div class="v2w-tl">${rows}</div>${extras}
    <p class="v2w-note" style="margin-top:8px">Your presents, tree and Battle Pass are on the
    <a href="/v2/winter">Winterfest hub</a>; spins come from <a href="/missions">missions</a> and
    <a href="/v2/winter/pass">Battle Pass</a> tiers.</p>`
  })
}

// ------------------------------------------------------------------ styles ---
const SPIN_CSS = `
.v2w-wheel{max-width:520px;margin:0 auto}
.v2w-wheel svg{display:block;width:100%;height:auto;filter:drop-shadow(0 10px 22px rgba(0,0,0,.45))}
.v2w-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;justify-content:center}
.v2w-chip{font-size:11.5px;font-weight:700;color:#a6b4d6;border:1px solid var(--v2-border);
  background:#101a3a;border-radius:999px;padding:3px 10px}
.v2w-chip b{color:#eef2ff}
.v2w-prizes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}
@media (max-width:1180px){.v2w-prizes{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:820px){.v2w-prizes{grid-template-columns:repeat(2,minmax(0,1fr))}}
.v2w-prize{display:flex;flex-direction:column;gap:4px;padding:9px 10px 8px;border-radius:12px;
  background:linear-gradient(180deg,#141d44 0%, #0d1434 100%);border:1px solid var(--v2-border);min-height:108px}
.v2w-prize .top{display:flex;align-items:center;gap:7px}
.v2w-prize .n{font-size:10.5px;font-weight:800;color:#93a3c8;letter-spacing:.6px}
.v2w-prize .rar{margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--rc,#9fb0d0)}
.v2w-prize b{font-size:12.5px;font-weight:800;color:#eef2ff;line-height:1.2}
.v2w-prize small{font-size:11px;color:#a6b4d6;line-height:1.25}
.v2w-prize .pc{margin-top:auto;display:flex;align-items:baseline;gap:6px;font-size:10.5px;font-weight:700;color:#8c9cc4}
.v2w-prize .pc b{font-size:12.5px;font-weight:800;color:var(--rc,#eef2ff);font-variant-numeric:tabular-nums}
.v2w-prize .rb{display:block;height:6px;border-radius:999px;background:#0b1235;border:1px solid #24315c;overflow:hidden}
.v2w-prize .rb i{display:block;height:100%;background:var(--rc,#9fb0d0)}
`

// -------------------------------------------------------------------- page ---
export async function pageWinterSpinV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const view = await spinView(ctx)

  const hero = winterHero({
    title: "Spin Wheel",
    sub: "Spin and win exclusive Winterfest rewards!",
    badge: `${artIcon("spintoken", 18)}<b>${view.odds.length}</b> prizes`,
    artLeft: { src: BIG.tree, w: 1024, h: 1536 },
    artRight: { src: BIG.santa, w: 1024, h: 1536 }
  })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${wheelCard(view)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${balanceCard(view)}${rarestCard(view)}</div>
</div>
${prizesCard(view)}
<div class="v2w-strip">${earnCard()}${rulesCard(view)}${resultsCard(view)}</div>`

  return winterPage({
    title: "Spin Wheel",
    active: "spin",
    tab: "spin",
    ctx,
    content: body,
    extraCss: SPIN_CSS
  })
}
