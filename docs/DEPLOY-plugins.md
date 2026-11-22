# Deploy the plugin fixes — CS 1.6

What to upload, where, and how to put it back. This covers **only** the plugin
source/binary changes from `REVIEW.md` §9b (commits `4c16413..822fe44`). No
secret, cvar, `amxx.cfg`, `calladmin.cfg`, `freenova_registration.cfg` or
`configs/users.ini` changed, and nothing here rotates anything — the owner
rotates the HMAC pairs separately (`docs/RUNBOOK.md` §3).

Related: `docs/RUNBOOK.md` §0 (inventory, SFTP rules), §2 (deploy a plugin),
§3 (rotate), §4 (restore), and `REVIEW.md` §9b (what each change was).

---

## 1. Build first — do not upload a `.amxx` you cannot rebuild

```sh
tools/compile-plugins.sh                      # all 88: 85 PASS / 3 allowed-failures / 0 warnings
tools/compile-plugins.sh --only freenova_sync # one plugin, same runner and output layout
```

Output: `tools/build/plugins/<name>.amxx` (gitignored) and
`tools/build/plugins/logs/<name>.sma.log` (compiler header/code/data sizes,
warnings). The script needs the bundled 32-bit `amxxpc`: native if this host can
run i386, else the `i386/debian:bookworm-slim` container (`AMXX_IMAGE=` to
override). Baseline for this tree is exactly:

```
compiled: 85   failed: 3   allowed-failures: 3
```

The three failures are missing third-party includes (`bypass_guard.inc` ×2,
`easy_http.inc`), not source bugs; both plugins are disabled in `plugins.ini`.

**amxxpc 1.10.0.5467 is not byte-reproducible.** Two builds of the same source
in the same second were measured at 1808 and 1809 bytes with different hashes.
Compare compiler-reported sizes, not checksums, and do not treat a few bytes of
difference as a source difference.

---

## 2. What to upload

Upload both halves for every plugin: the `.amxx` (what HLDS loads) and the
`.sma` (so the host can rebuild without this repo). Sizes are from the builds
committed in this repo; `tools/build/plugins/` holds the same files.

| Plugin | was | now | sha256 (first 16) | Finding |
|---|---|---|---|---|
| `freenova_clutch.amxx` | 7402 | 8242 | `3ee49b19943ac90a` | §2.3 — parked-coin vault key was self-aliased |
| `battlepass_core.amxx` | 66315 | 66158 | `42e271b3b58d9342` | §5.2 — admin coin grants now clamp at 2e9 |
| `freenova_sync.amxx` | 38540 | 39008 | `760dbbd3423202e7` | §5.2/§2.2 — web grants idempotent, batch no longer poisoned |
| `freenova_randevent.amxx` | 4350 | 4445 | `a8aac969ca231211` | §5.2 — event cvar restored on unload |
| `rsu_core.amxx` | 93216 | 93103 | `b0e5737a8c88b75b` | §5.2 — SQL tuple no longer freed under threaded saves |
| `freenova_vip.amxx` | 40345 | 43720 | `bb10b370c94b402d` | §5.2 — grant expiry saturates instead of wrapping |
| `freenova_registration.amxx` | 21733 | 21632 | `24ef90fd9bbc4fd7` | §5.2 — `#pragma dynamic 16384` |
| `freenova_calladmin.amxx` | 10540 | 11498 | `f85cbf00f205fb48` | §5.2 — `#pragma dynamic 16384` |
| `fn_chat.amxx` | 1838 | 1809 | `f153191221d84a31` | §5.3 — gag gate tested the wrong library name |
| `weapon_models.amxx` | 43569 | 43477 | `fe72994ed59c1d1a` | §5.5 — player name was the printf format |
| `freenova_zgun.amxx` | 15812 | 17000 | `54ad5830de43f04d` | §5.5 — same class; **this plugin is not loaded** |
| `simple_warmup.amxx` | 2543 | 2719 | `8b8fcdcddb468199` | §5.5 — warm-up cvars restored on unload |
| `freenova_achievements.amxx` | 13360 | 13489 | `4ee91760a6f13ce0` | §5.3 — reward paid before the unlock is persisted |
| `freenova_progression.amxx` | 8044 | 8913 | `07f42e09a77c47a3` | §5.3 — milestones saved at `plugin_end` |
| `advanced_bans.amxx` | 56685 | 56711 | `6953e52f145e994f` | §5.3 — array handles destroyed in `plugin_end` |

