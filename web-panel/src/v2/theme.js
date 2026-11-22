// The v2 design system — tokens, type scale and the document frame.
//
// Everything here is sampled from the owner's reference
// (docs/design/refs/winterfest-dashboard.png, measured in
// docs/design/WINTERFEST-DASHBOARD.md) and is the single place a colour, a
// radius or a shadow is decided. Pages never write a raw hex: they use a
// component (components.js) or, at a push, a `--v2-*` custom property.
//
// Contract for every page built on this shell (docs/design/PANEL-REBUILD.md):
//   * server-rendered HTML; the page is complete with JavaScript disabled;
//   * no external request — no webfont, no CDN, no remote image. The only
//     images are local crops under assets/winter/ (see the design doc's
//     "as built" section for the list and their provenance);
//   * fluid: CSS grid with fr/share columns, so 1280 / 1672 / 1920 all lay out
//     from the same rules instead of three fixed pixel positions;
//   * contrast on the dark base: body text is #eef2ff on <= #141a4d (>= 12:1),
//     muted text is #9fb0d0 (>= 6.4:1), and no text sits on the hero art
//     without a shadow or a scrim.
//
// This module has no imports: it is the bottom of the dependency graph.

/** Palette, straight from the measured reference. */
export const PALETTE = {
  // page + surfaces
  base: "#0b1030",
  baseAlt: "#12143a",
  deepest: "#000020",
  rail: "#100d2d",
  railDeep: "#08061f",
  surface: "#0d1430",
  surfaceTop: "#16224a",
  border: "#2a3d6e",
  borderSoft: "#1e2b53",
  // text
  text: "#eef2ff",
  muted: "#9fb0d0",
  faint: "#7f8fb5",
  // accents
  red: "#c00000",
  redAlt: "#d62828",
  redBright: "#e33b3b",
  gold: "#f5c451",
  goldAlt: "#fdb102",
  green: "#3fbf6f",
  greenAlt: "#5ce08a",
  greenDeep: "#177a42",
  ice: "#4070c0",
  iceAlt: "#9be7ff",
  violet: "#302070",
  violetAlt: "#7c5cd6",
  violetDeep: "#231456"
}

/** The spacing scale (4 px base). */
export const SPACE = [0, 4, 8, 12, 16, 20, 24, 32, 40]

/** Radii: cards 16, chips 14, buttons 10, pills 999. */
export const RADIUS = { card: 16, chip: 14, button: 10, tile: 10, pill: 999 }

/**
 * The type stack. The reference uses a rounded geometric sans; nothing may be
 * fetched, so this is the best system match available on a desktop (Ubuntu and
 * Segoe UI are both humanist-rounded; DejaVu is the fallback).
 */
export const FONT = `"Segoe UI", Ubuntu, "Trebuchet MS", "DejaVu Sans", Verdana, Tahoma, sans-serif`

/** Escaping for everything that comes out of the database. */
export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** 12345 -> "12,345" (the reference groups thousands). */
export function fmt(n) {
  const v = Math.trunc(Number(n) || 0)
  return v.toLocaleString("en-US")
}

/** Percent of a target, clamped, integer. Zero target -> 0, never NaN. */
export function pct(current, target) {
  const t = Number(target) || 0
  if (t <= 0) return 0
  const p = Math.round((Math.max(0, Number(current) || 0) * 100) / t)
  return Math.max(0, Math.min(100, p))
}

