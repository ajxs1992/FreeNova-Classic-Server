// Shared rendering for the Winterfest panel surface.
//
// Design rules (same contract as src/motd.js and src/ui.js):
//   * server-rendered HTML, every page fully usable with JavaScript disabled;
//   * CSS in an inline <style> block — no external sheet, no webfonts, no
//     images, no iframes. Ornaments are text/CSS shapes;
//   * no flex, no grid, no CSS variables, no transforms, no position:fixed, so
//     the same document renders in the GoldSrc MOTD browser and in Chrome;
//   * JavaScript is a progressive enhancement: the tree drag-and-drop and the
//     "show this deadline in your timezone" line are the only scripts, and both
//     only ship to a browser (never to the compact MOTD skin).
//
// Everything user-controlled goes through esc(). A name from the game can
// contain quotes, brackets or a colour code — it is data, not markup.

import { html, esc, fmt, num, progressBar, emptyState, isMotdCompact } from "../ui.js"
import { TREE_SLOTS } from "./catalog.js"
import { parisStamp } from "./season.js"

export const WINTER_COLORS = {
  red: "#e05a5a",
  green: "#0f2a1d",
  gold: "#e8c547",
  ice: "#9be7ff",
  dim: "#8fa0b0",
  line: "#22303c",
  card: "#151b23"
}

