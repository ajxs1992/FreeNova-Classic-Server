// /winter/tree and /winter/tree/<steamid> — the 24-slot tree.
//
// ONE renderer serves the owner, every stranger and all three style previews
// (mission rule: "it must be the same renderer"). The only differences are the
// `readOnly` flag and which style is being shown.
//
// Move an ornament without JavaScript: the form below posts
// action=move&from=<slot>&to=<slot> with the same ?t= action token every other
// panel action uses. With JavaScript a filled slot can be dragged onto another
// one; that is an enhancement, never the only way in.
import {
  esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref, slotGrid
} from "./render.js"
import { treeStatus, setProgress, ornamentStatus } from "./progress.js"
import { treeStyle, TREE_SLOTS } from "./catalog.js"
import { isMotdCompact } from "../ui.js"
import { NO_MINT_MSG } from "../sync.js"

// Browser-only drag-and-drop. Posts exactly what the form posts, so the server
// has one code path. Dropped without JS entirely.
const DRAG_SCRIPT = `<script>
(function(){
  var tree=document.getElementById('wf-tree');
  if(!tree||!window.addEventListener)return;
  var from=null;
  function slots(){return tree.getElementsByTagName('div');}
  function onStart(e){
    var el=e.target||e.srcElement;
    if(!el||(' '+el.className+' ').indexOf(' filled ')<0)return;
    from=el.getAttribute('data-slot');
    if(e.dataTransfer){e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',from);}catch(x){}}
    el.className='wf-in filled drag';
  }
  function onOver(e){
    var el=e.target||e.srcElement;
    if(!el||!el.getAttribute)return;
    if((' '+el.className+' ').indexOf(' wf-in ')<0)return;
    if(e.preventDefault)e.preventDefault();
    el.className=(' '+el.className+' ').indexOf(' filled ')<0?'wf-in empty over':'wf-in filled over';
  }
  function onDrop(e){
    var el=e.target||e.srcElement;
    if(!from||!el||!el.getAttribute)return;
    if(e.preventDefault)e.preventDefault();
    var to=el.getAttribute('data-slot');
    if(!to){window.location.reload();return;}
    if(to===from){window.location.reload();return;}
    var f=document.getElementById('wf-move-form');
    if(!f){window.location.href='?';return;}
    var fd=new FormData(f);
    fd.set('action','move');fd.set('from',from);fd.set('to',to);
    var req=new XMLHttpRequest();
    req.open('POST',f.getAttribute('action'),true);
    req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
    req.onload=function(){window.location.reload();};
    req.onerror=function(){window.location.reload();};
    var parts=[];fd.forEach(function(v,k){parts.push(encodeURIComponent(k)+'='+encodeURIComponent(v));});
    req.send(parts.join('&'));
  }
  function bind(el){
    var kids=el.getElementsByTagName('div');
    for(var i=0;i<kids.length;i++){
      if((' '+kids[i].className+' ').indexOf(' wf-in ')<0)continue;
      kids[i].addEventListener('dragstart',onStart,false);
      kids[i].addEventListener('dragover',onOver,false);
      kids[i].addEventListener('drop',onDrop,false);
      kids[i].addEventListener('dragend',function(){window.location.reload();},false);
    }
  }
  bind(tree);
})();
</script>`

function statusLine(action) {
  if (!action) return ""
  const what = action.type === "wf_tree_style" ? "style change" : "move"
  const arg = String(action.arg || "")
  const pretty = action.type === "wf_tree_move" && /^\d+:\d+$/.test(arg)
    ? `slot ${arg.split(":")[0]} &rarr; slot ${arg.split(":")[1]}`
    : arg
  if (action.status === "done") return `<div class="wf-msg ok">Last ${what} (${esc(pretty)}) applied by the game: ${esc(action.result || "OK")}</div>`
  if (action.status === "failed") return `<div class="wf-msg err">Last ${what} (${esc(pretty)}) was refused by the game: ${esc(action.result || "rejected")}</div>`
  if (action.status === "pending" || action.status === "sent")
    return `<div class="wf-msg wait">Last ${what} (${esc(pretty)}) is queued — the game applies it on its next save (about a minute) and this tree updates then.</div>`
  return `<div class="wf-msg">Last ${what} (${esc(pretty)}): ${esc(action.status)}</div>`
}

function moveForm(url, state, token) {
  if (!token) return `<div class="wf-form"><span class="wf-msg">${esc(NO_MINT_MSG)}</span></div>`
  const from = []
  for (let slot = 1; slot <= TREE_SLOTS; slot++) {
    const orn = state.slots.get(slot)
    if (!orn) continue
    from.push(`<option value="${slot}">Slot ${slot} &mdash; ${esc(ornName(state.catOrnaments, orn))}</option>`)
  }
  const to = []
  for (let slot = 1; slot <= TREE_SLOTS; slot++) {
    const occupied = state.slots.get(slot) ? " (filled)" : " (empty)"
    to.push(`<option value="${slot}">Slot ${slot}${esc(occupied)}</option>`)
  }
  if (!from.length)
    return `<div class="wf-form"><span class="wf-note">No ornaments placed yet, so there is nothing to move. Open a present in game and it appears here.</span></div>`
  return `<form class="wf-form" id="wf-move-form" method="post" action="/winter/tree">
  <input type="hidden" name="steamid" value="${esc(state.steamid)}">
  <input type="hidden" name="t" value="${esc(token)}">
  <input type="hidden" name="action" value="move">
  Move <select name="from">${from.join("")}</select>
  to <select name="to">${to.join("")}</select>
  <button class="btn" type="submit">Move</button>
  <div class="wf-note">If the target slot is taken, the game swaps the two ornaments. Drag-and-drop does the same thing when JavaScript is on.</div>
</form>`
}

