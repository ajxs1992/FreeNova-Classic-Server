# Page kit — how a v2 page is built so several agents can work at once

Five agents build pages in parallel against the owner's plates. To make that
possible without fighting over files, every page is a **module in its own two
files**, plus a **crop request**. Nothing else is edited by a page agent.

## The contract

```
web-panel/src/v2/pages/<key>.js      the page: meta + render(ctx)
web-panel/src/v2/data/<key>.js       the data adapter: async load(ctx)
web-panel/assets/winter/ref/requests/<key>.txt   the crops this page needs
```

`pages/<key>.js`:

```js
export const meta = {
  key: "profile",            // url segment: /v2/profile
  title: "Profile",
  nav: "player",             // player | progression | events | rewards
  sub: "Christmas frames, badges & tree",
  icon: "profile",           // /winter/ref/icons/<icon>.png
  plate: "02-profile.png"    // the owner's reference this page reproduces
}
export function render(ctx) { return `<!doctype html>…` }   // or an HTML fragment
```

`data/<key>.js` exports `async function load(ctx)` returning a plain object; it
must return **real values or explicit nulls** — never invented numbers.

`ctx` gives: `player` (or null), `season`, `db` (the read-only query helpers),
`esc/fmt/num`, and `components` (the shared kit: `card`, `statRow`, `table`,
`tabBar`, `progress`, `tile`, `pill`, `empty`).

## The registry is automatic
`src/v2/index.js` globs `pages/*.js`, reads `meta`, and routes `/v2/<key>` — plus
`/v2/` for the dashboard. **A page agent never edits the router, the shell, the
theme or `components.js`.** If the kit is missing something, ask the shell owner
(design agent) for it and use a plain element until it lands.

## Art: request, do not invent
Nothing is generated. A page uses only rectangles cut from the owner's plates.
To get one, write a line in `requests/<key>.txt`:

```
# name                 source plate        x    y     w    h     note
hero-band             01-dashboard.png    308   99  1345  284   background, no crop
tree-card             01-dashboard.png    330  560   168  252   shadow included
```

`tools/art/slice_refs.py` reads every request file, cuts at native size into
`assets/winter/ref/<name>.png` (served as `/winter/ref/<name>.png`) and records
it in `ref/MANIFEST.json`. Never upscale; if the plate's region is smaller than
the slot, size the slot to the region. If the plate has no such element, say so
in the request file as `# NOT IN PLATE: <what>` and build the page without it.

## The rules a page keeps
1. It reproduces its plate: same layout, same boxes, same spacing, same colours
   sampled from the plate. Data replaces the plate's sample values.
2. Real data or an explicit empty state; no placeholder numbers, ever.
3. JS off: the page still renders (SSR), links still work.
4. Fixed icon sizes per context: nav 22, chips 26, cards 32, rows 24, tiles 64.
5. `node test_harness.mjs` stays green, with a check per new page.
6. No link to a route that does not exist.
