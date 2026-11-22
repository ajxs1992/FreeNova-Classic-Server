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

## 3. Conflicts that must be decided before code

1. **Premium Battle Pass.** The spec asks for *Free + Premium tracks* and a
   purchase. The owner's earlier decision (recorded in `docs/WINTERFEST.md` §6)
   was **"free track only — no premium column anywhere"**. Which wins? A paid
   track also needs a payment path (see §3.4).
2. **Advent rules.** Earlier decision: 24 calendar days, a missed day stays
   claimable until the season closes **at half value**. The spec now says missed
   rewards are **hidden and unclaimable** during the event, become visible after
   **24 December**, and an **Advent Pass ($1.99)** unlocks them. These are
   different products; pick one.
3. **Timezone.** Spec: "Romania's timezone" (Europe/Bucharest). Implemented:
   **Europe/Paris** (the owner said "eng/fr/germany, part of Europe"). One hour
   apart — and it decides when the daily reset, Advent unlock and pass rollover
   happen. Pick one and it is a single constant.
4. **Payments.** The Advent Pass and any premium track imply real money. There is
   no payment integration in this project. Options: (a) no paid tiers this
   season; (b) Stripe Checkout (needs an account, webhooks, refund policy,
   VAT/consumer-law handling); (c) manual grants by an admin. Decide, because
   (b) is a project, not a feature.
5. **Achievement count.** "120 seasonal achievements" is a content programme, not
   a page: each needs a trigger, a reward and a test. Propose 20 for December and
   the full set as a season-long build.
6. **Shop scope.** A real product catalogue (skins, models, frames, effects) with
   rarity, previews and purchase history is the biggest single gap. Question:
   is December's shop **cosmetic-only with coins/gingerbread** (no money), or does
   it also sell for real money?
7. **Kill effects / trails / animated frames.** These need client assets
   (fastdl). Registry entries are cheap; shipping them is gated by download speed.

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
