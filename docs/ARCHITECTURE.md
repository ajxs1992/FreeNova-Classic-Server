# Architecture — how a player action reaches the panel

Two halves, one direction of authority: **the game server decides, the web panel
records and displays.** The panel never grants coins, XP or an entitlement; it
queues an *intent* that the game validates, applies, and reports back.

Everything below is grounded in the snapshot's code. Line numbers are from the
2026-11-22 snapshot plus the fixes listed in `REVIEW.md` §9.

## 1. The two halves

```
 ┌──────────────────────────── HLDS box ────────────────────────────┐
 │ AMX Mod X 1.10                                                    │
 │   battlepass_core.amxx   owns coins, XP grant, missions, shop     │
 │   freenova_vip.amxx      VIP tiers + nVault expiry                │
 │   freenova_*             cosmetics, achievements, competitive, …  │
 │   freenova_sync.amxx     the only plugin that speaks HTTP         │
 │        │ every fnweb_interval (30 s)                              │
 │        │ POST /api/v1/server/stats   (HMAC, HTTP/1.0)             │
 └────────┼──────────────────────────────────────────────────────────┘
          │ plain TCP, fnweb_host:fnweb_port (127.0.0.1:8762 today)
          ▼
 ┌──────────────────────────── panel box ────────────────────────────┐
 │ web-panel/server_local.mjs   Node http → worker.fetch()           │
 │   src/index.js       routing (MOTD short codes, products, API)    │
 │   src/sync.js        HMAC verify, upsert, action queue, scheduler │
 │   src/register.js    in-game forum registration                   │
 │   src/admin.js       staff control centre (session cookie)        │
 │   src/*.js           one module per product page                  │
 │        │                                                          │
 │        ▼                                                          │
 │ SQLite (WAL): web-panel/data/freenova_panel.sq3                   │
 │   (a Cloudflare Worker + D1 deployment of the same src/ exists;   │
 │    see README-DEPLOY.md — the local runner is the live path)      │
 └───────────────────────────────────────────────────────────────────┘
          ▲
          │ GoldSrc MOTD: http://<lan>:8080/m/<code>/<steam>.htm
          │ (MSIE 6 engine: no JS, no flex/grid, no CSS variables)
        player
```

## 2. Flow A — gameplay becomes a row on the panel (game → web)

1. A round event fires in a gameplay plugin (`battlepass_core`, `rsu_core`,
   `freenova_competitive`, …). XP/coins are awarded **in memory** and persisted
   to the plugin's own storage (nVault / SQLite under
   `addons/amxmodx/data/`) — the panel is not involved.
2. `freenova_sync.amxx` schedules `Task_Push` (`freenova_sync.sma:275`) every
   `fnweb_interval` seconds. It collects per-player counters into a JSON body:
   `players[]`, `action_results[]`, `server{}`, `event_results[]`
   (`:351`, `:519`, `:547-551`, `:1318`).
3. It connects to `fnweb_host:fnweb_port` over plain TCP (`:585`; the host must
   be a literal IPv4, `:757-778`) and sends:

   ```http
   POST /api/v1/server/stats HTTP/1.0
   Host: <fnweb_host>:<fnweb_port>
   Content-Type: application/json
   X-FreeNova-Server-ID: <fnweb_server_id>
   X-FreeNova-Timestamp: <unix seconds>
   X-FreeNova-Nonce: <unique per request, [\w.-]{1,64}>
   X-FreeNova-Signature: sha256hex(secret + ":POST:" + path + ":" + ts + ":" + nonce + ":" + sha256hex(body))
   Content-Length: <len>
   ```

   HTTP/1.0 is deliberate: the response is then close-delimited, and the
   plugin's validator rejects any `Transfer-Encoding` (`:819-821`).
4. `src/index.js:34-35` routes it to `handleSync` → `verifyGamePost`
   (`src/sync.js:74-115`): secret present, signature constant-time compared,
   `|now - ts| <= 300`, nonce unclaimed (the INSERT *is* the claim), then the
   nonce store is pruned.
