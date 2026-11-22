// /winter/ornaments — the collection book.
//
// Every catalogue entry, grouped by set, with owned/missing state and the set
// progress that unlocks a title. Two rules are load-bearing here:
//
//   1. a LOCKED entry shows the silhouette ("? ? ?"), never a picture of the
//      thing you have not found;
//   2. if the catalogue marks an entry (or a whole set) `secret`, its NAME is
//      not printed either — a secret collection is only named once it is
//      complete. That is the "never leak" rule, enforced by omission rather
//      than by hiding with CSS.
import { esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref, glyphFor } from "./render.js"
import { ornamentStatus, setProgress } from "./progress.js"

function swatchRow(cat, items, owned) {
  const cells = items.map(o => {
    const rar = cat.rarities[o.rarity]
    const colour = rar ? rar.color : "#8fa0b0"
    const isOwned = owned.has(o.id)
    const name = isOwned ? o.name : (o.secret ? "? ? ?" : o.name)
    const title = isOwned
      ? `${o.name} — ${rar ? rar.name : "rarity " + o.rarity}`
      : (o.secret ? "Not found yet" : `${o.name} — not found yet`)
    const glyph = isOwned ? glyphFor(o.id) : "?"
    return `<td width="72" align="center" valign="top" style="padding:6px 2px;">
      <span class="wf-orn${isOwned ? "" : " locked"}" style="${isOwned ? `border-color:${esc(colour)};color:${esc(colour)}` : ""}" title="${esc(title)}">${esc(glyph)}</span>
      <span class="wf-s" style="display:block;margin-top:2px;color:${isOwned ? "#e8edf2" : "#5c6f77"};">${esc(name)}</span>
      <span class="wf-s" style="display:block;color:${isOwned ? esc(colour) : "#3f4f57"};font-size:9px;">${isOwned ? esc(rar ? rar.name : "rarity " + o.rarity) : "missing"}</span>
    </td>`
  })
  const out = []
  for (let i = 0; i < cells.length; i += 6) out.push(`<tr>${cells.slice(i, i + 6).join("")}</tr>`)
  return `<table class="wf-row" cellspacing="0" cellpadding="0" border="0">${out.join("")}</table>`
}

export function pageWinterOrnaments(ctx) {
  const { cat, season, state, url } = ctx
  const owned = state.ownedIds || new Set()
  const sets = setProgress(cat, state)
  const orn = ornamentStatus(cat, state)

  const groups = []
  const loose = (cat.ornaments || []).filter(o => !o.set)
  if (loose.length) groups.push(swatchRow(cat, loose, owned))

  const setBlocks = sets.map(s => {
    const items = s.ornaments
    const complete = s.complete
    const titleLine = s.secret && !complete
      ? `<span class="wf-s">secret collection — its name is revealed when the set is complete</span>`
      : `<span class="wf-s">${esc(s.title || s.name)}${s.snowflakes ? ` &middot; ${s.snowflakes} snowflakes` : ""}</span>`
    const unlock = complete
      ? `<b style="color:#e8c547;">UNLOCKED</b> — the title is awarded in game.`
      : s.secret
        ? `<span class="wf-msg err">LOCKED</span> — ${s.total - s.owned} more ornament${s.total - s.owned === 1 ? "" : "s"} to reveal it.`
        : `<span class="wf-msg wait">LOCKED</span> — ${s.total - s.owned} more ornament${s.total - s.owned === 1 ? "" : "s"}.`
    return `<div class="wf-set">
      <h4>${esc(s.name)} <span class="wf-s">${s.owned}/${s.total}</span></h4>
      ${titleLine}
      ${bar(s.total ? Math.round((s.owned * 100) / s.total) : 0, complete ? "#e8c547" : "#3dff9e")}
      ${swatchRow(cat, items, owned)}
      <div class="wf-note">${unlock}</div>
    </div>`
  })

  const extra = orn.extra.length
    ? `<div class="card" style="margin-top:8px;"><div class="h2">Owned, not in the catalogue</div>
        <div class="wf-note">The game reports these ids but the pushed catalogue has no entry for them yet — shown as ids rather than renamed: ${orn.extra.map(id => `<code>${fmt(id)}</code>`).join(" ")}</div></div>`
    : ""

  const missingCatalogue = cat.ok ? "" : `<div class="wf-note">The ornament catalogue has not been pushed by the game server yet, so the book lists only what the game says this player owns (by id). Nothing is invented to fill it.</div>`

  const body = `
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Collected", `${orn.ownedInCatalogue}/${orn.catalogueTotal}`, `${orn.pct}% of the book`, "green")}
  ${statCard("Missing", fmt(orn.missing), "still out there")}
  ${statCard("Sets complete", `${sets.filter(s => s.complete).length}/${sets.length}`, "each one awards a title", "gold")}
</tr></table>
<div style="margin-top:6px;">${bar(orn.pct, "#3dff9e")}</div>
${missingCatalogue}
<div class="card" style="margin-top:8px;">
  <div class="h2">The book</div>
  ${groups.join("") || (cat.ok ? `<div class="empty">The catalogue has no loose ornaments.</div>` : "")}
</div>
${setBlocks.length ? `<div class="card" style="margin-top:8px;"><div class="h2">Secret collections</div>
  <div class="wf-note">Five of a kind unlocks a title. The name of a secret collection stays hidden until you finish it.</div>
  ${setBlocks.join("")}</div>` : ""}
${extra}
<div class="wf-note">Locked entries show a silhouette and, for a secret one, no name at all. Found ornaments appear in <a href="${esc(winterHref(url, "/winter/tree"))}">your tree</a> as you place them in game.</div>`

  return winterPage("ORNAMENTS", body, { season, nav: navTabs(url, "ornaments"), url })
}