// IE-safe palette + layout. Nothing here needs a modern engine: solid hex,
// tables, absolute positioning inside a relative box. `border-radius` and
// `box-shadow` are additive decoration that old engines simply ignore.
export const WINTER_CSS = `
.wf-head{background:#101b17;border:1px solid #22303c;border-left:4px solid #e05a5a;padding:7px 9px;margin-top:7px;}
.wf-head b{color:#e8c547;}
.wf-kpis{width:100%;border-collapse:separate;border-spacing:4px;margin-top:7px;}
.wf-kpis td{background:#151b23;border:1px solid #22303c;padding:6px 8px;vertical-align:top;width:25%;}
.wf-k{display:block;color:#8fa0b0;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;}
.wf-v{display:block;color:#ffffff;font-size:18px;font-weight:bold;margin-top:2px;}
.wf-v.ice{color:#9be7ff;}.wf-v.gold{color:#e8c547;}.wf-v.red{color:#e05a5a;}.wf-v.green{color:#3dff9e;}
.wf-s{display:block;color:#8fa0b0;font-size:10px;margin-top:2px;}
.wf-note{color:#8fa0b0;font-size:11px;margin:4px 0;}
.wf-tabs a,.wf-tabs span{display:inline-block;border:1px solid #22303c;background:#0d1418;color:#8fa0b0;padding:3px 10px;margin:4px 5px 0 0;font-size:11px;}
.wf-tabs a:hover{border-color:#9be7ff;color:#9be7ff;}
.wf-tabs span.on{background:#10221e;border-color:#9be7ff;color:#9be7ff;font-weight:bold;}
.wf-tree{position:relative;border:1px solid #22303c;background:#0b1410;margin:6px 0;overflow:hidden;}
.wf-tree .ground{position:absolute;left:0;bottom:0;width:100%;height:4px;background:#0f2a1d;}
.wf-glow{position:absolute;left:50%;top:0;font-size:1px;color:#123;background:#14321f;}
.wf-slot{position:absolute;width:0;height:0;}
.wf-in{position:absolute;left:-16px;top:-16px;width:32px;height:32px;border:2px solid #2a3a36;background:#0d1a15;
  color:#8fa0b0;font:bold 14px Tahoma,Verdana,Arial,sans-serif;line-height:28px;text-align:center;overflow:hidden;
  border-radius:50%;cursor:default;}
.wf-in.empty{border:1px dashed #2a3a36;background:#0a1310;color:#35473f;font-weight:normal;}
.wf-in.filled{cursor:move;}
.wf-in.drag{opacity:.4;}
.wf-in.over{border-color:#e8c547;}
.wf-slot .lbl{display:block;position:absolute;left:-22px;top:18px;width:44px;text-align:center;font-size:9px;color:#4b5f57;}
a.wf-in{text-decoration:none;}
.wf-legend span{display:inline-block;margin-right:10px;font-size:10px;color:#8fa0b0;}
.wf-dot{display:inline-block;width:9px;height:9px;border:1px solid #22303c;margin-right:4px;}
.wf-orn{display:inline-block;width:30px;height:30px;border:2px solid #2a3a36;border-radius:50%;background:#0d1a15;
  text-align:center;line-height:26px;font:bold 13px Tahoma,Verdana,Arial,sans-serif;color:#8fa0b0;}
.wf-orn.locked{border-style:dashed;color:#35473f;}
.wf-set{margin-top:8px;}
.wf-set h4{margin:0 0 3px;font-size:12px;color:#ffffff;}
.wf-row{width:100%;border-collapse:collapse;}
.wf-row td{border-bottom:1px solid #1b2530;padding:4px 5px;vertical-align:middle;font-size:12px;}
.wf-cal{width:100%;border-collapse:separate;border-spacing:4px;}
.wf-cal td{width:14%;height:54px;vertical-align:top;padding:4px;border:1px solid #22303c;background:#101820;font-size:10px;}
.wf-cal td.today{border:2px solid #e8c547;background:#1d1a0f;}
.wf-cal td.claimed{border-color:#3dff9e;background:#0d231b;}
.wf-cal td.missed{border-color:#7a3b3b;background:#1b1010;}
.wf-cal td.locked{opacity:.55;}
.wf-cal .d{font-size:14px;font-weight:bold;color:#ffffff;}
.wf-cal td.today .d{color:#e8c547;}.wf-cal td.claimed .d{color:#3dff9e;}.wf-cal td.missed .d{color:#e05a5a;}
.wf-cal .r{color:#8fa0b0;}
.wf-tier{width:100%;border-collapse:collapse;margin-top:4px;}
.wf-tier td{padding:3px 5px;border-bottom:1px solid #1b2530;font-size:11px;}
.wf-tier td.t{width:54px;color:#8fa0b0;font-weight:bold;}
.wf-tier tr.now td{background:#1d1a0f;}
.wf-tier tr.done td.t{color:#3dff9e;}
.wf-tier tr.locked td{color:#5c6f77;}
.wf-form{margin-top:6px;padding:7px 8px;background:#101b17;border:1px solid #22303c;}
.wf-form select,.wf-form input{background:#0b1410;color:#e8edf2;border:1px solid #22303c;padding:2px 4px;font-family:inherit;font-size:12px;}
.wf-form .btn{background:#e8c547;color:#141208;border:0;padding:3px 12px;font-weight:bold;}
.wf-msg{margin-top:6px;font-size:11px;}
.wf-msg.ok{color:#3dff9e;}.wf-msg.err{color:#e05a5a;}.wf-msg.wait{color:#e8c547;}
.wf-time{color:#9be7ff;}
.wf-snowline{color:#5c7f74;font-size:10px;letter-spacing:3px;}
`

// ------------------------------------------------------------------ chrome --
const SECTIONS = [
  ["", "Hub", "/winter"],
  ["tree", "Tree", "/winter/tree"],
  ["gifts", "Gifts", "/winter/gifts"],
  ["ornaments", "Ornaments", "/winter/ornaments"],
  ["advent", "Advent", "/winter/advent"],
  ["pass", "Winter Pass", "/winter/pass"]
]

export function winterHref(url, path, extra) {
  const q = new URLSearchParams()
  const sid = url && url.searchParams ? url.searchParams.get("steamid") : ""
  if (sid) q.set("steamid", sid)
  if (isMotdCompact() || (url && url.searchParams && url.searchParams.get("compact") === "1")) q.set("compact", "1")
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === "") q.delete(k)
      else q.set(k, String(v))
    }
  }
  const s = q.toString()
  return path + (s ? "?" + s : "")
}

