// Shared frame for the Winterfest family at /v2/winter/*.
//
// Every page in the family is: the shell (rail + top bar from ../shell.js), a
// Winterfest tab strip, one illustrated hero band, then the page's own cards.
// The data comes from ../../data/winter.js (the old pages' loaders, reused) —
// nothing here reads or writes anything.
import { esc } from "../../theme.js"
import { icon } from "../../icons.js"
import { page } from "../../shell.js"
import { WINTER_TABS, chipsOf, playerOf } from "../../data/winter.js"

const SKIN_MARK = '<meta name="robots" content="noindex"><!-- wf-winter-skin: this page owns the Winterfest palette; the seasonal skin must not repaint it (winter/skin.js keys its idempotency guard on this marker). -->'

/** The 8-page strip under the top bar. */
export function winterTabs(active) {
  return `<nav class="v2w-tabs" aria-label="Winterfest pages">${WINTER_TABS.map(t => {
    const on = t.key === active
    return `<a class="v2w-tab${on ? " on" : ""}" href="${esc(t.href)}"${on ? ' aria-current="page"' : ""}>${esc(t.label)}</a>`
  }).join("")}</nav>`
}

/**
 * The illustrated hero band. `artLeft`/`artRight` are cropped illustrations
 * from the owner's reference (assets/winter/), drawn at or below their native
 * size so nothing is upscaled.
 */
export function winterHero({ title, sub, badge, artLeft, artRight, artAlt = "" }) {
  const left = artLeft
    ? `<img class="v2w-art l" src="${esc(artLeft.src)}" width="${artLeft.w}" height="${artLeft.h}" alt="" aria-hidden="true">`
    : ""
  const right = artRight
    ? `<img class="v2w-art r" src="${esc(artRight.src)}" width="${artRight.w}" height="${artRight.h}" alt="" aria-hidden="true">`
    : ""
  return `<section class="v2w-hero"${artAlt ? ` aria-label="${esc(artAlt)}"` : ""}>
  ${left}${right}
  <div class="v2w-mid">
    <h1 class="v2w-title">${esc(title)}</h1>
    ${sub ? `<p class="v2w-ribbon">${esc(sub)}</p>` : ""}
  </div>
  ${badge ? `<span class="v2w-badge">${badge}</span>` : ""}
</section>`
}

/** A page in the family. */
export function winterPage({ title, active, tab, ctx, content, extraCss = "", script = "" }) {
  return page({
    title: `${title} · ${ctx.season.name || "Winterfest"} — FreeNova`,
    active,
    season: ctx.season,
    player: playerOf(ctx),
    chips: chipsOf(ctx),
    bell: { unread: 0, href: "/v2/winter/mail" },
    content: `${winterTabs(tab)}
${content}`,
    script,
    head: `<style>${WINTER_CSS}${extraCss}</style>`,
    meta: SKIN_MARK
  })
}

