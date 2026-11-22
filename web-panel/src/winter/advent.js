// /winter/advent — the 24-day calendar.
//
// Four states, one per cell, and the FINAL owner rule (§6.3):
//   claimed  the game's ledger has the day
//   today    unlocked today, still unclaimed — claimable today only
//   missed   the day has passed and was not claimed — EXPIRED. The catch-up at
//            half value was withdrawn: after midnight the box is gone. At the
//            end of the season the whole calendar can be unlocked by buying the
//            Advent Pass, which turns every missed day back into a claim.
//   locked   not unlocked yet — the reward stays hidden
//
// A reward is printed for `claimed` and `today` only. `missed` shows that it is
// still claimable (and at what value) without printing the reward, and `locked`
// shows nothing but the day number: the calendar never leaks a box you have not
// opened. Claims happen in game (`/advent`), never on this page.
import { esc, fmt, num, winterPage, navTabs, kpiRow, statCard, bar, winterHref, winterTime } from "./render.js"
import { adventStatus } from "./progress.js"
import { adventEntry, rewardLabel, REWARD } from "./catalog.js"

const PER_ROW = 6

function rewardText(cat, day) {
  const e = adventEntry(cat, day)
  if (!e) return ""
  if (e.label) return e.label
  if (e.type === REWARD.NONE) return ""
  return rewardLabel(cat, e.type, e.id, e.amount)
}

export function pageWinterAdvent(ctx) {
  const { cat, season, state, url } = ctx
  const adv = adventStatus(season, state)

  const cells = adv.days.map(d => {
    const cls = d.status === "claimed" ? "claimed"
      : d.status === "today" ? "today"
      : d.status === "missed" ? "missed"
      : "locked"
    let reward = ""
    if (d.status === "claimed") {
      const r = rewardText(cat, d.day)
      reward = r ? `<span class="r">${esc(r)}</span>` : `<span class="r">claimed</span>`
    } else if (d.status === "today") {
      const r = rewardText(cat, d.day)
      reward = r ? `<span class="r">${esc(r)}</span><br><span class="r" style="color:#e8c547;">claim in game</span>`
        : `<span class="r">claim in game</span>`
    } else if (d.status === "missed") {
      reward = `<span class="r">expired</span><br><span class="r" style="color:#e05a5a;">no claim</span>`
    } else {
      reward = `<span class="r">locked</span>`
    }
    const when = d.claimedAt ? `<div class="wf-s">${winterTime(d.claimedAt, season.tz)}</div>` : ""
    return `<td class="${cls}" valign="top"><div class="d">${d.day}</div>${reward}${when}</td>`
  })
  const rows = []
  for (let i = 0; i < cells.length; i += PER_ROW)
    rows.push(`<tr>${cells.slice(i, i + PER_ROW).join("")}${cells.length - i < PER_ROW ? `<td class="locked" style="background:none;border:0;"></td>`.repeat(PER_ROW - (cells.length - i)) : ""}</tr>`)

  const status = season.adventOpen ? ""
    : season.phase === "before"
      ? `<div class="wf-msg wait">The calendar opens ${winterTime(season.opensAt, season.tz)}. Day 1 is claimable on 1 December.</div>`
      : season.phase === "open"
        ? `<div class="wf-msg err">The Advent calendar is closed. The season itself runs to ${winterTime(season.closesAt, season.tz)}.</div>`
        : `<div class="wf-msg">Winterfest is not active on this deployment.</div>`

  const body = `
<table class="wf-kpis" cellspacing="0" cellpadding="0" border="0"><tr>
  ${statCard("Claimed", `${adv.claimedCount}/${adv.total}`, "days in the ledger", "green")}
  ${statCard("Claimable now", fmt(adv.claimableNow), adv.missedCount ? `${adv.missedCount} expired` : "nothing pending", adv.claimableNow ? "gold" : "")}
  ${statCard("Season closes", season.phase === "open" ? `${season.daysLeft}d` : season.phase === "before" ? "not open" : "closed", winterTime(season.closesAt, season.tz), "red")}
</tr></table>
${status}
<div class="card" style="margin-top:8px;">
  <div class="h2">1 - 24 December</div>
  <table class="wf-cal" cellspacing="0" cellpadding="0" border="0">${rows.join("")}</table>
  <div class="wf-note">
    <span class="wf-dot" style="background:#0d231b;border-color:#3dff9e"></span>claimed
    <span class="wf-dot" style="background:#1d1a0f;border-color:#e8c547;margin-left:8px;"></span>today
    <span class="wf-dot" style="background:#1b1010;border-color:#7a3b3b;margin-left:8px;"></span>missed &mdash; expired
    <span class="wf-dot" style="background:#101820;border-color:#22303c;margin-left:8px;"></span>locked
  </div>
  <div class="wf-note">The season closes <b>${winterTime(season.closesAt, season.tz)}</b> — 24 December 23:59 Europe/Paris, shown in your own timezone when your browser can. Each day can only be claimed <b>on its own date</b>: once midnight passes, that box expires. Missed days can only be recovered by buying the <b>Advent Pass</b> after the calendar closes.</div>
</div>
<div class="card" style="margin-top:8px;">
  <div class="h2">How to claim</div>
  <div class="wf-note">Type <code>/advent</code> in game to claim <b>today's</b> box. A box can only be claimed on its own date — after midnight it expires and cannot be claimed, at any value. Claims are written by the game server and appear here on the next snapshot; this page never grants anything.</div>
</div>`

  return winterPage("ADVENT", body, { season, nav: navTabs(url, "advent"), url })
}