/** Tokens as CSS custom properties — the only place these numbers are written. */
export const TOKENS_CSS = `
:root{
  --v2-base:${PALETTE.base}; --v2-base-alt:${PALETTE.baseAlt}; --v2-deepest:${PALETTE.deepest};
  --v2-rail:${PALETTE.rail}; --v2-rail-deep:${PALETTE.railDeep};
  --v2-surface:${PALETTE.surface}; --v2-surface-top:${PALETTE.surfaceTop};
  --v2-border:${PALETTE.border}; --v2-border-soft:${PALETTE.borderSoft};
  --v2-text:${PALETTE.text}; --v2-muted:${PALETTE.muted}; --v2-faint:${PALETTE.faint};
  --v2-red:${PALETTE.red}; --v2-red-alt:${PALETTE.redAlt}; --v2-red-bright:${PALETTE.redBright};
  --v2-gold:${PALETTE.gold}; --v2-gold-alt:${PALETTE.goldAlt};
  --v2-green:${PALETTE.green}; --v2-green-alt:${PALETTE.greenAlt}; --v2-green-deep:${PALETTE.greenDeep};
  --v2-ice:${PALETTE.ice}; --v2-ice-alt:${PALETTE.iceAlt};
  --v2-violet:${PALETTE.violet}; --v2-violet-alt:${PALETTE.violetAlt};
  --v2-font:${FONT};
  --v2-r-card:${RADIUS.card}px; --v2-r-chip:${RADIUS.chip}px; --v2-r-btn:${RADIUS.button}px;
  /* measured geometry: 293 px rail at 1672, 88 px top bar, 14 px gutter */
  --v2-rail-w:clamp(232px, 17.5vw, 300px);
  --v2-top-h:clamp(74px, 9.4vh, 92px);
  --v2-gutter:clamp(10px, 0.85vw, 14px);
  --v2-gap:clamp(10px, 0.95vw, 16px);
  --v2-hero-h:clamp(212px, 30.2vh, 300px);
}
`

/**
 * The reset + page background. `body` is the app grid: a fixed rail and a
 * content column. Pages put everything else inside `main`.
 */
export const RESET_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  min-height:100vh;
  font-family:var(--v2-font);
  font-size:14px; line-height:1.35;
  color:var(--v2-text);
  background:
    radial-gradient(1100px 620px at 8% -8%, #1b1f60 0%, rgba(27,31,96,0) 62%),
    radial-gradient(900px 560px at 102% -4%, #141a4d 0%, rgba(20,26,77,0) 58%),
    linear-gradient(180deg, var(--v2-base) 0%, #0a0d2a 58%, #05081f 100%);
  background-attachment:fixed;
}
a{color:var(--v2-ice-alt)}
a:hover{color:var(--v2-gold)}
img{max-width:100%;display:block}
h1,h2,h3,h4,p{margin:0}
:focus-visible{outline:2px solid var(--v2-gold);outline-offset:2px;border-radius:6px}
.v2-app{display:grid;grid-template-columns:var(--v2-rail-w) minmax(0,1fr);min-height:100vh}
.v2-col{display:flex;flex-direction:column;min-width:0}
/* 1379 = 1345 (the hero art's native width) + 14 + 20 px of gutter, so the
   hero band is never scaled up on a wide screen; below 1672 this is a no-op. */
.v2-main{display:grid;gap:var(--v2-gap);padding:var(--v2-gutter) calc(var(--v2-gutter) + 6px) 10px var(--v2-gutter);align-content:start;max-width:1379px;margin-inline:auto;width:100%}
.v2-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.v2-skip{position:absolute;left:-9999px;top:8px;z-index:20;background:var(--v2-gold);color:#2a1c00;
  padding:6px 12px;border-radius:8px;font-weight:700;text-decoration:none}
.v2-skip:focus{left:12px}
@media (max-width:900px){
  .v2-app{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important;animation:none !important}}
`

/** Join CSS blocks, dropping the empty ones. */
export function css(...blocks) {
  return blocks.filter(Boolean).map(s => String(s).trim()).join("\n")
}

/**
 * The document. One inline stylesheet, no scripts unless the page passes one
 * (the dashboard's countdown ticks are the only allowed case, and the page is
 * complete — and correct on load — without them).
 */
export function document({ title, css: sheet, body, head = "", script = "", meta = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta}
<style>${css(TOKENS_CSS, RESET_CSS, sheet)}</style>
${head}
</head>
<body>
${body}
${script}
</body>
</html>`
}