5. `handleSync` upserts into SQLite (`sync.js:231-301`): `players` (64 columns),
   `player_weapons`, and full-replace `player_skins` / `player_models` /
   `player_skills`; an `ach_unlocked` bit flip inserts an `ap_unlocks` row; the
   whole batch is atomic (`src/sqlite_d1.js` `batch()`).
6. It writes `meta` keys (`server_map`, `server_players`, `last_push`, …), ticks
   the event scheduler (`sync.js:966-1042`), then answers:

   ```json
   {"ok":true,"stored":17,"server_time":1795354663,
    "events":[{"id":3,"metric":"wins","target":100,"scope":"individual",
               "reward_coins":500,"reward_viptier":0,"reward_vipdays":0,
               "min_score":1,"start_at":…,"end_at":…}],
    "actions":[{"id":42,"steamid":"STEAM_0:0:1","type":"buy_skin","arg":"ak47:3","attempts":0}]}
   ```
7. The plugin parses that (`:875-890`) and executes each action locally, then
   records a result to send back on the **next** push.

## 3. Flow B — a purchase on the web reaches the game (web → game)

```
player clicks "Buy" on /battlepass?…
  → the page calls queueAction(env, steamid, type, arg, token)   src/sync.js:635
      · validSteamid()                      (STEAM_x:y:z only)
      · checkActionToken()                  sha256(secret:act:steamid:unixDay),
                                            today or yesterday         :54-57
      · type in a fixed whitelist           (buy_skin, claim_bp, …)    :639
      · arg: string ≤ 64, no CR/LF/<>&"                                :641
      · de-dup on (steamid,type,arg) with status pending|sent          :645-648
  → INSERT INTO actions (status='pending')
        │
        │ next push (≤ 8 actions)
        ▼
  sync.js claims each row with a compare-and-swap on `attempts`, advertises
  only the rows it won, and marks them 'sent'                  sync.js:663-700
        │
        ▼
  freenova_sync validates the batch, then the owning plugin enforces it:
  coins are re-checked and spent game-side (the panel never debits)
        │
        ▼
  next push carries action_results[]: {id, ok, result}
        │
        ▼
  sync.js: UPDATE actions SET status='done'|'failed' WHERE id=? AND status='sent'
  A reply can be lost (relay timeout, map change), so a 'sent' row is
  advertised a second time on the next push - the game-side grants are
  idempotent (`wact#<id>`, REVIEW §9b `f138da2`), so the duplicate ACKs
  "already applied" instead of paying twice. Expiry waits for the attempts:
  'pending' after 1 h, 'sent' only once `attempts >= 2` (hard stop 2 h).
```

The panel is therefore a **queue of intents**, not a wallet. A player cannot buy
anything the game would refuse, and web-side tampering can at worst queue a
request that the game rejects.

## 4. Flow C — in-game registration

```
/register <user> <pass>  (freenova_registration.sma)
  → GET  /api/game/v1/health            unauthenticated; 2xx flips the plugin
                                        to FORUM_UP and enables the command
  → POST /api/game/v1/register          HMAC over the RAW body with REG_SECRET
      {request_id, steamid, name, …}
  ← {success, code, request_id, status:"pending", duplicate}
        handled by src/register.js, stored in reg_requests (a table that
        schema.sql does not declare — REVIEW §3)
```

## 5. Flow D — MOTD pages

The game builds `http://<panel>/m/<code>/<steam>.htm` (code `p t b i a v e r`)
and the MOTD browser fetches it. `src/index.js:60-99` re-packs the authid into
`STEAM_x:y:z`, stamps it on a **non-enumerable** `url._fnMotdSid` (a query
string cannot override it), maps the short code to a product route and sets
`?tab=`/`?from=` from the path. `?compact=1` — or a GoldSrc user agent — selects
the table-based skin with no flex, grid, CSS variables or JS.

Every page is server-rendered from the replica; nothing on a page mutates state
except the two GET-queued claims documented in `REVIEW.md` §4.1 H6.

## 6. Tables

