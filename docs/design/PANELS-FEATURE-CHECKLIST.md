# 14 panels — the owner's feature list, mapped to what actually exists

Owner spec (2026-11-22, second document). This file is the bridge between that
list and the code: one row per panel, what is already there, what the spec adds,
and what needs a decision before anyone writes code. **Read the conflicts in §3
first** — two of them contradict decisions already taken and implemented.

## 1. Status per panel

| # | panel | exists today | the spec adds | state |
| --- | --- | --- | --- | --- |
| 1 | **Dashboard** | `/`, `/home`, `/hub` (old skin) | Winterfest overview, countdown, 5 stat cards, tree preview, events, rewards, leaderboard preview | **being rebuilt** (v2 shell; reference measured) |
| 2 | **Battle Pass** | `/bp`, `/battlepass`; BP XP ledger end-to-end (own vault key, VIP multiplier, panel columns) | 30-tier horizontal track, claimable/locked states, **premium track + purchase** | rebuild + **decision §3.1** |
| 3 | **Missions** | `/missions`; `freenova_missions` with 48 contracts from `missions.ini`; seasonal layer in flight (`winterfest_progress`) | categories/filters, reset countdowns, streaks, daily chests, claim action, history | extend |
| 4 | **Achievements** | `/achievements`; `freenova_achievements` with retry-safe payouts | ~120 seasonal achievements, medal tiers, secret ones, completion medal | content + UI |
| 5 | **Events** | `/events`; `events.ini` windows; 12-days draft | calendar view, active/upcoming/completed, participation stats, per-event leaderboards | extend |
| 6 | **Profile** | `/profile` | **7 tabs** (Overview/Stats/Matches/Skins/Frames/Badges/Tree), avatar+frame+badge+title **equipped state**, tree showcase | rebuild; entitlement system is new |
| 7 | **Rankstats** | `/rankstats`, `/rank`, `/stats*`; `rsu_*` stack, stats push | charts, weapon/map breakdowns, match history, season stats | rebuild + new queries |
| 8 | **Top 15** | `/top15` + 21 board routes + `boards.js`/`periods.js` | multi-category boards, search, sort, own position, historical seasons | rebuild one renderer for 21 routes |
| 9 | **Spin Wheel** | nothing | wheel, tokens, prize table, weighted roll, history, admin config | **being built** (workstream 13) |
| 10 | **VIP** | `/vip`; `freenova_vip` with tier cvar, perks, armory | VIP / VIP+ / VIP Elite, comparison table, animated frames, expiry countdown | extend + decision §3.3 |
| 11 | **Shop** | `/shop`, `/store`; shop plugin | product catalogue (skins/models/badges/titles/frames/effects), rarity, previews, purchase, history, daily deals | **largest gap** — needs a product/economy model |
| 12 | **Advent** | panel page in flight; core has 24-day claims | illustrated village, per-house reveal animation, **Advent Pass ($1.99)** | rebuild UI + **decision §3.2** |
| 13 | **Levels** | nothing (rank level exists) | XP curve page, per-level rewards (L50 model, L75 skin, L100 frame), claimable track, global level board | **being built** (workstream 14) |
| 14 | **Admin** | `/admin` (1 054 lines, auth'd, sections) | event status + start/stop, live stats, currency grant, module toggles, reward CRUD/import, XP recalc, reset | extend — **last**, data risk |

## 2. What is already the core (the owner's "build core first" recommendation)
It exists and is running: `sync.js` (HMAC ingest + stale-push guard), the SQLite
replica + migrations, `periods.js` (Europe/Paris boundaries), `bp_track.js` (the
one tier curve), `publicapi.js` (public JSON for the bot), the Winterfest core
plugin (currency, inventory, tree, Advent, pass XP, idempotent grants), and the
`winter_mail`/`winter_*` panel tables as they land.

**We are not switching to MySQL.** The panel is SQLite (D1-compatible) with the
game pushing through HMAC-signed batches; that guard is the reason the panel
never shows stale data over newer data. Changing the store is a separate project
with its own risk and buys nothing a player can see.

## 3. Conflicts — all resolved 2026-11-22 (owner)
| # | question | decision |
| --- | --- | --- |
| 1 | Premium Battle Pass | **Yes** — free + premium tracks, premium is an entitlement |
| 2 | Advent rules | **One-day window**: claimable on its date only, then expired. Whole calendar buyable at the end (Advent Pass). The half-value catch-up is withdrawn |
| 3 | Timezone | **Europe/Paris** |
| 4 | Payments | **Stripe later**; now an orders/entitlements model with manual + automatic grants |
| 5 | Achievements | 20 in December, the full set across the season (still a content programme) |
| 6 | Shop | Cosmetics for Coins and GingerBread; real money only for premium BP + Advent Pass |
| 7 | Effects/trails/animations | Registry now, shipping gated by client download speed |

## 4. December vs January (what the deadline allows)
**December (must work on day one):** Dashboard, Profile (Overview + Tree tabs),
Top 15, Battle Pass (free track), Missions, Achievements (small set), Events,
Advent (calendar), Spin Wheel, Levels, VIP (status only), Shop (browse + coin
purchases), Admin (event controls + currency grants).

**January (deferred honestly):** premium tracks and any payment flow, profile
tabs Stats/Matches/Skins/Frames/Badges (they need the entitlement system and the
stats queries), 120 achievements, kill effects/trails, animated frames, event
leaderboards per event, reward import/export.

## 5. Rules every panel keeps
Real data or an honest empty state · no new dependency · works with JS off · the
45-route inventory stays reachable · auth and the sync guards untouched ·
`node test_harness.mjs` green and growing · screenshots at 1672/1280 in
`docs/design/renders/`.
