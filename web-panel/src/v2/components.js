// The v2 component set — the vocabulary every rebuilt page composes.
//
// Each function returns a string of HTML and nothing else: no state, no I/O, no
// page-specific knowledge. That is what lets the next page (profile, then the
// boards family) be a new content region rather than a new shell.
//
// The one rule they all follow: an empty value renders an honest empty state
// (a dash, a zero, or a sentence saying what is missing), never a plausible
// looking number. See `emptyState()`.

import { esc, fmt, pct } from "./theme.js"
import { icon } from "./icons.js"

/** Card shell. `head` is optional: the reference's three cards have one. */
export function card({ head, body, foot, class: cls = "", tone = "", label = "" }) {
  const id = label ? ` aria-labelledby="${esc(label)}"` : ""
  return `<section class="v2-card${tone ? " " + tone : ""}${cls ? " " + cls : ""}"${id}>
  ${head ? cardHead(head) : ""}
  ${body || ""}
  ${foot ? `<div class="v2-cfoot">${foot}</div>` : ""}
</section>`
}

/** Icon + title + one-line subtitle, the header every reference card has. */
export function cardHead({ icon: ic, title, sub, id = "" }) {
  return `<header class="v2-chead">
    ${ic ? `<span class="v2-ic" aria-hidden="true">${ic}</span>` : ""}
    <div class="v2-chead-t"><h2${id ? ` id="${esc(id)}"` : ""}>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
  </header>`
}

/** A top-bar currency chip: art, value, label, and an "add" affordance. */
export function currencyChip({ icon: ic, value, label, tone = "", href = "", addHref = "", addTitle = "Where this comes from" }) {
  const add = addHref
    ? `<a class="v2-plus" href="${esc(addHref)}" title="${esc(addTitle)}" aria-label="${esc(addTitle)}">${icon("plus", 14)}</a>`
    : `<span class="v2-plus off" title="${esc(addTitle)}" aria-hidden="true">${icon("plus", 14)}</span>`
  return `<div class="v2-chip${tone ? " " + tone : ""}">
    <span class="v2-chip-ic" aria-hidden="true">${ic}</span>
    <span class="v2-chip-t"><b>${esc(value)}</b><small>${esc(label)}</small></span>
    ${add}
  </div>`
}

/** Stat card row item (the five-card strip under the hero). */
export function statCard({ icon: ic, title, value, tone = "", href = "" }) {
  const inner = `<span class="v2-ic" aria-hidden="true">${ic}</span>
    <span class="v2-stat-t"><b>${esc(title)}</b><em>${esc(value)}</em></span>`
  const cls = `v2-stat${tone ? " " + tone : ""}`
  return href ? `<a class="${cls}" href="${esc(href)}">${inner}</a>` : `<div class="${cls}">${inner}</div>`
}

/** Progress bar. `value`/`target` preferred; a raw `pct` is accepted too. */
export function bar(value, target, tone = "") {
  const p = arguments.length === 1 && typeof value === "number" ? value : pct(value, target)
  const width = Math.max(0, Math.min(100, Number(p) || 0))
  return `<div class="v2-bar${tone ? " " + tone : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}"><i style="width:${width}%"></i></div>`
}

/** State pill: Active Now / Ends in 2d 14h / Starts in 14h / Active. */
export function pill({ tone = "dim", label, icon: ic }) {
  return `<span class="v2-pill ${tone}">${ic ? `<span aria-hidden="true">${ic}</span>` : ""}${esc(label)}</span>`
}

/** The hero countdown box: template-rendered parts, ticked by optional JS. */
export function countdown({ label, parts, id = "v2-count" }) {
  return `<div class="v2-count" id="${esc(id)}">
    <h4>${esc(label)}</h4>
    <div class="v2-cells">${parts.map(p => `<div class="v2-cell"><b data-cd="${esc(p.key || "")}">${esc(p.value)}</b><span>${esc(p.label)}</span></div>`).join("")}</div>
  </div>`
}

/** The ❄ PLAYER ❄ group label used between sidebar groups. */
export function groupLabel(text) {
  return `<div class="v2-group" role="presentation"><span aria-hidden="true">&#10052;</span>${esc(text)}<span aria-hidden="true">&#10052;</span></div>`
}