export function navTabs(url, active) {
  const items = SECTIONS.map(([key, label, path]) => {
    const isOn = key === (active || "")
    return isOn ? `<span class="on">${esc(label)}</span>` : `<a href="${esc(winterHref(url, path))}">${esc(label)}</a>`
  })
  return `<div class="wf-tabs">${items.join("")}</div>`
}

/** The one-line season status every winter page carries. */
export function seasonLine(season, nowSec) {
  if (!season) return ""
  if (season.phase === "open")
    return `<b>${esc(season.name)} ${esc(String(season.year))}</b> is open — <b>${season.daysLeft}</b> day${season.daysLeft === 1 ? "" : "s"} left, closes ${winterTime(season.closesAt, season.tz)}.`
  if (season.phase === "before")
    return `<b>${esc(season.name)} ${esc(String(season.year))}</b> opens ${winterTime(season.opensAt, season.tz)} — the pages below are a preview.`
  if (season.phase === "disabled")
    return `<b>${esc(season.name)}</b> is switched off for this deployment — nothing below is awarding anything.`
  return `<b>${esc(season.name)} ${esc(String(season.year))}</b> closed ${winterTime(season.closesAt, season.tz)} — your collection is still here.`
}

/**
 * A deadline as a <time> element. Server-side it prints Europe/Paris (the
 * contract's timezone, always true); a browser re-renders it in the player's
 * own timezone when it can.
 */
export function winterTime(sec, tz) {
  const n = Number(sec) || 0
  if (!n) return `<span class="wf-note">not scheduled</span>`
  const iso = new Date(n * 1000).toISOString()
  return `<time class="wf-time" datetime="${esc(iso)}" title="${esc(parisStamp(n) + " " + (tz || "Europe/Paris"))}">${esc(parisStamp(n))} ${esc(tz || "Europe/Paris")}</time>`
}

/** Browser-only: rewrite every <time class="wf-time"> in local time. */
export const LOCAL_TIME_SCRIPT = `<script>
(function(){
  try{
    var els=document.getElementsByTagName('time'),i,d,o;
    for(i=0;i<els.length;i++){
      if((' '+els[i].className+' ').indexOf(' wf-time ')<0)continue;
      d=new Date(els[i].getAttribute('datetime'));
      if(isNaN(d.getTime()))continue;
      try{o=d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}catch(e){o=d.toLocaleString();}
      els[i].innerHTML=String(o).replace(/</g,'&lt;');
      els[i].setAttribute('title','Your local time (the season closes at '+els[i].getAttribute('title')+')');
    }
  }catch(e){}
})();
</script>`

/** A board card. */
export function statCard(label, value, sub, tone) {
  return `<td><span class="wf-k">${esc(label)}</span><span class="wf-v ${tone || ""}">${value}</span>${sub ? `<span class="wf-s">${sub}</span>` : ""}</td>`
}

export function kpiRow(cells) {
  return `<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>${cells.join("")}</tr></table>`
}

