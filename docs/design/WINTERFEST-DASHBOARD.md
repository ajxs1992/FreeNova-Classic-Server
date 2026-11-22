# Winterfest dashboard — the reference, measured

Source: owner's reference image (`refs/winterfest-dashboard.png`, 1672×941 PNG).
**The goal is a faithful replication of this layout, not an interpretation.**

## Measured geometry (from the reference, in its 1672×941 space)

| region | px | share |
| --- | --- | --- |
| sidebar | 0 → 293 wide | 17.5 % of width |
| top bar | 0 → 88 tall | 9.4 % of height |
| content gutter | starts at 307 | 14 px gap after the sidebar |
| three-card row | columns start ≈ 307, 618, ~1030 | roughly 1 : 1 : 1 with 20-24 px gaps |

Rounded cards everywhere (~14-18 px radius), 1 px cool-blue borders, soft outer
glow. The hero is full-bleed art behind a centred title lockup and a countdown.

## Palette sampled from the image

| role | colour |
| --- | --- |
| page / panel base | `#0b1030` → `#12143a`, deepest corners `#000020` |
| card surface | `#0d1430` with a `#16224a` highlight at the top edge |
| card border | `#2a3d6e` (1 px) |
| primary text | `#eef2ff` |
| muted text | `#9fb0d0` |
| accent red (ribbon, Santa, badges) | `#c00000` → `#d62828` |
| accent gold (stars, rewards) | `#f5c451` |
| accent green (progress bars, "Active") | `#3fbf6f` |
| accent ice blue (snow, links) | `#4070c0` |
| accent purple (sidebar active) | `#302070` → `#7c5cd6` |
| positive delta | `#5ce08a` |

Snowflake bullets, thin gold dividers, small-caps section labels in
`#7f8fb5` with a leading ❄.

## Element → real data (nothing in this layout may be fake)

| element | source |
| --- | --- |
| logo block | static art + season name |
| Coins 24 500 | `players.coins` |
| **GingerBread** 1 320 | Winterfest currency (game-side core; the mock names it GingerBread — see the naming question) |
| Spins 0 | spin-wheel tokens (new) |
| Missions 0 | open seasonal contracts |
| bell with red dot | count of unread announcements / live events |
| envelope | **not built** — no message system exists; either link to Discord or drop it |
| profile chip (name, Level 56) | `players.name`, rank level |
| sidebar groups | PLAYER: Dashboard, Profile, Rankstats, Top 15 · PROGRESSION: Battle Pass, Missions, Achievements, **Levels (new)** · EVENTS: Events, **Calendar Advent**, **Spin Wheel (new)** · REWARDS: VIP, Shop, Admin |
| hero title / subtitle / countdown | season window from `winterfest.ini` (end date drives the countdown) |
| My Tree 68 % | tree completion (filled slots / 24) |
| Battle Pass Lv. 12 | BattlePass tier |
| Advent Day 8 / 24 | Advent claims |
| Missions 3 / 10 | open/completed contracts |
| Events Active: 4 | live event windows |
| Your Christmas Tree card | completion %, ornament counts by rarity, `Decorate Tree` → `/winter/tree` |
| Event Progress bars | season objectives (gifts collected, ornaments found, missions completed, event matches won) — needs four counters from the game |
| Recent Rewards | last four grants from the game's claim ledger |
| Active Winterfest Events | event windows with states: `Active Now`, `Ends in …`, `Starts in …` |

## Art strategy (decided per element, not globally)

1. **Hero scene** (snowy village, aurora, tree, presents, lantern): crop from the
   reference and use as a background image — it is a backdrop, cropping is
   lossless enough, and it is the one place where reproducing the painting is
   impossible in CSS.
2. **Santa figure**: crop as a transparent-edged PNG (the reference has a clean
   sky behind him) and place as a foreground layer, right-aligned.
3. **Item tiles** (AK-47 skin, gingerbread, snowflake ornament, Santa hat): crop
   each tile's art; keep the frame/border in CSS.
4. **Icons** (sidebar, stat cards, bars): rebuild as **inline SVG** — crisp at any
   size, no requests, and they can take the accent colours. Do not crop 24 px
   icons from a 2× screenshot; they will look blurry.
5. **Everything else**: CSS gradients, borders, shadows.

## Acceptance
A headless screenshot at 1672×941 placed next to the reference, plus a second at
1280×800 to prove it degrades. The check is visual and side-by-side: same
regions, same proportions, same palette. Fonts may differ (no webfont is loaded
in the reference; use a system stack that matches the weight/letter-spacing).

## Decisions (owner, 2026-11-22)
1. **GingerBread wins.** The core's "snowflakes" currency is renamed to
   gingerbread (`gb`); "snowflake" stays as the ornament set name only.
2. **Spin Wheel ships** — daily free spin + earned spins, prize table in config.
3. **Envelope ships** — an inbox for system announcements and admin broadcasts.
   Player-to-player mail is explicitly a later step.
4. **Levels page ships** — XP curve and per-level rewards.
