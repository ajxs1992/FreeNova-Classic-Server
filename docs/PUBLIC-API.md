# FreeNova public API (read-only)

Four unauthenticated JSON endpoints under `/api/public/` on the panel host
(`https://leaderboard.fn-gaming.net`, Node runner `web-panel/server_local.mjs`).

They exist so the Discord bot stops scraping `/top15`, and so the in-game MOTD,
the website and the bot all read one set of numbers. Nothing here can mutate
anything: no session, no HMAC, no action token, no game write.

* owner module: `web-panel/src/publicapi.js` (routes/shapes)
* board + badge logic: `web-panel/src/boards.js`
* period boundaries: `web-panel/src/periods.js`
* event schedule: `web-panel/src/schedule.js`
* MOTD v2 pages: `web-panel/src/motd.js`

Every response is `application/json; charset=utf-8` with

```
Cache-Control: no-store
X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: *
```

because a board is live data, not a document. Rate limit: **120 requests per
minute per client address** (`PANEL_PUBLIC_RATE_LIMIT` overrides it), keyed on
the socket address the runner stamps — a client cannot pick its own bucket with
`X-Forwarded-For` / `CF-Connecting-IP`. Over the limit:

```json
HTTP 429
{ "error": "rate_limited", "message": "more than 120 requests in a minute" }
```