Plus **one config file** — this one changes load order, so it must go up with
the binaries or corpse-planting stays dead (`REVIEW.md` §5.5 H1):

| Config | Why |
|---|---|
| `configs/plugins.ini` | `rt_planting.amxx` moved **above** `rt_core.amxx` (rt_core caches `is_plugin_loaded("rt_planting.amxx")` in `plugin_init`); two wrong comments corrected |

Upload path inside the game tree: `cstrike/addons/amxmodx/configs/plugins.ini`
(AMXX configs live under `addons/amxmodx/configs/`, *not* `cstrike/configs/`).

---

## 3. Which servers

The panel lists three CS 1.6 servers:

| Panel name | Panel / SFTP account | This tree? |
|---|---|---|
| **CS 1.6 Vanilla** | `cmux305a200lt01pppogfv4wj` | **Yes** — this repo *is* the backup of that server's `game-server/cstrike/` |
| **CS 1.6 Zombie** | `cmux3jjdq00tj01pp8offikdi` | No — different plugin tree, not in this repo |
| **CS 1.6 Respawn** | `cmux31nyo00mk01ppabp05ilf` | No — different plugin tree, not in this repo |

**Vanilla is the deploy target for everything in the table above.** Its tree is
the one these diffs were made against, so the line numbers, the `plugins.ini`
order and the plugin set all match.

**Zombie and Respawn need a per-file check first, not a blind copy.** Before
uploading anything there, list what that server actually has:

```sh
printf 'ls -l cstrike/addons/amxmodx/plugins/freenova_sync.amxx\nls -l cstrike/addons/amxmodx/configs/plugins.ini\n' \
  | sftp -P 2022 cmux3jjdq00tj01pp8offikdi@193.70.81.30
```

A file that is absent on that server is not "missing", it is *not part of that
server's build* — do not add it. `plugins.ini` there also carries
zombie/respawn-specific entries this repo has never seen, so copying this
`plugins.ini` over it would disable plugins; apply only the `rt_planting`/`rt_core`
reorder by hand on those two hosts.

`freenova_zgun.amxx` is not loaded in this tree's `plugins.ini`; skip it on every
server unless `amxx plugins` there shows it loaded.

---

## 4. Upload — one file per `put`

Recursive transfer is broken on this host (`sftp -r` rejects every file with
"not a regular file"), and `sftp -b <batchfile>` forces `BatchMode=yes`, which
never uses the password. So: **pipe the commands on stdin**, with
`SSH_ASKPASS_REQUIRE=force` so `ssh`/`sftp` reads the password from the askpass
helper instead of a terminal.

```sh
# one askpass helper: prints the password, nothing else
cat > /tmp/askpass.sh <<'EOF'
#!/bin/sh
printf '%s\n' "$SFTP_PASS"
EOF
chmod 700 /tmp/askpass.sh

export SFTP_PASS='<the panel SFTP password>'
export SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force
export SFTP_HOST=cmux305a200lt01pppogfv4wj@193.70.81.30
```

Batch upload of the 15 binaries + 15 sources + `plugins.ini` (one session, one
`put` per line — `sftp` continues past a failed file, so read the output):

```sh
cd /home/ajxs/projects/FreeNova-Classic-Server/game-server
PLUGINS="freenova_clutch battlepass_core freenova_sync freenova_randevent rsu_core \
freenova_vip freenova_registration freenova_calladmin fn_chat weapon_models \
freenova_zgun simple_warmup freenova_achievements freenova_progression advanced_bans"

{
  for p in $PLUGINS; do
    printf 'put cstrike/addons/amxmodx/plugins/%s.amxx cstrike/addons/amxmodx/plugins/%s.amxx\n' "$p" "$p"
    printf 'put cstrike/addons/amxmodx/scripting/%s.sma cstrike/addons/amxmodx/scripting/%s.sma\n' "$p" "$p"
  done
  printf 'put cstrike/addons/amxmodx/configs/plugins.ini cstrike/addons/amxmodx/configs/plugins.ini\n'
} | sftp -P 2022 "$SFTP_HOST"
```

