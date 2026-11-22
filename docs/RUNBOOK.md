# Runbook — deploy, rotate, restore

Operational procedures for the FreeNova Classic server as it exists in this
snapshot. Every path is relative to the repository root. Anything that touches a
live host is marked **LIVE**.

Related: `SECRETS.md` (what is sensitive and why), `docs/ARCHITECTURE.md` (how the
pieces fit), `DEBUG.md` (what has actually been executed here).

## 0. Inventory

| Host (SFTP, port 2022) | Tree | What runs |
|---|---|---|
| `cmux305a200lt01pppogfv4wj@193.70.81.30` | `game-server/cstrike/` | HLDS + Metamod + AMX Mod X 1.10 + YaPB; plugins from `addons/amxmodx/plugins/` in `configs/plugins.ini` order |
| `cmuyj281s0c0i01p3edt001f0@193.70.81.30` | `web-panel/` | `server_local.mjs` (Node) + `data/freenova_panel.sq3` |

The SFTP servers reject recursive transfers (`sftp -r` → `not a regular file`).
Upload and download **one file at a time**. `sftp -b <file>` forces
`BatchMode=yes` and will not use a password — feed commands on stdin instead.

```sh
export SFTP_PASS='…' SSH_ASKPASS=/path/to/askpass.sh SSH_ASKPASS_REQUIRE=force
cd game-server
printf 'put cstrike/addons/amxmodx/plugins/battlepass_core.amxx cstrike/addons/amxmodx/plugins/battlepass_core.amxx\n' \
  | sftp -P 2022 cmux305a200lt01pppogfv4wj@193.70.81.30
```

`askpass.sh` is any script that prints `$SFTP_PASS`.

## 1. Deploy the panel (local Node runner — the live path)

```sh
cd web-panel
node test_harness.mjs          # must print "PASS panel smoke suite", exit 0
node --check server_local.mjs  # and every src/**/*.js
```

