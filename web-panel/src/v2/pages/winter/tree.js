// /v2/winter/tree — the 24-slot Christmas tree, rebuilt on the dashboard's card
// language.
//
// The data is the old page's, read once through ../../data/winter.js: treeStatus()
// over the winter_tree mirror, treeStyle() for the layout name and the
// catalogue's ornament rows for what sits in each slot. The panel never moves an
// ornament and never changes the style — the game owns the tree — so this page
// shows it and says where it changes, instead of offering a write it cannot
// make. Nothing here is invented: a slot the mirror does not have is empty, a
// rarity the catalogue does not name is reported by its own index, and a level
// the game has not pushed is stated as the game's own formula.
import { esc, fmt, pct } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon, BIG } from "../../art.js"
import { card, bar, emptyState, button } from "../../components.js"
import { treeStatus } from "../../../winter/progress.js"
import { TREE_SLOTS, ornament, ornamentName, rarity, rarityName, treeStyle } from "../../../winter/catalog.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const TREE_CSS = `
/* -------------------------------------------------------------- 24 slots --- */
.v2wt-slot{min-height:92px}
.v2wt-slot .dt{font-size:10px}
.v2wt-slot .r{display:flex;align-items:center;gap:5px;font-size:11.5px;line-height:1.18}
.v2wt-slot.filled{border-color:#6b5a2a;background:linear-gradient(180deg,#231a3f 0%, #150f2e 100%)}
.v2wt-slot.filled .n{color:#ffe08a}

/* ------------------------------------------------------- level and style --- */
.v2wt-side{display:grid;gap:8px;justify-items:stretch}
.v2wt-art{width:100%;height:auto;max-width:176px;margin-inline:auto;border-radius:12px;object-fit:contain;
  filter:drop-shadow(0 10px 18px rgba(0,0,0,.5))}
.v2wt-side-t{display:grid;gap:6px;min-width:0}
.v2wt-side-t .v2-btn{justify-self:start;font-size:12.5px;padding:7px 14px}
.v2wt-styles{display:flex;flex-wrap:wrap;gap:6px}
.v2wt-style{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;
  border:1px solid var(--v2-border);color:var(--v2-muted);background:rgba(18,26,58,.72)}
.v2wt-style.on{color:#3a2408;background:linear-gradient(180deg,#ffd77a,#e8a92c);border-color:#ffe6a8;
  box-shadow:0 6px 14px rgba(180,130,10,.3)}

/* ------------------------------------------------------------ rarity rows --- */
.v2wt-rar{margin:0;padding:0;list-style:none;display:grid;gap:7px;font-size:12.5px}
.v2wt-rar li{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:8px;align-items:center}
.v2wt-rar i{width:10px;height:10px;border-radius:3px;display:block;border:1px solid rgba(255,255,255,.4)}
.v2wt-rar b{font-weight:700;color:#cfdaf5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v2wt-rar span{font-weight:800;color:var(--v2-gold);font-variant-numeric:tabular-nums}

@media (max-width:820px){
  .v2wt-art{max-width:150px}
}
`

/**
 * A rarity as the catalogue describes it. `cat.rarities` only holds the rows the
 * game pushed, so an unnamed tier is reported by its own index ("Rarity 2")
 * rather than borrowing another tier's name. The colour is the catalogue's,
 * neutral when it published nothing.
 */
function rarityOf(cat, id) {
  const n = Math.max(0, Math.trunc(Number(id) || 0))
  const published = cat && cat.rarities ? cat.rarities[n] : null
  return {
    n,
    name: published ? rarityName(cat, n) : `Rarity ${n}`,
    color: rarity(cat, n).color
  }
}

/**
 * The page's view model. Every slot 1..24 exists whether or not the mirror has a
 * row for it, so the grid is always the same shape and an empty slot stays an
 * empty slot rather than a missing tile.
 */
export function treeView(ctx) {
  const { cat, state } = ctx
  const tree = treeStatus(cat, state)
  const style = treeStyle(cat, state.treeStyle)

  const slots = []
  for (let slot = 1; slot <= TREE_SLOTS; slot++) {
    const id = state.slots && state.slots.get
      ? Math.max(0, Math.trunc(Number(state.slots.get(slot)) || 0))
      : 0
    const o = id ? ornament(cat, id) : null
    slots.push({
      slot,
      id,
      filled: id > 0,
      name: id ? (o ? o.name : ornamentName(cat, id)) : "",
      rarity: o ? rarityOf(cat, o.rarity) : null
    })
  }

  const filled = slots.filter(s => s.filled).length
  const total = TREE_SLOTS

  // The game's own rule (docs/WINTERFEST-DEV.md: "tree level = 1 + completed
  // sets", stored per player; an unloaded player's native read returns 0). A
  // tree with no level pushed is therefore stated as that formula, not as a
  // number this page made up.
  const pushed = Math.max(0, Math.trunc(Number(state.treeLevel) || 0))
  const level = pushed > 0 ? pushed : 1 + tree.completeSets

  // What is hanging on the tree, by rarity — the dashboard's counters, counted
  // from the 24 slots rather than from the whole collection.
  const counted = new Map()
  for (const s of slots) {
    if (!s.filled || !s.rarity) continue
    const row = counted.get(s.rarity.n) || { ...s.rarity, count: 0 }
    row.count++
    counted.set(s.rarity.n, row)
  }
  const onTree = [...counted.values()].sort((a, b) => a.n - b.n)

  return {
    slots,
    filled,
    total,
    pctFilled: pct(filled, total),
    level,
    levelPushed: pushed > 0,
    nextSet: tree.nextSet,
    completeSets: tree.completeSets,
    setCount: tree.sets.length,
    onTree,
    style: { n: Math.max(1, Math.min(3, Number(style.style) || 1)), name: style.name || "Classic" },
    styles: [1, 2, 3].map(n => ({ n, name: treeStyle(cat, n).name })),
    found: !!(state && state.found),
    catalogue: !!cat.ok
  }
}

/** One slot tile: its number, then the ornament's rarity and name, or "empty". */
function slotTile(s) {
  if (!s.filled) {
    return `<div class="v2w-day v2wt-slot">
    <span class="n">${s.slot}</span>
    <span class="dt">Empty</span>
    <span class="r">&mdash;</span>
  </div>`
  }
  const rar = s.rarity
  const label = rar ? rar.name : "Not in the catalogue"
  const colour = rar ? rar.color : "#8c9cc4"
  return `<div class="v2w-day v2wt-slot filled">
    <span class="st" aria-hidden="true">${artIcon("bauble", 18)}</span>
    <span class="n">${s.slot}</span>
    <span class="dt" style="color:${esc(colour)}">${esc(label)}</span>
    <span class="r">${esc(s.name)}</span>
  </div>`
}

function gridCard(v) {
  const body = `<div class="v2w-cal">${v.slots.map(slotTile).join("")}</div>
    <div class="v2w-legend">
      <span class="c"><i></i>ornament placed</span>
      <span class="l"><i></i>empty slot</span>
    </div>
    ${v.filled ? "" : emptyState("All 24 slots are empty", "Clear a present or an Advent box, then place the ornament in game with /tree — it appears here on the next save.")}
    ${v.catalogue ? "" : `<p class="v2w-note" style="margin-top:6px">The game has not pushed its ornament catalogue yet, so a placed ornament is named by its id (Ornament #n).</p>`}
    <p class="v2w-note" style="margin-top:6px">One ornament per slot, 24 in all. An empty slot keeps its number, so a move made in game is easy to follow here. Ornaments come from <a href="/v2/winter/gifts">presents</a> and <a href="/v2/winter/advent">Advent boxes</a>.</p>`
  return card({
    head: { icon: artIcon("tree", 26), title: "The 24 slots", sub: "Each slot holds one ornament. Empty ones show their number." },
    body
  })
}

function sideCard(v) {
  const styles = v.styles.map(s => {
    const on = s.n === v.style.n
    return `<span class="v2wt-style${on ? " on" : ""}"${on ? ' aria-current="true"' : ""}>${s.n} &middot; ${esc(s.name)}</span>`
  }).join("")
  const body = `<div class="v2wt-side">
    <img class="v2wt-art" src="${esc(BIG.tree)}" width="176" height="264" alt="The Winterfest tree, decorated with lights and with presents underneath">
    <div class="v2wt-side-t">
      <p class="v2w-big"><b>Level ${fmt(v.level)}</b> <span>${v.levelPushed ? "pushed by the game" : "1 + completed sets"}</span></p>
      ${bar(v.filled, v.total)}
      <p class="v2w-note">${fmt(v.filled)} of ${fmt(v.total)} slots filled &middot; ${v.pctFilled}%</p>
      <p class="v2w-note">Style <b>${esc(v.style.name)}</b> &middot; ${v.style.n} of ${v.styles.length}</p>
      <div class="v2wt-styles">${styles}</div>
      <p class="v2w-note">Moving an ornament or changing the style happens in game (<code>/tree</code>). The panel mirrors the tree and has no write path to it, so nothing here pretends to have one.</p>
      ${button({ href: "/v2/winter/ornaments", label: "Open the collection", icon: icon("arrow", 18) })}
    </div>
  </div>`
  return card({
    head: { icon: artIcon("tree", 26), title: "Tree level and style", sub: "Read from the game; this page changes nothing." },
    body
  })
}

function onTreeCard(v) {
  const rows = v.onTree.length
    ? `<ul class="v2wt-rar">${v.onTree.map(t => `<li>
        <i style="background:${esc(t.color)}"></i>
        <b>${esc(t.name)}</b>
        <span>${fmt(t.count)}</span>
      </li>`).join("")}</ul>
      <p class="v2w-note" style="margin-top:6px">Counted from the slots above — ${fmt(v.filled)} ornament${v.filled === 1 ? "" : "s"} in total.</p>`
    : emptyState("Nothing hanging yet", "The tally counts the ornaments actually placed on your tree.")
  return card({
    head: { icon: artIcon("star", 24), title: "On the tree, by rarity" },
    body: rows
  })
}

function nextSetCard(v) {
  const s = v.nextSet
  const body = s
    ? `<p class="v2w-big"><b>${esc(s.name)}</b> <span>${fmt(s.owned)} / ${fmt(s.total)}</span></p>
      ${bar(s.owned, s.total)}
      <p class="v2w-note">${fmt(s.total - s.owned)} ornament${s.total - s.owned === 1 ? "" : "s"} to go${s.title ? ` &middot; title: ${esc(s.title)}` : ""}.</p>
      <p class="v2w-note">${fmt(v.completeSets)} of ${fmt(v.setCount)} sets complete &middot; <a href="/v2/winter/ornaments">the whole collection</a>.</p>`
    : `<p class="v2w-big"><b>${v.setCount ? "Every set complete" : "No sets published"}</b></p>
      <p class="v2w-note">${v.setCount
        ? `${fmt(v.completeSets)} of ${fmt(v.setCount)} sets are complete, so there is no next milestone.`
        : "The game has not pushed its set rows yet, so there is no milestone to show."}</p>`
  return card({
    head: { icon: artIcon("trophy", 24), title: "Next set" },
    body
  })
}

function sourceCard() {
  const body = `<div class="v2w-pass">
      <ul>
        <li>${icon("check", 15)}<span><a href="/v2/winter/gifts">Presents</a> can drop a random ornament.</span></li>
        <li>${icon("check", 15)}<span>Some <a href="/v2/winter/advent">Advent days</a> pay one.</span></li>
        <li>${icon("check", 15)}<span>The <a href="/v2/winter/spin">spin wheel</a> can too.</span></li>
      </ul>
      <p class="v2w-note" style="margin:0">Place it in game with <code>/tree</code>. The style is stored by the game as well, so both stay in step.</p>
    </div>`
  return card({
    head: { icon: artIcon("gift", 24), title: "Where ornaments come from" },
    body
  })
}

export async function pageWinterTreeV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = treeView(ctx)

  const hero = winterHero({
    title: "Your Christmas Tree",
    sub: "Collect ornaments and decorate your tree!",
    badge: `<b>${fmt(v.filled)}</b> / ${fmt(v.total)} slots &middot; level ${fmt(v.level)}`,
    artLeft: { src: BIG.tree, w: 240, h: 360 }
  })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${gridCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${sideCard(v)}</div>
</div>
<div class="v2w-strip">${onTreeCard(v)}${nextSetCard(v)}${sourceCard()}</div>
<p class="v2w-note">Every number on this page comes from the game's own snapshot of the tree (the <code>winter_tree</code> mirror).${v.found ? "" : " No tree snapshot has been pushed for this player yet, so the tree is empty and the level is the game's starting level."} This page reads that mirror; it cannot move a slot, change a style or grant an ornament.</p>`

  return winterPage({
    title: "Your Christmas Tree",
    active: "",
    tab: "tree",
    ctx,
    content: body,
    extraCss: TREE_CSS
  })
}