Single file, if you prefer to see each transfer:

```sh
printf 'put cstrike/addons/amxmodx/plugins/freenova_sync.amxx cstrike/addons/amxmodx/plugins/freenova_sync.amxx\n' \
  | sftp -P 2022 "$SFTP_HOST"
```

`put <local> <remote>` with both halves spelled out is deliberate: it makes a
typo a missing-file error rather than an upload to the wrong name.

Then unset the password variable and remove the helper:

```sh
unset SFTP_PASS SSH_ASKPASS SSH_ASKPASS_REQUIRE; rm -f /tmp/askpass.sh
```

---

## 5. Restart

AMXX re-reads every `.amxx` on map start, so the reload is a map change — not a
server restart (a restart drops players and is worse):

```
# from the server console / RCON:
amx_map <current map>          # or: changelevel <current map>
```

or use the panel's restart button. `amx_reloadadmins` does **not** reload
plugins (it only re-reads the admin cache from `users.ini`); it is listed here
only because the panel docs mention it. `plugins.ini` is read at the same map
start, so the new load order takes effect with the same `changelevel`.

---

## 6. Verify

```
amxx plugins                 # 67 loaded, none "bad load" / "unknown"
amx_syncstatus               # or watch the panel: meta.last_push must move
```

Then check `addons/amxmodx/logs/error_<date>.log` for anything new. Per-fix
checks that need a live player are listed in the commit messages; the quickest
ones:

| Fix | Check |
|---|---|
| `plugins.ini` load order | `amxx plugins` lists `rt_planting.amxx` **before** `rt_core.amxx`; planting a corpse works |
| `freenova_randevent` | `fn_re_min 1` / `fn_re_max 1`, wait for a fire, `changelevel` mid-event, then `fn_event_xp_mult` is back to `1.000` |
| `simple_warmup` | `changelevel` during a knife warm-up: `amx_knife_round_active 0`, `mp_freezetime` back to its configured value |
| `freenova_vip` | a 3650-day grant stores a positive expiry (`amx_vipinfo`) |
| `freenova_sync` | a dispatch the relay times out on is re-sent: the second attempt logs once and ACKs "already applied" |
| `freenova_registration` / `freenova_calladmin` | `/register` and `/calladmin` complete; no `Run time error 3: stack error` |

---

## 7. Rollback

Every previous binary is in this repo's history, so roll back by extracting the
old file and re-uploading it — one `put` per file, then `changelevel` again.

```sh
PRE=0b8f301        # last commit before the plugin fixes (REVIEW.md §9b)
cd /home/ajxs/projects/FreeNova-Classic-Server/game-server
for p in freenova_sync battlepass_core; do
  git show $PRE:game-server/cstrike/addons/amxmodx/plugins/$p.amxx > /tmp/$p.amxx
  git show $PRE:game-server/cstrike/addons/amxmodx/scripting/$p.sma > /tmp/$p.sma
done
cd /home/ajxs/projects/FreeNova-Classic-Server/game-server
printf 'put /tmp/freenova_sync.amxx cstrike/addons/amxmodx/plugins/freenova_sync.amxx\nput /tmp/freenova_sync.sma cstrike/addons/amxmodx/scripting/freenova_sync.sma\n' \
  | sftp -P 2022 "$SFTP_HOST"
```

To roll back everything at once use the same loop as §4 with `--source $PRE`, or
`git checkout $PRE -- <paths>` in a scratch clone and upload from there. The
`plugins.ini` reorder is safe to keep even with the old binaries —
`rt_planting` before `rt_core` is valid for both.

No database or vault migration is needed in either direction: every change is
additive (new vault keys, new `bpaward` rows) and old binaries simply ignore
them.

---

## 8. Things the operator should know

1. **Parked clutch coins written before this deploy are lost, not migrated.**
   Every player's unpaid amount was stored under one corrupted key
   (`clutchpend#…` with the authid missing), so those rows cannot be attributed
   to anyone. They stay in the `freenova_clutch` vault and are no longer read.
   Nothing needs deleting; nothing will be paid out.
