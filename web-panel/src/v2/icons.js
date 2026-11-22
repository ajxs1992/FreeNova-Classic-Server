// Inline SVG icon set for the v2 shell.
//
// Rule from the design doc: icons are rebuilt as inline SVG, never cropped out
// of the 2x reference screenshot — they are crisp at any size, cost no request
// and take the palette. Every icon is drawn on a 24x24 grid, `currentColor`
// where the colour is the surrounding text's, a literal palette colour where
// the reference shows art (gold coins, a brown gingerbread man, a red die).
//
// Usage:  ${icon("coins", 22)}                 -> decorative (aria-hidden)
//         ${icon("bell", 22, { label: "…" })}  -> labelled, role="img"

import { PALETTE } from "./theme.js"

const P = PALETTE

const wrap = (body, size, opts) => {
  const o = opts || {}
  const a11y = o.label
    ? ` role="img" aria-label="${String(o.label).replace(/"/g, "&quot;")}"`
    : ` aria-hidden="true" focusable="false"`
  const cls = o.cls ? ` class="${o.cls}"` : ""
  const style = o.style ? ` style="${o.style}"` : ""
  return `<svg viewBox="0 0 24 24" width="${size || 24}" height="${size || 24}"${cls}${style}${a11y}>${body}</svg>`
}