/** A section heading outside a card ("Active Winterfest Events"). */
export function sectionHeading({ icon: ic, text, id = "" }) {
  return `<h2 class="v2-sechead"${id ? ` id="${esc(id)}"` : ""}>${ic ? `<span class="v2-ic" aria-hidden="true">${ic}</span>` : ""}${esc(text)}</h2>`
}

/**
 * The honest empty state. `text` says what is missing in the player's terms;
 * `hint` (optional) says where it will come from. Never a fake value.
 */
export function emptyState(text, hint) {
  return `<p class="v2-empty"><span class="v2-empty-mark" aria-hidden="true">&#10052;</span><span><b>${esc(text)}</b>${hint ? ` <span class="v2-empty-hint">${esc(hint)}</span>` : ""}</span></p>`
}

/** A reward tile: cropped art on top, two lines of real label under it. */
export function itemTile({ art, title, sub, tone = "" }) {
  return `<figure class="v2-tile${tone ? " " + tone : ""}">
    ${art ? `<img class="v2-tile-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">` : `<span class="v2-tile-art blank" aria-hidden="true">${icon("snowflake", 40)}</span>`}
    <figcaption><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</figcaption>
  </figure>`
}

/** A four-counter row (the ornament tallies under the tree progress bar). */
export function counterTile({ icon: ic, value, label }) {
  return `<div class="v2-count-tile" title="${esc(label)}">
    <span aria-hidden="true">${ic}</span><b>${esc(fmt(value))}</b><span class="v2-sr">${esc(label)}</span>
  </div>`
}

/** Primary button (the green `Decorate Tree` affordance). */
export function button({ href, label, icon: ic, tone = "green", title = "" }) {
  const inner = `<span>${esc(label)}</span>${ic ? `<span aria-hidden="true">${ic}</span>` : ""}`
  return href
    ? `<a class="v2-btn ${tone}" href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`
    : `<span class="v2-btn ${tone} off" aria-disabled="true"${title ? ` title="${esc(title)}"` : ""}>${inner}</span>`
}

/** A plain data table — the boards family will lean on this one. */
export function dataTable({ columns, rows, empty, caption }) {
  const head = `<tr>${columns.map(c => `<th${c.num ? ' class="num"' : ""} scope="col">${esc(c.label)}</th>`).join("")}</tr>`
  const body = rows && rows.length
    ? rows.map(r => `<tr>${columns.map((c, i) => {
      const v = Array.isArray(r) ? r[i] : r[c.key]
      return `<td${c.num ? ' class="num"' : ""}>${v == null || v === "" ? "&mdash;" : (c.html ? String(v) : esc(v))}</td>`
    }).join("")}</tr>`).join("")
    : `<tr><td class="v2-td-empty" colspan="${columns.length}">${esc(empty || "No rows yet.")}</td></tr>`
  return `<div class="v2-tablewrap"><table class="v2-table">${caption ? `<caption>${esc(caption)}</caption>` : ""}<thead>${head}</thead><tbody>${body}</tbody></table></div>`
}

/** Icon + label + value list row (the Event Progress bars are a variant). */
export function listRow({ icon: ic, title, sub, value, href }) {
  const inner = `${ic ? `<span class="v2-ic" aria-hidden="true">${ic}</span>` : ""}
    <span class="v2-row-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    ${value != null ? `<span class="v2-row-v">${esc(value)}</span>` : ""}`
  return href
    ? `<a class="v2-row" href="${esc(href)}">${inner}</a>`
    : `<div class="v2-row">${inner}</div>`
}

/** One labelled progress row: icon, label, `now / target`, bar underneath. */
export function progressRow({ icon: ic, label, current, target, empty }) {
  const known = Number(target) > 0
  const val = known ? `${fmt(current)} / ${fmt(target)}` : "&mdash;"
  return `<div class="v2-prow">
    <div class="v2-prow-top">
      ${ic ? `<span class="v2-ic" aria-hidden="true">${ic}</span>` : ""}
      <b>${esc(label)}</b>
      <span class="v2-prow-v">${val}</span>
    </div>
    ${known ? bar(current, target) : `<div class="v2-bar chance" role="img" aria-label="${esc(empty || "no season data yet")}"><i style="width:0"></i></div>`}
  </div>`
}