2. **`freenova_sync` keeps one nVault row per applied web action**
   (`wact#<action id>` in `freenova_events`). Same house pattern as the event
   payouts; there is no pruning task, so the vault grows by one small row per
   admin grant/claim. If that is ever a concern, a `nvault_prune` on that
   handle is a separate change.
3. **`freenova_achievements` now uses award ids `ach#<n>` in battlepass_core's
   vault** (kind `coins`). The legacy `ach#N` *XP* awards are a different kind
   and stay uncredited, as the file already documented.
4. **`freenova_zgun.amxx` is rebuilt but not loaded anywhere** — its two format
   fixes are latent until someone enables it.
5. **Two files this deploy does not touch remain stale on the host**: per
   `REVIEW.md` §5.5 the deployed `postgres_engine.amxx` and `weapon_models.amxx`
   binaries were older than their sources. `weapon_models.amxx` is fixed by this
   deploy; `postgres_engine.amxx` is not in this change set and still needs a
   rebuild + upload of its own.

## 9. Not decided here (operator decisions, not deploy steps)

* BP-XP vs rank XP: they are still one ledger (`REVIEW.md` §2.4/§8.4).
* Coin economy: the four premium-tier `g_iCoins[] +=` sites (§8.3) are still
  unclamped; only the two admin paths are fixed.
* The panel-side action token (§3.8) and the `?k=` admin password path (§8.7).

---

## 6. Deployment record — 2026-11-22

Uploaded to the live server the panel calls **"CS 1.6 Vanilla"**
(`cmux305a200lt01pppogfv4wj`, `193.70.81.30:27015`, ReHLDS) over SFTP, per file:

| what | count | destination |
|---|---|---|
| rebuilt plugin binaries | 15 | `cstrike/addons/amxmodx/plugins/` |
| `plugins.ini` (rt_planting before rt_core + two corrected comments) | 1 | `cstrike/addons/amxmodx/configs/plugins.ini` |

Safety checks done first:

* the 15 live binaries were byte-identical in size to this repo's pre-fix
  snapshot (`0b8f301`), so nothing on the host had been hot-fixed behind our
  back and the upload cannot revert someone else's change;
* the four files compared (`plugins.ini`, `server.cfg`, `amxx.cfg`,
  `mapcycle.txt`) were byte-identical between this repo and the host before the
  upload, so the repo really is the source of truth for this server;
* after the upload every one of the 16 files matched its local size on the host
  (15/15 binaries, `plugins.ini` 7175 bytes).

**Not yet activated.** AMX Mod X loads plugin binaries at server start only - a
map change does not reload them - so the running server still has the old
plugins in memory until it is restarted (panel Restart, or a stop/start).

Rollback, if a plugin misbehaves after the restart:

```sh
git show 0b8f301:game-server/cstrike/addons/amxmodx/plugins/freenova_sync.amxx > /tmp/freenova_sync.amxx
printf 'put /tmp/freenova_sync.amxx cstrike/addons/amxmodx/plugins/freenova_sync.amxx\n' \
  | SFTP_PASS=... SSH_ASKPASS=... ssh-sftp -P 2022 cmux305a200lt01pppogfv4wj@193.70.81.30
```

then restart again. Rolling back `plugins.ini` alone restores the old
`rt_core`/`rt_planting` order (corpse-planting disabled) without touching any
binary.

---

# Round two — the Medium/Low findings and the panel gaps

Commits `354280e..ae0144e` (`REVIEW.md` §9c). Round one's 16 files are already
live; nothing here repeats them, and no `plugins.ini`, `amxx.cfg` or credential
changes - so **no load-order step and no rotation** this time.

`freenova_sync.amxx` is the one file whose *source* must go up even though its
change is small: the panel half of the stale-snapshot guard needs the
`last_seen` field it now sends. Panel and plugin can be deployed in either
order (the panel falls back to its own clock when the field is absent, and an
old panel ignores it).

## 10. What to upload (plugins)

