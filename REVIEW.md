# REVIEW — FreeNova Classic Server (web panel + AMXX plugins)

Static and dynamic review of the 2026-11-22 snapshot (commit `c7f8ca2`, plus the
fixes landed in this review — see [§9](#9-fixes-applied-while-reviewing)).
Every finding cites a file and line of *this* repository. Where a claim was
verified by running something, `DEBUG.md` holds the command and its output;
where it could not be verified it is labelled as such.

**Verdict.** The game → panel push is byte-for-byte correct and demonstrably
works in production (the replica DB shows `last_push` moving and 15 players).
Everything else in the contract is held together by one-character details: the
registration reply is chunk-framed in a way the plugin cannot parse, a queued
action can be dispatched twice, several documented routes do not do what the
operator documentation says, and a handful of PAWN bugs can lose or duplicate
coins. None of it is a rewrite; the fixes in §9 are small.

## Contents

- [1. Severity summary](#1-severity-summary)
- [2. Top findings](#2-top-findings)
- [3. Panel ↔ plugin contract](#3-panel--plugin-contract)
- [4. Web panel findings](#4-web-panel-findings)
- [5. AMXX plugin findings](#5-amxx-plugin-findings)
- [6. Route and feature truth vs HUB.md](#6-route-and-feature-truth-vs-hubmd)
- [7. Structure and maintainability](#7-structure-and-maintainability)
- [8. Recommendations that need an operator decision](#8-recommendations-that-need-an-operator-decision)
- [9. Fixes applied while reviewing](#9-fixes-applied-while-reviewing)
- [9b. Applied since review](#9b-applied-since-review)
- [9c. Applied in round two](#9c-applied-in-round-two)
- [10. Unverified / could not confirm](#10-unverified--could-not-confirm)
- [11. Coverage](#11-coverage)

## 1. Severity summary

| Severity | Count | Where |
|---|---|---|
| Critical | 4 | registration reply framing; duplicate action dispatch; clutch pending-coin key aliasing; two XP ledgers presented as one |
| High | 15 | HMAC/action-token exposure, admin auth, stale-snapshot overwrite, coin overflow, reward idempotency, unbuildable plugin sources, dead planting mode, format-string crash vector, unrestored warm-up cvars |
| Medium | 35 | races, N+1 queries, GET mutations, doc drift, event scheduling, load-order assumptions, unverified deploy drift |
| Low | 30 | dead code, duplicate helpers, `.bak` sprawl, escaping of literal-only sinks, truncation |

Full detail follows. A finding that two reviewers reached independently is
marked **[cross-checked]**.

## 2. Top findings

### 2.1 `POST /api/game/v1/register` reply is chunk-framed and the plugin cannot parse it — every in-game `/register` looks like a failure **[cross-checked]**

`web-panel/server_local.mjs:118-122` (before this review) copied the Worker's
response headers verbatim, so Node chose `Transfer-Encoding: chunked` for
HTTP/1.1 clients. `freenova_registration.sma:1062-1084` finds the body at the
first `CRLFCRLF` and hands it to `json_parse`, which then starts with `5d\r\n`:

```
HTTP/1.1 200 OK
Transfer-Encoding: chunked

5d
{"success":true,"code":"OK",...}
0
```

The plugin answers *"Malformed response from forum server"* although the
account request was stored. The 30 s stats push escaped the same fate only
because `freenova_sync.sma:610` speaks **HTTP/1.0** and rejects any
`Transfer-Encoding` header outright (`:819-821`).

**Fixed** in `ecc07da` (explicit `Content-Length`); verified with a raw socket
probe — see `DEBUG.md` §4.

### 2.2 A queued action can be granted twice; one malformed action blocks the rest

`web-panel/src/sync.js:590-601`. The SELECT is not a claim: the UPDATE's row
count was ignored and every row that had been *read* went into the response.
Two overlapping pushes — the normal case when the game retries after the
relay's 10 s timeout (`relay/relay.cjs:57`) — returned the same action ids, and
the game applied each one twice. The set includes `claim_bp`,
`claim_tournament` and `srv_event_reward`, i.e. real coins.

The matching game-side problem is `freenova_sync.sma:924`: `ValidateSyncActions`
is all-or-nothing, so one malformed entry discards the other seven.

Panel side **fixed** in `70b6948` (claim-then-report). The plugin-half change
is a [recommendation](#8-recommendations-that-need-an-operator-decision) with a
patch, because the plugin is live and must not change behaviour without
operator sign-off.

### 2.3 Parked clutch coins are written under one shared, corrupted vault key

`freenova_clutch.sma:289` (verified), repeated at `:352` and `:403`:

```pawn
ClutchKey(cid, szPKey, charsmax(szPKey))
format(szPKey, charsmax(szPKey), "clutchpend#%s", szPKey)   // dst also the %s source
```

`format()` writes into the destination while consuming the format string, so by
the time `%s` is expanded the buffer already holds `clutchpend#`: the stored key
no longer contains the authid and is **identical for every player**. The one
mechanism that exists to avoid losing unpaid clutch coins is the one that
mixes them up. Recommendation (needs a rebuild + deploy): use two buffers.

### 2.4 "BattlePass XP" and "rank XP" are the same ledger while nine comments and two admin commands say they are separate

`battlepass_core.sma:4725-4747` implements `native_add_bp_xp` /
`native_add_bp_xp_once` as `crxranks_give_user_xp(...)`, and
`native_get_bp_xp`/`native_get_bp_tier` read `crxranks_get_user_xp/level`.
Consumers still document the opposite (`freenova_sync.sma:1797-1799`,
`freenova_panel.sma:3927-3931`, `freenova_hud.sma:151-155`,
`freenova_achievements.sma:272-278`). The `.bak` revisions show a real
`bpxp` vault ledger that was deleted; `freenova_hud.sma`'s "BP T" column can
therefore never differ from "Lv", and `fnvip_get_bp_multiplier`
(`include/freenova_vip.inc:52`) has zero call sites.

Consequence for an operator: `amx_givebpxp` + `amx_giverankxp` both move rank
XP. This is a product decision, not a patch — see §8.

## 3. Panel ↔ plugin contract

Endpoint table, both sides quoted. Everything here is read from the sender
(`*.sma`) and the receiver (`web-panel/src/*.js`).

| # | Method + path | Auth | Sender | Receiver |
|---|---|---|---|---|
| 1 | `POST /api/v1/server/stats` | HMAC-SHA256 over `hex(sha256(body))` | `freenova_sync.sma:585` (connect), `:596-613` (sig + headers) | `index.js:34-35` → `sync.js:74-115` (`verifyGamePost`), body `sync.js:231-301` |
| 2 | `GET /api/game/v1/health` | none (by design) | `freenova_registration.sma:194-196`, parse `:286-307` | `register.js:120-128` |
| 3 | `POST /api/game/v1/register` | HMAC-SHA256 over the **raw body** | `freenova_registration.sma:884-887`, sig `:862-866` | `register.js:208-270` → `verifyRegisterAuth` `:130-167` |
| 4 | `POST /api/v1/server/admin-call` | same as #1 | **no sender exists** | `sync.js:134-189` |
| 5 | `GET /admin`, `/admin/*` | signed session cookie | — | `admin.js` (`handleAdmin`) |

**Signature (both sides agree).** `X-FreeNova-Signature = sha256hex(secret +
":POST:" + path + ":" + ts + ":" + nonce + ":" + sha256hex(body))` —
`sync.js:94-95` on the panel, `freenova_sync.sma:596-607` in the plugin;
`X-FreeNova-Timestamp` must be within ±300 s (`sync.js:91`), nonce ≤ 64 chars
of `[\w.-]` (`sync.js:98`). Compare is constant-time-ish
(`sync.js:32-37`, `register.js:70-75`: length check, then an XOR loop — no
early exit on content).

**Body (plugin → panel).** Emitted at `freenova_sync.sma:351` (`players[]`),
`:519` (`action_results[]`), `:547-551` (`server{}`), `:1318`
(`event_results[]`). Read by `sync.js:199-200` (`players` must be an array),
`:439` (`action_results`), `:455` (`event_results`), `:426` (`catalogs`), `:413`
(`season_history`), `:586` (`server`), plus per-player `maps` (`:350`),
`ap_unlocks` (`:383`).

**Field names: 82 of the plugin's per-player keys match `sync.js` exactly; zero
name mismatches.** Unread by the panel: `bp_xp`, `bp_tier`. Read by the panel
and never sent: `catalogs`, `season_history`, `maps`, `ap_unlocks` (see 3.6).

**Response (panel → plugin).** `sync.js:625-641` returns
`{ok, stored, server_time, events[], actions[]}`; `freenova_sync.sma:875-890`
requires `ok === true` (JSONBoolean) and `actions` to be an array, and only
then reads `events` and `actions` (each action needs `id` JSONNumber and
`steamid`/`type`/`arg` JSONString, `:907-910`). `server_time`, `stored` and
`attempts` are ignored game-side — there is no clock-skew correction anywhere.

**Column contract.** `schema.sql` applied to an empty DB accepts every
statement `sync.js`/`register.js` runs: no missing column, no type mismatch for
the 64 columns of the `players` upsert. Two drifts remain:

| Drift | Detail |
|---|---|
| `reg_requests` is created on demand | `register.js:98-116` creates it, `schema.sql` never mentions it, so `npm run db:init` does not produce it. Works, but the schema is not the single source of truth it claims to be. |
| `player_maps`/`comp_history`/`ap_unlocks`/`catalog` are write-only | see 3.6 |

### 3.1 Will break on a config change: `fnweb_path`
`sync.js` used to hard-code the signed path while `register.js:209` derived it
from the URL; the plugin signs whatever `fnweb_path` is (`freenova_sync.sma:210`).
Editing that documented cvar would have 401'd every push with no diagnostic.
**Fixed** (`836eabb`) — both now derive the path from the request.

### 3.2 `fnweb_vhost` is inert on every path that exists today
`freenova_sync.sma:217-218,569-574` only rewrites the `Host:` header; it is not
set in `amxx.cfg:469-487`; the connect target must be a literal IPv4
(`:757-778`); the relay overwrites `Host` (`relay.cjs:55`); the local runner
routes on the path only (`server_local.mjs:86-88` → `index.js:25`). The comment
describing "CDN routing needs a hostname" is about a forwarder that is not
deployed. Doc fix only.

### 3.3 `POST /api/v1/server/admin-call` has no caller
`index.js:36-37` → `sync.js:134-189` is a signed endpoint nobody calls:
`freenova_calladmin.sma:419` posts to Discord directly (webhook URL from
`calladmin.cfg`), and `grep -rn "admin-call"` finds only `web-panel/`.
`plugins.ini:91` still claims `/admin` goes "via panel". Either delete the
route or repoint the plugin — operator decision (§8).

### 3.4 Float multipliers were truncated in server meta
`freenova_sync.sma:547-549` sends `event_xp`/`event_coins` as `%.2f`; the panel
stored them through `num()` (`parseInt`), so a 1.5× event displayed as 1×.
**Fixed** (`836eabb`), verified: `event_xp=1.5`, `event_coins=2.25`.

### 3.5 Port drift between the docs and the code
`amxx.cfg:473` dials **8762**; `relay/relay.cjs:32` defaults to **8787** and
`relay.env` has no `PORT`; `HUB.md:41` says 8080; `README-DEPLOY.md` says 80 via
the Cloudflare edge. Only one of those is true at a time and the docs do not say
which. See §6.

### 3.6 Four payload sections are read but never sent
`sync.js:413-423` (`season_history`), `:426-436` (`catalogs`), `:350-361`
(`p.maps`), `:383-392` (`ap_unlocks`). `grep` for those keys in
`freenova_sync.sma` returns nothing; the live replica has 0 rows in
`player_maps` and `comp_history` while `catalog` only holds rows from
`seed_catalogs.sql`. Not broken — silently empty features (map career, season
history, AP dates, game-pushed catalogs).

### 3.7 `action_results[].result` is not JSON-escaped
`freenova_sync.sma:523` interpolates the message raw into JSON. Every current
message is a fixed ASCII literal, so this is latent; one message containing `"`
would make the plugin's own body unparseable → `400 bad json` → the push is
never ACKed → 2.2 fires. Fix is a one-line `EscapeJson` call (suggested patch in
§8).

### 3.8 The action token is mintable panel-side on a *public* deployment
`sync.js:60-72` says "LOCAL-TRUST ONLY … before any public upload, stop deriving
tokens here", and `pages.js:145-150` derives the day token from `?steamid=`.
`relay/relay.log:1` records the live `*.workers.dev` host, and `wrangler.toml`
binds production D1 — so the deployment is not local. `GET
/events?steamid=<victim>&act=claim_event:7` queues an action for that player
with no session, no token and no signature. Tokens are
`sha256hex(secret:act:steamid:unixDay)` and `checkActionToken` accepts today
**and yesterday** (`sync.js:54-57`), so a leaked MOTD URL is a 24-48 h bearer
credential. Severity depends on whether the Worker is still reachable — treat it
as live until proven otherwise (§8).

## 4. Web panel findings

### 4.1 High

**H1. Stale snapshots overwrite newer ones.** `sync.js:250-266` — the `players`
upsert has no ordering guard (unlike the catalog upsert at `:433`, which uses
`WHERE excluded.version >= catalog.version`). A retried push or a second server
writes older counters back: XP/coins visibly roll back, `event_baselines`
rescore off the regressed row, `profile.js:278` computes a wrong server rank.
Fix: `WHERE excluded.last_seen >= players.last_seen` plus `MAX()` for monotone
counters. *Recommendation* (behaviour change, needs a decision about the
multi-server case).

**H2. The admin password is accepted as a GET parameter.**
`top15/page.js:8-12,19-30`: `staffOk()` compares `?k=` against
`ADMIN_PASSWORD` (falling back to `SYNC_SECRET`) with `===` — a credential in
URLs, in logs and in `Referer`, a non-constant-time compare, and the game's HMAC
secret on the same channel. The write itself is bounded (`normalizeTheme`
hex-validates colours). Fix: drive `theme=save` from the `/admin` session behind
a CSRF POST. *Recommendation* — the operator may rely on bookmarking the URL.

**H3. Unbounded request bodies were buffered before the HMAC check.**
`sync.js:78`, `register.js:212`, `server_local.mjs:99-103`. An unauthenticated
500 MB POST was fully materialised in memory. **Fixed** in `ecc07da` on the local
runner (2 MiB cap → `413`); the Worker itself still relies on Cloudflare's own
limits, hence the recommendation to add a `content-length` gate there too.

**H4. A disabled staff account was re-enabled by any visitor.**
`admin.js:305-311` ran on every `/admin` request, including anonymous GETs,
with `DO UPDATE SET enabled=1, role=excluded.role`. **Fixed** in `b2bc6be`
(`DO NOTHING`).

**H5. Event boards were ranked from a top-100-by-kills slice.**
`pages.js:3470-3481`. A "most wins" event only considered the 100 players with
the most kills. **Fixed** in `0e286fb`, verified with a two-player fixture.

**H6. Two live pages mutate state on GET.** `competitive.js:36-45`
(`?claim=`), `events.js:77-87` (`?act=claim_event:`). Prefetch or a crawler can
queue claims; combined with 3.8 it is the anonymous-write path. *Recommendation*
(POST + CSRF).

**H7. `player_models.model` is validated but `players.eq_model` is not.**
`sync.js:283` writes `str(p.eq_model, 48)` unvalidated while `:325` requires
`[a-z0-9_]{1,32}` before inserting the same value into `player_models` — a model
id with a dash appears as "equipped" but has no ownership row. Live data happens
to comply (`legend_ct`, `s1_vip_t`).

### 4.2 Medium

- **M1. Nonce store was a check-then-insert race** (`sync.js:101-105`).
  **Fixed** in `749ef3e`.
- **M2. Login throttle keyed on a client-controlled header.** `admin.js:60-64`
  trusts `x-forwarded-for`, which is attacker-supplied on the local runner, so
  the 5-attempt lockout (`:347-349`) is bypassable; each new IP also inserts a
  permanent `meta` row (`:336-343`) that is never pruned. No per-SteamID
  throttle exists.
- **M3. Action tokens leak through `Referer`.** Neither `ui.js:423-430` nor
  `top15/render.js:732-777` sends `Referrer-Policy`; pages carrying `?t=` also
  load third-party assets (`flagcdn.com` via `ui.js:74-79`) and Discord links.
- **M4. `sqlite_d1.js` batch was not atomic** while `sync.js:583` assumes D1
  semantics — a mid-batch failure could leave a player with an empty inventory
  (delete committed, insert not). **Fixed** in `fa3d119`.
- **M5. An action that expires while the game is processing it loses the
  result.** `sync.js:599-601` expires `('pending','sent')` after 1 h;
  `:443-445` only applies receipts to `status='sent'`. The player may have been
  charged while the panel shows "expired". Fix: accept receipts for
  `('sent','expired')` and audit the discard.
- **M6. Event settlement and the hall of fame scan every player.**
  `sync.js:909-920` (`SELECT * FROM players` + one baseline SELECT per player
  inside a push), `sync.js:1020-1025` (re-baseline per active event per push),
  `achievements.js:229` and `:101-107` (`SELECT *` + GROUP BY per render). Fine
  at 500 rows, a D1 timeout at 50 k. Fix: one JOIN, bounded queries, settle out
  of the push path.
- **M7. Two implementations of the same pages, already diverged.**
  `pages.js:3513` `pageEvents` vs live `events.js:34`; same for
  `pages.js:1887`/`missions.js`, `:2547`/`vip.js`, `:2017`/`competitive.js`,
  `:2287`/`achievements.js`, `:1784`/`battlepass.js`, plus `pages.js:2774`
  `pageStore`, `:3167` `pageModels` (no route at all) and `:213`
  `pageStatsViewer` (superseded by `top15/viewer.js`). Proof of drift:
  `pages.js:3671` returns `""` for a finished event where `events.js:65` returns
  `"past"`.
- **M8. `premiumExtraCoins` returns 0 for 57 of 60 tiers** (`bp_track.js:12-29`):
  the table only has entries for 50/52/60, everything else computes
  `0 - free` and clamps to 0.
- **M9. Events scheduled in local time while the form says UTC**
  (`admin.js:640-641`): `Date.parse("2026-11-22T20:00")` uses the server zone;
  `parseInt(start_at)` also accepts milliseconds as seconds.
- **M10. `flagsFor` treats any role string ≥ 10 chars as a flag set**
  (`admin.js:94-101`), and `hasFlag` is a substring test — a typo'd role grants
  whatever letters it contains.
- **M11. `settleEvent` pays `scope='global'` winners but `min_score` defaults to
  0** (`sync.js:935` uses `Math.max(1, …)`), so a global event pays every
  player with progress ≥ 1 — intentional? It is not documented anywhere.
- **M12. `profiles`/`top15` weapon slot table duplicated** (`ui.js:33-37` vs
  `include/freenova_wpn.inc`) — a slot renumbering on one side silently
  mislabels the other.

### 4.3 Low

- `notFound()`/`emptyState()` interpolated raw HTML (`ui.js:498,534`) —
  **fixed** in `9f48ce6`; all current callers passed literals.
- `sortHeader()` could never sort ascending (`ui.js:539`) — **fixed** in
  `9f48ce6` (helper is exported, currently unused).
- `num()` is `parseInt` (`ui.js:516`) and is the numeric cast for every
  money/XP column: `num("1e3")===1`, `num(1234.9)===1234`.
- Same helper, many copies: `esc()` ×3 (`ui.js:510`, `admin.js:36`,
  `top15/render.js:29`), `steamidOf()` ×8 (`pages.js:104`, `profile.js:13`,
  `battlepass.js:9`, `missions.js:7`, `vip.js:14`, `competitive.js:9`,
  `events.js:13`, `achievements.js:13`), `vipName()` ×2, and three
  *inconsistent* battle-pass tier formulas (`pages.js:23-28` uses track `need`,
  `battlepass.js:53-59` uses `track.xp_per_tier`, `profile.js:282-288`
  hard-codes `bpNeed = 1000`).
- `web-panel/src/top15/render.mojibake.bak` — a 49 KB editor backup inside `src/`.
- `relay/relay.log` is committed and records the production hostname.
- `staff.pin_hash` is never read or written (`schema.sql:234` admits it), so
  every staff row shares one `ADMIN_PASSWORD`.
- `parseCookies` decoded unguarded (`admin.js:77`) — a `%` in a cookie produced
  a 500. **Fixed** in `b2bc6be`.
- `catch { rankPos = 0 }` renders "Server rank #0" (`profile.js:276-280`).
- `LIMIT NaN` in `pages.js:3506` when `n` is NaN, hidden by `catch { return [] }`.
- Ops args built by string concat in `admin.js:536,545` instead of `applyArg`
  (`sync.js:848-852`), so a long type name truncates mid-field.

## 5. AMXX plugin findings

Severity is scoped by whether `configs/plugins.ini` loads the plugin: a bug in a
disabled plugin is a latent bug, a bug in a loaded one is live.

### 5.1 Critical

- **Clutch pending-coin key aliasing** — see 2.3 (`freenova_clutch.sma:289,352,403`,
  loaded at `plugins.ini:113`).
- **Two XP ledgers presented as one** — see 2.4 (`battlepass_core.sma:4725-4747`,
  loaded at `plugins.ini:81`).

### 5.2 High

- **Admin coin paths bypass the wallet cap → negative balance.**
  `battlepass_core.sma:2507` and `:2697` do `g_iCoins[target] += amount` with no
  clamp, while `native_add_coins` (`:4653-4659`) clamps at 2e9 exactly because a
  32-bit cell wraps. `amx_coins_give <p> 2100000000` twice, or two menu clicks
  past the cap, persist a negative wallet; the player can then never buy
  anything. Suggested patch in §8.
- **Web action grants have no idempotency key.**
  `freenova_sync.sma:1768-1865` (`give_coins`/`give_xp`/`give_vip`) dedupe only
  in RAM (`g_iActionResult*`, 16 slots, `:927-929`). A map change clears it
  while the panel still holds the action as `sent`; the resend grants again.
  `menabp_add_coins_once(id, amount, awardId)` already exists for exactly this
  (`battlepass_core.sma:4686`) and is unused here.
- **`freenova_randevent` cannot revert across a map change.**
  `freenova_randevent.sma:93-96` has no revert and the file has no `plugin_end`.
  An event firing before a map change leaves `fn_event_xp` (or `fn_double_xp`,
  `fn_happy_hour`) at e.g. 2.4× forever, and `AnyEventActive()` (`:132-148`)
  then makes every future event retry for ever.
- **`rsu_core` frees its SQL tuple while threaded saves are in flight.**
  `rsu_core.sma:712-741` (`ForceFlushAllDirty()` then `SQL_FreeHandle`) vs
  `freenova_competitive.sma:183-190`, which documents why that is unsafe.
  Worst case the last batch of player stats is never written.
- **32-bit VIP expiry overflow on 2028-01-20.** `freenova_vip.sma:2306-2318`:
  `expire = now + 315360000` (= a 10-year grant, reachable from
  `freenova_panel.sma:341,4550` and `freenova_sync.sma:1860` with
  `iDays <= 3650`) wraps negative after 2028-01-20; the grant then silently
  does nothing while the command prints success.
- **Two frames exceed the default AMX stack.**
  `freenova_registration.sma:821-887` (~5.3 K cells) and
  `freenova_calladmin.sma:305-424` (~5.3 K cells) have no `#pragma dynamic`,
  while five other plugins in the tree raise it. Symptom would be
  "Run time error 3: stack error" on the first `/register` or `/calladmin`.
  **Not compile-verified** (see §10) — this is an estimate from summing declared
  buffers.

### 5.3 Medium

- **The central chat gate always says "may speak"** — `fn_chat.sma:53` tests
  `LibraryExists("gagsystem")`, but the only gag provider registers
  `"freenova_gag"` (`freenova_gag.sma:182`). Latent today (no emitter calls the
  gate yet, `plugins.ini:32`'s "for adminchat" claim is stale), a real hole the
  moment a say-hook owner adopts it.
- **Achievement reward can be lost forever** — `freenova_achievements.sma:250-283`
  persists the unlock bit before the coins are durable, and `GiveAchievement`
  refuses to re-award.
- **VIP trial shop debits before it knows the grant worked** —
  `battlepass_core.sma:3695-3709`: `TrySpendCoins()` then an unchecked
  `fnvip_grant(...)`; if the VIP core is absent the player pays 1000-4000 coins
  for nothing. Compare the correct ordering in `freenova_sync.sma:1488-1513`.
- **Panel parked-coin flush credits first, clears the marker second** —
  `freenova_panel.sma:2436-2443`; a crash in between double-credits next join.
- **Competitive season prize: coins → RAM lock → async INSERT** —
  `freenova_competitive.sma:831-864`; a map change between the credit and the
  INSERT leaves the claim unrecorded and re-claimable.
- **`advanced_bans` never destroys its 7 dynamic arrays**
  (`advanced_bans.sma:432-478` vs `plugin_end` `:563-575`): 7 handles leak per
  reload, while `bypass_guard`/`fn_ban_file` do it correctly.
- **`plugins.ini` comments that are wrong** — `:19` claims `fn_ban_file`
  duplicates a *native* provider (it registers none; it duplicates five
  *commands*), and `:92` says `;freenova_sync.amxx superseded by non-blocking
  sync below` while `:111` is that same plugin. Reading the file top-down, sync
  looks disabled.
- **`freenova_sync` calls `fn_skins_*`/`fn_models_*` with no `LibraryExists`
  guard** (`:458-461,1874-1926`) and `plugins.ini` has no "must load before
  freenova_sync" note for `weapon_models` (`:94`). Works by luck of ordering.
- **`SQL_SetAffinity` is process-global** and five plugins flip it with no
  restore (`freenova_sync.sma:234`, `freenova_competitive.sma:251`,
  `freenova_season.sma:148`, `rsu_core.sma:1132,1154`,
  `advanced_bans.sma:3470`).
- **Two air-jump executors still coexist** — `freenova_vip.sma:509-538` now
  gates on `menabp_has_double_jump` and hard-caps `iMax` to 1, but `vip_jump`
  still documents `2 = triple` (`:260`), which is silently ignored.
- **Playtime milestone XP is not persisted at `plugin_end`** —
  `freenova_progression.sma:112-116` closes the vault without a final save, so
  milestones reached in the session are paid again next map.
- **`freenova_sync` interpolates the panel-supplied steamid into `server_cmd`**
  (`:1741-1765`) with only a length check, while the same file has
  `EvtAuthOk()` (`:1057-1067`) for exactly this. Loopback-only today.

### 5.4 Low

`.bak` sprawl (2 byte-identical copies, 6 stale beyond the BP-XP rewrite), tasks
registered with id `0` that can never be removed (`freenova_sync.sma:275`,
`fn_core.sma:53`, `freenova_registration.sma:143`), hardcoded `32` instead of
`MaxClients` (`freenova_sync.sma:1126,1185,1262`, `freenova_admin.sma:190`,
`freenova_teamxp.sma:63`), `plugin_end` closing vaults while self-rescheduling
tasks can still run (`freenova_gag.sma:222-229`, `freenova_admin.sma:151-157`,
`freenova_panel.sma:5008-5039`, `freenova_clutch.sma:46-51`), `freenova_calladmin`
having no `plugin_end` and detecting Discord success with
`contain(buf, "\"id\"")` over the first 600 bytes (`:443-446`), the catch-all
`set_native_filter` in `fn_chat.sma:23-27`/`fn_audit.sma:31-36` swallowing any
`fn_*` typo, and `freenova_missions.sma:499-527` treating a landed deposit as
failure when the balance is exactly 0.

### 5.5 Gap pass — the remaining custom plugins

These files were outside the first pass and were read in full afterwards
(~18 000 lines across 35 files, plus `plugins.ini` end to end). The stock AMXX
distribution is still deliberately excluded (§11).

**New High**

- **Planting a corpse is dead on every map — a load-order bug.**
  `rt_core.sma:81` caches `g_iPlantingPluginID = is_plugin_loaded("rt_planting.amxx", true)`
  inside `plugin_init`, and `:180` refuses every `MODE_PLANT` while that id is
  `INVALID_PLUGIN_ID`. `plugins.ini` loads `rt_core.amxx` at line 98 and
  `rt_planting.amxx` at line 103, so the answer is always "not loaded" and all of
  `rt_planting.sma` (plant cap, explosion damage, `rt_planting_cost`) is
  unreachable — silently, with no log line. Fix: move `rt_planting.amxx` above
  `rt_core.amxx`, or resolve lazily in `Corpse_Use()`.
- **Player name used as a printf format (server-crash vector).**
  `weapon_models.sma:2124` `client_printcolor(i, szAdminMsg)` where
  `szAdminMsg` was built with `formatex(…, "… !t%s …", szName, …)`. `client_printcolor`
  re-formats its argument (`:2690` `vformat(msg, charsmax(msg), fmt, 3)`), and
  CS 1.6 names may contain `%`: a player named `%s` who orders a custom skin makes
  a varargs mismatch read garbage cells as string pointers, broadcast to every
  admin. Fix: `client_printcolor(i, "%s", szAdminMsg)`. Same class, not loaded:
  `freenova_zgun.sma:764,944`.
- **`simple_warmup.sma` forces two cvars and never restores them.**
  `:68`/`:74` set `amx_knife_round_active 1` and `mp_freezetime 0`; only
  `restart()` restores them, and neither happens in `plugin_end`. A map change
  during the warm-up leaves `amx_knife_round_active 1` for the next map — every
  XP owner gates on it (`rsu_botxp.sma:100`, `freenova_teamxp`,
  `freenova_progression`, `rsu_matchstats.sma:253,290,396`), i.e. "nobody earns
  XP this map" — and `mp_freezetime` is pinned to the hardcoded `DEFAULT_FREEZETIME`
  because the next map's snapshot reads 0.

**New Medium** — `fn_bans.sma:164-171` writes the audit row, the session counter
and the `fn_ban_added` forward *before* `server_cmd()` reaches
`advanced_bans` (which may still reject the ban), and `:334` logs
"confirm failed" unconditionally before every successful confirm;
`rsu_matchstats.sma:543` binds `server_id = 0` while every other write uses
`rsu_server_id` (default 1), so the lifetime KAST/trade/ace flush matches no row
and the data is dropped; `:423` issues threaded SQL from `plugin_end`;
`postgres_engine.sma:545` can spin for ever if a failure callback re-queues
(`g_q_count` grows while draining), and `:247/305` has no `ST_BUSY` timeout, so a
stalled backend silently stops all bans after 48 queued queries;
`postgres_engine.sma:428-441` writes a password-derived MD5 to a fixed,
world-readable temp path and ignores `hash_file()`'s result (garbage password on
failure); `weapon_models.sma:1008-1021` debits coins and then judges the debit,
with no refund path; `reapi_healthnade.sma:412` plays the pickup sound when the
player already has ammo (`if (iPlayerAmmo)` should be `!iPlayerAmmo`);
`weaponmenu.sma:397-405` "expiry" never closes the menu and eats the choice;
`freenova_mapvote.sma:341-350` renders a nomination list into a 160-cell buffer
that eight 31-char names overflow (silent truncation);
`freenova_zgun.sma:330/336` reads its flag gate before the flag string is ever
populated (flag-only VIPs are denied for ever) and rewrites its own config file
on every map start, destroying operator edits (not loaded).

**New Low** — `rt_core.sma:438` integer division before `float()`;
`rt_effects.sma:271` `!=` where `||` was meant (a 7-char value without `#` is
parsed as hex, `"#123"` reads past the string); `weapon_models.sma:21`
redefines `MAX_PLAYERS`; `log_amx(szOut)` with a runtime string in
`freenova_zgun.sma:944`; `freenova_chatcmds.sma:210,244,282` passes raw say
text into `server_cmd` (not loaded, but the file documents a load-order contract
it cannot satisfy); `rt_revive_model.sma:36-51` forces `rt_force_fwd_mode 1`
permanently; `rt_restrictions.sma:234` charges money without re-checking the
account; `cban_screenshots.sma:126` reads `get_param(3)` unconditionally.

**Deployment drift the logs prove** — `logs/error_*.log` record
`postgres_engine.amxx`: `Run time error 10 (native "set_task")` /
`Function is not present (function "")`, and `weapon_models.amxx`:
`Run time error 10 (native "menu_display")`. Neither current source can produce
those errors (all `set_task` calls use literal function names; `menu_display` is
funnelled through `WmDisplayMenu()`). **The deployed `.amxx` binaries are older
than the `.sma` sources in this snapshot** — rebuild and redeploy those two, and
check `.amxx` mtimes against `.sma` for the rest (see `docs/RUNBOOK.md` §2).

## 6. Route and feature truth vs HUB.md

Probed against a live local runner (`DEBUG.md` §3). `HUB.md` is wrong in three
places and ambiguous in one.

| Claim in `HUB.md` | Reality | Evidence |
|---|---|---|
| "**Retired (404):** `/store`, `/shop`, `/skins`, `/cosmetics`, `/models`" (`:20`) | All five return **200** and render a read-only landing page (`index.js:195-199` → `gamepages.js:42-69`). Only the `?view=shop` form and `/u/<sid>/shop` 404 (`index.js:90,141`). `test_harness.mjs:41-43` asserts 200 for four of them, so the harness and the doc contradict each other. | `DEBUG.md` §3 |
| "`/panel` → **302** to `/profile`" (`:21,26`) | **200**, an internal rewrite (`index.js:101-116` sets `url.pathname` and falls through to the switch). The URL bar keeps `/panel`. | `DEBUG.md` §3 |
| "`/panel/<slug>` → canonical slug route" (`:33`) | True for the 9 known slugs; `/panel/<anything else>` is **200** with the profile page (`:115` `alias[rest] \|\| "/profile"`). | `DEBUG.md` §3 |
| "`s` and `o` short-codes return 404" (`:21`) | True (`index.js:67-68`). | `DEBUG.md` §3 |
| "`/m/b/<sid>/missions.htm` → 302 to `/m/i/<sid>/daily.htm`" (`:25`) | True, and `daily`/`weekly`/`completed` also redirect. | `DEBUG.md` §3 |
| "Legacy PHP stubs (`battlepass.php`, `rsu.php`) → **302** to this hub" (`:27`) | **200**, and `battlepass.php` renders the **Top 15** page, not the hub (`index.js:214-215`). | `DEBUG.md` §3 |
| "Product pages never link back to [the hub] (isolation)" (`:7,22`) | False: every product page carries `<a class='back2' href='/'>‹ Panels</a>`. The narrower rule that holds is "no cross-product links". | `DEBUG.md` §3 |
| "`.htm` required" (`:5`) | Optional — `/m/p/0-0-1` and `/m/p/0-0-1.htm` both 200. | `DEBUG.md` §3 |
| "`/u/STEAM_x:y:z/...` is the long form" (`README.md:217`) | Was **404** — the regex only accepted the packed dash form. **Fixed** in `6f4baeb`; both forms now work. | `DEBUG.md` §3 |
| "`GET /api/v1/server/stats` → 405" (task expectation) | **404** with an HTML page: `index.js:46-47` only 405s non-GET methods, so a GET falls through to `page404()`. A plugin probing a wiring mistake gets 13 KB of HTML. | `DEBUG.md` §4 |
| "`fnweb_port 8080`, sync pushes POST directly to `:8080`" (`:41`) | `amxx.cfg:473` says **8762**; `relay.cjs` defaults to 8787; the Cloudflare path used port **80**. Three numbers, none of them 8080. | `amxx.cfg:473`, `relay.cjs:32`, `README-DEPLOY.md:61` |
| "`/admin` is staff-only" (`:33`) | True: `index.js:31-32` routes to `admin.js`, which requires a signed session cookie (`admin.js:122-147`) — but see §4.1 H2 for the password-in-URL back door. | `DEBUG.md` §5 |
| MOTD compact skin | True: with a GoldSrc UA, `/profile` and `/m/p/…` contain no `display:flex`, `display: grid` or `var(`. | `DEBUG.md` §3 |

`HUB.md` was corrected for the first two rows as part of this review.

## 7. Structure and maintainability

**`.bak` revision sprawl in `scripting/`.** 14 source revisions + 3
`plugins.ini.*` + 3 `skins_menu.cfg.*`. Two are byte-identical to the current
file (`freenova_missions.sma.20261025-bpfix2.bak`,
`freenova_randevent.sma.bak-evtest-20261119`) and carry no information; the rest
record real changes (the deleted BP-XP ledger, the VIP-vs-BP jump
de-duplication, the achievement XP→coins change) that git history should carry
instead. The names promise a change each file does not reliably contain.

**Duplicate page renderers in the panel.** `pages.js` is 3 849 lines and still
contains superseded copies of seven products (see §4.2 M7). Only ~12 helpers
are imported from it today (`missionGroups`, `missionDone`, `badgeCabinet`,
`apUnlocksMap`, `pageActionToken`, the `event*` helpers). Every fix applied to a
live module leaves the copy in `pages.js` wrong, and one drift is already
visible.

**`web-panel/_backup_20261011/`.** 5.8 MB that duplicates nothing live *except
the tests*: `test_harness.mjs` (136 KB, a strict superset of the current 3.3 KB
smoke test), `test_sync_transport.mjs` (19 KB Pawn transport regression),
`test_bp_track.mjs`, `validate-icons.mjs`, plus `debug_store.mjs` (its
`import "./src/sync.js"` cannot resolve from that directory), `dbg_status.mjs`
(better-sqlite3 + a hard-coded Windows path), `legacy_php_stub.php`,
`start_panel.bat`, `scratch_tiers.json` and art. Nothing imports it.
**Recommendation: keep the tree (it is snapshot evidence) but move the two real
regression suites out of it and into `package.json`'s `test` script** — right
now the only automated check is a smoke suite that would not notice a broken
contract.

**Two 32-bit ELF binaries in the tree** (`scripting/amxxpc`, `amxxpc32.so`) with
no documented provenance; they are now used by `tools/compile-plugins.sh`, which
fixes that.

**The asset pipeline is not reproducible from this snapshot.** 42 absolute
Windows paths across 20 scripts (`DEBUG.md` §8) are one problem; the other is
that 18 of the `web-panel/scripts/*.mjs` import `sharp` for image slicing, and
`sharp` is not in `web-panel/package.json` (whose only dependency is
`wrangler` as a devDependency). Regenerating the icons/medals therefore needs an
undeclared native module of unknown version, and a few scripts reference inputs
that were never copied. Treat `assets/` as the source of truth and the scripts
as historical tooling until someone re-derives them.

## 8. Recommendations that need an operator decision

These are not applied, because they change behaviour, game balance, or a live
server. Each has a concrete patch.

1. **Make web actions idempotent game-side** (`freenova_sync.sma:1768-1865`).
   ```pawn
   new szAward[32]; formatex(szAward, charsmax(szAward), "webact#%d", iActId)
   if (menabp_add_coins_once(id, iAmt, szAward) == 0) { RecordActionResult(iActId, true, "already applied"); return }
   ```
2. **Patch the plugin half of 2.2** — `freenova_sync.sma:924`: skip and log a
   malformed action instead of failing the whole batch (`return false` →
   `continue` with a `RecordActionResult(id, false, "bad action")`), so one bad
   row cannot stall the queue. The panel side is already fixed.
3. **Clamp every coin write** (`battlepass_core.sma:2265,2273,2420,2429,2507,2697`):
   one `BpAddCoinsClamped()` used by all six sites.
4. **Pick one truth for BP XP vs rank XP** (§2.4): either delete the "separate
   ledger" claims and rename the panel entry, or restore the vault-backed `bpxp`
   ledger the `.bak` files show and wire `fnvip_get_bp_multiplier`.
5. **Restore the clutch pending key** (§2.3): two buffers, three call sites.
6. **Retire or gate the panel-side action token** (§3.8): mint only when the
   steamid came from `url._fnMotdSid`, or require `?t=` game-side. Also gate
   `GET /events?act=` and `GET /competitive?claim=` behind POST + CSRF.
7. **Remove the `?k=` admin password path** (`top15/page.js:8-30`).
8. **Add `#pragma dynamic 8192`** to `freenova_registration.sma` and
   `freenova_calladmin.sma` (recompile + redeploy).
9. **Decide the fate of `POST /api/v1/server/admin-call`** (§3.3): delete it, or
   repoint `freenova_calladmin` at it so the Discord webhook is not compiled into
   a `.sma`.
10. **Order the `players` upsert by `last_seen`** (§4.1 H1) once the
    multi-server question is answered (one server today, so the simpler
    `WHERE excluded.last_seen >= players.last_seen` is enough).
11. **`.bak` files**: keep as snapshot evidence, or delete and rely on git
    history. Two of them are already pure duplicates.
12. **Fee/licence question is open** — the repository has no `LICENSE`, and none
    was added here because the owner has not chosen one.

## 9. Fixes applied while reviewing

Each is its own commit, verified by a command recorded in `DEBUG.md` §9.

| Commit | File | What |
|---|---|---|
| `6a88f1c` | `web-panel/relay/relay.js` | Was unrunnable (`require` in a `type: module` package → `ReferenceError`); now a 2-line ESM entry point over `relay.cjs`. |
| `4808e96` | `.gitignore`, `.gitattributes`, `.editorconfig` | Repo hygiene; no global text normalisation because 918 of 3010 files are CRLF. |
| `4521483` | `tools/compile-plugins.sh`, `amxxpc` mode | Compile every `.sma`, native or in an i386 container; output to `tools/build`. |
| `6f0bce9` | `freenova_teamxp.sma` | Dropped an unused `#include <cromchat>` whose `.inc` is not in the snapshot; the plugin could not be rebuilt at all. 84 → 85/88 compile. |
| `ecc07da` | `server_local.mjs` | Explicit `Content-Length` (fixes the chunked `/register` reply, §2.1) and a 2 MiB body cap returning `413`. |
| `70b6948` | `sync.js` | Claim-then-report for queued actions (§2.2). |
| `749ef3e` | `sync.js` | Single-statement nonce claim (replay race). |
| `836eabb` | `sync.js` | Signed path derived from the request (§3.1); float event multipliers kept (§3.4 — landed in the same commit, whose message only describes the path change). |
| `08a9a5b` | `tools/compile-plugins.sh` | `ALLOW_FAIL` for the three sources that cannot build from the snapshot. |
| `b2bc6be` | `admin.js` | Disabled staff no longer resurrected by `GET /admin`; malformed cookies no longer 500. |
| `fa3d119` | `sqlite_d1.js` | `batch()` is atomic, as D1's is. |
| `9f48ce6` | `ui.js` | Empty-state sinks escaped; `sortHeader` finally toggles. |
| `0e286fb` | `pages.js`, `events.js` | Event boards ranked by the event's own metric (§4.1 H5). |
| `6f4baeb` | `index.js` | `/u/STEAM_x:y:z` (the documented colon form) no longer 404s. |
| `docs` | `HUB.md`, `README.md`, `docs/` | Route truth (§6), status, architecture and runbook. |

**Compile verification is possible on this host and was performed.**
`tools/compile-plugins.sh` runs the snapshot's own `amxxpc` inside an i386
container (the sandbox kills *every* 32-bit process with SIGSYS, which is what
the "exits 159" baseline was — see `DEBUG.md` §7). Result: **85 of 88 sources
compile cleanly with zero warnings**. The three failures are missing
third-party includes (`bypass_guard.inc` ×2, `easy_http.inc`), not source bugs.
The two plugins involved are disabled in `plugins.ini`, so nothing live is
affected — but `bypass_guard.sma` and `ab_bypass_bridge.sma` cannot be rebuilt
from this snapshot at all until those `.inc` files are recovered from the host.

## 9b. Applied since review

The plugin-side fixes `§5` and `§5.5` identified but deliberately left
unapplied. Each is one commit; every one rebuilt the plugin with
`tools/compile-plugins.sh` (which now has a `--only <name>` mode for exactly
this) and replaced the tracked binary in
`game-server/cstrike/addons/amxmodx/plugins/` in the same commit. Baseline and
final full-tree result are identical:

```
before: compiled: 85   failed: 3   allowed-failures: 3
after:  compiled: 85   failed: 3   allowed-failures: 3   (0 warnings in all 85 logs)
```

| Finding | File | Commit | Compile evidence (`--only`, 0 warnings) |
|---|---|---|---|
| §2.3 / §5.1 clutch pending key self-aliased | `freenova_clutch.sma` | `4c16413` | PASS; H1328 C13568 D11620 S16384; `freenova_clutch.amxx` 7402 → 8242 |
| §5.2 admin coin paths bypass the wallet cap | `battlepass_core.sma` | `7236da0` | PASS; H7016 C164752 D94900 S262144; `battlepass_core.amxx` 66315 → 66158 |
| §5.2 / §2.2 web grants not idempotent, one bad action poisons the batch | `freenova_sync.sma` | `f138da2` | PASS; H4928 C85996 D177980 S262144; `freenova_sync.amxx` 38540 → 39008 |
| §5.2 event cvar never restored across a map change | `freenova_randevent.sma` | `affe6da` | PASS; H704 C6600 D4148 S16384; `freenova_randevent.amxx` 4350 → 4445 |
| §5.2 SQL tuple freed under in-flight threaded saves | `rsu_core.sma` | `50bdeda` | PASS; H7392 C213632 D265284 S262144; `rsu_core.amxx` 93216 → 93103 |
| §5.2 32-bit VIP expiry overflow on 2028-01-20 | `freenova_vip.sma` | `ca4a340` | PASS; H4328 C91168 D82012 S65536; `freenova_vip.amxx` 40345 → 43720 |
| §5.2 frames exceed the default AMX stack | `freenova_registration.sma`, `freenova_calladmin.sma` | `402b61f` | PASS ×2; stack/heap 16384 → 65536 bytes (= 16384 cells); `freenova_registration.amxx` 21733 → 21632, `freenova_calladmin.amxx` 10540 → 11498 |
| §5.3 central chat gate tested a library nobody registers | `fn_chat.sma` | `04d99b2` | PASS; H520 C1176 D1068 S16384; `fn_chat.amxx` 1838 → 1809 |
| §5.5 player name used as the printf format | `weapon_models.sma`, `freenova_zgun.sma` | `da15da5` | PASS ×2; `weapon_models.amxx` 43569 → 43477, `freenova_zgun.amxx` 15812 → 17000 |
| §5.5 warm-up cvars never restored across a map change | `simple_warmup.sma` | `4dda65e` | PASS; H852 C2856 D2216 S16384; `simple_warmup.amxx` 2543 → 2719 |
| §5.3 achievement unlocked before its reward is durable | `freenova_achievements.sma` | `6af0278` | PASS; H1820 C27328 D12828 S16384; `freenova_achievements.amxx` 13360 → 13489 |
| §5.3 playtime milestones never saved at `plugin_end` | `freenova_progression.sma` | `b49af9d` | PASS; H1480 C14548 D6824 S16384; `freenova_progression.amxx` 8044 → 8913 |
| §5.3 seven dynamic arrays created and never destroyed | `advanced_bans.sma` | `739b719` | PASS; H3896 C106288 D534984 S16384; `advanced_bans.amxx` 56685 → 56711 |
| §5.5 H1 `rt_core` cached `is_plugin_loaded("rt_planting")` before it was loaded; plus the two wrong `plugins.ini` comments | `configs/plugins.ini` | `822fe44` | not a source (no compile); full tree unchanged at 85/3/3 |

`H`/`C`/`D`/`S` are the compiler's own header/code/data/stack-heap byte counts
from `tools/build/plugins/logs/<name>.sma.log`.

Operator decisions in §8 were **not** taken: BP-XP vs rank XP (§8.4), the four
premium-tier coin writes (§8.3), the action token (§8.6) and the `?k=` admin
password path (§8.7) are untouched. Deploy steps: `docs/DEPLOY-plugins.md`.

Four things measured while applying, which correct or extend the findings
above:

1. **`fn_ban_file.sma` does register natives.** §5.3 says `plugins.ini:19`
   claimed a native-provider duplication "it registers none". It registers four
   (`CBan_BanPlayer`, `CBan_UnbanPlayer`, `CBan_OffBanPlayer`,
   `CBan_AddBanPlayer`, `fn_ban_file.sma:409-412`) *as well as* the five
   `amx_ban*` commands (`:428-433`). The comment was fixed to say both; the
   conclusion (stale fork of `advanced_bans`) was right.
2. **`advanced_bans` leaks eight handles, not seven.** §5.3 counted seven; the
   fourth offban array (`g_off_seen`, `:401`) is the one missing.
3. **`amxxpc` 1.10.0.5467 is not byte-reproducible.** Two builds of one
   unchanged source gave 1808 and 1809 bytes with different hashes, so binary
   size deltas of a few bytes mean nothing; the compiler's `H/C/D/S` line is the
   stable evidence.
4. **`freenova_vip.amxx` grew 3375 bytes for a 16-line change** while the
   compiler reports +528 of code+data. A control patch of the same size in the
   same file also lands near 43.6 KB, so the jump is where amxxpc's image
   crosses a section boundary, not something this patch introduced.

## 9c. Applied in round two

The Medium/Low findings §5 and §5.5 left, plus the panel gaps in §8, applied
after round one went live. Round one's own changes are untouched, and three
tracked binaries turned out to be **stale relative to their sources** (see the
notes at the end). Twenty-two commits, `354280e..fef2c45`.

Plugin tree: `tools/compile-plugins.sh` before and after this round is
identical - `compiled: 85   failed: 3   allowed-failures: 3`, exit 0, and no
warning in any of the 88 logs. Every changed plugin was also built alone with
`--only <name>` and its rebuilt binary replaced the tracked `.amxx` in the same
commit. `H`/`C`/`D`/`S` are the compiler's header/code/data/stack-heap bytes
from `tools/build/plugins/logs/<name>.sma.log`.

| Finding | File | Commit | Evidence (`--only`, 0 warnings) |
|---|---|---|---|
| §5.5 lifetime KAST/trade/ace flush bound `server_id = 0` | `rsu_matchstats.sma` | `cc67250` | PASS; H1996 C20788 D29228 S16384; `rsu_matchstats.amxx` 12422 → 13413 |
| production log: `[FUN] Item "item_defuser" failed to create` + `give_item` run-time error, twice | `battlepass_core.sma` | `ecceae0` | PASS; H7044 C164928 D95104 S262144; `battlepass_core.amxx` 66158 → 66262 |
| §5.5 `/noms` joined 8×31 chars into `szList[160]`, negative max-length | `freenova_mapvote.sma` | `1e62a52` | PASS; H1936 C41428 D32324 S16384; `freenova_mapvote.amxx` 20451 → 19965 |
| §5.5 weaponmenu 15 s "expiry" never closed the menu and ate the click | `weaponmenu.sma` | `4c7daaa` | PASS; H1356 C13924 D8172 S16384; `weaponmenu.amxx` 7868 → 7478 |
| §5.5 "inverted pickup sound" - **not a defect**, see notes | `reapi_healthnade.sma` | `ee0ce82` | PASS; H2940 C30408 D14040 S16384; `reapi_healthnade.amxx` 14874 → 15979 (comment only; the tracked binary was stale) |
| §5.5 zgun read its flag string after the gate that needs it | `freenova_zgun.sma` | `0cb7f77` | PASS; H2176 C27024 D28916 S16384; 17000 → 17007 |
| §5.5 zgun deleted and rewrote its own config every map, and never exec'd it | `freenova_zgun.sma` | `007bdb3` | PASS; H2216 C27312 D27632 S16384; 17007 → 16806 |
| §5.5 weapon_models redefined `MAX_PLAYERS` | `weapon_models.sma` | `acbb14f` | PASS; H3392 C91708 D623308 S16384; 43477 → 43473 |
| §5.5 weapon_models spun 8 times with no delay waiting for an unlink | `weapon_models.sma` | `f2efc10` | PASS; H3392 C91548 D623304 S16384; 43473 → 43380 |
| §5.5 weapon_models debited coins then verified with no refund path | `weapon_models.sma` | `a7645b5` | PASS; H3392 C91616 D623796 S16384; 43380 → 43565 |
| §5.5 fn_bans counted/audited/announced a ban `server_cmd()` only queued | `fn_bans.sma` | `d1d90ec` | PASS; H1580 C26672 D16120 S16384; 11740 → 14581 |
| §5.5 fn_bans logged "confirm failed" before every attempt | `fn_bans.sma` | `ae01ad8` | PASS; same H/C/D/S; 14581 → 14588 |
| §5.5 postgres md5 temp file fixed + `hash_file()` unchecked | `postgres_engine.sma` | `17d01de` | PASS; H1372 C41152 D2043188 S131072; 33813 → 34032 |
| §5.5 `PgFailQueue` re-drained a queue a handler can re-grow | `postgres_engine.sma` | `1ab99bb` | PASS; H1372 C41276 D2043188 S131072; 34032 → 34082 |
| §5.5 no `ST_BUSY` query timeout although `g_q_start` is recorded | `postgres_engine.sma` | `f57594e` | PASS; H1392 C41876 D2043416 S131072; 34082 → 34358; new cvar `ab_sql_timeout` (20 s) |
| §5.5 rt_effects parsed a hex colour with `&&` instead of `||` | `rt_effects.sma` | `ff3018a` | PASS; H1376 C13348 D5500 S16384; 7471 → 7938 |
| §5.5 rt_core divided the ClCorpse origin by 128 in integer arithmetic | `rt_core.sma` | `f4c154a` | PASS; H2164 C21456 D15728 S16384; 11278 → 12814 |
| §5.5 `ab_bypass_bridge` logged a player name with SourceMod `%N` | `ab_bypass_bridge.sma` | `e8bcb7b` | **no binary committed** - `bypass_guard.inc` is not in the snapshot. Edit compile-checked against a throwaway stub include: H648 C3652 D3176 S16384 |
| §5.5 rsu_stats' header claimed the plugin is not loaded | `rsu_stats.sma` | `1bc16a3` | PASS; H312 C144 D708 S16384; 1122 → 981 (comment only) |
| §7 two `.bak` files identical to their source | `scripting/*.bak` | `cbd85bf` | deleted `freenova_missions.sma.20261025-bpfix2.bak`, `freenova_randevent.sma.bak-evtest-20261119`; 18 other revisions kept |
| §4.1 H1 stale snapshot rolls counters back (plugin half) | `freenova_sync.sma` | `96e9895` | PASS; H4928 C86056 D178040 S262144; `freenova_sync.amxx` 39008 → 39058 (adds `last_seen` per player) |

Panel: one commit, `fef2c45`, because `src/sync.js` carries four of the six
fixes in one region of the file. Verification for the whole commit:

```
cd web-panel && node test_harness.mjs
  PASS panel test suite (73 checks)          exit 0    (was 23 checks)
node --check over all 73 tracked JS files    0 failures
npm audit                                    found 0 vulnerabilities
```

| Finding | File | Test that covers it |
|---|---|---|
| §3.8/§8.6 `mintActionToken` was public | `src/sync.js`, `src/pages.js`, `src/competitive.js`, `src/events.js`, `server_local.mjs` | "no token minted without FN_LOCAL_TRUST", "anonymous claim page explains itself", "anonymous claim queued nothing", "trusted deployment queues the claim" |
| §4.1 H1 stale push (panel half) | `src/sync.js` | "stale push did not lower xp/coins", "newer push applied" |
| §4.2 M5 a `sent` action is never re-dispatched | `src/sync.js` | "a lost reply is re-dispatched once", "no third dispatch", "receipt closes a re-dispatched action", "dispatches stay inside the attempts budget", "sent row with attempts left is not expired" |
| §4.1 H2/§8.7 admin password in a GET parameter | `src/top15/page.js`, `src/index.js` | "GET admin key refused", "GET admin key changed nothing", "POST with header key accepted", "POST with body key accepted", "wrong key refused" |
| §4.2 M2 lockout keyed on `x-forwarded-for` | `src/admin.js`, `server_local.mjs` | "lockout survives a rotated x-forwarded-for", "expired login_fail counters are pruned" |
| §4.2 M3 token URLs without a referrer policy | `src/index.js` | "token URL sends no-referrer", "plain page sends no referrer policy" |
| §4.2 M8 `premiumExtraCoins` returned 0 for 57/60 tiers; §4.3 profile hard-coded 1000 | `src/bp_track.js`, `src/profile.js` | "premium table covers most tiers", "premiumExtraCoins(1)/(50)/(4)", "xpPerTier follows the track" |
| §4.1 H3 unbounded body before the HMAC check (Worker path) | `src/sync.js`, `src/register.js` | "oversize push refused with 413", "runner body cap refuses 3 MB" |
| §4.2 M4 `sqlite_d1.batch` atomicity (round one's fix, regression test) | `src/sqlite_d1.js` | "failing batch throws", "failing batch rolls back" |

### A finding that was wrong

`reapi_healthnade.sma:412` `if (iPlayerAmmo)` is **correct**; negating it would
be a bug. Upstream (github.com/Giferns/HealthNade, `reapi_healthnade.sma` on
`main`) has the same test. The two branches of `touch_healthnade_drop()` are not
equivalent: when the player already owns the nade, `giveNade()` calls
`giveAmmo()`, which writes `m_rgAmmo` directly and never reaches the engine, so
the plugin must make the sound; when the player has none, `giveNade()` creates
the item and calls `DLLFunc_Touch`, and the engine plays the same
`items/gunpickup2.wav` from `CBasePlayerItem::DefaultTouch` (ReGameDLL_CS
`weapons.cpp:650`). Flipping the test would double the sound on a fresh pickup
and silence the top-up. A comment now records this.

### Four things this round measured

1. **Three tracked `.amxx` binaries were stale relative to their sources** -
   `reapi_healthnade.amxx` (14874 tracked, 15979 built from the committed
   `.sma` *before* any change), `fn_bans.amxx` (11740 tracked, 12912 built) and
   `rt_core.amxx` (11278 tracked, 11894 built). REVIEW §5.5's "deployment drift"
   applies to more than `postgres_engine` and `weapon_models`: the binaries in
   this tree cannot be assumed to be what the hosts run. Measured by compiling
   `HEAD`'s source and my edit back to back; each of those three is rebuilt and
   in the deploy list as a consequence.
2. **`ab_bypass_bridge.sma` cannot be shipped from this snapshot.** It needs
   `bypass_guard.inc`, which is not in the tree, so no `.amxx` is committed for
   `e8bcb7b` (the plugin is omitted from `plugins.ini` anyway). Rebuilding it
   needs the include from the host.
3. **`fn_bans` now needs `advanced_bans`' own reports to count a ban.** It hooks
   `CBan_OnPlayerBannedPost` (live bans, fired after `AddBan`) and
   `CBan_OnAddBan` (offline/IP). A ban the backend refuses is audited as
   `ban.not_landed` instead of `ban.add`. Known window: `CBan_OnAddBan` is
   fired *before* the offline row is stored, so a DB failure after it is still
   counted. No plugin in this tree consumes `fn_ban_added` or `fn_ban_count`.
4. **The panel's free-lane coin table does not match the game's.** For the
   premium column the panel now mirrors `battlepass_core.sma`
   `g_iBpPremiumCoins` exactly, but `bp_track.js:3-7` (`FREE_COINS`) still holds
   different numbers from `g_iBpFreeCoins` (e.g. tier 2: panel 50, game 0), and
   the game-pushed `reward_track` catalog states a third set for the big tiers
   (tier 50 premium 3,000c vs the code's 1,950c). Only the panel's/world's
   *display* is affected - the game is the payer - so this stays a
   recommendation (§8.13) rather than a change made here.

### New operator decisions this round created

13. **`FREE_COINS` vs `g_iBpFreeCoins` vs `seed_catalogs.sql`** (measured above):
    pick which one `/battlepass` should display. Mirroring `g_iBpFreeCoins` is a
    small change to `bp_track.js`, but it changes what players are promised.
14. **`FN_LOCAL_TRUST` must be set on the LAN panel to keep in-page actions.**
    The token gate is default-off, so after this round a panel without
    `FN_LOCAL_TRUST=1` renders read-only action buttons (game-minted `?t=` links
    still work). That is the intended default; the operator has to decide to opt
    the LAN deployment back in.
15. **The `?k=` theme editor is now POST-only** (§8.7 taken, in the narrow form:
    body/header + constant-time compare, not a `/admin` session). A bookmarked
    `GET /top15?theme=save&k=...` now returns 403 with an explanation; the curl
    equivalent is in `docs/DEPLOY-plugins.md` §10.

## 10. Unverified / could not confirm

1. **`hash_string` hex case — resolved by inference, not by source.**
   `freenova_sync.sma:602` embeds the inner digest in the signed string and
   `sync.js:94-95` recomputes it lowercase; if AMXX emitted uppercase, *every*
   push would 401. Three independent signals say it is lowercase:
   (a) the live replica shows accepted pushes (`meta.last_push` moving, 15
   players); (b) `dlls/amxmodx_mm_i386.so` contains exactly one hex table,
   `0123456789abcdef`, and no uppercase table (`grep -c` = 1 / 0);
   (c) that binary exports `_ZZN6SHA2567getHashEvE7dec2hex` — the static
   `dec2hex` table inside `SHA256::getHash`, i.e. the very array used to render
   the digest. Still not a source read: confirm with one `fnweb_debug 1` log
   line if a push ever starts 401-ing for no visible reason.
2. **Stack-frame sizes** (§5.2): summed from declarations, not from compiler
   output. The compiler does not report frame size.
3. **`json_parse` strictness** — inferred from the JSON module contract, not
   executed on a real HLDS. One `/register` attempt against a fixed panel would
   settle it.
4. **Whether the public Worker is still reachable.** `wrangler.toml` binds a real
   D1 database and `relay.log` records a `*.workers.dev` host, but nothing in
   this repo can prove the deployment still exists. §3.8's severity depends on
   that.
5. **`REG_SECRET` in a Worker environment** — `register.js:83-86` falls back to
   `process.env.REG_SECRET`, which does not exist inside a Worker; only an
   `env.REG_SECRET` binding works. `wrangler.toml` documents only `SYNC_SECRET`,
   so unless an operator also ran `secret put REG_SECRET`, registration answers
   `503 REGISTRATION_DISABLED` on the Worker path.
6. **Live-DB schema drift** — the replica is a WAL copy taken while the panel was
   running (see `DEBUG.md` §6); it is authoritative enough for column names, not
   for row-level truth.

## 11. Coverage

**Read and reviewed (panel, 32 modules + 5 support files):** `src/index.js`,
`sync.js`, `register.js`, `admin.js`, `ui.js`, `sqlite_d1.js`, `pages.js`
(route table, money/XP/mission/event blocks, all SQL, escaping), `hub.js`,
`gamepages.js`, `ranks.js`, `icons.js`, `missions.js`, `vip.js`, `battlepass.js`,
`bp_track.js`, `bp_perk_track.js`, `profile.js`, `achievements.js`,
`competitive.js`, `events.js`, `catalogs.js` (exports + data shape),
`src/top15/{page,query,meta,store,viewer,mapend,theme,render,premier}.js`,
`server_local.mjs`, `relay/relay.js`, `relay/relay.cjs`, `test_harness.mjs`,
`schema.sql`, `seed_catalogs.sql` (structure), `wrangler.toml`, `package.json`,
`entrypoint.sh`, `scripts/*.mjs`/`*.py` (hard-coded paths and rot only).

**Read and reviewed (plugins, 65 sources):** the 30 FreeNova/`fn_*`/`rsu_*`/`advanced_bans`
sources listed in §5.1-5.4, plus the 35 read in the gap pass (§5.5):
`freenova_ads`, `freenova_chatcmds`, `freenova_flash`, `freenova_help`,
`freenova_topbar`, `freenova_zgun`, `freenova_hud`, `freenova_prefs`,
`freenova_roundmusic`, `freenova_mapvote`, `rsu_botxp`, `rsu_mapend`,
`rsu_stats`, `rsu_matchstats`, `rsu_crx_compat`, `postgres_engine`,
`ab_bypass_bridge`, `freenova_http_probe`, `revive_bridge`, `simple_warmup`,
`stats_logging`, `cban_screenshots`, `fn_bans`, `weapon_models`, `weaponmenu`,
`reapi_healthnade`, `reapi_test` and the whole `rt_*` stack (all eight are
loaded), plus `configs/plugins.ini` (whole file), `configs/amxx.cfg` (key names
only), `configs/rank_system_ultimate.ini`, `configs/freenova/vip.cfg`,
`configs/vipConfig.cfg`, `configs/freenova.cfg`, and
`scripting/include/*.inc` where a native's arity mattered.
`bypass_guard.sma` (3 032 lines, disabled, third-party) was audited at
grep level only: array create/destroy and forward balance are correct.

**Deployment gap worth stating once:** `freenova_flash.sma` claims to be the
single owner of `ScreenFade` for team-flash blocking and VIP flash reduction, and
it is **not loaded**, so those features are simply not running. `freenova_zgun`,
`freenova_chatcmds`, `freenova_topbar`, `rsu_botxp`, `rsu_mapend`,
`freenova_http_probe`, `stats_logging` and `reapi_test` are likewise not loaded;
each source was still reviewed, and findings in them are marked as latent.

**Deliberately not reviewed:** the stock AMXX distribution plugins (`admin.sma`,
`admincmd.sma`, `plmenu.sma`, `mapsmenu.sma`, `menufront.sma`, `cmdmenu.sma`,
`adminchat.sma`, `adminvote.sma`, `adminhelp.sma`, `adminslots.sma`,
`antiflood.sma`, `imessage.sma`, `mapchooser.sma`, `nextmap.sma`, `timeleft.sma`,
`multilingual.sma`, `pausecfg.sma`, `pluginmenu.sma`, `scrollmsg.sma`,
`statscfg.sma`, `statsx.sma`, `csstats.sma`, `miscstats.sma`, `restmenu.sma`,
`telemenu.sma`, `weaponmenu.sma`, `parachute.sma`, `stats_logging.sma`). They
are upstream code, unmodified as far as this review can tell, and a bug in them
is an AMXX bug rather than a FreeNova one. If a stock plugin is ever patched,
that patch — not the file — needs review.

**Not reviewed at all:** `web-panel/assets/**` (binary art), `data/*.sq3`
(row-level content beyond the schema/integrity checks in `DEBUG.md` §6),
`seed_catalogs.sql` row content, `amxmodx/data/**` (plugin-written vaults and
SQLite files), and the compiled `.amxx` binaries (no reflector in this
environment).
