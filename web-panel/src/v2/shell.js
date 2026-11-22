// The v2 shell — rail, top bar and page frame.
//
// One shell for every rebuilt page (docs/design/PANEL-REBUILD.md). A page hands
// it: which nav item is current, who the player is, the four currency chips,
// the bell state, and one block of content. It does NOT hand it a grid: the
// content region belongs to the page, which is how a table-heavy board and a
// two-column profile can both live in this frame without touching it.
//
// Nothing here fetches. `page()` is pure markup; the caller (a page module,
// fed by an adapter) supplies the values, so the shell can be unit-tested with
// a literal player and the same numbers the page shows come from one read.

import { esc, document as doc, css } from "./theme.js"
import { icon, FLAKE } from "./icons.js"
import { artIcon, ART_CSS, ICON_SIZE } from "./art.js"
import { currencyChip, groupLabel, COMPONENT_CSS } from "./components.js"

/**
 * The rail. Groups, order and one-line subtitles are the owner's reference.
 * Every row points at a page that exists: the Winterfest family lives under
 * /v2/winter/* (this rebuild), the rest are the live panel's routes. `href: null`
 * is still supported for a destination that does not exist yet — it renders as
 * visible-but-inert with the reason in `title`, never as a link that 404s — but
 * no row uses it any more: the last two (Levels, Spin Wheel) shipped.
 */
export const NAV = [
  {
    label: "Player",
    items: [
      { key: "dashboard", title: "Dashboard", sub: "Winterfest overview & countdown", href: "/v2", ic: "dashboard" },
      { key: "profile", title: "Profile", sub: "Christmas frames, badges & tree", href: "/profile", ic: "profile" },
      { key: "rankstats", title: "Rankstats", sub: "Festive statistics", href: "/rankstats", ic: "stats" },
      { key: "top15", title: "Top 15", sub: "Christmas leaderboard", href: "/top15", ic: "trophy" }
    ]
  },
  {
    label: "Progression",
    items: [
      { key: "battlepass", title: "Battle Pass", sub: "Christmas reward tracks", href: "/v2/winter/pass", ic: "flag" },
      { key: "missions", title: "Missions", sub: "Christmas quests", href: "/missions", ic: "missions" },
      { key: "achievements", title: "Achievements", sub: "Seasonal medals", href: "/achievements", ic: "medal" },
      { key: "levels", title: "Levels", sub: "Progress & rewards", href: "/levels", ic: "levels" }
    ]
  },
  {
    label: "Events & Activities",
    items: [
      { key: "events", title: "Events", sub: "Christmas event calendar", href: "/events", ic: "events" },
      { key: "advent", title: "Calendar Advent", sub: "Advent calendar (24 days)", href: "/v2/winter/advent", ic: "advent" },
      { key: "spin", title: "Spin Wheel", sub: "Win coins, gingerbread & rewards", href: "/v2/winter/spin", ic: "wheel" }
    ]
  },
  {
    label: "Rewards & Management",
    items: [
      { key: "vip", title: "VIP", sub: "Christmas VIP cosmetics", href: "/vip", ic: "crown" },
      { key: "shop", title: "Shop", sub: "Christmas-themed shop", href: "/shop", ic: "shop" },
      { key: "admin", title: "Admin Panel", sub: "Event management & settings", href: "/admin", ic: "gear" }
    ]
  }
]

/** The logo block: trees, wordmark, and the season ribbon. Text, not art. */
export function logo(season) {
  const name = (season && season.name) || "Winterfest"
  const year = (season && season.year) || new Date().getUTCFullYear()
  return `<a class="v2-logo" href="/v2" aria-label="FreeNova ${esc(name)} ${esc(year)} dashboard">
    <span class="v2-logo-row">
      <span class="v2-logo-tree" aria-hidden="true">${""}</span>
      <span class="v2-logo-word">Free<b>Nova</b><span class="v2-logo-hat" aria-hidden="true">${""}</span></span>
      <span class="v2-logo-tree flip" aria-hidden="true">${""}</span>
    </span>
    <span class="v2-logo-ribbon">${esc(name.toUpperCase())} ${esc(year)}</span>
  </a>`
}

/** One nav item, as a link when it exists and an inert row when it does not. */
function navItem(it, active) {
  const cur = it.key === active
  const mark = cur ? ' aria-current="page"' : ""
  const inner = `<span class="v2-nav-ic" aria-hidden="true">${artIcon(it.ic, ICON_SIZE.nav)}</span>
      <span class="v2-nav-t"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>`
  if (!it.href) {
    return `<li><span class="v2-navitem soon" aria-disabled="true" title="${esc(it.soon || "Not built yet.")}">${inner}<span class="v2-soon">soon</span></span></li>`
  }
  return `<li><a class="v2-navitem${cur ? " on" : ""}" href="${esc(it.href)}"${mark}>${inner}</a></li>`
}