```sh
cd /home/ajxs/projects/FreeNova-Classic-Server/game-server
PLUGINS2="rsu_matchstats battlepass_core freenova_mapvote weaponmenu \
reapi_healthnade freenova_zgun weapon_models fn_bans postgres_engine \
rt_effects rt_core rsu_stats freenova_sync"

{
  for p in $PLUGINS2; do
    printf 'put cstrike/addons/amxmodx/plugins/%s.amxx cstrike/addons/amxmodx/plugins/%s.amxx\n' "$p" "$p"
    printf 'put cstrike/addons/amxmodx/scripting/%s.sma cstrike/addons/amxmodx/scripting/%s.sma\n' "$p" "$p"
  done
} | sftp -P 2022 "$SFTP_HOST"
```

Same session setup as §4 (`SSH_ASKPASS_REQUIRE=force`, one `put` per file).

| Plugin | was | now | sha256 (first 16) | Finding |
|---|---|---|---|---|
| `rsu_matchstats.amxx` | 12422 | 13413 | `411735f6be212873` | §5.5 lifetime KAST/trade/ace flush matched `server_id = 0` |
| `battlepass_core.amxx` | 66158 | 66262 | `21858fb4a0a0b4f4` | production log: `item_defuser` is not an item class |
| `freenova_mapvote.amxx` | 20451 | 19965 | `532e506050d98f02` | §5.5 `/noms` wrote past `szList[160]` |
| `weaponmenu.amxx` | 7868 | 7478 | `e016210030f5a911` | §5.5 15 s expiry left the menu live |
| `reapi_healthnade.amxx` | 14874 | 15979 | `11366130343e5f81` | comment only; the tracked binary was **stale**, this is the source's own build |
| `freenova_zgun.amxx` | 17000 | 16806 | `fea3e0cabc5d15f1` | §5.5 flag gate read the flag string too late; config rewritten every map. **Not loaded** |
| `weapon_models.amxx` | 43477 | 43565 | `fe7621e37d5450c4` | §5.5 refund path, `MAX_PLAYERS`, busy-wait |
| `fn_bans.amxx` | 11740 | 14588 | `b0a10ce5193f49cb` | §5.5 audited/counted bans the backend never applied; "confirm failed" logged before every attempt |
| `postgres_engine.amxx` | 33813 | 34358 | `34a1a92529fdd0b5` | §5.5 md5 temp file, fail-queue spin, no query timeout (new cvar `ab_sql_timeout`, default 20) |
| `rt_effects.amxx` | 7471 | 7938 | `85d373a0e416e16c` | §5.5 hex colour parsed with `&&` |
| `rt_core.amxx` | 11278 | 12814 | `0cec277eb2ac0bf3` | §5.5 ClCorpse origin divided as integers; the tracked binary was also stale |
| `rsu_stats.amxx` | 1122 | 981 | `bacfc7ab9cc9cf15` | §5.5 comment claimed the plugin is not loaded (it is, line 67) |
| `freenova_sync.amxx` | 39008 | 39058 | `6a096f5a7dbbca9d` | sends the per-push snapshot clock the panel's ordering guard needs |

**One source-only change**: `scripting/ab_bypass_bridge.sma` (`e8bcb7b`, the
`%N` log specifier) has **no `.amxx`** - `bypass_guard.inc` is not in this tree,
so it cannot be built here. That plugin is commented out in `plugins.ini`
(line 16), so nothing is running it; whoever re-enables it must rebuild both
`bypass_guard` and `ab_bypass_bridge` on a host that has the include.

`rt_core.amxx` must go up **with** the source: both are newer than what the tree
had, and the ordering fix lives in `plugins.ini` (already live from round one).

## 11. What to deploy (panel)

The panel changes are two commits (`fef2c45`, `ae0144e`) in `web-panel/`. Files:
`server_local.mjs`, `src/{sync,index,admin,pages,competitive,events,profile,register,bp_track}.js`,
`src/top15/page.js`, `test_harness.mjs`.

Before restarting, decide one thing:

| Environment | `FN_LOCAL_TRUST` | Effect |
|---|---|---|
| the live LAN panel (MOTD + LAN browsers) | **`1`** | keeps today's behaviour: pages mint the day token, so buy/equip/claim/featured buttons work |
| anything reachable from the internet | **unset** | no panel-side minting; only game-minted `/u/<sid>/<slug>/k/<token>` links can act, and the pages say so |