export const WINTER_CSS = `
/* ------------------------------------------------------------------ tabs --- */
.v2w-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 2px}
.v2w-tab{padding:5px 13px;border-radius:999px;font-size:12.5px;font-weight:700;letter-spacing:.2px;
  color:#c5d2f2;background:rgba(27,36,74,.72);border:1px solid var(--v2-border);text-decoration:none;
  transition:background .15s,border-color .15s,color .15s}
.v2w-tab:hover{background:rgba(46,58,110,.9);color:#eef2ff;text-decoration:none}
.v2w-tab.on{color:#fff;background:linear-gradient(180deg,#6c46c9,#4b2d9c);border-color:#9a7be8;
  box-shadow:0 6px 16px rgba(92,58,190,.45), inset 0 1px 0 rgba(220,210,255,.35)}

/* ------------------------------------------------------------------ hero --- */
.v2w-hero{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--v2-border);
  height:clamp(124px,19vh,158px);
  background:
    radial-gradient(70% 120% at 18% 120%, rgba(28,52,120,.85) 0%, rgba(28,52,120,0) 60%),
    radial-gradient(60% 120% at 82% 120%, rgba(38,70,140,.7) 0%, rgba(38,70,140,0) 62%),
    linear-gradient(180deg,#0d1440 0%, #0a1030 55%, #080d28 100%);
  box-shadow:0 16px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(160,190,255,.16);isolate:isolate}
/* snow dots + a soft glow behind the title, drawn in CSS: no request */
.v2w-hero::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:radial-gradient(circle 1.6px at 50% 50%, #dcebff 0 40%, rgba(220,235,255,0) 70%);
  background-size:54px 46px;mix-blend-mode:screen}
.v2w-hero::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg, rgba(8,12,36,.55) 0%, rgba(8,12,36,0) 26%, rgba(8,12,36,0) 74%, rgba(8,12,36,.55) 100%)}
.v2w-art{position:absolute;bottom:-8px;height:calc(100% - 6px);width:auto;max-width:none;z-index:1;
  pointer-events:none;filter:drop-shadow(0 10px 18px rgba(0,0,0,.45))}
.v2w-art.l{left:-14px}
.v2w-art.r{right:-18px}
.v2w-mid{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;align-items:center;
  justify-content:center;text-align:center;padding:8px 170px}
.v2w-title{margin:0;font-size:clamp(24px,3.1vw,42px);font-weight:800;letter-spacing:.4px;line-height:1.02;
  color:#f9fbff;text-shadow:0 3px 0 #3b2a63, 0 8px 22px rgba(0,0,0,.8), 0 0 26px rgba(180,200,255,.35)}
.v2w-ribbon{position:relative;margin:6px 0 0;padding:1px 34px;
  font-size:clamp(11.5px,1.05vw,15px);font-weight:800;letter-spacing:.4px;color:#fff;
  background:linear-gradient(180deg,#e64a4a 0%, #c81f22 52%, #a3100f 100%);
  border-top:2px solid #f0908f;border-bottom:2px solid #7c0d0d;border-radius:3px;
  clip-path:polygon(0 0,100% 0,96.5% 50%,100% 100%,0 100%,3.5% 50%);
  box-shadow:0 8px 20px rgba(160,16,16,.4);text-shadow:0 1px 2px rgba(80,0,0,.7)}
.v2w-badge{position:absolute;z-index:3;right:14px;top:12px;display:inline-flex;align-items:center;gap:7px;
  padding:5px 12px;border-radius:12px;font-size:12px;font-weight:800;color:#e8eeff;
  background:linear-gradient(180deg,rgba(52,40,120,.92),rgba(26,20,66,.94));border:1px solid #6a5bb0;
  box-shadow:0 8px 18px rgba(0,0,0,.4)}
.v2w-badge b{color:#ffe08a}

/* --------------------------------------------------------------- calendar ---- */
.v2w-cal{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}
.v2w-cal.eight{grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
.v2w-cal.eight .v2w-day{min-height:74px;padding:8px 9px 7px}
.v2w-cal.eight .v2w-day .n{font-size:18px}
.v2w-cal.eight .v2w-day .r{font-size:10.5px}
.v2w-day{position:relative;display:flex;flex-direction:column;gap:2px;padding:9px 10px 8px;border-radius:13px;
  background:linear-gradient(180deg,#141d44 0%, #0d1434 100%);border:1px solid var(--v2-border);min-height:86px}
.v2w-day .n{font-size:20px;font-weight:800;line-height:1;color:#eef2ff;letter-spacing:.3px}
.v2w-day .dt{font-size:10.5px;font-weight:700;color:#8c9cc4;letter-spacing:.4px;text-transform:uppercase}
.v2w-day .r{margin-top:auto;font-size:11.5px;font-weight:700;color:#cfdaf5;line-height:1.2}
.v2w-day .st{position:absolute;right:8px;top:8px;line-height:0;opacity:.95}
.v2w-day.claimed{border-color:#2f7d55;background:linear-gradient(180deg,#14351f 0%, #0c2416 100%)}
.v2w-day.claimed .n{color:#8ef0b4}
.v2w-day.claimed .r{color:#a9e3c1}
.v2w-day.today{border-color:#e0b445;background:linear-gradient(180deg,#3a2a0c 0%, #241708 100%);
  box-shadow:0 0 0 1px rgba(240,200,90,.35), 0 10px 22px rgba(150,110,10,.25)}
.v2w-day.today .n{color:#ffe08a}
.v2w-day.today .r{color:#ffe9b0}
.v2w-day.expired{border-color:#5a2b34;background:linear-gradient(180deg,#22141a 0%, #170d12 100%)}
.v2w-day.expired .n{color:#a98b93}
.v2w-day.expired .r{color:#c48d97}
.v2w-day.locked{opacity:.72}
.v2w-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:11.5px;color:#a6b4d6}
.v2w-legend span{display:inline-flex;align-items:center;gap:6px}
.v2w-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;border:1px solid #3a4870}
.v2w-legend .c i{background:#14351f;border-color:#2f7d55}
.v2w-legend .t i{background:#3a2a0c;border-color:#e0b445}
.v2w-legend .e i{background:#22141a;border-color:#5a2b34}
.v2w-legend .l i{background:#101838;border-color:#2a3d6e}

/* --------------------------------------------------------------- timeline ---- */
.v2w-tl{display:flex;flex-direction:column;gap:6px;max-height:230px;overflow:auto;padding-right:2px}
.v2w-tlrow{display:grid;grid-template-columns:20px 1fr auto;gap:8px;align-items:center;
  padding:6px 8px;border-radius:10px;background:rgba(18,26,58,.6);border:1px solid #22305e;font-size:12px}
.v2w-tlrow .d{font-weight:800;color:#eaf0ff;white-space:nowrap}
.v2w-tlrow .d small{display:block;font-size:10px;font-weight:700;color:#8c9cc4;letter-spacing:.3px}
.v2w-tlrow .r{color:#cfdaf5;font-weight:700;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v2w-tlrow.claimed{border-color:#2f7d55;background:rgba(18,52,32,.55)}
.v2w-tlrow.today{border-color:#e0b445;background:rgba(58,42,12,.6)}
.v2w-tlrow.expired{opacity:.75}
.v2w-tlrow.locked{opacity:.6}

/* ------------------------------------------------------------------- misc ---- */
.v2w-pass{display:grid;gap:8px}
.v2w-pass-art{display:flex;align-items:center;gap:10px}
.v2w-pass-art img{filter:drop-shadow(0 6px 12px rgba(0,0,0,.5))}
.v2w-pass ul{margin:0;padding:0;list-style:none;display:grid;gap:5px;font-size:12px;color:#cfdaf5}
.v2w-pass li{display:flex;gap:7px;align-items:flex-start}
.v2w-pass li svg{flex:none;margin-top:1px}
.v2w-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:9px 12px;border-radius:12px;
  font-weight:800;font-size:13px;color:#3a2408;background:linear-gradient(180deg,#ffd77a,#e8a92c);
  border:1px solid #ffe6a8;box-shadow:0 10px 22px rgba(180,130,10,.35);text-decoration:none}
.v2w-cta[aria-disabled="true"]{color:#d8c39a;background:linear-gradient(180deg,#2a3358,#1b2242);
  border:1px solid #45517e;box-shadow:none;cursor:not-allowed}
.v2w-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(10px,1.1vw,18px)}
.v2w-note{margin:0;font-size:12px;line-height:1.5;color:#a6b4d6}
.v2w-big{margin:0 0 6px;font-size:19px;font-weight:800;color:#eef2ff;letter-spacing:.2px}
.v2w-big span{font-size:12.5px;font-weight:700;color:#9fb0d0}
.v2w-progress{display:grid;gap:8px}
.v2w-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,358px);gap:clamp(10px,1.1vw,18px);align-items:start}
@media (max-width:1180px){
  .v2w-cols{grid-template-columns:minmax(0,1fr)}
  .v2w-cal{grid-template-columns:repeat(4,minmax(0,1fr))}
  .v2w-mid{padding:8px 120px}
}
@media (max-width:820px){
  .v2w-cal{grid-template-columns:repeat(3,minmax(0,1fr))}
  .v2w-strip{grid-template-columns:minmax(0,1fr)}
  .v2w-art{display:none}
  .v2w-mid{padding:8px 12px}
  .v2w-badge{display:none}
}
`
