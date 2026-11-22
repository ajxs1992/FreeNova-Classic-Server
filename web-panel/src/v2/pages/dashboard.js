// The Winterfest dashboard — the first page built on the v2 shell.
//
// Mounted at /v2 (and /v2/hub) while the rebuild is cutover page by page: the
// live `/` keeps serving the old hub untouched (docs/design/PANEL-REBUILD.md).
// Every number is a field of the view model from ../data/dashboard.js, which is
// the only place that reads the database. Nothing in this file computes a
// player-facing number except a percentage of two real values.
//
// Composition, top to bottom, matching the reference:
//   hero (art + lockup + countdown) · five-stat strip · three cards
//   (tree / event progress / recent rewards) · four event cards · wiring note

import { esc, fmt } from "../theme.js"
import { icon } from "../icons.js"
import {
  card, cardHead, statCard, bar, pill, countdown, sectionHeading,
  emptyState, itemTile, counterTile, button, progressRow, devNote
} from "../components.js"
import { page } from "../shell.js"

const seasonLabel = s => `${String((s && s.name) || "Winterfest").toUpperCase()} ${(s && s.year) || ""}`.trim()

/** "The Christmas Event is Live!" / "Winterfest opens on 1 December." */
function heroSub(season, data) {
  const phase = season && season.phase
  if (phase === "open") return "The Christmas Event is Live!"
  if (phase === "before") return `${season.name} opens on ${esc(season.startKey)}`
  if (phase === "disabled") return "The season is switched off for now."
  return `${season.name} ${(season && season.year) || ""} has closed — see you in December.`.replace(/\s+—/, " —")
}

/**
 * The countdown tick. Purely additive: the server renders the correct numbers,
 * the script only moves them while the tab is open. With JS off the page is
 * complete and correct on load (the check in test_harness.mjs strips the script
 * and asserts the cells are still there).
 */
const COUNTDOWN_JS = `<script>
(function(){
  var box=document.getElementById("v2-count"); if(!box) return;
  var left=Number(box.getAttribute("data-left"))||0; if(!left) return;
  var c=box.querySelectorAll("[data-cd]"); if(c.length!==4) return;
  var pad=function(n){return n<10?"0"+n:String(n)};
  function draw(){
    var d=Math.floor(left/86400),h=Math.floor(left%86400/3600),m=Math.floor(left%3600/60),s=left%60;
    c[0].textContent=d; c[1].textContent=pad(h); c[2].textContent=pad(m); c[3].textContent=pad(s);
  }
  if(left>0){ setInterval(function(){ if(left>0){left--; draw();} },1000); }
})();
</script>`

function hero(d) {
  const s = d.season
  return `<section class="v2-hero" aria-labelledby="v2-hero-title">
  <img class="v2-santa" src="/winter/santa.png" width="189" height="278"
       alt="Santa Claus waving, standing beside a lit lamp post">
  <div class="v2-hero-inner">
    <h1 class="v2-lockup" id="v2-hero-title">Free<span>Nova</span></h1>
    <p class="v2-ribbon">${esc(seasonLabel(s))}</p>
    <p class="v2-hero-sub">${heroSub(s, d)}</p>
    <div class="v2-hero-count" data-left="${d.countdown.left}">
      ${countdown({ label: d.countdown.label, parts: d.countdown.parts, id: "v2-count" })}
    </div>
  </div>
</section>`
}

function stats(d) {
  const t = d.tree, p = d.pass, a = d.advent, m = d.currency.missions, e = d.events
  const adventValue = a.today > 0 ? `Day ${fmt(a.today)} / ${fmt(a.total)}` : `${fmt(a.claimed)} / ${fmt(a.total)} claimed`
  return `<section class="v2-stats" aria-label="At a glance">
  ${statCard({ icon: icon("tree", 38), title: "My Tree", value: `${t.pct}%`, tone: "green", href: "/winter/tree" })}
  ${statCard({ icon: icon("crown", 38), title: "Battle Pass", value: `Lv. ${fmt(p.tier)}`, href: "/battlepass" })}
  ${statCard({ icon: icon("advent", 38), title: "Advent", value: adventValue, href: "/winter/advent" })}
  ${statCard({ icon: icon("missions", 38), title: "Missions", value: `${fmt(m.open)} / ${fmt(m.total)}`, href: "/missions" })}
  ${statCard({ icon: icon("confetti", 38), title: "Events", value: `Active: ${fmt(e.active)}`, href: "/events" })}
</section>`
}