```sh
cd web-panel
git pull                      # or copy the files over
FN_LOCAL_TRUST=1 node server_local.mjs     # the live LAN panel
```

`FN_LOCAL_TRUST` is read from the process environment (or `relay/relay.env`,
which `server_local.mjs` loads for keys that are unset). For the Worker path it
would be a `[vars]` entry in `wrangler.toml` - leave it unset there.

The theme editor is no longer a URL. To save the top-15 theme:

```sh
curl -sS -X POST -H "X-FreeNova-Admin-Key: $ADMIN_PASSWORD" \
  --data "t_accent=%23ff0000&t_bg=%2308130f" \
  "http://<panel>:8080/top15?theme=save"
# reset:
curl -sS -X POST -H "X-FreeNova-Admin-Key: $ADMIN_PASSWORD" \
  "http://<panel>:8080/top15?theme=reset"
```

A bookmarked `GET /top15?theme=save&k=...` now answers 403 with an explanation
instead of saving.

## 12. Verify after the restart

```
amxx plugins                 # 67 loaded, none bad/unknown (70 on the live box)
amx_syncstatus               # or watch the panel: meta.last_push must move
```

Then, in `addons/amxmodx/logs/error_<date>.log`, check for new lines. Per-fix
checks that need a live player:

| Fix | Check |
|---|---|
| `battlepass_core` defuse kit | a tier-8 CT spawns with a kit; the `[FUN] Item "item_defuser" failed to create` line and its `give_item` run-time error stop appearing |
| `fn_bans` | `fn_banstatus` - `session_bans` moves only for a ban that actually kicks; `fn_confirm <case>` no longer logs "confirm failed" on success |
| `postgres_engine` | a ban still lands (the DB is at 172.17.0.1:5434); no `[PG] md5` errors; `ab_sql_timeout` exists in `amx_cvar` |
| `rsu_matchstats` | after a full match, `player_stats.kast_rounds` for a regular moves (before: unchanged) |
| `rt_core` / `rt_effects` | corpse models sit exactly where the player died; a malformed `rt_revive_glow` no longer reads past the string |
| `freenova_sync` + panel | the panel's `/profile` XP does not go backwards when a push is retried; `meta.last_push` moves |
| `weapon_models` | buying a skin with less than the price charges nothing; `/skins` copy and shop behave as before |
| panel token gate | with `FN_LOCAL_TRUST=1`, a claim button queues (status line "Request queued"); with it unset, the page says action links are unavailable |

`rt_effects`, `rt_core` and the `rsu_*` changes are exercised by the local
ReHLDS harness (`docs/RUNBOOK.md` §6): `all 67 plugins running`,
`no runtime errors`. The bans stack (`postgres_engine`, `advanced_bans`,
`cban_screenshots`, `fn_bans`) is **not** part of that profile, so those four are
compile-verified only and need the live check above.

## 13. Rollback

Everything before this round is `354280e`:

```sh
PRE=354280e
cd /home/ajxs/projects/FreeNova-Classic-Server/game-server
for p in rsu_matchstats battlepass_core freenova_mapvote weaponmenu \
         reapi_healthnade freenova_zgun weapon_models fn_bans postgres_engine \
         rt_effects rt_core rsu_stats freenova_sync; do
  git show $PRE:game-server/cstrike/addons/amxmodx/plugins/$p.amxx > /tmp/$p.amxx
  printf 'put /tmp/%s.amxx cstrike/addons/amxmodx/plugins/%s.amxx\n' "$p" "$p"
done | sftp -P 2022 "$SFTP_HOST"
```

then restart (AMX Mod X reads binaries at server start). The panel rolls back
with `git checkout 354280e -- web-panel` and a restart. No database or vault
migration is needed in either direction: nothing in this round adds or renames a
column, a vault key or a config key - the only new knob is the optional
`ab_sql_timeout` cvar and the optional `FN_LOCAL_TRUST` env var.

---

## 7. Deployment record — round two, 2026-11-22 (16:5x UTC)

Same server, same method. **13 rebuilt binaries**, no `plugins.ini` change:

