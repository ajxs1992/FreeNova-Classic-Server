// /winter/gifts — what you have found, by rarity, and the last ten openings.
//
// No fake rows: an empty log says what to do in game (/christmas) instead of
// drawing a placeholder present. Timestamps come from the game's own claim
// ledger, so an opening can never show a time it did not happen.
import { esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref, winterTime } from "./render.js"
import { rewardLabel, rarityName, rarityColor } from "./catalog.js"

const RARITY_ROWS = 3 // WF_RARITY_MAX in winterfest.inc

export function pageWinterGifts(ctx) {
  const { cat, season, state, url } = ctx
  const total = Math.max(state.giftTotal, state.giftsFound)
  const rareSum = [...state.giftCounts.values()].reduce((a, b) => a + b, 0)

  const rarityRows = []
  for (let r = 0; r < RARITY_ROWS; r++) {
    const n = state.giftCounts.get(r) || 0
    const label = cat.ok ? rarityName(cat, r) : `rarity ${r}`
    const colour = cat.ok ? rarityColor(cat, r) : "#8fa0b0"
    rarityRows.push(`<tr>
      <td width="140"><span class="wf-dot" style="background:${esc(colour)}"></span>${esc(label)}</td>
      <td width="150">${bar(rareSum ? Math.round((n * 100) / rareSum) : 0, colour)}</td>
      <td width="60" align="right"><b>${fmt(n)}</b></td>
    </tr>`)
  }

  const openings = state.gifts.length
    ? state.gifts.slice(0, 10).map(g => {
        const label = rewardLabel(cat, g.type, g.id, g.amount)
        const colour = cat.ok ? rarityColor(cat, g.rarity) : "#8fa0b0"
        const rname = cat.ok ? rarityName(cat, g.rarity) : `rarity ${g.rarity}`
        return `<tr>
          <td width="170"><span class="wf-s">${winterTime(g.openedAt, season.tz)}</span></td>
          <td>${esc(label)}</td>
          <td width="110"><span class="wf-dot" style="background:${esc(colour)}"></span>${esc(rname)}</td>
        </tr>`
      }).join("")
    : ""

  const empty = !state.gifts.length
    ? `<div class="empty"><b>No presents opened yet</b><br>
        Presents spawn on the map during Winterfest. Walk over one in game to pick it up, then type
        <code>/opengift</code> (or use <code>/christmas</code>) to open it. The first opening shows up here
        within a minute — nothing is invented to fill the table.</div>`
    : ""

  const community = state.community && Number(state.community.target) > 0
    ? `<div class="card" style="margin-top:8px;"><div class="h2">Community goal</div>
        <div class="wf-v gold" style="font-size:15px;">${esc(state.community.label || "Community goal")}</div>
        ${bar(Math.min(100, Math.round((Number(state.community.current) * 100) / Number(state.community.target))), "#e8c547")}
        <div class="wf-note">${fmt(Number(state.community.current) || 0)} / ${fmt(Number(state.community.target) || 0)} — counted by the game server.</div></div>`
    : ""

  const body = `
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Gifts found", fmt(state.giftsFound), "per the game snapshot")}
  ${statCard("Logged openings", fmt(state.giftTotal), `${fmt(total)} found in game`)}
</tr></table>

<div class="card" style="margin-top:8px;">
  <div class="h2">By rarity</div>
  <table class="wf-row" cellspacing="0" cellpadding="0" border="0">${rarityRows.join("")}</table>
  <div class="wf-note">Counts come from the ${fmt(state.giftTotal)} opening${state.giftTotal === 1 ? "" : "s"} the game pushed; a rarity with no row has not been opened yet.</div>
</div>

<div class="card" style="margin-top:8px;">
  <div class="h2">Last ${Math.min(10, state.gifts.length) || 10} openings <span class="wf-s">newest first</span></div>
  ${openings
    ? `<table class="wf-row" cellspacing="0" cellpadding="0" border="0">
         <tr><td class="wf-k">When</td><td class="wf-k">Reward</td><td class="wf-k">Rarity</td></tr>
         ${openings}</table>`
    : ""}
  ${empty}
  <div class="wf-note">Every ornament you have found is in the <a href="${esc(winterHref(url, "/winter/ornaments"))}">collection book</a>.</div>
</div>
${community}`

  return winterPage("GIFTS", body, { season, nav: navTabs(url, "gifts"), url })
}