function treeCard(d) {
  const t = d.tree
  const counters = t.ornaments.map(o => counterTile({ icon: icon(o.icon, 22), value: o.value, label: o.label })).join("")
  const body = `<div class="v2-tree">
    <img class="v2-tree-art" src="/winter/tree.png" width="182" height="203"
         alt="A decorated Christmas tree with a gold star and presents underneath">
    <div class="v2-tree-side">
      <div class="v2-treeprog"><b>Tree Progress</b><em>${t.pct}%</em></div>
      ${bar(t.filled, t.total)}
      <p class="v2-treeslots">${fmt(t.filled)} of ${fmt(t.total)} slots filled${t.level > 0 ? ` &middot; level ${fmt(t.level)}` : ""}</p>
      <div class="v2-counts">${counters}</div>
      ${button({ href: "/winter/tree", label: "Decorate Tree", icon: icon("arrow", 18) })}
    </div>
  </div>`
  return card({
    head: { icon: icon("tree", 30), title: "Your Christmas Tree", sub: "Collect ornaments and decorate your tree!", id: "v2-tree-h" },
    body, label: "v2-tree-h"
  })
}

function progressCard(d) {
  const known = d.objectives.some(o => o.known)
  const rows = d.objectives.map(o => progressRow({
    icon: icon(o.icon, 22), label: o.label, current: o.current, target: o.target,
    empty: "no season data yet"
  })).join("")
  const body = `${rows}${known ? "" : emptyState("No objective counters yet")}`
  return card({
    head: { icon: icon("rosette", 30), title: "Event Progress", sub: "Complete Winterfest objectives for exclusive rewards!", id: "v2-prog-h" },
    body, label: "v2-prog-h"
  })
}

function rewardsCard(d) {
  const tiles = d.rewards.length
    ? `<div class="v2-tiles">${d.rewards.map(r => itemTile({
      art: r.art, title: r.title, sub: r.sub, tone: r.tone
    })).join("")}</div>`
    : emptyState("No rewards claimed yet", "The last four grants from the game's claim ledger appear here.")
  return card({
    head: { icon: icon("gift", 30), title: "Recent Rewards", sub: "Your latest Christmas rewards!", id: "v2-rw-h" },
    body: tiles, label: "v2-rw-h", class: d.rewards.length ? "" : "v2-card-center"
  })
}

function eventCards(d) {
  const head = `<div class="v2-events-head">
    ${sectionHeading({ icon: icon("advent", 26), text: "Active Winterfest Events", id: "v2-ev-h" })}
  </div>`
  const list = d.events.list.length
    ? `<div class="v2-events" role="list" aria-labelledby="v2-ev-h">${d.events.list.map(e => `<a class="v2-evt ${e.tone}" role="listitem" href="${esc(e.href)}">
        <span class="v2-evt-art" aria-hidden="true">${icon(e.ic, 54)}</span>
        <span class="v2-evt-t">
          <b>${esc(e.title)}</b>
          <small>${esc(e.blurb)}</small>
          ${pill({ tone: e.state.tone, label: e.state.label })}
        </span>
      </a>`).join("")}</div>`
    : emptyState("No Winterfest events scheduled", "Active and scheduled rows from the events calendar appear here.")
  return `${head}${list}`
}