export function rail(active, season) {
  const groups = NAV.map(g => `${groupLabel(g.label)}
    <ul class="v2-navlist">${g.items.map(i => navItem(i, active)).join("")}</ul>`).join("")
  return `<aside class="v2-rail">
  ${logo(season)}
  <nav class="v2-nav" aria-label="FreeNova sections">${groups}</nav>
  <div class="v2-rail-foot" aria-hidden="true">
    <svg viewBox="0 0 293 120" preserveAspectRatio="none">
      <path d="M0 78c34-16 62 10 96 4s54-22 88-14 70 26 109 10v42H0z" fill="#0a0f2b"/>
      <path d="M0 92c40-14 66 8 104 2s58-18 92-10 62 20 97 8v28H0z" fill="#111a44"/>
      <circle cx="60" cy="30" r="1.6" fill="#9be7ff" opacity=".7"/>
      <circle cx="150" cy="18" r="1.4" fill="#9be7ff" opacity=".5"/>
      <circle cx="228" cy="40" r="1.6" fill="#9be7ff" opacity=".6"/>
    </svg>
    <span class="v2-rail-gift" aria-hidden="true">${""}</span>
  </div>
</aside>`
}

/**
 * The top bar. `player` is {name, level, steamid, known}; `bell` is
 * {unread, href}; the envelope opens /mail (the inbox shipped).
 */
export function topbar({ chips, player, bell }) {
  const p = player || {}
  const name = p.name || "Guest"
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "FN"
  const level = p.level > 0 ? `Level ${esc(String(p.level))}` : (p.known ? "Level 0" : "not signed in")
  const dot = bell && bell.unread > 0
    ? `<span class="v2-dot" title="${esc(String(bell.unread))} unread"></span>`
    : ""
  return `<header class="v2-top">
  <div class="v2-chips">${(chips || []).map(currencyChip).join("")}</div>
  <div class="v2-topright">
    <a class="v2-iconbtn" href="${esc((bell && bell.href) || "/events")}" aria-label="Live events and announcements${bell && bell.unread ? `, ${esc(String(bell.unread))} unread` : ""}" title="Live events and announcements">${icon("bell", 26)}${dot}</a>
    <a class="v2-iconbtn" href="/mail" title="Inbox" aria-label="Inbox">${icon("envelope", 26)}</a>
    <a class="v2-profile" href="${esc(p.href || "/profile")}" title="${esc(p.known ? "Open your profile" : "Open the panel from the game for your own numbers")}">
      <span class="v2-avatar" aria-hidden="true">${esc(initials)}</span>
      <span class="v2-profile-t"><b>${esc(name)}</b><small>${level}</small></span>
      <span class="v2-chev" aria-hidden="true">${icon("chevron", 18)}</span>
    </a>
  </div>
</header>`
}

/**
 * The page frame. `content` is the page's own content region; `script` is the
 * optional progressive enhancement (the countdown tick), never page data.
 */
export function page({ title, active, season, player, chips, bell, content, script = "", head = "", meta = "" }) {
  return doc({
    title,
    head,
    meta,
    script,
    css: css(COMPONENT_CSS, SHELL_CSS, ART_CSS),
    body: `<a class="v2-skip" href="#v2-main">Skip to content</a>
<div class="v2-app">
  ${rail(active, season)}
  <div class="v2-col">
    ${topbar({ chips, player, bell })}
    <main class="v2-main" id="v2-main">${content}</main>
  </div>
</div>`
  })
}