/** The bottom-of-page note that says which data adapters are live. */
export function devNote(rows, title = "Data wiring") {
  return `<details class="v2-dev">
    <summary>${esc(title)} &middot; ${rows.filter(r => r.wired).length}/${rows.length} adapters live</summary>
    <ul>${rows.map(r => `<li class="${r.wired ? "on" : "off"}"><b>${esc(r.name)}</b> <code>${esc(r.source)}</code> <span>${esc(r.wired ? "live" : (r.note || "empty state only"))}</span></li>`).join("")}</ul>
  </details>`
}

export const COMPONENT_CSS = `
/* ---------------------------------------------------------------- card ---- */
.v2-card{position:relative;border-radius:var(--v2-r-card);
  background:radial-gradient(130% 70% at 50% 0%, #16224a 0%, #101838 42%, #0b112c 100%);
  border:1px solid var(--v2-border);
  box-shadow:0 14px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(120,150,220,.18);
  padding:12px;min-width:0}
/* the snow cap the reference paints along every card's top edge */
.v2-card::before{content:"";position:absolute;left:-1px;right:-1px;top:-1px;height:12px;
  border-radius:var(--v2-r-card) var(--v2-r-card) 0 0;pointer-events:none;
  background:radial-gradient(70% 120% at 50% 0%, rgba(240,247,255,.72) 0%, rgba(210,228,255,.34) 42%, rgba(210,228,255,0) 78%)}
/* fairy lights */
.v2-card::after{content:"";position:absolute;left:12px;right:12px;top:5px;height:9px;pointer-events:none;
  background-image:radial-gradient(circle 2px at 50% 50%, #ffd27a 0 45%, rgba(255,210,122,0) 72%);
  background-size:26px 10px;background-repeat:repeat-x;opacity:1}
.v2-card.green-tint{background:radial-gradient(130% 70% at 50% 0%, #17402c 0%, #10301f 45%, #0a2118 100%);border-color:#2f7d55}
.v2-cfoot{margin-top:10px}
.v2-chead{display:flex;gap:9px;align-items:flex-start;margin:0 0 8px}
.v2-chead-t h2{font-size:18px;font-weight:800;letter-spacing:.1px;line-height:1.1}
.v2-chead-t p{color:var(--v2-muted);font-size:11.5px;margin-top:1px;line-height:1.25}
.v2-ic{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0}

/* ---------------------------------------------------------------- chips --- */
.v2-chip{display:flex;align-items:center;gap:10px;flex:1 1 0;min-width:0;
  padding:8px 12px;border-radius:var(--v2-r-chip);
  background:linear-gradient(180deg,#171d52 0%, #101438 55%, #0e1233 100%);
  border:1px solid #33447c;
  box-shadow:inset 0 1px 0 rgba(130,160,230,.25), 0 8px 18px rgba(0,0,0,.30)}
.v2-chip-ic{line-height:0;flex:0 0 auto}
.v2-chip-t{min-width:0}
.v2-chip-t b{display:block;font-size:clamp(15px,1.25vw,20px);font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums}
.v2-chip-t small{display:block;color:var(--v2-muted);font-size:12.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v2-plus{margin-left:auto;flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;
  text-decoration:none;color:#06301a;background:linear-gradient(180deg,#63dc8c,#1f9f4e);
  border:1px solid #8fe9ac;box-shadow:0 2px 0 #0d5c2c, 0 4px 10px rgba(31,159,78,.35)}
.v2-plus:hover{filter:brightness(1.08);color:#06301a}
.v2-plus.off{background:linear-gradient(180deg,#2b3763,#1b2447);border-color:#33447c;color:#7f8fb5;box-shadow:none}

/* ---------------------------------------------------------------- stat ---- */
.v2-stat{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--v2-r-card);
  background:linear-gradient(180deg,#161c50 0%, #10143a 60%, #0d1133 100%);
  border:1px solid #35477f;text-decoration:none;color:var(--v2-text);min-width:0;
  box-shadow:inset 0 1px 0 rgba(130,160,230,.22), 0 8px 18px rgba(0,0,0,.28)}
a.v2-stat:hover{border-color:var(--v2-violet-alt);box-shadow:inset 0 1px 0 rgba(160,140,240,.3), 0 0 0 1px rgba(124,92,214,.35), 0 8px 18px rgba(0,0,0,.3)}
.v2-stat .v2-stat-t{min-width:0}
.v2-stat b{display:block;font-size:15.5px;font-weight:700;line-height:1.15}
.v2-stat em{font-style:normal;font-weight:800;font-size:15.5px;color:var(--v2-gold);line-height:1.2}
.v2-stat.green{background:linear-gradient(180deg,#1a4a34 0%, #123423 55%, #0d2a1c 100%);border-color:#3fbf6f;
  box-shadow:inset 0 1px 0 rgba(120,240,170,.25), 0 0 20px rgba(63,191,111,.18), 0 8px 18px rgba(0,0,0,.28)}
.v2-stat.green em{color:var(--v2-green-alt)}
.v2-stat.violet{background:linear-gradient(180deg,#2a1c62,#1a1240);border-color:#7c5cd6}

/* ---------------------------------------------------------------- bars ---- */
.v2-bar{height:9px;border-radius:999px;overflow:hidden;background:#0b1235;
  border:1px solid #24315c;box-shadow:inset 0 1px 3px rgba(0,0,0,.55)}
.v2-bar i{display:block;height:100%;border-radius:999px;
  background:linear-gradient(90deg,#2fa55f,#5ce08a);box-shadow:0 0 10px rgba(92,224,138,.5)}
.v2-bar.gold i{background:linear-gradient(90deg,#c99a12,#f5c451);box-shadow:0 0 10px rgba(245,196,81,.45)}
.v2-bar.chance{border-style:dashed}
.v2-bar.chance i{width:0;background:#1b2447}

/* ---------------------------------------------------------------- pills --- */
.v2-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;
  font-size:12px;font-weight:800;letter-spacing:.2px;line-height:1.5;white-space:nowrap}
.v2-pill.green{background:linear-gradient(180deg,#2fa55f,#177a42);border:1px solid #7ce3a6;color:#f2fff7;box-shadow:0 0 14px rgba(92,224,138,.35)}
.v2-pill.gold{background:linear-gradient(180deg,#f9d05c,#d99a12);border:1px solid #ffe79b;color:#2c1d00;box-shadow:0 0 14px rgba(245,196,81,.28)}
.v2-pill.dim{background:#121738;border:1px solid var(--v2-border);color:var(--v2-muted)}

/* ------------------------------------------------------------ countdown --- */
.v2-count{border-radius:14px;border:1px solid #6b5a2a;padding:6px 12px 8px;
  background:linear-gradient(180deg,rgba(22,26,74,.90),rgba(9,11,40,.94));
  box-shadow:inset 0 0 0 1px rgba(245,196,81,.18), 0 12px 26px rgba(0,0,0,.42)}
.v2-count h4{text-align:center;font-size:13px;font-weight:700;color:#e8eeff;margin-bottom:2px}
.v2-cells{display:grid;grid-template-columns:repeat(4,1fr)}
.v2-cell{text-align:center;padding:2px 10px;border-left:1px solid rgba(120,140,200,.20)}
.v2-cell:first-child{border-left:0}
.v2-cell b{display:block;font-size:clamp(19px,2.1vw,30px);font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.v2-cell span{display:block;font-size:11px;color:#a9b8d6}

/* --------------------------------------------------------------- tiles ---- */
.v2-tile{margin:0;border-radius:10px;overflow:hidden;border:2px solid #6b5a2a;background:#0d1236;
  display:flex;flex-direction:column;min-width:0;
  box-shadow:0 6px 14px rgba(0,0,0,.35)}
.v2-tile-art{width:100%;height:auto;aspect-ratio:88/80;object-fit:cover;background:#0a0e2c}
.v2-tile-art.blank{display:grid;place-items:center;color:#2a3d6e}
.v2-tile figcaption{padding:6px 6px 8px;text-align:center}
.v2-tile figcaption b{display:block;font-size:12px;font-weight:700;line-height:1.2}
.v2-tile figcaption small{display:block;color:var(--v2-muted);font-size:10.5px;margin-top:1px}
.v2-tile.orange{border-color:#e08a2b}.v2-tile.pink{border-color:#e0489a}
.v2-tile.ice{border-color:#4aa0e0}.v2-tile.gold{border-color:#f5c451}
.v2-tile.violet{border-color:#7c5cd6}

.v2-count-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  padding:4px 3px;border-radius:10px;background:linear-gradient(180deg,#1a2050,#0e1236);
  border:1px solid #33447c;box-shadow:inset 0 1px 0 rgba(130,160,230,.2)}
.v2-count-tile b{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}

/* ------------------------------------------------------------ buttons ---- */
.v2-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:9px 20px;border-radius:999px;font-weight:800;font-size:14px;text-decoration:none;
  background:linear-gradient(180deg,#41c877,#1c8e4b);border:1px solid #7ce3a6;color:#f4fff8;
  box-shadow:0 6px 16px rgba(31,159,78,.35), inset 0 1px 0 rgba(255,255,255,.25)}
.v2-btn:hover{filter:brightness(1.07);color:#fff}
.v2-btn.gold{background:linear-gradient(180deg,#f9d05c,#d99a12);border-color:#ffe79b;color:#2c1d00}
.v2-btn.off{background:linear-gradient(180deg,#2b3763,#1b2447);border-color:#33447c;color:#8d9cbd;box-shadow:none;cursor:not-allowed}

/* ----------------------------------------------------- rows and tables ---- */
.v2-row{display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid rgba(42,61,110,.55);text-decoration:none;color:var(--v2-text)}
.v2-row:last-child{border-bottom:0}
.v2-row-t{min-width:0;flex:1}
.v2-row-t b{display:block;font-size:13.5px}
.v2-row-t small{color:var(--v2-muted);font-size:11px}
.v2-row-v{font-weight:800;color:var(--v2-gold);font-variant-numeric:tabular-nums}
.v2-tablewrap{overflow-x:auto}
.v2-table{width:100%;border-collapse:collapse;font-size:13px}
.v2-table caption{text-align:left;color:var(--v2-muted);font-size:11.5px;padding-bottom:6px}
.v2-table th,.v2-table td{padding:7px 8px;border-bottom:1px solid rgba(42,61,110,.6);text-align:left}
.v2-table th{color:var(--v2-faint);font-size:11px;letter-spacing:1.2px;text-transform:uppercase}
.v2-table .num{text-align:right;font-variant-numeric:tabular-nums}
.v2-td-empty{color:var(--v2-muted);text-align:center}

/* ------------------------------------------------------------- progress --- */
.v2-prow{padding:2px 0 5px}
.v2-prow-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;min-height:22px}
.v2-prow-top b{font-size:13px;font-weight:700;flex:1;min-width:0}
.v2-prow-v{font-size:12.5px;font-weight:800;color:var(--v2-text);font-variant-numeric:tabular-nums}

/* ---------------------------------------------------------------- misc ---- */
.v2-sechead{display:flex;align-items:center;gap:9px;font-size:20px;font-weight:800;margin:2px 0 2px}
.v2-group{display:flex;align-items:center;justify-content:center;gap:9px;margin:13px 0 5px;
  color:#8b9ac0;font-size:9px;font-weight:800;letter-spacing:2.4px;text-transform:uppercase}
.v2-empty{display:flex;gap:8px;align-items:flex-start;margin:4px 0;padding:6px 9px;border-radius:10px;
  border:1px dashed #33447c;background:rgba(13,18,50,.6);color:var(--v2-muted);font-size:11.5px;line-height:1.3}
.v2-empty b{color:var(--v2-text);font-weight:700}
.v2-empty-mark{color:var(--v2-ice);line-height:1.2}
.v2-empty-hint{color:var(--v2-faint)}
.v2-dev{margin-top:4px;border:1px solid var(--v2-border-soft);border-radius:12px;padding:8px 12px;
  background:rgba(8,11,34,.6);color:var(--v2-muted);font-size:12px}
.v2-dev summary{cursor:pointer;color:var(--v2-faint);font-size:11.5px;letter-spacing:.6px;text-transform:uppercase}
.v2-dev ul{margin:8px 0 0;padding-left:18px;display:grid;gap:3px}
.v2-dev code{color:var(--v2-ice-alt);font-size:11.5px}
.v2-dev li.on b{color:var(--v2-green-alt)}
.v2-dev li.off b{color:var(--v2-muted)}
.v2-dev li span{color:var(--v2-faint)}
`