export const DASH_CSS = `
/* ---------------------------------------------------------------- hero ---- */
.v2-hero{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--v2-border);
  aspect-ratio:1345/284;min-height:190px;max-height:284px;
  background:#080d2a url(/winter/hero.png) center center / cover no-repeat;
  box-shadow:0 16px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(160,190,255,.18)}
.v2-hero::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(46% 62% at 50% 42%, rgba(140,110,255,.30) 0%, rgba(140,110,255,0) 72%),
    linear-gradient(180deg, rgba(6,9,32,.18) 0%, rgba(6,9,32,0) 40%, rgba(5,8,26,.42) 100%)}
.v2-santa{position:absolute;left:72.4%;top:3.4%;height:99%;width:auto;z-index:1;pointer-events:none;
  filter:drop-shadow(0 10px 18px rgba(0,0,0,.35))}
.v2-hero-inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;
  height:100%;padding:clamp(4px,.7vh,9px) 12px 8px;text-align:center}
.v2-lockup{font-size:clamp(27px,3.75vw,56px);font-weight:800;letter-spacing:.5px;line-height:1;
  color:#f7faff;text-shadow:0 3px 0 #4b2d6b, 0 8px 22px rgba(0,0,0,.75), 0 0 24px rgba(180,200,255,.35)}
.v2-lockup span{color:#dbe6ff}
.v2-ribbon{position:relative;margin-top:clamp(2px,.5vh,6px);padding:1px 42px;
  font-size:clamp(13px,1.5vw,23px);font-weight:800;letter-spacing:clamp(1.5px,.2vw,3.4px);
  color:#fff;background:linear-gradient(180deg,#e64a4a 0%, #c81f22 52%, #a3100f 100%);
  border-top:2px solid #f0908f;border-bottom:2px solid #7c0d0d;border-radius:3px;
  clip-path:polygon(0 0,100% 0,96.5% 50%,100% 100%,0 100%,3.5% 50%);
  box-shadow:0 8px 20px rgba(160,16,16,.45);text-shadow:0 1px 2px rgba(80,0,0,.7)}
.v2-hero-sub{margin-top:clamp(3px,.7vh,7px);font-size:clamp(12px,1.22vw,19px);font-weight:700;
  color:#f2f6ff;text-shadow:0 2px 8px rgba(0,0,0,.8)}
.v2-hero-count{margin-top:auto;width:min(430px,92%)}
.v2-hero-count .v2-count{background:linear-gradient(180deg,rgba(24,28,80,.88),rgba(8,10,38,.92))}

/* --------------------------------------------------------------- stats ---- */
.v2-stat{padding:8px 10px}
.v2-stat b,.v2-stat em{font-size:15px}
.v2-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:clamp(7px,.8vw,15px)}

/* ---------------------------------------------------------------- tree ---- */
.v2-cols3{display:grid;grid-template-columns:452fr 407fr 435fr;gap:clamp(11px,1.1vw,22px);align-items:stretch}
.v2-card-center .v2-empty{margin:auto 0;align-self:center}
.v2-card-center{display:flex;flex-direction:column}
.v2-card-center .v2-empty{margin-top:auto}
.v2-tree{display:grid;grid-template-columns:minmax(0,182px) minmax(0,1fr);gap:8px;align-items:end}
.v2-tree-art{width:100%;height:auto;max-height:192px;object-fit:contain;object-position:bottom left;align-self:end;margin:0 0 -12px -12px}
.v2-tree-side{min-width:0;display:grid;gap:6px;align-content:start;padding-bottom:2px}
.v2-treeprog{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.v2-treeprog b{font-size:14.5px;font-weight:700}
.v2-treeprog em{font-style:normal;font-size:24px;font-weight:800;color:var(--v2-green-alt);line-height:1;
  text-shadow:0 0 16px rgba(92,224,138,.45)}
.v2-treeslots{color:var(--v2-muted);font-size:11.5px}
.v2-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:1px 0}
.v2-tree-side .v2-btn{margin-top:1px;font-size:13px;padding:7px 14px}

/* -------------------------------------------------------------- rewards --- */
.v2-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(6px,.6vw,10px);align-content:start}

/* -------------------------------------------------------------- events ---- */
.v2-events-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:2px}
.v2-seeall{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;
  color:var(--v2-ice-alt);text-decoration:none}
.v2-seeall:hover{color:var(--v2-gold)}
.v2-events{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(10px,1.05vw,18px)}
.v2-evt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center;
  padding:10px 13px;min-height:112px;border-radius:16px;text-decoration:none;color:var(--v2-text);
  border:1px solid #2f7d55;
  background:
    radial-gradient(120% 80% at 0% 50%, rgba(46,140,90,.45) 0%, rgba(46,140,90,0) 62%),
    linear-gradient(180deg,#122a44 0%, #0d1734 100%);
  box-shadow:inset 0 1px 0 rgba(150,220,180,.18), 0 10px 22px rgba(0,0,0,.32)}
.v2-evt.gold{border-color:#8a6a24;
  background:radial-gradient(120% 80% at 0% 50%, rgba(180,120,40,.42) 0%, rgba(180,120,40,0) 62%), linear-gradient(180deg,#2a1e2e 0%, #13112c 100%)}
.v2-evt.ice{border-color:#3a5f8f;
  background:radial-gradient(120% 80% at 0% 50%, rgba(60,110,180,.42) 0%, rgba(60,110,180,0) 62%), linear-gradient(180deg,#132238 0%, #0e1330 100%)}
.v2-evt.violet{border-color:#5b3f9e;
  background:radial-gradient(120% 80% at 0% 50%, rgba(120,80,210,.42) 0%, rgba(120,80,210,0) 62%), linear-gradient(180deg,#221a44 0%, #120f2c 100%)}
.v2-evt:hover{border-color:var(--v2-gold);transform:translateY(-1px)}
.v2-evt-art{line-height:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
.v2-evt-t{min-width:0;display:grid;gap:3px}
.v2-evt-t b{font-size:15px;font-weight:800;line-height:1.15}
.v2-evt-t small{color:#b9c6e2;font-size:11.5px;line-height:1.3}
.v2-evt-t .v2-pill{justify-self:start;margin-top:2px}

/* --------------------------------------------------------------- media ---- */
/* 1672 is the reference; 1920 gets more air, 1280 has to lose the extras —
   the same rules, one narrower type scale (nothing is repositioned). */
@media (max-width:1520px){
  .v2-counts{gap:5px}
  .v2-tree{grid-template-columns:minmax(0,150px) minmax(0,1fr)}
  .v2-treeprog em{font-size:21px}
  .v2-tree-side .v2-btn{font-size:12.5px;padding:6px 11px}
}
@media (max-width:1400px){
  .v2-plus{display:none}
  .v2-chip{padding:6px 9px;gap:7px}
  .v2-chip-ic svg{width:30px;height:30px}
  .v2-chip-t b{font-size:15px}
  .v2-chip-t small{font-size:11px}
  .v2-profile-t b{max-width:96px}
  .v2-group{letter-spacing:1.3px;font-size:8.5px;white-space:nowrap}
}
@media (max-width:1340px){
  .v2-cols3{grid-template-columns:1.06fr 1fr 1.02fr;gap:13px}
  .v2-stats{gap:8px}
  .v2-stat{padding:6px 8px;gap:7px}
  .v2-stat b, .v2-stat em{font-size:13.5px}
  .v2-stat .v2-ic svg{width:26px;height:26px}
  .v2-tree{grid-template-columns:minmax(0,124px) minmax(0,1fr)}
  .v2-counts{gap:4px}
  .v2-events{grid-template-columns:repeat(2,minmax(0,1fr))}
  .v2-evt{min-height:112px}
}
@media (max-width:1080px){
  .v2-tree{grid-template-columns:1fr}
  .v2-tree-art{max-width:170px;margin:0 auto -10px}
  .v2-cols3{grid-template-columns:1fr}
  .v2-events{grid-template-columns:1fr}
}
`

