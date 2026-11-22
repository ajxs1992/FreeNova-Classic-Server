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

## 6. Troubleshooting

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

## 7. What this snapshot is not

The game install itself (maps, models, sound, sprites, WADs, HLDS binaries,
`steamapps/`) is **not** here, and neither are `node_modules/` or `.npm/` — see
`README.md`. A restore from this repository restores the *server logic and
config*, not the content.