/** Progress bar using ui.js's bar markup (a div width, IE-safe). */
export function bar(pct, color) {
  const p = Math.max(0, Math.min(100, num(pct)))
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#0a2b26" height="9">
    <table width="${p}%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${color || "#3dff9e"}" height="9"></td></tr></table>
  </td></tr></table>`
}

/**
 * The ornament glyph. No images and no webfonts, so an ornament is a CSS box
 * with a character in it. The character is picked from the id so two ornaments
 * never look identical, and the colour always comes from the rarity.
 */
const GLYPHS = ["*", "o", "+", "#", "@", "%", "x", "=", "~", "^"]
export function glyphFor(id) {
  return GLYPHS[Math.abs(num(id)) % GLYPHS.length]
}

/**
 * The 24-slot tree. One renderer for the owner's page, the public page and the
 * three style previews (the mission's "same renderer" rule).
 *
 * opts: { readOnly, style, hrefForSlot(slot) }
 * Each slot is an absolutely positioned anchor inside a relative box, so the
 * three layouts differ only in their x/y data. Nothing is positioned with
 * flex/grid/transform, which keeps the GoldSrc MOTD browser happy.
 */
export function slotGrid(cat, slots, style, opts) {
  const o = opts || {}
  const box = style.box || { w: 100, h: 340 }
  const slotsById = new Map()
  for (const s of style.slots || []) slotsById.set(s.slot, s)
  const out = []
  for (let slot = 1; slot <= TREE_SLOTS; slot++) {
    const pos = slotsById.get(slot) || { x: 50, y: 50 }
    const ornId = slots.get ? slots.get(slot) : 0
    const orn = ornId ? cat.ornamentById.get(ornId) : null
    const rar = orn ? cat.rarities[orn.rarity] : null
    const colour = rar ? rar.color : "#8fa0b0"
    const title = orn
      ? `${orn.name} — slot ${slot}${rar ? " (" + rar.name + ")" : ""}`
      : `Empty slot ${slot}`
    const inner = orn
      ? `<div class="wf-in filled" title="${esc(title)}" style="border-color:${esc(colour)};color:${esc(colour)}"${
          o.readOnly ? "" : ` draggable="true" data-slot="${slot}" data-orn="${ornId}"`}>${esc(glyphFor(ornId))}</div>`
      : `<div class="wf-in empty" title="${esc(title)}"${
          o.readOnly ? "" : ` data-slot="${slot}"`}>&middot;</div>`
    out.push(`<div class="wf-slot" style="left:${num(pos.x)}%;top:${num(pos.y)}%">${inner}<span class="lbl">${slot}</span></div>`)
  }
  return `<div class="wf-tree" id="wf-tree" style="height:${Math.max(180, num(box.h))}px">
    <div class="ground"></div>
    ${out.join("\n")}
  </div>`
}

/**
 * An ornament swatch for the collection book. Locked entries show the
 * silhouette ("? ? ?") and, if the catalogue marks them secret, no name at all.
 */
export function ornSwatch(cat, orn, owned) {
  const rar = cat.rarities[orn.rarity]
  const colour = rar ? rar.color : "#8fa0b0"
  if (owned) {
    return `<span class="wf-orn" style="border-color:${esc(colour)};color:${esc(colour)}" title="${esc(orn.name + (rar ? " (" + rar.name + ")" : ""))}">${esc(glyphFor(orn.id))}</span>`
  }
  const label = orn.secret ? "? ? ?" : orn.name
  const title = orn.secret ? "Not found yet" : orn.name + " — not found yet"
  return `<span class="wf-orn locked" title="${esc(title)}">?</span><span class="wf-s">${esc(label)}</span>`
}

/** The winter page shell. `body` is already-rendered HTML. */
export function winterPage(title, body, opts) {
  const o = opts || {}
  const script = !isMotdCompact() ? LOCAL_TIME_SCRIPT : ""
  const sid = o.url && o.url.searchParams ? o.url.searchParams.get("steamid") : ""
  const noPlayer = !sid
    ? `<div class="wf-head"><b>No player selected.</b> Open this page from the game (the N menu or <code>/christmas</code>) or add <code>?steamid=STEAM_0:0:12345</code> to the URL. Everything below is the zero state, not somebody else's.</div>`
    : ""
  const content = `<style>${WINTER_CSS}</style>
<div class="wf-snowline">* &middot; . * &middot; . * &middot; . * &middot; . * &middot; . *</div>
<div class="wf-note"><a href="/hub">&lsaquo; Panels</a></div>
${o.nav || ""}
${o.season ? `<div class="wf-head">${seasonLine(o.season)}</div>` : ""}
${noPlayer}
${body}
${script}`
  return html(title, content, o.htmlOpts || {})
}

export { html, esc, fmt, num, progressBar, emptyState }
