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