function ornName(byId, id) {
  const o = byId && byId.get ? byId.get(id) : null
  return o ? o.name : "Ornament #" + id
}

function styleForm(url, state, token, current) {
  if (!token) return ""
  const labels = ["Classic", "Tall", "Wide"]
  const opts = [1, 2, 3].map(n =>
    `<option value="${n}"${n === current ? " selected" : ""}>${n} &mdash; ${labels[n - 1]}</option>`).join("")
  return `<form class="wf-form" method="post" action="/winter/tree">
  <input type="hidden" name="steamid" value="${esc(state.steamid)}">
  <input type="hidden" name="t" value="${esc(token)}">
  <input type="hidden" name="action" value="style">
  Tree style <select name="style">${opts}</select>
  <button class="btn" type="submit">Use this style</button>
  <div class="wf-note">The style is stored in game (<code>wf_tree_set_style</code>), so <code>/tree</code> shows the same one.</div>
</form>`
}

export function pageWinterTree(ctx, opts) {
  const o = opts || {}
  const { cat, season, state, url, token, lastAction } = ctx
  const readOnly = !!o.readOnly
  const shown = Math.max(1, Math.min(3, num(o.style) || state.treeStyle || 1))
  const style = treeStyle(cat, shown)
  const tree = treeStatus(cat, state)
  const sets = tree.sets
  const orn = ornamentStatus(cat, state)
  const current = state.treeStyle || 1

  // The grids are the catalogue's own ornaments; keep a lookup for the form.
  const ornamentsById = cat.ornamentById
  state.catOrnaments = ornamentsById

  const tabs = [1, 2, 3].map(n => {
    const label = n === current ? `${treeStyle(cat, n).name} (yours)` : treeStyle(cat, n).name
    return n === shown
      ? `<span class="on">${esc(label)}</span>`
      : `<a href="${esc(winterHref(url, "/winter/tree", { style: n }))}">${esc(label)}</a>`
  }).join("")

  const header = readOnly
    ? `<div class="wf-head">${state.name ? `<b>${esc(state.name)}</b>` : ""} ${esc(state.steamid)} — read-only: this is somebody else's tree.</div>`
    : `<div class="wf-head">Your tree &middot; <b>${state.name ? esc(state.name) : esc(state.steamid)}</b>${shown !== current ? ` &middot; previewing <b>${esc(style.name)}</b> (you are on ${esc(treeStyle(cat, current).name)})` : ""}</div>`

  const setRows = sets.length
    ? sets.map(s => `<tr>
        <td><b>${esc(s.name)}</b>${s.title && s.title !== s.name ? ` <span class="wf-s">${esc(s.title)}</span>` : ""}</td>
        <td width="120">${bar(s.total ? Math.round((s.owned * 100) / s.total) : 0, s.complete ? "#e8c547" : "#3dff9e")}</td>
        <td width="70" align="right">${s.owned}/${s.total}</td>
        <td width="70" align="right">${s.complete ? `<b style="color:#e8c547;">set complete</b>` : ""}</td>
      </tr>`).join("")
    : ""

  const body = `
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Slots filled", `${tree.filled}/${tree.total}`, `${tree.pct}% complete`, "green")}
  ${statCard("Tree level", fmt(tree.level), "from the game")}
  ${statCard("Ornaments", `${orn.ownedInCatalogue}/${orn.catalogueTotal}`, `${orn.missing} still missing`)}
  ${statCard("Next milestone", esc(tree.nextSet ? tree.nextSet.name : "—"), tree.nextSet ? `${tree.nextSet.owned}/${tree.nextSet.total} (${tree.nextSet.total - tree.nextSet.owned} to go)` : "no set progress yet", "gold")}
</tr></table>
<div style="margin-top:6px;">${bar(tree.pct, "#3dff9e")}</div>
<div class="wf-tabs">${tabs}</div>
${slotGrid(cat, state.slots, style, { readOnly })}
<div class="wf-note">${style.name} layout &middot; ${style.slots.length} of ${TREE_SLOTS} slots positioned${cat.ok ? "" : " from the built-in layout, because the game's own <code>[tree]</code> rows have not been pushed yet"}. Hover an ornament for its name; the colour is its rarity.</div>
${readOnly ? `<div class="wf-note">Read-only view. <a href="${esc(winterHref(url, "/winter/tree"))}">Open your own tree</a>.</div>` : ""}
${readOnly ? "" : statusLine(lastAction)}
${readOnly ? "" : moveForm(url, state, token)}
${readOnly ? "" : styleForm(url, state, token, current)}
${setRows ? `<div class="card" style="margin-top:8px;"><div class="h2">Sets</div>
  <table class="wf-row" cellspacing="0" cellpadding="0" border="0">${setRows}</table>
  <div class="wf-note">A completed set awards its title in game. <a href="${esc(winterHref(url, "/winter/ornaments"))}">Open the collection book</a>.</div></div>` : ""}
${readOnly || isMotdCompact() ? "" : DRAG_SCRIPT}`

  return winterPage("YOUR TREE", body, { season, nav: navTabs(url, "tree"), url })
}
