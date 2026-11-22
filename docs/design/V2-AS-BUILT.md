# v2 as built — the dashboard, and what differs from the reference

**This is a diff, not a spec.** The numbers live in one place each:
`docs/design/SPEC-MATRIX.md` (the gallery agent's measurements, all 14 pages) and,
for this page, the measured geometry/palette already recorded in
`docs/design/WINTERFEST-DASHBOARD.md`. Nothing below re-derives them; it says
what the code does with them, where it deliberately differs, and what a reader
has to know to review it.

Built: `web-panel/src/v2/**` (shell, theme, components, icons, adapters, the
dashboard page), the seven cropped art files under `web-panel/assets/winter/`,
60-odd harness checks, and the renders in `docs/design/renders/`.

## Where it lives, and what it replaced

| | |
| --- | --- |
| route | `/v2` and `/v2/hub` (alias) → the dashboard. `/v2/<anything else>` is a 404. |
| live routes | **untouched.** `/`, `/hub` and every other path still serve the old panel. Nothing was cut over in this pass. |
| first cutover | `/` → this renderer, once the owner has seen it; then `/profile`. The page is the home screen by shape, so `/` is the natural first swap. |
| files | `src/v2/theme.js`, `icons.js`, `components.js`, `shell.js`, `index.js`, `data/dashboard.js`, `pages/dashboard.js` |
| shared edits | `src/index.js`: one dispatch line (`/v2…` → `handleV2`) plus `/winter/*.png` added to the static-asset gate. `src/winter/skin.js`: the idempotency guard returned an already-drained `Response`, which 500s any page that carries the marker — see "the skin" below. |

The page is server-rendered, has no client dependency, and the one `<script>`
(the countdown tick) is additive: with JavaScript disabled the same screenshot
differs by ~1 500 pixels of 1 573 352, and every one of them is a digit — the
four countdown cells and the two relative-time pills (`Ends in 2d 13h`,
`Starts in 13h 50m`), both of which the server re-renders on each request anyway
(`docs/design/renders/v2-dashboard-1672x941-nojs.png`).

## What matches the reference

Measured at 1672×941: 293 px rail, 88 px top bar, content from x≈307, hero
band 284 px with the lockup, red ribbon, subtitle and four-cell countdown, a
five-card stat strip, a three-card row at the reference's 452 / 407 / 435 split
with ~22 px gaps, then the four `Active Winterfest Events` cards with state
pills. 16 px card radii, 1 px `#2a3d6e` borders, the sampled palette, snow caps
and fairy-light dots on every card, the purple active nav pill with its glow,
the four ❄-bulleted group labels, `aria-current="page"` on the active item.

Contrast on the dark base (computed, WCAG): primary text 16.2:1, muted 8.3:1,
uppercase labels 5.6:1, green value 8.1:1, gold chip value 10.9:1, the active
nav subtitle 8.6:1.

## What deliberately differs, and why

| reference | as built | why |
| --- | --- | --- |
| 3-D painted icons for nav, chips, stat strip, reward rows | inline SVG from `icons.js`, 35 glyphs, baked palette colours | the brief's own rule: never crop 24 px icons out of a 2× screenshot, and they must take the accent colours. |
| the avatar is a photo | initials in a gold ring | no portrait exists anywhere in the panel; inventing one would be fake player data. |
| event cards carry painted art (Grinch, gift, Santa shield, roulette) | an inline-SVG glyph chosen from the event's real `type`/`title` (`eventGlyph`) | the cards show *live* events from the `events` table, so their art cannot be a fixed crop. A gift hunt gets a present, a boss fight gets the Grinch. |
| four reward tiles show AK-47 / gingerbread / snowflake / Santa hat | the same four cropped tiles, chosen from the reward's real *type*, over the real grant label | the ledger decides what the tile says; the crop set only decides the picture. Documented in `REWARD_ART`. |
| "Active Winterfest Events" has no extra affordance | same, no "all events" link | match the reference; the Events nav item is one click away. |
| the mock's numbers (24 500 coins, 68 %, 42/50, 12/6/4/3) | real values or `0` / "—" / an honest empty-state sentence | the owner's rule: never a demo value in the live page. |
| — | a `Data wiring` note at the bottom of the page | the owner's instruction #3: the page states which adapters are live (`12/12` on the fixture, `1/12` on an unseeded database). |

## The shell, for the next thirteen pages

`theme.js` holds the tokens (`--v2-*`), the reset and the document wrapper;
`icons.js` the glyph set; `components.js` the vocabulary — `card`, `cardHead`,
`currencyChip`, `statCard`, `bar`, `pill`, `countdown`, `groupLabel`,
`sectionHeading`, `emptyState`, `itemTile`, `counterTile`, `button`,
`dataTable`, `listRow`, `progressRow`, `devNote`; `shell.js` the rail (four
groups, active state, inert "not built yet" rows), the top bar and `page()`.

A page supplies **one content region** and its own CSS for that region — the
shell does not impose a grid, which is what lets the boards (a table) and the
profile (two columns) reuse it without a rebuild. Layout helpers a page may
borrow: `.v2-main` (a stack), `.v2-cols3` and `.v2-events` (this page's grids,
in `pages/dashboard.js`).

## Data adapters, and the shapes the game should push

Nothing new is stored and nothing is written. Reads: `players` (name, level,
coins), `winter_players`, `winter_tree`, `winter_ornaments`, `winter_advent`,
`winter_pass`, `winter_gifts`, `winter_meta`, `events`. Every read is
try/catch'd, so a database without the winter tables renders the zero state.

Four shapes are **not pushed by anyone yet**. They are `winter_meta` keys — the
table already exists, so no schema change is needed from any agent — and each
one is exported in code as `ADAPTER_CONTRACT` in `src/v2/data/dashboard.js`:

```jsonc
// winter_meta.key = 'spin'            Spins chip
{ "players": { "STEAM_0:0:1": { "spins": 3 } }, "global": { "spins": 0 } }

// winter_meta.key = 'contracts'       Missions chip + "3 / 10"
{ "players": { "STEAM_0:0:1": { "open": 3, "total": 10 } } }

// winter_meta.key = 'objectives'      the four Event Progress bars
{ "season": "2026",
  "counters": [ { "key": "gifts",     "label": "Collect Gifts",     "current": 42, "target": 50 },
                { "key": "ornaments", "label": "Find Ornaments",    "current": 18, "target": 30 },
                { "key": "missions",  "label": "Complete Missions", "current": 3,  "target": 10 },
                { "key": "matches",   "label": "Win Event Matches", "current": 12, "target": 25 } ] }

// winter_meta.key = 'announcements'   the bell's red dot
{ "items": [ { "id": "w1", "title": "Snowball fight tonight", "at": 1765000000, "unread": true } ] }
```

A missing key renders: Spins `0`, Missions `0` and `0 / 0`, four `—` progress
rows with a dashed track and "No objective counters yet", no red dot. The
`objectives` keys are matched by `key`, so the game may label them differently;
unknown keys are ignored rather than rendered.

Everything else is live today: `winter_players.snowflakes` is the GingerBread
chip (owner decision 2026-11-22), `winter_pass.tier` the Battle Pass stat,
`winter_tree` + the catalogue's 24 slots the tree percentage and the four
ornament tallies, the `winter_gifts` ledger the four Recent Rewards tiles,
`events` the pill row (`Active Now` / `Ends in …` / `Starts in …` / `Active` /
`Ended`), `winter_meta.season` (or `meta winter.*`, or the documented 1–24 Dec
default) the lockup, subtitle and countdown.

## The skin

`src/winter/skin.js` repaints every HTML response in December. This page draws
its own Winterfest palette, so it must not be repainted twice; it carries the
skin's own marker string in a `<head>` comment and the guard skips it. That
exposed a bug in the guard: it returned the `Response` it had just drained with
`res.text()`, so any marked page 500'd with "Body is unusable". Fixed to return
a fresh response with the same body, and the harness now checks both halves
(the dashboard is stable with the season open; `/rules` still gets recoloured).

## Reproducing the renders

The local panel is `http://127.0.0.1:18101` — the same port `scripts/wf-local.sh`
uses when it lands; until then it is `server_local.mjs` against a throwaway copy
of the database. Nothing in the code hard-codes a host or a port (every link is
relative), so pointing a browser at that base is the only step.

```sh
# 1. a throwaway copy of the database — never the live file
mkdir -p /tmp/v2test && cp web-panel/data/freenova_panel.sq3* /tmp/v2test/
cd web-panel && PORT=18101 HOST=127.0.0.1 PANEL_DB=/tmp/v2test/freenova_panel.sq3 \
  node server_local.mjs &

# 2. the screenshots (BASE is the local panel)
BASE=http://127.0.0.1:18101
brave --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1672,941 --screenshot=../docs/design/renders/v2-dashboard-1672x941-empty-state.png \
  "$BASE/v2?steamid=STEAM_0:0:683671116"
brave --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1280,800 --screenshot=../docs/design/renders/v2-dashboard-1280x800.png \
  "$BASE/v2?steamid=STEAM_0:0:683671116"
# and the JS-off render
brave --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --blink-settings=scriptEnabled=false --window-size=1672,941 \
  --screenshot=../docs/design/renders/v2-dashboard-1672x941-nojs.png "$BASE/v2?steamid=STEAM_0:0:683671116"
```

Every screenshot above comes from that local instance: nothing was taken from,
or written to, a live server.

`v2-dashboard-1672x941.png` / `v2-dashboard-1280x800.png` are the **fixture**
renders: a copy of the live database with a Winterfest snapshot pushed through
`applyWinterPayload` (the game's own path) and four `events` rows, so the
populated layout can be judged. `v2-dashboard-1672x941-empty-state.png` is the
**same page against the untouched copy** — that is the honest zero state, and
what a player sees before the game pushes anything.
`v2-dashboard-vs-reference.png` stacks the reference over the fixture render.

## Branch

All four commits are on the checked-out `winterfest` branch; `main` is untouched
(no Winterfest commit of this work is on it) and nothing was pushed, deployed or
run through `tools/deploy.sh`.

## Checks

`cd web-panel && node test_harness.mjs` — 553 green plus one red that is not
this workstream's: `levels page: ornament and title rewards resolve through the
catalogue` belongs to the uncommitted Levels/Mail sections (workstreams 14/15)
that share `test_harness.mjs`; it fails on their fixture, and their `levels.js`
is untracked. Because of that shared file the tests commit carries only this
page's hunks (the v2 imports and section 9g); the rest of the file stays in the
working tree for the coordinator to merge.

`node --check` is clean on every file above; `npm audit` reports 0
vulnerabilities; no dependency was added.