/** The page. `d` is the view model from loadDashboard(). */
export function render(d, opts = {}) {
  const chips = [
    {
      icon: icon("coins", 38), value: fmt(d.currency.coins), label: "Coins",
      addHref: "/shop", addTitle: "Coin shop — purchases happen in game"
    },
    {
      icon: icon("gingerbread", 38), value: fmt(d.currency.gingerbread), label: "GingerBread",
      addHref: "/winter/gifts", addTitle: "GingerBread comes from presents — open them in game"
    },
    {
      icon: icon("dice", 38), value: fmt(d.currency.spins), label: "Spins",
      addHref: "", addTitle: "Spins are awarded by the Spin Wheel (workstream 13, not live yet)"
    },
    {
      icon: icon("missions", 38), value: fmt(d.currency.missions.open), label: "Missions",
      addHref: "/missions", addTitle: "Open seasonal contracts"
    }
  ]

  const content = `${hero(d)}
${stats(d)}
${d.player.signedIn ? "" : `<p class="v2-hint">${esc("Showing the season and the live event board. Open this panel from the game — or add ?steamid=STEAM_0:0:12345 — to see your own coins, tree and rewards.")}</p>`}
<div class="v2-cols3">${treeCard(d)}${progressCard(d)}${rewardsCard(d)}</div>
${eventCards(d)}
${devNote(d.wiring, "Data wiring — this page says what is real")}`

  return page({
    title: `${d.season.name || "Winterfest"} — FreeNova`,
    active: "dashboard",
    season: d.season,
    player: d.player,
    chips,
    bell: d.bell,
    content,
    script: COUNTDOWN_JS,
    head: `<style>${DASH_CSS}</style>`,
    meta: '<meta name="robots" content="noindex"><!-- wf-winter-skin: this page owns the Winterfest palette; the seasonal skin must not repaint it (winter/skin.js keys its idempotency guard on this marker). -->'
  })
}