export const SHELL_CSS = `
/* ----------------------------------------------------------------- rail --- */
.v2-rail{position:sticky;top:0;align-self:start;display:flex;flex-direction:column;height:100vh;padding:8px 10px 0;
  background:
    radial-gradient(120% 26% at 50% 0%, rgba(46,34,120,.85) 0%, rgba(46,34,120,0) 70%),
    linear-gradient(180deg,#151239 0%, #100c2f 42%, #0a0722 100%);
  border-right:1px solid rgba(58,38,120,.55)}
.v2-logo{display:block;text-align:center;text-decoration:none;color:var(--v2-text);padding:4px 0 8px}
.v2-logo-row{display:flex;align-items:center;justify-content:center;gap:6px}
.v2-logo-tree{line-height:0;transform:scale(.9)}
.v2-logo-tree.flip{transform:scaleX(-1) scale(.9)}
.v2-logo-word{position:relative;font-size:clamp(23px,1.9vw,30px);font-weight:800;letter-spacing:.4px;
  color:#f4f7ff;text-shadow:0 2px 0 #2a3170, 0 6px 16px rgba(80,120,255,.55)}
.v2-logo-word b{color:#cfe0ff;font-weight:800}
.v2-logo-hat{position:absolute;right:-6px;top:-12px;line-height:0}
.v2-logo-ribbon{display:inline-block;margin-top:2px;padding:2px 16px;border-radius:3px;
  background:linear-gradient(180deg,#e33b3b,#a91018);border:1px solid #f0837f;
  color:#fff;font-size:10px;font-weight:800;letter-spacing:2.4px;
  box-shadow:0 4px 12px rgba(180,20,30,.45)}
.v2-nav{margin-top:6px;overflow-y:auto;padding-bottom:96px}
.v2-navlist{list-style:none;margin:0;padding:0}
.v2-navitem{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:12px;border:1px solid transparent;
  text-decoration:none;color:var(--v2-text);position:relative}
.v2-navitem .v2-nav-ic{line-height:0;flex:0 0 auto;display:grid;place-items:center;width:46px;height:46px;transition:transform .12s ease}
.v2-navitem .v2-nav-t{min-width:0}
.v2-navitem b{display:block;font-size:14.5px;font-weight:700;line-height:1.2}
.v2-navitem small{display:block;color:#9fb0d0;font-size:10.5px;line-height:1.25;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v2-navitem:hover{background:rgba(124,92,214,.16);border-color:rgba(124,92,214,.42)}
.v2-navitem:hover .v2-nav-ic{transform:translateY(-1px)}
.v2-navitem.on{background:linear-gradient(90deg,#2a1a63 0%, #3d2091 55%, #2a1a63 100%);
  border-color:var(--v2-violet-alt);
  box-shadow:inset 0 0 18px rgba(124,92,214,.55), 0 6px 18px rgba(60,30,140,.45)}
.v2-navitem.on b{color:#fff}
.v2-navitem.on small{color:#c9bff5}
.v2-navitem.soon{color:#8593b8;cursor:not-allowed}
.v2-navitem.soon b{color:#8d9cbd}
.v2-navitem.soon small{color:#66739a}
.v2-soon{position:absolute;right:8px;top:8px;font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;
  color:#7f8fb5;border:1px solid #33447c;border-radius:999px;padding:0 5px}
.v2-rail-foot{position:absolute;left:0;right:0;bottom:0;height:110px;pointer-events:none;overflow:hidden}
.v2-rail-foot svg{width:100%;height:100%;display:block}
.v2-rail-gift{position:absolute;left:34px;bottom:10px;line-height:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5))}

/* -------------------------------------------------------------- top bar --- */
.v2-top{display:flex;align-items:center;gap:12px;height:var(--v2-top-h);
  padding:10px calc(var(--v2-gutter) + 6px) 10px var(--v2-gutter);
  background:linear-gradient(180deg, rgba(21,22,68,.92), rgba(13,14,48,.86));
  border-bottom:1px solid rgba(42,61,110,.55)}
.v2-chips{display:flex;gap:clamp(8px,.8vw,13px);flex:1 1 auto;min-width:0}
.v2-topright{display:flex;align-items:center;gap:clamp(8px,.9vw,14px);flex:0 0 auto}
.v2-iconbtn{position:relative;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;
  text-decoration:none;color:#dfe7fb}
.v2-iconbtn:hover{background:rgba(124,92,214,.18)}
.v2-iconbtn.off{color:#8b99bd;cursor:not-allowed}
.v2-iconbtn.off:hover{background:none}
.v2-dot{position:absolute;right:4px;top:3px;width:9px;height:9px;border-radius:50%;
  background:#e8402b;box-shadow:0 0 0 2px #141a3f, 0 0 8px rgba(232,64,43,.9)}
.v2-profile{display:flex;align-items:center;gap:9px;padding:4px 10px 4px 4px;border-radius:999px;
  text-decoration:none;color:var(--v2-text);border:1px solid #33447c;
  background:linear-gradient(180deg,#171d52,#0f1338)}
.v2-profile:hover{border-color:var(--v2-violet-alt)}
.v2-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;
  font-size:13px;font-weight:800;color:#0d1030;letter-spacing:.5px;
  background:radial-gradient(circle at 32% 28%, #ffe9b0, #f5c451 62%, #c08c1b 100%);
  border:2px solid #8d6a1f}
.v2-profile-t b{display:block;font-size:13.5px;font-weight:700;line-height:1.15;max-width:170px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v2-profile-t small{display:block;color:var(--v2-muted);font-size:11px}
.v2-chev{line-height:0;color:#a9b8d6}

/* ---------------------------------------------------------------- media --- */
@media (max-width:1180px){
  .v2-navitem small{display:none}
  .v2-navitem{padding:7px 6px}
  .v2-profile-t b{max-width:110px}
}
/* short viewports: the rail's 14 items must all stay reachable, so the rows
   tighten and the decorative snow drift steps aside. */
@media (max-height:860px){
  .v2-rail-foot{display:none}
  .v2-navitem{padding:4px 7px}
  .v2-navitem .v2-nav-ic svg{width:26px;height:26px}
  .v2-group{margin:8px 0 3px}
  .v2-logo{padding:0 0 4px}
}
@media (max-width:1400px), (max-height:900px){
  .v2-nav{padding-bottom:16px}
}
@media (max-width:900px){
  .v2-rail{min-height:0;padding-bottom:6px}
  .v2-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 8px;padding-bottom:6px}
  .v2-rail-foot{display:none}
  .v2-top{flex-wrap:wrap;height:auto}
  .v2-chips{flex-wrap:wrap}
  .v2-chip{flex:1 1 40%}
}
`
