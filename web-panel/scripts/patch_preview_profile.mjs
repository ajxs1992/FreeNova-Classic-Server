import { readFileSync, writeFileSync } from "fs"

const p = "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/build_preview.mjs"
let s = readFileSync(p, "utf8")
const start = s.indexOf("  <div class='csgo-hud-card'>")
const end = s.indexOf("\nconst NAV = [")
if (start < 0 || end < 0) throw new Error(`markers ${start} ${end}`)
const inner = `  <div class='csgo-hud-card'>
    <div class='csgo-hud-header'>
      <div class='csgo-hud-player'>
        <div class='csgo-avatar'>
          \${emblemBox(rp.curName, false, p.rank_id)}
          <span class='lvl'>\${fmt(p.level)}</span>
        </div>
        <div>
          <div style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;'>
            <span style='width:8px;height:8px;background:var(--lime);border-radius:50%;display:inline-block;'></span>
            <span style='font-size:10px;font-weight:800;color:var(--lime);letter-spacing:1px;'>ONLINE</span>
            <span style='font-family:var(--font-heading);font-size:26px;font-weight:800;color:#fff;'>\${esc(p.name)}</span>
            <span class='tier-badge tier-gold'>\${esc(activeTitle)}</span>
            <span class='badge vip'>\${esc(vipLabel)}</span>
          </div>
          <div style='font-size:11px;color:var(--text-muted);margin-top:4px;'>\${esc(p.steamid)} · \${fmt(earnedAP)} AP</div>
        </div>
      </div>
      <div class='csgo-featured'>\${featuredHtml}</div>
    </div>
    <div class='csgo-hud-body'>
      <div class='csgo-hud-rank-panel'>
        \${emblemBox(rp.curName, false, p.rank_id, "lg")}
        <div class='csgo-rank-title'>Private Rank \${fmt(p.rank_id)} — \${esc(rp.curName)}</div>
        <div style='display:flex;justify-content:space-between;font-size:12px;margin:6px 0 4px;'>
          <span style='font-family:var(--font-heading);font-weight:800;color:#fff;'>\${fmt(p.xp)} / \${fmt(rp.nextReq)} XP</span>
          <span style='color:var(--text-dim);'>\${rp.isMax ? "MAX RANK" : "+" + fmt(rp.remaining) + " XP to next rank"}</span>
        </div>
        <div style='background:rgba(255,255,255,0.08);height:8px;border-radius:4px;overflow:hidden;'>
          <div style='background:linear-gradient(90deg,var(--cyan),#0284c7);height:100%;width:\${rp.progressPct}%;'></div>
        </div>
        <div class='csgo-commend'>
          <div class='csgo-commend-item'><div class='k'>MVPs</div><div class='v'>\${fmt(p.mvps)}</div></div>
          <div class='csgo-commend-item'><div class='k'>Assists</div><div class='v'>\${fmt(p.assists)}</div></div>
          <div class='csgo-commend-item'><div class='k'>Wins</div><div class='v'>\${fmt(p.wins)}</div></div>
        </div>
      </div>
      <div class='csgo-hud-rating-panel'>
        <div style='font-size:10px;color:var(--text-dim);letter-spacing:1.2px;text-transform:uppercase;'>Competitive</div>
        <div class='csgo-rank-title'>\${esc(skillName(p.rating_x100))}</div>
        <div style='font-family:var(--font-heading);font-size:28px;font-weight:800;color:var(--cyan);'>\${ratingStr(p.rating_x100)}</div>
        <div class='csgo-esports-grid'>
          <div class='csgo-metric'><div class='k'>Rating</div><div class='v'>\${ratingStr(p.rating_x100)}</div></div>
          <div class='csgo-metric'><div class='k'>K/D</div><div class='v'>\${kdStr(p.kills, p.deaths)}</div></div>
          <div class='csgo-metric'><div class='k'>HS%</div><div class='v'>\${hsPct}%</div></div>
          <div class='csgo-metric'><div class='k'>Win %</div><div class='v'>\${winPct}%</div></div>
          <div class='csgo-metric'><div class='k'>MVPs</div><div class='v'>\${fmt(p.mvps)}</div></div>
          <div class='csgo-metric'><div class='k'>Frags</div><div class='v'>\${fmt(p.kills)}</div></div>
        </div>
      </div>
    </div>
    <div class='csgo-hud-bottom'>
      <div class='card' style='margin:0;'>
        <div class='h2'>BATTLE PASS</div>
        <div style='font-family:var(--font-heading);font-size:16px;font-weight:800;color:#fff;margin-bottom:6px;'>\${esc(rp.curName)}</div>
        <div class='bar'><div style='width:\${rp.progressPct}%'></div></div>
        <p class='muted' style='margin-top:8px;'>Season \${esc(p.comp_season)}</p>
      </div>
      <div class='card' style='margin:0;'>
        <div class='h2'>ACTIVE MISSIONS</div>
        <div class='muted'>\${fmt(p.bp_daily_kills)} / 15 daily kills · \${fmt(p.bp_daily_hs)} / 3 HS · \${fmt(p.bp_weekly_kills)} / 100 weekly</div>
      </div>
      <div class='card' style='margin:0;'>
        <div class='h2'>WEAPON MASTERY</div>
        \${weaponCards()}
      </div>
    </div>
  </div>
  <div style='display:flex;justify-content:space-between;align-items:center;padding:14px 4px;font-size:11px;color:var(--text-dim);'>
    <div style='display:flex;align-items:center;gap:8px;'><img class='brand-logo-img' src='\${logoUri}' alt='FreeNova' width='28' height='28'><span>Free<span style='color:var(--cyan);'>Nova</span></span></div>
    <div>\${fmt(unlockedN)} / \${items.length} medals · \${unlockPct}%</div>
  </div>\`

`
s = s.slice(0, start) + inner + s.slice(end)
writeFileSync(p, s)
console.log("patched inspect body, length", s.length)