`POST`/`PUT` to any of these is a plain `405` (the panel's method gate).

Unknown public path:

```json
HTTP 404
{ "error": "not_found", "message": "unknown public endpoint",
  "endpoints": ["/api/public/status", "/api/public/top",
                "/api/public/player/<steamid>", "/api/public/events"] }
```

---

## 1. `GET /api/public/status`

Server state plus the event that is running now and the one starting next.

```bash
curl -sS https://leaderboard.fn-gaming.net/api/public/status
```

```json
HTTP 200
{
  "server": {
    "name": "FreeNova CS 1.6 | fn-gaming.net",
    "map": "de_airstrip",
    "online": true,
    "players": 7,
    "max": 32,
    "next_map": null,
    "last_push": 1795375130,
    "stale": false
  },
  "events": {
    "now": [
      {
        "title": "Double XP Weekend",
        "starts_at": 1795371530,
        "ends_at": 1795382330,
        "detail": "2x XP on every kill - ends Sunday night.",
        "state": "active"
      }
    ],
    "next": {
      "title": "Happy Hour",
      "starts_at": 1795380530,
      "ends_at": 1795385930,
      "detail": "Bonus coins for the first hour.",
      "state": "scheduled"
    }
  },
  "updated": 1795375292
}
```

| field | meaning |
|---|---|
| `server.name` | hostname the game pushed (`meta.server_hostname`) |
| `server.map` | current map (`meta.server_map`), `null` when unknown |
| `server.online` | `true` only for a fresh push that also says the server is up |
| `server.players` / `server.max` | live player count / slots — **`null` unless the game's own signed push is at most 180 s old** |
| `server.next_map` | always `null` today: the game does not push a next map |
| `server.last_push` | epoch seconds of the last signed game push, `null` if never |
| `server.stale` | `true` when that push is older than 180 s |
| `events.now[]` | events whose row is `active`, oldest window first |
| `events.next` | the earliest `scheduled` event, or `null` |
| `updated` | epoch seconds this response was built |

**Honest limits.** The panel has no A2S client and `players.last_seen` is not a
live presence signal, so it never guesses: when the game's push is stale,
`players`/`max` are `null` and `stale` is `true`. Show "—" instead of a number.
`online` follows the same rule (a stale `server_online=1` reads as offline).

---

## 2. `GET /api/public/top?period=week|month|all&limit=10`

The board. `period` defaults to `week`, `limit` to `10` (1–50). An optional
`metric=xp|kills` (default `xp`) selects the counter.

```bash
curl -sS 'https://leaderboard.fn-gaming.net/api/public/top?period=week&limit=3'
```

```json
HTTP 200
{
  "period": "week",
  "metric": "xp",
  "limit": 3,
  "key": "2026-W47",
  "window": {
    "key": "2026-W47",
    "start": 1794783600,
    "end": 1795388400,
    "tz": "Europe/Paris",
    "label": "Week 47 · 2026"
  },
  "rows": [
    { "rank": 1, "steamid": "STEAM_2:0:1537328478", "name": "zerbou3I",     "value": 950, "metric": "xp", "period": "week" },
    { "rank": 2, "steamid": "STEAM_0:1:799106783",  "name": "NPC_Leaders",  "value": 500, "metric": "xp", "period": "week" }
  ],
  "total": 2,
  "coverage": { "observed_players": 15, "first_seen": 1795375119, "complete": false },
  "updated": 1795375292
}
```

Boundaries — **the same arithmetic the website and the MOTD use**
(`src/periods.js`, Europe/Paris, DST-aware):

| period | window |
|---|---|
| `week` | ISO week: Monday 00:00 Europe/Paris → next Monday 00:00 |
| `month` | calendar month: 1st 00:00 Europe/Paris → 1st of the next month |
| `all` | lifetime XP/kills from the `players` row; `window.start`/`end` are `null`, `tz` is `"UTC"` |

`rows` are ranked 1..N, ties broken by name then steamid; players with no
measurable progress in the period are **not** listed. `value` is the period
value (`all`: the lifetime counter).

**Honest limits — read `coverage`.** The replica stores lifetime counters only;
the game does not push per-day history. A period value is therefore

```
value = max(0, counter now − counter the panel first observed inside the period)
```

* `coverage.complete: true` — the panel saw every listed player from the first
  minutes of the period, so the numbers are the whole period.
* `coverage.complete: false` — some players were first seen later (a new player,
  or the panel was restarted mid-week). Their value is "since we first saw
  them" and is under-counted. `coverage.first_seen` is the earliest baseline in
  the period; `coverage.observed_players` is how many players the period has a
  baseline for.
* No baseline ⇒ no rows. The endpoint never invents a value, and never
  extrapolates. For long-run totals use `period=all`.

Errors: unknown `period` → `400 {"error":"bad_period", "allowed":[...]}`;
`limit` not a positive number → `400 {"error":"bad_limit"}`; unknown `metric` →
`400 {"error":"bad_metric"}`.

---

## 3. `GET /api/public/player/<steamid>`

One player's public game statistics. The steamid may be written packed
(`0-0-683671116`), canonical (`STEAM_0:0:683671116`), URL-encoded, or in any
case.

```bash
curl -sS https://leaderboard.fn-gaming.net/api/public/player/0-0-683671116
```

```json
HTTP 200
{
  "steamid": "STEAM_0:0:683671116",
  "name": "ajxs",
  "rank": 1,
  "bp_tier": 1,
  "bp_xp": 0,
  "bp_next_xp": 1000,
  "bp_progress": 0,
  "bp_tier_xp": 1000,
  "bp_max_tier": 60,
  "coins": 999862237,
  "playtime_minutes": 447,
  "badges": [],
  "updated": 1795375292
}
```

| field | meaning |
|---|---|
| `rank` | lifetime XP position, or **`null` when the player has 0 XP** (an unranked player has no meaningful position) |
| `bp_tier` | BattlePass tier 1..60 from the BP ledger (`bp_xp`/`bp_tier`), the same `bp_track.js` curve every page uses |
| `bp_xp` | total BattlePass XP |
| `bp_next_xp` | XP still needed for the next tier (`0` at tier 60) |
| `bp_progress` | XP earned inside the current tier |
| `bp_tier_xp` | XP one tier costs (`reward_track.xp_per_tier`, default 1000) |
| `bp_max_tier` | 60 |
| `badges` | text badges, newest first: `[{kind, period, label}]` — see §5 |

`badges` kinds: `weekly_champion`, `monthly_champion`, `weekly_top3`,
`weekly_streak3` ("top 3 three weeks running"). Labels are plain text.

Nothing else is exposed. **No** IP, session, action queue, `last_seen`,
country, staff pin, or another player's data — the handler builds a fixed
object from a fixed field list.

```json
HTTP 404
{ "error": "player_not_found",
  "message": "the panel has no snapshot for this steamid yet",
  "steamid": "STEAM_0:0:1" }
```

The 404 is "this steamid has no row in the panel yet" (a new player the game has
not pushed, or a typo) — it is not an error condition, treat it as "unknown
player". A steamid that cannot be parsed:

```json
HTTP 400
{ "error": "bad_steamid",
  "message": "steamid must look like STEAM_0:0:123 or 0-0-123",
  "given": "not-a-steamid" }
```

---

## 4. `GET /api/public/events`

The panel's own event schedule (the `events` table), for the MOTD and the bot.

```bash
curl -sS https://leaderboard.fn-gaming.net/api/public/events
```

```json
HTTP 200
{
  "events": [
    { "title": "Double XP Weekend", "starts_at": 1795371530, "ends_at": 1795382330,
      "detail": "2x XP on every kill - ends Sunday night.", "state": "active" },
    { "title": "Happy Hour", "starts_at": 1795380530, "ends_at": 1795385930,
      "detail": "Bonus coins for the first hour.", "state": "scheduled" },
    { "title": "Kill Race", "starts_at": 0, "ends_at": 0,
      "detail": "First to 1,000 kills wins.", "state": "unscheduled" }
  ],
  "now": 1,
  "next": "Happy Hour",
  "updated": 1795375292,
  "source": "panel"
}
```

`events` is soonest-first (open-ended rows with no start last). `now`/`next` are
counts/shortcuts: `now` is how many are `active`, `next` is the next
`scheduled` title or `null`.

`state` is derived from the row's own lifecycle status (`status` column), not
guessed from the clock:

| state | meaning |
|---|---|
| `active` | `status='active'`: the scheduler started it |
| `scheduled` | `status='scheduled'` and `starts_at` is in the future |
| `overdue` | still `scheduled` although `starts_at` has passed — the scheduler has not activated it (worth flagging, do not announce it as running) |
| `unscheduled` | the row has no `start_at` at all |
| `ended` | `completed`/`error` |
| `cancelled` | `status='cancelled'` |

Rows that ended more than 24 h ago are not returned (the archive lives on
`/events` and in `event_history`).

### The game's `events.ini` is still the source of truth

The plugin reads `configs/freenova/events.ini` on the game server, and the panel
**cannot write that file**. So:

* the multipliers actually applied to XP/coins come from `events.ini`;
* this endpoint publishes the **panel's schedule** — what staff entered in
  `/admin?s=events` (title, window, and the player-facing `detail` blurb the
  admin form now has), with the panel's own `xp_mult`/`coins_mult` values
  available to staff clients;
* `source: "panel"` says so explicitly. Do not present these numbers as "what
  the server is running" unless the game-side ini agrees.

TODO (not implemented, on purpose): pushing this schedule to the game through
the existing sync `actions` channel (`srv_event_schedule`). Until the plugin
implements and validates such an action, nothing here writes to the game.

---

## 5. Weekly / monthly boards, period snapshots and badges

One implementation (`src/boards.js` + `src/periods.js`) feeds `/api/public/top`,
the website boards (`/top/week`, `/top/month`), and the MOTD top tabs, so none
of them can disagree.

* **Baselines.** `board_marks` stores, per player/period/metric, the counter
  value at first sight inside the period (`base`), the newest observed value
  (`last_value`), and `first_seen`. Refreshed at most once per 60 s on the board
  read paths.
* **Rollover.** The first board read after a period ends snapshots the top 15 of
  the period that just closed into `board_history` (`period`, `period_key`,
  `rank`, `steamid`, `name`, `value`, `settled_at`) and sets
  `meta.board_settled:<period>`. The snapshot is idempotent: `INSERT OR IGNORE`
  on a primary key means a re-run cannot duplicate a winner, and a period with
  no baselines settles with zero rows rather than an invented champion.
  The settled value is the newest observation taken *before* the boundary (at
  most one refresh interval old).
* **Badges** (`badges`: `steamid`, `kind`, `period`, `label`, `awarded_at`,
  unique per `(steamid, kind, period)`), awarded during the rollover:
  * `weekly_champion` — weekly #1, label `Weekly #1 · Week 46 · 2026`
  * `monthly_champion` — monthly #1
  * `weekly_top3` — weekly ranks 1–3
  * `weekly_streak3` — in the weekly top 3 for three weeks running
  Text only: no images, no client content, no model/colour data.
* **Storage.** `schema.sql` creates `board_marks`, `board_history` and `badges`
  with `IF NOT EXISTS`; `src/boards.js` repeats the same DDL lazily, so a
  deployment that never re-runs `schema.sql` still gets them on the first board
  read. The `events.detail` column is added by a `PRAGMA`-guarded
  `ALTER TABLE` (`src/schedule.js`), which is safe on the live replica.

---

## 6. MOTD v2 (`/m/<code>/<steamid>/<tab>.htm`)

The pages the game opens. Same token/redirect contract as before, new layout.

| path | product | tabs |
|---|---|---|
| `/m/p/<sid>.htm` | Profile: player header, career, weekly standing, badges | — |
| `/m/i/<sid>/daily.htm` | Missions (daily + bonus) | `daily`, `weekly`, `special`, `seasonal`, `completed` |
| `/m/b/<sid>.htm` | Battle Pass: tier, XP to next, next three rewards | — |
| `/m/t/<sid>/top15.htm` | Top 3 + "you are #N, X behind #N-1" | `top15` (lifetime), `week`, `month` |
| `/m/e/<sid>.htm` | Events: running now + on next, server-side countdown | — |

`sid` is the packed steamid (`0-0-683671116`); `.htm` is optional; `/m/b/<sid>/missions.htm`
still `302`s to `/m/i/<sid>/daily.htm`; `/m/s/` and `/m/o/` still `404`.

Every page carries `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`,
and is one self-contained MSIE-6-safe document: inline CSS only, no `<script>`,
no `<img>`, no `<link>`, no iframes, no flex/grid/CSS variables. If live data
cannot be read within 2 s the page degrades to a static "server info + type
`!missions`" card with HTTP **200** instead of hanging or erroring.

Verified headers (`curl -sS -D - -o /dev/null`):

```
/m/p/0-0-683671116.htm            200  cache-control: no-store  referrer-policy: no-referrer  x-robots-tag: noindex
/m/i/0-0-683671116/daily.htm      200  cache-control: no-store  referrer-policy: no-referrer  x-robots-tag: noindex
/m/b/0-0-683671116/battlepass.htm 200  cache-control: no-store  referrer-policy: no-referrer  x-robots-tag: noindex
/m/t/0-0-683671116/week.htm       200  cache-control: no-store  referrer-policy: no-referrer  x-robots-tag: noindex
/m/e/0-0-683671116/events.htm     200  cache-control: no-store  referrer-policy: no-referrer  x-robots-tag: noindex
/m/b/0-0-683671116/missions.htm   302  location: /m/i/0-0-683671116/daily.htm
/m/s/0-0-683671116/x.htm          404
```

---

## 7. What the bot should call

| need | call | how often |
|---|---|---|
| "is the server up, who is on, what's running" | `GET /api/public/status` | 60 s |
| weekly / monthly leaderboard post | `GET /api/public/top?period=week&limit=10` (then `month`) | 5 min, or once per post |
| all-time board | `GET /api/public/top?period=all&limit=10` | 15 min |
| "when is the next event" | `GET /api/public/events` | 5 min |
| `!player <name>` lookup | `GET /api/public/player/<steamid>` | on demand |

Notes for the client:

* every response carries `updated` (epoch seconds) — show "as of" and do not
  cache it; `Cache-Control: no-store` is deliberate.
* `players`/`max` may be `null`: print `—`, never `0`.
* `coverage.complete: false` on a weekly/monthly board means "period to date" —
  say so rather than claiming a finished week.
* a `404` from the player endpoint is "not tracked yet", not an outage.
* the API is the only supported read path: `/top15` HTML scraping is not a
  contract and will change.

---

## 8. Verification log (this build)

Run against **a copy** of the live replica — the original `data/*.sq3` was never
opened (`cp data/freenova_panel.sq3 data/freenova_panel.sq3-shm
data/freenova_panel.sq3-wal /tmp/fnfinal/`, then
`PORT=18100 PANEL_DB=/tmp/fnfinal/live.sq3 node server_local.mjs`).

```
== public JSON (GET) ==
/api/public/status                             200
/api/public/top?period=week&limit=10           200
/api/public/top?period=month&limit=10          200
/api/public/top?period=all&limit=10            200
/api/public/top?period=decade                  400   (bad_period)
/api/public/top?limit=0                        400   (bad_limit)
/api/public/player/0-0-683671116               200
/api/public/player/STEAM_0%3A0%3A683671116     200   (colon form)
/api/public/player/0-0-1                       404   (player_not_found)
/api/public/player/nope                        400   (bad_steamid)
/api/public/events                             200
/api/public/bogus                              404   (not_found)
POST /api/public/status                        405   (method gate)

== MOTD v2 ==
/m/p/0-0-683671116.htm                   200
/m/p/0-0-683671116                       200   (.htm optional)
/m/i/0-0-683671116/daily.htm             200
/m/i/0-0-683671116/weekly.htm            200
/m/i/0-0-683671116/completed.htm         200
/m/i/0-0-683671116/special.htm           200
/m/i/0-0-683671116/seasonal.htm          200
/m/b/0-0-683671116/battlepass.htm        200
/m/b/0-0-683671116.htm                   200
/m/t/0-0-683671116/top15.htm             200
/m/t/0-0-683671116/week.htm              200
/m/t/0-0-683671116/month.htm             200
/m/e/0-0-683671116/events.htm            200
/m/p/0-0-1.htm                           200   (player the panel has never seen)
/m/b/0-0-1/missions.htm                  302   -> /m/i/0-0-1/daily.htm
/m/s/0-0-1/x.htm                         404

== unchanged surfaces still 200 ==
/top15  200    /profile  200    /hub  200    /top/week  200    /top/month  200
```

Sample body straight from that run (`GET /api/public/player/0-0-683671116`):

```json
{
  "steamid": "STEAM_0:0:683671116",
  "name": "ajxs",
  "rank": 1,
  "bp_tier": 1,
  "bp_xp": 0,
  "bp_next_xp": 1000,
  "bp_progress": 0,
  "bp_tier_xp": 1000,
  "bp_max_tier": 60,
  "coins": 999862237,
  "playtime_minutes": 447,
  "badges": [],
  "updated": 1795375466
}
```

That run also proves the migrations are safe on the live schema:

* the copy had **no** `bp_xp`/`bp_tier` columns and **no** `events.detail`
  column before boot (`PRAGMA table_info` → absent);
* `server_local.mjs` migrated `players` (additive `ALTER TABLE`), `schema.sql`
  created `board_marks` / `board_history` / `badges`, and the first
  `/api/public/events` call added `events.detail` — all on the copy, with the
  15 live players and their data intact;
* the first board read recorded 60 baselines (15 players × 2 metrics × 2
  periods) and `status` honestly answered `"players": null, "stale": true`
  for a replica whose last game push was hours old.

The sample bodies in §1 and §4 come from the same copy with two events entered
through the admin form's own INSERT (title/window/`detail`), so the events block
is non-empty; the weekly sample in §2 comes from a run where two players had
already earned XP inside the current week (a brand-new period legitimately
returns `rows: []` with `coverage.complete: false`).

`web-panel/test_harness.mjs` covers all of the above plus the boundary
arithmetic (DST, ISO week-year edge, month boundary), the rollover, the badges,
the site/API agreement and the zero-data player page: **239 checks, 0
failures** (`cd web-panel && node test_harness.mjs`).
