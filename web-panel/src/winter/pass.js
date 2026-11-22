// /winter/pass — the Winter Pass.
//
// Owner decision §6.2: 30 tiers, FREE TRACK ONLY. There is no premium column,
// no paid lane and no purchase link anywhere in this page — not hidden, not
// commented out. The full ladder is behind a link rather than a JS toggle so it
// works with JavaScript disabled and in the GoldSrc MOTD browser.
import { esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref } from "./render.js"
import { passStatus } from "./progress.js"
import { PASS_TIERS } from "./catalog.js"

export function pageWinterPass(ctx, opts) {
  const o = opts || {}
  const { cat, season, state, url } = ctx
  const pass = passStatus(cat, state)
  const full = !!o.full

  const upcoming = pass.upcoming.length
    ? pass.upcoming.map(u => `<tr>
        <td width="60"><b style="color:#e8c547;">Tier ${u.tier}</b></td>
        <td>${esc(u.label)}</td>
        <td width="90" align="right"><span class="wf-s">${fmt(u.xp)} XP</span></td>
      </tr>`).join("")
    : `<tr><td colspan="3"><span class="wf-note">${pass.atMax ? "Tier 30 reached — nothing left on the free track." : "The game has not published the next rewards yet."}</span></td></tr>`

  const ladder = pass.ladder.map(r => {
    const cls = r.state === "done" ? "done" : r.state === "now" ? "now" : "locked"
    const mark = r.state === "done" ? "&check;" : r.state === "now" ? "&rarr;" : "&middot;"
    const reward = r.label || (r.xp == null ? `<span class="wf-s">not published yet</span>` : `<span class="wf-s">no reward</span>`)
    return `<tr class="${cls}"><td class="t">${mark} ${r.tier}</td><td>${esc(reward)}</td><td width="90" align="right"><span class="wf-s">${r.xp == null ? "—" : fmt(r.xp) + " XP"}</span></td></tr>`
  }).join("")

  const ladderCard = full
    ? `<div class="card" style="margin-top:8px;">
        <div class="h2">Full ladder <span class="wf-s">30 tiers, free track</span></div>
        <table class="wf-tier" cellspacing="0" cellpadding="0" border="0">${ladder}</table>
        <div class="wf-note"><a href="${esc(winterHref(url, "/winter/pass"))}">Hide the full ladder</a></div>
      </div>`
    : `<div class="wf-note"><a href="${esc(winterHref(url, "/winter/pass", { full: 1 }))}">Show the full 30-tier ladder</a></div>`

  const body = `
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Tier", fmt(pass.tier), `of ${PASS_TIERS}`, "gold")}
  ${statCard("Total XP", fmt(pass.xp), "Winter Pass XP")}
  ${statCard(pass.atMax ? "At the top" : "Next tier",
    pass.atMax ? "—" : (pass.next.at == null ? "—" : fmt(pass.next.need) + " XP"),
    pass.atMax ? "free track complete" : (pass.next.at == null ? "the ladder has not been pushed yet" : `tier ${Math.min(PASS_TIERS, pass.tier + 1)} at ${fmt(pass.next.at)} XP`))}
</tr></table>
<div style="margin-top:6px;">${bar(pass.pct, pass.atMax ? "#e8c547" : "#9be7ff")}</div>
<div class="wf-note">${pass.atMax ? "Tier 30 — the free track is complete." : `${fmt(pass.into)} / ${fmt(pass.span)} XP into tier ${pass.tier} (${pass.pct}%)`}${
  pass.published ? "" : " — the ladder's XP floors have not been pushed by the game yet, so only the tier and XP totals are shown."
}</div>

<div class="card" style="margin-top:8px;">
  <div class="h2">Next three rewards</div>
  <table class="wf-row" cellspacing="0" cellpadding="0" border="0">${upcoming}</table>
  <div class="wf-note">XP comes from opening presents, Advent claims and Christmas missions — all awarded by the game server, never by this page.</div>
</div>
${ladderCard}
<div class="wf-note">The Winter Pass is the free seasonal track: <b>30 tiers, no paid lane</b>. Existing XP, coins and the BattlePass are untouched.</div>`

  return winterPage("WINTER PASS", body, { season, nav: navTabs(url, "pass"), url })
}
