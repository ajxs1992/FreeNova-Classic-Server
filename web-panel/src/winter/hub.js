// /winter — the December overview.
//
// Answers, in this order and without scrolling: how long the season has left,
// what the Advent calendar is waiting for, how much currency/gifts you have,
// how far your tree is, and where the Winter Pass stands. The three headlines
// are the three things worth doing next (next Advent day, next pass reward,
// community goal when the game pushes one).
import { esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref, winterTime } from "./render.js"
import { adventStatus, passStatus, treeStatus, ornamentStatus, headlines } from "./progress.js"

export function pageWinterHub(ctx) {
  const { cat, season, state, url } = ctx
  const adv = adventStatus(season, state)
  const pass = passStatus(cat, state)
  const tree = treeStatus(cat, state)
  const orn = ornamentStatus(cat, state)

  const seasonValue = season.phase === "open"
    ? `${season.daysLeft} day${season.daysLeft === 1 ? "" : "s"}`
    : season.phase === "before" ? "not open yet" : season.phase === "disabled" ? "switched off" : "closed"
  const seasonSub = season.phase === "open"
    ? `closes ${winterTime(season.closesAt, season.tz)}`
    : season.phase === "before"
      ? `opens ${winterTime(season.opensAt, season.tz)}`
      : `window ${esc(season.startKey)} .. ${esc(season.endKey)}`

  const passColour = pass.pct >= 100 ? "#e8c547" : "#9be7ff"
  const heads = headlines(cat, season, state).map(h => `<tr>
      <td width="104" valign="top"><span class="wf-k">${esc(h.kicker)}</span></td>
      <td valign="top">${esc(h.text)} <a href="${esc(winterHref(url, h.href))}">open</a></td>
      <td width="22" valign="top"><b style="color:#e8c547;">&rsaquo;</b></td>
    </tr>`).join("")

  const never = state.found ? "" : `<div class="wf-note">The panel has no Winterfest snapshot for this player yet. That is normal before the first in-game save: open <b>/christmas</b> in game, find a present, and the numbers below fill in within a minute. Nothing here is estimated.</div>`

  const catalogueNote = cat.ok ? "" : `<div class="wf-note">The ornament catalogue, Advent table and pass ladder are pushed by the game server (<code>catalogs.winterfest</code>). They have not arrived yet, so the lists are empty rather than made up.</div>`

  const body = `
<div class="wf-note">${state.name ? `<b>${esc(state.name)}</b>` : ""} ${state.steamid ? `<span class="wf-s">${esc(state.steamid)}</span>` : ""}</div>
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Season", esc(seasonValue), seasonSub, season.phase === "open" ? "red" : "")}
  ${statCard("Advent", `${adv.claimedCount}/${adv.total}`, adv.claimableNow ? `${adv.claimableNow} claimable now` : "all caught up", adv.claimableNow ? "gold" : "")}
</tr><tr>
  ${statCard("Snowflakes", fmt(state.snowflakes), "currency")}
  ${statCard("Gifts found", fmt(state.giftsFound), `${fmt(state.giftTotal)} logged openings`)}
</tr><tr>
  ${statCard("Tree", `${tree.filled}/${tree.total}`, `level ${fmt(tree.level)} &middot; ${tree.pct}% complete`, "green")}
  ${statCard("Winter Pass", `Tier ${fmt(pass.tier)}`, pass.next.at == null ? `${fmt(pass.xp)} XP &middot; ladder not pushed yet` : `${fmt(pass.xp)} XP &middot; ${pass.pct}% to tier ${Math.min(pass.maxTier, pass.tier + 1)}`, "gold")}
</tr></table>
<div style="margin-top:6px;">${bar(pass.pct, passColour)}</div>
<div class="wf-note">Ornaments <b>${orn.ownedInCatalogue}/${orn.catalogueTotal}</b>${orn.extra.length ? ` (+${orn.extra.length} not in the catalogue)` : ""} &middot; sets complete <b>${tree.completeSets}/${tree.sets.length}</b></div>

<div class="card" style="margin-top:8px;">
  <div class="h2">Next up</div>
  <table class="wf-row" cellspacing="0" cellpadding="0" border="0">${heads || `<tr><td><span class="wf-note">Nothing to claim yet — the season has not started.</span></td></tr>`}</table>
</div>
${never}${catalogueNote}
<div class="card" style="margin-top:8px;">
  <div class="h2">In game</div>
  <div class="wf-note">Type <code>/christmas</code> for the hub, <code>/opengift</code> to open a present, <code>/tree</code> for your tree's level and <code>/advent</code> to claim the day. Presents spawn on the map; walking over one picks it up.</div>
</div>`

  return winterPage("WINTERFEST", body, { season, nav: navTabs(url, ""), url })
}