```
battlepass_core fn_bans freenova_mapvote freenova_sync freenova_zgun
postgres_engine reapi_healthnade rsu_matchstats rsu_stats rt_core rt_effects
weapon_models weaponmenu
```

Pre-flight: all 13 live binaries were **size-identical** to this repo at `354280e`
(the round-one deployment), so again no drift to clobber. Post-upload: **13/13
matched** their local sizes on the host.

Activation: panel restart, then `amx_plugins` read off the console ->
**`70 plugins, 70 running`**, no bad loads. No new `error_*.log` was written
(the newest is still `error_20261031.log`), and the three most recent daily logs
(Nov 20-22) contain zero `Run time error` / `[AMXX]` lines.

Rollback: same recipe as §6, with `354280e` as the revision.

Not deployed here: `web-panel/**`. The Worker deployment is a separate artefact
(`npm run deploy` against the owner's Cloudflare account, which this machine is
not logged in to) - the panel changes are committed and tested but still need
`wrangler deploy` from a machine with credentials.

---

## 8. Deployment record — web panel, 2026-11-22 (~17:00 UTC)

The live panel is **not** a Cloudflare Worker deployment. It is the Node runner
(`server_local.mjs`) on the Catalyst server "Leaderboard Website"
(`cmuyj281s0c0i01p3edt001f0`, SFTP root of the second account), published as
**https://leaderboard.fn-gaming.net**. Deploying it is the same operation as the
plugins: upload the changed files over SFTP, then restart that server from the
panel. `wrangler deploy` is irrelevant for this deployment - the workers.dev host
in `relay/relay.log` is dead (`error code: 1042`) and nothing is served there.

Uploaded: **18 files** (`git diff c7f8ca2..HEAD -- web-panel`), i.e. every panel
change made in this repo since the snapshot - 9 `src/*.js`, `server_local.mjs`,
`relay/relay.js`, `test_harness.mjs`, `HUB.md`, `package.json` and
`package-lock.json`. Nothing under `data/`, `assets/`, `node_modules/` or
`relay/relay.env` was touched (the secrets and the live SQLite replica stay as
they are).

Pre-flight: the live tree was **byte-identical to this repo's first snapshot**
(`c7f8ca2`) for every file in that set, so the upload could not revert a
hand-edit made on the host. Post-upload: **18/18 matched** their local sizes.
Rollback: `/tmp` is not durable, so rebuild the old file with
`git show c7f8ca2:web-panel/<file>` and put it back, then restart.

Restart log (clean):

```
[panel] SQLite /home/container/data/freenova_panel.sq3
[panel] HTTP http://127.0.0.1:8762  (bind 0.0.0.0)
[panel] GoldSrc MOTD uses this HTTP URL - Cloudflare is not in the path
```

Verified against the live domain afterwards:

| check | before | after |
|---|---|---|
| `/`, `/profile`, `/top15`, `/bp` | 200 | 200 |
| `GET /top15?theme=save&k=<wrong>` | authorised a catalog write | **403 "the admin key is no longer accepted"** |
| `POST /api/v1/server/stats` unsigned | 401 | 401 `{"ok":false,"error":"missing signature"}` |
| `/competitive?claim=…&steamid=…` | queued an action for any steamid | **"not available on this deployment - open the panel from the game server"** |
| `/u/STEAM_0:0:683671116` | 404 | **200** (colon form accepted) |
| `/m/i/0-0-683671116/daily.htm` | 200 | 200 |
| `/m/b/0-0-683671116/missions.htm` | 302 -> `/m/i/.../daily.htm` | 302 (unchanged) |

The MOTD path takes **dashed** steamids (`/m/<code>/<a>-<b>-<c>/<tab>.htm`);
the colon form 404s on the old code too - verified by running the snapshot and
the current tree side by side against a copy of the live DB, so that 404 is
pre-existing behaviour, not a regression from this deploy.

Not verifiable right now: end-to-end game->panel sync freshness. The newest
`players.last_seen` in the live DB is 2026-11-21 12:11 because only YaPB bots have
been on the server since; the HMAC endpoint answers correctly, but a real player
session is needed to prove the push path end to end.
