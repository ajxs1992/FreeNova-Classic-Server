# FreeNova Leaderboard & Web Panel

How the CS 1.6 server, the panel process and the leaderboard pages fit together,
step by step.

The short version: **the game server is the only writer.** It pushes a signed
snapshot of every player every 30 seconds. The panel verifies the signature,
stores the snapshot in SQLite, and renders pages from that copy. The browser can
never change a stat — it can only *queue* an action (buy, equip, claim), and the
game re-validates and applies it on the next push.

---

## 1. Topology

```
 ┌───────────────────────────── one host (193.70.81.30) ─────────────────────────────┐
 │                                                                                   │
 │  CS 1.6 / HLDS                                  Node panel process                │
 │  ┌──────────────────────────┐                   ┌──────────────────────────────┐  │
 │  │ freenova_sync.amxx       │  HTTP/1.1 POST    │ server_local.mjs  (HTTP :8762)│  │
 │  │ freenova_registration.sma│ ────────────────► │   └─ src/index.js  (router)   │  │
 │  │ (AMXX, 30s timer)        │ 127.0.0.1:8762    │        ├─ src/sync.js  (ingest)│  │
 │  └──────────────────────────┘                   │        └─ pages (profile, top) │  │
 │             ▲                                   └───────────────┬──────────────┘  │
 │             │  actions[] in the push response                   │ node:sqlite       │
 │             │  (max 8 per push)                                 ▼                   │
 │             │                                   ┌──────────────────────────────┐  │
 │             └───────────────────────────────────┤ data/freenova_panel.sq3 (WAL) │  │
 │                                                 └───────────────┬──────────────┘  │
 │                                                                 │ SELECT only       │
 │                                     Browser / GoldSrc MOTD ◄───┘                   │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

No Cloudflare, no relay in the live path. The AMXX socket speaks plain HTTP and
the panel is on loopback, so `fnweb_host 127.0.0.1` reaches it directly.
`relay/` and `wrangler.toml` are leftovers from the retired Worker deployment —
they are dormant.

GoldSrc's MOTD browser is MSIE-based: it loads **plain HTTP only**, no TLS, and
the URL must stay short (roughly ≤ 96 characters). That is why the panel renders
its own compact HTML instead of shipping a JS app.

---

## 2. Components

| Path | Role |
|---|---|
| `server_local.mjs` | Node HTTP server. Loads `relay/relay.env` into `process.env`, opens the SQLite DB, applies `schema.sql` + `seed_catalogs.sql`, hands every request to the worker router. Serves `assets/` for `/i/`, `/ranks/`, `/badges/`, `/medals/`, `/bp/`, `/missions/`. |
| `src/index.js` | Route table. Rewrites short MOTD URLs, picks the compact skin for old user agents, dispatches to page modules. |
| `src/sync.js` | The ingest endpoint, the action queue, event scheduler, admin-call webhook. |
| `src/sqlite_d1.js` | A D1-compatible shim (`prepare/bind/first/all/run/batch`) over `node:sqlite`, so the same code runs on a Worker or on this box. |
| `src/register.js` | `/api/game/v1/register` + health probe for in-game registration. |
| `src/admin.js` | `/admin` control centre: staff PIN login, session cookie, ops actions, event CRUD. |
| `src/profile.js`, `src/competitive.js`, `src/top15/*`, `src/battlepass.js`, `src/missions.js`, `src/achievements.js`, `src/events.js`, `src/vip.js`, `src/hub.js` | One module per product page. |
| `src/ui.js` | Shared render helpers (`esc`, `fmt`, `num`), compact-skin switch, error states. |
| `schema.sql`, `seed_catalogs.sql` | Base tables and catalog content (skins, models, achievements, reward track). |
| `data/freenova_panel.sq3` | The live database (WAL). |

---

## 3. The 30-second push, step by step

### 3.1 Game side (`freenova_sync.amxx`)

1. A repeating timer fires every `fnweb_interval` seconds (default **30**).
2. The plugin builds a JSON body from live server state:
   - `players[]` — one object per authenticated player: identity, XP/level,
     K/D/HS/damage/shots/hits, MVPs, wins/losses, playtime, rating, VIP tier and
     time left, coins, battle-pass daily/weekly counters, boost flags, competitive
     season/points, equipped cosmetics, achievement bitmask and counters,
     per-weapon stats `weapons[]`, owned `skins[]`, owned `models[]`, country code.
   - `server{}` — map, hostname, player counts, uptime, round, happy-hour and
     event multipliers.
   - `action_results[]` — outcome of actions executed since the last push:
     `{ id, ok, result }`.
   - `event_results[]` — event settlements the game already paid out.
3. It computes the body hash with `hash_string(..., Hash_Sha256, ...)` and signs:
   ```
   signature = SHA256( secret + ":POST:" + path + ":" + timestamp + ":" + nonce + ":" + hex(sha256(body)) )
   ```
   The body is hashed first on purpose: a 16 KB body cannot fit AMXX's 2 KB
   string buffer, but a 64-char hex digest can.
4. Headers: `X-FreeNova-Server-ID`, `X-FreeNova-Timestamp` (unix seconds),
   `X-FreeNova-Nonce` (`<time>_<rand>`), `X-FreeNova-Signature`, plus
   `Content-Length` and `Connection: close`.
5. The socket opens to `fnweb_host:fnweb_port` (numeric IPv4 only — the module
   rejects hostnames), writes headers then body, and reads the reply until the
   peer closes.

### 3.2 Verified on the panel (`verifyGamePost`)

1. `SYNC_SECRET` must be configured, otherwise `401 sync secret not configured`.
2. Signature header present; timestamp present.
3. `|now - timestamp| <= 300` — a five-minute replay window.
4. Recompute `hex(sha256(body))` from the **raw** body and the signature above;
   compare in constant time.
5. Nonce must be 1–64 chars of `[A-Za-z0-9_.-]`.
6. Replay check: `meta` holds a `nonce:<nonce>` row. If it exists → `401 replayed
   nonce`. Otherwise insert it, then prune nonces older than 10 minutes.

Any failure returns JSON `{ ok: false, error: ... }` and nothing is written.

### 3.3 Ingest (`handleSync`)

1. Parse JSON; require `players` to be an array.
2. `ensureOpsTables()` — creates staff/session/audit/event tables if an older DB
   is missing them (self-healing, no manual migration).
3. Read each pushed player's current `ach_unlocked` bitmask and diff it against
   the incoming value to stamp `ap_unlocks.earned_at` on first observation.
4. Build one batched statement list:
   - **`players`** — upsert on `steamid`. This is the big one: every stat column
     is overwritten with the game's value, plus `server_id`, `last_seen`, `cc`.
   - **`player_weapons`** — upsert per `(steamid, slot)`.
   - **`player_skins`** — delete-then-insert per player: the game's inventory is
     the truth, so the web copy is replaced wholesale.
   - **`player_models`** — same replace semantics, with `equipped`/`forced`.
   - **achievement columns** — patched only when present in the payload.
   - **`player_maps`** — per-map counters when supplied.
   - **`player_skills`**, **`player_profile`** — merged when supplied.
   - **`actions`** — close results: `ok ? "done" : "failed"`, store `result`
     text and `closed_at`, but only for rows still in `sent` state.
   - **`event_results`** — record winners, converge the event row, audit.
5. `ALTER TABLE players ADD COLUMN ...` for every later-added column, tolerating
   "duplicate column" so old databases upgrade themselves.
6. Execute as one batch (single transaction).
7. `writeServerMeta()` — `last_push`, `server_online`, map/hostname/players/
   humans/maxplayers/uptime/round, happy-hour and event multiplier flags.
8. `tickEventScheduler()` — activate due events, settle finished ones, queue
   `srv_event_*` actions for the game.
9. Dispatch: take up to **8** `actions` with `status='pending'` ordered by age,
   flip them to `sent`, and expire anything older than an hour.
10. Reply:
    ```json
    { "ok": true, "stored": 12, "server_time": 1793130757,
      "events": [ ...active metric events... ],
      "actions": [ { "id": 41, "steamid": "STEAM_0:1:2", "type": "buy_skin", "arg": "rifle_ak:3", "attempts": 1 } ] }
    ```

The freshness stamp is `meta.last_push`. If it stops advancing, the push path
is broken — the pages still render, they just go stale.

### 3.4 Back on the game

The plugin parses the response, executes each action through the owning module
(the game is the spender: it re-checks coins and inventory), and records the
outcome in memory. Those outcomes ride the **next** push as `action_results[]`,
which is how the panel closes the loop.

---

## 4. Web → game actions

The browser cannot hold `fnweb_secret`, so the web cannot sign anything. Instead:

1. A page that offers an action receives an **action token** in its URL:
   ```
   t = SHA256( secret + ":act:" + steamid + ":" + unixDay )
   ```
   `unixDay = floor(unixSeconds / 86400)`. A leaked MOTD URL stops working at the
   next UTC midnight (the check accepts today and yesterday, to survive a push
   that straddles midnight).
2. `queueAction()` validates the token and the action type, then inserts a row into
   `actions` with `status='pending'`.
3. The next push hands it to the game. Lifecycle:
   `pending → sent → done | failed`, or `expired` if nobody picked it up within an
   hour.
4. The game re-validates everything before applying. Nothing is granted by the web.

Action types are a fixed allow-list (`buy_skin`, `equip_skin`, `buy_model`,
`equip_model`, `unequip_model`, `set_tag`, `unequip_tag`, `claim_bp`,
`buy_skill`, `claim_tournament`, `claim_mission`, `reroll_mission`,
`claim_mission_all`, `claim_event`) plus staff-only `srv_event_*` ops.

---

## 5. Registration flow

1. Player types `/register` in game; `freenova_registration.sma` collects
   username, email and password.
2. It POSTs to `/api/game/v1/register` with `X-FreeNova-*` headers.
   **This endpoint signs the raw body**, not `hex(sha256(body))`:
   ```
   SHA256( REG_SECRET + ":POST:" + path + ":" + timestamp + ":" + nonce + ":" + BODY )
   ```
   Two different formulas exist on purpose. Do not unify them.
3. The panel validates, rejects duplicates atomically, and stores a `pending` row
   in `reg_requests`. The password is validated (8–72 chars) and **never stored**.
4. Reply `{ success: true, code: "OK", request_id, status, duplicate }` — the game
   shows its banner from the body, not the HTTP status line.
5. `GET /api/game/v1/health` is unauthenticated and flips the plugin between
   forum-up and forum-down states.

---

## 6. Pages

| Route | Product |
|---|---|
| `/` | Hub — directory of all products |
| `/profile` | Player profile (`/statsme`, `/rankstats`, `/rank`) |
| `/top`, `/top15`, `/leaderboard` | Top 15 leaderboard with sort/weapon/search |
| `/competitive`, `/tournament` | Ranked season ladder, daily set, prize tiers |
| `/battlepass`, `/bp` | Battle pass track and claims |
| `/missions` | Daily / weekly / special / seasonal / completed |
| `/achievements`, `/hof` | Medals and hall of fame |
| `/events` | Live and past events |
| `/vip` | VIP tiers |
| `/statsviewer`, `/stats` | Raw stat viewer |
| `/admin` | Staff-only control centre |

MOTD short links: `/m/<code>/<D-D-D>/<tab>.htm` where code is
`p b t i a v e r` and the SteamID is packed as `STEAM_0:0:123` →
`0-0-123`. The panel mints the identity from the path, so the URL alone cannot
be used to impersonate another player. `/u/STEAM_x:y:z/...` is the long form.
Legacy `?view=` and `*.php` URLs redirect to the canonical routes.

Rendering is server-side HTML with inline CSS, one product per page, no shared
navigation between products. Old user agents (MSIE/Trident/`Mozilla/4.0`) or
`?compact=1` get a reduced skin sized for the in-game MOTD.

---

## 7. Database

Grouped by purpose (see `schema.sql` for exact DDL):

- **Identity & stats** — `players` (one row per SteamID, all counters),
  `player_weapons`, `player_skins`, `player_models`, `player_maps`,
  `player_skills`, `player_profile`, `ap_unlocks`.
- **Season** — `comp_history`.
- **Actions** — `actions` (queue + result), `admin_audit`, `admin_sessions`, `staff`.
- **Events** — `events`, `event_history`, `event_winners`, `event_baselines`,
  `event_audit`.
- **Meta** — `meta` (key/value: `last_push`, `server_*`, `happy_hour`,
  `event_xp`, `event_coins`, `nonce:*`).
- **Catalog** — `catalog` (JSON blobs: `reward_track`, `skills`, `skins`,
  `models`, `cosmetics`, `achievements`, `events`, `hall_of_fame`).
- **Registration** — `reg_requests`.

`players` is authoritative only in the sense that it mirrors the game. Never
write to it from the web.

Backup is a file copy of `data/freenova_panel.sq3*` (the `-wal` and `-shm`
sidecars belong to it). Copy all three, or stop the process first.

---

## 8. Configuration

Game side (`cstrike/addons/amxmodx/configs/amxx.cfg`):

```
fnweb_enabled     1
fnweb_host        127.0.0.1        ; numeric IPv4 only
fnweb_port        8762             ; panel listen port
fnweb_path        /api/v1/server/stats
fnweb_secret      <shared secret>  ; must equal FNWEB_SECRET on the panel
fnweb_interval    30
fnweb_server_id   freenova-public-1
fnweb_url         http://leaderboard.fn-gaming.net
fnweb_public_host leaderboard.fn-gaming.net
fnweb_debug       0
```

Registration secret lives in `configs/freenova_registration.cfg`
(`freenova_reg_server_secret`), and the endpoint host/port in
`freenova_reg_api_host` / `freenova_reg_api_port`.

Panel side (`relay/relay.env`, loaded into `process.env` at boot):

| Key | Purpose |
|---|---|
| `FNWEB_SECRET` / `SYNC_SECRET` | Verifies `/api/v1/server/stats` |
| `REG_SECRET` | Verifies `/api/v1/game/v1/register` |
| `ADMIN_PASSWORD` | First-factor staff login for `/admin` (no default; unset = locked out) |
| `ADMIN_STEAMIDS` | Default owner identity |
| `DISCORD_WEBHOOK_URL`, `DISCORD_ADMIN_PING` | `/calladmin` and alert routing |
| `PANEL_URL` | Legacy relay target (unused in the live path) |

`PORT` (default 8080; the hosting assigns 8762) and `HOST` (default `0.0.0.0`)
control the listener. `PANEL_DB` points at a different database file for testing.

---

## 9. Operating it

- **Start:** `npm start` → `entrypoint.sh` → `node server_local.mjs`.
- **Port check:** `curl http://127.0.0.1:8762/` should return the hub page.
- **Freshness:** `SELECT value FROM meta WHERE key='last_push'` must advance every
  30 s. `server_online` flips to `1` on each push.
- **Logs:** process stdout (panel), `cstrike/addons/amxmodx/logs/L*.log` (game),
  `error_*.log` (AMXX runtime errors).
- **Deploy a panel change:** upload into `src/`, restart the Node process. The
  game needs nothing.
- **Deploy a game change:** upload the `.amxx`, then `changelevel <map>` — AMXX
  re-reads every binary and re-runs the configs. No full restart needed.
- **Schema:** `schema.sql` is applied idempotently at boot, and `handleSync`
  self-heals late columns. Never hand-edit `players`.

---

## 10. Invariants worth remembering

1. **One writer.** The game pushes; the panel mirrors. Any panel code that grants
   coins or stats is a bug.
2. **Two signature formulas.** Stats sign `hex(sha256(body))`; registration signs
   the raw body.
3. **Replay defence is the nonce table.** Reusing a nonce within 10 minutes is a
   `401`, even with a valid signature.
4. **Clock skew breaks pushes.** More than ±300 s and every push is rejected —
   check `date -u` against the panel.
5. **`socket_recv` returns signed bytes.** Any binary protocol parser on the AMXX
   side must mask with `& 255` before arithmetic; a length byte ≥ `0x80` is
   otherwise negative.
6. **The action token dies at UTC midnight.** "Invalid or expired session token"
   in the web UI usually means the page was opened before midnight.
7. **Never expose `/admin` in MOTD.** It is session-authenticated and not part of
   the short-code table.

---

## 11. Quick data-flow cheat sheet

```
player kills someone
  └─ game updates its own vault/SQLite
       └─ 30 s timer: snapshot JSON → sign → POST :8762
            └─ panel verifies → upserts players/player_weapons/... → meta.last_push
                 └─ page renders SELECT ... ORDER BY xp DESC
```

```
player clicks "equip skin" on the site
  └─ GET /profile...&t=<action token>
       └─ queueAction() → actions(status=pending)
            └─ next push response carries actions[]
                 └─ game re-checks ownership → applies → records result
                      └─ next push sends action_results[] → actions(status=done)
```