**LIVE** — start it the way the host does (no `PANEL_DB`, so it opens the live
tree's `freenova_panel.sq3`, and `relay/relay.env` supplies the secrets):

```sh
cd web-panel && FN_LOCAL_TRUST=1 node server_local.mjs
# [panel] SQLite /…/data/freenova_panel.sq3
# [panel] HTTP http://127.0.0.1:8080  (bind 0.0.0.0)
```

`FN_LOCAL_TRUST=1` is what lets a page mint the day action token, i.e. what
makes the buy/equip/claim buttons on the MOTD pages work. It is **off by
default** (`REVIEW.md` §9c): without it the panel is read-only for actions and
only game-minted `/u/<sid>/<slug>/k/<token>` links can queue anything. Set it
only for a panel that is reachable from the LAN/loopback, never for one on the
public internet.

Check after start:

```sh
curl -s localhost:8080/api/game/v1/health   # {"ok":true,…,"reg_configured":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/hub   # 200
```

`reg_configured:false` means `REG_SECRET` is empty and in-game `/register` is
disabled (fail-closed by design).

### Cloudflare Worker path (deployed, but not the current live path)

See `web-panel/README-DEPLOY.md`. Short version, from `web-panel/`:

```sh
npx wrangler login
npx wrangler d1 execute freenova-panel --remote --file=schema.sql   # first time
npx wrangler secret put SYNC_SECRET                                  # and REG_SECRET
npx wrangler deploy
```

Note `schema.sql` does **not** create `reg_requests`; `register.js` creates it on
demand (see `REVIEW.md` §3).

## 2. Deploy a plugin

1. **Compile.** Never upload a `.amxx` you cannot rebuild.

   ```sh
   tools/compile-plugins.sh                 # all 88, PASS/FAIL each, output in tools/build/plugins
   # one file, if the native compiler runs on your box:
   cd game-server/cstrike/addons/amxmodx/scripting
   ./amxxpc freenova_sync.sma -iinclude -otmp/freenova_sync
   ```

   The script uses the bundled `amxxpc` directly when it can run, and otherwise
   an `i386/debian:bookworm-slim` container (the snapshot host's seccomp filter
   kills every 32-bit process with SIGSYS — `DEBUG.md` §7).

2. **Review the diff.** A plugin behaviour change needs its own commit and a
   note in `REVIEW.md`; a `.sma` edit that changes balance needs operator
   sign-off.

3. **Upload per file** (see §0 for the stdin form):

   ```sh
   printf 'put cstrike/addons/amxmodx/plugins/<name>.amxx cstrike/addons/amxmodx/plugins/<name>.amxx\n' | sftp …
   # and the source, so the host can rebuild next time:
   printf 'put cstrike/addons/amxmodx/scripting/<name>.sma cstrike/addons/amxmodx/scripting/<name>.sma\n' | sftp …
   ```

4. **If the plugin is new**, add it to `configs/amxmodx/configs/plugins.ini` in the
   right position (load order matters: providers before consumers — see the
   comments in that file and `REVIEW.md` §5.3), then upload `plugins.ini`.

5. **Reload.** AMXX 1.10 re-reads every `.amxx` on map start:

   ```
   amx_map <current map>        # or from the console: changelevel <map>
   ```

   A server restart is not needed and is usually worse (it drops players).

6. **Verify.** In the server console: `amxx plugins` (no `bad load`), then for
   the sync plugin `amx_syncstatus` (or watch the panel log for an incoming
   `POST /api/v1/server/stats` and `meta.last_push` moving).

## 3. Rotate the HMAC secrets

Two pairs, and both sides must match exactly or every push is rejected:

| Pair | Panel side | Game side |
|---|---|---|
| sync HMAC | `relay/relay.env` → `FNWEB_SECRET` / `SYNC_SECRET` (and the Worker secret `SYNC_SECRET`) | `configs/amxx.cfg` → `fnweb_secret` |
| registration HMAC | `relay/relay.env` → `REG_SECRET` | `configs/amxx.cfg` + `configs/freenova_registration.cfg` → `freenova_reg_server_secret` |

**Order matters only in that a mismatch drops traffic silently.** Do it in one
window, this way:

1. Generate the new value locally (`openssl rand -hex 32`), never in a chat, a
   ticket or a commit.
2. **LIVE** — stop the outbound traffic so no player data is lost to 401s:
   set `fnweb_enabled 0` in `amxx.cfg` and `amx_rcon`-free: just edit the file
   and `changelevel`.
3. Write the new value on the **panel** side (`relay/relay.env`, or
   `wrangler secret put SYNC_SECRET`), restart the panel, confirm
   `/api/game/v1/health` still answers.
4. Write the same value on the **game** side (`amxx.cfg`, and for the
   registration pair also `freenova_registration.cfg`).
5. Set `fnweb_enabled 1`, `changelevel` again, and watch for the first accepted
   push (`meta.last_push` in the DB, or the panel log).
6. Rotate `ADMIN_PASSWORD` (panel staff login) and any Discord webhook at the
   same time — see `SECRETS.md`.

A 401 `invalid signature` after a rotation is almost always one stale copy:
`freenova_registration.cfg` repeats the registration secret and is easy to miss.
A 401 `timestamp outside replay window` is instead a clock problem (±300 s).

## 4. Restore from this snapshot

`MANIFEST-*.sha256` hold a sha256 per file.

```sh
cd /path/to/FreeNova-Classic-Server
sha256sum -c MANIFEST-web-panel.sha256 --quiet    # silent = all match
sha256sum -c MANIFEST-game-server.sha256 --quiet
```

Two files already differ from the manifests because this review fixed them
(`web-panel/relay/relay.js`, `game-server/…/scripting/freenova_teamxp.sma`); the
`integrity` workflow reports drift instead of failing for that reason.

**LIVE** — restore a subtree by uploading each file (never `put -r`):

```sh
cd game-server
find cstrike/addons/amxmodx/plugins -name '*.amxx' -type f \
  | sed 's|^|put |; s|$| &|' \
  | sftp -P 2022 cmux305a200lt01pppogfv4wj@193.70.81.30
```

For the panel, stop the Node process first, upload `src/`, `server_local.mjs`,
`schema.sql`, `seed_catalogs.sql` and `assets/`, then restore the database (§5)
before starting it again. Do **not** upload `data/*.sq3*` over a live one.

## 5. Database

**Backup on the host** (a copy of the three files taken while the panel runs is
not a consistent backup — the WAL holds recent commits):

```sh
sqlite3 data/freenova_panel.sq3 ".backup '/tmp/freenova-panel-$(date +%F).sq3'"
```

**Inspect a snapshot safely:** copy `.sq3`, `.sq3-wal` and `.sq3-shm` together
and query the copy. Opening the originals in place mutates the `-shm` file.

```sh
mkdir -p /tmp/dbcopy && cp -p web-panel/data/freenova_panel.sq3* /tmp/dbcopy/
sqlite3 /tmp/dbcopy/freenova_panel.sq3 'PRAGMA integrity_check;'   # -> ok
sqlite3 /tmp/dbcopy/freenova_panel.sq3 'SELECT count(*) FROM players;'
```

**Rebuild an empty panel DB:**

```sh
sqlite3 /tmp/fresh.sq3 < web-panel/schema.sql
sqlite3 /tmp/fresh.sq3 < web-panel/seed_catalogs.sql      # catalogs only
```

`player_maps`, `comp_history`, `ap_unlocks` and `catalog` are only ever filled
by push branches the plugin does not currently emit (`REVIEW.md` §3.6), so a
fresh DB is expected to have them empty.

## 6. Enable the bypass guard — monitor mode first

`bypass_guard` is the dev-cs.ru *Bypass Guard* chain: it decides whether a
joining client is allowed in, from its AS number, its country and an
IP-reputation lookup. It is **not loaded**: `plugins.ini` carries both load lines
commented out with an `M13-fullstack` note. Until 2026-11-22 the tree could not
even build it — the source and its third-party headers were missing from the
snapshot (`SOURCES.md`). All nine plugins now compile, and the chain is still
off, because two of its parts cannot run on this host at all (§6.1).

### 6.1 What the chain is made of, and what can actually run here

| plugin | role | needs | runs on this tree? |
|---|---|---|---|
| `bypass_guard` | the core: holds the lists, decides, kicks | `nvault` | **yes** |
| `bg_provider_geoip` | country code for an IP | `geoip` module + `data/GeoLite2-Country.mmdb` | **yes** — module loaded, DB present |
| `bg_provider_ip-api` | AS number from ip-api.com (no registration) | the **`grip`** module | **no** — no `grip_amxx_i386.so` in `modules/` |
| `bg_provider_iphub` | proxy/VPN verdict from iphub.info | `grip` + an API key | **no** — same missing module |
| `bg_provider_iphub_curl` | the same, over libcurl | the **`curl`** module | **no** — no `curl_amxx_i386.so` |
| `bg_provider_iphubclient` | the same, over the iphubclient module | `iphubclient` module | **no** — only `iphubclient_amxx.dll` (Windows) is deployed |
| `bg_supervisor` | ASN block list from PostgreSQL; kicks on a hit | `sqlx` + the PG bans DB | not yet — needs the bans stack the test profile strips |
| `ab_bypass_bridge` | lets Advanced Bans' IP bans feed the guard | `<postgres>`, `bypass_guard` | not yet — same PG dependency |

Only the country check can run on this host today; ASN and IP-reputation cannot,
because the modules they need are either absent or shipped only as Windows
`.dll`s. That is a fact about the deployed `modules/` directory, not about the
plugins. Installing i386 builds of `grip`/`curl`/`iphubclient` is a separate
decision with its own review — until then, enabling one of those four providers
buys a `bad load` and a runtime error per map for nothing (the old
`plugins.ini` comment records exactly that: `bg_provider_iphubclient`, "no keys
in iphub_api_keys.ini (RTE 1 every map)").

### 6.2 What bypass_guard needs

* **The country DB.** `data/GeoLite2-Country.mmdb` is present. It ages; refresh it
  before a real rollout.
* **An IPHub key**, one per line, in `configs/bypass_guard/iphub_api_keys.ini`.
  That file **exists in the repo and is empty** (0 bytes) — correctly so, because
  keys are secrets. Put the key on the host only, never in this repo; `SECRETS.md`
  lists what is in scope.
* **Its lists**: `configs/bypass_guard/{allowed_countries,banned_countries,ip_list,as_list}.ini`.
  `ip_list.ini` and `as_list.ini` are comments only. **`allowed_countries.ini`
  and `banned_countries.ini` are not** — they carry a live whitelist
  (RU, BY, UA, KZ, KG, MD, UZ, LV, LT, EE, GE, RO, AM, BG, AZ, TM, …) and a live
  blacklist (EG, GR, …) from the plugin's original owner. Those lists are a
  landmine: the first config that sets a country *mode* of 1 or 2 kicks every
  player whose country is on the wrong side of them, at connect. Leave both files
  alone and stay in mode `-1` until someone has decided what the policy is.
* **Its nvault** (`bypass_guard`, the SteamID immunity list) — created on first
  boot, no setup.
* **Logs**, at `addons/amxmodx/logs/bypass_guard/`: `CMD.log`, `ERROR.log`, and a
  per-month `MM.YYYY_DENY.log` / `MM.YYYY_ALLOW.log`.

### 6.3 Monitor mode — the exact settings for the first week

`bypass_guard` has no dry-run cvar. Monitor mode is therefore "enabled, and
nothing configuring it can reach a kick". Append this to `amxx.cfg`:

```cfg
// Beginning of bypass_guard monitor week 1 -- read-only, cannot kick.
bypass_guard_enabled 1
bypass_guard_country_check_mode -1   // ask geoip, log the answer, skip the verdict
bypass_guard_check_proxy 0           // no proxy provider can run here (see 6.1)
bypass_guard_kick_if_cant_check ""   // a failed check must never kick
bypass_guard_allow_steam 0           // let Steam clients be checked too, for the data
bypass_guard_show_url 0              // nothing is shown: nothing kicks
// End of bypass_guard monitor run.
```

and load **only** these two lines in `plugins.ini`, next to the existing
`; M13-fullstack` notes:

```ini
bypass_guard.amxx            ; monitor week 1 - see docs/RUNBOOK.md §6
bg_provider_geoip.amxx       ; the only provider that can run on this tree
```

Why each line:

* `country_check_mode -1` is the only mode that asks the geoip provider for a
  country and then **skips the verdict** — that is the difference between this
  and 0, which never calls the provider at all and so produces no data to judge
  the week by. Modes 1 and 2 kick on the lists in §6.2.
* `kick_if_cant_check ""` is what makes a provider outage harmless. See §6.5.
* `allow_steam 0` is deliberate: `1` would exempt exactly the clients whose data
  the week is meant to collect. Turn it on afterwards if the check list turns
  out to be all non-Steam.
* **`bg_supervisor` and `ab_bypass_bridge` stay out.** `bg_supervisor` calls
  `func_KickPlayer(... KICK_TYPE__SUPERVISOR)` on a block hit with no monitor
  equivalent, and both need the PostgreSQL bans stack.

### 6.4 What the week is judged on

* `logs/bypass_guard/*.DENY.log` — **must stay empty**. It is written only from
  `func_KickPlayer()`, so an empty file is proof that nothing kicked.
* `logs/bypass_guard/*.ALLOW.log` — one line per admitted player, with the reason
  (`[Legit Steam]`, `[Access Flags]`, `[SteamID Immunity]`, …). This is the data
  to size the policy with: how many players resolve a country, how many come back
  `N/A`, how many would have been caught by a whitelist.
* `logs/bypass_guard/ERROR.log` — provider failures (§6.5).
* `addons/amxmodx/logs/L<date>.log` — one
  `[BypassGuard] No provider for … — failing open` line per failure class.

Ship the cvar block in the seasonal config rather than editing and re-uploading
`amxx.cfg` twice: the block is already delimited by the two comment lines.

### 6.5 What a provider outage looks like

Fail-**open**, by code:

```
[Error] No one handle 'bg_get_geoip' request! Check your setup! Failing open.
```
in `logs/bypass_guard/ERROR.log`, plus, in the AMXX log,
`[BypassGuard] No provider for <fwd> — failing open (plugin stays loaded)`.
The joining player is let in and nothing else happens. A dead iphub, a 429 from
ip-api, a missing key file and a module that failed to load all arrive here.

The one way to turn an outage into a kick is `bypass_guard_kick_if_cant_check`
with the matching letter (`a` AS, `b` proxy, `c` country): that flag is read in
`func_KickPlayer()`'s failure cases, so **never set it before its provider has
run a clean week**. Empty is the only safe value while the chain is being
introduced.

### 6.6 Turning it on for real, when someone decides to

In this order, one step per restart: populate the lists deliberately (start from
the current files, which are someone else's policy) → `country_check_mode 1`
(or 2) → watch `DENY.log` for a day → only then consider `check_proxy`.
`bg_supervisor` last, and only with the bans stack live. Every step is
reversible by restoring the cvar block.

### 6.7 In the harness

The `freenova` profile (`cs16-linux-base/scripts/assemble.sh --profile freenova`)
strips the bans stack, and `plugins.ini` does not list the guard, so the smoke
boot has never exercised it. If you enable the two lines in §6.3 the smoke boot
will load them too — which is the cheapest check there is: `bypass_guard` with no
provider must print the fail-open line and keep the boot green. Today's recorded
result, chain disabled, is `all 67 plugins running` and `no runtime errors`.

## 7. Troubleshooting

| Symptom | First thing to check |
|---|---|
| Panel shows stale data; `meta.last_push` old | Is `fnweb_enabled 1`? Is the panel listening on the port in `fnweb_port`? Does a manual `curl` to `/api/game/v1/health` answer? |
| Push returns 401 `invalid signature` | Secret mismatch (see §3), or one side changed the signed path (`fnweb_path`). |
| Push returns 401 `timestamp outside replay window` | Clock skew > 300 s on either host. |
| Push returns 401 `replayed nonce` | The plugin reused a nonce; it must be unique per request. |
| Web purchase never applies | `actions` row status: `pending` (game not pushing) / `sent` (game got it, ACK missing) / `expired` (older than 1 h) / `failed` (game refused — read `result`). |
| `/register` says "Malformed response from forum server" | The reply must not be chunk-framed (fixed in `ecc07da`); check the panel version. |
| `/admin` login succeeds but shows nothing | The SteamID must exist in `staff` **and** `enabled=1`. |
| MOTD page is unstyled or overflows | It must render without flex/grid/`var(`; check with a GoldSrc user agent (`DEBUG.md` §3). |
| Plugin shows `bad load` | Missing native (`LibraryExists` provider not loaded) or a stale `.amxx`; compile it from this tree (§2). |

## 8. What this snapshot is not

The game install itself (maps, models, sound, sprites, WADs, HLDS binaries,
`steamapps/`) is **not** here, and neither are `node_modules/` or `.npm/` — see
`README.md`. A restore from this repository restores the *server logic and
config*, not the content.

---

## 9. Things deliberately retired (2026-11-22)

| Retired | Why | How to bring it back |
| --- | --- | --- |
| **`cs_havana`** | every load died with `Host_Error: ED_ParseEdict: Model '*239' failed to precache because the item count is over the 512 limit` (`cstrike/sys_error.log`, 6 times between Oct 26 and Nov 16). The two core dumps on the host came from it. | `mv cstrike/maps/_retired/cs_havana.* cstrike/maps/` - but only after the plugin precache count is cut, otherwise the next load kills the server again |
| **core dumps** (`core.15`, `core.16`, 418 MB) | the crash they recorded is understood and the map is retired; `cstrike/sys_error.log` is the useful artefact | re-enable cores (`ulimit -c unlimited` in the startup command) if a *new* crash needs a dump |
| **`fn_ban_file`** (`.sma` + `.amxx`) | disabled stale fork of `advanced_bans`: it registers the same four `CBan_*` natives and the same five `amx_ban*` commands | `git show <sha>^:game-server/cstrike/addons/amxmodx/scripting/fn_ban_file.sma` |
| **`freenova_chatcmds`** (`.sma` + `.amxx`) | never listed in `plugins.ini`, so its "load before freenova_panel" contract was void - dead weight | same recipe |

Ownership of bans stays: `postgres_engine` (transport) -> `advanced_bans`
(authoritative backend, owns the commands) -> `fn_bans` (high-level `fn_*` API and
audit). Nothing else registers ban commands.

Product decisions taken at the same time: **BP XP becomes its own ledger** (seeded
at 0 for everyone, VIP bonus applies), and **backups live in a separate private
repo** (`backup-freenova`), not in this one.