const ICONS = {
  // ------------------------------------------------------------- calendar state
  // Four glyphs the Winterfest pages need: a day you can still open, one you
  // cannot, a confirmed claim, and the mystery box that stays hidden until it is.
  lock: () => `
    <rect x="5" y="10.4" width="14" height="9.6" rx="2" fill="#8ea0c8" stroke="#3a4870" stroke-width="1.1"/>
    <path d="M8.4 10.4V8.2a3.6 3.6 0 0 1 7.2 0v2.2" fill="none" stroke="${P.gold}" stroke-width="1.8"/>
    <circle cx="12" cy="15" r="1.5" fill="#2a3557"/>`,
  unlock: () => `
    <rect x="5" y="10.4" width="14" height="9.6" rx="2" fill="${P.gold}" stroke="#8a5a2b" stroke-width="1.1"/>
    <path d="M8.4 10.4V8.2a3.6 3.6 0 0 1 7-1.3" fill="none" stroke="${P.gold}" stroke-width="1.8"/>
    <circle cx="12" cy="15" r="1.5" fill="#5a3b12"/>`,
  check: () => `
    <circle cx="12" cy="12" r="9" fill="${P.greenDeep}"/>
    <path d="m7.6 12.4 3 3 5.8-6.2" fill="none" stroke="#d8ffe6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  question: () => `
    <path d="M5 4h14l-1.6 16H6.6z" fill="#2b3566" stroke="#5f6f9e" stroke-width="1.1"/>
    <text x="12" y="17.4" text-anchor="middle" font-size="11" font-weight="700" fill="#c9d6f5">?</text>`,
  expired: () => `
    <circle cx="12" cy="12" r="9" fill="#3a2431"/>
    <path d="m8.4 8.4 7.2 7.2M15.6 8.4l-7.2 7.2" fill="none" stroke="#e0808f" stroke-width="2" stroke-linecap="round"/>`,

  // ---------------------------------------------------------------- navigation
  dashboard: () => `
    <path d="M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.6v-5.4H9.6V21H5a1 1 0 0 1-1-1z" fill="#f6d9a0" stroke="#8a5a2b" stroke-width="1.1"/>
    <path d="M9.6 21v-5.4h4.8V21z" fill="${P.greenDeep}"/>
    <path d="M2.6 11.6 12 3.2l9.4 8.4" fill="none" stroke="#eef2ff" stroke-width="1.6" stroke-linecap="round"/>`,
  profile: () => `
    <rect x="3" y="4.5" width="18" height="15" rx="2.4" fill="#cfd9f5" stroke="#5c6c9d" stroke-width="1.1"/>
    <circle cx="9" cy="10.4" r="2.6" fill="${P.ice}"/>
    <path d="M5.4 16.4c.7-2.1 2-3 3.6-3s2.9.9 3.6 3z" fill="${P.ice}"/>
    <rect x="14" y="8.6" width="4.6" height="1.5" rx=".7" fill="#7d8ab5"/>
    <rect x="14" y="11.4" width="4.6" height="1.5" rx=".7" fill="#7d8ab5"/>`,
  stats: () => `
    <rect x="4" y="12" width="4" height="8" rx="1" fill="${P.iceAlt}"/>
    <rect x="10" y="7" width="4" height="13" rx="1" fill="${P.gold}"/>
    <rect x="16" y="3.6" width="4" height="16.4" rx="1" fill="${P.greenAlt}"/>
    <path d="M3 21h18" stroke="#5c6c9d" stroke-width="1.3" stroke-linecap="round"/>`,
  trophy: () => `
    <path d="M7 4h10v4.6a5 5 0 0 1-10 0z" fill="${P.gold}" stroke="#a9791b" stroke-width="1"/>
    <path d="M7 5.4H4.6v1.8c0 1.7 1.2 2.8 2.6 2.9M17 5.4h2.4v1.8c0 1.7-1.2 2.8-2.6 2.9" fill="none" stroke="${P.gold}" stroke-width="1.3"/>
    <rect x="10.6" y="13.4" width="2.8" height="3.4" fill="#a9791b"/>
    <rect x="7.6" y="16.8" width="8.8" height="3.4" rx="1" fill="${P.gold}" stroke="#a9791b" stroke-width="1"/>`,
  flag: () => `
    <path d="M7 3.4v17" stroke="#cfd9f5" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 4.6h9.4l-2.2 3.9 2.2 3.9H8z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <circle cx="7" cy="20.4" r="1.5" fill="${P.gold}"/>`,
  missions: () => `
    <rect x="4.6" y="4.4" width="14.8" height="16.2" rx="2.2" fill="#e7eefc" stroke="#5c6c9d" stroke-width="1.1"/>
    <rect x="8.4" y="2.8" width="7.2" height="3.6" rx="1.4" fill="${P.gold}" stroke="#a9791b" stroke-width=".9"/>
    <path d="M8.4 12.6l2.2 2.2 4.6-4.6" fill="none" stroke="${P.redAlt}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  medal: () => `
    <path d="M8.4 3.2 12 8.4l3.6-5.2z" fill="${P.redAlt}"/>
    <circle cx="12" cy="14.4" r="6" fill="${P.gold}" stroke="#a9791b" stroke-width="1.1"/>
    <circle cx="12" cy="14.4" r="3.4" fill="none" stroke="#a9791b" stroke-width="1"/>
    <path d="M8.2 4.2 12 9.6l3.8-5.4" fill="none" stroke="#7d1414" stroke-width="1.1"/>`,
  levels: () => `
    <path d="M12 3.4 19 11h-4.2v6.4H9.2V11H5z" fill="${P.gold}" stroke="#a9791b" stroke-width="1.1" stroke-linejoin="round"/>
    <rect x="7" y="19" width="10" height="2.4" rx="1.2" fill="${P.goldAlt}"/>`,
  events: () => `
    <rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4" fill="#e7eefc" stroke="#5c6c9d" stroke-width="1.1"/>
    <path d="M3.6 9.6h16.8" stroke="#a8b5d8" stroke-width="1.1"/>
    <path d="M7.6 3.2v3.6M16.4 3.2v3.6" stroke="${P.redAlt}" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="9" cy="13.4" r="1.2" fill="${P.ice}"/><circle cx="12" cy="13.4" r="1.2" fill="${P.ice}"/>
    <circle cx="15" cy="13.4" r="1.2" fill="${P.ice}"/><circle cx="9" cy="16.6" r="1.2" fill="${P.ice}"/>`,
  advent: () => `
    <rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4" fill="#f6f8ff" stroke="#a33" stroke-width="1.4"/>
    <path d="M3.6 9.6h16.8" stroke="#a33" stroke-width="1.4"/>
    <path d="M7.6 3.2v3.6M16.4 3.2v3.6" stroke="#a33" stroke-width="1.8" stroke-linecap="round"/>
    <text x="12" y="17.6" font-family="inherit" font-size="8.4" font-weight="700" text-anchor="middle" fill="#8c1d1d">24</text>`,
  wheel: () => `
    <circle cx="12" cy="12" r="8.6" fill="#2a1f6b" stroke="${P.gold}" stroke-width="1.6"/>
    <path d="M12 3.4v17.2M3.4 12h17.2M5.9 5.9l12.2 12.2M18.1 5.9 5.9 18.1" stroke="${P.redAlt}" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="2" fill="${P.gold}"/>`,
  crown: () => `
    <path d="M4 8.2 7.6 12 12 5.4 16.4 12 20 8.2V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="${P.gold}" stroke="#a9791b" stroke-width="1.1" stroke-linejoin="round"/>
    <circle cx="12" cy="13.6" r="1.5" fill="${P.redAlt}"/>`,
  shop: () => `
    <path d="M4 9.6h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="#f0e2c8" stroke="#8a5a2b" stroke-width="1.1"/>
    <path d="M3.4 9.6 5 5h14l1.6 4.6z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <path d="M7 9.6v10.4M11 9.6v10.4M15 9.6v10.4" stroke="${P.redBright}" stroke-width="1.2"/>
    <rect x="9.4" y="14" width="5.2" height="6" rx="1" fill="#b98a4f"/>`,
  gear: () => `
    <path d="M12 3.6l1.5.3.6 2 1.6.7 1.8-1 1.9 1.9-1 1.8.7 1.6 2 .6.3 1.5-.3 1.5-2 .6-.7 1.6 1 1.8-1.9 1.9-1.8-1-1.6.7-.6 2-1.5.3-1.5-.3-.6-2-1.6-.7-1.8 1-1.9-1.9 1-1.8-.7-1.6-2-.6-.3-1.5.3-1.5 2-.6.7-1.6-1-1.8 1.9-1.9 1.8 1 1.6-.7.6-2z" fill="#c9d3ea" stroke="#5c6c9d" stroke-width="1"/>
    <circle cx="12" cy="12" r="3.2" fill="#5c6c9d"/>`,

  // ---------------------------------------------------------------- top bar
  coins: () => `
    <ellipse cx="12" cy="7.4" rx="7" ry="2.8" fill="${P.goldAlt}" stroke="#a9791b" stroke-width="1"/>
    <path d="M5 7.4v4.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V7.4" fill="${P.gold}" stroke="#a9791b" stroke-width="1"/>
    <path d="M5 11.8v4.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-4.4" fill="${P.goldAlt}" stroke="#a9791b" stroke-width="1"/>`,
  gingerbread: () => `
    <circle cx="12" cy="6.4" r="3.1" fill="#b4713a" stroke="#7a4419" stroke-width="1"/>
    <path d="M9.2 9.8h5.6l-.5 5.4h-4.6z" fill="#b4713a" stroke="#7a4419" stroke-width="1"/>
    <path d="M9.4 10.6 6.2 13.4M14.6 10.6l3.2 2.8M10.4 15.2 8.6 20M13.6 15.2l1.8 4.8" stroke="#b4713a" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="10.9" cy="5.8" r=".7" fill="#3a1c06"/><circle cx="13.1" cy="5.8" r=".7" fill="#3a1c06"/>
    <circle cx="12" cy="11.8" r=".7" fill="#f7e6cf"/><circle cx="12" cy="13.8" r=".7" fill="#f7e6cf"/>`,
  dice: () => `
    <rect x="3.2" y="6" width="10.4" height="10.4" rx="2.2" fill="#e8eef8" stroke="#8d99bb" stroke-width="1" transform="rotate(-8 8.4 11.2)"/>
    <rect x="11.6" y="9" width="9.2" height="9.2" rx="2.2" fill="${P.redAlt}" stroke="#8c1515" stroke-width="1" transform="rotate(10 16.2 13.6)"/>
    <circle cx="6.4" cy="9.4" r="1.1" fill="${P.redAlt}"/><circle cx="10.4" cy="13.4" r="1.1" fill="${P.redAlt}"/>
    <circle cx="14.6" cy="12.4" r="1" fill="#fff"/><circle cx="18" cy="14.6" r="1" fill="#fff"/>`,
  bell: () => `
    <path d="M12 3.4a5.6 5.6 0 0 0-5.6 5.6c0 4.2-1.4 5.4-1.4 5.4h14s-1.4-1.2-1.4-5.4A5.6 5.6 0 0 0 12 3.4z" fill="#cfd9f5" stroke="#5c6c9d" stroke-width="1.1"/>
    <path d="M9.6 17.4a2.4 2.4 0 0 0 4.8 0z" fill="#9fabc9"/>`,
  envelope: () => `
    <rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2" fill="#dfe7f7" stroke="#5c6c9d" stroke-width="1.1"/>
    <path d="M3.4 6.6 12 13.2l8.6-6.6" fill="none" stroke="#5c6c9d" stroke-width="1.3"/>`,
  chevron: () => `<path d="M6.6 9.4 12 14.6l5.4-5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  plus: () => `<path d="M12 5.6v12.8M5.6 12h12.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  arrow: () => `<path d="M4.4 12h14.4M13.4 6.6 19.2 12l-5.8 5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  clock: () => `
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 7.4V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,

  // ---------------------------------------------------------------- content
  tree: () => `
    <path d="M12 2.6l.9 1.9 2.1.2-1.6 1.4.5 2-1.9-1.1-1.9 1.1.5-2-1.6-1.4 2.1-.2z" fill="${P.gold}"/>
    <path d="M12 6.6 7.6 13h8.8z" fill="#2f8f52"/>
    <path d="M12 10 6 17.6h12z" fill="#37a35e"/>
    <path d="M12 13.4 4.6 21h14.8z" fill="#2f8f52"/>
    <circle cx="10.2" cy="15.4" r="1" fill="${P.redAlt}"/><circle cx="13.8" cy="15.4" r="1" fill="${P.redAlt}"/>
    <circle cx="12" cy="18.4" r="1" fill="${P.gold}"/>`,
  confetti: () => `
    <path d="M5.2 19.4 9.6 8.6l5.8 5.8z" fill="${P.gold}" stroke="#a9791b" stroke-width="1"/>
    <circle cx="16.4" cy="6.4" r="1.5" fill="${P.redAlt}"/><circle cx="19.4" cy="10.6" r="1.3" fill="${P.greenAlt}"/>
    <circle cx="14" cy="4.4" r="1.1" fill="${P.iceAlt}"/><circle cx="20.2" cy="14.4" r="1.2" fill="${P.gold}"/>`,
  gift: () => `
    <rect x="4" y="10.4" width="16" height="9.6" rx="1.6" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <rect x="3.2" y="7" width="17.6" height="3.8" rx="1.2" fill="${P.redBright}" stroke="#7d1414" stroke-width="1"/>
    <path d="M12 7v13" stroke="${P.gold}" stroke-width="2"/>
    <path d="M12 7C10 3.4 6.4 2.8 6.6 4.9c.2 1.8 3 2.1 5.4 2.1zM12 7c2-3.6 5.6-4.2 5.4-2.1-.2 1.8-3 2.1-5.4 2.1z" fill="${P.gold}" stroke="#a9791b" stroke-width="1"/>`,
  bauble: () => `
    <circle cx="12" cy="13.4" r="6.6" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1.1"/>
    <path d="M9.4 10.6a3.6 3.6 0 0 1 2.4-1.6" fill="none" stroke="#ffd7d7" stroke-width="1.4" stroke-linecap="round"/>
    <rect x="10.4" y="3.6" width="3.2" height="3" rx="1" fill="${P.gold}"/>`,
  star: () => `
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6-5.5-3-5.5 3 1.2-6L3.2 9.6l6.1-.8z" fill="${P.gold}" stroke="#a9791b" stroke-width="1" stroke-linejoin="round"/>`,
  snowflake: () => `
    <g stroke="${P.iceAlt}" stroke-width="1.7" stroke-linecap="round" fill="none">
      <path d="M12 2.6v18.8M3.9 7.3l16.2 9.4M20.1 7.3 3.9 16.7"/>
      <path d="M12 6.2 9.4 3.8M12 6.2l2.6-2.4M12 17.8l-2.6 2.4M12 17.8l2.6 2.4"/>
    </g>`,
  target: () => `
    <circle cx="11" cy="13" r="7.4" fill="none" stroke="${P.gold}" stroke-width="2"/>
    <circle cx="11" cy="13" r="3.6" fill="none" stroke="${P.redAlt}" stroke-width="2"/>
    <path d="M11 13 18.4 5.6M18.4 5.6h-3.6M18.4 5.6v3.6" fill="none" stroke="${P.redAlt}" stroke-width="1.8" stroke-linecap="round"/>`,
  rosette: () => `
    <path d="M8.4 14.4 6.6 21l5.4-2.4 5.4 2.4-1.8-6.6z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <circle cx="12" cy="9.6" r="6.4" fill="${P.gold}" stroke="#a9791b" stroke-width="1.1"/>
    <path d="M12 6.2l1.4 2.8 3.1.4-2.3 2.1.6 3-2.8-1.5-2.8 1.5.6-3-2.3-2.1 3.1-.4z" fill="#fff4d0"/>
    <path d="M8.4 14.4 6.6 21" stroke="#7d1414" stroke-width="1"/>`,
  shield: () => `
    <path d="M12 2.8 20 5.4v6.2c0 4.6-3.2 8.2-8 9.6-4.8-1.4-8-5-8-9.6V5.4z" fill="#c9d3ea" stroke="#5c6c9d" stroke-width="1.1"/>
    <path d="M12 6.6c2.6 0 4.2 1.6 4.2 3.6H7.8c0-2 1.6-3.6 4.2-3.6z" fill="${P.redAlt}"/>
    <circle cx="12" cy="5.4" r="1.4" fill="#f7f9ff"/>
    <path d="M8.4 12.4h7.2v2.2H8.4z" fill="#8c1d1d"/>`,
  grinch: () => `
    <path d="M4.4 20c0-4 3.4-7.4 7.6-7.4s7.6 3.4 7.6 7.4z" fill="#3f9a3f" stroke="#22601f" stroke-width="1"/>
    <ellipse cx="12" cy="10.4" rx="6.6" ry="4.8" fill="#57b64f" stroke="#22601f" stroke-width="1"/>
    <path d="M5.6 6.4c1-3 4-4.6 6.6-4.3 2.8.3 4.6 2 5.4 4.2-2.2-.6-3.8.3-4.6 1-1-.9-3.4-1.4-7.4-.9z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <circle cx="9.4" cy="10.2" r="1.3" fill="#f6e27a"/><circle cx="14.6" cy="10.2" r="1.3" fill="#f6e27a"/>
    <path d="M9.4 12.8c1.4 1.2 3.8 1.2 5.2 0" fill="none" stroke="#22601f" stroke-width="1.1"/>`,
  bow: () => `
    <path d="M12 12 5 8.4c-.9 2.6-.9 5.6 0 8.2zM12 12l7-3.6c.9 2.6.9 5.6 0 8.2z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <circle cx="12" cy="12.4" r="2" fill="${P.redBright}"/>`,
  cap: () => `
    <path d="M4.6 11.6c0-4 3.3-7.2 7.4-7.2 3.4 0 6.2 2.2 7.1 5.2l-2.4 2.4c-.4-2.6-2.4-4.4-4.9-4.4-2.8 0-5 2.2-5 5z" fill="${P.redAlt}" stroke="#7d1414" stroke-width="1"/>
    <circle cx="19.4" cy="7.2" r="1.8" fill="#fff"/>
    <rect x="3.6" y="10.6" width="16.8" height="3" rx="1.5" fill="#f7f9ff" stroke="#c3cbe4" stroke-width=".8"/>`
}

/**
 * One icon. Unknown names fall back to a snowflake rather than throwing:
 * a page must never fail to render because of a typo in a name.
 */
export function icon(name, size, opts) {
  const body = ICONS[name] || ICONS.snowflake
  return wrap(body(), size || 24, opts)
}

/** Every icon name, for the tests and the icon gallery page. */
export const ICON_NAMES = Object.keys(ICONS)

/** The decorative ❄ the reference uses as a bullet (text, not an image). */
export const FLAKE = "&#10052;"