| Table | Written by | Read by | Notes |
|---|---|---|---|
| `players` | `sync.js` upsert (game snapshot) | every product page | 84 named columns; `xp/level/rank_id` are the rank system's, `coins` is `battlepass_core`'s |
| `player_weapons` | `sync.js` (per-slot snapshot) | `/top?sort=weapon`, profile | slot 0-22 = `freenova_wpn.inc` |
| `player_skins` / `player_models` / `player_skills` | `sync.js`, full replace per push | store/cosmetics pages | replace-then-insert inside one atomic batch |
| `player_maps`, `comp_history`, `ap_unlocks`, `catalog` | `sync.js` **branches that the plugin never triggers** | profile, achievements | see `REVIEW.md` §3.6 |
| `actions` | `queueAction` (web), `sync.js` (status) | `sync.js` dispatch, status line | `pending → sent → done/failed/expired` |
| `meta` | `sync.js`, `admin.js` | every page (server name, map, online) | also holds the `nonce:*` replay guard and `login_fail:*` counters |
| `staff`, `admin_sessions`, `admin_audit` | `admin.js` | `admin.js` | session cookie is HMAC-signed and row-checked |
| `events`, `event_baselines`, `event_winners`, `event_history`, `event_audit` | `admin.js` (schedule), `sync.js` (scheduler + settlement) | `/events` | winners are `INSERT OR IGNORE` on `(event_id, placement)` |
| `player_profile` | `saveFeatured` | profile | featured medals, ownership re-checked |
| `reg_requests` | `register.js` | `register.js` | **not in `schema.sql`** — created on demand |

## 7. Endpoints

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/server/stats` | HMAC-SHA256, ±300 s, single-use nonce | `{players[], action_results[], server{}, event_results[]}` | `{ok, stored, server_time, events[], actions[]}` |
| POST | `/api/v1/server/admin-call` | same HMAC | `{steamid, name, message, map, hostname, players, humans, maxplayers}` | `{ok}` / `503` when no Discord webhook is configured. **No plugin calls this any more** (REVIEW §3.3) |
| POST | `/api/game/v1/register` | HMAC over the raw body (`REG_SECRET`) | `{request_id, steamid, name, …}` | `{success, code, request_id, status, duplicate}` |
| GET | `/api/game/v1/health` | none (by design) | — | `{ok, service, endpoint, reg_configured, time}` |
| GET | `/admin`, `/admin/*` | signed session cookie + CSRF token | form posts | HTML; staff actions write `admin_audit` |
| GET | `/m/<code>/<sid>[/<tab>].htm` | none | — | 302 to the product route (or 404 for `s`/`o`) |
| GET | `/u/<STEAM_x-y-z or x:y:z>[/<slug>][/k/<token>]` | none | — | long-form MOTD |
| GET | `/profile /top /battlepass /missions /achievements /tournament /vip /events /stats /settings /rules /icons /mapend` | none | `?steamid=`, `?t=`, `?tab=`, `?compact=1` | HTML |
| GET | `/shop /skins /models /cosmetics` | none | — | read-only landing pages (live, not retired — REVIEW §6) |
| POST | `/top15?theme=save` or `?theme=reset` | `X-FreeNova-Admin-Key` header, or `k` in the form body — never the query string | theme fields `t_<name>` | 302 on save, 403 without a key |

## 8. Trust boundaries

* **Game → panel** is signed; the panel trusts the signature and nothing else
  (`players[].steamid` is still shape-checked, `sync.js:41-43`).
* **Panel → game** is *not* signed the other way: the panel queues, the game
  re-validates. The action token (`sha256(secret:act:steamid:unixDay)`) only
  proves the request came from a page rendered for that player — it is a bearer
  credential for the day. Panel-side minting is therefore **opt-in**
  (`FN_LOCAL_TRUST=1`, `sync.js localTrustEnabled`): a deployment that does not
  set it only accepts game-minted `?t=` links, and a page asked to act without a
  token says so instead of doing nothing (`REVIEW.md` §9c).
* **Staff** write the top-15 theme with a key that is only read from a POST body
  or the `X-FreeNova-Admin-Key` header, never from a URL (`top15/page.js`), and
  the login lockout is keyed on the platform client address rather than on
  `x-forwarded-for` (`admin.js clientIp`).
* **Staff** authenticate with a password shared through `ADMIN_PASSWORD`, not a
  per-user credential; the session cookie is HMAC-signed with `SYNC_SECRET` and
  re-checked against `admin_sessions` on every request.
